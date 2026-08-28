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
//   - The two top-level requests resolve independently. They were already issued
//     in parallel, but analysisStore's Promise.all hid their individual timing,
//     so both cards said "Loading…" even when OpenStreetMap had answered in 8s
//     and only FortyGuard's queue was outstanding. Naming which source is still
//     outstanding is the single most useful thing this can say.
//   - A real elapsed clock, read from the store's `startedAt`.
//   - No estimate of remaining time: the dominant term is FortyGuard's own
//     queue, which this app cannot observe. A countdown would be invented.
//
// Scope is deliberately the analyzing phase only. The five forecast slots are
// fetched after the main results land, and AnalyzePanel already reports them
// ("Still capturing the forecast window (N of 5 so far)") once status flips to
// success. Counting them here too would put the bar at 2/7 exactly as this
// component unmounts — a bar the user never sees finish — and duplicate a
// counter that already exists. One phase, one reporter.
import { useEffect, useState } from "react";
import { useAnalysisStore } from "@/store/analysisStore";
import type { AnalysisTaskState } from "@/store/analysisStore";

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

export default function AnalyzeProgress() {
  const progress = useAnalysisStore((s) => s.progress);

  // Ticks only while a run is in flight. `startedAt` is set once by
  // analyzeAOI(), so this reads a real wall-clock delta rather than counting
  // its own renders.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (progress.startedAt == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [progress.startedAt]);

  if (progress.startedAt == null) return null;

  const elapsedSec = Math.max(0, Math.floor((now - progress.startedAt) / 1000));
  const doneSteps = (progress.heatmap !== "pending" ? 1 : 0) + (progress.landcover !== "pending" ? 1 : 0);
  const pct = Math.round((doneSteps / 2) * 100);

  const outstanding: string[] = [];
  if (progress.heatmap === "pending") outstanding.push("FortyGuard");
  if (progress.landcover === "pending") outstanding.push("OpenStreetMap + FortyGuard satellite");

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-fg-secondary">
          {outstanding.length > 0 ? `Waiting on ${outstanding.join(" and ")}…` : "Finishing analysis…"}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-fg-muted">{elapsedSec}s</span>
      </div>

      <div
        className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-border-subtle"
        role="progressbar"
        aria-valuenow={doneSteps}
        aria-valuemin={0}
        aria-valuemax={2}
        aria-label="Analysis progress"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="mt-2 flex flex-col gap-1">
        <StepRow
          state={progress.heatmap}
          label="Surface heatmap"
          detail="FortyGuard /v1/heatmap, submitted then polled until the activity completes"
        />
        <StepRow
          state={progress.landcover}
          label="Land cover + segmentation"
          detail="OpenStreetMap and FortyGuard /v1/satellite, in parallel"
        />
      </ul>

      <p className="mt-2 text-[10px] leading-relaxed text-fg-muted">
        Most of this wait is FortyGuard processing the submitted activity, which this app polls rather than streams —
        there is no partial result before it completes, so no time estimate is shown. Large AOIs may also see
        OpenStreetMap retry across mirrors before responding; that is expected, not stuck. Forecast slots are fetched
        after this, and reported separately. This run consumes API credits.
      </p>
    </div>
  );
}
