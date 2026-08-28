"use client";

import { useCountUp } from "@/lib/useCountUp";

// Renders a count-up number (project.md §5) — `format` controls the final
// text (decimals, unit, currency, °), the hook only ever animates the raw
// numeric value.
export default function AnimatedNumber({
  value,
  format,
  durationMs = 700,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
}) {
  const animated = useCountUp(value, durationMs);
  return <>{format ? format(animated) : Math.round(animated)}</>;
}
