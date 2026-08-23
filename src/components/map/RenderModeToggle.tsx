"use client";

import { useMapStore, type RenderMode } from "@/store/mapStore";

const OPTIONS: { mode: RenderMode; label: string }[] = [
  { mode: "massing", label: "Massing" },
  { mode: "landcover", label: "Land-cover" },
];

export default function RenderModeToggle() {
  const renderMode = useMapStore((s) => s.renderMode);
  const setRenderMode = useMapStore((s) => s.setRenderMode);

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 shadow-md dark:border-neutral-800 dark:bg-neutral-950">
      {OPTIONS.map((option) => {
        const isActive = renderMode === option.mode;
        return (
          <button
            key={option.mode}
            type="button"
            onClick={() => setRenderMode(option.mode)}
            aria-pressed={isActive}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isActive
                ? "bg-orange-500 text-white"
                : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
