"use client";

// "🔄 Refresh Latest Data" — new feature (no equivalent existed anywhere in
// this codebase before). Lives in AnalystTabsShell, not one specific tab, so
// it stays visible no matter which tab is active — the whole point is that a
// refresh is site-wide, not scoped to whatever panel happens to be open.
//
// On success, calls Next.js's `router.refresh()` — NOT `window.location.reload()`.
// This is the framework-native mechanism for re-running this route's Server
// Components (app/analyst/page.tsx's SiteData -> fetchSite()) without a full
// browser reload, and it is already how this app's own navigation works: the
// page is `force-dynamic`, so every normal visit re-fetches fresh from
// Supabase. router.refresh() triggers that same re-fetch on demand, and
// because every tab (Overview, Hotspot, Shift Schedule, ROI, PDF button) all
// receive their data from that ONE fetch threaded down through
// AnalystTabsShell -> ContentArea as a single `row` prop, a single refresh
// call updates every one of them — there is no per-panel cache to separately
// invalidate, because there was never a per-panel copy to begin with.
//
// What this does NOT refresh: the three saved snapshot images (satellite,
// heatmap, segmentation photos) — see app/api/sites/[id]/refresh/route.ts's
// header comment for why. Disclosed here, not hidden, via the info line
// below the button.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { formatCompletionCaption } from "@/lib/formatDuration";

type RefreshSections = Record<"heatmap" | "overpass" | "satellite" | "forecast" | "humidity", "updated" | "failed" | "skipped">;

type RunState =
  | { phase: "idle" }
  | { phase: "running"; startedAt: number }
  | { phase: "done"; startedAt: number; completedAt: number; sections: RefreshSections; partial: boolean }
  | { phase: "error"; message: string };

const SECTION_LABEL: Record<keyof RefreshSections, string> = {
  heatmap: "Surface heatmap",
  overpass: "Footprint (Overpass)",
  satellite: "Tree canopy (satellite)",
  forecast: "Forecast +12h",
  humidity: "Humidity",
};

export default function RefreshDataButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [state, setState] = useState<RunState>({ phase: "idle" });

  const isRunning = state.phase === "running";

  async function handleRefresh() {
    const startedAt = Date.now();
    setState({ phase: "running", startedAt });
    try {
      const res = await fetch(`/api/sites/${siteId}/refresh`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setState({ phase: "error", message: body.error ?? "Refresh failed — the site's existing data was left unchanged." });
        return;
      }
      const sections = body.sections as RefreshSections;
      const partial = Object.values(sections).some((s) => s === "failed");
      setState({ phase: "done", startedAt, completedAt: Date.now(), sections, partial });
      // Re-fetches this route's Server Components with fresh Supabase data —
      // every tab reading `row` gets the update from this one call.
      router.refresh();
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Refresh failed." });
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRunning}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <RefreshCw size={13} className={isRunning ? "animate-spin" : ""} />
        {isRunning ? "Refreshing…" : "Refresh Latest Data"}
      </button>

      {state.phase === "done" && (
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="flex items-center gap-1 text-[10px] text-fg-muted">
            {state.partial ? (
              <AlertTriangle size={11} className="text-severity-caution" />
            ) : (
              <CheckCircle2 size={11} className="text-severity-nominal" />
            )}
            {formatCompletionCaption(state.startedAt, state.completedAt)}
          </span>
          {state.partial && (
            <span className="max-w-[220px] text-[10px] leading-snug text-severity-caution">
              {(Object.keys(state.sections) as (keyof RefreshSections)[])
                .filter((k) => state.sections[k] === "failed")
                .map((k) => SECTION_LABEL[k])
                .join(", ")}{" "}
              didn&apos;t return this time — kept the previous data for those.
            </span>
          )}
        </div>
      )}

      {state.phase === "error" && (
        <span className="max-w-[220px] text-right text-[10px] leading-snug text-severity-critical">{state.message}</span>
      )}

      {/* Disclosed, not hidden — see app/api/sites/[id]/refresh/route.ts's
          header comment for why this specific limitation exists. */}
      <span className="max-w-[220px] text-right text-[10px] leading-snug text-fg-muted">
        Updates numbers, forecast, canopy %, and ROI. Saved snapshot images update only when re-analyzed from Map
        View.
      </span>
    </div>
  );
}
