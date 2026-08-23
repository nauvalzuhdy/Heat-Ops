"use client";

import { useEffect, useState } from "react";
import type { Feature, Polygon } from "geojson";
import type { HeatmapTileProperties } from "@/lib/fortyguard";
import { captureBasemap } from "@/lib/basemapCapture";
import { generateHeatmapImage } from "@/lib/heatmapImage";
import { useMapStore } from "@/store/mapStore";
import { useAnalysisStore } from "@/store/analysisStore";

export default function HeatmapImage({
  tiles,
  aoiGeometry,
}: {
  tiles: Feature<Polygon, HeatmapTileProperties>[];
  aoiGeometry: Polygon;
}) {
  const viewMode = useMapStore((s) => s.viewMode);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Cleared up front rather than left in place: a stale image from the
    // previous AOI on screen would be worse than a moment of placeholder.
    setSrc(null);

    (async () => {
      // Falls back to a basemap-less render if the offscreen map times out or
      // the tile host leaves the canvas cross-origin tainted.
      const basemap = await captureBasemap(aoiGeometry, viewMode);
      if (cancelled) return;
      const canvas = generateHeatmapImage({ tiles, aoiGeometry, basemap });
      if (cancelled) return;
      // With a basemap the image is photographic and fully opaque, where PNG
      // is the wrong codec — a satellite composite came out at 1.7 MB as PNG.
      // The basemap-less fallback is flat colour on transparency, which JPEG
      // can represent neither well nor at all.
      const dataUrl = basemap ? canvas.toDataURL("image/jpeg", 0.85) : canvas.toDataURL("image/png");
      setSrc(dataUrl);
      // §4.7's "heat photo" reads this exact data URL instead of regenerating
      // — the same encoded bytes this card displays, not a fresh render.
      useAnalysisStore.getState().setHeatmapImageUrl(dataUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [tiles, aoiGeometry, viewMode]);

  if (!src) {
    return (
      <div className="flex h-40 items-center justify-center rounded-md border border-neutral-200 text-xs text-neutral-400 dark:border-neutral-800 dark:text-neutral-600">
        Rendering heat snapshot…
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={`Surface temperature over the ${viewMode} basemap, clipped to the drawn AOI boundary`}
      className="w-full rounded-md border border-neutral-200 dark:border-neutral-800"
    />
  );
}
