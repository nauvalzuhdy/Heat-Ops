// Shift Schedule (project.md §5, Sub-task 3). ISO 7243 / NIOSH REL heat-stress
// limits are published in WBGT (Wet Bulb Globe Temperature) — a measurement
// that combines air temperature, humidity, wind, and radiant heat. FortyGuard
// only gives us 2m air temperature (`heat_forecast[].meanTempC`, project.md
// §4.4) — no humidity, wind, or solar radiation. This module makes that gap
// explicit rather than quietly treating air temperature as WBGT:
//   1. `estimateWBGT()` approximates WBGT from air temperature using a fixed,
//      disclosed relative-humidity assumption (see ASSUMED_RELATIVE_HUMIDITY_PCT)
//      instead of measured humidity.
//   2. `classifyShiftRisk()` compares that estimate against a published NIOSH
//      REL WBGT ceiling table, for a fixed, disclosed workload/acclimatization
//      combination (see NIOSH_REL_WBGT_C / DEFAULT_WORKLOAD / DEFAULT_ACCLIMATIZATION).
// Every number here is sourced or explicitly disclosed as an assumption — see
// SHIFT_SCHEDULE_ASSUMPTIONS_TEXT, which the UI must surface (same pattern as
// project.md §5.1's ASSUMPTION_KWH_PER_M2_PER_DEGREE).
//
// Provider-agnostic by construction, not by convention: `HeatForecastEntry`'s
// `cached` flag comes straight from `runHeatmapGeneration()`'s own return
// (lib/fortyguard.ts), which is `true` only when `isCachedMode()` served a
// fixture and `false` on a real completed FortyGuard call — this module never
// hardcodes which mode is active. The cached fixture generator
// (lib/fortyguardFixtures.ts) is type-checked against the exact same
// `HeatmapResult` shape the real API response satisfies (see
// `runHeatmapGeneration`'s return type), so everything downstream of it —
// `meanTempC`, this module's WBGT/risk derivation, `targetTime` (computed in
// app/api/heatmap/route.ts from wall-clock arithmetic, identically regardless
// of provider) — runs through one shared pipeline either way. Flipping
// `FORTYGUARD_MODE=live` changes which branch of `runHeatmapGeneration` runs
// and therefore what `cached`/`temperatureSource` reports; it changes no code
// in this file, ShiftSchedulePanel, or anything between them.
import { FORECAST_HOUR_OFFSETS } from "./mapConfig";

// Simplified outdoor (shade / no direct solar radiation) WBGT approximation
// from the Australian Bureau of Meteorology, requiring only air temperature
// and relative humidity: WBGT ≈ 0.567·Ta + 0.393·e + 3.94, where `e` is water
// vapor pressure (hPa) derived from Ta and RH via the standard
// Magnus/Bernard approximation. This is the formula most WBGT-estimation
// tools fall back to when the full outdoor formula's globe-temperature term
// (radiant heat) isn't measurable — which is exactly our situation.
function vaporPressureHpa(airTempC: number, relativeHumidityPct: number): number {
  return (relativeHumidityPct / 100) * 6.105 * Math.exp((17.27 * airTempC) / (237.7 + airTempC));
}

// No humidity data exists anywhere in a saved `sites` record (heat_forecast
// only carries {hourOffset, meanTempC, capturedAt} — project.md §4.4) and
// Operational Analyst is not allowed to call FortyGuard's /v1/env_params for
// real humidity (§5 intro: no new FortyGuard calls from this page). 40% is a
// deliberately middle-of-the-road stand-in — not measured, not per-site —
// since saved sites span both arid (Phoenix) and humid (Houston) climates in
// this project's own demo data. A humid site's true WBGT runs higher than
// this estimate (understating risk there); an arid site's runs lower
// (overstating it here). Disclosed in the UI, not hidden.
export const ASSUMED_RELATIVE_HUMIDITY_PCT = 40;

export function estimateWBGT(airTempC: number, relativeHumidityPct: number = ASSUMED_RELATIVE_HUMIDITY_PCT): number {
  const e = vaporPressureHpa(airTempC, relativeHumidityPct);
  return 0.567 * airTempC + 0.393 * e + 3.94;
}

export type Workload = "light" | "moderate" | "heavy" | "very_heavy";
export type Acclimatization = "unacclimatized" | "acclimatized";

// NIOSH Recommended Exposure Limit (REL) WBGT ceiling values for continuous
// (100%) work, by workload category and acclimatization status — published
// in NIOSH's 2016 "Criteria for a Recommended Standard: Occupational
// Exposure to Heat and Hot Environments" (publication 2016-106), reproduced
// as "Table 2. Heat stress recommendations, adapted from NIOSH guidelines
// (2016)" on OSHA's Heat Hazard Recognition page
// (osha.gov/heat-exposure/hazards). Values in °C WBGT.
export const NIOSH_REL_WBGT_C: Record<Workload, Record<Acclimatization, number>> = {
  light: { unacclimatized: 28, acclimatized: 30 },
  moderate: { unacclimatized: 25, acclimatized: 28 },
  heavy: { unacclimatized: 23, acclimatized: 26 },
  very_heavy: { unacclimatized: 21, acclimatized: 25 },
};

// Confirmed with the user before writing this file (not guessed, per
// project.md §10's rule to ask rather than assume undocumented parameters):
// "Moderate" workload (walking + moderate lifting/carrying, typical of
// outdoor site work) and "Unacclimatized" (the more protective default when
// a given site's workers' heat-adaptation status is unknown).
export const DEFAULT_WORKLOAD: Workload = "moderate";
export const DEFAULT_ACCLIMATIZATION: Acclimatization = "unacclimatized";

// Display labels for the two config assumptions above — surfaced explicitly
// in the UI (provenance block) rather than left implicit, so a reviewer can
// see exactly which row of NIOSH_REL_WBGT_C produced the thresholds without
// reading source. "(default)" on acclimatization flags it as the more
// protective stand-in used because a given site's actual worker
// acclimatization status is never known from saved site data.
export const WORKLOAD_LABEL = DEFAULT_WORKLOAD.charAt(0).toUpperCase() + DEFAULT_WORKLOAD.slice(1).replace("_", " ");
export const ACCLIMATIZATION_LABEL =
  DEFAULT_ACCLIMATIZATION.charAt(0).toUpperCase() + DEFAULT_ACCLIMATIZATION.slice(1) + " (default)";

// Names the methodology, not the computed value — pairs with the actual
// "Heat Risk: Safe/Caution/Danger" result shown elsewhere, so neither one on
// its own could be read as a certified individual safety assessment.
export const RISK_METHODOLOGY_LABEL = "NIOSH-based screening estimate";

export type ShiftRisk = "safe" | "caution" | "danger";

// Three tiers, both boundaries taken directly from NIOSH_REL_WBGT_C for the
// chosen workload — no invented margin:
//   Safe    — at or below the unacclimatized limit (fine even for a worker
//             who isn't heat-adapted).
//   Caution — above the unacclimatized limit but at/below the acclimatized
//             one (risky for unacclimatized workers; an acclimatized worker
//             is still within the recommended limit).
//   Danger  — above the acclimatized limit (exceeds the recommended
//             exposure limit regardless of acclimatization).
export function classifyShiftRisk(wbgtC: number, workload: Workload = DEFAULT_WORKLOAD): ShiftRisk {
  const { unacclimatized, acclimatized } = NIOSH_REL_WBGT_C[workload];
  if (wbgtC <= unacclimatized) return "safe";
  if (wbgtC <= acclimatized) return "caution";
  return "danger";
}

// One-line version for the primary UI (the full sourcing below is collapsed
// behind "Methodology & limitations" — verbose provenance text was crowding
// out the actual schedule, and repeating it in both places would just be the
// same disclosure twice). Built from the same constant as the long text so
// the two can never disagree on the RH assumption.
export const SHIFT_SCHEDULE_SHORT_ASSUMPTION_TEXT =
  `WBGT is estimated from FortyGuard air temperature using an assumed ${ASSUMED_RELATIVE_HUMIDITY_PCT}% relative ` +
  `humidity and a shade WBGT approximation. It is not a direct or certified WBGT measurement.`;

// Worst (most severe) risk among a set of captured slots — deterministic,
// same three-tier ordering classifyShiftRisk() already uses. Returns null
// for an empty list (nothing captured yet) rather than defaulting to "safe",
// which would misrepresent "no data" as "confirmed safe".
const RISK_SEVERITY: Record<ShiftRisk, number> = { safe: 0, caution: 1, danger: 2 };

export function overallShiftRisk(risks: ShiftRisk[]): ShiftRisk | null {
  if (risks.length === 0) return null;
  return risks.reduce((worst, r) => (RISK_SEVERITY[r] > RISK_SEVERITY[worst] ? r : worst));
}

// Action-oriented, per the explicit rule: never say "avoid outdoor work" for
// anything short of Danger, and never phrase Danger as an absolute
// prohibition either — real sites sometimes can't just stop, so the wording
// gives the actual mitigation path (heat controls / rotation / hydration /
// supervision) rather than a bare "don't".
export const SHIFT_RISK_RECOMMENDATION: Record<ShiftRisk, string> = {
  safe: "Outdoor work is within recommended limits across the captured forecast window — continue standard site safety practices.",
  caution: "Limit continuous exposure and increase recovery/rest periods or rotate workers during flagged periods.",
  danger:
    "Avoid outdoor work during flagged periods where feasible. If work must continue, apply appropriate heat " +
    "controls, rest/recovery periods, worker rotation, hydration, and supervision according to the site's safety protocol.",
};

// Per-slot classified shape (Sub-task 3's timestamp-based revision) — every
// field's provenance is explicit and never conflated: `airTemperatureC` is
// the one real/cached FortyGuard input; everything else here is derived at
// render time from it, not stored (see lib/siteRecord.ts's HeatForecastEntry
// comment for why WBGT/risk aren't persisted to Supabase — recomputing from
// the one stored raw temperature keeps them from ever drifting out of sync
// with this module's own current formula/thresholds).
export type TemperatureSource = "FortyGuard — Real" | "FortyGuard — Cached";

export type ClassifiedForecastSlot = {
  targetTime: string; // ISO 8601 — the real date+time this slot is FOR, straight from HeatForecastEntry.targetTime
  offsetHours: number;
  airTemperatureC: number;
  temperatureSource: TemperatureSource;
  wbgtC: number;
  wbgtProvenance: "ESTIMATED";
  risk: ShiftRisk;
};

export function classifyForecastEntry(entry: {
  hourOffset: number;
  targetTime: string;
  meanTempC: number;
  cached: boolean;
}): ClassifiedForecastSlot {
  const wbgtC = estimateWBGT(entry.meanTempC);
  return {
    targetTime: entry.targetTime,
    offsetHours: entry.hourOffset,
    airTemperatureC: entry.meanTempC,
    temperatureSource: entry.cached ? "FortyGuard — Cached" : "FortyGuard — Real",
    wbgtC,
    wbgtProvenance: "ESTIMATED",
    risk: classifyShiftRisk(wbgtC),
  };
}

// Bullet list for the collapsible "Methodology & limitations" section — kept
// as an array (not one paragraph) so the UI can render actual list items
// instead of a run-on sentence, and so it can elaborate on each point without
// literally repeating SHIFT_SCHEDULE_SHORT_ASSUMPTION_TEXT's wording above.
export const SHIFT_SCHEDULE_METHODOLOGY_BULLETS: string[] = [
  "FortyGuard provides air temperature at the site, not a direct WBGT measurement.",
  "This site's saved data does not include measured humidity, wind speed, or radiant heat.",
  `Relative humidity is assumed at a fixed ${ASSUMED_RELATIVE_HUMIDITY_PCT}% — not measured, not per-site.`,
  "WBGT is approximated using the Australian Bureau of Meteorology's shade formula (WBGT ≈ 0.567·T + 0.393·e + 3.94).",
  "The result is an estimate for screening purposes, not a certified WBGT measurement.",
  `Risk bands use NIOSH's 2016 Recommended Exposure Limits (via OSHA's Heat Hazard Recognition table) for ` +
    `${WORKLOAD_LABEL.toLowerCase()} work, ${ACCLIMATIZATION_LABEL.toLowerCase()}: Safe at/below ` +
    `${NIOSH_REL_WBGT_C[DEFAULT_WORKLOAD].unacclimatized}°C WBGT, Caution up to ` +
    `${NIOSH_REL_WBGT_C[DEFAULT_WORKLOAD].acclimatized}°C WBGT, Danger above that.`,
];

// Kept for any caller still expecting one paragraph (e.g. a plain-text
// tooltip) — same content as the bullets above, just joined.
export const SHIFT_SCHEDULE_ASSUMPTIONS_TEXT = SHIFT_SCHEDULE_METHODOLOGY_BULLETS.join(" ");

// ---------------------------------------------------------------------------
// Timestamp formatting — deliberately NOT Intl.toLocale*DateString/TimeString.
// Those resolve a locale from the runtime environment, and this project
// formats these labels once, server-side, in a Server Component
// (app/analyst/page.tsx) specifically to avoid a hydration mismatch (Next.js
// still server-renders the "use client" tree once before hydrating it, so a
// locale-dependent call inside the client component itself could format
// differently server vs. browser). That's the right fix for the mismatch
// risk, but Intl's locale resolution can ALSO pick a decimal separator
// ("16.02") instead of a colon ("16:02") depending on the server's resolved
// locale — ambiguous, and easy to misread as a fraction. Manual, fixed-format
// arithmetic sidesteps both problems at once: guaranteed "DD Mon YYYY" /
// "HH:MM" output, no locale dependency at all.
const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatForecastDateLabel(date: Date): string {
  return `${pad2(date.getDate())} ${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatForecastTimeLabel(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Reconstructs the full 5-slot +0/+3/+6/+9/+12h timeline from whatever subset
// of `heat_forecast` actually exists, WITHOUT fabricating any temperature.
// Missing slots come back `available: false` — their `targetTime` is real,
// computed arithmetic (the exact same "anchor + offset" the API route itself
// used to build the FortyGuard request in the first place, see
// app/api/heatmap/route.ts), never a guessed reading. Requires at least one
// real captured entry to anchor from; returns [] if none exist.
export type ForecastTimelineSlot =
  | (ClassifiedForecastSlot & {
      dateLabel: string;
      timeLabel: string;
      available: true;
      /** True when this reading came from an earlier date than the slot was requested for. */
      isFallbackDate: boolean;
    })
  | {
      available: false;
      offsetHours: number;
      targetTime: string;
      dateLabel: string;
      timeLabel: string;
      isFallbackDate: false;
    };

export function buildForecastTimeline(
  entries: {
    hourOffset: number;
    targetTime: string;
    meanTempC: number;
    cached: boolean;
    dateUsed?: string;
    isFallbackDate?: boolean;
  }[]
): ForecastTimelineSlot[] {
  const valid = entries.filter((e) => typeof e.targetTime === "string");
  if (valid.length === 0) return [];

  // Any one real entry lets us derive the "Now" (+0h) reference instant —
  // subtract its own offset back out — regardless of which specific offsets
  // actually succeeded.
  const anchorMs = new Date(valid[0].targetTime).getTime() - valid[0].hourOffset * 3_600_000;
  const byOffset = new Map(valid.map((e) => [e.hourOffset, e]));

  return FORECAST_HOUR_OFFSETS.map((offset) => {
    const entry = byOffset.get(offset);
    if (entry) {
      const classified = classifyForecastEntry(entry);
      const d = new Date(classified.targetTime);
      // `targetTime` is the instant the slot was REQUESTED for (now + offset).
      // When FortyGuard had no data for that date and the request fell back to
      // an earlier one (project.md §2/§4.4), the reading actually describes
      // `dateUsed` at this same clock time — so that is the date shown. Using
      // targetTime's date here is what made Shift Schedule print "28 Aug" over
      // numbers measured on the 26th.
      const labelDate =
        entry.isFallbackDate && entry.dateUsed
          ? new Date(`${entry.dateUsed}T${formatForecastTimeLabel(d)}:00Z`)
          : d;
      return {
        ...classified,
        dateLabel: formatForecastDateLabel(labelDate),
        timeLabel: formatForecastTimeLabel(d),
        available: true as const,
        isFallbackDate: Boolean(entry.isFallbackDate),
      };
    }
    const d = new Date(anchorMs + offset * 3_600_000);
    return {
      available: false as const,
      offsetHours: offset,
      targetTime: d.toISOString(),
      dateLabel: formatForecastDateLabel(d),
      timeLabel: formatForecastTimeLabel(d),
      isFallbackDate: false as const,
    };
  });
}
