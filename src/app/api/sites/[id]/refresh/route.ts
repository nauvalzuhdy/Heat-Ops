// Site-wide data refresh ("🔄 Refresh Latest Data", Operational Analyst).
//
// Re-runs the exact same FortyGuard/Overpass calls Map View's Analyze does —
// against this site's OWN saved aoi_geometry, never a redrawn or new one —
// and updates the SAME row (never inserts a new site). This is new
// construction: no refresh mechanism existed anywhere in this codebase before
// this route.
//
// Reuse, not duplication: every external call goes through this deployment's
// own existing, already-tested, already-instrumented route handlers
// (/api/heatmap, /api/landcover, PATCH /api/sites) via same-origin fetch
// (`request.nextUrl.origin` — no env var needed, works in dev and on Vercel).
// The FortyGuard-calling logic in lib/fortyguard.ts is never touched or
// re-implemented here. The DB-shape transformation (raw API response ->
// heat_tiles/heat_stats/landcover/landcover_spotcheck/attribution) reuses
// lib/siteRecord.ts's buildSiteRecord() — the exact function Map View's own
// site-creation flow (app/api/sites/route.ts) already uses, so a refreshed
// site's shape can never drift from a freshly-created one's.
//
// Partial-failure safety (the actual hard part of "refresh"): each of
// heatmap / overpass / satellite / forecast is tracked independently. A
// column is only overwritten in the UPDATE if ITS OWN leg succeeded — a
// failed leg leaves the existing column, and the existing attribution key
// that describes it, completely untouched. If EVERY leg fails, the row is
// not touched at all and `updated_at` is not stamped, so a failed refresh can
// never produce a state that looks newer than it is. This mirrors how
// app/api/landcover/route.ts already treats its own two legs (Promise.allSettled,
// independent success/failure), applied one level up.
//
// What this does NOT refresh, by design, not by oversight: the three saved
// photo URLs (heat_photo_url, satellite_photo_url, segmentation_photo_url).
// Those are rendered client-side onto a Map View canvas
// (components/map/HeatmapImage.tsx, lib/segmentationImage.ts,
// lib/arcgisSatellite.ts) and uploaded by app/api/sites/route.ts's POST —
// there is no canvas or DOM in a server route to re-render them from. A
// refreshed site's numbers, forecast, canopy %, and ROI inputs all update;
// its saved snapshot images do not, until the site is re-analyzed from Map
// View. The UI surfaces this explicitly rather than silently.
import { NextRequest, NextResponse } from "next/server";
import type { Polygon } from "geojson";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import { buildSiteRecord, type HeatForecastEntry } from "@/lib/siteRecord";
import { FORECAST_HOUR_OFFSETS } from "@/lib/mapConfig";
import type { HeatmapResult, SatelliteSegmentationResult } from "@/lib/fortyguard";
import type { OverpassLandCover } from "@/lib/overpass";

export const dynamic = "force-dynamic";

type ExistingRow = {
  aoi_geometry: Polygon | null;
  site_area_m2: number | null;
  name: string | null;
  heat_forecast: HeatForecastEntry[] | null;
  attribution: { landcover: string; landcover_spotcheck: string; heat: string } | null;
};

type HeatmapRouteBody =
  | {
      areaSqKm: number;
      cached: boolean;
      result: HeatmapResult;
      dateUsed: string;
      isFallbackDate: boolean;
      daysBack: number;
      targetTime: string;
    }
  | { error: string };

type LandcoverRouteBody =
  | {
      areaSqKm: number;
      centroid: { lat: number; lon: number };
      overpass: { status: "ok"; result: OverpassLandCover } | { status: "error"; message: string };
    }
  | { error: string };

// Split from LandcoverRouteBody on 2026-08-29 (see api/satellite/segmentation
// /route.ts) — /api/landcover no longer returns a `fortyguard` leg at all.
type SatelliteRouteBody =
  | {
      fortyguard:
        | { status: "ok"; cached: boolean; result: SatelliteSegmentationResult; dateUsed: string; isFallbackDate: boolean }
        | { status: "error"; message: string };
    }
  | { error: string };

async function postJSON<TBody>(
  origin: string,
  path: string,
  body: Record<string, unknown>,
  method: "POST" | "PATCH" = "POST",
): Promise<{ ok: boolean; body: TBody }> {
  try {
    const res = await fetch(`${origin}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Read as text first — a non-2xx from a route this thin (400/404/500)
      // is not guaranteed to be JSON, and a failed .json() parse here would
      // otherwise throw and mask the real status/body in the generic catch
      // below.
      const text = await res.text();
      console.error(`[refresh->postJSON] ${path} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
      let parsed: unknown = { error: text };
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave as the raw-text fallback above
      }
      return { ok: false, body: parsed as TBody };
    }
    const json = (await res.json()) as TBody;
    return { ok: true, body: json };
  } catch (err) {
    // A caught exception here means the fetch itself never got a response at
    // all (network/self-connection failure) — always worth seeing in the
    // log, since it's silent otherwise.
    console.error(`[refresh->postJSON] ${path} threw:`, err);
    return { ok: false, body: { error: err instanceof Error ? err.message : "Request failed" } as TBody };
  }
}

type SectionStatus = "updated" | "failed" | "skipped";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const siteId = params.id;
  const routeStartedAt = performance.now();
  console.log(`[/api/sites/${siteId}/refresh] START`);

  const supabase = getSupabaseServiceClient();
  const { data, error: readError } = await supabase
    .from("sites")
    .select("aoi_geometry, site_area_m2, name, heat_forecast, attribution")
    .eq("id", siteId)
    .maybeSingle();

  if (readError || !data) {
    return NextResponse.json({ error: readError?.message ?? "Site not found" }, { status: 404 });
  }
  const existing = data as ExistingRow;
  const geometry = existing.aoi_geometry;
  if (!geometry) {
    return NextResponse.json(
      { error: "This site has no saved AOI geometry to refresh against." },
      { status: 400 },
    );
  }

  const origin = request.nextUrl.origin;

  // Whole-day heatmap, landcover (Overpass), and satellite (tree canopy) —
  // three independent calls, all fired in parallel. Satellite is its own
  // request as of 2026-08-29 (api/satellite/segmentation/route.ts) — it used
  // to be bundled into /api/landcover's response, which meant this refresh
  // waited on satellite's own (bounded, but still up to ~45s) timeout before
  // it could report the OTHER two legs at all. Splitting it out here mirrors
  // the exact same fix analyzeAOI() already got for a fresh analysis.
  const heatmapStartedAt = performance.now();
  const landcoverStartedAt = performance.now();
  const satelliteStartedAt = performance.now();
  const [heatmapRes, landcoverRes, satelliteRes] = await Promise.all([
    postJSON<HeatmapRouteBody>(origin, "/api/heatmap", { geometry }).then((r) => {
      console.log(`[/api/sites/${siteId}/refresh] Surface Heatmap leg settled — ${((performance.now() - heatmapStartedAt) / 1000).toFixed(1)}s`);
      return r;
    }),
    postJSON<LandcoverRouteBody>(origin, "/api/landcover", { geometry }).then((r) => {
      console.log(`[/api/sites/${siteId}/refresh] Footprint leg settled — ${((performance.now() - landcoverStartedAt) / 1000).toFixed(1)}s`);
      return r;
    }),
    postJSON<SatelliteRouteBody>(origin, "/api/satellite/segmentation", { geometry }).then((r) => {
      console.log(`[/api/sites/${siteId}/refresh] Tree-canopy leg settled — ${((performance.now() - satelliteStartedAt) / 1000).toFixed(1)}s`);
      return r;
    }),
  ]);

  // Plain local-variable narrowing rather than nested `Extract<>` gymnastics —
  // those resolved to `never` here (TS can't deep-narrow a field-of-a-field
  // through Extract), and this reads more plainly besides.
  const heatmapBody = heatmapRes.ok && "result" in heatmapRes.body ? heatmapRes.body : null;
  const landcoverBody = landcoverRes.ok && "overpass" in landcoverRes.body ? landcoverRes.body : null;
  const satelliteBody = satelliteRes.ok && "fortyguard" in satelliteRes.body ? satelliteRes.body : null;
  const overpassLeg = landcoverBody?.overpass.status === "ok" ? landcoverBody.overpass : null;
  const satelliteLeg = satelliteBody?.fortyguard.status === "ok" ? satelliteBody.fortyguard : null;

  const heatmapOk = heatmapBody != null;
  const overpassOk = overpassLeg != null;
  const satelliteOk = satelliteLeg != null;

  // buildSiteRecord() is the SAME function app/api/sites/route.ts uses when a
  // site is first created — feeding it "error" for a leg that failed here
  // produces exactly its existing null/"unavailable" shape for that leg, so
  // this never invents a different meaning for "this data isn't available."
  const record = buildSiteRecord({
    name: existing.name,
    aoiGeometry: geometry,
    areaSqKm: (existing.site_area_m2 ?? 0) / 1_000_000,
    centroid: landcoverBody?.centroid ?? { lat: 0, lon: 0 },
    heatmap: heatmapBody
      ? {
          status: "ok",
          result: heatmapBody.result,
          cached: heatmapBody.cached,
          dateUsed: heatmapBody.dateUsed,
          isFallbackDate: heatmapBody.isFallbackDate,
        }
      : { status: "error", message: "heatmap leg failed" },
    satellite: satelliteLeg ?? { status: "error", message: "satellite leg failed" },
    overpass: overpassLeg ?? { status: "error", message: "overpass leg failed" },
  });

  // Forecast: the same 5 parallel /api/heatmap calls captureFullForecast()
  // makes, with the whole-day call's own daysBack as a hint (same reasoning
  // as analyzeAOI: don't re-probe dates the whole-day call already proved
  // empty seconds ago).
  const daysBackHint = heatmapBody?.daysBack;
  const forecastStartedAt = performance.now();
  const forecastResults = await Promise.all(
    FORECAST_HOUR_OFFSETS.map(async (hourOffset) => {
      const res = await postJSON<HeatmapRouteBody>(origin, "/api/heatmap", {
        geometry,
        hourOffset,
        ...(daysBackHint === undefined ? {} : { daysBackHint }),
      });
      if (!res.ok || !("result" in res.body)) return { hourOffset, entry: null };
      const body = res.body;
      const meanTempC = body.result.stats_data?.temperature_stats?.mean;
      if (typeof meanTempC !== "number") return { hourOffset, entry: null };
      const entry: HeatForecastEntry = {
        hourOffset,
        targetTime: body.targetTime,
        meanTempC,
        cached: body.cached,
        capturedAt: new Date().toISOString(),
        dateUsed: body.dateUsed,
        isFallbackDate: body.isFallbackDate,
      };
      return { hourOffset, entry };
    }),
  );
  console.log(
    `[/api/sites/${siteId}/refresh] Forecast +12h leg settled — ${((performance.now() - forecastStartedAt) / 1000).toFixed(1)}s ` +
      `(${forecastResults.filter((r) => r.entry).length}/${FORECAST_HOUR_OFFSETS.length} slots)`,
  );

  // Merge by hourOffset onto the EXISTING stored array, not a wholesale
  // replace: a slot that fails THIS refresh must keep its previous good
  // reading, never lose it because this specific hour's request happened to
  // fail this time.
  const existingForecast = existing.heat_forecast ?? [];
  const forecastByOffset = new Map(existingForecast.map((e) => [e.hourOffset, e]));
  let forecastChanged = false;
  for (const { hourOffset, entry } of forecastResults) {
    if (entry) {
      forecastByOffset.set(hourOffset, entry);
      forecastChanged = true;
    }
  }
  const mergedForecast = FORECAST_HOUR_OFFSETS.map((h) => forecastByOffset.get(h)).filter(
    (e): e is HeatForecastEntry => e != null,
  );

  // Build the partial UPDATE — one field at a time, only for a leg that
  // actually succeeded. attribution is merged onto the EXISTING object
  // (read above), never replaced wholesale: a failed leg's key must keep
  // describing the OLD data that's still sitting in that column.
  const updatePayload: Record<string, unknown> = {};
  const mergedAttribution = { ...(existing.attribution ?? { landcover: "unavailable", landcover_spotcheck: "unavailable", heat: "unavailable" }) };

  if (heatmapOk) {
    updatePayload.heat_tiles = record.heat_tiles;
    updatePayload.heat_stats = record.heat_stats;
    mergedAttribution.heat = record.attribution.heat;
  }
  if (overpassOk) {
    updatePayload.landcover = record.landcover;
    mergedAttribution.landcover = record.attribution.landcover;
  }
  if (satelliteOk) {
    updatePayload.landcover_spotcheck = record.landcover_spotcheck;
    mergedAttribution.landcover_spotcheck = record.attribution.landcover_spotcheck;
  }
  if (heatmapOk || overpassOk || satelliteOk) {
    updatePayload.attribution = mergedAttribution;
  }

  const anyFetched = heatmapOk || overpassOk || satelliteOk || forecastChanged;

  if (!anyFetched) {
    // Nothing came back at all — leave the row completely untouched (data-
    // honesty: a failed refresh must never look like it happened) and report
    // that plainly rather than a generic 500.
    console.log(
      `[/api/sites/${siteId}/refresh] FAILED, nothing updated — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total`,
    );
    const noneFailed: Record<"heatmap" | "overpass" | "satellite" | "forecast", SectionStatus> = {
      heatmap: "failed",
      overpass: "failed",
      satellite: "failed",
      forecast: "failed",
    };
    return NextResponse.json(
      { ok: false, sections: noneFailed, updatedAt: null, error: "FortyGuard and Overpass both failed to return usable data — the site's existing data was left unchanged." },
      { status: 502 },
    );
  }

  // Sections reflect what was actually PERSISTED, not merely fetched — a leg
  // that fetched fine but whose DB write failed must not be reported as
  // "updated". Set only after the write below actually succeeds.
  let heatmapPersisted = false;
  let overpassPersisted = false;
  let satellitePersisted = false;
  let updatedAt: string | null = null;

  if (Object.keys(updatePayload).length > 0) {
    // updated_at requires the migration documented in README ("Database
    // setup"). Retried without it on PostgREST's specific "unknown column"
    // response (its wording is "Could not find the 'x' column ... in the
    // schema cache", not the raw Postgres 42703 text) so a database that
    // hasn't run the migration yet still gets a working refresh — degrading
    // to "not persisted" rather than failing the whole request over one
    // missing, non-essential column. Matched against `updated_at` appearing
    // together with either phrasing, so either error shape is caught.
    const nowIso = new Date().toISOString();
    const isMissingUpdatedAtColumn = (msg: string) =>
      /updated_at/i.test(msg) && /(does not exist|could not find)/i.test(msg);

    const { error: updateError } = await supabase
      .from("sites")
      .update({ ...updatePayload, updated_at: nowIso })
      .eq("id", siteId);

    if (updateError && isMissingUpdatedAtColumn(updateError.message)) {
      console.warn(`[/api/sites/${siteId}/refresh] 'updated_at' column missing (see README migration) — saving without it.`);
      const { error: retryError } = await supabase.from("sites").update(updatePayload).eq("id", siteId);
      if (retryError) {
        console.error(`[/api/sites/${siteId}/refresh] update failed:`, retryError.message);
        return NextResponse.json(
          { ok: false, sections: { heatmap: "failed", overpass: "failed", satellite: "failed", forecast: forecastChanged ? "updated" : "failed" }, updatedAt: null, error: retryError.message },
          { status: 500 },
        );
      }
      heatmapPersisted = heatmapOk;
      overpassPersisted = overpassOk;
      satellitePersisted = satelliteOk;
    } else if (updateError) {
      console.error(`[/api/sites/${siteId}/refresh] update failed:`, updateError.message);
      return NextResponse.json(
        { ok: false, sections: { heatmap: "failed", overpass: "failed", satellite: "failed", forecast: forecastChanged ? "updated" : "failed" }, updatedAt: null, error: updateError.message },
        { status: 500 },
      );
    } else {
      heatmapPersisted = heatmapOk;
      overpassPersisted = overpassOk;
      satellitePersisted = satelliteOk;
      updatedAt = nowIso;
    }
  }

  // Forecast persistence + humidity enrichment reuse PATCH /api/sites AS-IS
  // — including its existing reuse-by-targetTime cache and its bounded
  // /v1/env_params call — rather than reimplementing either here. This is a
  // genuinely separate write from the one above, so its own success/failure
  // is independent and already accurately reflects what was persisted.
  let humiditySection: SectionStatus = "skipped";
  let forecastPersisted = false;
  if (forecastChanged) {
    const patchRes = await postJSON<{ ok: boolean } | { error: string }>(
      origin,
      "/api/sites",
      { siteId, heatForecast: mergedForecast },
      "PATCH", // app/api/sites/route.ts's POST handler is site CREATION — this must hit its PATCH handler instead.
    );
    forecastPersisted = patchRes.ok;
    humiditySection = patchRes.ok ? "updated" : "failed";
  }

  const sections: Record<string, SectionStatus> = {
    heatmap: heatmapPersisted ? "updated" : "failed",
    overpass: overpassPersisted ? "updated" : "failed",
    satellite: satellitePersisted ? "updated" : "failed",
    forecast: forecastPersisted ? "updated" : "failed",
    humidity: humiditySection,
  };

  console.log(
    `[/api/sites/${siteId}/refresh] COMPLETE — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total ` +
      `(heatmap=${sections.heatmap}, overpass=${sections.overpass}, satellite=${sections.satellite}, forecast=${sections.forecast})`,
  );

  return NextResponse.json({ ok: true, sections, updatedAt });
}
