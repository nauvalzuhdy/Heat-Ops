"use client";

import { useDrawStore } from "@/store/drawStore";
import { useAOIStore } from "@/store/aoiStore";

const PolygonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="m12 3.75 7.5 4.5v7.5L12 20.25l-7.5-4.5v-7.5L12 3.75Z" />
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

export default function DrawControl() {
  const terraDraw = useDrawStore((s) => s.terraDraw);
  const isDrawing = useDrawStore((s) => s.isDrawing);
  const setIsDrawing = useDrawStore((s) => s.setIsDrawing);
  const geometry = useAOIStore((s) => s.geometry);
  const clearAOI = useAOIStore((s) => s.clearAOI);

  function startDrawing() {
    if (!terraDraw) return;
    if (geometry) {
      terraDraw.clear();
      clearAOI();
    }
    terraDraw.setMode("polygon");
    setIsDrawing(true);
  }

  function cancelDrawing() {
    if (!terraDraw) return;
    terraDraw.clear();
    terraDraw.setMode("static");
    setIsDrawing(false);
  }

  function clearDrawnAOI() {
    if (!terraDraw) return;
    terraDraw.clear();
    terraDraw.setMode("static");
    clearAOI();
  }

  if (isDrawing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-600 shadow-md dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
        <span>Click to add points, double-click to finish</span>
        <button
          type="button"
          onClick={cancelDrawing}
          className="rounded-md px-2 py-1 font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (geometry) {
    return (
      <div className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 shadow-md dark:border-neutral-800 dark:bg-neutral-950">
        <button
          type="button"
          onClick={startDrawing}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"
        >
          <PolygonIcon />
          Redraw
        </button>
        <button
          type="button"
          onClick={clearDrawnAOI}
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
      onClick={startDrawing}
      disabled={!terraDraw}
      className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-md transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
    >
      <PolygonIcon />
      Draw AOI
    </button>
  );
}
