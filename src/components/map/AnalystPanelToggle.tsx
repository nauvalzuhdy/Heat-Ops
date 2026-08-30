"use client";

// §4.5 follow-up — Route mode auto-hides the "Analyze" panel (AnalyzePanel,
// app/map/page.tsx) to free up map width for picking origin/destination.
// This is the manual reopen/close control for it, shown only while Route
// mode is active. Same icon + button styling as the main sidebar's toggle
// (components/layout/Header.tsx's PanelToggleIcon/button classes) — a
// second, differently-styled toggle button would read as an unrelated new
// pattern, so this reuses that one verbatim (duplicated locally rather than
// imported, matching how every other components/map/* control already
// defines its own small inline icon — see DrawControl.tsx/RouteControl.tsx).
// Positioned at the Analyze panel's own edge (not the header) since it's
// contextual to Route mode, not a persistent app-shell control like the
// main sidebar toggle.
import { useRouteStore } from "@/store/routeStore";

const PanelToggleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
    <rect x="3.75" y="4.5" width="16.5" height="15" rx="2" />
    <path strokeLinecap="round" d="M9.75 4.5v15" />
  </svg>
);

export default function AnalystPanelToggle() {
  const analystPanelOpen = useRouteStore((s) => s.analystPanelOpen);
  const toggleAnalystPanel = useRouteStore((s) => s.toggleAnalystPanel);

  return (
    <button
      type="button"
      onClick={toggleAnalystPanel}
      aria-label={analystPanelOpen ? "Close Analyze panel" : "Open Analyze panel"}
      aria-pressed={analystPanelOpen}
      className="hidden shrink-0 items-center justify-center border-x border-border-subtle bg-surface px-1 text-fg-muted transition-colors duration-200 hover:bg-surface-2 hover:text-fg-primary lg:flex"
    >
      <PanelToggleIcon />
    </button>
  );
}
