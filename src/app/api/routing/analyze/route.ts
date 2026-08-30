// §4.5 Phase 2 — the ONLY place in the routing feature that spends
// FortyGuard credit, and only ever in response to an explicit user click
// (RoutePanel.tsx's "Analyze heat for uncovered routes" button posts here).
// Never called automatically by Phase 1 (api/routing/route.ts) or by
// anything else.
//
// Exactly ONE FortyGuard submission per click, regardless of how many
// uncovered stretches exist across however many routes: a real live test
// (2026-08-30) submitted one bbox per uncovered stretch naively and spent 3
// credits on a single click the user had approved as "1 credit" — 2 routes,
// one with a partial-coverage gap on each side of a covered stretch, meant 3
// separate FortyGuard calls for what looked like one action in the UI. Fixed
// by merging every uncovered bbox (across all routes) into ONE bounding box
// before submitting — the submitted area is a little larger than strictly
// necessary (it also covers the gap BETWEEN stretches), but the cost is now
// deterministic and matches what the button actually implies.
import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { runHeatmapWithDateFallback } from "@/lib/fortyguard";
import { MAX_AOI_AREA_SQKM, pickGranularity } from "@/lib/mapConfig";
import { centroidOfRing, boundsOfRing, type HeatTileRecord } from "@/lib/siteRecord";
import { buildRouteCoverage, computeEfficiencyScores, computeHeatExposureScore, assignRouteLabels } from "@/lib/routing/scoring";
import { nearestTileTemp, type CoverageTilePool } from "@/lib/routing/coverage";
import { ROUTE_DISCLOSURE_TEXT, type ScoredRoute } from "@/lib/routing/types";

// Sanity cap on the input array size (not a credit-count guard anymore —
// there's always exactly one submission; this just bounds how many stretches
// get merged before the resulting area is checked against MAX_AOI_AREA_SQKM).
const MAX_BBOXES_PER_REQUEST = 20;

function isBbox(v: unknown): v is [number, number, number, number] {
  return (
    Array.isArray(v) &&
    v.length === 4 &&
    v.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    v[0] < v[2] &&
    v[1] < v[3]
  );
}

function mergeBboxes(bboxes: [number, number, number, number][]): [number, number, number, number] {
  return bboxes.reduce<[number, number, number, number]>(
    ([west, south, east, north], [w, s, e, n]) => [Math.min(west, w), Math.min(south, s), Math.max(east, e), Math.max(north, n)],
    [Infinity, Infinity, -Infinity, -Infinity]
  );
}

function isScoredRouteLike(v: unknown): v is ScoredRoute {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.alt === "object" &&
    r.alt !== null &&
    Array.isArray(r.samples) &&
    typeof r.timeScore === "number"
  );
}

export async function POST(request: NextRequest) {
  let routes: ScoredRoute[];
  let targetBboxes: [number, number, number, number][];
  try {
    const body = await request.json();
    if (!Array.isArray(body.routes) || !body.routes.every(isScoredRouteLike)) {
      return NextResponse.json({ status: "error", message: "Missing or invalid 'routes'" }, { status: 400 });
    }
    if (!Array.isArray(body.targetBboxes) || !body.targetBboxes.every(isBbox)) {
      return NextResponse.json({ status: "error", message: "Missing or invalid 'targetBboxes'" }, { status: 400 });
    }
    if (body.targetBboxes.length === 0) {
      return NextResponse.json({ status: "error", message: "'targetBboxes' is empty — nothing to analyze" }, { status: 400 });
    }
    if (body.targetBboxes.length > MAX_BBOXES_PER_REQUEST) {
      return NextResponse.json(
        { status: "error", message: `Too many uncovered stretches (${body.targetBboxes.length}) — max ${MAX_BBOXES_PER_REQUEST} per request` },
        { status: 400 }
      );
    }
    routes = body.routes;
    targetBboxes = body.targetBboxes;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON body" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const newTiles: HeatTileRecord[] = [];

    // Exactly one FortyGuard submission for this whole click — see header
    // comment. The merged bbox may cover a bit more than the uncovered
    // stretches strictly needed (it also spans the gaps between them), but
    // that's the deliberate tradeoff for a deterministic, single credit spend.
    const mergedBbox = mergeBboxes(targetBboxes);
    const bboxPolygon = turf.bboxPolygon(mergedBbox);
    const geometry = bboxPolygon.geometry as Polygon;
    const areaM2 = turf.area(geometry);
    if (areaM2 / 1_000_000 > MAX_AOI_AREA_SQKM) {
      return NextResponse.json(
        { status: "error", message: `The combined uncovered area exceeds the ${MAX_AOI_AREA_SQKM} km² analysis limit` },
        { status: 400 }
      );
    }

    const granularity = pickGranularity(areaM2);
    // Whole-day (filter_type 3), no hourOffset — route scoring has no
    // forecast-slot concept, it wants current-ish conditions for the area.
    const { result } = await runHeatmapWithDateFallback({
      aoiGeometry: geometry,
      startDate: today,
      filterType: 3,
      granularity,
    });

    for (const feature of result.map_data.features) {
      const ring = feature.geometry.coordinates[0];
      const c = centroidOfRing(ring);
      newTiles.push({ lat: c.lat, lng: c.lng, tempC: feature.properties.average_temperature, bounds: boundsOfRing(ring) });
    }

    // A single synthetic pool for the newly-probed tiles — this is a one-off
    // route-scoring probe, never written to the `sites` table as a saved site.
    const probePool: CoverageTilePool[] = [{ id: "route-analyze-probe", heatTiles: newTiles }];

    const rescored = routes.map((route) => {
      const samples = route.samples.map((s) => {
        if (s.coverage.status === "covered") return s;
        const hit = nearestTileTemp({ lng: s.lng, lat: s.lat }, probePool);
        return hit
          ? { ...s, coverage: { status: "covered" as const, tempC: hit.tempC, sourceSiteId: hit.sourceSiteId } }
          : s;
      });
      const coverage = buildRouteCoverage(samples);
      const heatExposureScore = computeHeatExposureScore(samples);
      return { alt: route.alt, samples, coverage, heatExposureScore, timeScore: route.timeScore };
    });

    const efficiencyScores = computeEfficiencyScores(rescored);
    const withEfficiency = rescored.map((r, i) => ({ ...r, efficiencyScore: efficiencyScores[i] }));
    const labelSets = assignRouteLabels(withEfficiency);

    const updatedRoutes: ScoredRoute[] = withEfficiency.map((r, i) => ({
      alt: r.alt,
      samples: r.samples,
      coverage: r.coverage,
      heatExposureScore: r.heatExposureScore,
      timeScore: r.timeScore,
      efficiencyScore: r.efficiencyScore,
      labels: Array.from(labelSets[i]),
    }));

    return NextResponse.json({ status: "ok", routes: updatedRoutes, disclosure: ROUTE_DISCLOSURE_TEXT });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Heat analysis failed" },
      { status: 502 }
    );
  }
}
