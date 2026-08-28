"use client";

// Hotspot Detection (project.md §5 — Heatmap section redesign, zone-chart
// merge pass). v1 was a tabular 3x3 grid. v2 overlaid that grid on a static
// saved PNG but the tint read as too solid, burying the basemap under it. v3
// replaced both with 3 tabs, each a live MapLibre map sharing the site's
// saved bbox/tiles — but that had a real, confirmed bug (see
// HotspotPixelGridView.tsx's header): React 18 dev StrictMode double-invoking
// the mount effect raced two MapLibre instances' remote style fetches
// against the same container, breaking the Grid Zones tab's camera fit
// permanently. v4 replaced the live maps with a static saved photo + SVG
// overlay (Satellite, then a dots-based Heat Points column, since replaced
// by this pixel-grid column — see HotspotPixelGridView.tsx for why).
//
// v5 (this pass) — the standalone "Charts & Metrics" tab was removed: its
// zone temperature bar chart lived in a separate tab, disconnected from the
// map it was describing, so a user had no way to connect "Zone C is
// hottest" to an actual place in the AOI without tabbing back and forth and
// doing (row*3+col) arithmetic in their head. The chart now lives here as a
// 3rd column, and the Satellite column gained a permanent 3x3 zone
// grid+label overlay (SpatialZoneOverlay, in HotspotSatelliteView.tsx) using
// the SAME spatial labels (lib/heatmapUtils.ts's zoneLabel() — compass
// names, not the old "Zone A".."Zone I" letters) as the chart's own x-axis.
// `highlightedZoneId` is lifted to this component specifically so hovering a
// bar and hovering a map cell can highlight each other — neither child
// computes the other's zone identity independently.
//
// v6 (cross-highlight completeness fix) — the highlight used to only reach
// HotspotSatelliteView's zone-box overlay, not HotspotPixelGridView's
// pixel-native thermal grid next to it, even though that pixel grid is the
// more visually prominent "overlay" a user's eye goes to first (and, at low
// tile counts, can look coincidentally grid-like enough to be mistaken for
// the same 3x3 grid). `highlightedZoneId`/`onZoneHover` are now passed to
// BOTH children — HotspotPixelGridView classifies its own pixel cells into
// these same 9 zones via zoneRowColForPoint() (lib/heatmapUtils.ts), so a
// hovered zone now highlights the whole matching GROUP of pixel cells there,
// not just the Satellite column's single rectangle.
import { useMemo, useState } from "react";
import type { Polygon } from "geojson";
import HotspotSatelliteView from "./HotspotSatelliteView";
import HotspotPixelGridView from "./HotspotPixelGridView";
import ZoneTemperatureBarChart from "./ZoneTemperatureBarChart";
import AttributionBadge, { type AttributionStatus } from "./AttributionBadge";
import { binTilesToZones, zoneLabel, type OverlayZone } from "@/lib/heatmapUtils";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";
import type { HeatTileRecord } from "@/lib/siteRecord";

export default function HotspotPanel({
  tiles,
  bbox,
  aoiGeometry,
  satellitePhotoUrl,
  heatStats,
  attribution,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number] | null;
  aoiGeometry: Polygon | null;
  satellitePhotoUrl: string | null;
  heatStats: { minTempC: number; maxTempC: number } | null;
  attribution: AttributionStatus;
}) {
  // Cross-highlight bridge between the chart and the map overlay — lives
  // here (the shared parent) rather than in either child, since neither one
  // owns "which zone is currently highlighted" on its own.
  const [highlightedZoneId, setHighlightedZoneId] = useState<string | null>(null);

  const zones: OverlayZone[] = useMemo(() => {
    if (!bbox || tiles.length === 0) return [];
    return binTilesToZones(tiles, bbox).map((z) => ({
      id: z.id,
      row: z.row,
      col: z.col,
      label: zoneLabel(z.row, z.col),
      meanTempC: z.meanTempC,
      isHottest: z.isHottest,
    }));
  }, [tiles, bbox]);

  if (!bbox || !aoiGeometry || tiles.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-card-md border border-border-subtle bg-surface p-4 shadow-card">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
          Hotspot Analysis
        </h2>
        <p className="text-xs text-fg-muted">
          No heat tiles available for this site — hotspot zones need a completed
          heatmap capture from Map View.
        </p>
      </div>
    );
  }

  return (
    // h-full: fills exactly what AnalystTabsShell's content region gives this
    // tab. At `lg`+, the 3-column grid below shares that height exactly
    // (min-h-0 + flex-1 + lg:h-full on each column, no scroll needed on a
    // normal desktop viewport). Below `lg`, columns stack with a real
    // min-height each and the ancestor's own overflow-y-auto (AnalystTabsShell)
    // handles the resulting scroll — same pattern as every other tab here.
    <div className="flex h-full flex-col gap-3">
      <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
        Hotspot Detection
      </h2>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="h-[420px] lg:h-full">
          {/* No attribution badge here — see HotspotSatelliteView.tsx's
              header: this is a one-time Esri export, not FortyGuard/Overpass
              data, so a Real/Cached provenance badge doesn't apply and would
              misleadingly imply it does. */}
          <HotspotSatelliteView
            aoiGeometry={aoiGeometry}
            bbox={bbox}
            satellitePhotoUrl={satellitePhotoUrl}
            zones={zones}
            highlightedZoneId={highlightedZoneId}
            onZoneHover={setHighlightedZoneId}
          />
        </div>
        <div className="h-[420px] lg:h-full">
          <HotspotPixelGridView
            tiles={tiles}
            bbox={bbox}
            aoiGeometry={aoiGeometry}
            satellitePhotoUrl={satellitePhotoUrl}
            heatStats={heatStats}
            attribution={attribution}
            highlightedZoneId={highlightedZoneId}
            onZoneHover={setHighlightedZoneId}
          />
        </div>
        <div
          className={`flex h-[420px] flex-col gap-2 rounded-card-md border border-border-subtle bg-surface p-3.5 shadow-card lg:h-full ${CARD_HOVER_CLASS}`}
        >
          <div className="flex shrink-0 items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">Temperature by Zone</h3>
            <AttributionBadge status={attribution} />
          </div>
          <p className="shrink-0 text-[10px] leading-relaxed text-fg-muted">
            Hover a bar to highlight its area on both the Satellite and Grid Thermal maps — each of these 9 zones spans a group of pixel cells there, not a 1:1 cell.
          </p>
          <div className="min-h-0 flex-1">
            <ZoneTemperatureBarChart
              tiles={tiles}
              bbox={bbox}
              highlightedZoneId={highlightedZoneId}
              onZoneHover={setHighlightedZoneId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
