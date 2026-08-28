import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { runSatelliteWithDateFallback } from "@/lib/fortyguard";
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
  // Today is only the STARTING point of the search. FortyGuard's availability
  // lag is variable and hits /v1/satellite exactly as it hits /v1/heatmap, so
  // this walks back the same way rather than failing outright the way it used
  // to — see runSatelliteWithDateFallback().
  const startDate = new Date().toISOString().slice(0, 10);

  // Follows the same FORTYGUARD_MODE as /v1/heatmap (see isCachedMode() in
  // lib/fortyguard.ts) — cached mode returns a fixture with zero real
  // requests, live mode spends 1 credit per AOI. No separate always-off gate.
  const [fortyguardResult, overpassResult] = await Promise.allSettled([
    runSatelliteWithDateFallback({ latitude: lat, longitude: lon, startDate, granularity: SATELLITE_GRANULARITY }),
    fetchLandCoverFromOverpass(geometry),
  ]);

  return NextResponse.json({
    areaSqKm,
    centroid: { lat, lon },
    fortyguard:
      fortyguardResult.status === "fulfilled"
        ? {
            status: "ok" as const,
            cached: fortyguardResult.value.cached,
            result: fortyguardResult.value.result,
            // Additive: existing consumers read `result`/`cached` and are
            // unaffected, but a segmentation that came from an earlier date must
            // be able to say so rather than passing as today's.
            dateUsed: fortyguardResult.value.dateUsed,
            isFallbackDate: fortyguardResult.value.isFallbackDate,
          }
        : { status: "error" as const, message: fortyguardResult.reason?.message ?? "Unknown error" },
    overpass:
      overpassResult.status === "fulfilled"
        ? { status: "ok" as const, result: overpassResult.value }
        : { status: "error" as const, message: overpassResult.reason?.message ?? "Unknown error" },
  });
}
