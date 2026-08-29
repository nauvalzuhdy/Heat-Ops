// FortyGuard /v1/satellite tree-canopy segmentation — split out of
// /api/landcover (2026-08-29 performance investigation) into its own route so
// Map View's main heat+land-cover display never has to wait on it.
//
// This is genuinely independent enrichment, not a dependency of the heat
// analysis: it samples one centroid image for land-cover classification
// (tree canopy %, building %, etc. at that point), unrelated to the AOI-wide
// temperature tiles or the Overpass footprint. Root-cause investigation
// tonight found no code-level bug making canopy "unavailable" — four to five
// live /v1/satellite probes across two US locations and three dates all
// submitted successfully (HTTP 200, valid activity_id) and then sat in
// "Processing" for 174-181s before FortyGuard itself returned "Failed" with
// no result. That is a FortyGuard-side service condition, not a request,
// parsing, or persistence defect in this codebase — see
// lib/fortyguard.ts's runSatelliteWithDateFallback() for the full history of
// what WAS a real bug here (a poll budget that gave up before FortyGuard's
// own ~180s answer, misreporting a timeout as "unavailable" instead of the
// real "Failed") and is already fixed.
//
// This route is called by analysisStore.ts's analyzeAOI() as a SEPARATE,
// non-blocking request fired alongside (not gating) the main heatmap +
// landcover fetch — never awaited before Map View shows its main result.
import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { runSatelliteWithDateFallback } from "@/lib/fortyguard";
import { MAX_AOI_AREA_SQKM } from "@/lib/mapConfig";

export const dynamic = "force-dynamic";
// FortyGuard can take ~180s to reach a terminal state on a slow day (see
// runSatelliteWithDateFallback's ~201s poll budget in lib/fortyguard.ts) —
// without this, Vercel's default function timeout would kill the request
// before that budget is ever reached. Actual ceiling still depends on the
// Vercel plan (Hobby caps at 60s regardless of this value).
export const maxDuration = 230;

// Start at 100m granularity during development — see project brief.
const SATELLITE_GRANULARITY = 100;

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
      { status: 400 },
    );
  }

  const [lon, lat] = turf.centroid(geometry).geometry.coordinates;
  const startDate = new Date().toISOString().slice(0, 10);

  // Same FORTYGUARD_MODE gate as /v1/heatmap — cached mode returns a fixture
  // with zero real requests, live mode spends 1 credit per AOI.
  console.log(`[/api/satellite/segmentation] START — AOI ${areaSqKm.toFixed(3)} km²`);
  try {
    const { cached, result, dateUsed, isFallbackDate } = await runSatelliteWithDateFallback({
      latitude: lat,
      longitude: lon,
      startDate,
      granularity: SATELLITE_GRANULARITY,
    });
    console.log(`[/api/satellite/segmentation] COMPLETE — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total`);
    return NextResponse.json({
      fortyguard: { status: "ok" as const, cached, result, dateUsed, isFallbackDate },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.log(`[/api/satellite/segmentation] FAILED — ${((performance.now() - routeStartedAt) / 1000).toFixed(1)}s total — ${message}`);
    return NextResponse.json({ fortyguard: { status: "error" as const, message } });
  }
}
