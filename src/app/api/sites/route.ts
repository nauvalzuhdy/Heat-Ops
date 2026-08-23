// §4.7 — assembles one analysed AOI into a `sites` row (§8): uploads the 3
// output photos to Supabase Storage, then inserts the row with their public
// URLs. The id is minted here (not left to the table's default) so the
// Storage path and the row id agree from the first write.
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Polygon } from "geojson";
import { getSupabaseServiceClient, SITE_PHOTOS_BUCKET } from "@/lib/supabaseServer";
import { fetchSatelliteExportImage } from "@/lib/arcgisSatellite";
import { buildSiteRecord } from "@/lib/siteRecord";
import type { HeatForecastEntry } from "@/lib/siteRecord";
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

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("sites").update({ heat_forecast: body.heatForecast }).eq("id", body.siteId);

  if (error) {
    console.error("[sites] heat_forecast update failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
