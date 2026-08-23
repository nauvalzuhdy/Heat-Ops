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
// table. Provenance is six explicit rows (Temperature / WBGT / Humidity /
// Workload / Acclimatization / Risk methodology) — Temperature is the one
// row whose value depends on the live `FORTYGUARD_MODE` env var; everything
// else is a fixed, disclosed assumption or a fixed methodology name, true in
// both cached and live mode.
import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  overallShiftRisk,
  ASSUMED_RELATIVE_HUMIDITY_PCT,
  WORKLOAD_LABEL,
  ACCLIMATIZATION_LABEL,
  RISK_METHODOLOGY_LABEL,
  SHIFT_RISK_RECOMMENDATION,
  SHIFT_SCHEDULE_SHORT_ASSUMPTION_TEXT,
  SHIFT_SCHEDULE_METHODOLOGY_BULLETS,
  type ForecastTimelineSlot,
  type ShiftRisk,
} from "@/lib/wbgt";

const RISK_LABELS: Record<ShiftRisk, string> = { safe: "Safe", caution: "Caution", danger: "Danger" };

const RISK_ROW_STYLES: Record<ShiftRisk, string> = {
  safe: "border-l-emerald-500",
  caution: "border-l-amber-500",
  danger: "border-l-red-500",
};

const RISK_BADGE_STYLES: Record<ShiftRisk, string> = {
  safe: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  caution: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
};

const RISK_TEXT_STYLES: Record<ShiftRisk, string> = {
  safe: "text-emerald-600 dark:text-emerald-400",
  caution: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
};

const RISK_CARD_STYLES: Record<ShiftRisk, string> = {
  safe: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
  caution: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30",
  danger: "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/30",
};

const RISK_DOT_COLORS: Record<ShiftRisk, string> = { safe: "#059669", caution: "#d97706", danger: "#dc2626" };

function offsetLabel(offsetHours: number): string {
  return offsetHours === 0 ? "Now" : `+${offsetHours}h`;
}

function ProvenancePill({ text, tone }: { text: string; tone: "real" | "cached" | "derived" }) {
  const styles: Record<typeof tone, string> = {
    real: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    cached: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    derived: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[tone]}`}>{text}</span>;
}

function ProvenanceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</span>
      {children}
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
      <polyline points={path} fill="none" stroke="#94a3b8" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {slots.map((s, i) => (
        <circle key={s.targetTime} cx={xFor(times[i])} cy={yFor(s.wbgtC)} r={3} fill={RISK_DOT_COLORS[s.risk]} />
      ))}
    </svg>
  );
}

type DateGroup = { dateLabel: string; slots: ForecastTimelineSlot[] };

export default function ShiftSchedulePanel({ timeline }: { timeline: ForecastTimelineSlot[] }) {
  const sorted = useMemo(() => [...timeline].sort((a, b) => a.targetTime.localeCompare(b.targetTime)), [timeline]);

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Shift Schedule
        </h2>
        <p className="text-xs text-neutral-400 dark:text-neutral-600">
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

  // Overall risk / recommendation / grouped breakdown are all based only on
  // slots that actually have data — an "Unavailable" slot has no risk to
  // roll into either the worst-case summary or a Safe/Caution/Danger group.
  const overall = overallShiftRisk(available.map((s) => s.risk)) ?? null;

  const byRisk: Record<ShiftRisk, AvailableSlot[]> = { safe: [], caution: [], danger: [] };
  for (const slot of available) byRisk[slot.risk].push(slot);
  const formatList = (list: AvailableSlot[]) => list.map((s) => `${s.dateLabel} ${s.timeLabel}`).join(", ");

  const allCached = available.length > 0 && available.every((s) => s.temperatureSource === "FortyGuard — Cached");
  const allReal = available.length > 0 && available.every((s) => s.temperatureSource === "FortyGuard — Real");
  const tempProvenance = allReal
    ? { text: "FortyGuard — Real", tone: "real" as const }
    : allCached
      ? { text: "FortyGuard — Cached", tone: "cached" as const }
      : { text: "FortyGuard — Mixed", tone: "cached" as const };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Shift Schedule
      </h2>

      {/* Provenance — one row per independent fact, never a single combined
          badge. Temperature is the only row whose value actually depends on
          FORTYGUARD_MODE; everything else is a fixed assumption/methodology
          name true in both cached and live mode. */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
        <ProvenanceRow label="Temperature">
          <ProvenancePill text={tempProvenance.text} tone={tempProvenance.tone} />
        </ProvenanceRow>
        <ProvenanceRow label="WBGT">
          <ProvenancePill text="Estimated" tone="derived" />
        </ProvenanceRow>
        <ProvenanceRow label="Humidity">
          <ProvenancePill text={`Assumed — ${ASSUMED_RELATIVE_HUMIDITY_PCT}% RH`} tone="derived" />
        </ProvenanceRow>
        <ProvenanceRow label="Workload">
          <ProvenancePill text={WORKLOAD_LABEL} tone="derived" />
        </ProvenanceRow>
        <ProvenanceRow label="Acclimatization">
          <ProvenancePill text={ACCLIMATIZATION_LABEL} tone="derived" />
        </ProvenanceRow>
        <ProvenanceRow label="Risk">
          <ProvenancePill text={RISK_METHODOLOGY_LABEL} tone="derived" />
        </ProvenanceRow>
      </div>

      {/* Overall heat risk + action-oriented recommendation, leading. Only
          rendered when at least one slot has data — with zero available
          slots there's nothing deterministic to summarize. */}
      {overall && (
        <div className={`rounded-lg border-2 p-3 ${RISK_CARD_STYLES[overall]}`}>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Heat Risk
          </div>
          <div className={`text-lg font-bold ${RISK_TEXT_STYLES[overall]}`}>{RISK_LABELS[overall]}</div>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Recommendation
          </div>
          <p className="text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">{SHIFT_RISK_RECOMMENDATION[overall]}</p>
        </div>
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
            <h3 className="text-xs font-semibold text-neutral-900 dark:text-white">{group.dateLabel}</h3>
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full min-w-[420px] border-collapse">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
                    <th className="px-3 py-1.5 font-medium">Time</th>
                    <th className="px-3 py-1.5 font-medium">Air Temp</th>
                    <th className="px-3 py-1.5 font-medium">Est. WBGT</th>
                    <th className="px-3 py-1.5 font-medium">Risk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-900">
                  {group.slots.map((slot) =>
                    slot.available ? (
                      <tr key={slot.targetTime} className={`border-l-4 ${RISK_ROW_STYLES[slot.risk]}`}>
                        <td className="px-3 py-1.5 text-xs font-medium text-neutral-900 dark:text-white">
                          {slot.timeLabel} <span className="font-normal text-neutral-400 dark:text-neutral-600">({offsetLabel(slot.offsetHours)})</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-300">{slot.airTemperatureC.toFixed(1)}°C</td>
                        <td className="px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-300">{slot.wbgtC.toFixed(1)}°C</td>
                        <td className="px-3 py-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RISK_BADGE_STYLES[slot.risk]}`}>
                            {RISK_LABELS[slot.risk]}
                          </span>
                        </td>
                      </tr>
                    ) : (
                      <tr key={slot.targetTime} className="border-l-4 border-l-neutral-200 dark:border-l-neutral-800">
                        <td className="px-3 py-1.5 text-xs font-medium text-neutral-400 dark:text-neutral-600">
                          {slot.timeLabel} <span className="font-normal">({offsetLabel(slot.offsetHours)})</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs text-neutral-400 dark:text-neutral-600" colSpan={2}>
                          FortyGuard returned no data for this time slot
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="rounded-full bg-neutral-500/10 px-2 py-0.5 text-[10px] font-semibold text-neutral-500">
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
        <p className="text-[11px] text-neutral-400 dark:text-neutral-600">
          {available.length} of {sorted.length} forecast slots available — see the &quot;Unavailable&quot; row
          {unavailableCount === 1 ? "" : "s"} above for the rest. No value was invented for {unavailableCount === 1 ? "it" : "them"}.
        </p>
      )}

      {/* Grouped breakdown, reworded so an empty Safe group never reads as a
          prohibition, and "Avoid outdoor work" only ever attaches to an
          actual Danger-tier group. Omitted entirely when nothing is
          available to group. */}
      {available.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 p-3 text-xs leading-relaxed dark:border-neutral-800">
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

      <div className="flex flex-col gap-1 text-[10px] text-neutral-400 dark:text-neutral-600">
        <p>{SHIFT_SCHEDULE_SHORT_ASSUMPTION_TEXT}</p>
        <details>
          <summary className="cursor-pointer select-none font-medium text-neutral-500 dark:text-neutral-400">
            Methodology &amp; limitations
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 leading-relaxed">
            {SHIFT_SCHEDULE_METHODOLOGY_BULLETS.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
