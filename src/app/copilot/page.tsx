// AI Copilot page (project.md §6 setup dasar). Mirrors app/analyst/page.tsx's
// shell (Header + AppSidebar + a "pick a site" list when no ?siteId, a
// per-site view otherwise) so the two pages feel like the same product, but
// the per-site view here is a chat, not a tab dashboard.
import Link from "next/link";
import Header from "@/components/layout/Header";
import AppSidebar from "@/components/layout/AppSidebar";
import CopilotChat from "@/components/copilot/CopilotChat";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

type SiteListRow = { id: string; name: string | null; created_at: string; satellite_photo_url: string | null };
type SiteHeaderRow = { id: string; name: string | null };

const SITE_PICKER_LIMIT = 60;

async function fetchAllSites(): Promise<{ rows: SiteListRow[]; error: string | null }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, created_at, satellite_photo_url")
    .order("created_at", { ascending: false })
    .limit(SITE_PICKER_LIMIT);

  if (error) return { rows: [], error: error.message };
  return { rows: (data as SiteListRow[]) ?? [], error: null };
}

async function fetchSiteHeader(siteId: string): Promise<{ row: SiteHeaderRow | null; error: string | null }> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("sites").select("id, name").eq("id", siteId).maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as SiteHeaderRow) ?? null, error: null };
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </div>
  );
}

async function SitePicker() {
  const { rows, error } = await fetchAllSites();

  if (error) return <ErrorBanner message={`Failed to load saved sites. (${error})`} />;

  if (rows.length === 0) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-600">
        No sites saved yet. Go to Map View to analyze a site first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        Choose a site to ask the Copilot about
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((site) => (
          <Link
            key={site.id}
            href={`/copilot?siteId=${site.id}`}
            // Each card's own real satellite export image (§4.7, same source
            // as the "satellite photo" saved per site) sits behind the name
            // at low opacity + a slight blur — a subtle map texture instead
            // of a flat surface color, without competing with the text.
            // Sites saved before satellite_photo_url existed just fall back
            // to the plain surface color underneath.
            className="group relative flex h-28 flex-col justify-end overflow-hidden rounded-card-md border border-border-subtle bg-surface-2 p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-border hover:shadow-float"
          >
            {site.satellite_photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={site.satellite_photo_url}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full scale-110 object-cover opacity-20 blur-[1.5px] transition-all duration-300 ease-out group-hover:scale-100 group-hover:opacity-35 group-hover:blur-none"
              />
            )}
            <span className="relative truncate text-sm font-medium text-fg-primary">
              {site.name ?? `Site ${site.id.slice(0, 8)}`}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

async function SiteChat({ siteId }: { siteId: string }) {
  const { row, error } = await fetchSiteHeader(siteId);

  if (error) return <ErrorBanner message={`Site not found. (${error})`} />;
  if (!row) return <ErrorBanner message="Site not found. Check the siteId in the URL." />;

  return (
    <div className="flex h-full flex-col gap-1">
      <h2 className="shrink-0 text-base font-semibold text-neutral-900 dark:text-white">
        {row.name ?? `Site ${row.id.slice(0, 8)}`}
      </h2>
      <div className="min-h-0 flex-1">
        <CopilotChat siteId={row.id} />
      </div>
    </div>
  );
}

// "All sites" mode (project.md §6 follow-up) — no site to fetch a header for,
// so this is just a thin wrapper giving the chat the same shell (heading +
// flex-fill) SiteChat gives the single-site view, with siteId=null passed
// straight through to CopilotChat.
function AllSitesChat() {
  return (
    <div className="flex h-full flex-col gap-1">
      <h2 className="shrink-0 text-base font-semibold text-neutral-900 dark:text-white">All Sites</h2>
      <div className="min-h-0 flex-1">
        <CopilotChat siteId={null} />
      </div>
    </div>
  );
}

// Two-tab landing chooser (project.md §6 follow-up) — "By Site" is the
// default/first tab (confirmed with the user: most sessions start from one
// site analyzed in Map View, and "All Sites" is less useful with only a
// couple of saved sites), "All Sites" is a plain query-param-driven second
// tab, not a separate route, so it stays a Server Component (no client JS
// needed just to switch tabs).
function ModeTabs({ active }: { active: "site" | "all" }) {
  const tabClass = (isActive: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      isActive
        ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-white"
        : "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
    }`;
  return (
    <div className="inline-flex w-fit gap-1 rounded-lg border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-900">
      <Link href="/copilot" className={tabClass(active === "site")}>
        By Site
      </Link>
      <Link href="/copilot?mode=all" className={tabClass(active === "all")}>
        All Sites
      </Link>
    </div>
  );
}

export default function CopilotPage({ searchParams }: { searchParams: { siteId?: string; mode?: string } }) {
  const siteId = searchParams.siteId;
  const mode: "site" | "all" = searchParams.mode === "all" ? "all" : "site";

  return (
    <div className="flex h-app-shell w-full flex-col overflow-hidden">
      <Header title="AI Copilot" />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        {/* Tighter padding below `sm` and a wrapping nav row, same reasoning
            as app/analyst/page.tsx: on a phone these long-labelled buttons
            otherwise wrapped their own text over several lines each, which
            pushed the chat's input box off the bottom of the screen. */}
        <main className="flex flex-1 flex-col overflow-hidden px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="mb-2.5 flex shrink-0 flex-wrap items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-neutral-900 dark:text-white">AI Copilot</h1>
            <div className="flex items-center gap-2">
              {siteId && (
                <>
                  <Link
                    href="/copilot?mode=all"
                    className="whitespace-nowrap rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 sm:px-4 sm:py-2"
                  >
                    ← All sites
                  </Link>
                  <Link
                    href="/copilot"
                    className="whitespace-nowrap rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 sm:px-4 sm:py-2"
                  >
                    <span className="sm:hidden">← Change site</span>
                    <span className="hidden sm:inline">← Choose a different site</span>
                  </Link>
                </>
              )}
              <Link
                href="/analyst"
                className="whitespace-nowrap rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900 sm:px-4 sm:py-2"
              >
                <span className="sm:hidden">← Analyst</span>
                <span className="hidden sm:inline">← Back to Operational Analyst</span>
              </Link>
            </div>
          </div>

          {!siteId && (
            <div className="mb-2.5 shrink-0">
              <ModeTabs active={mode} />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
            {siteId ? <SiteChat siteId={siteId} /> : mode === "all" ? <AllSitesChat /> : <SitePicker />}
          </div>
        </main>
      </div>
    </div>
  );
}
