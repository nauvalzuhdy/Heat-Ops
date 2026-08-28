// Shared site-report data assembly — single source of truth for both the AI
// Copilot's `generate_report` tool (lib/copilotTools.ts) and the PDF report
// route (app/api/sites/[id]/report/route.ts), so the two can never drift on
// what a "site report" actually contains (same risk lib/landcoverColors.ts
// and lib/heatmapUtils.ts's zone binning already guard against elsewhere in
// this codebase). Originally lived inline in copilotTools.ts's generateReport()
// — extracted here once the PDF route needed the identical data shape.
import "server-only";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { getSupabaseServiceClient } from "./supabaseServer";
import { chatCompletion, type ChatMessage } from "./deepseek";
import { binTilesToZones, zoneLabel, type HotspotZone } from "./heatmapUtils";
import { CANOPY_AREA_PER_TREE_M2, type HeatMitigationRecommendation } from "./heatMitigationRecommendation";
import { buildSiteOutcome, type SiteOutcome } from "./siteOutcome";
import { computeHotspotGridCells, type HotspotGridCells } from "./hotspotGridCells";
import {
  simulateROI,
  DEFAULT_ROI_INPUTS,
  estimateCanopyAddedPct,
  estimateCanopyCoolingRangeC,
  type ROIInputs,
  type ROIResult,
} from "./roiSimulator";
import { buildForecastTimeline, type ForecastTimelineSlot } from "./wbgt";
import type { HeatTileRecord, SiteLandcover, SiteLandcoverSpotcheck, HeatForecastEntry } from "./siteRecord";

// Re-exported (not redefined) — lib/heatmapUtils.ts's zoneLabel() is now the
// single source of truth for zone naming (compass labels), imported here so
// existing `import { zoneLabel } from "./reportData"` call sites
// (lib/copilotTools.ts) don't need to change their import path.
export { zoneLabel };

export type ComputeSiteRow = {
  id: string;
  name: string | null;
  created_at: string;
  site_area_m2: number | null;
  landcover: SiteLandcover | null;
  landcover_spotcheck: SiteLandcoverSpotcheck | null;
  heat_tiles: HeatTileRecord[] | null;
  heat_stats:
    | { avgTempC: number; maxTempC: number; minTempC: number; stdDevC: number; tileCount: number; dateUsed?: string; isFallbackDate?: boolean }
    | null;
  heat_forecast: HeatForecastEntry[] | null;
  attribution: { landcover: "real" | "unavailable"; landcover_spotcheck: "real" | "synthetic" | "unavailable"; heat: "real" | "synthetic" | "unavailable" } | null;
  aoi_geometry: Polygon | null;
  satellite_photo_url: string | null;
  roi_inputs: ROIInputs | null;
};

// Fuller query than a plain site-summary fetch (adds aoi_geometry +
// heat_tiles) — needed by anything doing zone-level binning or running the
// recommendation engine, both of which need the raw tiles + a bbox.
// satellite_photo_url is included for the PDF report's Satellite/Heatmap
// Grid image sections (lib/pdf/SiteReportDocument.tsx) — the same saved
// asset the Operational Analyst dashboard's Hotspot Detection columns
// already render, not a new fetch.
const BASE_COLUMNS =
  "id, name, created_at, site_area_m2, landcover, landcover_spotcheck, heat_tiles, heat_stats, heat_forecast, attribution, aoi_geometry, satellite_photo_url";

export async function fetchSiteForCompute(
  siteId: string,
): Promise<{ row: ComputeSiteRow; bbox: [number, number, number, number] | null } | { error: string }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select(`${BASE_COLUMNS}, roi_inputs`)
    .eq("id", siteId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!data) return { error: `No site with id ${siteId}` };

  const row = data as ComputeSiteRow;
  let bbox: [number, number, number, number] | null = null;
  try {
    bbox = row.aoi_geometry ? (turf.bbox(row.aoi_geometry) as [number, number, number, number]) : null;
  } catch {
    bbox = null;
  }
  return { row, bbox };
}

export function zonesFor(row: ComputeSiteRow, bbox: [number, number, number, number] | null): HotspotZone[] {
  if (!row.heat_tiles || row.heat_tiles.length === 0 || !bbox) return [];
  return binTilesToZones(row.heat_tiles, bbox);
}

export type LabeledZone = {
  zoneLabel: string;
  row: number;
  col: number;
  meanTempC: number | null;
  tileCount: number;
  level: string | null;
  rank: number | null;
  isHottest: boolean;
  isCoolest: boolean;
};

// One ROI scenario's inputs + computed result, snapshotted for the PDF
// report — reuses RoiPanel.tsx's own load-time fallback and best/worst-case
// computation verbatim (simulateROI() run twice at the two ends of the
// researched canopy-cooling range), not a re-derivation. `isSaved` tells the
// PDF whether these are the site's actual persisted scenario
// (`sites.roi_inputs`, autosaved from the dashboard's ROI form) or the same
// unmodified default+recommendation seed RoiPanel.tsx shows on first load
// for a site nobody has customized yet — confirmed with the user: always
// show this section either way, but label which case it is.
export type RoiSnapshot = {
  inputs: ROIInputs;
  isSaved: boolean;
  bestResult: ROIResult;
  worstResult: ROIResult;
};

export type SiteReportData = {
  site: {
    id: string;
    name: string | null;
    createdAt: string;
    siteAreaM2: number | null;
    landcover: SiteLandcover | null;
    heatStats: ComputeSiteRow["heat_stats"];
    heatForecast: HeatForecastEntry[] | null;
    attribution: ComputeSiteRow["attribution"];
    aoiGeometry: Polygon | null;
    satellitePhotoUrl: string | null;
  };
  // The same bbox every zone-binning/zone-overlay call above already used —
  // exposed here too so the PDF's image sections can draw the identical 3x3
  // zone grid+label overlay Operational Analyst's Satellite column shows,
  // instead of the images having no zone boundaries at all.
  bbox: [number, number, number, number] | null;
  hotspotZones: LabeledZone[];
  recommendation: HeatMitigationRecommendation;
  // Pixel-grid cells for the PDF's Heatmap Grid image — computed with the
  // exact same function the Operational Analyst dashboard's
  // HotspotPixelGridView.tsx calls (lib/hotspotGridCells.ts), so the two can
  // never draw a different grid for the same site. null when there's no
  // bbox/tiles to grid at all (mirrors HotspotPanel.tsx's own empty state).
  heatGrid: HotspotGridCells | null;
  // Same 5-slot (+0/+3/+6/+9/+12h) timeline ShiftSchedulePanel.tsx renders —
  // buildForecastTimeline() already fills in unavailable slots with a real,
  // computed (never fabricated) targetTime, so the PDF's table can show the
  // exact same rows, including "unavailable" ones, rather than a second,
  // possibly-shorter derivation.
  shiftTimeline: ForecastTimelineSlot[];
  roi: RoiSnapshot;
  // The headline "measured now — recommended action — estimated delta"
  // summary, from lib/siteOutcome.ts — the SAME module (and therefore the
  // same wording, not just the same numbers) the Operational Analyst
  // Overview tab's banner renders. Carried on the report data rather than
  // recomputed inside the PDF component so the AI Copilot's generate_report
  // tool, which serializes this same object, quotes the identical headline.
  outcome: SiteOutcome;
};

export async function buildReportData(siteId: string): Promise<SiteReportData | { error: string }> {
  const result = await fetchSiteForCompute(siteId);
  if ("error" in result) return { error: result.error };
  const { row, bbox } = result;

  const hotspotZones: LabeledZone[] = zonesFor(row, bbox).map((z) => ({
    zoneLabel: zoneLabel(z.row, z.col),
    row: z.row,
    col: z.col,
    meanTempC: z.meanTempC,
    tileCount: z.tileCount,
    level: z.level,
    rank: z.rank,
    isHottest: z.isHottest,
    isCoolest: z.isCoolest,
  }));

  const heatGrid =
    row.heat_tiles && row.heat_tiles.length > 0 && bbox ? computeHotspotGridCells(row.heat_tiles, bbox) : null;

  const shiftTimeline = buildForecastTimeline(row.heat_forecast ?? []);

  // buildSiteOutcome() runs the recommendation engine itself and returns it
  // on `.recommendation`, so this is one engine run shared by the report's
  // Recommendation section, its ROI seeding below, and the headline — not
  // three separate invocations that could, in principle, be fed different
  // inputs.
  const outcome = buildSiteOutcome({
    siteAreaM2: row.site_area_m2,
    landcover: row.landcover,
    landcoverSpotcheck: row.landcover_spotcheck,
    heatTiles: row.heat_tiles,
    heatStats: row.heat_stats,
    attribution: row.attribution,
    bbox,
    forecastTimeline: shiftTimeline,
    savedRoiInputs: row.roi_inputs,
  });
  const recommendation = outcome.recommendation;

  // ROI snapshot — identical fallback + best/worst-case logic to
  // RoiPanel.tsx's own useEffect load handler and live recompute, not a
  // second formula: no saved scenario yet seeds numTrees from this same
  // `recommendation` (0 if the site has no canopy deficit), and the cooling
  // range comes from the exact same estimateCanopyAddedPct/
  // estimateCanopyCoolingRangeC pair the dashboard calls.
  const areaM2 = row.site_area_m2 ?? 0;
  const roiIsSaved = row.roi_inputs != null;
  const roiInputs: ROIInputs =
    row.roi_inputs ??
    ({
      ...DEFAULT_ROI_INPUTS,
      numTrees: recommendation.treeCanopy.status === "deficit" ? recommendation.treeCanopy.recommendedTrees : 0,
    } satisfies ROIInputs);
  const roiCanopyAddedPct = estimateCanopyAddedPct(roiInputs, areaM2, CANOPY_AREA_PER_TREE_M2);
  const roiCoolingRange =
    roiCanopyAddedPct > 0
      ? estimateCanopyCoolingRangeC(roiCanopyAddedPct)
      : { lowC: roiInputs.expectedCoolingC, highC: roiInputs.expectedCoolingC };
  const roi: RoiSnapshot = {
    inputs: roiInputs,
    isSaved: roiIsSaved,
    bestResult: simulateROI({ ...roiInputs, expectedCoolingC: roiCoolingRange.highC }, areaM2),
    worstResult: simulateROI({ ...roiInputs, expectedCoolingC: roiCoolingRange.lowC }, areaM2),
  };

  return {
    site: {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      siteAreaM2: row.site_area_m2,
      landcover: row.landcover,
      heatStats: row.heat_stats,
      heatForecast: row.heat_forecast,
      attribution: row.attribution,
      aoiGeometry: row.aoi_geometry,
      satellitePhotoUrl: row.satellite_photo_url,
    },
    bbox,
    hotspotZones,
    recommendation,
    heatGrid,
    shiftTimeline,
    roi,
    outcome,
  };
}

// Standalone narrative generation for the PDF route (app/api/sites/[id]/report)
// — no chat history/tool-loop context exists there, so this issues its own
// single, non-streaming DeepSeek call rather than reusing
// lib/copilotOrchestrator.ts's turn machinery. Mirrors the `generate_report`
// tool's own instruction text (lib/copilotTools.ts) so the narrative reads
// the same whether it was requested via chat or via the PDF button.
export async function generateReportNarrative(data: SiteReportData): Promise<string> {
  const systemPrompt = [
    "You are the HeatOps AI Copilot writing the narrative section of a PDF site report.",
    "Write a concise, structured summary (headline, key metrics, hotspot findings, recommendation, data-quality caveats) from the JSON site data given by the user.",
    "Only state what the data supports. If heat or land-cover data is marked synthetic/cached/unavailable, say so plainly rather than presenting it as measured fact.",
    "Output PLAIN TEXT ONLY — this is rendered verbatim into a PDF with no markdown parser. Do not use any markdown syntax at all: no **bold**, no # headers, no bullet dashes, no emoji. Use short paragraphs (blank line between them) and plain capitalized labels like 'Data-Quality Caveats:' instead of a markdown heading.",
    "Keep it to about 150-250 words.",
  ].join("\n");

  // heatGrid (up to ~150 per-tile bounds/temp entries) and the AOI polygon's
  // raw coordinate ring add nothing to a narrative summary and would just
  // bloat the prompt — the model gets the same site facts either way via
  // heatStats/hotspotZones, so those two fields are left out here.
  const narrativeInput = {
    site: { ...data.site, aoiGeometry: undefined },
    hotspotZones: data.hotspotZones,
    recommendation: data.recommendation,
  };
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: JSON.stringify(narrativeInput) },
  ];

  // Defense in depth: strip stray markdown the model might still emit
  // despite the plain-text instruction above, so a PDF never shows literal
  // "**" or "#" characters even on an off-run.
  function stripMarkdown(text: string): string {
    return text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^[-*]\s+/gm, "");
  }

  try {
    const message = await chatCompletion(messages);
    return stripMarkdown(message.content ?? "Narrative summary unavailable.");
  } catch (err) {
    // A PDF should still generate even if the LLM call fails — the
    // deterministic sections (metrics, charts, recommendation) don't depend
    // on it, so degrade this one section rather than failing the whole report.
    console.error("[reportData] narrative generation failed:", err);
    return "AI-generated narrative summary is temporarily unavailable. The metrics and recommendation above are computed directly from saved site data and are unaffected.";
  }
}
