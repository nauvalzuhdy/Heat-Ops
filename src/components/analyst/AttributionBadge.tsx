// Single source of truth for the Real/Cached/N/A pill used across the
// Operational Analyst page (project.md §5) — split out of app/analyst/page.tsx
// so Sub-task 2 (Hotspot Analysis) can reuse the exact same badge instead of
// redefining its styles a second time (the same drift risk called out for
// lib/landcoverColors.ts).
//
// Visual-consistency pass: these used to be hardcoded emerald/amber/neutral
// Tailwind classes, even though app/globals.css / tailwind.config.ts already
// define a --status-real/cached/unavailable token group for exactly this
// concept ("data provenance") — this badge just wasn't reading them yet.
// Switching to those tokens means every tab that renders this badge
// (Overview, Hotspot, Charts, ROI) now shares one literal color definition
// instead of five near-identical ones.
export type AttributionStatus = "real" | "synthetic" | "unavailable";

const STYLES: Record<AttributionStatus, string> = {
  real: "bg-status-real-bg text-status-real",
  synthetic: "bg-status-cached-bg text-status-cached",
  unavailable: "bg-status-unavailable-bg text-status-unavailable",
};

const LABELS: Record<AttributionStatus, string> = { real: "Real", synthetic: "Cached", unavailable: "N/A" };

export default function AttributionBadge({ status }: { status: AttributionStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STYLES[status]}`}>{LABELS[status]}</span>;
}
