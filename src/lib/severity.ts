// Severity (risk/urgency level) — Operational Analyst Overview redesign only
// (project.md §5). A THIRD, independent color category from --status-*
// (data provenance: real/cached/simulated) and --accent-* (brand/selection).
// Tokens live in app/globals.css (--severity-*) and tailwind.config.ts
// (colors.severity), single source of truth for both. Never reused by
// lib/landcoverColors.ts (land-cover categories) or lib/thermalColorScale.ts
// (heat gradient) — those keep their own unrelated color scales exactly as
// before.
import type { CSSProperties } from "react";

export type Severity = "nominal" | "caution" | "critical";

export const SEVERITY_LABEL: Record<Severity, string> = {
  nominal: "Nominal",
  caution: "Caution",
  critical: "Critical",
};

export const SEVERITY_TEXT_CLASS: Record<Severity, string> = {
  nominal: "text-severity-nominal",
  caution: "text-severity-caution",
  critical: "text-severity-critical",
};

export const SEVERITY_BG_CLASS: Record<Severity, string> = {
  nominal: "bg-severity-nominal-bg",
  caution: "bg-severity-caution-bg",
  critical: "bg-severity-critical-bg",
};

// Soft glow behind a card — a radial gradient anchored top-left (roughly
// where the icon sits, matching overview.png's reference composition) fading
// to transparent, plus a faint colored ring via box-shadow. Inline style
// (not a Tailwind class) because the color itself is chosen at render time
// per-card from real data, not a static class name Tailwind's compiler could
// see ahead of time.
export function severityGlowStyle(severity: Severity): CSSProperties {
  const glowVar = `var(--severity-${severity}-glow)`;
  return {
    boxShadow: `0 0 0 1px ${glowVar}, 0 0 40px -8px ${glowVar}`,
    // Gradient layer on top of the card's own solid surface color (not
    // Card.tsx's bg-surface class, which an inline `background` shorthand
    // would otherwise fully override) — keeps full contrast everywhere the
    // gradient has faded to transparent instead of showing the page through.
    background: `radial-gradient(120% 100% at 15% 0%, ${glowVar}, transparent 60%), var(--bg-surface)`,
  };
}
