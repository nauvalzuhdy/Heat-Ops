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
// Structure: what the site measures now, then the TWO levers that answer it,
// side by side and deliberately in this order —
//   1. Rescheduling. Costs nothing, applies today, and is the lever an
//      operations manager can actually pull this afternoon.
//   2. Canopy investment. Real, but capital spend that pays back over years.
// Leading with the capital option (as this banner first did) buried a free
// safety win under a multi-million-dollar number and made the product read as
// less useful than it is.
//
// Deliberately not a GlowCard: this is a full-width band, not a stat tile in
// the 6-up grid below it, and GlowCard's icon/title/children shape doesn't
// express a two-lever comparison. It reuses severityGlowStyle() so it still
// reads as part of the same card system.
//
// No entrance animation, matching OverviewPanel.tsx's own note: card-level
// fade/slide was removed there for being distracting, and a banner that
// animates while the grid under it doesn't would look like a bug.
import type { ReactNode } from "react";
import { CalendarClock, Trees, Target } from "lucide-react";
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

// One lever. `headline` is the delta — the number a reader should leave with —
// and is the only thing set at display size; everything else supports it.
// When there is no lever to offer, `note` explains why instead, at body size,
// so an absent option never reads as a missing number.
function LeverCard({
  icon,
  eyebrow,
  emphasis,
  action,
  headline,
  detail,
  note,
}: {
  icon: ReactNode;
  eyebrow: string;
  /** True for the free, act-today lever — tinted so it reads as the first move. */
  emphasis?: boolean;
  action: string | null;
  headline: string | null;
  detail: string | null;
  note: string | null;
}) {
  return (
    <div
      className={`rounded-card-sm border p-3 ${
        emphasis ? "border-accent-border bg-accent-soft" : "border-border-subtle"
      }`}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
        <span className={emphasis ? "text-accent" : "text-fg-muted"}>{icon}</span>
        {eyebrow}
      </p>

      {headline ? (
        <>
          {action && <p className="mt-1.5 text-sm font-medium text-fg-primary">{action}</p>}
          <p className="mt-1.5 text-3xl font-bold leading-none tracking-tight text-accent [font-variant-numeric:tabular-nums]">
            {headline}
          </p>
          {detail && <p className="mt-1.5 text-xs text-fg-secondary">{detail}</p>}
        </>
      ) : (
        <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">{note}</p>
      )}
    </div>
  );
}

export default function OutcomeBanner({ outcome }: { outcome: SiteOutcome }) {
  const segments = formatOutcomeSegments(outcome);
  const severity = severityFromOutcome(outcome);
  const { provenance } = outcome;

  const capitalEyebrow =
    outcome.intervention.status === "available" && outcome.intervention.isSavedScenario
      ? "Longer term · your saved scenario"
      : "Longer term · recommended";

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
            because the numbers below it are the largest thing on the page. */}
        <span className="rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-fg-muted">
          Estimate
        </span>
        {provenance.heatSynthetic && <ProvenanceChip text="Cached heat data" />}
        {provenance.canopySynthetic && <ProvenanceChip text="Cached canopy data" />}
        {provenance.fallbackDateUsed && <ProvenanceChip text={`Heat data from ${provenance.fallbackDateUsed}`} />}
      </div>

      {/* --- What the site measures now, full width above both levers --- */}
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

      {/* --- The two levers --- */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <LeverCard
          icon={<CalendarClock className="h-3.5 w-3.5" />}
          eyebrow="Today · no capital"
          emphasis
          action={segments.scheduleAction}
          headline={segments.scheduleDeltaHeadline}
          detail={segments.scheduleDelta}
          note={segments.scheduleNote}
        />
        <LeverCard
          icon={<Trees className="h-3.5 w-3.5" />}
          eyebrow={capitalEyebrow}
          action={segments.action}
          headline={segments.delta}
          detail={segments.economics}
          note={segments.interventionNote}
        />
      </div>

      <p className="mt-3 border-t border-border-subtle pt-2 text-[10px] leading-relaxed text-fg-muted">
        Exposure hours are the forecast hours actually captured for this site (not a continuous window), classified
        against NIOSH limits — see Shift Schedule for each hour and its humidity source.
        {segments.delta && (
          <>
            {" "}
            Cooling is estimated from published canopy-cover research indexed to how much canopy this scenario adds;
            energy and payback use disclosed planning-grade assumptions. Not a measured result for this site — see Heat
            Mitigation Planner for every input, source, and limitation.
          </>
        )}
        {outcome.intervention.status === "available" && outcome.intervention.beyondValidatedRange && (
          <span className="text-severity-caution">
            {" "}
            This scenario adds more canopy than the source studies actually tested, so its cooling figure is a linear
            extrapolation beyond validated range.
          </span>
        )}
      </p>
    </section>
  );
}
