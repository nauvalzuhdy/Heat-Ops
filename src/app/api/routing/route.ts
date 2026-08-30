// §4.5 Phase 1 — always automatic, always free. Fetches OSRM route
// alternatives and scores them ONLY against heat_tiles from already-analyzed
// sites that overlap the route. This file's import graph deliberately never
// touches lib/fortyguard.ts — that's the structural guarantee that Phase 1
// can never spend FortyGuard credit. Submitting a NEW FortyGuard analysis for
// uncovered stretches only ever happens in api/routing/analyze/route.ts,
// triggered by an explicit user click (RoutePanel.tsx's "Analyze heat for
// uncovered routes" button) — never here, never automatically.
import { NextRequest, NextResponse } from "next/server";
import * as turf from "@turf/turf";
import { fetchOSRMAlternatives } from "@/lib/routing/osrm";
import { sampleRouteLine } from "@/lib/routing/sampling";
import { fetchSitesForRouteCoverage, findOverlappingSites } from "@/lib/routing/coverage";
import { scoreSamples, buildRouteCoverage, computeHeatExposureScore, computeEfficiencyScores, assignRouteLabels } from "@/lib/routing/scoring";
import { ROUTE_DISCLOSURE_TEXT, type ScoredRoute } from "@/lib/routing/types";

function isLngLat(v: unknown): v is [number, number] {
  return (
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number" &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    v[0] >= -180 &&
    v[0] <= 180 &&
    v[1] >= -90 &&
    v[1] <= 90
  );
}

export async function POST(request: NextRequest) {
  let origin: [number, number];
  let destination: [number, number];
  try {
    const body = await request.json();
    if (!isLngLat(body.origin) || !isLngLat(body.destination)) {
      return NextResponse.json(
        { status: "error", message: "Missing or invalid 'origin'/'destination' (expected [lng, lat] each)" },
        { status: 400 }
      );
    }
    origin = body.origin;
    destination = body.destination;
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const osrmResult = await fetchOSRMAlternatives(origin, destination);
    if (!osrmResult.ok) {
      return NextResponse.json({ status: "error", message: osrmResult.message }, { status: 502 });
    }

    const sites = await fetchSitesForRouteCoverage();

    const partial = osrmResult.alternatives.map((alt) => {
      const routeLine = turf.lineString(alt.geometry.coordinates);
      const pool = findOverlappingSites(routeLine, sites);
      const rawSamples = sampleRouteLine(alt.geometry);
      const samples = scoreSamples(rawSamples, pool);
      const coverage = buildRouteCoverage(samples);
      const heatExposureScore = computeHeatExposureScore(samples);
      return { alt, samples, coverage, heatExposureScore, timeScore: alt.durationS };
    });

    const efficiencyScores = computeEfficiencyScores(partial);
    const withEfficiency = partial.map((r, i) => ({ ...r, efficiencyScore: efficiencyScores[i] }));
    const labelSets = assignRouteLabels(withEfficiency);

    const routes: ScoredRoute[] = withEfficiency.map((r, i) => ({
      alt: r.alt,
      samples: r.samples,
      coverage: r.coverage,
      heatExposureScore: r.heatExposureScore,
      timeScore: r.timeScore,
      efficiencyScore: r.efficiencyScore,
      labels: Array.from(labelSets[i]),
    }));

    return NextResponse.json({ status: "ok", routes, disclosure: ROUTE_DISCLOSURE_TEXT });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Routing failed" },
      { status: 502 }
    );
  }
}
