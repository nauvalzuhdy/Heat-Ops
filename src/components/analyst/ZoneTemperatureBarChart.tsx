"use client";

// Charts & Metrics — bar chart suhu per zona (project.md §5, Sub-task 5,
// scope dipersempit ke SATU chart ini saja). Deliberately reuses existing
// computation rather than inventing a second one:
//   - Zone binning: lib/heatmapUtils.ts's binTilesToZones() — the exact same
//     pure function Hotspot Detection's Grid Zones tab (HotspotGridView.tsx)
//     calls with the same tiles+bbox inputs, so results are guaranteed
//     identical between the two tabs for the same site (same deterministic
//     function, same inputs -> same output), not a second, independently
//     re-derived number.
//   - Color scale: lib/tempToColor.ts's tempToColor() — the SAME
//     green->yellow->orange->red gradient Map View's heatmap image uses
//     (anchored to the NIOSH-aligned thresholds documented there), not
//     Recharts' default palette and not lib/heatmapUtils.ts's separate
//     zoneTintColor() (blue->red, only used for the Grid Zones live-map tint
//     overlay — a different, unrelated color scheme for a different view).
import { useMemo } from "react";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";
import type { TooltipContentProps } from "recharts";
import { binTilesToZones, type HotspotZone } from "@/lib/heatmapUtils";
import { tempToColor } from "@/lib/tempToColor";
import type { HeatTileRecord } from "@/lib/siteRecord";

const HOTTEST_STROKE = "#dc2626"; // red-600 — matches HotspotGridView's hottest-zone highlight color
const COOLEST_STROKE = "#2563eb"; // blue-600 — matches HotspotGridView's coolest-zone highlight color

type ZoneChartDatum = {
  id: string;
  zoneLabel: string;
  rcLabel: string;
  meanTempC: number;
  isHottest: boolean;
  isCoolest: boolean;
  fill: string;
};

// binTilesToZones() only marks isHottest on its own — "coolest" isn't a
// field it returns. This replicates HotspotGridView.tsx's own 2-line
// "max rank among zones that have data" derivation verbatim (same logic,
// same result) rather than introducing a new shared helper in
// lib/heatmapUtils.ts, to keep this task's changes scoped to this one new
// file and not touch the already-working Hotspot Detection component.
function buildZoneChartData(tiles: HeatTileRecord[], bbox: [number, number, number, number]): ZoneChartDatum[] {
  const zones = binTilesToZones(tiles, bbox);
  const withData = zones.filter(
    (z): z is HotspotZone & { meanTempC: number; rank: number } => z.meanTempC != null && z.rank != null,
  );
  const coolestRank = withData.length > 0 ? Math.max(...withData.map((z) => z.rank)) : null;

  return withData.map((zone) => ({
    id: zone.id,
    // Row-major A..I labeling, as suggested in the brief ("Zone A-I dari
    // grid 3x3") — row 0 col 0 = A, ... row 2 col 2 = I.
    zoneLabel: `Zone ${String.fromCharCode(65 + zone.row * 3 + zone.col)}`,
    // Kept alongside for cross-checking against Hotspot Detection's own
    // R{row}C{col} labeling convention (HotspotGridView's "Hottest: ...
    // (R1C1)" badge).
    rcLabel: `R${zone.row + 1}C${zone.col + 1}`,
    meanTempC: zone.meanTempC,
    isHottest: zone.isHottest,
    isCoolest: zone.rank === coolestRank,
    fill: `rgb(${tempToColor(zone.meanTempC).join(",")})`,
  }));
}

function ZoneTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload as ZoneChartDatum;
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
      <div className="font-semibold text-neutral-900 dark:text-white">
        {d.zoneLabel} <span className="font-normal text-neutral-400 dark:text-neutral-500">({d.rcLabel})</span>
      </div>
      <div className="text-neutral-600 dark:text-neutral-300">{d.meanTempC.toFixed(2)}°C</div>
      {d.isHottest && <div className="text-[10px] font-medium text-red-600 dark:text-red-400">Hottest zone</div>}
      {d.isCoolest && <div className="text-[10px] font-medium text-blue-600 dark:text-blue-400">Coolest zone</div>}
    </div>
  );
}

export default function ZoneTemperatureBarChart({
  tiles,
  bbox,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number] | null;
}) {
  const chartData = useMemo(() => (bbox ? buildZoneChartData(tiles, bbox) : []), [tiles, bbox]);

  if (!bbox || chartData.length === 0) {
    return (
      <p className="text-xs text-neutral-400 dark:text-neutral-600">
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
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 20, right: 12, left: 0, bottom: 4 }}>
          <CartesianGrid strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="zoneLabel" tick={{ fontSize: 11 }} stroke="currentColor" strokeOpacity={0.35} />
          <YAxis
            tick={{ fontSize: 11 }}
            stroke="currentColor"
            strokeOpacity={0.35}
            width={36}
            label={{ value: "°C", angle: -90, position: "insideLeft", fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
          />
          <Tooltip content={ZoneTooltip} cursor={{ fill: "currentColor", fillOpacity: 0.06 }} />
          <Bar dataKey="meanTempC" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {chartData.map((d) => (
              <Cell
                key={d.id}
                fill={d.fill}
                stroke={d.isHottest ? HOTTEST_STROKE : d.isCoolest ? COOLEST_STROKE : "transparent"}
                strokeWidth={d.isHottest || d.isCoolest ? 3 : 0}
              />
            ))}
            <LabelList dataKey="meanTempC" content={renderHighlightLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
