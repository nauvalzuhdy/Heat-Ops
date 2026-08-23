// ROI Simulator (project.md §5.1). Formula and Definition of Done followed
// exactly as specified — not restructured. The one genuinely open question
// (§5.1's explicit warning: "ASSUMPTION_KWH_PER_M2_PER_DEGREE... wajib
// dicari basisnya... jangan biarkan angka ajaib tanpa sumber") was resolved
// with the user before this file was written, not guessed — see the
// disclosure text below and development.md for the full source list checked.

// ---------------------------------------------------------------------------
// kWh saved per m² of treated area per °C of cooling achieved. No published
// study reports this exact compound unit directly — confirmed by checking:
// EIA's 2018 CBECS (official U.S. commercial-building energy survey),
// USDA Forest Service (McPherson & Simpson, per-tree savings), and LBNL's
// Akbari & Konopacki (2005, Energy Policy 33:721-756, DOE-funded, peer-
// reviewed) — none report kWh/m²/°C as a single figure. This range is
// DERIVED, not directly measured: EIA CBECS 2018's hot-climate commercial
// cooling baseline (~14,200 Btu/sf/year ≈ 45 kWh/m²/year) combined with a
// general cooling-demand temperature sensitivity (~2.7–4% change per °C,
// consistent with the order of magnitude reported across multiple LBNL/
// utility heat-island demand studies, though no single primary source states
// this exact percentage cleanly enough to cite as one number). Confirmed
// with the user (not assumed silently) before use.
export const KWH_SAVED_PER_M2_PER_DEGREE_C = { low: 1.2, mid: 1.4, high: 1.6 } as const;

export const KWH_ASSUMPTION_SHORT_TEXT =
  `Estimated at ${KWH_SAVED_PER_M2_PER_DEGREE_C.mid} kWh saved per m² per °C of cooling ` +
  `(range ${KWH_SAVED_PER_M2_PER_DEGREE_C.low}–${KWH_SAVED_PER_M2_PER_DEGREE_C.high}) — a derived estimate, not a ` +
  `directly measured figure. Adjust it if you have your own energy-audit data for this site.`;

export const KWH_ASSUMPTION_METHODOLOGY_BULLETS: string[] = [
  "No single published study reports \"kWh saved per m² per °C\" directly — this figure is derived, not measured.",
  "Baseline: EIA's 2018 Commercial Buildings Energy Consumption Survey (CBECS) reports ~14,200 Btu/sf/year " +
    "(≈45 kWh/m²/year) for cooling in U.S. hot/very-hot climate zones — the official federal baseline this estimate scales from.",
  "Scaled using a general cooling-demand sensitivity to ambient temperature of roughly 2.7–4% change per °C, " +
    "consistent with the order of magnitude reported across multiple Lawrence Berkeley National Laboratory (LBNL) " +
    "heat-island energy-demand studies — no single primary source states this exact percentage precisely enough to " +
    "cite as one number, which is why this is shown as a range, not a single value.",
  "More directly measured, related figures exist per intervention type (not used directly in this formula, but " +
    "useful for sanity-checking): USDA Forest Service (McPherson & Simpson) reports 100–400 kWh/year savings per " +
    "well-placed shade tree; LBNL (Akbari & Konopacki, 2005, Energy Policy 33:721–756, DOE-funded) reports " +
    "650–1,500 kWh per 1,000 ft² annually from combined heat-island-reduction strategies in climates with >1,000 " +
    "cooling-degree-days (Phoenix and Houston both qualify).",
  "Treat this as a planning-grade estimate, not a certified energy audit. Replace it with your own utility or " +
    "energy-audit data if you have it for this site.",
];

// Expected temperature reduction from adding the canopy/shading intervention
// itself — a separate assumption from the kWh conversion above. EPA's
// "Reducing Urban Heat Islands: Compendium of Strategies" cites
// evapotranspiration and shading together reducing peak summer temperatures
// by roughly 2–9°F (1–5°C); 2°C is used as a conservative default within
// that cited range, not the midpoint or the optimistic end.
export const EXPECTED_COOLING_C_RANGE = { low: 1, high: 5 } as const;
export const DEFAULT_EXPECTED_COOLING_C = 2;
export const EXPECTED_COOLING_ASSUMPTION_TEXT =
  `Default expected cooling: ${DEFAULT_EXPECTED_COOLING_C}°C — a conservative pick within the ` +
  `${EXPECTED_COOLING_C_RANGE.low}–${EXPECTED_COOLING_C_RANGE.high}°C range EPA's heat-island mitigation guidance ` +
  `cites for combined shading and evapotranspiration effects. Actual cooling varies by intervention scale, ` +
  `placement, and local conditions — adjust if you have a better estimate for this site.`;

// U.S. average retail electricity price, commercial customers — EIA (Energy
// Information Administration), most recent reported average as of this
// writing (Aug 2026): 13.54¢/kWh. HeatOps targets industrial/commercial site
// operators (project.md §1), not residential, so the commercial rate is used
// as the default rather than the residential average. This is a national
// average, not this site's actual tariff — always editable, never presented
// as measured.
export const DEFAULT_ELECTRICITY_RATE_USD_PER_KWH = 0.1354;
export const ELECTRICITY_RATE_ASSUMPTION_TEXT =
  `Default: $${DEFAULT_ELECTRICITY_RATE_USD_PER_KWH.toFixed(4)}/kWh — the U.S. average commercial electricity ` +
  `rate (EIA). This is a national average, not this site's actual tariff — replace it with your real utility rate ` +
  `for an accurate estimate.`;

export const HORIZON_YEAR_OPTIONS = [5, 10, 20] as const;
export type HorizonYears = (typeof HORIZON_YEAR_OPTIONS)[number];

export type ROIInputs = {
  budgetUSD: number | null;
  numTrees: number;
  costPerTreeUSD: number;
  canopyM2: number;
  costPerCanopyM2USD: number;
  solarKW: number;
  costPerSolarKWUSD: number;
  electricityRateUSDPerKWh: number;
  expectedCoolingC: number;
  kwhPerM2PerDegreeC: number;
  horizonYears: HorizonYears;
};

// Sensible, disclosed starting defaults (project.md §5.1: "semua editable
// oleh user, dengan default value yang masuk akal"). `numTrees` is
// overridden by the caller with Sub-task 4 part 1's recommendation when one
// exists — see RoiPanel.tsx.
export const DEFAULT_ROI_INPUTS: ROIInputs = {
  budgetUSD: null,
  numTrees: 0,
  costPerTreeUSD: 225, // §5.1's own suggested example range is $150–300/tree
  canopyM2: 0,
  costPerCanopyM2USD: 50,
  solarKW: 0,
  costPerSolarKWUSD: 2500,
  electricityRateUSDPerKWh: DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
  expectedCoolingC: DEFAULT_EXPECTED_COOLING_C,
  kwhPerM2PerDegreeC: KWH_SAVED_PER_M2_PER_DEGREE_C.mid,
  horizonYears: 10,
};

export type ROIResult = {
  totalCost: number;
  estimatedKwhSavedPerYear: number;
  annualSavingsUSD: number;
  /** null = does not break even at all (zero or negative annual savings) — never NaN/Infinity. */
  paybackYears: number | null;
  /** true when totalCost <= 0 (nothing to break even from) or paybackYears is beyond the chosen horizon. */
  paybackBeyondHorizon: boolean;
  cumulativeCostByYear: number[];
  cumulativeSavingsByYear: number[];
};

// §5.1's own formula, unmodified — only the two inputs it takes (`coolingC`,
// `areaM2`) are now named/sourced explicitly rather than left as opaque
// parameters: `areaM2` is the site's total area (`sites.site_area_m2`,
// already saved — no new FortyGuard call), `coolingC` is
// `inputs.expectedCoolingC` (see EXPECTED_COOLING_ASSUMPTION_TEXT above).
export function simulateROI(inputs: ROIInputs, areaM2: number): ROIResult {
  const totalCost =
    inputs.numTrees * inputs.costPerTreeUSD +
    inputs.canopyM2 * inputs.costPerCanopyM2USD +
    inputs.solarKW * inputs.costPerSolarKWUSD;

  const estimatedKwhSavedPerYear = inputs.expectedCoolingC * areaM2 * inputs.kwhPerM2PerDegreeC;
  const annualSavingsUSD = estimatedKwhSavedPerYear * inputs.electricityRateUSDPerKWh;

  // Never divide by zero/negative into Infinity or NaN — no cost to recover
  // means an immediate (0-year) payback regardless of savings; no savings
  // (zero or negative) with a real cost means it never pays back (`null`),
  // which the UI must render as a plain-language message, not a crash or a
  // garbage number.
  const paybackYears = totalCost <= 0 ? 0 : annualSavingsUSD > 0 ? totalCost / annualSavingsUSD : null;
  const paybackBeyondHorizon = paybackYears === null || paybackYears > inputs.horizonYears;

  const cumulativeCostByYear = Array.from({ length: inputs.horizonYears }, () => totalCost);
  const cumulativeSavingsByYear = Array.from({ length: inputs.horizonYears }, (_, y) => annualSavingsUSD * (y + 1));

  return {
    totalCost,
    estimatedKwhSavedPerYear,
    annualSavingsUSD,
    paybackYears,
    paybackBeyondHorizon,
    cumulativeCostByYear,
    cumulativeSavingsByYear,
  };
}
