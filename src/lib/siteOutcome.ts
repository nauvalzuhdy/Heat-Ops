// Headline outcome line — the single "current state → recommended action →
// measurable delta" sentence for one site.
//
// Why this module exists: every number below ALREADY existed in this codebase,
// but only ever as an editable form field (RoiPanel.tsx's scenario inputs) or a
// per-slot table row (ShiftSchedulePanel.tsx). Nowhere did the product state a
// single attributable outcome — "this site is X hot, doing Y buys you Z°C" —
// which is the one sentence a site operator (and a hackathon judge) actually
// quotes. This assembles that sentence; it introduces NO new model, constant,
// or formula.
//
// Pure and dependency-free of any server module (no "server-only", no Supabase,
// no fetch) — deliberately, because both renderers need it:
//   - components/analyst/OutcomeBanner.tsx (client, under AnalystTabsShell)
//   - lib/pdf/SiteReportDocument.tsx        (server, via lib/reportData.ts)
// Same "compute once, reuse" rule lib/heatmapUtils.ts and lib/reportData.ts
// already follow: the dashboard and the PDF must never be able to print a
// different headline for the same site.
//
// The ROI half mirrors lib/reportData.ts's RoiSnapshot assembly EXACTLY (same
// saved-scenario fallback, same best/worst-case pair run at the two ends of the
// researched canopy-cooling range) rather than deriving a second, slightly
// different scenario — see buildSiteOutcome()'s comments.
import {
  binTilesToZones,
  zoneLabel,
  type HotspotZone,
} from "./heatmapUtils";
import {
  buildHeatMitigationRecommendation,
  CANOPY_AREA_PER_TREE_M2,
  type HeatMitigationRecommendation,
} from "./heatMitigationRecommendation";
import {
  simulateROI,
  estimateCanopyAddedPct,
  estimateCanopyCoolingRangeC,
  DEFAULT_ROI_INPUTS,
  CANOPY_COOLING_VALIDATED_MAX_PCT,
  type ROIInputs,
} from "./roiSimulator";
import {
  overallShiftRisk,
  NIOSH_REL_WBGT_C,
  DEFAULT_WORKLOAD,
  WORKLOAD_LABEL,
  ACCLIMATIZATION_LABEL,
  type ForecastTimelineSlot,
  type ShiftRisk,
} from "./wbgt";
import type { HeatTileRecord, SiteLandcover, SiteLandcoverSpotcheck } from "./siteRecord";

// ---------------------------------------------------------------------------
// Locale-independent number formatting.
//
// NOT Number.prototype.toLocaleString(): OutcomeBanner.tsx renders inside a
// "use client" tree that Next.js still server-renders once before hydrating,
// so a locale-resolved grouping separator can differ between Node and the
// browser and trip a hydration mismatch — the identical reasoning lib/wbgt.ts
// applies to its date/time labels, and app/analyst/page.tsx to its
// createdAt labels. Fixed comma grouping is the same on both sides, always.
// ---------------------------------------------------------------------------
export function formatCount(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  const digits = String(Math.abs(rounded));
  return sign + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Compact USD for a headline: $1.2M / $84k / $940 — never a 9-digit wall of numerals. */
export function formatUsdCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${sign}$${formatCount(abs)}`;
}

/** Compact kWh for a headline: 1.2M / 62k / 940. Unit is added by the caller. */
export function formatKwhCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return formatCount(abs);
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** What this site measures like right now. Every field is null when unknown — never zero-as-unknown. */
export type OutcomeNow = {
  peakTempC: number | null;
  meanTempC: number | null;
  hottestZoneLabel: string | null;
  hottestZoneTempC: number | null;
  /** Hottest minus coolest zone mean — the spread that makes targeted shade worth more than even spreading. */
  zoneSpreadC: number | null;
};

/**
 * Worker-exposure summary over the captured forecast window. The denominator is
 * the number of slots FortyGuard actually returned, NOT the 5 slots that were
 * requested — reporting "1 of 5" when only 1 hour was ever captured would
 * understate the exposure by counting missing data as safe (data-honesty rule
 * 1: never fabricate a measurement, and never let an absent one read as a
 * benign one). null when nothing was captured at all.
 */
export type OutcomeExposure = {
  slotsAvailable: number;
  slotsOverLimit: number;
  worstRisk: ShiftRisk | null;
  /** NIOSH REL WBGT (°C) the count above is measured against — the unacclimatized limit for the default workload. */
  limitWbgtC: number;
  limitLabel: string;
};

export type OutcomeIntervention =
  | {
      status: "available";
      /** true = the operator's own saved ROI scenario; false = the recommendation-seeded default. */
      isSavedScenario: boolean;
      trees: number;
      canopyM2: number;
      solarKW: number;
      canopyAddedPct: number;
      /** Scenario adds more canopy than the source studies actually tested — disclosed, not silently applied. */
      beyondValidatedRange: boolean;
      /** Cooling range in °C, both ends positive magnitudes (the UI adds the minus sign). */
      coolingLowC: number;
      coolingHighC: number;
      kwhPerYearLow: number;
      kwhPerYearHigh: number;
      annualSavingsLowUSD: number;
      annualSavingsHighUSD: number;
      totalCostUSD: number;
      /** Shortest payback (high end of the cooling range). null = never breaks even. */
      paybackYearsFast: number | null;
      /** Longest payback (low end of the cooling range). null = never breaks even. */
      paybackYearsSlow: number | null;
    }
  | { status: "no_deficit"; currentTreeCanopyPct: number; targetTreeCanopyPct: number }
  | { status: "unavailable"; reason: string };

/** Provenance flags the headline must carry with it — a bold number from cached data is a lie without them. */
export type OutcomeProvenance = {
  heatSynthetic: boolean;
  heatUnavailable: boolean;
  canopySynthetic: boolean;
  fallbackDateUsed: string | null;
};

export type SiteOutcome = {
  now: OutcomeNow;
  exposure: OutcomeExposure | null;
  intervention: OutcomeIntervention;
  provenance: OutcomeProvenance;
  /** The recommendation this outcome was built from — exposed so callers don't rebuild it. */
  recommendation: HeatMitigationRecommendation;
};

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildNow(
  heatStats: { avgTempC: number; maxTempC: number } | null,
  zones: HotspotZone[],
): OutcomeNow {
  const withData = zones.filter((z) => z.meanTempC != null);
  const hottest = withData.find((z) => z.isHottest) ?? null;
  const temps = withData.map((z) => z.meanTempC as number);

  return {
    peakTempC: heatStats?.maxTempC ?? null,
    meanTempC: heatStats?.avgTempC ?? null,
    hottestZoneLabel: hottest ? zoneLabel(hottest.row, hottest.col) : null,
    hottestZoneTempC: hottest?.meanTempC ?? null,
    zoneSpreadC: temps.length >= 2 ? Math.max(...temps) - Math.min(...temps) : null,
  };
}

function buildExposure(timeline: ForecastTimelineSlot[]): OutcomeExposure | null {
  const captured = timeline.filter(
    (s): s is Extract<ForecastTimelineSlot, { available: true }> => s.available,
  );
  if (captured.length === 0) return null;

  // "Over limit" = anything classifyShiftRisk() did not call "safe", i.e. WBGT
  // above the NIOSH unacclimatized REL. Caution and Danger are both genuinely
  // above that limit — collapsing them into one count here is a headline
  // simplification, not a reclassification; Shift Schedule still shows the
  // three-tier breakdown per slot.
  return {
    slotsAvailable: captured.length,
    slotsOverLimit: captured.filter((s) => s.risk !== "safe").length,
    worstRisk: overallShiftRisk(captured.map((s) => s.risk)),
    limitWbgtC: NIOSH_REL_WBGT_C[DEFAULT_WORKLOAD].unacclimatized,
    limitLabel: `NIOSH REL, ${WORKLOAD_LABEL.toLowerCase()} work, ${ACCLIMATIZATION_LABEL.toLowerCase()}`,
  };
}

function buildIntervention(
  recommendation: HeatMitigationRecommendation,
  siteAreaM2: number | null,
  savedRoiInputs: ROIInputs | null,
): OutcomeIntervention {
  const areaM2 = siteAreaM2 ?? 0;
  if (areaM2 <= 0) {
    return {
      status: "unavailable",
      reason: "This site has no saved area, so no intervention can be sized against it.",
    };
  }

  const tree = recommendation.treeCanopy;
  const isSavedScenario = savedRoiInputs != null;

  // No saved scenario and nothing to recommend → say which of the two reasons
  // it is, rather than showing an empty scenario as if it were a result.
  if (!isSavedScenario && tree.status === "benchmark_met") {
    return {
      status: "no_deficit",
      currentTreeCanopyPct: tree.currentTreeCanopyPct,
      targetTreeCanopyPct: tree.targetTreeCanopyPct,
    };
  }
  if (!isSavedScenario && tree.status === "unavailable") {
    return { status: "unavailable", reason: tree.reason };
  }

  // Identical seeding to lib/reportData.ts's RoiSnapshot: the operator's saved
  // scenario when one exists, otherwise the defaults with numTrees taken from
  // this same recommendation. Not a second, parallel derivation.
  const inputs: ROIInputs =
    savedRoiInputs ??
    ({
      ...DEFAULT_ROI_INPUTS,
      numTrees: tree.status === "deficit" ? tree.recommendedTrees : 0,
    } satisfies ROIInputs);

  if (inputs.numTrees <= 0 && inputs.canopyM2 <= 0 && inputs.solarKW <= 0) {
    return {
      status: "unavailable",
      reason: "This site's saved scenario is empty — add trees, canopy, or solar in the Heat Mitigation Planner.",
    };
  }

  const canopyAddedPct = estimateCanopyAddedPct(inputs, areaM2, CANOPY_AREA_PER_TREE_M2);
  // Same fallback the dashboard and the PDF already use: a scenario with no
  // canopy at all (solar-only) has no canopy basis to index cooling to, so it
  // falls back to the flat EPA-cited figure already sitting in the inputs.
  const cooling =
    canopyAddedPct > 0
      ? estimateCanopyCoolingRangeC(canopyAddedPct)
      : { lowC: inputs.expectedCoolingC, highC: inputs.expectedCoolingC };

  const best = simulateROI({ ...inputs, expectedCoolingC: cooling.highC }, areaM2);
  const worst = simulateROI({ ...inputs, expectedCoolingC: cooling.lowC }, areaM2);

  return {
    status: "available",
    isSavedScenario,
    trees: inputs.numTrees,
    canopyM2: inputs.canopyM2,
    solarKW: inputs.solarKW,
    canopyAddedPct,
    beyondValidatedRange: canopyAddedPct > CANOPY_COOLING_VALIDATED_MAX_PCT,
    coolingLowC: cooling.lowC,
    coolingHighC: cooling.highC,
    kwhPerYearLow: worst.estimatedKwhSavedPerYear,
    kwhPerYearHigh: best.estimatedKwhSavedPerYear,
    annualSavingsLowUSD: worst.annualSavingsUSD,
    annualSavingsHighUSD: best.annualSavingsUSD,
    totalCostUSD: best.totalCost,
    // More cooling → more kWh → faster payback, so `best` is the fast end.
    paybackYearsFast: best.paybackYears,
    paybackYearsSlow: worst.paybackYears,
  };
}

export function buildSiteOutcome(input: {
  siteAreaM2: number | null;
  landcover: SiteLandcover | null;
  landcoverSpotcheck: SiteLandcoverSpotcheck | null;
  heatTiles: HeatTileRecord[] | null;
  heatStats: { avgTempC: number; maxTempC: number; isFallbackDate?: boolean; dateUsed?: string } | null;
  attribution: { landcover_spotcheck: string; heat: string } | null;
  bbox: [number, number, number, number] | null;
  forecastTimeline: ForecastTimelineSlot[];
  savedRoiInputs: ROIInputs | null;
}): SiteOutcome {
  const recommendation = buildHeatMitigationRecommendation({
    siteAreaM2: input.siteAreaM2,
    landcover: input.landcover,
    landcoverSpotcheck: input.landcoverSpotcheck,
    heatTiles: input.heatTiles,
    bbox: input.bbox,
  });

  const zones =
    input.heatTiles && input.heatTiles.length > 0 && input.bbox
      ? binTilesToZones(input.heatTiles, input.bbox)
      : [];

  return {
    now: buildNow(input.heatStats, zones),
    exposure: buildExposure(input.forecastTimeline),
    intervention: buildIntervention(recommendation, input.siteAreaM2, input.savedRoiInputs),
    provenance: {
      heatSynthetic: input.attribution?.heat === "synthetic",
      heatUnavailable: input.attribution?.heat === "unavailable" || input.heatStats == null,
      canopySynthetic:
        recommendation.treeCanopy.status !== "unavailable" && recommendation.treeCanopy.dataSynthetic,
      fallbackDateUsed:
        input.heatStats?.isFallbackDate && input.heatStats.dateUsed ? input.heatStats.dateUsed : null,
    },
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Wording — one source for both renderers
//
// The banner and the PDF must say the SAME words, not merely use the same
// numbers, so the phrasing lives here rather than being retyped in two JSX
// trees. Each segment comes back separately so each renderer can style them
// differently (the banner emphasizes the delta; the PDF sets it in its own
// type scale) without either one paraphrasing the other.
// ---------------------------------------------------------------------------

// Character-set constraint, load-bearing: these strings are printed by
// lib/pdf/SiteReportDocument.tsx through @react-pdf/renderer's built-in
// Helvetica, which is limited to WinAnsi encoding. A true minus sign
// (U+2212) and "almost equal to" (U+2248) are NOT in WinAnsi and would
// silently drop or render as garbage in the PDF while looking fine in the
// browser. So the reduction is written with an ASCII hyphen and the
// approximation with an ASCII tilde; ranges use an en dash (U+2013, which
// IS in WinAnsi) so a range separator can never be misread as the minus.
// Degree, middle dot, and em/en dashes are all WinAnsi and stay as-is -
// the same constraint the rest of that PDF file already respects.
export type OutcomeSegments = {
  /** "Peak 41.2°C · hottest zone Southeast at 39.8°C" */
  now: string;
  /** "3 of 5 captured forecast hours exceed the NIOSH heat limit" — null when nothing captured. */
  exposure: string | null;
  /** "+1,240 trees (+18.2% canopy cover)" — null when there's no scenario to state. */
  action: string | null;
  /** "-0.5 to -1.4°C" — THE measurable delta. null when there's no scenario. */
  delta: string | null;
  /** "~62k kWh/yr · $8.4k invested · payback 7.3–19.6 yrs" — null when there's no scenario. */
  economics: string | null;
  /** Why there's no action/delta, when there isn't one. */
  interventionNote: string | null;
};

function formatPaybackRange(fast: number | null, slow: number | null): string {
  if (fast === null && slow === null) return "does not break even";
  if (fast === null || slow === null) {
    const known = (fast ?? slow) as number;
    return `payback from ${known.toFixed(1)} yrs (may not break even at the low end)`;
  }
  if (Math.abs(fast - slow) < 0.05) return `payback ${fast.toFixed(1)} yrs`;
  return `payback ${fast.toFixed(1)}–${slow.toFixed(1)} yrs`;
}

export function formatOutcomeSegments(o: SiteOutcome): OutcomeSegments {
  const nowParts: string[] = [];
  if (o.now.peakTempC != null) nowParts.push(`Peak ${o.now.peakTempC.toFixed(1)}°C`);
  if (o.now.hottestZoneLabel && o.now.hottestZoneTempC != null) {
    nowParts.push(`hottest zone ${o.now.hottestZoneLabel} at ${o.now.hottestZoneTempC.toFixed(1)}°C`);
  }
  const now = nowParts.length > 0 ? nowParts.join(" · ") : "No saved heat measurements for this site";

  const exposure = o.exposure
    ? o.exposure.slotsOverLimit > 0
      ? `${o.exposure.slotsOverLimit} of ${o.exposure.slotsAvailable} captured forecast ` +
        `${o.exposure.slotsAvailable === 1 ? "hour" : "hours"} exceed the NIOSH heat limit`
      : `all ${o.exposure.slotsAvailable} captured forecast ` +
        `${o.exposure.slotsAvailable === 1 ? "hour" : "hours"} stay within the NIOSH heat limit`
    : null;

  if (o.intervention.status === "no_deficit") {
    return {
      now,
      exposure,
      action: null,
      delta: null,
      economics: null,
      interventionNote:
        `Tree canopy is already at ${o.intervention.currentTreeCanopyPct.toFixed(1)}%, at or above the ` +
        `${o.intervention.targetTreeCanopyPct}% planning benchmark — no canopy deficit to close.`,
    };
  }
  if (o.intervention.status === "unavailable") {
    return { now, exposure, action: null, delta: null, economics: null, interventionNote: o.intervention.reason };
  }

  const iv = o.intervention;
  const actionParts: string[] = [];
  if (iv.trees > 0) actionParts.push(`+${formatCount(iv.trees)} trees`);
  if (iv.canopyM2 > 0) actionParts.push(`+${formatCount(iv.canopyM2)} m² canopy`);
  if (iv.solarKW > 0) actionParts.push(`+${formatCount(iv.solarKW)} kW solar`);
  const action =
    iv.canopyAddedPct > 0
      ? `${actionParts.join(" · ")} (+${iv.canopyAddedPct.toFixed(1)}% canopy cover)`
      : actionParts.join(" · ");

  const delta =
    Math.abs(iv.coolingHighC - iv.coolingLowC) < 0.05
      ? `-${iv.coolingLowC.toFixed(1)}°C`
      : `-${iv.coolingLowC.toFixed(1)} to -${iv.coolingHighC.toFixed(1)}°C`;

  const kwh =
    Math.abs(iv.kwhPerYearHigh - iv.kwhPerYearLow) < 1
      ? `~${formatKwhCompact(iv.kwhPerYearLow)} kWh/yr`
      : `~${formatKwhCompact(iv.kwhPerYearLow)}–${formatKwhCompact(iv.kwhPerYearHigh)} kWh/yr`;
  const economics = `${kwh} · ${formatUsdCompact(iv.totalCostUSD)} invested · ${formatPaybackRange(iv.paybackYearsFast, iv.paybackYearsSlow)}`;

  return { now, exposure, action, delta, economics, interventionNote: null };
}

/**
 * One plain-text line. Used where styled segments aren't possible (the PDF's
 * AI narrative prompt, and any Copilot answer that wants the headline) so those
 * surfaces quote the dashboard's own sentence instead of inventing one.
 */
export function formatOutcomeSentence(o: SiteOutcome): string {
  const s = formatOutcomeSegments(o);
  const first = [s.now, s.exposure].filter(Boolean).join(" · ");
  if (!s.action || !s.delta) {
    return s.interventionNote ? `${first}. ${s.interventionNote}` : `${first}.`;
  }
  return `${first}. Recommended: ${s.action} → ${s.delta} estimated cooling, ${s.economics}.`;
}
