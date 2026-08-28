"use client";

// Shared progress bar for the two Analyze phases, so both report progress the
// same way and neither invents a number.
//
// Two visually distinct things, on purpose:
//   - The SOLID fill is determinate and honest: `done / total` where every unit
//     is a network request that actually settled.
//   - The SWEEP over the remaining track is indeterminate. It shows that work is
//     in flight without claiming how far along it is.
//
// The sweep exists because the main analyze phase has only two units (the two
// top-level requests), so a purely determinate bar can only ever read 0%, 50%
// or 100% — it jumps, and between jumps it looks frozen during a 45-90s wait.
// Animating the *remaining* track is the honest fix: motion means "still
// working", and the solid portion still only grows when something real
// finished. Faking a smoothly-climbing percentage would mean inventing a
// completion fraction this app cannot observe (FortyGuard is submit-then-poll;
// Overpass reports nothing until a mirror answers).
export default function StepProgressBar({
  done,
  total,
  busy,
  label,
}: {
  done: number;
  total: number;
  /** True while at least one unit is still in flight — drives the sweep. */
  busy: boolean;
  label: string;
}) {
  const safeTotal = Math.max(1, total);
  const pct = Math.round((Math.min(done, safeTotal) / safeTotal) * 100);

  return (
    <div
      className="relative h-1 w-full overflow-hidden rounded-full bg-border-subtle"
      role="progressbar"
      aria-valuenow={done}
      aria-valuemin={0}
      aria-valuemax={safeTotal}
      aria-label={label}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
        style={{ width: `${pct}%` }}
      />
      {busy && (
        // Sits over the not-yet-done remainder only, so it can never be mistaken
        // for completed progress.
        <div className="absolute inset-y-0 right-0 overflow-hidden" style={{ left: `${pct}%` }} aria-hidden>
          <div className="progress-sweep h-full w-1/2 bg-accent/35" />
        </div>
      )}
    </div>
  );
}
