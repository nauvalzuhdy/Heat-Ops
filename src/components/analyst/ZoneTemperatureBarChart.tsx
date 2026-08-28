"use client";

// Zone temperature bar chart (project.md §5). Moved out of the now-removed
// Charts & Metrics tab into Hotspot Detection, next to the Satellite/Grid
// Thermal columns (see HotspotPanel.tsx) — the chart and the map it explains
// now share one screen instead of living in separate tabs. Deliberately
// reuses existing computation rather than inventing a second one:
//   - Zone binning: lib/heatmapUtils.ts's binTilesToZones() — the same pure
//     3x3 function, kept here even though Hotspot Detection's own columns
//     have since moved to a different (per-point, non-3x3) view of the same
//     `heat_tiles`, so this chart's zone-per-bar breakdown stays available.
//   - Zone naming: lib/heatmapUtils.ts's zoneLabel() (compass names — see its
//     own comment for why) — this file used to compute its own "Zone A".."Zone
//     I" letters inline, which is exactly the kind of duplicated-formula
//     drift that caused the old label scheme to need auditing across 6 files
//     when it changed. Now there's one function, reused everywhere.
//   - Color scale: lib/tempToColor.ts's tempToColor() — the SAME
//     green->yellow->orange->red gradient Map View's heatmap image uses
//     (anchored to the NIOSH-aligned thresholds documented there), not
//     Recharts' default palette and not the Hotspot Detection page's Grid
//     Thermal column, which uses its own per-site fire/thermal scale
//     (lib/thermalColorScale.ts) for a different, unrelated view.
import { useMemo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";
import type { TooltipContentProps } from "recharts";
import { binTilesToZones, zoneLabel, type HotspotZone } from "@/lib/heatmapUtils";
import { tempToColor } from "@/lib/tempToColor";
import type { HeatTileRecord } from "@/lib/siteRecord";

const HOTTEST_STROKE = "#dc2626"; // red-600 — hottest-zone highlight color
const COOLEST_STROKE = "#2563eb"; // blue-600 — coolest-zone highlight color
// Cross-highlight stroke (hover/click bridge to the map overlay in
// HotspotSatelliteView.tsx) — deliberately the app's own accent token, not
// another hardcoded hex, and visually distinct from both hottest (red) and
// coolest (blue) so a highlighted bar is never confused with either.
const HIGHLIGHT_STROKE = "var(--accent)";

type ZoneChartDatum = {
  id: string;
  row: number;
  col: number;
  zoneLabel: string;
  meanTempC: number;
  isHottest: boolean;
  isCoolest: boolean;
  fill: string;
};

// isCoolest now comes straight from binTilesToZones() (lib/heatmapUtils.ts)
// instead of being re-derived here — this file used to compute its own "max
// rank among zones with data", a second copy of exactly the same logic the
// PDF report's Hotspot Zones chart now also needs, so it moved to the one
// shared place both read from.
function buildZoneChartData(tiles: HeatTileRecord[], bbox: [number, number, number, number]): ZoneChartDatum[] {
  const zones = binTilesToZones(tiles, bbox);
  const withData = zones.filter(
    (z): z is HotspotZone & { meanTempC: number; rank: number } => z.meanTempC != null && z.rank != null,
  );

  return withData.map((zone) => ({
    id: zone.id,
    row: zone.row,
    col: zone.col,
    zoneLabel: zoneLabel(zone.row, zone.col),
    meanTempC: zone.meanTempC,
    isHottest: zone.isHottest,
    isCoolest: zone.isCoolest,
    fill: `rgb(${tempToColor(zone.meanTempC).join(",")})`,
  }));
}

// Recharts' own hover-a-data-point tooltip (reads a bar's exact value) — kept
// per project.md §5's hover-popup pass: this is a different interaction from
// the whole-card hover popup that pass removed elsewhere (see
// lib/motionVariants.ts), functionally the same as a chart axis label, just
// restyled here to sit on the new dark surface tokens instead of a
// hardcoded white card.
function ZoneTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload as ZoneChartDatum;
  return (
    <div className="rounded-card-sm border border-border-subtle bg-surface px-2.5 py-1.5 text-xs shadow-float">
      <div className="font-semibold text-fg-primary">{d.zoneLabel}</div>
      <div className="text-fg-secondary">{d.meanTempC.toFixed(2)}°C</div>
      {d.isHottest && <div className="text-[10px] font-medium text-red-500">Hottest zone</div>}
      {d.isCoolest && <div className="text-[10px] font-medium text-blue-400">Coolest zone</div>}
    </div>
  );
}

// Angled tick — the 3x3 grid's compass names ("Northwest", "Southeast", ...)
// can run up to ~9 characters, which doesn't fit horizontally under 9
// bars once this chart sits in a 3-column layout (see HotspotPanel.tsx)
// instead of a full-width tab. Rotating the tick is the standard fix for a
// narrow categorical axis — it keeps the exact same label text (still the
// one zoneLabel() string, nothing abbreviated or renamed) instead of
// swapping in a shorter code that would then disagree with the map overlay's
// full-word labels.
function AngledZoneTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }) {
  if (x == null || y == null) return null;
  return (
    <text x={x} y={y} dy={8} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.65} transform={`rotate(-40, ${x}, ${y})`}>
      {payload?.value}
    </text>
  );
}

export default function ZoneTemperatureBarChart({
  tiles,
  bbox,
  highlightedZoneId,
  onZoneHover,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number] | null;
  /** Zone id ("row-col") to visually highlight — driven by hovering the map overlay, or another bar. */
  highlightedZoneId?: string | null;
  /** Fires on bar hover/unhover (null) — lets the map overlay highlight the matching zone. */
  onZoneHover?: (zoneId: string | null) => void;
}) {
  const chartData = useMemo(() => (bbox ? buildZoneChartData(tiles, bbox) : []), [tiles, bbox]);

  if (!bbox || chartData.length === 0) {
    return (
      <p className="text-xs text-fg-muted">
        No heat tiles available for this site yet — zone temperatures need a completed heatmap capture from Map View.
      </p>
    );
  }

  // LabelList's content callback doesn't carry the source datum, only the
  // bar's rendered geometry + array index — look the datum up from the same
  // chartData the bars themselves were built from, so the label can never
  // disagree with the bar it's sitting on.
  function renderHighlightLabel(props: {
    x?: string | number;
    y?: string | number;
    width?: string | number;
    index?: number;
  }) {
    const x = Number(props.x);
    const y = Number(props.y);
    const width = Number(props.width);
    const { index } = props;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || index == null) return null;
    const d = chartData[index];
    if (!d || (!d.isHottest && !d.isCoolest)) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 6}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={d.isHottest ? HOTTEST_STROKE : COOLEST_STROKE}
      >
        {d.isHottest ? "Hottest" : "Coolest"}
      </text>
    );
  }

  return (
    <div className="h-full w-full min-h-[280px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 8, left: 0, bottom: 28 }}>
          <CartesianGrid strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="zoneLabel" interval={0} tick={<AngledZoneTick />} stroke="currentColor" strokeOpacity={0.35} />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.35}
            width={32}
            label={{ value: "°C", angle: -90, position: "insideLeft", fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
          />
          <Tooltip content={ZoneTooltip} cursor={{ fill: "currentColor", fillOpacity: 0.06 }} />
          <Bar
            dataKey="meanTempC"
            radius={[3, 3, 0, 0]}
            isAnimationActive={true}
            animationDuration={800}
            animationEasing="ease-out"
            onMouseEnter={(item) => onZoneHover?.((item?.payload as ZoneChartDatum | undefined)?.id ?? null)}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            {chartData.map((d) => {
              const highlighted = d.id === highlightedZoneId;
              return (
                <Cell
                  key={d.id}
                  fill={d.fill}
                  stroke={highlighted ? HIGHLIGHT_STROKE : d.isHottest ? HOTTEST_STROKE : d.isCoolest ? COOLEST_STROKE : "transparent"}
                  strokeWidth={highlighted ? 4 : d.isHottest || d.isCoolest ? 3 : 0}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
            <LabelList dataKey="meanTempC" content={renderHighlightLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
