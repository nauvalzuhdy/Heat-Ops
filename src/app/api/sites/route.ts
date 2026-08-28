// §4.7 — assembles one analysed AOI into a `sites` row (§8): uploads the 3
// output photos to Supabase Storage, then inserts the row with their public
// URLs. The id is minted here (not left to the table's default) so the
// Storage path and the row id agree from the first write.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { getSupabaseServiceClient, SITE_PHOTOS_BUCKET } from "@/lib/supabaseServer";
import { fetchSatelliteExportImage } from "@/lib/arcgisSatellite";
import { buildSiteRecord } from "@/lib/siteRecord";
import type { HeatForecastEntry } from "@/lib/siteRecord";
import { runEnvParams, relativeHumidityAt } from "@/lib/fortyguard";
import type { HeatmapResult, SatelliteSegmentationResult } from "@/lib/fortyguard";
import type { OverpassLandCover } from "@/lib/overpass";
import type { EndpointResult } from "@/store/analysisStore";

type RequestBody = {
  /** Feature 1 — user-entered or auto-generated ("Site near <address>") name. */
  name: string | null;
  aoiGeometry: Polygon;
  areaSqKm: number;
  centroid: { lat: number; lon: number };
  heatmap: EndpointResult<HeatmapResult>;
  satellite: EndpointResult<SatelliteSegmentationResult>;
  overpass: EndpointResult<OverpassLandCover>;
  /** Client-rendered canvas (lib/segmentationImage.ts), or null if Overpass failed. */
  segmentationImageDataUrl: string | null;
  /** The Surface heatmap card's own canvas, reused verbatim — see HeatmapImage.tsx. */
  heatImageDataUrl: string | null;
};

const DATA_URL_RE = /^data:(image\/\w+);base64,(.+)$/;

async function uploadDataUrl(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  path: string,
  dataUrl: string
): Promise<string> {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) throw new Error("not a base64 data URL");
  const buffer = Buffer.from(match[2], "base64");
  const { error } = await supabase.storage
    .from(SITE_PHOTOS_BUCKET)
    .upload(path, buffer, { contentType: match[1], upsert: true });
  if (error) throw new Error(error.message);
  return supabase.storage.from(SITE_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, aoiGeometry, areaSqKm, centroid, heatmap, satellite, overpass, segmentationImageDataUrl, heatImageDataUrl } =
    body;

  if (!aoiGeometry || aoiGeometry.type !== "Polygon") {
    return NextResponse.json({ error: "Missing or invalid 'aoiGeometry' (expected a GeoJSON Polygon)" }, { status: 400 });
  }

  const id = randomUUID();
  const supabase = getSupabaseServiceClient();

  // Each photo is independent — one failing (e.g. ArcGIS export timing out)
  // shouldn't block saving the other two or the row itself; the column just
  // stays null, matching how attribution already marks failed data sources.
  let satellite_photo_url: string | null = null;
  try {
    const buffer = await fetchSatelliteExportImage(aoiGeometry);
    const { error } = await supabase.storage
      .from(SITE_PHOTOS_BUCKET)
      .upload(`${id}/satellite.png`, buffer, { contentType: "image/png", upsert: true });
    if (error) throw new Error(error.message);
    satellite_photo_url = supabase.storage.from(SITE_PHOTOS_BUCKET).getPublicUrl(`${id}/satellite.png`).data.publicUrl;
  } catch (err) {
    console.error("[sites] satellite photo failed:", err);
  }

  let segmentation_photo_url: string | null = null;
  if (segmentationImageDataUrl) {
    try {
      segmentation_photo_url = await uploadDataUrl(supabase, `${id}/segmentation.png`, segmentationImageDataUrl);
    } catch (err) {
      console.error("[sites] segmentation photo failed:", err);
    }
  }

  let heat_photo_url: string | null = null;
  if (heatImageDataUrl) {
    try {
      heat_photo_url = await uploadDataUrl(supabase, `${id}/heat.png`, heatImageDataUrl);
    } catch (err) {
      console.error("[sites] heat photo failed:", err);
    }
  }

  const record = buildSiteRecord({ name, aoiGeometry, areaSqKm, centroid, heatmap, satellite, overpass });

  const { error: insertError } = await supabase.from("sites").insert({
    id,
    name: record.name,
    aoi_geometry: record.aoi_geometry,
    site_area_m2: record.site_area_m2,
    landcover: record.landcover,
    landcover_spotcheck: record.landcover_spotcheck,
    heat_tiles: record.heat_tiles,
    heat_stats: record.heat_stats,
    satellite_photo_url,
    segmentation_photo_url,
    heat_photo_url,
    attribution: record.attribution,
    // heat_forecast starts NULL: the row saves as soon as §4.3's whole-day
    // analysis completes, before the user has had a chance to explore any
    // §4.4 forecast slots. PATCH below fills it in once slots resolve.
  });

  if (insertError) {
    console.error("[sites] insert failed:", insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ siteId: id });
}

// ---------------------------------------------------------------------------
// Humidity enrichment (FortyGuard /v1/env_params).
//
// Runs server-side, here, rather than in Map View: this route already has the
// site's aoi_geometry and its previously-stored slots, so the client needs no
// change and there is exactly one place that can spend a credit for this.
//
// Cost control matters because ForecastPanel re-PATCHes the full accumulated
// slot list whenever it changes. Two guards keep that from becoming one
// env_params call per slot: humidity already stored for a given targetTime is
// reused, and the call is skipped entirely when nothing is missing. In the
// normal flow captureFullForecast() resolves all five slots in one state
// update, so this is a single extra call per analysis.
//
// Failure is never fatal: any error, missing geometry, or absent reading leaves
// the entries exactly as the client sent them, and lib/wbgt.ts then labels those
// slots ASSUMED. A forecast that saves without humidity is strictly better than
// a forecast that fails to save.
// ---------------------------------------------------------------------------
async function attachMeasuredHumidity(
  siteId: string,
  entries: HeatForecastEntry[],
): Promise<HeatForecastEntry[]> {
  const stepStartedAt = performance.now();
  const elapsed = () => ((performance.now() - stepStartedAt) / 1000).toFixed(1);
  if (entries.length === 0) return entries;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select("aoi_geometry, heat_forecast")
    .eq("id", siteId)
    .maybeSingle();

  if (error || !data) {
    console.warn("[sites] humidity enrichment skipped — could not read site:", error?.message);
    return entries;
  }

  // Reuse anything an earlier PATCH already resolved, keyed by the instant the
  // slot is FOR (targetTime), not by hourOffset — offsets are relative to when
  // the analysis ran and would collide across re-analyses of the same site.
  const stored = (data.heat_forecast as HeatForecastEntry[] | null) ?? [];
  const knownHumidity = new Map<string, { pct: number; cached: boolean }>();
  for (const e of stored) {
    if (typeof e?.relativeHumidityPct === "number" && e.targetTime) {
      knownHumidity.set(e.targetTime, { pct: e.relativeHumidityPct, cached: Boolean(e.humidityCached) });
    }
  }

  const withKnown = entries.map((e) => {
    const hit = knownHumidity.get(e.targetTime);
    return hit ? { ...e, relativeHumidityPct: hit.pct, humidityCached: hit.cached } : e;
  });
  if (withKnown.every((e) => typeof e.relativeHumidityPct === "number")) {
    console.log(`[sites] Tree-canopy/humidity step: nothing missing, skipped env_params call (${elapsed()}s)`);
    return withKnown;
  }

  const geometry = data.aoi_geometry as Polygon | null;
  if (!geometry) return withKnown;

  try {
    const [longitude, latitude] = turf.centroid(geometry).geometry.coordinates;

    // `temperature` is an input to /v1/env_params, so it gets the temperature
    // FortyGuard already measured for this AOI — the mean across captured slots,
    // which is representative of the window the humidity series is used for.
    const temps = withKnown.map((e) => e.meanTempC).filter((t) => typeof t === "number" && Number.isFinite(t));
    if (temps.length === 0) return withKnown;
    const temperature = temps.reduce((a, b) => a + b, 0) / temps.length;

    // Ask for the day the READINGS are actually from. When the heatmap fell back
    // to an earlier date, `dateUsed` is that date — pairing humidity from a
    // different day than the temperature would be exactly the kind of quiet
    // mismatch this codebase refuses elsewhere.
    const startDate =
      withKnown.find((e) => !e.relativeHumidityPct && e.dateUsed)?.dateUsed ??
      withKnown[0]?.dateUsed ??
      withKnown[0]?.targetTime?.slice(0, 10);
    if (!startDate) return withKnown;

    const { cached, result } = await runEnvParams({ latitude, longitude, temperature, startDate });

    let filled = 0;
    const enriched = withKnown.map((e) => {
      if (typeof e.relativeHumidityPct === "number") return e;
      const pct = relativeHumidityAt(result, e.targetTime);
      if (pct == null) return e;
      filled++;
      return { ...e, relativeHumidityPct: pct, humidityCached: cached };
    });
    console.log(
      `[sites] env_params humidity attached to ${filled}/${withKnown.length} forecast slots` +
        ` (cached=${cached}, start_date=${startDate}) — ${elapsed()}s`,
    );
    return enriched;
  } catch (err) {
    console.error(
      `[sites] env_params humidity enrichment failed after ${elapsed()}s, storing slots without it:`,
      err,
    );
    return withKnown;
  }
}

// §4.4 — called from Map View each time a new forecast slot resolves, after
// the site row already exists. Client sends the full accumulated slot list
// (it already holds all of them in analysisStore) rather than one slot at a
// time, so this is a plain overwrite, not a partial merge.
export async function PATCH(request: NextRequest) {
  let body: { siteId: string; heatForecast: HeatForecastEntry[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.siteId || typeof body.siteId !== "string") {
    return NextResponse.json({ error: "Missing or invalid 'siteId'" }, { status: 400 });
  }
  if (!Array.isArray(body.heatForecast)) {
    return NextResponse.json({ error: "Missing or invalid 'heatForecast' (expected an array)" }, { status: 400 });
  }

  // Attach FortyGuard-measured humidity before storing, so lib/wbgt.ts computes
  // each slot's WBGT from that hour's real humidity instead of the flat
  // assumption. Degrades to the unenriched list on any failure.
  const heatForecast = await attachMeasuredHumidity(body.siteId, body.heatForecast);

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("sites").update({ heat_forecast: heatForecast }).eq("id", body.siteId);

  if (error) {
    console.error("[sites] heat_forecast update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
