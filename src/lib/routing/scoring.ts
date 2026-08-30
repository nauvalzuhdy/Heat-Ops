// §4.5 — pure scoring math: sample -> temperature lookup, coverage
// bookkeeping, normalize-then-combine efficiency score, and label assignment.
// No server-only marker (pure functions, no I/O) — imported by both API
// routes.
import * as turf from "@turf/turf";
import { nearestTileTemp, type CoverageTilePool } from "./coverage";
import type { RouteSamplePoint } from "./sampling";
import type { RouteCoverage, SampledPoint } from "./types";

const UNCOVERED_BBOX_BUFFER_KM = 0.15;

export function scoreSamples(samples: RouteSamplePoint[], pool: CoverageTilePool[]): SampledPoint[] {
  return samples.map((s) => {
    const hit = nearestTileTemp({ lng: s.lng, lat: s.lat }, pool);
    return {
      lng: s.lng,
      lat: s.lat,
      distanceAlongM: s.distanceAlongM,
      coverage: hit ? { status: "covered" as const, tempC: hit.tempC, sourceSiteId: hit.sourceSiteId } : { status: "uncovered" as const },
    };
  });
}

export function buildRouteCoverage(samples: SampledPoint[]): RouteCoverage {
  const totalCount = samples.length;
  const coveredCount = samples.filter((s) => s.coverage.status === "covered").length;

  // Group CONSECUTIVE uncovered samples into runs, each becoming one
  // buffered bbox — Phase 2 submits a FortyGuard request per bbox, not one
  // per uncovered point.
  const uncoveredBboxes: [number, number, number, number][] = [];
  let run: SampledPoint[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    const coords = run.map((p): [number, number] => [p.lng, p.lat]);
    const feature = coords.length >= 2 ? turf.lineString(coords) : turf.point(coords[0]);
    const buffered = turf.buffer(feature, UNCOVERED_BBOX_BUFFER_KM, { units: "kilometers" });
    if (buffered) uncoveredBboxes.push(turf.bbox(buffered) as [number, number, number, number]);
    run = [];
  };
  for (const s of samples) {
    if (s.coverage.status === "uncovered") run.push(s);
    else flushRun();
  }
  flushRun();

  return {
    coveredCount,
    totalCount,
    fullyCovered: totalCount > 0 && coveredCount === totalCount,
    uncoveredBboxes,
  };
}

export function computeHeatExposureScore(samples: SampledPoint[]): number | null {
  const coveredTemps = samples
    .map((s) => (s.coverage.status === "covered" ? s.coverage.tempC : null))
    .filter((t): t is number => t != null);
  if (coveredTemps.length === 0) return null;
  return coveredTemps.reduce((a, b) => a + b, 0) / coveredTemps.length;
}

export function computeEfficiencyScores(
  routes: { heatExposureScore: number | null; timeScore: number }[]
): (number | null)[] {
  const heatValues = routes.map((r) => r.heatExposureScore).filter((v): v is number => v != null);
  const maxHeat = heatValues.length > 0 ? Math.max(...heatValues) : 0;
  const maxTime = Math.max(...routes.map((r) => r.timeScore), 0);

  return routes.map((r) => {
    if (r.heatExposureScore == null) return null;
    const heatTerm = maxHeat > 0 ? r.heatExposureScore / maxHeat : 0;
    const timeTerm = maxTime > 0 ? r.timeScore / maxTime : 0;
    return heatTerm * 0.5 + timeTerm * 0.5;
  });
}

function argmin<T>(items: T[], value: (item: T) => number | null): number | null {
  let bestIdx: number | null = null;
  let bestVal = Infinity;
  items.forEach((item, i) => {
    const v = value(item);
    if (v != null && v < bestVal) {
      bestVal = v;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// One Set<string> per route index, not three separate single-index
// variables — a route can end up with 0-3 labels (fewer alternatives than
// labels means labels double up on the same route; the caller renders that
// as one combined badge, never a fabricated extra route).
export function assignRouteLabels(
  routes: { timeScore: number; heatExposureScore: number | null; efficiencyScore: number | null }[]
): Set<string>[] {
  const labels: Set<string>[] = routes.map(() => new Set<string>());

  const fastestIdx = argmin(routes, (r) => r.timeScore);
  if (fastestIdx != null) labels[fastestIdx].add("Fastest");

  const coolestIdx = argmin(routes, (r) => r.heatExposureScore);
  if (coolestIdx != null) labels[coolestIdx].add("Coolest");

  const efficientIdx = argmin(routes, (r) => r.efficiencyScore);
  if (efficientIdx != null) labels[efficientIdx].add("Efficient");

  return labels;
}
