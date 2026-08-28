"use client";

import { useEffect, useRef, useState } from "react";

// Simple RAF-driven count-up (project.md §5) — deliberately no
// react-countup dependency, this is the only place it's needed. Eases out
// (cubic) so the count decelerates into its final value rather than
// stopping abruptly.
//
// Animates from whatever is CURRENTLY on screen to the new `value`, not
// from 0 every time — matters for RoiPanel, where the target recomputes on
// every keystroke (live recalculation, not a one-time page-load reveal);
// restarting from 0 on each input change would be distracting, not polished.
export function useCountUp(value: number, durationMs = 700): number {
  const [display, setDisplay] = useState(value);
  const displayRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    const from = displayRef.current;
    const to = value;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
      displayRef.current = to;
      setDisplay(to);
      return;
    }

    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (to - from) * eased;
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return display;
}
