"use client";

// Hotspot Detection, Grid Zones tab (project.md §5, Sub-task 2 revision).
// Readability priority (explicit revision spec): the 3x3 zone overlay must
// stay semi-transparent with the real basemap clearly visible underneath —
// solid color blocks were the exact problem this revision replaces. Renders
// on a live MapLibre map (vector "Schematic" style, more legible under a
// color tint than satellite imagery) rather than the earlier version's
// static PNG overlay, so zone rectangles are projected from the site's real
// bbox via map.project() on every repaint — pixel-exact at any zoom/pan,
// fixing that version's documented approximate registration.
import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MAP_STYLE_URL } from "@/lib/mapConfig";
import {
  binTilesToZones,
  zoneLngLatBounds,
  zoneTintColor,
  type HotspotZone,
} from "@/lib/heatmapUtils";
import type { HeatTileRecord } from "@/lib/siteRecord";
import AttributionBadge, { type AttributionStatus } from "./AttributionBadge";

const ZONE_FILL_OPACITY = 0.4; // semi-transparent — basemap must stay visible underneath

type ProjectedZone = HotspotZone & {
  screen: { left: number; top: number; width: number; height: number };
};

export default function HotspotGridView({
  tiles,
  bbox,
  attribution,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number];
  attribution: AttributionStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zonesRef = useRef<HotspotZone[]>(binTilesToZones(tiles, bbox));
  const [projected, setProjected] = useState<ProjectedZone[]>([]);

  useEffect(() => {
    zonesRef.current = binTilesToZones(tiles, bbox);
  }, [tiles, bbox]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      bounds: [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      fitBoundsOptions: { padding: 24 },
    });

    map.addControl(new NavigationControl(), "bottom-right");

    function updateOverlay() {
      const next = zonesRef.current.map((zone) => {
        const [west, south, east, north] = zoneLngLatBounds(
          bbox,
          zone.row,
          zone.col,
        );
        const topLeft = map.project([west, north]);
        const bottomRight = map.project([east, south]);
        return {
          ...zone,
          screen: {
            left: topLeft.x,
            top: topLeft.y,
            width: bottomRight.x - topLeft.x,
            height: bottomRight.y - topLeft.y,
          },
        };
      });
      setProjected(next);
    }

    map.on("load", updateOverlay);
    // "render" fires on every repaint (including mid pan/zoom animation), so
    // the overlay stays pixel-registered instead of only updating on idle.
    map.on("render", updateOverlay);

    return () => map.remove();
  }, [bbox]);

  const nonEmpty = projected.filter((z) => z.rank != null);
  const coolestRank =
    nonEmpty.length > 0
      ? Math.max(...nonEmpty.map((z) => z.rank as number))
      : null;
  const hottest = projected.find((z) => z.isHottest) ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute inset-0">
        {projected.map((zone) => {
          const isCoolest =
            zone.rank != null &&
            coolestRank != null &&
            zone.rank === coolestRank;
          const [r, g, b] =
            zone.meanTempC != null ? zoneTintColor(zone.meanTempC) : [0, 0, 0];
          return (
            <div
              key={zone.id}
              className="absolute flex items-center justify-center border-2 border-white/70"
              style={{
                left: zone.screen.left,
                top: zone.screen.top,
                width: zone.screen.width,
                height: zone.screen.height,
                backgroundColor:
                  zone.meanTempC != null
                    ? `rgba(${r}, ${g}, ${b}, ${ZONE_FILL_OPACITY})`
                    : "transparent",
                boxShadow: zone.isHottest
                  ? "inset 0 0 0 3px #dc2626"
                  : isCoolest
                    ? "inset 0 0 0 2px #3b82f6"
                    : undefined,
              }}
            >
              {zone.meanTempC != null ? (
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className="text-xl font-bold leading-none text-white"
                    style={{
                      textShadow:
                        "0 0 6px rgba(0,0,0,0.9), 0 0 2px rgba(0,0,0,0.9)",
                    }}
                  >
                    {zone.meanTempC.toFixed(1)}°
                  </span>
                  {zone.isHottest && (
                    <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                      Hottest
                    </span>
                  )}
                  {!zone.isHottest && isCoolest && (
                    <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                      Coolest
                    </span>
                  )}
                </div>
              ) : (
                <span className="rounded-md bg-black/45 px-2 py-1 text-[9px] text-white/70">
                  No data
                </span>
              )}
            </div>
          );
        })}
      </div>

      {hottest && hottest.meanTempC != null && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-red-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg">
          🔴 Hottest: {hottest.meanTempC.toFixed(1)}°C (R{hottest.row + 1}C
          {hottest.col + 1})
        </div>
      )}

      {/* Legend text lives in this same overlay (via `title`, hover
            tooltip) rather than as a separate element below the map — a
            sibling caption would add height outside the map's fill area. */}
      <div
        className="pointer-events-auto absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/70 px-2.5 py-1.5 text-[10px] text-white"
        title={`Zone tint: blue (cool) → red (hot), 22–38°C, ${(ZONE_FILL_OPACITY * 100).toFixed(0)}% opacity — the basemap stays visible underneath. Registered to the site's exact bbox, so it stays aligned while you pan/zoom.`}
      >
        <span>🔥 Grid Zones (3×3)</span>
        <AttributionBadge status={attribution} />
      </div>
    </div>
  );
}
