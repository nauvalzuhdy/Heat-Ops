"use client";

// Rendered inline when the get_hotspot tool resolves. Deliberately a smaller,
// chat-scale cousin of ZoneTemperatureBarChart.tsx (now embedded in Hotspot
// Detection) — reuses the same tempToColor() gradient and compass-position
// labeling (see lib/heatmapUtils.ts's zoneLabel()) so a Copilot answer's
// chart reads consistently with that tab, without importing its full
// component (which expects raw tiles/bbox, not the already-binned zone
// summary this tool returns).
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { tempToColor } from "@/lib/tempToColor";

type Zone = {
  zoneLabel: string;
  meanTempC: number | null;
  level: string | null;
  isHottest: boolean;
};

type HotspotData = {
  zones: Zone[];
  hottestZone: Zone | null;
  coolestZone: Zone | null;
};

function isHotspotData(data: unknown): data is HotspotData {
  return typeof data === "object" && data !== null && Array.isArray((data as HotspotData).zones);
}

function rgbToCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

export default function HotspotZoneMiniChart({ data }: { data: unknown }) {
  if (!isHotspotData(data)) return null;

  const rows = data.zones
    .filter((z) => z.meanTempC != null)
    .map((z) => ({ ...z, meanTempC: z.meanTempC as number, isCoolest: z.zoneLabel === data.coolestZone?.zoneLabel }));

  if (rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="h-32 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="zoneLabel" tick={{ fontSize: 8 }} interval={0} angle={-40} textAnchor="end" height={30} stroke="currentColor" strokeOpacity={0.35} />
            <YAxis tick={{ fontSize: 9 }} stroke="currentColor" strokeOpacity={0.35} domain={["dataMin - 1", "dataMax + 1"]} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(1)}°C`} labelFormatter={(label) => label} />
            <Bar dataKey="meanTempC" radius={[3, 3, 0, 0]}>
              {rows.map((r) => (
                <Cell
                  key={r.zoneLabel}
                  fill={rgbToCss(tempToColor(r.meanTempC))}
                  stroke={r.isHottest ? "#dc2626" : r.isCoolest ? "#2563eb" : undefined}
                  strokeWidth={r.isHottest || r.isCoolest ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-[10px] text-neutral-400 dark:text-neutral-600">
        {data.hottestZone && (
          <span className="text-red-500">{data.hottestZone.zoneLabel} hottest</span>
        )}
        {data.hottestZone && data.coolestZone && " · "}
        {data.coolestZone && <span className="text-blue-500">{data.coolestZone.zoneLabel} coolest</span>}
      </p>
    </div>
  );
}
