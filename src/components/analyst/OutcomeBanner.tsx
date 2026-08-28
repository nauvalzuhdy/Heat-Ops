"use client";

// Headline outcome banner — the first thing on the Overview tab.
//
// Everything it prints comes from lib/siteOutcome.ts's formatOutcomeSegments(),
// verbatim, including the wording — the PDF's matching block
// (lib/pdf/SiteReportDocument.tsx) renders the SAME strings in its own type
// scale. Neither surface paraphrases the other, so the dashboard and the report
// can't state a different headline for one site (the rule lib/heatmapUtils.ts's
// zone binning and lib/reportData.ts already follow for their numbers, applied
// here to the sentence itself).
//
// Deliberately not a GlowCard: this is a full-width band, not a stat tile in
// the 6-up grid below it, and it needs a two-column now → after structure
// GlowCard's icon/title/children shape doesn't express. It reuses
// severityGlowStyle() so it still reads as part of the same card system.
//
// No entrance animation, matching OverviewPanel.tsx's own note: card-level
// fade/slide was removed there for being distracting, and a banner that
// animates while the grid under it doesn't would look like a bug.
import { ArrowRight, ArrowDown, Target } from "lucide-react";
import { severityGlowStyle, type Severity } from "@/lib/severity";
import { formatOutcomeSegments, type SiteOutcome } from "@/lib/siteOutcome";

// The banner's glow follows worker exposure, not peak temperature: a site can
// be hot in the abstract and still have every captured forecast hour inside
// the NIOSH limit, and it's the exposure that drives what an operator does
// tomorrow morning. Falls back to null (no glow, plain surface) when no
// forecast hour was ever captured — never a fabricated "nominal".
function severityFromOutcome(outcome: SiteOutcome): Severity | null {
  if (!outcome.exposure || outcome.exposure.worstRisk == null) return null;
  if (outcome.exposure.worstRisk === "danger") return "critical";
  if (outcome.exposure.worstRisk === "caution") return "caution";
  return "nominal";
}

function ProvenanceChip({ text }: { text: string }) {
  return (
    <span className="rounded-full border border-status-cached/30 bg-status-cached-bg px-2 py-0.5 text-[10px] font-medium text-status-cached">
      {text}
    </span>
  );
}

export default function OutcomeBanner({ outcome }: { outcome: SiteOutcome }) {
  const segments = formatOutcomeSegments(outcome);
  const severity = severityFromOutcome(outcome);
  const { provenance } = outcome;

  const hasAction = segments.action != null && segments.delta != null;

  return (
    <section
      aria-label="Headline outcome"
      className="relative overflow-hidden rounded-card-md border border-border-subtle p-4 shadow-card"
      style={severity ? severityGlowStyle(severity) : { background: "var(--bg-surface)" }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Target className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Headline Outcome</h2>
        {/* This qualifier is not decorative. The cooling figure is a research-
            indexed estimate, not a measurement of this site — data-honesty
            rule 1. It sits next to the heading, not buried in the footnote,
            because the number below it is the largest thing on the page. */}
        <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-fg-muted">
          Estimate
        </span>
        {provenance.heatSynthetic && <ProvenanceChip text="Cached heat data" />}
        {provenance.canopySynthetic && <ProvenanceChip text="Cached canopy data" />}
        {provenance.fallbackDateUsed && <ProvenanceChip text={`Heat data from ${provenance.fallbackDateUsed}`} />}
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
        {/* --- Measured now --- */}
        <div className="flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Measured now</p>
          <p className="mt-1 text-sm font-medium text-fg-primary">{segments.now}</p>
          {segments.exposure && (
            <p
              className={`mt-1 text-xs font-medium ${
                outcome.exposure && outcome.exposure.slotsOverLimit > 0
                  ? severity === "critical"
                    ? "text-severity-critical"
                    : "text-severity-caution"
                  : "text-severity-nominal"
              }`}
            >
              {segments.exposure}
            </p>
          )}
        </div>

        {/* Arrow turns with the layout: the two halves stack on phones (where
            the mobile fix below `md` gives them one column each), so a
            right-pointing arrow there would point at nothing. */}
        <div className="flex shrink-0 items-center justify-center text-fg-muted" aria-hidden>
          <ArrowDown className="h-4 w-4 md:hidden" />
          <ArrowRight className="hidden h-4 w-4 md:block" />
        </div>

        {/* --- After the recommended action --- */}
        <div className="flex-1">
          {hasAction ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                {outcome.intervention.status === "available" && outcome.intervention.isSavedScenario
                  ? "With your saved scenario"
                  : "With the recommended action"}
              </p>
              <p className="mt-1 text-sm font-medium text-fg-primary">{segments.action}</p>
              <p className="mt-1.5 text-3xl font-bold leading-none tracking-tight text-accent [font-variant-numeric:tabular-nums]">
                {segments.delta}
              </p>
              <p className="mt-1.5 text-xs text-fg-secondary">{segments.economics}</p>
            </>
          ) : (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">Recommended action</p>
              <p className="mt-1 text-sm text-fg-secondary">{segments.interventionNote}</p>
            </>
          )}
        </div>
      </div>

      {hasAction && (
        <p className="mt-3 border-t border-border-subtle pt-2 text-[10px] leading-relaxed text-fg-muted">
          Cooling is estimated from published canopy-cover research indexed to how much canopy this scenario adds;
          energy and payback use disclosed planning-grade assumptions. Not a measured result for this site — see Heat
          Mitigation Planner for every input, source, and limitation.
          {outcome.intervention.status === "available" && outcome.intervention.beyondValidatedRange && (
            <span className="text-severity-caution">
              {" "}
              This scenario adds more canopy than the source studies actually tested, so its cooling figure is a linear
              extrapolation beyond validated range.
            </span>
          )}
        </p>
      )}
    </section>
  );
}
