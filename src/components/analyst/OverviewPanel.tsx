// Sub-task 1 content, unchanged in substance — extracted out of
// app/analyst/page.tsx's `SiteData` so it can sit behind the Overview tab of
// the icon toolbar (project.md §5 discovery: Sub-task 2-8 must not all pile
// up as stacked cards on one page).
import type { ReactNode } from "react";
import AttributionBadge from "./AttributionBadge";
import { LANDCOVER_COLORS, type LandcoverCategory } from "@/lib/landcoverColors";
import type { HeatForecastEntry } from "@/lib/siteRecord";
import type { SiteRow } from "./types";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {title}
      </h2>
      {children}
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="font-medium text-neutral-900 dark:text-white">{value}</span>
    </div>
  );
}

function CardUnavailable() {
  return <p className="text-xs text-neutral-400 dark:text-neutral-600">Unavailable for this site.</p>;
}

function offsetLabel(hourOffset: number): string {
  return hourOffset === 0 ? "Now" : `+${hourOffset}h`;
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
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
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
            <span className="truncate text-neutral-500 dark:text-neutral-400">{s.label}</span>
            <span className="ml-auto font-medium text-neutral-900 dark:text-white">{s.pct(landcover).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ForecastSparkline({ points }: { points: HeatForecastEntry[] }) {
  const width = 200;
  const height = 32;
  const padX = 4;
  const padY = 4;
  const temps = points.map((p) => p.meanTempC);
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const span = max - min || 1;
  const xFor = (i: number) => padX + (i / (points.length - 1)) * (width - padX * 2);
  const yFor = (t: number) => height - padY - ((t - min) / span) * (height - padY * 2);
  const path = points.map((p, i) => `${xFor(i)},${yFor(p.meanTempC)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Forecast mean temperature trend">
      <polyline points={path} fill="none" stroke="#EA580C" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={p.hourOffset} cx={xFor(i)} cy={yFor(p.meanTempC)} r={2} fill="#EA580C" />
      ))}
    </svg>
  );
}

export default function OverviewPanel({
  row,
  bbox,
  createdAtLabel,
  createdAtTimeLabel,
}: {
  row: SiteRow;
  bbox: [number, number, number, number] | null;
  createdAtLabel: string;
  createdAtTimeLabel: string;
}) {
  const forecast = [...(row.heat_forecast ?? [])].sort((a, b) => a.hourOffset - b.hourOffset);
  const forecastTemps = forecast.map((f) => f.meanTempC);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Card title="Site Info">
          <p className="truncate font-mono text-[10px] text-neutral-400 dark:text-neutral-600" title={row.id}>
            {row.id}
          </p>
          <StatRow
            label="Area"
            value={row.site_area_m2 != null ? `${(row.site_area_m2 / 1_000_000).toFixed(3)} km²` : "—"}
          />
          <StatRow label="Created" value={createdAtLabel} />
          <StatRow label="Time" value={createdAtTimeLabel} />
        </Card>

        <Card title="Land-cover">{row.landcover ? <LandcoverBar landcover={row.landcover} /> : <CardUnavailable />}</Card>

        <Card title="Heat Stats">
          {row.heat_stats ? (
            <>
              <div className="grid grid-cols-3 gap-1 text-center">
                <div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Min</div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {row.heat_stats.minTempC.toFixed(1)}°
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Mean</div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {row.heat_stats.avgTempC.toFixed(1)}°
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-neutral-500 dark:text-neutral-400">Max</div>
                  <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                    {row.heat_stats.maxTempC.toFixed(1)}°
                  </div>
                </div>
              </div>
              <p className="text-center text-[10px] text-neutral-400 dark:text-neutral-600">
                {row.heat_stats.tileCount} tiles · ±{row.heat_stats.stdDevC.toFixed(1)}°C
              </p>
            </>
          ) : (
            <CardUnavailable />
          )}
        </Card>

        <Card title="Forecast +12h">
          {forecast.length >= 2 ? (
            <>
              <ForecastSparkline points={forecast} />
              <div className="flex justify-between text-[10px] text-neutral-400 dark:text-neutral-600">
                <span>{offsetLabel(forecast[0].hourOffset)}</span>
                <span>{offsetLabel(forecast[forecast.length - 1].hourOffset)}</span>
              </div>
              <StatRow label="Min" value={`${Math.min(...forecastTemps).toFixed(1)}°C`} />
              <StatRow label="Max" value={`${Math.max(...forecastTemps).toFixed(1)}°C`} />
            </>
          ) : forecast.length === 1 ? (
            <StatRow label={offsetLabel(forecast[0].hourOffset)} value={`${forecast[0].meanTempC.toFixed(1)}°C`} />
          ) : (
            <p className="text-xs text-neutral-400 dark:text-neutral-600">
              No forecast slots captured yet — explore the time selector in Map View.
            </p>
          )}
        </Card>

        <Card title="Attribution">
          {row.attribution ? (
            <>
              <StatRow label="Landcover" value={<AttributionBadge status={row.attribution.landcover} />} />
              <StatRow label="Spotcheck" value={<AttributionBadge status={row.attribution.landcover_spotcheck} />} />
              <StatRow label="Heat" value={<AttributionBadge status={row.attribution.heat} />} />
            </>
          ) : (
            <CardUnavailable />
          )}
        </Card>
      </div>

      {/* Secondary detail, not part of the at-a-glance summary above, so it's
          fine if this pushes past one viewport on a short screen. */}
      {(bbox || row.landcover_spotcheck) && (
        <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-600">
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
    </div>
  );
}
