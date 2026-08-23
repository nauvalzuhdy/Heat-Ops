"use client";

// Hotspot Detection, Satellite tab (project.md §5, Sub-task 2 revision).
// Read-only MapLibre map showing the site's real RGB imagery (same Esri
// World Imagery source as Map View's satellite basemap, see lib/mapConfig.ts)
// framed to the saved AOI bbox. No new API call: Esri's tile server is a
// public basemap request, the same kind Map View already makes for its own
// satellite toggle — not a FortyGuard/Overpass credit-consuming call.
import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  ESRI_SATELLITE_TILE_URL,
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_SOURCE_ID,
  ESRI_SATELLITE_LAYER_ID,
  ESRI_SATELLITE_MAX_ZOOM,
} from "@/lib/mapConfig";
import AttributionBadge, { type AttributionStatus } from "./AttributionBadge";

export default function HotspotSatelliteView({
  bbox,
  attribution,
}: {
  bbox: [number, number, number, number];
  attribution: AttributionStatus;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: { version: 8, sources: {}, layers: [] },
      bounds: [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      fitBoundsOptions: { padding: 24 },
    });

    map.addControl(new NavigationControl(), "bottom-right");

    map.on("load", () => {
      map.addSource(ESRI_SATELLITE_SOURCE_ID, {
        type: "raster",
        tiles: [ESRI_SATELLITE_TILE_URL],
        tileSize: 256,
        maxzoom: ESRI_SATELLITE_MAX_ZOOM,
        attribution: ESRI_SATELLITE_ATTRIBUTION,
      });
      map.addLayer({
        id: ESRI_SATELLITE_LAYER_ID,
        type: "raster",
        source: ESRI_SATELLITE_SOURCE_ID,
      });
    });

    return () => map.remove();
  }, [bbox]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/70 px-2.5 py-1.5 text-[10px] text-white">
        <span>📷 Satellite (RGB) · Esri World Imagery</span>
        <AttributionBadge status={attribution} />
      </div>
    </div>
  );
}
