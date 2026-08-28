// AI Copilot tool registry (project.md §6). Covers every tool in §6's table
// except `analyze_field_photo`, which doesn't fit the function-calling
// pattern used here — the model can't produce image bytes as a tool
// argument, so photo analysis is handled as a direct vision-model branch in
// lib/copilotOrchestrator.ts instead of a callable tool. See that file.
import "server-only";
import { getSupabaseServiceClient } from "./supabaseServer";
import type { DeepseekToolCall, ToolDefinition } from "./deepseek";
import { buildHeatMitigationRecommendation, CANOPY_AREA_PER_TREE_M2 } from "./heatMitigationRecommendation";
import {
  simulateROI,
  DEFAULT_ROI_INPUTS,
  estimateCanopyAddedPct,
  estimateCanopyCoolingRangeC,
  checkSolarCapacityWarning,
  COOLING_RESEARCH_SOURCES,
  type ROIInputs,
  type ROIResult,
} from "./roiSimulator";
import { fetchSiteForCompute, zonesFor, zoneLabel, buildReportData } from "./reportData";

export type CopilotToolContext = { siteId: string | null };

export type ToolExecutionResult = {
  /** Short human-readable line shown in the chat trace (e.g. "Loaded Site X — avg 34.2°C"). */
  summaryLabel: string;
  /** Parsed object handed back to the client as a `tool_data` event (drives e.g. SiteSnapshotCard's chart) — same data as `resultJson`, just not yet stringified. */
  structured: unknown;
  /** JSON string fed back to DeepSeek as the `tool` message content. */
  resultJson: string;
};

export const COPILOT_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "get_site_data",
      description:
        "Fetch the stored data for one HeatOps site: name, area, land-cover breakdown, heat statistics, +12h " +
        "forecast, and data-source attribution (real/synthetic/unavailable). Use this before answering any question " +
        "about a specific site's conditions. Reads only what Map View already saved — never calls FortyGuard again.",
      parameters: {
        type: "object",
        properties: {
          siteId: {
            type: "string",
            description: "UUID of the site to fetch. Omit to use the site currently open in the Copilot.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_hotspot",
      description:
        "Bin the site's saved heat tiles into a 3x3 zone grid, labeled by compass position (Northwest/North/" +
        "Northeast/West/Center/East/Southwest/South/Southeast — same labeling as the Hotspot Detection " +
        "tab's chart and map overlay) and return each zone's mean temperature, risk level, and rank. Use this to " +
        "answer 'which part of this site is hottest/coolest' or anything zone-specific.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "recommend_intervention",
      description:
        "Compute HeatOps' deterministic tree-canopy deficit recommendation for a site (target 25% canopy cover " +
        "benchmark vs. the site's actual FortyGuard tree-canopy spot-check), plus context on hotspot severity. " +
        "AOI-wide only — does not target a specific zone. Solar is never auto-sized (no roof-area data basis); " +
        "solar scenarios always go through simulate_roi as a custom, user-specified capacity instead.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "simulate_roi",
      description:
        "Run the ROI calculator for one intervention scenario on a site: cost, estimated annual energy/cost " +
        "savings, and payback period. All fields are optional and default to HeatOps' standard planning " +
        "assumptions (e.g. $225/tree, $50/m² canopy, $2500/kW solar, EIA average electricity rate) if omitted — " +
        "only set the quantities relevant to the scenario being asked about (e.g. just numTrees for a tree-only " +
        "question). This always starts from the standard defaults, not whatever a user may have typed into the " +
        "Heat Mitigation Planner dashboard form.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
          numTrees: { type: "number", description: "Number of trees to plant. Default 0." },
          canopyM2: { type: "number", description: "m² of artificial canopy/shading structure. Default 0." },
          solarKW: { type: "number", description: "kW of solar capacity installed. Default 0." },
          costPerTreeUSD: { type: "number", description: "USD per tree. Default 225." },
          costPerCanopyM2USD: { type: "number", description: "USD per m² of canopy. Default 50." },
          costPerSolarKWUSD: { type: "number", description: "USD per kW of solar. Default 2500." },
          electricityRateUSDPerKWh: { type: "number", description: "USD per kWh. Default ~0.1354 (EIA US commercial average)." },
          horizonYears: { type: "number", description: "Simulation horizon in years — 5, 10, or 20. Default 10." },
          budgetUSD: { type: "number", description: "Optional available budget, to flag if the scenario exceeds it." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_interventions",
      description:
        "Run simulate_roi for two intervention scenarios on the same site and compare cost, annual savings, and " +
        "payback side by side (e.g. 'solar vs canopy for $50k'). Each option takes the same fields as simulate_roi " +
        "(numTrees/canopyM2/solarKW/etc.), minus siteId.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
          labelA: { type: "string", description: "Short label for option A, e.g. 'Trees'." },
          optionA: { type: "object", description: "simulate_roi-style fields for option A.", additionalProperties: true },
          labelB: { type: "string", description: "Short label for option B, e.g. 'Solar'." },
          optionB: { type: "object", description: "simulate_roi-style fields for option B.", additionalProperties: true },
        },
        required: ["optionA", "optionB"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_new_building_feasibility",
      description:
        "Evaluate whether a site has good candidate zones for a new building, using heat-zone ranking (coolest " +
        "zones first) plus the site's AOI-wide land-cover mix as context. Note: land-cover is only tracked " +
        "AOI-wide in this build, not per zone — the tool discloses this rather than fabricating zone-level " +
        "land-cover numbers.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
          zone: {
            type: "string",
            description: "Optional specific zone to evaluate, by its compass label, e.g. 'North' or 'Southeast'. Omit to rank all zones.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_all_sites",
      description:
        "List every saved site with a lightweight summary each: name, area, heat statistics (min/mean/max °C), " +
        "and data attribution. Use this for cross-site questions ('what sites do I have', 'list my sites') or to " +
        "resolve a site's name to its id when the user names a specific site while no site is currently open. Does " +
        "NOT include per-zone hotspot detail or raw heat tiles for any site (too heavy to return for every site at " +
        "once) — call get_hotspot(siteId) for that once you know which one site the user means.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_all_sites",
      description:
        "Rank every saved site by one metric, highest to lowest. Use this to answer 'which of my sites is the " +
        "hottest/coolest' or any other cross-site ranking question — do not try to answer this by calling " +
        "get_all_sites and comparing numbers yourself, call this instead so the ranking and rounding stay " +
        "consistent. Sites with no saved heat data are excluded (not ranked with a fabricated value).",
      parameters: {
        type: "object",
        properties: {
          metric: {
            type: "string",
            enum: ["mean_temp", "max_temp", "min_temp", "hotspot_severity"],
            description:
              "mean_temp/max_temp/min_temp = that site's stored heat_stats value (°C). hotspot_severity = " +
              "(max - mean) °C, a cheap proxy for how extreme the site's hottest point is relative to its own " +
              "average — NOT a real per-zone severity score (that needs get_hotspot on one specific site).",
          },
        },
        required: ["metric"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description:
        "Gather everything needed for a narrative site report in one call: site data, hotspot zone ranking, and " +
        "the tree-canopy recommendation. After calling this, write a structured summary (headline, key metrics, " +
        "hotspot findings, recommendation, data-quality caveats) suitable as a report's narrative section — this " +
        "is what feeds the Operational Analyst PDF report's summary text.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
        },
        required: [],
      },
    },
  },
];

export function readingLabelFor(call: DeepseekToolCall): string {
  switch (call.function.name) {
    case "get_site_data":
      return "Reading site data…";
    case "get_hotspot":
      return "Analyzing heat zones…";
    case "recommend_intervention":
      return "Computing intervention recommendation…";
    case "simulate_roi":
      return "Running ROI simulation…";
    case "compare_interventions":
      return "Comparing intervention scenarios…";
    case "check_new_building_feasibility":
      return "Evaluating candidate zones…";
    case "get_all_sites":
      return "Loading all saved sites…";
    case "compare_all_sites":
      return "Comparing sites…";
    case "generate_report":
      return "Compiling site report…";
    default:
      return `Running ${call.function.name}…`;
  }
}

export async function executeCopilotTool(
  call: DeepseekToolCall,
  ctx: CopilotToolContext,
): Promise<ToolExecutionResult> {
  switch (call.function.name) {
    case "get_site_data":
      return getSiteData(call.function.arguments, ctx);
    case "get_hotspot":
      return getHotspot(call.function.arguments, ctx);
    case "recommend_intervention":
      return recommendIntervention(call.function.arguments, ctx);
    case "simulate_roi":
      return runSimulateRoi(call.function.arguments, ctx);
    case "compare_interventions":
      return runCompareInterventions(call.function.arguments, ctx);
    case "check_new_building_feasibility":
      return checkNewBuildingFeasibility(call.function.arguments, ctx);
    case "get_all_sites":
      return getAllSites();
    case "compare_all_sites":
      return compareAllSites(call.function.arguments);
    case "generate_report":
      return generateReport(call.function.arguments, ctx);
    default: {
      const error = { error: `Unknown tool: ${call.function.name}` };
      return { summaryLabel: `Unknown tool "${call.function.name}"`, structured: error, resultJson: JSON.stringify(error) };
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function resolveSiteId(rawArgs: string, ctx: CopilotToolContext): string | null {
  let siteId = ctx.siteId;
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    if (typeof parsed.siteId === "string" && parsed.siteId.length > 0) siteId = parsed.siteId;
  } catch {
    // Malformed tool-call arguments — fall back to the site already bound in the UI.
  }
  return siteId;
}

function parseArgs(rawArgs: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArgs || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function errorResult(summaryLabel: string, message: string): ToolExecutionResult {
  const payload = { error: message };
  return { summaryLabel, structured: payload, resultJson: JSON.stringify(payload) };
}

// fetchSiteForCompute/zonesFor/zoneLabel now live in lib/reportData.ts,
// shared with the PDF report route — see that file's header comment.

// ---------------------------------------------------------------------------
// get_site_data
// ---------------------------------------------------------------------------

// Shared with lib/copilotOrchestrator.ts's photo-analysis branch: the vision
// model call can't use tool-calling (see deepseek.ts's VISION_MODEL comment),
// so site grounding for a photo question is fetched directly through this
// function and embedded as plain text instead of a tool round trip.
export async function fetchSiteSummary(siteId: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, created_at, site_area_m2, landcover, landcover_spotcheck, heat_stats, heat_forecast, attribution")
    .eq("id", siteId)
    .maybeSingle();

  if (error || !data) return null;

  // heat_tiles is deliberately omitted: a fine-granularity AOI can carry
  // hundreds of raw tiles, which would burn a lot of tokens for data
  // heat_stats already summarizes (mean/min/max/stdDev/tileCount). Zone-level
  // detail has its own tool (get_hotspot) instead of being dumped raw here.
  return {
    id: data.id,
    name: data.name,
    createdAt: data.created_at,
    siteAreaM2: data.site_area_m2,
    landcover: data.landcover,
    landcoverSpotcheck: data.landcover_spotcheck,
    heatStats: data.heat_stats,
    heatForecast: data.heat_forecast,
    attribution: data.attribution,
  };
}

async function getSiteData(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const summary = await fetchSiteSummary(siteId);
  if (!summary) return errorResult("Site not found", `No site with id ${siteId}`);

  const label = summary.name ?? `site ${(summary.id as string).slice(0, 8)}`;
  const heatStats = summary.heatStats as { avgTempC: number } | null;
  const tempLabel = heatStats ? `avg ${heatStats.avgTempC.toFixed(1)}°C` : "no heat data yet";

  return { summaryLabel: `Loaded ${label} — ${tempLabel}`, structured: summary, resultJson: JSON.stringify(summary) };
}

// ---------------------------------------------------------------------------
// get_hotspot
// ---------------------------------------------------------------------------

async function getHotspot(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const result = await fetchSiteForCompute(siteId);
  if ("error" in result) return errorResult("Site lookup failed", result.error);
  const { row, bbox } = result;

  const zones = zonesFor(row, bbox);
  if (zones.length === 0) {
    return errorResult("No heat data for this site", "This site has no saved heat tiles yet.");
  }

  const labeled = zones.map((z) => ({
    zoneLabel: zoneLabel(z.row, z.col),
    row: z.row,
    col: z.col,
    meanTempC: z.meanTempC,
    tileCount: z.tileCount,
    level: z.level,
    rank: z.rank,
    isHottest: z.isHottest,
  }));

  const hottest = labeled.find((z) => z.isHottest);
  const withData = labeled.filter((z) => z.meanTempC != null);
  const coolest = withData.length > 0 ? withData.reduce((a, b) => ((b.meanTempC as number) < (a.meanTempC as number) ? b : a)) : null;

  const structured = { siteId, zones: labeled, hottestZone: hottest ?? null, coolestZone: coolest };
  const summaryLabel =
    hottest && coolest
      ? `${hottest.zoneLabel} hottest (${hottest.meanTempC?.toFixed(1)}°C), ${coolest.zoneLabel} coolest (${coolest.meanTempC?.toFixed(1)}°C)`
      : "Zone grid computed";

  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

// ---------------------------------------------------------------------------
// recommend_intervention
// ---------------------------------------------------------------------------

async function recommendIntervention(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const result = await fetchSiteForCompute(siteId);
  if ("error" in result) return errorResult("Site lookup failed", result.error);
  const { row, bbox } = result;

  const recommendation = buildHeatMitigationRecommendation({
    siteAreaM2: row.site_area_m2,
    landcover: row.landcover,
    landcoverSpotcheck: row.landcover_spotcheck,
    heatTiles: row.heat_tiles,
    bbox,
  });

  const summaryLabel =
    recommendation.treeCanopy.status === "deficit"
      ? `Deficit: +${recommendation.treeCanopy.recommendedTrees} trees recommended`
      : recommendation.treeCanopy.status === "benchmark_met"
        ? "Canopy benchmark already met"
        : "Recommendation unavailable";

  return { summaryLabel, structured: recommendation, resultJson: JSON.stringify(recommendation) };
}

// ---------------------------------------------------------------------------
// simulate_roi / compare_interventions
// ---------------------------------------------------------------------------

function coerceRoiInputs(args: Record<string, unknown>): ROIInputs {
  const num = (key: string, fallback: number): number => {
    const v = args[key];
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
  };
  const horizon = num("horizonYears", DEFAULT_ROI_INPUTS.horizonYears);
  return {
    ...DEFAULT_ROI_INPUTS,
    numTrees: num("numTrees", 0),
    canopyM2: num("canopyM2", 0),
    solarKW: num("solarKW", 0),
    costPerTreeUSD: num("costPerTreeUSD", DEFAULT_ROI_INPUTS.costPerTreeUSD),
    costPerCanopyM2USD: num("costPerCanopyM2USD", DEFAULT_ROI_INPUTS.costPerCanopyM2USD),
    costPerSolarKWUSD: num("costPerSolarKWUSD", DEFAULT_ROI_INPUTS.costPerSolarKWUSD),
    electricityRateUSDPerKWh: num("electricityRateUSDPerKWh", DEFAULT_ROI_INPUTS.electricityRateUSDPerKWh),
    budgetUSD: typeof args.budgetUSD === "number" ? args.budgetUSD : null,
    horizonYears: ([5, 10, 20].includes(horizon) ? horizon : 10) as ROIInputs["horizonYears"],
  };
}

async function fetchSiteAreaM2(siteId: string): Promise<number | null> {
  const supabase = getSupabaseServiceClient();
  const { data } = await supabase.from("sites").select("site_area_m2").eq("id", siteId).maybeSingle();
  return (data?.site_area_m2 as number | null) ?? null;
}

// Mirrors RoiPanel.tsx's best/worst-case logic exactly (see that file) so
// the AI Copilot's numbers never diverge from what the Heat Mitigation
// Planner UI shows for the same inputs: canopy-driven scenarios get a
// researched low/high cooling range; solar-only scenarios keep the old flat
// expectedCoolingC input (low === high).
function simulateRoiRange(
  inputs: ROIInputs,
  areaM2: number,
): { best: ROIResult; worst: ROIResult; canopyAddedPct: number; solarWarning: string | null } {
  const canopyAddedPct = estimateCanopyAddedPct(inputs, areaM2, CANOPY_AREA_PER_TREE_M2);
  const coolingRange =
    canopyAddedPct > 0
      ? estimateCanopyCoolingRangeC(canopyAddedPct)
      : { lowC: inputs.expectedCoolingC, highC: inputs.expectedCoolingC };
  const best = simulateROI({ ...inputs, expectedCoolingC: coolingRange.highC }, areaM2);
  const worst = simulateROI({ ...inputs, expectedCoolingC: coolingRange.lowC }, areaM2);
  const solarWarning = checkSolarCapacityWarning(inputs.solarKW, areaM2 || null);
  return { best, worst, canopyAddedPct, solarWarning };
}

async function runSimulateRoi(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const areaM2 = await fetchSiteAreaM2(siteId);
  if (areaM2 == null) return errorResult("Site area unavailable", "This site has no saved area to simulate against.");

  const args = parseArgs(rawArgs);
  const inputs = coerceRoiInputs(args);
  const { best, worst, canopyAddedPct, solarWarning } = simulateRoiRange(inputs, areaM2);

  const structured = {
    siteId,
    inputs,
    resultBest: best,
    resultWorst: worst,
    isRange: canopyAddedPct > 0,
    solarWarning,
    sources: COOLING_RESEARCH_SOURCES,
    note:
      "resultBest/resultWorst are the high/low ends of a researched canopy-cooling range (see sources), not a " +
      "single guaranteed number. For solar-only scenarios they are identical.",
  };
  const paybackLow = worst.paybackYears == null ? "never" : `${worst.paybackYears.toFixed(1)}y`;
  const paybackHigh = best.paybackYears == null ? "never" : `${best.paybackYears.toFixed(1)}y`;
  const paybackLabel = paybackLow === paybackHigh ? paybackLow : `${paybackHigh}–${paybackLow}`;
  const summaryLabel = `Investment $${Math.round(worst.totalCost).toLocaleString()}, payback ${paybackLabel}`;

  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

async function runCompareInterventions(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const areaM2 = await fetchSiteAreaM2(siteId);
  if (areaM2 == null) return errorResult("Site area unavailable", "This site has no saved area to simulate against.");

  const args = parseArgs(rawArgs);
  const optionAArgs = (typeof args.optionA === "object" && args.optionA !== null ? args.optionA : {}) as Record<string, unknown>;
  const optionBArgs = (typeof args.optionB === "object" && args.optionB !== null ? args.optionB : {}) as Record<string, unknown>;
  const labelA = typeof args.labelA === "string" ? args.labelA : "Option A";
  const labelB = typeof args.labelB === "string" ? args.labelB : "Option B";

  const inputsA = coerceRoiInputs(optionAArgs);
  const inputsB = coerceRoiInputs(optionBArgs);
  const rangeA = simulateRoiRange(inputsA, areaM2);
  const rangeB = simulateRoiRange(inputsB, areaM2);

  const structured = {
    siteId,
    optionA: {
      label: labelA,
      inputs: inputsA,
      resultBest: rangeA.best,
      resultWorst: rangeA.worst,
      isRange: rangeA.canopyAddedPct > 0,
      solarWarning: rangeA.solarWarning,
    },
    optionB: {
      label: labelB,
      inputs: inputsB,
      resultBest: rangeB.best,
      resultWorst: rangeB.worst,
      isRange: rangeB.canopyAddedPct > 0,
      solarWarning: rangeB.solarWarning,
    },
    sources: COOLING_RESEARCH_SOURCES,
    note:
      "Each option re-runs the same simulate_roi calculation in isolation — not a combined or per-intervention " +
      "savings model. resultBest/resultWorst are the high/low ends of a researched canopy-cooling range, not a " +
      "single guaranteed number.",
  };

  const cheaper = rangeA.worst.totalCost <= rangeB.worst.totalCost ? labelA : labelB;
  const summaryLabel = `Compared ${labelA} vs ${labelB} — ${cheaper} costs less upfront`;

  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

// ---------------------------------------------------------------------------
// check_new_building_feasibility
// ---------------------------------------------------------------------------

async function checkNewBuildingFeasibility(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const result = await fetchSiteForCompute(siteId);
  if ("error" in result) return errorResult("Site lookup failed", result.error);
  const { row, bbox } = result;

  const zones = zonesFor(row, bbox);
  const withData = zones.filter((z) => z.meanTempC != null).map((z) => ({ ...z, zoneLabel: zoneLabel(z.row, z.col) }));

  if (withData.length === 0) {
    return errorResult("No heat data for this site", "This site has no saved heat tiles yet to rank zones by.");
  }

  const args = parseArgs(rawArgs);
  // Compass labels (see lib/heatmapUtils.ts's zoneLabel()) are matched
  // case-insensitively; the old "ZONE " prefix strip is kept as a lenient
  // fallback in case a caller still types the retired "Zone B" format.
  const requestedZone = typeof args.zone === "string" ? args.zone.trim().toUpperCase().replace(/^ZONE\s*/, "") : null;

  const rankedCoolest = [...withData].sort((a, b) => (a.meanTempC as number) - (b.meanTempC as number));

  const landcoverContext = row.landcover
    ? {
        buildingPct: row.landcover.buildingPct,
        vegetationPct: row.landcover.vegetationPct,
        otherPct: row.landcover.otherPct,
        note:
          "AOI-wide only, from Overpass — this build does not track land-cover per zone, so this is context for the " +
          "whole site, not proof any specific zone is actually vacant/buildable.",
      }
    : null;

  let focusedZone = null;
  if (requestedZone) {
    focusedZone = withData.find((z) => z.zoneLabel.toUpperCase() === requestedZone) ?? null;
  }

  const structured = {
    siteId,
    candidateZonesByCoolest: rankedCoolest.slice(0, 3).map((z) => ({
      zoneLabel: z.zoneLabel,
      meanTempC: z.meanTempC,
      level: z.level,
    })),
    requestedZone: focusedZone,
    landcoverContext,
    caveat:
      "Feasibility here is a heat-exposure heuristic only (cooler zones add less new heat load) — it is not a " +
      "structural, zoning, or ownership feasibility check, and does not confirm the zone is actually vacant.",
  };

  const summaryLabel = focusedZone
    ? `${focusedZone.zoneLabel}: ${focusedZone.meanTempC?.toFixed(1)}°C (${focusedZone.level})`
    : `Coolest candidate: ${rankedCoolest[0].zoneLabel} (${rankedCoolest[0].meanTempC?.toFixed(1)}°C)`;

  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

// ---------------------------------------------------------------------------
// get_all_sites / compare_all_sites — cross-site tools (project.md §6
// follow-up: AI Copilot accessible without picking one site first). Both
// query only cheap, already-summarized columns (name/area/heat_stats) —
// never heat_tiles/aoi_geometry for every site at once, which is exactly the
// "too heavy" case these two exist to avoid. Per-zone hotspot detail for one
// specific site still goes through get_hotspot(siteId), unchanged.
// ---------------------------------------------------------------------------

type AllSitesRow = {
  id: string;
  name: string | null;
  site_area_m2: number | null;
  created_at: string;
  heat_stats: { avgTempC: number; maxTempC: number; minTempC: number; tileCount: number } | null;
  attribution: { heat: "real" | "synthetic" | "unavailable" } | null;
};

const ALL_SITES_QUERY_LIMIT = 100;

async function fetchAllSitesSummary(): Promise<AllSitesRow[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, site_area_m2, created_at, heat_stats, attribution")
    .order("created_at", { ascending: false })
    .limit(ALL_SITES_QUERY_LIMIT);
  if (error || !data) return [];
  return data as AllSitesRow[];
}

async function getAllSites(): Promise<ToolExecutionResult> {
  const rows = await fetchAllSitesSummary();

  const sites = rows.map((r) => ({
    id: r.id,
    name: r.name,
    siteAreaM2: r.site_area_m2,
    createdAt: r.created_at,
    heatStats: r.heat_stats
      ? { minTempC: r.heat_stats.minTempC, avgTempC: r.heat_stats.avgTempC, maxTempC: r.heat_stats.maxTempC, tileCount: r.heat_stats.tileCount }
      : null,
    heatAttribution: r.attribution?.heat ?? "unavailable",
  }));

  const structured = {
    sites,
    count: sites.length,
    note:
      "Summary only — no per-zone hotspot detail or raw heat tiles included here (too heavy to fetch for every " +
      "site at once). Once you know which one site the user means, call get_hotspot(siteId) for zone-level detail.",
  };

  const summaryLabel = sites.length === 0 ? "No saved sites found" : `Loaded ${sites.length} saved site${sites.length === 1 ? "" : "s"}`;
  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

const COMPARE_METRIC_LABELS: Record<string, string> = {
  mean_temp: "Mean temperature (°C)",
  max_temp: "Max temperature (°C)",
  min_temp: "Min temperature (°C)",
  hotspot_severity: "Hotspot severity — max minus mean (°C)",
};

function metricValue(row: AllSitesRow, metric: string): number | null {
  if (!row.heat_stats) return null;
  switch (metric) {
    case "mean_temp":
      return row.heat_stats.avgTempC;
    case "max_temp":
      return row.heat_stats.maxTempC;
    case "min_temp":
      return row.heat_stats.minTempC;
    case "hotspot_severity":
      return row.heat_stats.maxTempC - row.heat_stats.avgTempC;
    default:
      return null;
  }
}

async function compareAllSites(rawArgs: string): Promise<ToolExecutionResult> {
  const args = parseArgs(rawArgs);
  const metric = typeof args.metric === "string" && isValidCompareMetric(args.metric) ? args.metric : "mean_temp";

  const rows = await fetchAllSitesSummary();
  const withValue = rows
    .map((r) => ({ id: r.id, name: r.name, value: metricValue(r, metric) }))
    .filter((r): r is { id: string; name: string | null; value: number } => r.value != null)
    .sort((a, b) => b.value - a.value)
    .map((r, i) => ({ rank: i + 1, id: r.id, name: r.name, value: Math.round(r.value * 10) / 10 }));

  const excludedCount = rows.length - withValue.length;

  const structured = {
    metric,
    metricLabel: COMPARE_METRIC_LABELS[metric] ?? metric,
    ranked: withValue,
    excludedCount,
    note:
      excludedCount > 0
        ? `${excludedCount} saved site${excludedCount === 1 ? "" : "s"} excluded — no saved heat data to compute this metric from.`
        : "All saved sites had heat data and are ranked.",
  };

  const summaryLabel =
    withValue.length === 0
      ? "No sites with heat data to compare"
      : `Ranked ${withValue.length} site${withValue.length === 1 ? "" : "s"} by ${COMPARE_METRIC_LABELS[metric] ?? metric} — top: ${withValue[0].name ?? withValue[0].id.slice(0, 8)} (${withValue[0].value}°C)`;

  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

function isValidCompareMetric(m: string): boolean {
  return m === "mean_temp" || m === "max_temp" || m === "min_temp" || m === "hotspot_severity";
}

// ---------------------------------------------------------------------------
// generate_report
// ---------------------------------------------------------------------------

async function generateReport(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const structured = await buildReportData(siteId);
  if ("error" in structured) return errorResult("Site lookup failed", structured.error);

  const label = structured.site.name ?? `site ${structured.site.id.slice(0, 8)}`;
  // heatGrid (up to ~150 per-tile bounds/temp entries, added for the PDF
  // report's Heatmap Grid image) and the AOI polygon's raw coordinate ring
  // add nothing DeepSeek needs for a narrative and would just bloat the
  // tool-result tokens sent back to it — trimmed from resultJson only;
  // `structured` (sent to the client, not the model) keeps the full data.
  const forModel = {
    site: { ...structured.site, aoiGeometry: undefined },
    hotspotZones: structured.hotspotZones,
    recommendation: structured.recommendation,
  };
  return {
    summaryLabel: `Compiled report data for ${label}`,
    structured,
    resultJson: JSON.stringify(forModel),
  };
}
