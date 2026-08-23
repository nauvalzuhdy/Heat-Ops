"use client";

import { useUIStore } from "@/store/uiStore";

// Both icons always render; the "dark" class on <html> (applied before
// hydration by ThemeScript) picks the visible one via CSS. Branching on the
// store's `theme` here instead would render a different element server vs
// client and fail hydration — see ThemeSync for how `theme` gets reconciled.

const PanelToggleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
    <rect x="3.75" y="4.5" width="16.5" height="15" rx="2" />
    <path strokeLinecap="round" d="M9.75 4.5v15" />
  </svg>
);

const SunIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className={`h-5 w-5 ${className}`}>
    <circle cx="12" cy="12" r="4" />
    <path
      strokeLinecap="round"
      d="M12 2.75v2M12 19.25v2M4.75 12h-2M21.25 12h-2M6.4 6.4 5 5M19 19l-1.4-1.4M6.4 17.6 5 19M19 5l-1.4 1.4"
    />
  </svg>
);

const MoonIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className={`h-5 w-5 ${className}`}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 14.5A8.25 8.25 0 1 1 9.5 3.75a6.5 6.5 0 0 0 10.75 10.75Z" />
  </svg>
);

export default function Header({ title = "Map View" }: { title?: string }) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleTheme = useUIStore((s) => s.toggleTheme);

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-950">
      {/* The "close" toggle now lives at the bottom of AppSidebar (fills its
          previously-empty footer space) — this button only needs to exist
          here as the "reopen" affordance once the sidebar is fully
          collapsed (w-0), since at that point its own toggle is clipped. */}
      {!sidebarOpen && (
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Open sidebar"
          aria-pressed={sidebarOpen}
          className="rounded-md p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <PanelToggleIcon />
        </button>
      )}

      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-orange-500 text-xs font-bold text-white">
          H
        </div>
        <span className="text-sm font-semibold text-neutral-900 dark:text-white">HeatOps</span>
      </div>

      <span className="text-neutral-300 dark:text-neutral-700">/</span>
      <span className="text-sm text-neutral-500 dark:text-neutral-400">{title}</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle color theme"
          className="rounded-md p-2 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <SunIcon className="hidden dark:block" />
          <MoonIcon className="block dark:hidden" />
        </button>
      </div>
    </header>
  );
}
