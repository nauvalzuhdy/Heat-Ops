// "Analyzed X ago" badge (project.md §5 Saved Sites redesign). Computed
// server-side (SavedSitesList is an async Server Component, already
// force-dynamic — see app/analyst/page.tsx) so this never needs a client
// re-render to stay accurate on page load, and can't hydration-mismatch
// the way a client-side `new Date()` computed against a server-rendered
// string would.
export function relativeTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// "Showing Aug 26 data" label (project.md §2/§4.4's single-step yesterday
// fallback) — `dateStr` is a plain "YYYY-MM-DD" (FortyGuard's date_time
// format, not an ISO timestamp), parsed as UTC midnight so the displayed
// month/day never shifts a day off depending on the viewer's own timezone.
export function formatFallbackDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
