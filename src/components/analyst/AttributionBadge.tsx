// Single source of truth for the Real/Cached/N/A pill used across the
// Operational Analyst page (project.md §5) — split out of app/analyst/page.tsx
// so Sub-task 2 (Hotspot Analysis) can reuse the exact same badge instead of
// redefining its styles a second time (the same drift risk called out for
// lib/landcoverColors.ts).
export type AttributionStatus = "real" | "synthetic" | "unavailable";

const STYLES: Record<AttributionStatus, string> = {
  real: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  synthetic: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  unavailable: "bg-neutral-500/10 text-neutral-500 dark:text-neutral-500",
};

const LABELS: Record<AttributionStatus, string> = { real: "Real", synthetic: "Cached", unavailable: "N/A" };

export default function AttributionBadge({ status }: { status: AttributionStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STYLES[status]}`}>{LABELS[status]}</span>;
}
