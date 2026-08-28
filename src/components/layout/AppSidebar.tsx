"use client";

// App shell sidebar. Navigation items/routes/behavior unchanged — Map View /
// Operational Analyst / AI Copilot, in that order, all enabled.
//
// Responsive behavior (UI/UX pass): below `lg` (1024px) the sidebar is a
// fixed overlay with a backdrop, so opening it never squeezes the map/
// analysis content into an unusably narrow column on a phone or tablet — at
// `lg` and up it reverts to the original in-flow, width-collapsing behavior
// exactly as before. Same `sidebarOpen` boolean/toggle from uiStore drives
// both — no new state, just different CSS per breakpoint.
//
// The former footer (a "Close sidebar" button + "FortyGuard Hackathon'26"
// caption) is gone: the close action now lives in Header.tsx's single
// top-left toggle (see that file), and the caption text was removed per an
// explicit UI cleanup request rather than left as dead space.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useUIStore } from "@/store/uiStore";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

const MapIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5 3.75 6.75v12.75L9 17.25l6 2.25 5.25-2.25V4.5L15 6.75l-6-2.25Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 4.5v12.75M15 6.75v12.75" />
  </svg>
);

const ChartIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v16.5h16.5" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 15.75 11.25 12l3 3 4.5-4.5" />
  </svg>
);

const SparkleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.75 11 7.5l3.75 1.25L11 10l-1.25 3.75L8.5 10l-3.75-1.25L8.5 7.5l1.25-3.75Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 13.5l.75 2.25 2.25.75-2.25.75-.75 2.25-.75-2.25-2.25-.75 2.25-.75.75-2.25Z" />
  </svg>
);

const navItems: NavItem[] = [
  { label: "Map View", href: "/map", icon: <MapIcon /> },
  { label: "Operational Analyst", href: "/analyst", icon: <ChartIcon /> },
  { label: "AI Copilot", href: "/copilot", icon: <SparkleIcon /> },
];

export default function AppSidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const pathname = usePathname();

  // Default closed on phone/tablet-sized viewports so it doesn't cover the
  // map/content on first load — desktop's existing default-open behavior is
  // untouched. Runs once per mount (i.e. once per page navigation, since
  // each page renders its own <AppSidebar/>), not on resize, so it never
  // fights a manual toggle made mid-session.
  useEffect(() => {
    if (window.innerWidth < 1024) setSidebarOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {/* Mobile/tablet-only backdrop — dismisses the overlay on tap. Hidden
          entirely at lg+ where the sidebar pushes layout instead of
          floating over it. */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 top-16 z-30 bg-black/50 lg:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <div
        className={`fixed inset-y-0 top-16 left-0 z-40 w-64 overflow-hidden border-r border-border-subtle bg-surface transition-transform duration-200 lg:static lg:top-0 lg:z-auto lg:shrink-0 lg:transition-[width] lg:duration-200 ${
          sidebarOpen ? "translate-x-0 lg:w-60" : "-translate-x-full lg:w-0 lg:translate-x-0 lg:border-r-0"
        }`}
      >
        <nav className="flex h-full w-64 flex-col gap-1 px-3 py-4 lg:w-60">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.label}
                href={item.href}
                className={`group flex items-center gap-3 rounded-card-sm px-3 py-2.5 text-sm font-medium transition-colors duration-200 ${
                  isActive ? "bg-accent-soft text-accent" : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                }`}
              >
                <span className={isActive ? "text-accent" : "text-fg-muted group-hover:text-fg-primary"}>{item.icon}</span>
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
