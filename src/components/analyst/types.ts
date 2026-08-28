// Shape of one `sites` row (project.md §8) as selected by app/analyst/page.tsx
// — a DB read, not the insert-shape `SiteRecord` from lib/siteRecord.ts, but
// sharing its field-level types rather than redefining them. Lives in its own
// file (rather than inside page.tsx) so every panel component under the icon
// toolbar (OverviewPanel, HotspotPanel, and Sub-task 3+'s panels) can import
// the same type without importing a page.tsx module.
import type { HeatForecastEntry, SiteRecord } from "@/lib/siteRecord";
import type { ROIInputs } from "@/lib/roiSimulator";

// Shift Schedule's per-slot display shape (`ForecastTimelineSlot`, including
// its own dateLabel/timeLabel formatting rationale) lives in lib/wbgt.ts
// alongside `buildForecastTimeline()`, which produces it — not here, so the
// reconstruction logic and its output type can't drift apart.

export type SiteRow = {
  id: string;
  name: string | null;
  created_at: string;
  aoi_geometry: SiteRecord["aoi_geometry"];
  site_area_m2: number | null;
  landcover: SiteRecord["landcover"];
  landcover_spotcheck: SiteRecord["landcover_spotcheck"];
  heat_tiles: SiteRecord["heat_tiles"] | null;
  heat_stats: SiteRecord["heat_stats"];
  heat_forecast: HeatForecastEntry[] | null;
  heat_photo_url: string | null;
  satellite_photo_url: string | null;
  attribution: SiteRecord["attribution"] | null;
  /**
   * The operator's saved Heat Mitigation Planner scenario, or null if they
   * have not customized one yet. Selected on the Overview path — not only
   * RoiPanel's own /api/sites/[id]/roi fetch — so the headline outcome
   * banner states the SAME scenario the PDF report does
   * (lib/reportData.ts seeds its RoiSnapshot from this column too). Without
   * it the banner would silently fall back to the recommendation default and
   * disagree with the report for any site whose scenario was edited.
   */
  roi_inputs: ROIInputs | null;
};
