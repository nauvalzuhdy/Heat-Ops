// Charts & Metrics tab (project.md §5, Sub-task 5 — scope narrowed to just
// the zone temperature bar chart per the brief; pie land-cover/KPI/time-series
// are explicitly deferred to a later prompt). Own small file, matching the
// existing per-tab-panel pattern (OverviewPanel, HotspotPanel,
// ShiftSchedulePanel, RoiPanel each own their tab) so future chart types can
// be added here without restructuring ContentArea.tsx again.
import ZoneTemperatureBarChart from "./ZoneTemperatureBarChart";
import AttributionBadge, { type AttributionStatus } from "./AttributionBadge";
import type { HeatTileRecord } from "@/lib/siteRecord";

export default function ChartsPanel({
  tiles,
  bbox,
  attribution,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number] | null;
  attribution: AttributionStatus;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Charts &amp; Metrics
      </h2>

      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Temperature by Zone
          </h3>
          <AttributionBadge status={attribution} />
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
          Same 3×3 zone grid and mean temperatures as Hotspot Detection&apos;s Grid Zones tab, colored on the same
          green→yellow→orange→red scale used in Map View&apos;s heatmap.
        </p>
        <ZoneTemperatureBarChart tiles={tiles} bbox={bbox} />
      </div>
    </div>
  );
}
