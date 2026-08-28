// §5 sub-task 1 — page structure + data fetch. Per-site content now lives
// behind the icon toolbar (AnalystTabsShell) rather than as stacked cards —
// see project.md §5 discovery notes: Sub-task 2-8 all piling up on one page
// was the problem the toolbar architecture was introduced to solve.
import Link from "next/link";
import * as turf from "@turf/turf";
import { MapPinned } from "lucide-react";
import Header from "@/components/layout/Header";
import AppSidebar from "@/components/layout/AppSidebar";
import SiteCardGrid, { type SiteCardData } from "@/components/analyst/SiteCardGrid";
import AnalystTabsShell from "@/components/analyst/AnalystTabsShell";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import { buildForecastTimeline, type ForecastTimelineSlot } from "@/lib/wbgt";
import { relativeTimeAgo } from "@/lib/relativeTime";
import type { SiteRow } from "@/components/analyst/types";

// Next.js's fetch cache otherwise caches supabase-js's underlying GET request
// for the sites list by URL — since that query URL never changes, a newly
// saved site (Feature 1) silently would not appear until an unrelated cache
// eviction. Every request here must see the current table state.
export const dynamic = "force-dynamic";

async function fetchSite(
  siteId: string,
): Promise<{ row: SiteRow | null; error: string | null }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      // roi_inputs is read here (not just by RoiPanel's own fetch) so the
      // Overview tab's headline outcome banner can state the operator's saved
      // scenario — the same one lib/reportData.ts feeds the PDF report.
      "id, name, created_at, aoi_geometry, site_area_m2, landcover, landcover_spotcheck, heat_tiles, heat_stats, heat_forecast, heat_photo_url, satellite_photo_url, attribution, roi_inputs",
    )
    .eq("id", siteId)
    .maybeSingle();

  if (error) return { row: null, error: error.message };
  return { row: (data as SiteRow) ?? null, error: null };
}

// Default view (no ?siteId) — one row per saved site, cheapest columns only.
// Capped rather than paginated: fine for a hackathon-scale sites table: real
// pagination is a deliberate later improvement, not silently dropped rows.
const SAVED_SITES_LIMIT = 60;

type SiteListRow = {
  id: string;
  name: string | null;
  site_area_m2: number | null;
  created_at: string;
  heat_photo_url: string | null;
  satellite_photo_url: string | null;
};

async function fetchAllSites(): Promise<{
  rows: SiteListRow[];
  error: string | null;
}> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, site_area_m2, created_at, heat_photo_url, satellite_photo_url")
    .order("created_at", { ascending: false })
    .limit(SAVED_SITES_LIMIT);

  if (error) return { rows: [], error: error.message };
  return { rows: (data as SiteListRow[]) ?? [], error: null };
}

// Empty state (project.md §5 redesign) — a plain "No sites saved yet"
// sentence read as an afterthought; this is the same information with an
// icon + a real call-to-action link into the one place a first site
// actually gets created (Map View's "Analyze this site" flow, §4.7).
function EmptySavedSites() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-neutral-300 py-16 text-center dark:border-neutral-700">
      <MapPinned size={40} strokeWidth={1.5} className="text-neutral-300 dark:text-neutral-700" />
      <div>
        <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">No sites saved yet</p>
        <p className="mt-1 max-w-xs text-xs text-neutral-400 dark:text-neutral-600">
          Draw an AOI and run an analysis in Map View — saved sites show up here.
        </p>
      </div>
      <Link
        href="/map"
        className="mt-1 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        Go to Map View to analyze your first site
      </Link>
    </div>
  );
}

async function SavedSitesList() {
  const { rows, error } = await fetchAllSites();

  if (error) {
    return <ErrorBanner message={`Failed to load saved sites. (${error})`} />;
  }

  if (rows.length === 0) {
    return <EmptySavedSites />;
  }

  const cards: SiteCardData[] = rows.map((site) => ({
    id: site.id,
    name: site.name,
    siteAreaM2: site.site_area_m2,
    createdAtLabel: new Date(site.created_at).toLocaleDateString(),
    analyzedAgoLabel: relativeTimeAgo(site.created_at),
    heatPhotoUrl: site.heat_photo_url,
    satellitePhotoUrl: site.satellite_photo_url,
  }));

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Saved Sites ({rows.length})
      </h2>
      <SiteCardGrid sites={cards} />
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </div>
  );
}

async function SiteData({ siteId }: { siteId: string }) {
  const { row, error } = await fetchSite(siteId);

  if (error) {
    // Postgrest rejects a malformed UUID before it can even look for a row
    // (22P02 invalid input syntax) — to the user that's indistinguishable
    // from "no such site", so both paths render the same message.
    return <ErrorBanner message={`Site not found. (${error})`} />;
  }
  if (!row) {
    return (
      <ErrorBanner message="Site not found. Check the siteId in the URL." />
    );
  }

  let bbox: number[] | null = null;
  try {
    bbox = row.aoi_geometry ? turf.bbox(row.aoi_geometry) : null;
  } catch {
    bbox = null;
  }

  // Formatted server-side and passed down as plain strings, not left for
  // OverviewPanel to compute from row.created_at itself — OverviewPanel now
  // renders under AnalystTabsShell's "use client" boundary, so a
  // toLocaleDateString()/toLocaleTimeString() call there would hydrate
  // against the browser's locale/timezone while this HTML was rendered with
  // Node's, mismatching whenever they differ (same fix as SiteCard.tsx).
  const createdAtLabel = new Date(row.created_at).toLocaleDateString();
  const createdAtTimeLabel = new Date(row.created_at).toLocaleTimeString();

  // Same reasoning, applied to Shift Schedule's per-slot timestamps (Sub-task
  // 3 revision): format here, once, server-side — never in ShiftSchedulePanel
  // itself. buildForecastTimeline() (lib/wbgt.ts) also fills in the +0/+3/+6/
  // +9/+12h slots that never captured real data (as explicit `available:
  // false` entries with a real, computed — never guessed — targetTime), and
  // formats every label with fixed, locale-independent arithmetic rather than
  // Intl.toLocale*String, which was both a hydration-mismatch risk here and,
  // separately, capable of rendering "16.02" instead of "16:02" depending on
  // which locale the server resolved.
  const forecastTimeline: ForecastTimelineSlot[] = buildForecastTimeline(row.heat_forecast ?? []);

  return (
    <AnalystTabsShell
      row={row}
      bbox={bbox as [number, number, number, number] | null}
      createdAtLabel={createdAtLabel}
      createdAtTimeLabel={createdAtTimeLabel}
      forecastTimeline={forecastTimeline}
    />
  );
}

export default function AnalystPage({
  searchParams,
}: {
  searchParams: { siteId?: string };
}) {
  const siteId = searchParams.siteId;

  return (
    <div className="flex h-app-shell w-full flex-col overflow-hidden">
      <Header title="Operational Analyst" />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        {/* flex-col + overflow-hidden: this page never scrolls at the root —
            only the content region below the header row does, and only if
            its active tab's content genuinely doesn't fit (see the
            min-h-0/overflow-y-auto wrapper below). Hotspot Detection's map
            fills that region exactly (AnalystTabsShell → HotspotPanel), so
            for that tab the wrapper never actually overflows.
            No `pb-5`, deliberately: AnalystTabsShell's toolbar bar sits flush
            against this main's bottom edge, and used a `-mb-5` negative
            margin to cancel that padding — which worked fine when this page
            scrolled naturally, but inside a height-constrained flex-col
            parent a negative margin makes the toolbar's real rendered box
            poke out past its container's edge instead of actually saving
            space, producing exactly the kind of scroll this fix removes.
            Omitting the padding here (and the matching -mb-5 there) gets the
            same flush-bottom look without that mismatch. */}
        {/* Padding is tighter below `sm` so a phone spends its (much
            scarcer) width and height on content rather than chrome -
            AnalystTabsShell's edge-to-edge toolbar bleeds by the matching
            -mx-4 sm:-mx-6. */}
        <main className="flex flex-1 flex-col overflow-hidden px-4 pt-4 sm:px-6 sm:pt-5">
          {/* flex-wrap + gap: on a phone these nav buttons no longer squeeze
              the heading (or wrap their own label text over 2-3 lines each,
              which quietly ate ~60px of the vertical budget the tab content
              and the bottom toolbar need). They drop to their own line
              instead, with short labels at that size - see the paired spans
              below. */}
          <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 sm:mb-4">
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-white">
              Operational Analyst
            </h1>
            <div className="flex items-center gap-2">
              {/* Only shown on a site's detail view — the no-siteId branch
                  below already *is* the Saved Sites list, so this link would
                  be a self-referential no-op there. */}
              {siteId && (
                <Link
                  href="/analyst"
                  className="whitespace-nowrap rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 sm:px-4 sm:py-2"
                >
                  ← Saved Sites
                </Link>
              )}
              <Link
                href="/map"
                className="whitespace-nowrap rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 sm:px-4 sm:py-2"
              >
                <span className="sm:hidden">← Map</span>
                <span className="hidden sm:inline">← Back to Map View</span>
              </Link>
            </div>
          </div>

          {/* min-h-0 makes this a real flex item (not content-sized), so it
              takes exactly the remaining height; overflow-y-auto is a scoped
              fallback for content that's genuinely taller than that (e.g. a
              long Saved Sites grid) — never a page-level scrollbar.
              overflow-x-hidden is required alongside it: CSS silently
              promotes an unset x-axis to `auto` whenever y is non-visible,
              and AnalystTabsShell's toolbar bar below uses -mx-6 to bleed
              edge-to-edge — without this, that bleed was tripping a phantom
              horizontal scrollbar that ate ~15px of height, which cascaded
              into the very vertical overflow this page is meant to avoid. */}
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {/* Both branches are async Server Components — Next streams them
                in once their Supabase read resolves. */}
            {siteId ? <SiteData siteId={siteId} /> : <SavedSitesList />}
          </div>
        </main>
      </div>
    </div>
  );
}
