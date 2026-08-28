"use client";

// Rendered inline in an assistant turn whenever get_site_data resolves
// (project.md §6 setup dasar — "chart from internal data" half of the spec).
// Deliberately a compact snapshot, not a re-hosting of Operational Analyst's
// full Overview tab: this is a chat aside, not a dashboard.
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { LANDCOVER_COLORS, type LandcoverCategory } from "@/lib/landcoverColors";

type SiteSnapshotData = {
  name: string | null;
  siteAreaM2: number | null;
  landcover: Record<string, number> | null;
  heatStats: { avgTempC: number; minTempC: number; maxTempC: number } | null;
  attribution: { landcover: string; heat: string } | null;
};

const LANDCOVER_SEGMENTS: { key: LandcoverCategory; label: string; field: string }[] = [
  { key: "building", label: "Building", field: "buildingPct" },
  { key: "road", label: "Road", field: "roadPct" },
  { key: "vegetation", label: "Vegetation", field: "vegetationPct" },
  { key: "water", label: "Water", field: "waterPct" },
  { key: "other", label: "Other", field: "otherPct" },
];

function isSiteSnapshotData(data: unknown): data is SiteSnapshotData {
  return typeof data === "object" && data !== null && !("error" in (data as Record<string, unknown>));
}

export default function SiteSnapshotCard({ data }: { data: unknown }) {
  if (!isSiteSnapshotData(data)) return null;

  const landcover = data.landcover as Record<string, number> | null;
  const pieData = landcover
    ? LANDCOVER_SEGMENTS.map((s) => ({ name: s.label, key: s.key, value: landcover[s.field] ?? 0 })).filter(
        (d) => d.value > 0,
      )
    : [];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40 sm:flex-row sm:items-center">
      {pieData.length > 0 && (
        <div className="h-24 w-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={22} outerRadius={40} paddingAngle={1}>
                {pieData.map((d) => (
                  <Cell key={d.key} fill={LANDCOVER_COLORS[d.key]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `${Number(v).toFixed(0)}%`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="truncate text-xs font-semibold text-neutral-900 dark:text-white">
          {data.name ?? "Site snapshot"}
        </p>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
          {data.siteAreaM2 != null ? `${(data.siteAreaM2 / 1_000_000).toFixed(3)} km²` : "Area unavailable"}
        </p>

        {data.heatStats ? (
          <div className="mt-1 flex gap-3 text-[11px]">
            <span>
              <span className="text-neutral-400 dark:text-neutral-600">Min </span>
              <span className="font-medium text-neutral-900 dark:text-white">{data.heatStats.minTempC.toFixed(1)}°</span>
            </span>
            <span>
              <span className="text-neutral-400 dark:text-neutral-600">Mean </span>
              <span className="font-medium text-neutral-900 dark:text-white">{data.heatStats.avgTempC.toFixed(1)}°</span>
            </span>
            <span>
              <span className="text-neutral-400 dark:text-neutral-600">Max </span>
              <span className="font-medium text-neutral-900 dark:text-white">{data.heatStats.maxTempC.toFixed(1)}°</span>
            </span>
          </div>
        ) : (
          <p className="text-[11px] text-neutral-400 dark:text-neutral-600">No heat data for this site.</p>
        )}

        {pieData.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
            {pieData.map((d) => (
              <span key={d.key} className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: LANDCOVER_COLORS[d.key] }} />
                {d.name} {d.value.toFixed(0)}%
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
