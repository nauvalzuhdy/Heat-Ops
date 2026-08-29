// Land cover from OpenStreetMap (Overpass) — AOI-wide, clipped to the drawn
// boundary. Free, unlimited, and typically fast (measured 1.6-9.8s across a
// range of AOI sizes in cached-mode testing tonight).
//
// Split from /v1/satellite tree-canopy segmentation (2026-08-29 performance
// investigation) — see api/satellite/segmentation/route.ts for that side and
// why. Overpass has no reason to wait on FortyGuard's satellite endpoint, and
// bundling them in one response meant Map View's main heat+landcover display
// could not appear until BOTH had settled — even on a day FortyGuard's
// satellite service is degraded (measured tonight: 4-5 consecutive live
// probes across 2 locations and 3 dates all sat in "Processing" for 174-181s
// before returning "Failed"). This route now returns as soon as Overpass
// alone answers.
import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { fetchLandCoverFromOverpass } from "@/lib/overpass";
import { MAX_AOI_AREA_SQKM } from "@/lib/mapConfig";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const routeStartedAt = performance.now();
  let geometry: Polygon;
  try {
    const body = await request.json();
    geometry = body.geometry;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!geometry || geometry.type !== "Polygon") {
    return NextResponse.json({ error: "Missing or invalid 'geometry' (expected a GeoJSON Polygon)" }, { status: 400 });
  }

  const areaSqKm = turf.area(geometry) / 1_000_000;
  if (areaSqKm > MAX_AOI_AREA_SQKM) {
    return NextResponse.json(
      { error: `AOI exceeds the ${MAX_AOI_AREA_SQKM} km² analysis limit (got ${areaSqKm.toFixed(1)} km²)` },
      { status: 400 }
    );
  }

  const [lon, lat] = turf.centroid(geometry).geometry.coordinates;

  console.log(`[/api/landcover] START — AOI ${areaSqKm.toFixed(3)} km², Overpass only (satellite is a separate call now)`);
  let overpassResult: Awaited<ReturnType<typeof fetchLandCoverFromOverpass>> | null = null;
  let overpassError: string | null = null;
  try {
    overpassResult = await fetchLandCoverFromOverpass(geometry);
  } catch (err) {
    overpassError = err instanceof Error ? err.message : "Unknown error";
  }
  console.log(`[/api/landcover] COMPLETE — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total`);

  return NextResponse.json({
    areaSqKm,
    centroid: { lat, lon },
    overpass: overpassResult
      ? { status: "ok" as const, result: overpassResult }
      : { status: "error" as const, message: overpassError ?? "Unknown error" },
  });
}
