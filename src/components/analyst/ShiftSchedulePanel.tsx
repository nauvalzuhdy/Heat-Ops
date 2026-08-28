// Shift Schedule (project.md §5, Sub-task 3). Pure presentational component:
// no client state, no new FortyGuard calls — classifies a site's already-
// captured `heat_forecast` slots via lib/wbgt.ts (deterministic, no LLM) and
// renders them grouped by real calendar date.
//
// Quality-pass revision: `timeline` (built server-side by
// lib/wbgt.ts's buildForecastTimeline(), see app/analyst/page.tsx) always has
// exactly 5 entries — one per canonical +0/+3/+6/+9/+12h offset — instead of
// however many happened to be captured. A slot FortyGuard never returned data
// for comes through as `available: false` with a real, computed (never
// fabricated) `targetTime`, so it renders as an explicit "Unavailable" row in
// its correct place on the timeline rather than silently vanishing from the
// table.
//
// Plain-language pass (project.md §5 follow-up): this file is a presentation
// rewrite ONLY — every number/classification still comes straight from
// lib/wbgt.ts, untouched. What changed is what's shown by default:
//   - A big plain-English verdict ("It's too hot for safe outdoor work right
//     now...") now leads the page, driven by the SAME per-slot ShiftRisk
//     classifyShiftRisk() already produced — specifically the captured +0h
//     ("Now") slot's own risk, mapped through a wording table
//     (VERDICT_HEADLINE). No new risk math, just a sentence per existing
//     enum value. A separate small note ("conditions get worse later today")
//     covers the case where a later slot in the window is worse than right
//     now — kept distinct from the headline so "right now" never overstates
//     or understates the current reading.
//   - Technical terms (WBGT, NIOSH, the BOM formula, the 40% RH assumption)
//     that used to sit in an always-visible "Provenance" grid now live behind
//     one collapsed-by-default <details> ("How this is calculated"), or
//     behind a small hover info-dot next to the one or two places (WBGT
//     column header, hero WBGT/Humidity/Workload cards) where the jargon
//     word itself still has to appear.
//   - Hero layout: the site's own photo (satellite_photo_url, falling back
//     to heat_photo_url, falling back to a plain dark gradient) sits behind
//     the verdict + stat cards on desktop (an absolute-positioned overlay);
//     on mobile there's no room to overlay text on a photo legibly, so the
//     photo becomes a normal top strip and the cards stack below it in
//     normal document flow — same content, different composition, driven
//     entirely by Tailwind's `md:` breakpoint (no JS viewport detection).
"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  ASSUMED_RELATIVE_HUMIDITY_PCT,
  WORKLOAD_LABEL,
  ACCLIMATIZATION_LABEL,
  SHIFT_RISK_RECOMMENDATION,
  summarizeHumidityProvenance,
  shiftShortAssumptionText,
  buildShiftMethodologyBullets,
  type ForecastTimelineSlot,
  type ShiftRisk,
} from "@/lib/wbgt";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";
import { severityGlowStyle, SEVERITY_TEXT_CLASS, SEVERITY_BG_CLASS, type Severity } from "@/lib/severity";

const RISK_LABELS: Record<ShiftRisk, string> = { safe: "Safe", caution: "Caution", danger: "Danger" };

// Shift Schedule's 3-tier risk (safe/caution/danger) maps 1:1 onto Overview's
// severity scale (nominal/caution/critical) — same underlying idea ("how
// urgent is this"), different vocabulary for the same 3 tiers. Reusing
// lib/severity.ts's tokens here (instead of this file's own emerald/amber/red
// classes, which used to drift from Overview's palette) is what "satu produk
// yang konsisten" (project.md §5 visual-consistency pass) means in practice.
const RISK_TO_SEVERITY: Record<ShiftRisk, Severity> = { safe: "nominal", caution: "caution", danger: "critical" };

// One plain-language line per risk tier — pairs with the "Danger"/"Caution"/
// "Safe" badge everywhere that badge appears (hero card, table rows), so a
// reader never has to interpret the badge word alone.
const RISK_PLAIN_LABEL: Record<ShiftRisk, string> = {
  safe: "Safe for outdoor work",
  caution: "Caution — limit exposure",
  danger: "Too hot & humid for safe outdoor work",
};

// The hero headline's lead sentence, keyed by the captured "Now" slot's own
// ShiftRisk (see buildVerdictHeadline below) — this table only supplies the
// wording, not which tier gets picked; classifyShiftRisk() in lib/wbgt.ts
// still owns that. The "danger" case gets an "Avoid outdoor work..." clause
// appended below (see
// buildVerdictHeadline), with a real improvement time only when the captured
// forecast actually shows one — never invented.
const VERDICT_HEADLINE: Record<ShiftRisk, string> = {
  safe: "It's safe for outdoor work right now.",
  caution: "Conditions call for caution for outdoor work right now.",
  danger: "It's too hot for safe outdoor work right now.",
};

// Finds the next captured slot, after the last "danger" slot, that is NOT
// "danger" — i.e. the earliest real evidence in this timeline that
// conditions improve, i.e. the first future slot that is NOT "danger".
// Returns null (never a guess) if none was captured — e.g. the whole
// remaining +.."+12h window stays "danger", or that slot's data just wasn't
// captured. `available` must already be time-ascending (the caller's array
// already is), and `nowSlot` must be the slot this improvement is measured
// FROM (the "right now" reading the headline is about).
function findImprovementTimeLabel(available: AvailableSlot[], nowSlot: AvailableSlot): string | null {
  const next = available.find((s) => s.offsetHours > nowSlot.offsetHours && s.risk !== "danger");
  return next ? next.timeLabel : null;
}

// Display-only severity order — used just to phrase "does it get worse
// later today", not a re-derivation of classifyShiftRisk's thresholds, only
// an ordering over its three possible outputs.
const RISK_SEVERITY_ORDER: Record<ShiftRisk, number> = { safe: 0, caution: 1, danger: 2 };

// The worst risk among slots LATER than `nowSlot`, but only returned when
// it's actually worse than right now — otherwise there's nothing extra to
// warn about beyond the headline itself. This is what lets the headline
// stay honestly about "right now" (see buildVerdictHeadline) while still
// surfacing the original forward-looking "watch out later today" signal
// this panel used to fold into one window-wide "overall" verdict.
function findLaterWorseSlot(available: AvailableSlot[], nowSlot: AvailableSlot | null): AvailableSlot | null {
  if (!nowSlot) return null;
  let worst: AvailableSlot | null = null;
  for (const s of available) {
    if (s.offsetHours <= nowSlot.offsetHours) continue;
    if (!worst || RISK_SEVERITY_ORDER[s.risk] > RISK_SEVERITY_ORDER[worst.risk]) worst = s;
  }
  if (!worst || RISK_SEVERITY_ORDER[worst.risk] <= RISK_SEVERITY_ORDER[nowSlot.risk]) return null;
  return worst;
}

// The headline is deliberately about "right now" (nowRisk = the captured
// +0h slot's own classification), NOT the worst risk anywhere in the
// +0..+12h window — those are different claims, and conflating them would
// have the headline say "too hot right now" while the very stat cards right
// below it show a current reading that's actually Safe. A separate
// "conditions get worse later" note (see findLaterWorseSlot, rendered by the
// caller) carries the forward-looking warning instead.
function buildVerdictHeadline(nowRisk: ShiftRisk | null, improvementTimeLabel: string | null): string {
  if (!nowRisk) return "Not enough captured forecast data yet to assess outdoor-work risk for this site.";
  if (nowRisk !== "danger") return VERDICT_HEADLINE[nowRisk];
  const untilClause = improvementTimeLabel ? ` until conditions improve (~${improvementTimeLabel})` : "";
  return `${VERDICT_HEADLINE.danger} Avoid outdoor work${untilClause}.`;
}

const RISK_ROW_STYLES: Record<ShiftRisk, string> = {
  safe: "border-l-severity-nominal",
  caution: "border-l-severity-caution",
  danger: "border-l-severity-critical",
};

// Same tinted-bg + colored-text pattern as every severity badge on Overview
// (SEVERITY_BG_CLASS + SEVERITY_TEXT_CLASS from lib/severity.ts) — this used
// to be its own separate emerald/amber/red definition that could drift from
// Overview's palette; now both read the same --severity-* tokens.
const RISK_BADGE_STYLES: Record<ShiftRisk, string> = {
  safe: `${SEVERITY_BG_CLASS.nominal} ${SEVERITY_TEXT_CLASS.nominal}`,
  caution: `${SEVERITY_BG_CLASS.caution} ${SEVERITY_TEXT_CLASS.caution}`,
  danger: `${SEVERITY_BG_CLASS.critical} ${SEVERITY_TEXT_CLASS.critical}`,
};

const RISK_TEXT_STYLES: Record<ShiftRisk, string> = {
  safe: SEVERITY_TEXT_CLASS.nominal,
  caution: SEVERITY_TEXT_CLASS.caution,
  danger: SEVERITY_TEXT_CLASS.critical,
};

// Hero verdict badge — deliberately its OWN solid palette, not a direct reuse
// of --severity-*-fg: the hero sits over an arbitrary site photo on desktop
// and needs a guaranteed-legible solid fill behind white text. The
// --severity-*-fg tokens are tuned as *text/icon* colors on a dark surface
// (bright in dark mode, e.g. nominal = #4ADE80) — using one of those bright
// values as a solid badge fill would put white text on a light background
// and fail contrast. These stay as their own semantic colors (confirmed:
// same emerald/amber/red hue family as severity, just a shade tuned for a
// solid white-text fill — not a re-derivation of the severity math, a
// different, legitimate contrast need per project.md §5's "yang tidak boleh
// dipaksa sama" carve-out).
const HERO_VERDICT_BADGE_STYLES: Record<ShiftRisk, string> = {
  safe: "bg-emerald-500 text-white",
  caution: "bg-amber-500 text-white",
  danger: "bg-red-600 text-white",
};

// Sparkline dot fill — plain text/icon-style use of the severity fg tokens
// (small marks on a dark surface), the exact context those tokens are tuned
// for, unlike the solid hero badge above.
const RISK_DOT_COLORS: Record<ShiftRisk, string> = {
  safe: "var(--severity-nominal-fg)",
  caution: "var(--severity-caution-fg)",
  danger: "var(--severity-critical-fg)",
};

// Shared text-color pairs for hero content: normal (adaptive light/dark)
// classes on mobile, where the card sits in plain document flow with no
// photo behind it; forced white/near-white on desktop (`md:`), where it
// always sits over the darkened photo overlay regardless of the app's own
// light/dark theme.
const HERO_PRIMARY_TEXT = "text-fg-primary md:text-white";
const HERO_SECONDARY_TEXT = "text-fg-secondary md:text-white/85";
const HERO_MUTED_TEXT = "text-fg-muted md:text-white/65";
const HERO_CARD_CLASS =
  "flex flex-col gap-1 rounded-card-md border border-border-subtle bg-surface p-2.5 md:border-white/15 md:bg-black/35 md:backdrop-blur-sm";

function offsetLabel(offsetHours: number): string {
  return offsetHours === 0 ? "Now" : `+${offsetHours}h`;
}

// Small "i" dot — hover (or keyboard focus) reveals a short plain-English
// explanation of a technical term, so the term itself can stay (e.g. "WBGT"
// in a table header, or a jargon word inside a hero card) without forcing
// every reader to already know it. Pure CSS group-hover/group-focus, no new
// dependency and no JS viewport/interaction logic.
function InfoDot({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <span
        tabIndex={0}
        className="flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-current text-[9px] font-semibold leading-none opacity-60 outline-none"
        aria-label={text}
      >
        i
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-48 -translate-x-1/2 rounded-md bg-neutral-900 px-2 py-1.5 text-[10px] font-normal normal-case leading-relaxed text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-neutral-800"
      >
        {text}
      </span>
    </span>
  );
}

function HeroStatCard({
  label,
  info,
  value,
  sub,
  severity,
}: {
  label: string;
  info?: string;
  value: ReactNode;
  sub?: ReactNode;
  /** When set, this card gets the SAME severity-glow treatment as Overview's
   * stat cards (lib/severity.ts's severityGlowStyle — reused, not
   * redefined) instead of the plain photo-glass HERO_CARD_CLASS. This is
   * what makes the one card that's actually a safe/caution/danger verdict
   * (see "Risk verdict" below) visually match Overview's severity language,
   * as project.md §5's consistency pass asks for. It renders as an opaque
   * surface even on desktop (not the translucent glass the other hero cards
   * use) — deliberately: it's the one card meant to stand out as the key
   * indicator, and severityGlowStyle's background isn't transparent. */
  severity?: Severity;
}) {
  return (
    <div
      className={severity ? `flex flex-col gap-1 rounded-card-md p-2.5 ${CARD_HOVER_CLASS}` : HERO_CARD_CLASS}
      style={severity ? severityGlowStyle(severity) : undefined}
    >
      <div
        className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide ${severity ? "text-fg-muted" : HERO_MUTED_TEXT}`}
      >
        {label}
        {info && <InfoDot text={info} />}
      </div>
      <div className={`text-base font-semibold ${severity ? "text-fg-primary" : HERO_PRIMARY_TEXT}`}>{value}</div>
      {sub && <div className={`text-[10px] leading-snug ${severity ? "text-fg-muted" : HERO_MUTED_TEXT}`}>{sub}</div>}
    </div>
  );
}

type AvailableSlot = Extract<ForecastTimelineSlot, { available: true }>;

// Time-proportional (not index-proportional) — x-position reflects real
// elapsed time between targetTime values, so a run with a missing slot
// doesn't misrepresent the gap as evenly spaced. Only ever plots available
// slots — there's no WBGT to plot for one FortyGuard never returned.
function ShiftSparkline({ slots }: { slots: AvailableSlot[] }) {
  if (slots.length < 2) return null;

  const width = 320;
  const height = 44;
  const padX = 8;
  const padY = 8;
  const times = slots.map((s) => new Date(s.targetTime).getTime());
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const spanT = maxT - minT || 1;
  const wbgts = slots.map((s) => s.wbgtC);
  const minW = Math.min(...wbgts);
  const maxW = Math.max(...wbgts);
  const spanW = maxW - minW || 1;

  const xFor = (t: number) => padX + ((t - minT) / spanT) * (width - padX * 2);
  const yFor = (w: number) => height - padY - ((w - minW) / spanW) * (height - padY * 2);
  const path = slots.map((s, i) => `${xFor(times[i])},${yFor(s.wbgtC)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Estimated WBGT trend across captured forecast slots, positioned by actual time">
      <motion.polyline
        points={path}
        fill="none"
        stroke="#94a3b8"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      />
      {slots.map((s, i) => (
        <motion.circle
          key={s.targetTime}
          cx={xFor(times[i])}
          cy={yFor(s.wbgtC)}
          r={3}
          fill={RISK_DOT_COLORS[s.risk]}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.2 }}
        />
      ))}
    </svg>
  );
}

type DateGroup = { dateLabel: string; slots: ForecastTimelineSlot[] };

// Plain dark industrial-toned gradient — the hero's background when this
// site has neither a satellite nor a heat-capture photo saved. Deliberately
// a CSS gradient, not a fetched stock photo: no external image host is
// approved for this app (see project.md's self-contained/no-new-dependency
// constraints), and a real photo of an unrelated place would misrepresent
// the site.
const HERO_FALLBACK_GRADIENT = "linear-gradient(135deg, #1f2937 0%, #111827 55%, #0b1220 100%)";

export default function ShiftSchedulePanel({
  timeline,
  heatPhotoUrl,
  satellitePhotoUrl,
}: {
  timeline: ForecastTimelineSlot[];
  heatPhotoUrl?: string | null;
  satellitePhotoUrl?: string | null;
}) {
  const sorted = useMemo(() => [...timeline].sort((a, b) => a.targetTime.localeCompare(b.targetTime)), [timeline]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-card-md border border-border-subtle bg-surface p-4 shadow-card">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Shift Schedule
        </h2>
        <p className="text-xs text-fg-muted">
          No forecast slots captured yet for this site — re-analyze it in Map View to capture the +0/+3/+6/+9/+12h
          window.
        </p>
      </div>
    );
  }

  const available = sorted.filter((s): s is AvailableSlot => s.available);
  const unavailableCount = sorted.length - available.length;

  // Consecutive slots already share dateLabel where applicable (sorted by
  // targetTime), so a single linear pass groups correctly without a Map.
  const dateGroups: DateGroup[] = [];
  for (const slot of sorted) {
    const last = dateGroups[dateGroups.length - 1];
    if (last && last.dateLabel === slot.dateLabel) last.slots.push(slot);
    else dateGroups.push({ dateLabel: slot.dateLabel, slots: [slot] });
  }

  // Grouped breakdown (Unrestricted / Caution / Avoid, further below) is
  // based only on slots that actually have data — an "Unavailable" slot has
  // no risk to roll into any group.
  const byRisk: Record<ShiftRisk, AvailableSlot[]> = { safe: [], caution: [], danger: [] };
  for (const slot of available) byRisk[slot.risk].push(slot);
  const formatList = (list: AvailableSlot[]) => list.map((s) => `${s.dateLabel} ${s.timeLabel}`).join(", ");

  const allCached = available.length > 0 && available.every((s) => s.temperatureSource === "FortyGuard — Cached");
  const allReal = available.length > 0 && available.every((s) => s.temperatureSource === "FortyGuard — Real");
  const tempProvenanceLabel = allReal ? "Real" : allCached ? "Cached" : "Mixed";

  // heroSlot is the captured +0h ("Now") slot — falling back to the earliest
  // captured slot only if +0h itself wasn't returned, so the hero still has
  // something concrete to show rather than nothing.
  const heroSlot = available.find((s) => s.offsetHours === 0) ?? available[0] ?? null;
  const nowRisk: ShiftRisk | null = heroSlot?.risk ?? null;
  const improvementTimeLabel = heroSlot && nowRisk === "danger" ? findImprovementTimeLabel(available, heroSlot) : null;
  const verdictHeadline = buildVerdictHeadline(nowRisk, improvementTimeLabel);
  const laterWorseSlot = findLaterWorseSlot(available, heroSlot);
  const heroPhotoUrl = satellitePhotoUrl ?? heatPhotoUrl ?? null;
  // Whether this specific site's slots used FortyGuard-measured humidity, all
  // assumed, or a mix — drives the humidity card's label and the methodology
  // text below, so neither ever claims a measurement a slot did not have.
  const humiditySummary = summarizeHumidityProvenance(timeline);

  return (
    <div className="flex flex-col gap-4">
      {/* HERO — plain-language verdict + at-a-glance stat cards, laid over
          the site's own photo on desktop (project.md §5 follow-up). This is
          the "info utama": designed to fit one ~1080p viewport without
          scrolling. Everything below it (sparkline, per-hour table,
          methodology) is supplementary detail that's fine to scroll to. */}
      <div className="relative overflow-hidden rounded-card-lg border border-border-subtle shadow-card">
        {heroPhotoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroPhotoUrl}
            alt=""
            className="h-40 w-full object-cover md:absolute md:inset-0 md:h-full"
          />
        ) : (
          <div className="h-24 w-full md:absolute md:inset-0 md:h-full" style={{ background: HERO_FALLBACK_GRADIENT }} />
        )}
        {/* Legibility gradient — desktop only, where text sits on top of the
            photo; on mobile the photo is a separate strip above the cards,
            so no overlay is needed there. */}
        <div className="hidden md:absolute md:inset-0 md:block md:bg-gradient-to-t md:from-black/85 md:via-black/50 md:to-black/15" />

        <div className="relative z-10 flex flex-col gap-4 p-4 md:p-6">
          <div className="flex flex-col gap-1.5">
            <span
              className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                nowRisk ? HERO_VERDICT_BADGE_STYLES[nowRisk] : "bg-neutral-500 text-white"
              }`}
            >
              {nowRisk ? RISK_LABELS[nowRisk] : "No data"}
            </span>
            <h1 className={`text-xl font-bold leading-snug sm:text-2xl md:text-3xl ${HERO_PRIMARY_TEXT}`}>
              {verdictHeadline}
            </h1>
            {laterWorseSlot && (
              <p className={`text-xs sm:text-sm ${HERO_SECONDARY_TEXT}`}>
                ⚠ Conditions are expected to reach{" "}
                <span className="font-semibold">{RISK_LABELS[laterWorseSlot.risk]}</span> around{" "}
                {laterWorseSlot.timeLabel} — plan the rest of the shift accordingly.
              </p>
            )}
          </div>

          {/* Quick-glance readings. */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HeroStatCard
              label="Temperature"
              value={heroSlot ? `${heroSlot.airTemperatureC.toFixed(1)}°C` : "—"}
              sub={`FortyGuard — ${tempProvenanceLabel}`}
            />
            <HeroStatCard
              label="WBGT"
              info="Wet Bulb Globe Temperature — a heat-stress index combining air temperature and humidity. Estimated here, not directly measured. See 'How this is calculated' below."
              value={heroSlot ? `${heroSlot.wbgtC.toFixed(1)}°C` : "—"}
              sub="Estimated"
            />
            {/* Humidity is no longer a single global assumption: FortyGuard's
                /v1/env_params supplies a real per-hour reading, so this card shows
                the value THIS slot actually used and says which kind it is. It
                still falls back to the assumption — and still says so — for sites
                saved before that existed, or hours with no reading. */}
            <HeroStatCard
              label="Humidity"
              info={
                heroSlot?.humidityProvenance === "MEASURED"
                  ? "Measured by FortyGuard (/v1/env_params) for this slot's own hour, not assumed — see 'How this is calculated' below."
                  : heroSlot?.humidityProvenance === "CACHED"
                    ? "Cached-mode fixture value, not a measurement — re-analyze this site in live mode for real humidity."
                    : "No measured humidity is stored for this slot, so a fixed " +
                      `${ASSUMED_RELATIVE_HUMIDITY_PCT}% relative-humidity assumption is used — see 'How this is calculated' below.`
              }
              value={`${(heroSlot?.relativeHumidityPct ?? ASSUMED_RELATIVE_HUMIDITY_PCT).toFixed(0)}% RH`}
              sub={
                heroSlot?.humidityProvenance === "MEASURED"
                  ? "FortyGuard — Measured"
                  : heroSlot?.humidityProvenance === "CACHED"
                    ? "FortyGuard — Cached"
                    : "Assumed"
              }
            />
            <HeroStatCard
              label="Workload"
              info="The assumed physical workload and heat-acclimatization status used to pick the applicable safe-exposure limit. See 'How this is calculated' below."
              value={WORKLOAD_LABEL}
              sub={ACCLIMATIZATION_LABEL}
            />
          </div>

          {/* Verdict + recommendation, side by side — the two things a
              reader actually needs to act on. */}
          {nowRisk && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <HeroStatCard
                label="Risk verdict"
                severity={RISK_TO_SEVERITY[nowRisk]}
                value={
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide ${HERO_VERDICT_BADGE_STYLES[nowRisk]}`}
                  >
                    {RISK_LABELS[nowRisk]}
                  </span>
                }
                sub={RISK_PLAIN_LABEL[nowRisk]}
              />
              <div className={HERO_CARD_CLASS}>
                <div className={`text-[10px] font-semibold uppercase tracking-wide ${HERO_MUTED_TEXT}`}>Recommendation</div>
                <p className={`text-xs leading-relaxed ${HERO_SECONDARY_TEXT}`}>{SHIFT_RISK_RECOMMENDATION[nowRisk]}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Honest-provenance banner (project.md §2/§4.4). Without this the table
          reads as a genuine forward forecast, when on a fallback day every row
          is a real reading from an EARLIER date at the same clock time. */}
      {available.some((s) => s.isFallbackDate) && (
        <p className="rounded-card-sm border border-status-cached/40 bg-status-cached-bg px-3 py-2 text-xs font-medium leading-relaxed text-status-cached">
          Not a forward forecast — FortyGuard had no data for the requested day, so these are real readings measured
          at these same clock times on the date shown below.
        </p>
      )}

      <ShiftSparkline slots={available} />

      {/* Date-grouped time series — Date / Time / Air Temp / Estimated WBGT /
          Risk, date shown once as a group heading rather than repeated per
          row. Always all 5 canonical offsets, in their real chronological
          place — a slot FortyGuard never returned data for renders as its
          own explicit "Unavailable" row (with the real, computed target
          time still shown) instead of disappearing from the table. */}
      <div className="flex flex-col gap-3">
        {dateGroups.map((group) => (
          <div key={group.dateLabel} className="flex flex-col gap-1">
            <h3 className="text-xs font-semibold text-fg-primary">{group.dateLabel}</h3>
            <div
              className={`overflow-x-auto rounded-card-md border border-border-subtle bg-surface shadow-card ${CARD_HOVER_CLASS}`}
            >
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-fg-muted">
                    <th className="px-3 py-1.5 font-medium">Time</th>
                    <th className="px-3 py-1.5 font-medium">Air Temp</th>
                    <th className="px-3 py-1.5 font-medium">
                      <span className="inline-flex items-center gap-1">
                        Est. WBGT
                        <InfoDot text="Wet Bulb Globe Temperature — a heat-stress index combining air temperature and humidity. Estimated from air temperature only, not directly measured." />
                      </span>
                    </th>
                    <th className="px-3 py-1.5 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {group.slots.map((slot) =>
                    slot.available ? (
                      <tr key={slot.targetTime} className={`border-l-4 ${RISK_ROW_STYLES[slot.risk]}`}>
                        <td className="px-3 py-1.5 text-xs font-medium text-fg-primary">
                          {slot.timeLabel} <span className="font-normal text-fg-muted">({offsetLabel(slot.offsetHours)})</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-fg-secondary">{slot.airTemperatureC.toFixed(1)}°C</td>
                        <td className="px-3 py-1.5 text-xs text-fg-secondary">{slot.wbgtC.toFixed(1)}°C</td>
                        <td className="px-3 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RISK_BADGE_STYLES[slot.risk]}`}>
                              {RISK_LABELS[slot.risk]}
                            </span>
                            <span className="text-[10px] text-fg-muted">{RISK_PLAIN_LABEL[slot.risk]}</span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={slot.targetTime} className="border-l-4 border-l-border-subtle">
                        <td className="px-3 py-1.5 text-xs font-medium text-fg-muted">
                          {slot.timeLabel} <span className="font-normal">({offsetLabel(slot.offsetHours)})</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-fg-muted" colSpan={2}>
                          FortyGuard returned no data for this time slot
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">
                            Unavailable
                          </span>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {unavailableCount > 0 && (
        <p className="text-[11px] text-fg-muted">
          {available.length} of {sorted.length} forecast slots available — see the &quot;Unavailable&quot; row
          {unavailableCount === 1 ? "" : "s"} above for the rest. No value was invented for {unavailableCount === 1 ? "it" : "them"}.
        </p>
      )}

      {/* Grouped breakdown, reworded so an empty Safe group never reads as a
          prohibition, and "Avoid outdoor work" only ever attaches to an
          actual Danger-tier group. Omitted entirely when nothing is
          available to group. */}
      {available.length > 0 && (
        <div
          className={`flex flex-col gap-1.5 rounded-card-md border border-border-subtle bg-surface p-3 text-xs leading-relaxed text-fg-secondary shadow-card ${CARD_HOVER_CLASS}`}
        >
          <p>
            <span className={`font-semibold ${RISK_TEXT_STYLES.safe}`}>Unrestricted outdoor work:</span>{" "}
            {byRisk.safe.length > 0 ? formatList(byRisk.safe) : "No unrestricted outdoor-work window identified."}
          </p>
          {byRisk.caution.length > 0 && (
            <p>
              <span className={`font-semibold ${RISK_TEXT_STYLES.caution}`}>Caution — limit duration / rotate workers:</span>{" "}
              {formatList(byRisk.caution)}
            </p>
          )}
          {byRisk.danger.length > 0 && (
            <p>
              <span className={`font-semibold ${RISK_TEXT_STYLES.danger}`}>Avoid outdoor work:</span> {formatList(byRisk.danger)}
            </p>
          )}
        </div>
      )}

      {/* Every technical term (WBGT, NIOSH, the BOM approximation formula,
          the 40% RH assumption, ...) lives here now — collapsed by default,
          not shown on page load. */}
      <details
        className={`rounded-card-md border border-border-subtle bg-surface p-3 text-[10px] text-fg-muted shadow-card ${CARD_HOVER_CLASS}`}
      >
        <summary className="cursor-pointer select-none text-xs font-semibold text-fg-secondary">
          How this is calculated
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="leading-relaxed">{shiftShortAssumptionText(humiditySummary)}</p>
          <ul className="list-disc space-y-1 pl-4 leading-relaxed">
            {buildShiftMethodologyBullets(humiditySummary).map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
