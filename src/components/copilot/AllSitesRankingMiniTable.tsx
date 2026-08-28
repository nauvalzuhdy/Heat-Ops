"use client";

// Rendered inline when the compare_all_sites tool resolves (project.md §6
// follow-up: AI Copilot cross-site mode). A simple ranked list, not a chart —
// the point is letting the user quickly eyeball "does this ranking match
// what I expect" against the structured tool_data, same role
// HotspotZoneMiniChart plays for get_hotspot but at the cross-site scale.
type RankedSite = { rank: number; id: string; name: string | null; value: number };

type CompareAllSitesData = {
  metric: string;
  metricLabel: string;
  ranked: RankedSite[];
  excludedCount: number;
};

function isCompareAllSitesData(data: unknown): data is CompareAllSitesData {
  return typeof data === "object" && data !== null && Array.isArray((data as CompareAllSitesData).ranked);
}

export default function AllSitesRankingMiniTable({ data }: { data: unknown }) {
  if (!isCompareAllSitesData(data)) return null;
  if (data.ranked.length === 0) return null;

  const maxValue = Math.max(...data.ranked.map((r) => Math.abs(r.value)), 1);

  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {data.metricLabel}
      </div>
      <div className="flex flex-col gap-1.5">
        {data.ranked.map((r) => (
          <div key={r.id} className="flex items-center gap-2 text-xs">
            <span className="w-4 shrink-0 text-right font-mono text-[10px] text-neutral-400 dark:text-neutral-600">{r.rank}</span>
            <span className="w-28 shrink-0 truncate text-neutral-700 dark:text-neutral-300" title={r.name ?? r.id}>
              {r.name ?? `Site ${r.id.slice(0, 8)}`}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
              <div
                className={`h-full rounded-full ${r.rank === 1 ? "bg-red-500" : "bg-orange-400"}`}
                style={{ width: `${Math.max(4, (Math.abs(r.value) / maxValue) * 100)}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-medium text-neutral-900 dark:text-white">{r.value.toFixed(1)}°C</span>
          </div>
        ))}
      </div>
      {data.excludedCount > 0 && (
        <p className="mt-1.5 text-[10px] text-neutral-400 dark:text-neutral-600">
          {data.excludedCount} site{data.excludedCount === 1 ? "" : "s"} excluded — no saved heat data.
        </p>
      )}
    </div>
  );
}
