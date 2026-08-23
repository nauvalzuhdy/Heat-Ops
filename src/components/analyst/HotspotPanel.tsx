"use client";

// Hotspot Detection (project.md §5, Sub-task 2 — REVISED). Original v1 was a
// tabular 3x3 grid; v2 overlaid that grid on a static saved PNG but the tint
// read as too solid, burying the basemap under it ("peta tidak terbaca").
// This revision replaces both with three tabs, all built on live MapLibre
// maps sharing the site's saved bbox + heat_tiles (still no new FortyGuard
// call — see HotspotSatelliteView/HotspotGridView headers):
//   - Satellite: real Esri RGB imagery
//   - Grid: 3x3 zone overlay, kept semi-transparent so the basemap underneath
//     stays legible (readability was the explicit priority in this revision)
//   - 3D: stubbed via ComingSoonPanel — Map View's own §4.6 3D rendering
//     (deck.gl BuildingLayer + LightingEffect) hasn't been built yet, so
//     there is nothing to reuse here. Filling this tab in for real happens
//     once that Map View sub-task ships, not by improvising a second 3D
//     implementation scoped to just this panel.
import { useState } from "react";
import { Map as MapIcon, Flame, Box } from "lucide-react";
import HotspotSatelliteView from "./HotspotSatelliteView";
import HotspotGridView from "./HotspotGridView";
import ComingSoonPanel from "./ComingSoonPanel";
import type { AttributionStatus } from "./AttributionBadge";
import type { HeatTileRecord } from "@/lib/siteRecord";

type HotspotView = "satellite" | "grid" | "3d";

const VIEW_TABS: { key: HotspotView; label: string; icon: typeof MapIcon }[] = [
  { key: "satellite", label: "Satellite", icon: MapIcon },
  { key: "grid", label: "Grid Zones", icon: Flame },
  { key: "3d", label: "3D View", icon: Box },
];

export default function HotspotPanel({
  tiles,
  bbox,
  attribution,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number] | null;
  attribution: AttributionStatus;
}) {
  const [activeView, setActiveView] = useState<HotspotView>("grid");

  if (!bbox || tiles.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Hotspot Analysis
        </h2>
        <p className="text-xs text-neutral-400 dark:text-neutral-600">
          No heat tiles available for this site — hotspot zones need a completed
          heatmap capture from Map View.
        </p>
      </div>
    );
  }

  return (
    // h-full: fills exactly what AnalystTabsShell's content region gives
    // this tab, so the map area below can flex-fill it precisely instead of
    // needing a fixed px height.
    <div className="flex h-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          Hotspot Detection
        </h2>
        <div className="flex gap-1.5">
          {VIEW_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === activeView;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveView(tab.key)}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive
                    ? "border-orange-500 bg-orange-500 text-white"
                    : "border-neutral-200 text-neutral-500 hover:border-orange-300 dark:border-neutral-800 dark:text-neutral-400"
                }`}
              >
                <Icon size={13} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* min-h-0: the map view fills exactly this remaining space (its own
          root is h-full, not a fixed px height) — see HotspotGridView /
          HotspotSatelliteView. */}
      <div className="min-h-0 flex-1">
        {activeView === "satellite" && (
          <HotspotSatelliteView bbox={bbox} attribution={attribution} />
        )}
        {activeView === "grid" && (
          <HotspotGridView
            tiles={tiles}
            bbox={bbox}
            attribution={attribution}
          />
        )}
        {activeView === "3d" && (
          <ComingSoonPanel label="3D View — Map View §4.6 not built yet" />
        )}
      </div>
    </div>
  );
}
