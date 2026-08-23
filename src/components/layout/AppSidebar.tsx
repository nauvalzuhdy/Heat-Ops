"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useUIStore } from "@/store/uiStore";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
  disabled?: boolean;
  badge?: string;
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

// Same icon Header.tsx used to show for the sidebar toggle — defined locally
// rather than imported, matching this file's existing pattern of owning its
// own icon components (MapIcon/ChartIcon/SparkleIcon below).
const PanelToggleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-5 w-5">
    <rect x="3.75" y="4.5" width="16.5" height="15" rx="2" />
    <path strokeLinecap="round" d="M9.75 4.5v15" />
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
  { label: "AI Copilot", href: "#", icon: <SparkleIcon />, disabled: true, badge: "Soon" },
];

export default function AppSidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const pathname = usePathname();

  return (
    <div
      className={`h-full shrink-0 overflow-hidden border-r border-neutral-200 bg-white transition-[width] duration-200 dark:border-neutral-800 dark:bg-neutral-950 ${
        sidebarOpen ? "w-60" : "w-0 border-r-0"
      }`}
    >
      <nav className="flex h-full w-60 flex-col gap-1 px-3 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
          const baseClasses =
            "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors";

          if (item.disabled) {
            return (
              <div
                key={item.label}
                aria-disabled="true"
                className={`${baseClasses} cursor-not-allowed text-neutral-400 dark:text-neutral-600`}
              >
                <span className="text-neutral-400 dark:text-neutral-600">{item.icon}</span>
                <span className="flex-1">{item.label}</span>
                {item.badge && (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    {item.badge}
                  </span>
                )}
              </div>
            );
          }

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`${baseClasses} ${
                isActive
                  ? "bg-orange-500/10 text-orange-600 dark:text-orange-400"
                  : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
              }`}
            >
              <span
                className={
                  isActive
                    ? "text-orange-600 dark:text-orange-400"
                    : "text-neutral-400 group-hover:text-neutral-900 dark:text-neutral-500 dark:group-hover:text-white"
                }
              >
                {item.icon}
              </span>
              <span className="flex-1">{item.label}</span>
            </Link>
          );
        })}

        {/* Was previously empty vertical space below the 3 nav items — now
            holds the sidebar-close toggle (moved out of Header.tsx) plus the
            existing footer text. */}
        <div className="mt-auto flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-800">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Close sidebar"
            aria-pressed={sidebarOpen}
            className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
          >
            <span className="text-neutral-400 group-hover:text-neutral-900 dark:text-neutral-500 dark:group-hover:text-white">
              <PanelToggleIcon />
            </span>
            <span>Close sidebar</span>
          </button>
          <div className="px-3 text-xs text-neutral-400 dark:text-neutral-500">FortyGuard Hackathon&apos;26</div>
        </div>
      </nav>
    </div>
  );
}
