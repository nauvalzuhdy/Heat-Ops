// Heat Mitigation Planner — deterministic, non-LLM recommendation engine
// (project.md §5, Sub-task 4 revision). Deliberately structured as
// site data -> normalized metrics -> intervention rules -> recommended
// scenario, kept separate from presentation (components/analyst/RoiPanel.tsx
// is the only consumer). No LLM call anywhere in this file — every number is
// a plain arithmetic rule over data the site already has saved.
//
// Supersedes lib/interventionRecommendation.ts (deleted), which conflated
// Overpass's general "vegetation" land-cover tag with tree-specific canopy
// cover. Fixed here: tree canopy and general green coverage are tracked as
// two separate metrics, and only the tree-specific one feeds the canopy
// recommendation — see extractTreeCanopyPct() below.

import type { HeatTileRecord } from "./siteRecord";
import { binTilesToZones } from "./heatmapUtils";

// ---------------------------------------------------------------------------
// Disclosed assumptions (unchanged values from the original Sub-task 4 part 1
// heuristic — only their data source changed, not the numbers themselves).
// ---------------------------------------------------------------------------

// U.S. urban forestry plans commonly cite canopy targets in the 15-40% range
// depending on climate; 25% is used as a general, round, middle-of-range
// benchmark — not climate- or site-specific.
export const TARGET_TREE_CANOPY_PCT = 25;

// Canopy area of one typical medium-maturity shade tree (~5m diameter ->
// pi*(2.5m)^2 ~= 19.6 m^2, rounded to 20) — a planning-grade rule of thumb,
// not a specific species or a mature old-growth tree.
export const CANOPY_AREA_PER_TREE_M2 = 20;

export const HEAT_MITIGATION_ASSUMPTIONS_TEXT =
  `Target tree-canopy cover: ${TARGET_TREE_CANOPY_PCT}% of site area — a general round-number benchmark drawn from ` +
  `the range U.S. urban forestry plans commonly cite (roughly 15% for arid cities up to 40% for wetter ones), not a ` +
  `climate- or site-specific target. Canopy per tree: ${CANOPY_AREA_PER_TREE_M2} m² — a planning-grade rule of ` +
  `thumb for one medium-maturity shade tree (~5m canopy diameter); actual canopy size varies by species, spacing, ` +
  `and tree age. This is a rough heuristic to seed a starting scenario, not a certified planting or engineering plan.`;

// ---------------------------------------------------------------------------
// Step 1 — normalize raw site fields (as already saved on a `sites` row)
// into clean, separately-tracked metrics. Structural typing only (no import
// of components/analyst/types.ts) so this stays a plain, dependency-free lib
// module — the caller just needs an object shaped like this.
// ---------------------------------------------------------------------------

export type SiteMetrics = {
  siteAreaM2: number | null;

  /** FortyGuard satellite segmentation's "Tree" class only — never Overpass's general vegetation tag. */
  treeCanopyPct: number | null;
  treeCanopySynthetic: boolean;
  /** Why treeCanopyPct is null, when it is — surfaced to the user rather than silently omitted. */
  treeCanopyUnavailableReason: string | null;

  /** Overpass, AOI-wide, real (clipped to the drawn boundary) — but NOT tree-specific (trees+grass+parks combined). */
  greenCoveragePct: number | null;

  buildingPct: number | null;
  buildingAreaM2: number | null;

  /** Share of this AOI's captured heat tiles falling in Hotspot Detection's Critical/High zones, scaled to real area. */
  hotspotAreaM2: number | null;
  hotspotFractionOfTiles: number | null;
  hottestZoneTempC: number | null;
  coolestZoneTempC: number | null;
};

function extractTreeCanopyPct(segments: Record<string, number> | undefined): number | null {
  if (!segments) return null;
  for (const [cls, pct] of Object.entries(segments)) {
    if (cls.trim().toLowerCase() === "tree") return pct;
  }
  return null;
}

function computeHotspotMetrics(
  tiles: HeatTileRecord[] | null,
  bbox: [number, number, number, number] | null,
  siteAreaM2: number | null,
): Pick<SiteMetrics, "hotspotAreaM2" | "hotspotFractionOfTiles" | "hottestZoneTempC" | "coolestZoneTempC"> {
  const empty = { hotspotAreaM2: null, hotspotFractionOfTiles: null, hottestZoneTempC: null, coolestZoneTempC: null };
  if (!tiles || tiles.length === 0 || !bbox || siteAreaM2 == null) return empty;

  const zones = binTilesToZones(tiles, bbox);
  const withData = zones.filter((z) => z.meanTempC != null);
  if (withData.length === 0) return empty;

  const totalTiles = withData.reduce((sum, z) => sum + z.tileCount, 0);
  const hotspotTiles = withData
    .filter((z) => z.level === "critical" || z.level === "high")
    .reduce((sum, z) => sum + z.tileCount, 0);
  const fraction = totalTiles > 0 ? hotspotTiles / totalTiles : 0;
  const temps = withData.map((z) => z.meanTempC as number);

  return {
    hotspotAreaM2: siteAreaM2 * fraction,
    hotspotFractionOfTiles: fraction,
    hottestZoneTempC: Math.max(...temps),
    coolestZoneTempC: Math.min(...temps),
  };
}

export function deriveSiteMetrics(input: {
  siteAreaM2: number | null;
  landcover: { buildingPct: number; vegetationPct: number } | null;
  landcoverSpotcheck: { segments: Record<string, number>; synthetic: boolean } | null;
  heatTiles: HeatTileRecord[] | null;
  bbox: [number, number, number, number] | null;
}): SiteMetrics {
  const treeCanopyPct = extractTreeCanopyPct(input.landcoverSpotcheck?.segments);

  let treeCanopyUnavailableReason: string | null = null;
  if (treeCanopyPct == null) {
    treeCanopyUnavailableReason = input.landcoverSpotcheck
      ? `FortyGuard's satellite segmentation for this site didn't return a distinct "Tree" class, so tree-specific ` +
        `canopy % can't be estimated — general green coverage is shown separately below, but isn't used for this ` +
        `recommendation.`
      : `FortyGuard satellite segmentation isn't available for this site yet — re-analyze it in Map View to get a ` +
        `tree-canopy estimate.`;
  } else if (input.siteAreaM2 == null) {
    treeCanopyUnavailableReason = "Site area isn't available for this site.";
  }

  const buildingAreaM2 =
    input.landcover != null && input.siteAreaM2 != null ? input.siteAreaM2 * (input.landcover.buildingPct / 100) : null;

  const hotspot = computeHotspotMetrics(input.heatTiles, input.bbox, input.siteAreaM2);

  return {
    siteAreaM2: input.siteAreaM2,
    treeCanopyPct,
    treeCanopySynthetic: Boolean(input.landcoverSpotcheck?.synthetic),
    treeCanopyUnavailableReason,
    greenCoveragePct: input.landcover?.vegetationPct ?? null,
    buildingPct: input.landcover?.buildingPct ?? null,
    buildingAreaM2,
    ...hotspot,
  };
}

// ---------------------------------------------------------------------------
// Step 2 — intervention rules. Trees and Canopy area are evaluated together
// (they express the SAME deficit in two units, not two additive
// interventions — see recommendedCanopyM2's doc below). Solar is evaluated
// separately and, in this build, never gets an auto-generated number — see
// recommendSolar().
// ---------------------------------------------------------------------------

export type TreeCanopyRecommendation =
  | {
      status: "deficit";
      currentTreeCanopyPct: number;
      targetTreeCanopyPct: number;
      deficitPct: number;
      deficitAreaM2: number;
      /** Trees needed to close the gap on their own. */
      recommendedTrees: number;
      /**
       * Canopy area needed to close the SAME gap, expressed in m² instead of
       * tree count (recommendedCanopyM2 === Math.round(deficitAreaM2)) — an
       * alternative unit for one recommendation, not a second, additive
       * intervention. Applying both recommendedTrees AND recommendedCanopyM2
       * into the ROI form at once would double-count this deficit.
       */
      recommendedCanopyM2: number;
      dataSynthetic: boolean;
    }
  | { status: "benchmark_met"; currentTreeCanopyPct: number; targetTreeCanopyPct: number; dataSynthetic: boolean }
  | { status: "unavailable"; reason: string };

export type SolarRecommendation = { status: "custom_scenario"; reason: string };

function recommendTreeCanopy(metrics: SiteMetrics): TreeCanopyRecommendation {
  if (metrics.treeCanopyPct == null || metrics.siteAreaM2 == null) {
    return { status: "unavailable", reason: metrics.treeCanopyUnavailableReason ?? "Insufficient site data." };
  }

  const deficitPct = TARGET_TREE_CANOPY_PCT - metrics.treeCanopyPct;
  if (deficitPct <= 0) {
    return {
      status: "benchmark_met",
      currentTreeCanopyPct: metrics.treeCanopyPct,
      targetTreeCanopyPct: TARGET_TREE_CANOPY_PCT,
      dataSynthetic: metrics.treeCanopySynthetic,
    };
  }

  const deficitAreaM2 = metrics.siteAreaM2 * (deficitPct / 100);
  const recommendedTrees = Math.max(1, Math.ceil(deficitAreaM2 / CANOPY_AREA_PER_TREE_M2));

  return {
    status: "deficit",
    currentTreeCanopyPct: metrics.treeCanopyPct,
    targetTreeCanopyPct: TARGET_TREE_CANOPY_PCT,
    deficitPct,
    deficitAreaM2,
    recommendedTrees,
    recommendedCanopyM2: Math.round(deficitAreaM2),
    dataSynthetic: metrics.treeCanopySynthetic,
  };
}

// Solar always stays "custom_scenario": sizing a defensible kW recommendation
// needs a usable-roof-area basis (roof area x usable-fraction x panel power
// density) that this build has no data source for — `landcover.buildingPct`
// is footprint area, not usable roof area, and no panel-density constant has
// been sourced/confirmed. Fabricating one from heat data alone (e.g. "hotter
// site -> more solar") would have no real basis, so this is deliberately left
// as a pass-through rather than invented.
function recommendSolar(): SolarRecommendation {
  return {
    status: "custom_scenario",
    reason:
      "No defensible roof-area/usable-roof-fraction/panel-density basis is available in this build to size a solar " +
      "recommendation — solar capacity stays a custom, user-entered scenario rather than an auto-generated number.",
  };
}

function buildExplanation(metrics: SiteMetrics, tree: TreeCanopyRecommendation): string[] {
  const lines: string[] = [];

  if (tree.status === "deficit") {
    lines.push(
      `Tree canopy is estimated at ${tree.currentTreeCanopyPct.toFixed(1)}% (FortyGuard satellite spot-check at the ` +
        `AOI centroid${tree.dataSynthetic ? ", cached/synthetic" : ""}), below the ${tree.targetTreeCanopyPct}% ` +
        `planning benchmark used here — leaving an estimated ${Math.round(tree.deficitAreaM2).toLocaleString()} m² ` +
        `canopy gap across the analyzed area.`,
    );
  } else if (tree.status === "benchmark_met") {
    lines.push(
      `Existing tree canopy (${tree.currentTreeCanopyPct.toFixed(1)}%) already meets or exceeds the ` +
        `${tree.targetTreeCanopyPct}% planning benchmark used here — no canopy deficit detected.`,
    );
  } else {
    lines.push(tree.reason);
  }

  if (metrics.hotspotAreaM2 != null && metrics.hottestZoneTempC != null && metrics.coolestZoneTempC != null) {
    const spread = metrics.hottestZoneTempC - metrics.coolestZoneTempC;
    if (spread > 0.5) {
      lines.push(
        `The hottest zone in this AOI averages ${metrics.hottestZoneTempC.toFixed(1)}°C, ${spread.toFixed(1)}°C above ` +
          `the coolest zone (${Math.round(metrics.hotspotAreaM2).toLocaleString()} m² classified as a heat hotspot ` +
          `by Hotspot Detection's zone grid) — prioritizing shade toward the hottest areas may deliver more cooling ` +
          `benefit per tree than spreading them evenly. This is informational context, not part of the numeric ` +
          `formula above.`,
      );
    }
  }

  return lines;
}

export type HeatMitigationRecommendation = {
  metrics: SiteMetrics;
  treeCanopy: TreeCanopyRecommendation;
  solar: SolarRecommendation;
  explanation: string[];
};

export function buildHeatMitigationRecommendation(input: {
  siteAreaM2: number | null;
  landcover: { buildingPct: number; vegetationPct: number } | null;
  landcoverSpotcheck: { segments: Record<string, number>; synthetic: boolean } | null;
  heatTiles: HeatTileRecord[] | null;
  bbox: [number, number, number, number] | null;
}): HeatMitigationRecommendation {
  const metrics = deriveSiteMetrics(input);
  const treeCanopy = recommendTreeCanopy(metrics);
  const solar = recommendSolar();
  const explanation = buildExplanation(metrics, treeCanopy);
  return { metrics, treeCanopy, solar, explanation };
}
