// Shared severity-glow card primitive (project.md §5 — Overview redesign's
// stat-card treatment, extracted so other Operational Analyst tabs can reuse
// the exact same look instead of redefining it — see ShiftSchedulePanel.tsx,
// which uses this for its safe/caution/danger indicator cards). Single
// source of truth for "a card with a severity-colored glow": icon chip,
// title, optional trend indicator, severity-tinted background gradient +
// ring. Hover treatment is the shared CARD_HOVER_CLASS (border/shadow only —
// no scale, so it can never visually overlap a neighboring card in a tight
// grid; see lib/motionVariants.ts for that fix's history).
import type { ReactNode } from "react";
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";
import { severityGlowStyle, type Severity } from "@/lib/severity";

export default function GlowCard({
  icon: Icon,
  title,
  severity,
  trend,
  children,
}: {
  icon: LucideIcon;
  title: string;
  severity: Severity | null;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  children: ReactNode;
}) {
  return (
    <div
      className={`relative flex flex-col gap-2 overflow-hidden rounded-card-md border border-border-subtle p-3.5 text-fg-primary shadow-card ${CARD_HOVER_CLASS}`}
      style={severity ? severityGlowStyle(severity) : { background: "var(--bg-surface)" }}
    >
      <div className="flex items-center justify-between">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={
            severity
              ? { color: `var(--severity-${severity}-fg)`, background: `var(--severity-${severity}-bg)` }
              : { color: "var(--fg-muted)", background: "var(--bg-surface-2)" }
          }
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        {trend && (
          <span className="flex items-center gap-0.5 text-[10px] font-semibold text-fg-muted">
            {trend.direction === "up" ? (
              <TrendingUp className="h-3 w-3" />
            ) : trend.direction === "down" ? (
              <TrendingDown className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            {trend.label}
          </span>
        )}
      </div>
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{title}</h2>
      {children}
    </div>
  );
}
