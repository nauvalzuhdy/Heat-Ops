"use client";

// Real progress feedback for an Analyze run (UI feedback pass).
//
// Why this is not a per-tile bar: FortyGuard is submit-then-poll. /v1/heatmap
// returns an activity_id, and the whole tile set arrives in one response the
// moment that activity reaches Completed — a 122-tile run does not deliver tile
// 1 before tile 122. "Processing 47 of 122 tiles" would be an animation
// pretending to be telemetry, which is the same fabrication this codebase
// refuses for measurements (README's data-honesty rules).
//
// What IS real, and what this shows:
//   - The two requests Map View's MAIN result waits for — heatmap and
//     landcover (Overpass) — resolve independently, and this names whichever
//     is still outstanding rather than a single generic "Loading…".
//   - Tree-canopy segmentation (satellite) is tracked as its OWN row,
//     entirely separate from the two above and from the completion caption
//     below (2026-08-29 performance investigation — see
//     store/analysisStore.ts's analyzeAOI() and
//     api/satellite/segmentation/route.ts). It is genuinely independent
//     enrichment, not a dependency of the heat display, and four to five live
//     probes that night found FortyGuard's /v1/satellite taking 174-181s
//     during a service-side degradation before answering "Failed" — bundling
//     it into the main gate meant Map View could not show ANYTHING until
//     that whole wait was over, regardless of how fast heatmap/landcover
//     themselves were. It can still say "pending" even after the main
//     result's own completion caption appears; that is not a bug, it is the
//     honest state of a still-in-flight request that never blocked anything.
//   - A real elapsed clock, read from the store's `startedAt`, ticking live
//     while the run is in flight.
//   - Once heatmap+landcover settle, the live bar is replaced by a short
//     "Completed in Xm Ys · done H:MM AM/PM" caption — a fact about this run,
//     not a running estimate.
//   - No estimate of remaining time while running: the dominant term is
//     FortyGuard's own queue, which this app cannot observe. A countdown
//     would be invented.
//
// The methodology paragraph (why there's no percentage/ETA) is real
// information but reads as a wall of text sitting under every single Analyze
// run — it's a collapsed <details> disclosure so it doesn't compete with the
// run's own status lines, while staying one click away rather than
// disappearing.
//
// Scope is deliberately the analyzing phase's main result + canopy status.
// The five forecast slots have their own equivalent caption in
// ForecastPanel.tsx.
import { useEffect, useState } from "react";
import { useAnalysisStore } from "@/store/analysisStore";
import type { AnalysisTaskState } from "@/store/analysisStore";
import { formatCompletionCaption } from "@/lib/formatDuration";
import StepProgressBar from "./StepProgressBar";

function StepRow({ state, label, detail }: { state: AnalysisTaskState; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
        {state === "done" ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-severity-nominal" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : state === "failed" ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-severity-critical" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M3 3l6 6M9 3l-6 6" strokeLinecap="round" />
          </svg>
        ) : (
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fg-muted" />
        )}
      </span>
      <span className="min-w-0 text-[11px] leading-snug">
        <span className={state === "pending" ? "text-fg-muted" : "text-fg-secondary"}>{label}</span>
        <span className="text-fg-muted"> — {state === "pending" ? detail : state === "done" ? "returned" : "failed"}</span>
      </span>
    </li>
  );
}

/** The canopy status row — shown whether the main result is still running or already done. */
function CanopyRow({ state }: { state: AnalysisTaskState }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-fg-muted">
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
          state === "done" ? "bg-severity-nominal" : state === "failed" ? "bg-severity-critical" : "animate-pulse bg-fg-muted"
        }`}
      />
      <span>
        Tree canopy: {state === "pending" ? "analyzing in the background…" : state === "done" ? "done" : "unavailable this run"}
      </span>
    </div>
  );
}

export default function AnalyzeProgress() {
  const progress = useAnalysisStore((s) => s.progress);

  // Ticks only while the MAIN result is genuinely in flight (started, not
  // yet completed) — satellite settling later never restarts this clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (progress.startedAt == null || progress.completedAt != null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.startedAt, progress.completedAt]);

  if (progress.startedAt == null) return null;

  // Done: a short fact about the main result, not a live view — nothing left
  // to tick for heatmap/landcover. Canopy gets its own row below regardless,
  // since it can genuinely still be "pending" here.
  if (progress.completedAt != null) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <svg viewBox="0 0 12 12" className="h-3 w-3 shrink-0 text-severity-nominal" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path d="M2.5 6.5 5 9l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>{formatCompletionCaption(progress.startedAt, progress.completedAt)}</span>
        </div>
        <CanopyRow state={progress.satellite} />
      </div>
    );
  }

  const elapsedSec = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const doneSteps = (progress.heatmap !== "pending" ? 1 : 0) + (progress.landcover !== "pending" ? 1 : 0);

  const outstanding: string[] = [];
  if (progress.heatmap === "pending") outstanding.push("FortyGuard");
  if (progress.landcover === "pending") outstanding.push("OpenStreetMap");

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-fg-secondary">
          {outstanding.length > 0 ? `Waiting on ${outstanding.join(" and ")}…` : "Finishing analysis…"}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">{elapsedSec}s</span>
      </div>

      <div className="mt-1.5">
        <StepProgressBar done={doneSteps} total={2} busy={outstanding.length > 0} label="Analysis progress" />
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        <StepRow
          state={progress.heatmap}
          label="Surface heatmap"
          detail="FortyGuard /v1/heatmap, submitted then polled until the activity completes"
        />
        <StepRow state={progress.landcover} label="Land cover" detail="OpenStreetMap Overpass" />
      </ul>

      {/* Own row, own line, deliberately not part of the 2-step bar above —
          it is not a dependency of the main result, and this bar is exactly
          the boundary that used to (wrongly) include it. */}
      <div className="mt-2 border-t border-border-subtle pt-2">
        <CanopyRow state={progress.satellite} />
      </div>

      {/* Collapsed by default — the methodology is real and stays reachable,
          but it shouldn't compete with the status lines above on every run. */}
      <details className="mt-2 text-fg-muted">
        <summary className="cursor-pointer select-none text-[10px] font-medium">Why isn&apos;t there a percentage?</summary>
        <p className="mt-1.5 text-[10px] leading-relaxed">
          The solid bar only advances when a request actually returns; the moving band means work is still in flight,
          not a percentage. No time estimate is shown because neither remaining wait is observable from here:
          FortyGuard is polled, not streamed, and OpenStreetMap reports nothing until a mirror answers — on a large
          AOI it retries up to four times across three mirrors, which is the usual reason this step outlasts the
          heatmap. Tree canopy is a separate FortyGuard request that never blocks this result; forecast slots are
          fetched after this and reported separately. This run consumes API credits.
        </p>
      </details>
    </div>
  );
}
