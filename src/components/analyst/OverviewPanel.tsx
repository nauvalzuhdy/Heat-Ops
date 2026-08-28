// Sub-task 1 content — extracted out of app/analyst/page.tsx's `SiteData` so
// it can sit behind the Overview tab of the icon toolbar (project.md §5
// discovery: Sub-task 2-8 must not all pile up as stacked cards on one page).
//
// Visual redesign (project.md §5 "Overview -- mission-control aesthetic"):
// composition-only reference is src/public/overview.png (icon+trend+number+
// label stat cards, severity-colored glow, a radial gauge, a distinct AI
// insight card, a line chart with grid+legend) — its own orange/red/purple-
// on-dark-blue COLORS were explicitly not copied; every color below is one of
// this project's own existing tokens (app/globals.css / tailwind.config.ts)
// plus the new --severity-* category added alongside them for this feature.
// No data, calculation, or structural change from the pre-redesign version —
// every number rendered here comes from the exact same `row`/`bbox`/
// `forecastTimeline` props as before, the same source Hotspot Detection,
// Shift Schedule, and ROI Simulator already trust; only the chrome around
// those numbers changed.
//
// Severity mapping (confirmed with user: "semua kartu dapat severity" — every
// stat card carries a severity, not just some):
//   Site Info      -> always "nominal". No risk dimension exists in an id/
//                      area/timestamp; "nominal" here means "no known
//                      concern", not a fabricated risk score.
//   Land-cover     -> lib/heatMitigationRecommendation.ts's treeCanopy.status:
//                      deficit -> caution, benchmark_met/unavailable -> nominal.
//   Heat Stats     -> lib/heatmapUtils.ts's classifyLevel(maxTempC).
//   Forecast +12h  -> classifyLevel(max forecast temp), trend arrow from the
//                      real first-vs-last available slot delta (no fabricated
//                      second series).
//   Attribution    -> nominal if every field is "real", caution otherwise
//                      (covers both "synthetic" and "unavailable").
//   Hotspot Exposure (new radial-gauge card) -> heatMitigationRecommendation's
//                      existing hotspotFractionOfTiles metric (already used by
//                      the Heat Mitigation Planner) against newly-disclosed
//                      thresholds: <20% nominal, 20-50% caution, >50% critical.
// A card with no underlying data at all (row.heat_stats null, etc.) keeps its
// existing "Unavailable for this site" empty state and gets no severity glow
// — there's nothing to grade.
//
// "use client" (micro-animation pass, project.md §5): needed for the
// progressive line-draw (ForecastSparkline) + count-up stat numbers below —
// this panel took no server-only data itself (everything arrives as plain
// serializable props), so converting it is safe.
//
// Card containers are deliberately plain <div>s, not motion.div — a
// follow-up request removed the fade+slide-up entrance animation on the card
// wrapper (it read as distracting/slow), keeping only the animation on
// content *inside* each card (bar/line charts, count-up numbers). Hover lift
// (CARD_HOVER_CLASS) is a plain CSS transition, not framer-motion.
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { MapPin, Layers, Thermometer, LineChart as LineChartIcon, BadgeCheck, Flame, Sparkles } from "lucide-react";
import AttributionBadge from "./AttributionBadge";
import AnimatedNumber from "@/components/ui/AnimatedNumber";
import RadialGauge from "@/components/ui/RadialGauge";
import GlowCard from "@/components/ui/GlowCard";
import { LANDCOVER_COLORS, type LandcoverCategory } from "@/lib/landcoverColors";
import { classifyLevel, isSpatiallyUniform } from "@/lib/heatmapUtils";
import { formatFallbackDateLabel } from "@/lib/relativeTime";
import { buildHeatMitigationRecommendation } from "@/lib/heatMitigationRecommendation";
import { type Severity } from "@/lib/severity";
import type { ForecastTimelineSlot } from "@/lib/wbgt";
import type { SiteRow } from "./types";

function severityFromHotspotLevel(level: ReturnType<typeof classifyLevel> | null): Severity | null {
  if (level == null) return null;
  if (level === "critical") return "critical";
  if (level === "high") return "caution";
  return "nominal"; // moderate | low
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-fg-muted">{label}</span>
      <span className="font-medium text-fg-primary">{value}</span>
    </div>
  );
}

function CardUnavailable() {
  return <p className="text-xs text-fg-muted">Unavailable for this site.</p>;
}

const LANDCOVER_SEGMENTS: { key: LandcoverCategory; label: string; pct: (l: NonNullable<SiteRow["landcover"]>) => number }[] = [
  { key: "building", label: "Building", pct: (l) => l.buildingPct },
  { key: "road", label: "Road", pct: (l) => l.roadPct },
  { key: "vegetation", label: "Vegetation", pct: (l) => l.vegetationPct },
  { key: "water", label: "Water", pct: (l) => l.waterPct },
  { key: "other", label: "Other", pct: (l) => l.otherPct },
];

function LandcoverBar({ landcover }: { landcover: NonNullable<SiteRow["landcover"]> }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-2">
        {LANDCOVER_SEGMENTS.map((s) => (
          <div
            key={s.key}
            style={{ width: `${Math.max(0, s.pct(landcover))}%`, backgroundColor: LANDCOVER_COLORS[s.key] }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-1">
        {LANDCOVER_SEGMENTS.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: LANDCOVER_COLORS[s.key] }} />
            <span className="truncate text-fg-muted">{s.label}</span>
            <span className="ml-auto font-medium text-fg-primary">{s.pct(landcover).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type AvailableForecastPoint = { offsetHours: number; airTemperatureC: number; timeLabel: string };

function ForecastSparkline({ points }: { points: AvailableForecastPoint[] }) {
  const width = 200;
  const height = 32;
  const padX = 4;
  const padY = 4;
  const temps = points.map((p) => p.airTemperatureC);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = max - min || 1;
  const xFor = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const yFor = (t: number) => height - padY - ((t - min) / span) * (height - padY * 2);
  const path = points.map((p, i) => `${xFor(i)},${yFor(p.airTemperatureC)}`).join(" ");
  // Reference gridlines only — evenly spaced, no second data series implied.
  const gridLineFractions = [0.25, 0.5, 0.75];

  return (
    <div className="flex flex-col gap-1.5">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Forecast mean temperature trend">
        {gridLineFractions.map((f) => {
          const y = padY + f * (height - padY * 2);
          return <line key={f} x1={padX} x2={width - padX} y1={y} y2={y} stroke="var(--border-subtle)" strokeWidth={0.5} />;
        })}
        <motion.polyline
          points={path}
          fill="none"
          stroke="#EA580C"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
        {points.map((p, i) => (
          <motion.circle
            key={p.offsetHours}
            cx={xFor(i)}
            cy={yFor(p.airTemperatureC)}
            r={2}
            fill="#EA580C"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.2 }}
          />
        ))}
      </svg>
      <div className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[#EA580C]" />
        <span className="text-[9px] text-fg-muted">Air Temp</span>
      </div>
    </div>
  );
}

// Forward-pointer to AI Copilot (project.md §5 "REVISI: dashboard vs chat" +
// §6) — Solar vs Canopy, Building Evaluation, and Photo Analysis were
// permanently removed as dedicated Analyst tabs; their compute logic moved
// to AI Copilot tools (compare_interventions, check_new_building_feasibility,
// analyze_field_photo) instead. Content/link unchanged from before — only
// restyled (confirmed with user) as the page's distinct "AI insight" card,
// reusing --status-simulated-* (indigo/purple), the same hue already used
// elsewhere for "simulated" data, rather than inventing a new color.
function CopilotForwardBanner({ siteId }: { siteId: string }) {
  return (
    <div
      className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-card-md border border-status-simulated-bg px-4 py-3.5"
      style={{
        background:
          "radial-gradient(120% 160% at 8% 0%, var(--status-simulated-bg), transparent 65%), var(--bg-surface)",
        boxShadow: "0 0 0 1px var(--status-simulated-bg)",
      }}
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-simulated-bg text-status-simulated">
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <p className="text-xs text-fg-secondary">
          Want to compare solar vs canopy, check if a new building fits, or analyze a field photo? Ask the AI Copilot.
        </p>
      </div>
      <Link
        href={`/copilot?siteId=${siteId}`}
        className="flex shrink-0 items-center gap-1.5 rounded-btn bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg transition-colors hover:bg-accent-strong"
      >
        Ask AI Copilot
      </Link>
    </div>
  );
}

export default function OverviewPanel({
  row,
  bbox,
  createdAtLabel,
  createdAtTimeLabel,
  forecastTimeline,
}: {
  row: SiteRow;
  bbox: [number, number, number, number] | null;
  createdAtLabel: string;
  createdAtTimeLabel: string;
  forecastTimeline: ForecastTimelineSlot[];
}) {
  // Bug fix (§4.4): this card used to read row.heat_forecast directly and
  // label points with only the relative offset ("+3h") — never the real
  // clock time, even though it was already being captured/stored.
  // `forecastTimeline` (already computed server-side in app/analyst/page.tsx
  // for Shift Schedule) has real, pre-formatted `timeLabel`s per slot, so
  // this card now reuses that instead of re-deriving anything from
  // row.heat_forecast itself. Only `available: true` slots have a real
  // temperature to plot — `available: false` slots (FortyGuard never
  // returned that hour) are excluded here, not shown as a fabricated zero.
  const availableForecast: AvailableForecastPoint[] = forecastTimeline
    .filter((s): s is Extract<ForecastTimelineSlot, { available: true }> => s.available)
    .map((s) => ({ offsetHours: s.offsetHours, airTemperatureC: s.airTemperatureC, timeLabel: s.timeLabel }))
    .sort((a, b) => a.offsetHours - b.offsetHours);
  const forecastTemps = availableForecast.map((f) => f.airTemperatureC);

  // Same recommendation engine RoiPanel.tsx already uses — reused here only
  // to read its already-computed treeCanopy.status and
  // metrics.hotspotFractionOfTiles for severity, not to introduce any new
  // calculation of its own.
  const recommendation = buildHeatMitigationRecommendation({
    siteAreaM2: row.site_area_m2,
    landcover: row.landcover,
    landcoverSpotcheck: row.landcover_spotcheck,
    heatTiles: row.heat_tiles,
    bbox,
  });

  const landcoverSeverity: Severity = recommendation.treeCanopy.status === "deficit" ? "caution" : "nominal";
  const heatSeverity = row.heat_stats ? severityFromHotspotLevel(classifyLevel(row.heat_stats.maxTempC)) : null;
  const forecastSeverity =
    forecastTemps.length > 0 ? severityFromHotspotLevel(classifyLevel(Math.max(...forecastTemps))) : null;
  const forecastTrend =
    availableForecast.length >= 2
      ? (() => {
          const delta = availableForecast[availableForecast.length - 1].airTemperatureC - availableForecast[0].airTemperatureC;
          const direction: "up" | "down" | "flat" = delta > 0.3 ? "up" : delta < -0.3 ? "down" : "flat";
          return { direction, label: `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}°C` };
        })()
      : undefined;
  const attributionSeverity: Severity | null = row.attribution
    ? Object.values(row.attribution).every((v) => v === "real")
      ? "nominal"
      : "caution"
    : null;
  const hotspotPercent =
    recommendation.metrics.hotspotFractionOfTiles != null ? recommendation.metrics.hotspotFractionOfTiles * 100 : null;
  const hotspotSeverity: Severity | null =
    hotspotPercent == null ? null : hotspotPercent > 50 ? "critical" : hotspotPercent >= 20 ? "caution" : "nominal";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <GlowCard icon={MapPin} title="Site Info" severity="nominal">
          <p className="truncate font-mono text-[10px] text-fg-muted" title={row.id}>
            {row.id}
          </p>
          <StatRow
            label="Area"
            value={
              row.site_area_m2 != null ? (
                <AnimatedNumber value={row.site_area_m2 / 1_000_000} format={(n) => `${n.toFixed(3)} km²`} />
              ) : (
                "—"
              )
            }
          />
          <StatRow label="Created" value={createdAtLabel} />
          <StatRow label="Time" value={createdAtTimeLabel} />
        </GlowCard>

        <GlowCard icon={Layers} title="Land-cover" severity={row.landcover ? landcoverSeverity : null}>
          {row.landcover ? <LandcoverBar landcover={row.landcover} /> : <CardUnavailable />}
        </GlowCard>

        <GlowCard icon={Thermometer} title="Heat Stats" severity={heatSeverity}>
          {row.heat_stats ? (
            <>
              {row.heat_stats.isFallbackDate && row.heat_stats.dateUsed && (
                <p className="mb-1.5 rounded-md border border-status-cached/30 bg-status-cached-bg px-2 py-1 text-center text-[10px] font-medium text-status-cached">
                  {formatFallbackDateLabel(row.heat_stats.dateUsed)} data — that day&apos;s FortyGuard data
                  wasn&apos;t available yet
                </p>
              )}
              <div className="grid grid-cols-3 gap-1 text-center">
                <div>
                  <div className="text-[10px] text-fg-muted">Min</div>
                  <div className="text-sm font-semibold text-fg-primary">
                    <AnimatedNumber value={row.heat_stats.minTempC} format={(n) => `${n.toFixed(1)}°`} />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-fg-muted">Mean</div>
                  <div className="text-sm font-semibold text-fg-primary">
                    <AnimatedNumber value={row.heat_stats.avgTempC} format={(n) => `${n.toFixed(1)}°`} />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-fg-muted">Max</div>
                  <div className="text-sm font-semibold text-fg-primary">
                    <AnimatedNumber value={row.heat_stats.maxTempC} format={(n) => `${n.toFixed(1)}°`} />
                  </div>
                </div>
              </div>
              <p className="text-center text-[10px] text-fg-muted">
                {row.heat_stats.tileCount} tiles · ±{row.heat_stats.stdDevC.toFixed(1)}°C
              </p>
              {isSpatiallyUniform(row.heat_stats.minTempC, row.heat_stats.maxTempC) && (
                <p className="text-center text-[10px] leading-relaxed text-fg-muted">
                  One uniform value across the AOI — real reading, but no spatial variation to map.
                </p>
              )}
            </>
          ) : (
            <CardUnavailable />
          )}
        </GlowCard>

        <GlowCard
          icon={LineChartIcon}
          title="Forecast +12h"
          severity={forecastSeverity}
          trend={forecastTrend}
        >
          {availableForecast.length >= 2 ? (
            <>
              <ForecastSparkline points={availableForecast} />
              <div className="flex justify-between text-[10px] text-fg-muted">
                <span>{availableForecast[0].timeLabel}</span>
                <span>{availableForecast[availableForecast.length - 1].timeLabel}</span>
              </div>
              <StatRow label="Min" value={`${Math.min(...forecastTemps).toFixed(1)}°C`} />
              <StatRow label="Max" value={`${Math.max(...forecastTemps).toFixed(1)}°C`} />
            </>
          ) : availableForecast.length === 1 ? (
            <StatRow label={availableForecast[0].timeLabel} value={`${availableForecast[0].airTemperatureC.toFixed(1)}°C`} />
          ) : (
            <p className="text-xs text-fg-muted">No forecast slots captured yet — explore the time selector in Map View.</p>
          )}
        </GlowCard>

        <GlowCard icon={BadgeCheck} title="Attribution" severity={attributionSeverity}>
          {row.attribution ? (
            <>
              <StatRow label="Landcover" value={<AttributionBadge status={row.attribution.landcover} />} />
              <StatRow label="Spotcheck" value={<AttributionBadge status={row.attribution.landcover_spotcheck} />} />
              <StatRow label="Heat" value={<AttributionBadge status={row.attribution.heat} />} />
            </>
          ) : (
            <CardUnavailable />
          )}
        </GlowCard>

        <GlowCard icon={Flame} title="Hotspot Exposure" severity={hotspotSeverity}>
          {hotspotPercent != null ? (
            <div className="flex flex-1 items-center justify-center py-1">
              <RadialGauge percent={hotspotPercent} severity={hotspotSeverity ?? "nominal"} label="of tiles" />
            </div>
          ) : (
            <CardUnavailable />
          )}
        </GlowCard>
      </div>

      {/* Secondary detail, not part of the at-a-glance summary above, so it's
          fine if this pushes past one viewport on a short screen. */}
      {(bbox || row.landcover_spotcheck) && (
        <p className="text-[11px] leading-relaxed text-fg-muted">
          {bbox && (
            <>
              BBox: {bbox[0].toFixed(4)}, {bbox[1].toFixed(4)} → {bbox[2].toFixed(4)}, {bbox[3].toFixed(4)}
            </>
          )}
          {bbox && row.landcover_spotcheck && " · "}
          {row.landcover_spotcheck && (
            <>
              Spotcheck (FortyGuard, centroid{row.landcover_spotcheck.synthetic ? ", synthetic" : ""}):{" "}
              {Object.entries(row.landcover_spotcheck.segments)
                .map(([cls, pct]) => `${cls} ${pct.toFixed(0)}%`)
                .join(" · ")}
            </>
          )}
        </p>
      )}

      <CopilotForwardBanner siteId={row.id} />
    </div>
  );
}
