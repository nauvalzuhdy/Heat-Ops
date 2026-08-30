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
  estimateHeatPenalty,
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
      name: "compare_investments",
      description:
        "Financial, underwriting-style comparison of two capital investment options on the same site (Track 3: " +
        "Finance & Underwriting) — e.g. '$100k in cool roof vs $100k in tree canopy, which pays back faster'. " +
        "Reuses the exact same simulate_roi calculation as simulate_roi/compare_interventions — no separate " +
        "formula. Each option is described by a budgetUsd (CapEx) and an interventionType; if the option's `inputs` " +
        "doesn't already specify a concrete quantity (numTrees/canopyM2/solarKW), the tool derives one by dividing " +
        "budgetUsd by that intervention's standard per-unit cost. Returns CapEx (totalCost), Annual Savings " +
        "(annualSavingsUSD), and Payback Period (paybackYears) for both options side by side, as a best/worst-case " +
        "range from the same researched canopy-cooling range simulate_roi uses. Note: cool_roof has no dedicated " +
        "cost/savings model in this build — it is approximated using the artificial-canopy $/m² cost basis as the " +
        "closest proxy (disclosed per-option, not silently substituted).",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
          optionA: {
            type: "object",
            description: "Investment option A.",
            properties: {
              label: { type: "string", description: "Short label, e.g. 'Cool roof (Zone A)'." },
              interventionType: {
                type: "string",
                enum: ["tree_canopy", "artificial_canopy", "cool_roof", "solar"],
                description:
                  "Which cost/savings model this option uses. cool_roof is approximated via the " +
                  "artificial_canopy cost basis (no dedicated model exists for it).",
              },
              budgetUsd: {
                type: "number",
                description:
                  "CapEx budget for this option in USD, e.g. 100000 for $100k. Used to derive a quantity " +
                  "(numTrees/canopyM2/solarKW) when inputs doesn't already specify one for this intervention.",
              },
              inputs: {
                type: "object",
                description:
                  "Optional simulate_roi-style fields (numTrees/canopyM2/solarKW/costPerTreeUSD/etc.) to override " +
                  "the budget-derived quantity or the default unit costs.",
                additionalProperties: true,
              },
            },
            required: ["interventionType", "budgetUsd"],
          },
          optionB: {
            type: "object",
            description: "Investment option B — same shape as optionA.",
            properties: {
              label: { type: "string", description: "Short label, e.g. 'Tree canopy (Zone B)'." },
              interventionType: {
                type: "string",
                enum: ["tree_canopy", "artificial_canopy", "cool_roof", "solar"],
                description:
                  "Which cost/savings model this option uses. cool_roof is approximated via the " +
                  "artificial_canopy cost basis (no dedicated model exists for it).",
              },
              budgetUsd: {
                type: "number",
                description:
                  "CapEx budget for this option in USD, e.g. 100000 for $100k. Used to derive a quantity " +
                  "(numTrees/canopyM2/solarKW) when inputs doesn't already specify one for this intervention.",
              },
              inputs: {
                type: "object",
                description:
                  "Optional simulate_roi-style fields (numTrees/canopyM2/solarKW/costPerTreeUSD/etc.) to override " +
                  "the budget-derived quantity or the default unit costs.",
                additionalProperties: true,
              },
            },
            required: ["interventionType", "budgetUsd"],
          },
        },
        required: ["optionA", "optionB"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "estimate_heat_penalty",
      description:
        "Financial, underwriting-style projection of the extra annual cooling-energy cost (Operational " +
        "Expenditure / OpEx penalty) a NEW building would add if built in a specific hot zone of a site — the " +
        "'heat trap' cost of building somewhere hot, in dollars per year (Track 3: Finance & Underwriting). Reuses " +
        "get_hotspot's own per-zone mean temperature and ROI Simulator's kWh/m²/°C and electricity-rate constants " +
        "— no separate formula. Zones are identified the same way get_hotspot already ranks them: zoneIndex is " +
        "1-based, 1 = the hottest zone at this site, 2 = second-hottest, etc. Call get_hotspot first if you don't " +
        "already know which zone rank the user means.",
      parameters: {
        type: "object",
        properties: {
          siteId: { type: "string", description: "UUID of the site. Omit to use the site currently open." },
          zoneIndex: {
            type: "integer",
            description:
              "1-based hotspot rank of the zone to evaluate (1 = hottest zone at this site, per get_hotspot's " +
              "`rank` field). Not a compass label and not the retired letter scheme — call get_hotspot first if " +
              "unsure which rank the user's named zone corresponds to.",
          },
          buildingAreaM2: { type: "number", description: "Floor area in m² of the new building being evaluated." },
        },
        required: ["zoneIndex", "buildingAreaM2"],
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
    case "compare_investments":
      return "Comparing investment scenarios…";
    case "estimate_heat_penalty":
      return "Estimating heat penalty…";
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
    case "compare_investments":
      return runCompareInvestments(call.function.arguments, ctx);
    case "estimate_heat_penalty":
      return runEstimateHeatPenalty(call.function.arguments, ctx);
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
// compare_investments (Track 3: Finance & Underwriting — financial-framed
// version of compare_interventions above). Reuses simulateRoiRange/
// simulateROI as-is; the only new logic here is turning a stated CapEx
// budget into a concrete quantity (division by the intervention's per-unit
// cost) when the caller didn't already give one via `inputs`.
// ---------------------------------------------------------------------------

const INVESTMENT_INTERVENTION_TYPES = ["tree_canopy", "artificial_canopy", "cool_roof", "solar"] as const;
type InvestmentInterventionType = (typeof INVESTMENT_INTERVENTION_TYPES)[number];

function isInvestmentInterventionType(v: unknown): v is InvestmentInterventionType {
  return typeof v === "string" && (INVESTMENT_INTERVENTION_TYPES as readonly string[]).includes(v);
}

// No dedicated cool-roof cost/savings model exists in roiSimulator.ts (only
// numTrees/canopyM2/solarKW are modeled) — confirmed with the user rather
// than inventing an unsourced cost/kWh-savings constant. cool_roof is
// approximated via the artificial-canopy $/m² bucket (costPerCanopyM2USD) as
// the closest existing proxy; this note is surfaced per-option, never
// silently substituted.
const COOL_ROOF_PROXY_NOTE =
  "No dedicated cool-roof cost/savings model exists in this build — approximated using the same $/m² shading-" +
  "canopy cost basis (costPerCanopyM2USD) as the closest proxy, since a reflective-roof-specific cost/savings " +
  "figure hasn't been sourced. Treat this option's numbers as a rough stand-in, not a cool-roof-specific estimate.";

function buildInvestmentInputs(
  interventionType: InvestmentInterventionType | null,
  budgetUsd: number | null,
  rawInputs: Record<string, unknown>,
): { inputs: ROIInputs; derivedFromBudget: boolean } {
  const inputs = coerceRoiInputs(rawInputs);

  const hasExplicitQuantity =
    (typeof rawInputs.numTrees === "number" && rawInputs.numTrees > 0) ||
    (typeof rawInputs.canopyM2 === "number" && rawInputs.canopyM2 > 0) ||
    (typeof rawInputs.solarKW === "number" && rawInputs.solarKW > 0);

  let derivedFromBudget = false;
  if (!hasExplicitQuantity && budgetUsd != null && budgetUsd > 0 && interventionType) {
    derivedFromBudget = true;
    switch (interventionType) {
      case "tree_canopy":
        inputs.numTrees = budgetUsd / inputs.costPerTreeUSD;
        break;
      case "artificial_canopy":
      case "cool_roof":
        inputs.canopyM2 = budgetUsd / inputs.costPerCanopyM2USD;
        break;
      case "solar":
        inputs.solarKW = budgetUsd / inputs.costPerSolarKWUSD;
        break;
    }
  }

  if (budgetUsd != null) inputs.budgetUSD = budgetUsd;
  return { inputs, derivedFromBudget };
}

function parseInvestmentOption(raw: Record<string, unknown>, defaultLabel: string) {
  const label = typeof raw.label === "string" && raw.label.trim().length > 0 ? raw.label.trim() : defaultLabel;
  const interventionType = isInvestmentInterventionType(raw.interventionType) ? raw.interventionType : null;
  const budgetUsd = typeof raw.budgetUsd === "number" && Number.isFinite(raw.budgetUsd) ? raw.budgetUsd : null;
  const rawInputs = (typeof raw.inputs === "object" && raw.inputs !== null ? raw.inputs : {}) as Record<string, unknown>;
  const { inputs, derivedFromBudget } = buildInvestmentInputs(interventionType, budgetUsd, rawInputs);
  const notes: string[] = [];
  if (interventionType === "cool_roof") notes.push(COOL_ROOF_PROXY_NOTE);
  if (derivedFromBudget) {
    notes.push(
      `Quantity derived from the ${budgetUsd != null ? `$${budgetUsd.toLocaleString()}` : "stated"} budget divided ` +
        "by the standard per-unit cost (no explicit quantity was given) — override via `inputs` for a precise figure.",
    );
  }
  return { label, interventionType, budgetUsd, inputs, note: notes.length > 0 ? notes.join(" ") : null };
}

async function runCompareInvestments(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const areaM2 = await fetchSiteAreaM2(siteId);
  if (areaM2 == null) return errorResult("Site area unavailable", "This site has no saved area to simulate against.");

  const args = parseArgs(rawArgs);
  const optionARaw = (typeof args.optionA === "object" && args.optionA !== null ? args.optionA : {}) as Record<string, unknown>;
  const optionBRaw = (typeof args.optionB === "object" && args.optionB !== null ? args.optionB : {}) as Record<string, unknown>;

  const optionA = parseInvestmentOption(optionARaw, "Option A");
  const optionB = parseInvestmentOption(optionBRaw, "Option B");

  const rangeA = simulateRoiRange(optionA.inputs, areaM2);
  const rangeB = simulateRoiRange(optionB.inputs, areaM2);

  const structured = {
    siteId,
    optionA: {
      label: optionA.label,
      interventionType: optionA.interventionType,
      budgetUsd: optionA.budgetUsd,
      resultBest: rangeA.best,
      resultWorst: rangeA.worst,
      isRange: rangeA.canopyAddedPct > 0,
      solarWarning: rangeA.solarWarning,
      note: optionA.note,
    },
    optionB: {
      label: optionB.label,
      interventionType: optionB.interventionType,
      budgetUsd: optionB.budgetUsd,
      resultBest: rangeB.best,
      resultWorst: rangeB.worst,
      isRange: rangeB.canopyAddedPct > 0,
      solarWarning: rangeB.solarWarning,
      note: optionB.note,
    },
    sources: COOLING_RESEARCH_SOURCES,
    note:
      "Financial comparison for underwriting/pitch purposes (Track 3: Finance & Underwriting). CapEx = " +
      "resultBest/resultWorst.totalCost (identical between the two — cost doesn't vary with the cooling-range " +
      "assumption, only Annual Savings and Payback Period do). resultBest = optimistic end of the researched " +
      "canopy-cooling range, resultWorst = conservative end (identical for solar-only options). paybackYears is " +
      "null — never Infinity/NaN — when annualSavingsUSD is zero or negative under that scenario, meaning the " +
      "investment does not break even at all under current assumptions; narrate that in plain language (e.g. " +
      "'does not pay back under current assumptions'), not as an error.",
  };

  const paybackLabel = (r: ROIResult) => (r.paybackYears == null ? "never" : `${r.paybackYears.toFixed(1)}y`);
  const summaryLabel =
    `${optionA.label} ($${Math.round(rangeA.worst.totalCost).toLocaleString()} CapEx, payback ${paybackLabel(rangeA.worst)}) vs ` +
    `${optionB.label} ($${Math.round(rangeB.worst.totalCost).toLocaleString()} CapEx, payback ${paybackLabel(rangeB.worst)})`;

  return { summaryLabel, structured, resultJson: JSON.stringify(structured) };
}

// ---------------------------------------------------------------------------
// estimate_heat_penalty (Track 3: Finance & Underwriting — "mini B.1": the
// added annual cooling-energy OpEx a new building would carry if built in a
// specific hot zone). Reuses get_hotspot's own per-zone meanTempC (zonesFor/
// binTilesToZones — no per-zone peak temperature exists in this build) and
// roiSimulator.ts's estimateHeatPenalty(), which itself reuses
// KWH_SAVED_PER_M2_PER_DEGREE_C / DEFAULT_ELECTRICITY_RATE_USD_PER_KWH
// verbatim — no new formula, no new cost constants.
// ---------------------------------------------------------------------------

async function runEstimateHeatPenalty(rawArgs: string, ctx: CopilotToolContext): Promise<ToolExecutionResult> {
  const siteId = resolveSiteId(rawArgs, ctx);
  if (!siteId) return errorResult("No site selected", "No siteId available — ask the user to open a site first.");

  const result = await fetchSiteForCompute(siteId);
  if ("error" in result) return errorResult("Site lookup failed", result.error);
  const { row, bbox } = result;

  const args = parseArgs(rawArgs);
  const zoneIndex = typeof args.zoneIndex === "number" && Number.isInteger(args.zoneIndex) ? args.zoneIndex : null;
  const buildingAreaM2 =
    typeof args.buildingAreaM2 === "number" && Number.isFinite(args.buildingAreaM2) && args.buildingAreaM2 > 0
      ? args.buildingAreaM2
      : null;

  if (!buildingAreaM2) {
    return errorResult("Missing building area", "buildingAreaM2 must be a positive number of square meters.");
  }

  const zones = zonesFor(row, bbox);
  const rankedZones = zones.filter((z) => z.rank != null);
  if (rankedZones.length === 0) {
    return errorResult("No heat data for this site", "This site has no saved heat tiles yet to rank zones by.");
  }

  const zone = zoneIndex != null ? rankedZones.find((z) => z.rank === zoneIndex) : null;
  if (!zone) {
    return errorResult(
      "Zone not found",
      `zoneIndex must be a 1-based hotspot rank between 1 and ${rankedZones.length} for this site (1 = hottest) — ` +
        `call get_hotspot first to see each zone's rank and compass label.`,
    );
  }

  const penalty = estimateHeatPenalty(zone.meanTempC as number, buildingAreaM2);

  const structured = {
    siteId,
    zone: { zoneLabel: zoneLabel(zone.row, zone.col), rank: zone.rank, meanTempC: zone.meanTempC, level: zone.level },
    ...penalty,
    note:
      "Uses this zone's MEAN temperature (get_hotspot's meanTempC) — this build does not track a per-zone peak " +
      "temperature. additionalKwhPerYear/additionalCostUSDPerYear.mid is the headline planning estimate; low/high " +
      "mirror the same researched kWh/m²/°C range simulate_roi uses. noPenalty is true when this zone's mean " +
      "temperature is already at/below the comfort baseline — no added cooling load, not a negative one. This is " +
      "a planning-grade estimate for underwriting/pitch discussion, not a certified energy audit.",
  };

  const summaryLabel = penalty.noPenalty
    ? `${structured.zone.zoneLabel} zone: no added cooling load (at/below ${penalty.baselineComfortC}°C baseline)`
    : `${structured.zone.zoneLabel} zone: +$${Math.round(penalty.additionalCostUSDPerYear.mid).toLocaleString()}/yr OpEx penalty for a ${buildingAreaM2.toLocaleString()} m² building (Δ${penalty.deltaC.toFixed(1)}°C over ${penalty.baselineComfortC}°C)`;

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
