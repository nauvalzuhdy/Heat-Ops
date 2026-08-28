import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { runHeatmapWithDateFallback, type HeatmapResult } from "@/lib/fortyguard";
import { FORECAST_HOUR_OFFSETS, MAX_AOI_AREA_SQKM, pickGranularity } from "@/lib/mapConfig";

// Bug fix (§4.4 forecast crash — "Cannot read properties of undefined
// (reading 'mean')"): `HeatmapResult.stats_data.temperature_stats` was only
// ever confirmed against a real LIVE filter_type=3 (whole-day) response (see
// lib/fortyguard.ts's own comment on that type) — filter_type=1
// (forecast, one specific hour) was never actually verified against a real
// response, and this project has already hit one real doc-vs-API field-name
// mismatch before (capitalized `Mean`/`Minimum` in FortyGuard's docs vs
// lowercase `mean`/`minimum` in the real payload). A site analyzed live
// ("Starbase (Boca Chica, Texas)") had `attribution.heat: "real"` for its
// main heatmap but `heat_forecast: null` — every one of its 5 forecast slots
// crashed on this exact unguarded access, identically, which points at a
// systematic shape mismatch for filter_type=1 rather than "some hours
// genuinely have no data" (that would fail some slots, not all 5 the same way).
//
// Fix, in order of preference: (1) accept the capitalized doc-style keys as a
// fallback if the lowercase ones are missing, (2) if `stats_data` is absent
// entirely, compute mean/min/max/stddev directly from the tile-level
// `average_temperature` values in `map_data` (which forecast responses do
// still need to return — that's what the heatmap image renders from), (3)
// only if neither recovers a usable number, fail with a specific, honest
// message instead of letting a raw property-access crash reach the client.
// Every branch is logged so a future real payload that hits this can be
// inspected and the exact shape folded back into `HeatmapResult`'s type.
function normalizeTemperatureStats(raw: unknown): HeatmapResult["stats_data"]["temperature_stats"] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const mean = r.mean ?? r.Mean;
  const minimum = r.minimum ?? r.Minimum;
  const maximum = r.maximum ?? r.Maximum;
  const standardDeviation = r.standard_deviation ?? r.Standard_Deviation ?? r.std_deviation;
  if (typeof mean !== "number" || typeof minimum !== "number" || typeof maximum !== "number") return null;
  return { mean, minimum, maximum, standard_deviation: typeof standardDeviation === "number" ? standardDeviation : 0 };
}

function computeTemperatureStatsFromTiles(result: HeatmapResult): HeatmapResult["stats_data"]["temperature_stats"] | null {
  const temps = result.map_data.features
    .map((f) => f.properties.average_temperature)
    .filter((t): t is number => typeof t === "number");
  if (temps.length === 0) return null;
  const minimum = Math.min(...temps);
  const maximum = Math.max(...temps);
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const variance = temps.reduce((a, b) => a + (b - mean) ** 2, 0) / temps.length;
  return { minimum, maximum, mean, standard_deviation: Math.sqrt(variance) };
}

// Ensures the response this route sends back always has a usable
// `stats_data.temperature_stats` (or throws a clear, specific error instead
// of letting a caller crash on a missing/differently-shaped field) — see the
// comment above for why this is needed specifically for filter_type=1.
function ensureUsableTemperatureStats(result: HeatmapResult, hourOffset: number | undefined): HeatmapResult {
  const normalized = normalizeTemperatureStats(result.stats_data?.temperature_stats);
  if (normalized) {
    if (normalized !== result.stats_data.temperature_stats) {
      return { ...result, stats_data: { ...result.stats_data, temperature_stats: normalized } };
    }
    return result;
  }

  console.warn(
    `[heatmap] FortyGuard response has no usable stats_data.temperature_stats` +
      (hourOffset !== undefined ? ` (forecast +${hourOffset}h)` : "") +
      ` — raw stats_data: ${JSON.stringify(result.stats_data)}. Falling back to computing stats from tiles.`
  );
  const fromTiles = computeTemperatureStatsFromTiles(result);
  if (!fromTiles) {
    throw new Error(
      hourOffset !== undefined
        ? `FortyGuard didn't return usable temperature data for the +${hourOffset}h forecast slot — it may not have coverage for this specific hour.`
        : "FortyGuard didn't return usable temperature data for this AOI."
    );
  }
  return {
    ...result,
    stats_data: {
      overall_temperature_distribution: result.stats_data?.overall_temperature_distribution ?? [],
      normal_temperature_distribution: result.stats_data?.normal_temperature_distribution ?? { x_axis: [], y_axis: [] },
      temperature_frequency: result.stats_data?.temperature_frequency ?? { x_axis: [], y_axis: [] },
      temperature_stats: fromTiles,
    },
  };
}

// Measures the first returned tile's real footprint in meters, to log against
// the granularity we requested — the API is free to tile at a different
// resolution than asked, so this is a check, not an assumption.
function measureTileMeters(ring: [number, number][]): { widthM: number; heightM: number } {
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const metersPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  return {
    widthM: (Math.max(...lons) - Math.min(...lons)) * metersPerDegLon,
    heightM: (Math.max(...lats) - Math.min(...lats)) * 111320,
  };
}

export async function POST(request: NextRequest) {
  const routeStartedAt = performance.now();
  let geometry: Polygon;
  let hourOffset: number | undefined;
  // Optional: "the whole-day analysis for this same AOI just found data N
  // days back, don't re-probe the dates it already proved empty seconds ago"
  // (see lib/fortyguard.ts's runHeatmapWithDateFallback). Never used to skip
  // an untested current date — only forecast slots pass it, and only after
  // the whole-day call in the same run has already tested those dates.
  let daysBackHint: number | undefined;
  try {
    const body = await request.json();
    geometry = body.geometry;
    hourOffset = body.hourOffset;
    daysBackHint = typeof body.daysBackHint === "number" ? body.daysBackHint : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!geometry || geometry.type !== "Polygon") {
    return NextResponse.json({ error: "Missing or invalid 'geometry' (expected a GeoJSON Polygon)" }, { status: 400 });
  }

  if (hourOffset !== undefined && !(FORECAST_HOUR_OFFSETS as readonly number[]).includes(hourOffset)) {
    return NextResponse.json(
      { error: `Invalid 'hourOffset' (expected one of ${FORECAST_HOUR_OFFSETS.join(", ")})` },
      { status: 400 }
    );
  }

  const areaSqKm = turf.area(geometry) / 1_000_000;
  if (areaSqKm > MAX_AOI_AREA_SQKM) {
    return NextResponse.json(
      { error: `AOI exceeds the ${MAX_AOI_AREA_SQKM} km² analysis limit (got ${areaSqKm.toFixed(1)} km²)` },
      { status: 400 }
    );
  }

  const now = new Date();
  // §4.4 — a forecast slot (hourOffset present) asks for one specific hour
  // (filter_type 1) instead of §4.3's whole-day analysis (filter_type 3).
  const target = hourOffset !== undefined ? new Date(now.getTime() + hourOffset * 3_600_000) : now;
  // FortyGuard's filter_type=1 data is keyed to WHOLE hours: the same AOI,
  // date and granularity returns a full tile set at "07:00" but FortyGuard's
  // degenerate empty result ({activity_id, n_cells: 0}) at "07:15" — verified
  // live, back to back, 2026-08-28. `now + hourOffset` carries whatever
  // minute the user happened to click Analyze at (":47", ":15", ":33"), which
  // matched nothing, so EVERY forecast slot failed regardless of date. That
  // looked like a FortyGuard data gap for months of investigation; it was
  // this. Truncating to the hour here (rather than only in the outgoing
  // start_time) also keeps `targetTime` below — the value stored and shown as
  // "the time this slot is FOR" — equal to what was actually requested.
  if (hourOffset !== undefined) target.setUTCMinutes(0, 0, 0);
  const startDate = target.toISOString().slice(0, 10);
  const startTime = hourOffset !== undefined ? target.toISOString().slice(11, 16) : undefined;
  const filterType: 1 | 3 = hourOffset !== undefined ? 1 : 3;
  const granularity = pickGranularity(areaSqKm * 1_000_000);
  console.log(
    `[heatmap] AOI ${areaSqKm.toFixed(3)} km² -> requested granularity ${granularity}m` +
      (hourOffset !== undefined ? `, forecast +${hourOffset}h (start_time=${startTime})` : "")
  );

  try {
    const { cached, result: rawResult, dateUsed, isFallbackDate, daysBack } = await runHeatmapWithDateFallback({
      aoiGeometry: geometry,
      startDate,
      startTime,
      filterType,
      hourOffset,
      granularity,
      initialDaysBack: daysBackHint,
    });

    // See ensureUsableTemperatureStats's comment above — guards specifically
    // against the filter_type=1 (forecast) shape never having been confirmed
    // against a real response, unlike filter_type=3.
    const result = ensureUsableTemperatureStats(rawResult, hourOffset);

    const firstTile = result.map_data.features[0];
    if (firstTile) {
      const { widthM, heightM } = measureTileMeters(firstTile.geometry.coordinates[0] as [number, number][]);
      console.log(
        `[heatmap] tileCount=${result.map_data.features.length}, requested=${granularity}m, ` +
          `actual first-tile size ≈ ${widthM.toFixed(1)}m x ${heightM.toFixed(1)}m`
      );
    } else {
      console.log(`[heatmap] tileCount=0 — no tiles returned for this AOI`);
    }

    // `target` was already computed above to build the FortyGuard request
    // itself (start_date/start_time) — returned here too so the caller
    // stores the actual real-world moment this snapshot targets, instead of
    // reconstructing "now + hourOffset" from its own clock later (which,
    // running seconds after this request started, would drift from what was
    // actually sent to FortyGuard) or using fetch-completion wall-clock time
    // (wrong concept entirely — that's when the data arrived, not what it's
    // for).
    const routeLabel = hourOffset === undefined ? "Surface Heatmap" : `Forecast +${hourOffset}h`;
    console.log(`[/api/heatmap] COMPLETE (${routeLabel}) — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total`);
    return NextResponse.json({
      areaSqKm,
      cached,
      result,
      granularity,
      targetTime: target.toISOString(),
      dateUsed,
      isFallbackDate,
      daysBack,
    });
  } catch (err) {
    const routeLabel = hourOffset === undefined ? "Surface Heatmap" : `Forecast +${hourOffset}h`;
    console.log(
      `[/api/heatmap] FAILED (${routeLabel}) — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total — ` +
        (err instanceof Error ? err.message : String(err)),
    );
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Heatmap generation failed" },
      { status: 502 }
    );
  }
}
