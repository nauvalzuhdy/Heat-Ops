"use client";

// App shell header (visual redesign, Phase 1 — design system + shell).
// Restyled onto the new bg-app/bg-surface/accent tokens (app/globals.css,
// tailwind.config.ts); no change to what this renders or does — still the
// sidebar-reopen toggle, brand mark, breadcrumb, and theme toggle.
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
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border-subtle bg-surface px-5">
      {/* Single toggle, always in this exact top-left slot whether the
          sidebar is open or closed — previously "open" lived here but
          "close" was a separate button buried at the bottom of AppSidebar,
          an inconsistent position. One button, one position, aria-label and
          pressed-state reflect which action it currently performs. */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-pressed={sidebarOpen}
        className="rounded-btn p-2 text-fg-muted transition-colors duration-200 hover:bg-surface-2 hover:text-fg-primary"
      >
        <PanelToggleIcon />
      </button>

      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-card-sm bg-accent text-xs font-bold text-accent-fg">
          H
        </div>
        <span className="text-sm font-semibold text-fg-primary">HeatOps</span>
      </div>

      <span className="text-border-strong">/</span>
      <span className="text-sm text-fg-secondary">{title}</span>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          aria-label="Toggle color theme"
          className="rounded-btn p-2 text-fg-muted transition-colors duration-200 hover:bg-surface-2 hover:text-fg-primary"
        >
          <SunIcon className="hidden dark:block" />
          <MoonIcon className="block dark:hidden" />
        </button>
      </div>
    </header>
  );
}
