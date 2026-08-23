import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { runSatelliteSegmentation } from "@/lib/fortyguard";
import { fetchLandCoverFromOverpass } from "@/lib/overpass";
import { MAX_AOI_AREA_SQKM } from "@/lib/mapConfig";

// Start at 100m granularity during development — see project brief.
const SATELLITE_GRANULARITY = 100;

export async function POST(request: NextRequest) {
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
  const startDate = new Date().toISOString().slice(0, 10);

  // Follows the same FORTYGUARD_MODE as /v1/heatmap (see isCachedMode() in
  // lib/fortyguard.ts) — cached mode returns a fixture with zero real
  // requests, live mode spends 1 credit per AOI. No separate always-off gate.
  const [fortyguardResult, overpassResult] = await Promise.allSettled([
    runSatelliteSegmentation({ latitude: lat, longitude: lon, startDate, granularity: SATELLITE_GRANULARITY }),
    fetchLandCoverFromOverpass(geometry),
  ]);

  return NextResponse.json({
    areaSqKm,
    centroid: { lat, lon },
    fortyguard:
      fortyguardResult.status === "fulfilled"
        ? { status: "ok" as const, cached: fortyguardResult.value.cached, result: fortyguardResult.value.result }
        : { status: "error" as const, message: fortyguardResult.reason?.message ?? "Unknown error" },
    overpass:
      overpassResult.status === "fulfilled"
        ? { status: "ok" as const, result: overpassResult.value }
        : { status: "error" as const, message: overpassResult.reason?.message ?? "Unknown error" },
  });
}
