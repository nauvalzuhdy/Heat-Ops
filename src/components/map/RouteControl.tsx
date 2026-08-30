"use client";

// §4.5 — the "Route" button, structurally mirroring DrawControl.tsx's
// three-state pattern (idle button / in-progress pill with Cancel / result
// pill with two actions).
import { useRouteStore } from "@/store/routeStore";

const RouteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-4 w-4">
    <circle cx="6" cy="6" r="2.25" />
    <circle cx="18" cy="18" r="2.25" />
    <path strokeLinecap="round" d="M6 8.25v3a4.5 4.5 0 0 0 4.5 4.5h3" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-4 w-4">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4.5 6.75h15M9.75 6.75V4.5a1.5 1.5 0 0 1 1.5-1.5h1.5a1.5 1.5 0 0 1 1.5 1.5v2.25m3 0-.6 12a1.5 1.5 0 0 1-1.5 1.5H8.85a1.5 1.5 0 0 1-1.5-1.5l-.6-12"
    />
  </svg>
);

export default function RouteControl() {
  const pickingStage = useRouteStore((s) => s.pickingStage);
  const routes = useRouteStore((s) => s.routes);
  const startPicking = useRouteStore((s) => s.startPicking);
  const cancelPicking = useRouteStore((s) => s.cancelPicking);
  const clearRoute = useRouteStore((s) => s.clearRoute);

  if (pickingStage !== "idle") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 shadow-md dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
        <span>
          {pickingStage === "picking_origin" ? "Click the map to set your origin" : "Now click to set your destination"}
        </span>
        <button
          type="button"
          onClick={cancelPicking}
          className="rounded-md px-2 py-1 font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (routes.length > 0) {
    return (
      <div className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 shadow-md dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={startPicking}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <RouteIcon />
          New route
        </button>
        <button
          type="button"
          onClick={clearRoute}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-950/40"
        >
          <TrashIcon />
          Clear
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startPicking}
      className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-md transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
    >
      <RouteIcon />
      Route
    </button>
  );
}
