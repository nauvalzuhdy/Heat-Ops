// Shared status badge (visual redesign, Phase 1). Unifies the vocabulary the
// redesign brief asks for everywhere data provenance/computation type is
// shown: Real / Cached / Simulated / N/A. Deliberately generic — it does not
// decide what's real/synthetic/simulated for any given number, it only
// renders whatever status the caller already computed (e.g.
// components/analyst/AttributionBadge.tsx's existing "real"|"synthetic"|
// "unavailable" classification, unchanged, now just rendered through this
// shared primitive instead of its own one-off styles).
import type { ReactNode } from "react";

export type BadgeVariant = "real" | "cached" | "simulated" | "unavailable" | "neutral" | "accent";

const STYLES: Record<BadgeVariant, string> = {
  real: "bg-status-real-bg text-status-real",
  cached: "bg-status-cached-bg text-status-cached",
  simulated: "bg-status-simulated-bg text-status-simulated",
  unavailable: "bg-status-unavailable-bg text-status-unavailable",
  neutral: "bg-surface-2 text-fg-secondary",
  accent: "bg-accent-soft text-accent",
};

const DEFAULT_LABELS: Record<BadgeVariant, string> = {
  real: "Real",
  cached: "Cached",
  simulated: "Simulated",
  unavailable: "N/A",
  neutral: "",
  accent: "",
};

export default function Badge({ variant, children, className = "" }: { variant: BadgeVariant; children?: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STYLES[variant]} ${className}`}
    >
      {children ?? DEFAULT_LABELS[variant]}
    </span>
  );
}
