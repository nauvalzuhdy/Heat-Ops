"use client";

// Orchestrates the icon-toolbar architecture for one loaded site: holds
// which tab is active and swaps ContentArea's panel accordingly. All site
// data was already fetched server-side by app/analyst/page.tsx's SiteData —
// switching tabs is a pure client-state change over data already in memory,
// no refetch, no loading state (project.md §5 discovery).
import { useAnalystTabs } from "./useAnalystTabs";
import IconToolbar from "./IconToolbar";
import ContentArea from "./ContentArea";
import RefreshDataButton from "./RefreshDataButton";
import type { SiteRow } from "./types";
import type { ForecastTimelineSlot } from "@/lib/wbgt";

export default function AnalystTabsShell({
  row,
  bbox,
  createdAtLabel,
  createdAtTimeLabel,
  lastUpdatedLabel,
  lastUpdatedTimeLabel,
  forecastTimeline,
}: {
  row: SiteRow;
  bbox: [number, number, number, number] | null;
  createdAtLabel: string;
  createdAtTimeLabel: string;
  lastUpdatedLabel: string;
  lastUpdatedTimeLabel: string;
  forecastTimeline: ForecastTimelineSlot[];
}) {
  const { activeTab, setActiveTab, tabs } = useAnalystTabs();

  return (
    // h-full: fills the exact remaining height page.tsx's wrapper div gives
    // it — this is what lets a "fill" tab (Hotspot Detection) size its map
    // to precisely the available space instead of a fixed px height.
    <div className="flex h-full flex-col gap-3">
      {/* Lives here, not inside one tab, so it stays visible and site-wide
          regardless of which tab is active — see RefreshDataButton.tsx for
          why one refresh here updates every tab. */}
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
            {row.name ?? `Site ${row.id.slice(0, 8)}`}
          </h2>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            Last updated: {lastUpdatedLabel} · {lastUpdatedTimeLabel}
          </p>
        </div>
        <RefreshDataButton siteId={row.id} />
      </div>

      {/* min-h-0 + overflow-y-auto: each tab's content gets exactly this
          much height. A tab whose content naturally fits (or, like Hotspot,
          is built to fill it exactly) never triggers a scrollbar here; a
          tab with genuinely taller content (e.g. a long list) scrolls
          within this region only — the toolbar below always stays put.
          overflow-x-hidden is required alongside overflow-y-auto here too —
          see the matching note in app/analyst/page.tsx for why (the -mx-6
          bleed on the toolbar bar just below otherwise trips a phantom
          horizontal scrollbar that steals height from every tab). */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <ContentArea
          activeTab={activeTab}
          row={row}
          bbox={bbox}
          createdAtLabel={createdAtLabel}
          createdAtTimeLabel={createdAtTimeLabel}
          forecastTimeline={forecastTimeline}
        />
      </div>

      {/* `main` (app/analyst/page.tsx) owns its horizontal padding (px-4 on
          phones, px-6 from `sm` up; no pb — see its comment for why) — this
          matching -mx-4 sm:-mx-6 cancels just the horizontal half so
          the bar reads full-width; no -mb-5 needed since main has no bottom
          padding left to cancel, and a negative bottom margin here would
          make this bar's real box poke out past its h-full parent's edge
          instead of actually saving space. No longer `sticky` either: the
          page no longer scrolls, so a plain flex-col bottom item stays put
          on its own. */}
      <div className="-mx-4 shrink-0 border-t border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 sm:-mx-6">
        <IconToolbar
          tabs={tabs}
          activeTab={activeTab}
          onChange={setActiveTab}
        />
      </div>
    </div>
  );
}
