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

// Expected temperature reduction — used ONLY as a manual fallback for
// scenarios with no tree/canopy quantity to derive a real estimate from
// (e.g. a solar-only scenario, which has no canopy-cover basis at all).
// EPA's "Reducing Urban Heat Islands: Compendium of Strategies" cites
// evapotranspiration and shading together reducing peak summer temperatures
// by roughly 2–9°F (1–5°C); 2°C is used as a conservative default within
// that cited range, not the midpoint or the optimistic end.
//
// Whenever a scenario actually has trees/canopy area, HeatOps no longer uses
// this flat pick — see CANOPY_COOLING_C_PER_10PCT / estimateCanopyCoolingRangeC
// below, which derives an expected-cooling RANGE from real research indexed
// to how much canopy this specific scenario actually adds, replacing an
// unindexed flat guess.
export const EXPECTED_COOLING_C_RANGE = { low: 1, high: 5 } as const;
export const DEFAULT_EXPECTED_COOLING_C = 2;
export const EXPECTED_COOLING_ASSUMPTION_TEXT =
  `Fallback for scenarios with no tree/canopy quantity to estimate from (e.g. solar-only): ` +
  `${DEFAULT_EXPECTED_COOLING_C}°C — a conservative pick within the ${EXPECTED_COOLING_C_RANGE.low}–` +
  `${EXPECTED_COOLING_C_RANGE.high}°C range EPA's heat-island mitigation guidance cites for combined shading and ` +
  `evapotranspiration effects. Adjust if you have a better estimate for this site.`;

// ---------------------------------------------------------------------------
// Canopy-cover-to-cooling model (project.md §5.1's "wajib dicari basisnya"
// requirement, extended: the user asked for this to be grounded in real,
// checkable research, presented as a RANGE, not a single invented decimal).
//
// Every number below was independently fact-checked against the actual
// paper text (not just a search-engine summary) before being confirmed for
// use — see development.md for the verification trail, including one
// citation correction (a misattributed author name) and one source dropped
// entirely for lack of a traceable citation.
// ---------------------------------------------------------------------------
export const COOLING_RESEARCH_SOURCES = [
  {
    id: "ibsen2022",
    citation:
      "Ibsen, P.C., Jenerette, G.D., Dell, T., Bagstad, K.J. & Diffendorfer, J.E. (2022). Urban landcover " +
      "differentially drives day and nighttime air temperature across a semi-arid city. Science of the Total Environment.",
    url: "https://www.sciencedirect.com/science/article/pii/S0048969722016825",
    finding: "−0.026°C per 1 percentage-point increase in tree canopy cover (daytime).",
    climateNote:
      "Denver, Colorado — semi-arid climate. The closest climate analog among the sources checked to HeatOps' own " +
      "typical AOI cities (Phoenix, Houston) — used here as the RANGE's conservative/low end.",
  },
  {
    id: "zaerpour2025",
    citation:
      "Zaerpour, M., Papalexiou, S.M. & Pietroniro, A. (2025). Increasing tree canopy lowers urban air temperature " +
      "by up to 1.5°C in heat-prone areas. npj Urban Sustainability, 5, 92.",
    url: "https://doi.org/10.1038/s42949-025-00277-x",
    finding:
      "A 10% increase in tree canopy reduces air temperature by 0.8°C, while a 30% increase lowers it by as much " +
      "as 1.5°C (scenario simulation, not a fitted linear regression — the paper explicitly notes the relationship " +
      "is non-linear).",
    climateNote:
      "Calgary, Canada — a cold-temperate climate, NOT arid. Kept as the range's optimistic/high end because it's " +
      "a documented real figure, but it is disclosed here as likely not representative of an arid HeatOps site.",
  },
  {
    id: "marando2022",
    citation:
      "Marando, F. et al. (2022). Urban heat island mitigation by green infrastructure in European functional " +
      "urban areas. Sustainable Cities and Society, 77, 103564.",
    url: "https://www.sciencedirect.com/science/article/pii/S2210670721008301",
    finding: "~16% tree cover increase associated with ~1°C average cooling (up to 2.9°C) across 601 European cities.",
    climateNote:
      "601 European cities, mixed climates — not arid-specific. Falls between the Denver and Calgary figures " +
      "(~0.06°C per 1% canopy); shown as supporting context, not used as a range boundary on its own.",
  },
] as const;

// °C of ambient air temperature reduction per 10 percentage-point increase in
// tree canopy cover. A RANGE, not one coefficient, because the source studies
// themselves disagree by roughly 3x — `low` (Ibsen/Denver, semi-arid) is kept
// as the range's floor specifically because it's the most climate-appropriate
// to HeatOps' own target cities; `high` (Zaerpour/Calgary) is the documented
// literature ceiling but is NOT climate-matched to an arid site — see
// COOLING_RESEARCH_SOURCES's climateNote on each for the full caveat, which
// the UI must surface, not just this range in isolation.
export const CANOPY_COOLING_C_PER_10PCT = { low: 0.26, high: 0.8 } as const;

// Linear extrapolation of the studies above, which only tested up to ~30
// percentage points of canopy change (Zaerpour) or city-average shifts well
// under that (Marando, Ibsen) — a scenario adding much more canopy than that
// is extrapolating past what's been empirically measured, not an established
// result. Disclosed in COOLING_ASSUMPTION_TEXT rather than silently applied.
export const CANOPY_COOLING_VALIDATED_MAX_PCT = 30;

export function estimateCanopyCoolingRangeC(canopyAddedPct: number): { lowC: number; highC: number } {
  const factor = Math.max(0, canopyAddedPct) / 10;
  return {
    lowC: factor * CANOPY_COOLING_C_PER_10PCT.low,
    highC: factor * CANOPY_COOLING_C_PER_10PCT.high,
  };
}

export const COOLING_ASSUMPTION_TEXT =
  `Estimated from real published research on tree canopy cover vs. air temperature, indexed to how much canopy ` +
  `THIS scenario actually adds (not a flat guess): ${CANOPY_COOLING_C_PER_10PCT.low}–` +
  `${CANOPY_COOLING_C_PER_10PCT.high}°C per 10 percentage points of canopy cover added, per site area. The low end ` +
  `(Ibsen et al. 2022, Denver — semi-arid) is the more climate-appropriate figure for a typical HeatOps site; the ` +
  `high end (Zaerpour et al. 2025, Calgary — cold-temperate) is a real documented figure but from a different ` +
  `climate, kept as the literature's upper bound rather than a claim that it applies here equally. Linear ` +
  `extrapolation beyond ${CANOPY_COOLING_VALIDATED_MAX_PCT} percentage points of canopy change goes past what these ` +
  `studies actually tested. Solar-only scenarios (no canopy to estimate from) fall back to a flat EPA-cited range ` +
  `instead — see below.`;

// ---------------------------------------------------------------------------
// Solar capacity sanity check (not a cost/savings input — purely a "does
// this number make physical sense for this site" guard). Source: Lawrence
// Berkeley National Laboratory's "Land Requirements for Utility-Scale PV: An
// Empirical Update on Power and Energy Density" — median 2019 fixed-tilt
// ground-mount density ≈0.35 MWdc/acre ≈0.086 kW/m². Kept deliberately below
// that (0.05 kW/m², i.e. ~20 m² of land per kW) since a real site also needs
// access paths/setbacks/existing structures, not 100% panel coverage —
// a conservative ceiling, not a tight one.
// ---------------------------------------------------------------------------
export const SOLAR_DENSITY_KW_PER_M2 = 0.05;
export const SOLAR_DENSITY_SOURCE_URL = "https://emp.lbl.gov/news/utility-scale-pv-s-power-mwacre-and";

export function checkSolarCapacityWarning(solarKW: number, siteAreaM2: number | null): string | null {
  if (solarKW <= 0 || !siteAreaM2 || siteAreaM2 <= 0) return null;
  const requiredM2 = solarKW / SOLAR_DENSITY_KW_PER_M2;
  if (requiredM2 <= siteAreaM2) return null;
  return (
    `This capacity would need roughly ${Math.round(requiredM2).toLocaleString()} m² of solar array (at a typical ` +
    `~${Math.round(SOLAR_DENSITY_KW_PER_M2 * 1000)} W/m² ground-mount density) — more than this site's total area ` +
    `(${Math.round(siteAreaM2).toLocaleString()} m²). This capacity seems very large for a site this size.`
  );
}

// % of site area gaining NEW canopy under this scenario — the input the
// canopy-cooling range above is indexed to. Reuses
// lib/heatMitigationRecommendation.ts's CANOPY_AREA_PER_TREE_M2 (single
// source of truth for "how much canopy one tree adds") rather than a second,
// separately-drifting constant.
export function estimateCanopyAddedPct(
  inputs: { numTrees: number; canopyM2: number },
  areaM2: number,
  canopyAreaPerTreeM2: number
): number {
  if (!areaM2 || areaM2 <= 0) return 0;
  const addedM2 = inputs.numTrees * canopyAreaPerTreeM2 + inputs.canopyM2;
  return Math.max(0, (addedM2 / areaM2) * 100);
}

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

// ---------------------------------------------------------------------------
// Heat penalty estimator (AI Copilot's `estimate_heat_penalty` tool — the
// mirror image of this file's savings formula above, applied as an added
// cooling LOAD instead of a reduction: "how much more does a new building in
// a hot zone cost to cool per year, vs. building at a comfortable baseline
// temperature". Reuses KWH_SAVED_PER_M2_PER_DEGREE_C and
// DEFAULT_ELECTRICITY_RATE_USD_PER_KWH verbatim — no second set of constants.
// ---------------------------------------------------------------------------

// Indoor cooling setpoint most commercial HVAC systems target — ASHRAE
// Standard 55's typical thermal-comfort range is ~20-24°C; 22°C is that
// range's midpoint, not the low or high end. Confirmed with the user as this
// feature's baseline (not independently re-derived) before use.
export const HEAT_PENALTY_BASELINE_COMFORT_C = 22;

export type HeatPenaltyEstimate = {
  zoneMeanTempC: number;
  baselineComfortC: number;
  deltaC: number;
  /** true when the zone's mean temperature is at/below the comfort baseline — no added cooling load, not a negative one. */
  noPenalty: boolean;
  buildingAreaM2: number;
  kwhPerM2PerDegreeC: typeof KWH_SAVED_PER_M2_PER_DEGREE_C;
  electricityRateUSDPerKWh: number;
  /** Low/mid/high mirror KWH_SAVED_PER_M2_PER_DEGREE_C's own range — mid is the headline planning estimate. */
  additionalKwhPerYear: { low: number; mid: number; high: number };
  additionalCostUSDPerYear: { low: number; mid: number; high: number };
};

// `zoneMeanTempC` comes from get_hotspot/binTilesToZones' existing per-zone
// meanTempC (no per-zone peak temperature is tracked anywhere in this build —
// confirmed with the user rather than adding new max-aggregation logic to
// binTilesToZones just for this one estimate). Same multiplicative shape as
// simulateROI()'s own estimatedKwhSavedPerYear/annualSavingsUSD lines above
// (°C * area * kWh/m²/°C, then * $/kWh) — not a new formula, just run as an
// added load (deltaC = zone temp minus comfort baseline) instead of a
// reduction (deltaC = expected cooling achieved).
export function estimateHeatPenalty(zoneMeanTempC: number, buildingAreaM2: number): HeatPenaltyEstimate {
  const deltaC = Math.max(0, zoneMeanTempC - HEAT_PENALTY_BASELINE_COMFORT_C);
  const kwhFor = (perM2PerDegreeC: number) => deltaC * buildingAreaM2 * perM2PerDegreeC;
  const additionalKwhPerYear = {
    low: kwhFor(KWH_SAVED_PER_M2_PER_DEGREE_C.low),
    mid: kwhFor(KWH_SAVED_PER_M2_PER_DEGREE_C.mid),
    high: kwhFor(KWH_SAVED_PER_M2_PER_DEGREE_C.high),
  };
  const additionalCostUSDPerYear = {
    low: additionalKwhPerYear.low * DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
    mid: additionalKwhPerYear.mid * DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
    high: additionalKwhPerYear.high * DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
  };
  return {
    zoneMeanTempC,
    baselineComfortC: HEAT_PENALTY_BASELINE_COMFORT_C,
    deltaC,
    noPenalty: deltaC <= 0,
    buildingAreaM2,
    kwhPerM2PerDegreeC: KWH_SAVED_PER_M2_PER_DEGREE_C,
    electricityRateUSDPerKWh: DEFAULT_ELECTRICITY_RATE_USD_PER_KWH,
    additionalKwhPerYear,
    additionalCostUSDPerYear,
  };
}

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
