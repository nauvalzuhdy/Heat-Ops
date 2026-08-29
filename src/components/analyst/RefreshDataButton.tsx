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
// Footprint, deliberately minimal: AnalystTabsShell's header sits above the
// `flex-1` region every tab's content fills, so any height this adds here is
// dashboard height lost below it. A first version showed a permanent
// two-line disclaimer under the button on every render (even idle) plus a
// growing status block after each refresh — visibly shrinking every "fill"
// tab. Fixed by: the disclaimer lives in the button's own `title` tooltip
// (zero permanent space, still reachable on hover) instead of always-visible
// text, and post-refresh feedback is a small inline line that auto-dismisses
// after a few seconds rather than becoming a new permanent fixture.
//
// What this does NOT refresh: the three saved snapshot images (satellite,
// heatmap, segmentation photos) — see app/api/sites/[id]/refresh/route.ts's
// header comment for why. Disclosed via the tooltip below, not hidden.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

// How long the post-refresh caption/error stays visible before this button
// returns to its idle, zero-footprint state — long enough to read, short
// enough not to become a permanent dashboard fixture.
const FEEDBACK_AUTO_DISMISS_MS = 6000;

const BUTTON_TOOLTIP =
  "Re-runs this site's heatmap, land cover, tree-canopy, and +12h forecast against its existing AOI, and updates every tab here. Saved satellite/heatmap/segmentation photos are not refreshed — those only update by re-analyzing from Map View.";

export default function RefreshDataButton({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [state, setState] = useState<RunState>({ phase: "idle" });
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  function scheduleDismiss() {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => setState({ phase: "idle" }), FEEDBACK_AUTO_DISMISS_MS);
  }

  async function handleRefresh() {
    const startedAt = Date.now();
    setState({ phase: "running", startedAt });
    try {
      const res = await fetch(`/api/sites/${siteId}/refresh`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setState({ phase: "error", message: body.error ?? "Refresh failed — the site's existing data was left unchanged." });
        scheduleDismiss();
        return;
      }
      const sections = body.sections as RefreshSections;
      const partial = Object.values(sections).some((s) => s === "failed");
      setState({ phase: "done", startedAt, completedAt: Date.now(), sections, partial });
      scheduleDismiss();
      // Re-fetches this route's Server Components with fresh Supabase data —
      // every tab reading `row` gets the update from this one call.
      router.refresh();
    } catch (err) {
      setState({ phase: "error", message: err instanceof Error ? err.message : "Refresh failed." });
      scheduleDismiss();
    }
  }

  const isRunning = state.phase === "running";

  return (
    // items-center + one row: feedback sits INLINE to the left of the button
    // (truncated, one line) rather than stacking a new line under it, so
    // appearing/disappearing never reflows this shell's own row height.
    <div className="flex min-w-0 items-center gap-2">
      {state.phase === "done" && (
        <span className="flex min-w-0 items-center gap-1 truncate text-[10px] text-fg-muted" title={state.partial ? Object.keys(state.sections).filter((k) => state.sections[k as keyof RefreshSections] === "failed").map((k) => SECTION_LABEL[k as keyof RefreshSections]).join(", ") + " didn't return this time — kept the previous data for those." : undefined}>
          {state.partial ? (
            <AlertTriangle size={11} className="shrink-0 text-severity-caution" />
          ) : (
            <CheckCircle2 size={11} className="shrink-0 text-severity-nominal" />
          )}
          <span className="truncate">
            {formatCompletionCaption(state.startedAt, state.completedAt)}
            {state.partial ? " (partial)" : ""}
          </span>
        </span>
      )}
      {state.phase === "error" && (
        <span className="max-w-[200px] truncate text-[10px] text-severity-critical" title={state.message}>
          {state.message}
        </span>
      )}
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRunning}
        title={BUTTON_TOOLTIP}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
      >
        <RefreshCw size={12} className={isRunning ? "animate-spin" : ""} />
        {isRunning ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
