"use client";

// Bottom-docked icon toolbar (project.md §5 discovery). A single horizontal
// row rather than the fully vertical stack sketched in discovery — 9 full-
// width rows would eat a third of the viewport height on a hackathon-sized
// screen; a compact row still satisfies the actual ask (toolbar lives below
// the content, out of its way) while costing far less vertical space.
// Tooltip delay is pure CSS (`delay-300`) rather than a JS timer, so hover
// state never needs to touch React state.
import type { TabConfig, TabKey } from "./useAnalystTabs";

export default function IconToolbar({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: TabConfig[];
  activeTab: TabKey;
  onChange: (key: TabKey) => void;
}) {
  return (
    <nav className="flex shrink-0 items-center justify-center gap-1 overflow-x-auto border-t border-neutral-200 bg-white px-2 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.key === activeTab;
        return (
          <div key={tab.key} className="group relative flex shrink-0 flex-col items-center">
            <button
              type="button"
              onClick={() => onChange(tab.key)}
              aria-label={tab.label}
              aria-current={isActive ? "true" : undefined}
              className={`flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 transition-colors ${
                isActive
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-900"
              }`}
            >
              <Icon size={18} strokeWidth={isActive ? 2.25 : 1.75} />
              <span className="text-[9px] font-medium leading-none">{tab.label.split(" ")[0]}</span>
            </button>
            {!tab.implemented && (
              <span
                className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-400"
                aria-hidden
              />
            )}
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[10px] font-medium text-white opacity-0 shadow-lg transition-opacity delay-300 duration-150 group-hover:opacity-100 dark:bg-neutral-100 dark:text-neutral-900"
            >
              {tab.label}
              {!tab.implemented && <span className="ml-1 text-amber-500">(soon)</span>}
            </span>
          </div>
        );
      })}
    </nav>
  );
}
