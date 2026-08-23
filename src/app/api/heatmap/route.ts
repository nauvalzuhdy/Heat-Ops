import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { runHeatmapGeneration } from "@/lib/fortyguard";
import { FORECAST_HOUR_OFFSETS, MAX_AOI_AREA_SQKM, pickGranularity } from "@/lib/mapConfig";

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
  let geometry: Polygon;
  let hourOffset: number | undefined;
  try {
    const body = await request.json();
    geometry = body.geometry;
    hourOffset = body.hourOffset;
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
  const startDate = target.toISOString().slice(0, 10);
  const startTime = hourOffset !== undefined ? target.toISOString().slice(11, 16) : undefined;
  const filterType: 1 | 3 = hourOffset !== undefined ? 1 : 3;
  const granularity = pickGranularity(areaSqKm * 1_000_000);
  console.log(
    `[heatmap] AOI ${areaSqKm.toFixed(3)} km² -> requested granularity ${granularity}m` +
      (hourOffset !== undefined ? `, forecast +${hourOffset}h (start_time=${startTime})` : "")
  );

  try {
    const { cached, result } = await runHeatmapGeneration({
      aoiGeometry: geometry,
      startDate,
      startTime,
      filterType,
      hourOffset,
      granularity,
    });

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
    return NextResponse.json({ areaSqKm, cached, result, granularity, targetTime: target.toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Heatmap generation failed" },
      { status: 502 }
    );
  }
}
