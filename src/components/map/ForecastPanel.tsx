"use client";

import { useEffect, useRef, useState } from "react";
import type { Polygon } from "geojson";
import { FORECAST_HOUR_OFFSETS } from "@/lib/mapConfig";
import { formatForecastTimeLabel, formatForecastDateLabel } from "@/lib/wbgt";
import { formatFallbackDateLabel } from "@/lib/relativeTime";
import { useAnalysisStore } from "@/store/analysisStore";
import { SourceBadge } from "./AreaMetricCard";
import HeatmapImage from "./HeatmapImage";
import type { HeatForecastEntry } from "@/lib/siteRecord";

// Picks the entry whose targetTime (the real moment it's FOR, not
// capturedAt) is most recent — used both for this run's own succeeded
// slots and for a site's previously-stored heat_forecast array.
function mostRecentByTargetTime<T extends { targetTime: string }>(entries: T[]): T | null {
  return entries.reduce<T | null>(
    (latest, e) => (!latest || new Date(e.targetTime) > new Date(latest.targetTime) ? e : latest),
    null
  );
}

function offsetLabel(hourOffset: number): string {
  return hourOffset === 0 ? "Now" : `+${hourOffset}h`;
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md bg-neutral-50 px-2 py-2 dark:bg-neutral-900">
      <span className="text-[10px] text-neutral-500 dark:text-neutral-500">{label}</span>
      <span className="text-sm font-semibold text-neutral-900 dark:text-white">{value}</span>
    </div>
  );
}

// A minimal sparkline over whichever slots have resolved "ok" so far — no
// charting library pulled in just for a 5-point line (Recharts is reserved
// for the Operational Analyst page per project.md §3).
function ForecastSparkline({ points }: { points: { hourOffset: number; meanTempC: number }[] }) {
  if (points.length < 2) return null;

  const width = 240;
  const height = 40;
  const padX = 6;
  const padY = 6;
  const temps = points.map((p) => p.meanTempC);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = max - min || 1;

  const xFor = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const yFor = (t: number) => height - padY - ((t - min) / span) * (height - padY * 2);

  const path = points.map((p, i) => `${xFor(i)},${yFor(p.meanTempC)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Mean temperature trend across selected forecast slots">
      <polyline points={path} fill="none" stroke="#EA580C" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.hourOffset} cx={xFor(i)} cy={yFor(p.meanTempC)} r={2.25} fill="#EA580C" />
      ))}
    </svg>
  );
}

export default function ForecastPanel({ geometry, siteId }: { geometry: Polygon; siteId: string | null }) {
  const heatForecast = useAnalysisStore((s) => s.heatForecast);
  const selectedHourOffset = useAnalysisStore((s) => s.selectedHourOffset);
  const loadingHourOffset = useAnalysisStore((s) => s.loadingHourOffset);
  const capturingForecast = useAnalysisStore((s) => s.capturingForecast);
  const selectForecastSlot = useAnalysisStore((s) => s.selectForecastSlot);

  // Pushes newly-resolved slots onto the already-saved `sites` row so they're
  // available for Operational Analyst later (§4.4/§8) — this panel only
  // covers Map View, storage is as far as this feature goes here.
  const syncedOffsetsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    syncedOffsetsRef.current = new Set();
  }, [siteId]);

  // "Latest available forecast data" fallback (project.md §4.4) — read-only,
  // Supabase-only (GET /api/sites/[id], no FortyGuard call). Only fetched
  // once every one of this run's 5 slots has resolved to something other
  // than "ok" — i.e. there's genuinely nothing current to show — and only
  // once per siteId, since the answer can't change mid-session.
  const [storedFallback, setStoredFallback] = useState<HeatForecastEntry | null>(null);
  const fetchedFallbackForRef = useRef<string | null>(null);
  useEffect(() => {
    setStoredFallback(null);
    fetchedFallbackForRef.current = null;
  }, [siteId]);

  const okOffsets = FORECAST_HOUR_OFFSETS.filter((h) => heatForecast[h]?.status === "ok");
  const captureAttempted = FORECAST_HOUR_OFFSETS.some((h) => heatForecast[h]);
  const allSlotsFailed = !capturingForecast && captureAttempted && okOffsets.length === 0;

  useEffect(() => {
    if (!siteId || !allSlotsFailed) return;
    if (fetchedFallbackForRef.current === siteId) return;
    fetchedFallbackForRef.current = siteId;

    fetch(`/api/sites/${siteId}`)
      .then((res) => res.json())
      .then((body: { heatForecast: HeatForecastEntry[] | null }) => {
        setStoredFallback(body.heatForecast && body.heatForecast.length > 0 ? mostRecentByTargetTime(body.heatForecast) : null);
      })
      .catch((err) => console.error("[forecast] failed to load stored fallback:", err));
  }, [siteId, allSlotsFailed]);

  // `targetTime` orders the slots correctly (it's the requested instant), but
  // the DATE shown must be the one the reading actually came from — otherwise
  // a fallback slot prints today's date over an older measurement.
  const okSlotEntries: { targetTime: string; meanTempC: number; displayTime: string }[] = [];
  for (const h of okOffsets) {
    const slot = heatForecast[h];
    if (slot?.status !== "ok") continue;
    const clock = formatForecastTimeLabel(new Date(slot.targetTime));
    okSlotEntries.push({
      targetTime: slot.targetTime,
      meanTempC: slot.meanTempC,
      displayTime: slot.isFallbackDate && slot.dateUsed ? `${slot.dateUsed}T${clock}:00Z` : slot.targetTime,
    });
  }
  const mostRecentCurrentSlot = mostRecentByTargetTime(okSlotEntries);

  useEffect(() => {
    if (!siteId) return;

    const okOffsets = FORECAST_HOUR_OFFSETS.filter((h) => heatForecast[h]?.status === "ok");
    const hasNewOffset = okOffsets.some((h) => !syncedOffsetsRef.current.has(h));
    if (!hasNewOffset) return;

    const heatForecastEntries = okOffsets.map((h) => {
      const slot = heatForecast[h];
      // okOffsets is already filtered to status === "ok", so this branch is
      // exhaustive in practice — the fallbacks exist only to satisfy the
      // type checker's narrowing, never actually taken.
      return {
        hourOffset: h,
        targetTime: slot.status === "ok" ? slot.targetTime : new Date().toISOString(),
        meanTempC: slot.status === "ok" ? slot.meanTempC : 0,
        cached: slot.status === "ok" ? Boolean(slot.cached) : false,
        capturedAt: slot.capturedAt,
        dateUsed: slot.status === "ok" ? slot.dateUsed : "",
        isFallbackDate: slot.status === "ok" ? slot.isFallbackDate : false,
      };
    });

    fetch("/api/sites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, heatForecast: heatForecastEntries }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`PATCH /api/sites failed: ${res.status}`);
        syncedOffsetsRef.current = new Set(okOffsets);
      })
      .catch((err) => console.error("[forecast] failed to sync heat_forecast to site record:", err));
  }, [heatForecast, siteId]);

  const selectedSlot = selectedHourOffset !== null ? heatForecast[selectedHourOffset] : undefined;
  const sparklinePoints = FORECAST_HOUR_OFFSETS.filter((h) => heatForecast[h]?.status === "ok").map((h) => {
    const slot = heatForecast[h];
    return { hourOffset: h, meanTempC: slot.status === "ok" ? slot.meanTempC : 0 };
  });

  // When FortyGuard has no data for today (see project.md §4.4), every slot
  // that resolved did so from an earlier date — these readings are real, but
  // they are NOT a forecast: they're what those clock times actually measured
  // on `historicalDate`. The panel renames itself accordingly rather than
  // leaving "Forecast +12h" over historical numbers.
  const okSlots = okOffsets.map((h) => heatForecast[h]);
  const isHistoricalProfile =
    okSlots.length > 0 && okSlots.every((s) => s?.status === "ok" && s.isFallbackDate);
  const historicalDate =
    isHistoricalProfile && okSlots[0]?.status === "ok" ? okSlots[0].dateUsed : null;
  const panelTitle = isHistoricalProfile ? "Recent hourly profile" : "Forecast +12h";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{panelTitle}</span>
        {selectedSlot?.status === "ok" && (
          <SourceBadge tone={selectedSlot.cached ? "cached" : "neutral"}>
            {selectedSlot.cached ? "Cached (dev, no credit)" : "Real (FortyGuard)"}
          </SourceBadge>
        )}
      </div>

      {/* Standing expectation-setter (project.md §4.4's known limitation —
          single-hour queries need more data-freshness than FortyGuard can
          always provide) — shown unconditionally, not just when a slot has
          already failed, so an all-"err" row reads as expected rather than
          broken if it happens live during a demo. */}
      {isHistoricalProfile && historicalDate ? (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-medium leading-relaxed text-amber-700 dark:text-amber-400">
          Not a forecast — FortyGuard has no data for today yet, so these are the real readings measured at these
          same clock times on {formatFallbackDateLabel(historicalDate)}.
        </p>
      ) : (
        <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-600">
          Forecast uses recent hourly data from FortyGuard, which may not be available for every slot yet.
        </p>
      )}

      {/* All 5 offsets are now fetched automatically right after Analyze
          succeeds (analysisStore.ts's captureFullForecast) — these buttons
          are for previewing which slot's heatmap renders below, not for
          triggering the fetch itself anymore. A slot FortyGuard genuinely
          never returned data for stays "—"/"err", never a guessed value. */}
      <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-600">
        {capturingForecast
          ? "Capturing the full +12h window from FortyGuard…"
          : "Captured automatically for this AOI. Click a slot to preview its heatmap."}
      </p>

      <div className="grid grid-cols-5 gap-1.5">
        {FORECAST_HOUR_OFFSETS.map((hourOffset) => {
          const slot = heatForecast[hourOffset];
          const isSelected = selectedHourOffset === hourOffset;
          const isLoading = loadingHourOffset === hourOffset || (capturingForecast && !slot);
          // Bug fix (§4.4): this used to show only the relative offset
          // ("+3h") — targetTime (the real clock time this slot is FOR) was
          // already being fetched/stored, just never rendered anywhere in
          // this panel. Only shown once the slot resolves "ok" — a loading
          // or failed slot has no real time to show yet (its final targetTime
          // could still shift if the request retries), so it stays blank
          // rather than guessing.
          const timeLabel = slot?.status === "ok" ? formatForecastTimeLabel(new Date(slot.targetTime)) : null;
          return (
            <button
              key={hourOffset}
              type="button"
              disabled={isLoading}
              onClick={() => selectForecastSlot(geometry, hourOffset)}
              title={slot?.status === "error" ? slot.message : undefined}
              className={`flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-wait ${
                isSelected
                  ? "border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-400 dark:hover:border-neutral-600"
              }`}
            >
              <span>{offsetLabel(hourOffset)}</span>
              {timeLabel && <span className="text-[9px] font-normal opacity-60">{timeLabel}</span>}
              <span className="text-[10px] font-normal opacity-70">
                {isLoading
                  ? "…"
                  : slot?.status === "ok"
                    ? `${slot.meanTempC.toFixed(1)}°`
                    : slot?.status === "error"
                      ? "err"
                      : "—"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Supporting context, never a replacement for the actual slots above
          (project.md §4.4) — a slot that failed stays "err" no matter what
          renders here. */}
      {!capturingForecast && mostRecentCurrentSlot && (
        <p className="text-[11px] text-neutral-500 dark:text-neutral-500">
          <span className="font-medium text-neutral-700 dark:text-neutral-300">Latest available hourly data:</span>{" "}
          {formatForecastDateLabel(new Date(mostRecentCurrentSlot.displayTime))} ·{" "}
          {formatForecastTimeLabel(new Date(mostRecentCurrentSlot.displayTime))} —{" "}
          {mostRecentCurrentSlot.meanTempC.toFixed(1)}°C
        </p>
      )}

      {allSlotsFailed && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-neutral-400 dark:text-neutral-600">Forecast data is currently unavailable.</p>
          {storedFallback && (
            <div className="rounded-md border border-neutral-200 bg-neutral-50 px-2.5 py-2 dark:border-neutral-800 dark:bg-neutral-900">
              <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-500">
                Latest available forecast data
              </p>
              <p className="mt-1 text-sm font-semibold text-neutral-900 dark:text-white">
                {formatForecastDateLabel(new Date(storedFallback.targetTime))} ·{" "}
                {formatForecastTimeLabel(new Date(storedFallback.targetTime))} — {storedFallback.meanTempC.toFixed(1)}°C
              </p>
              <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-600">
                Historical data — not the current forecast.
              </p>
            </div>
          )}
        </div>
      )}

      {selectedHourOffset !== null && (
        <>
          {loadingHourOffset === selectedHourOffset ? (
            <div className="flex items-center gap-2 py-1 text-xs text-neutral-400 dark:text-neutral-600">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-neutral-400 dark:bg-neutral-600" />
              Fetching {offsetLabel(selectedHourOffset)} forecast…
            </div>
          ) : selectedSlot?.status === "error" ? (
            <p className="text-xs text-neutral-400 dark:text-neutral-600">{selectedSlot.message}</p>
          ) : selectedSlot?.status === "ok" ? (
            <>
              <p className="text-[10px] text-neutral-400 dark:text-neutral-600">
                As of {formatForecastTimeLabel(new Date(selectedSlot.targetTime))}
              </p>
              {selectedSlot.isFallbackDate && (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Showing {formatFallbackDateLabel(selectedSlot.dateUsed)} data at this same hour — today&apos;s
                  FortyGuard data isn&apos;t available yet.
                </p>
              )}
              <div className="grid grid-cols-3 gap-2">
                <StatCell label="Min" value={`${selectedSlot.result.stats_data.temperature_stats.minimum.toFixed(1)}°C`} />
                <StatCell label="Mean" value={`${selectedSlot.result.stats_data.temperature_stats.mean.toFixed(1)}°C`} />
                <StatCell label="Max" value={`${selectedSlot.result.stats_data.temperature_stats.maximum.toFixed(1)}°C`} />
              </div>
              <HeatmapImage tiles={selectedSlot.result.map_data.features} aoiGeometry={geometry} />
            </>
          ) : null}
        </>
      )}

      {sparklinePoints.length >= 2 && (
        <div className="flex flex-col gap-1 border-t border-neutral-100 pt-2 dark:border-neutral-900">
          <span className="text-[10px] text-neutral-400 dark:text-neutral-600">Mean temp trend across selected slots</span>
          <ForecastSparkline points={sparklinePoints} />
        </div>
      )}
    </div>
  );
}
