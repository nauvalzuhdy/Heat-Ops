// Hotspot Detection, Heatmap Grid column (project.md §5 — Heatmap section
// redesign, Kolom 2; replaces HotspotHeatPointsView.tsx's individual dots).
// Renders the site's real FortyGuard tile grid — one small rectangle per
// `heat_tiles` entry, positioned from that tile's own saved bounds — rather
// than dots or a coarse 3x3 aggregate. Same base image
// (`satellite_photo_url`) and SVG-overlay approach as the Satellite column;
// still no live map, no remote basemap.
//
// IMPORTANT — the pixel-native thermal grid/colors here are unaffected by
// binTilesToZones()'s 3x3 zone binning, which Shift Schedule, ROI Simulator,
// recommend_intervention, and every AI Copilot tool (get_hotspot,
// check_new_building_feasibility, compare_interventions) still use exactly
// as before, reading the same tiles[].lat/lng/tempC fields this view also
// reads. This view additionally reads a new, optional tiles[].bounds field
// (see below) that none of those other consumers touch.
//
// Cross-highlight (zone-chart merge follow-up): each pixel cell here IS
// classified into one of the chart's 9 zones — via zoneRowColForPoint()
// (lib/heatmapUtils.ts), the exact point-to-zone rule binTilesToZones()
// itself uses, applied to this cell's own centroid — purely so hovering a
// chart bar or a Satellite-column zone box can light up the matching GROUP
// of pixel cells here too (see cellZoneIds below). This does not change
// which zone any tile is binned into for the chart/Shift Schedule/ROI/AI
// Copilot numbers, and does not touch this column's own thermal color scale
// — a zone can (and usually does) span several pixel cells here, unlike the
// Satellite column's single rectangle per zone.
//
// Two rendering modes, chosen per-site from what's actually in its saved
// heat_tiles — see lib/hotspotGridCells.ts's computeHotspotGridCells() for
// the actual mode logic, shared verbatim with the PDF report's matching
// section (lib/pdf/SiteReportDocument.tsx) so the two can never draw a
// different grid for the same site:
//
// 1. Real bounds (sites analyzed after lib/siteRecord.ts started saving
//    tiles[].bounds — the tile's own FortyGuard polygon, confirmed a real
//    per-tile Polygon against a live API response, see lib/fortyguard.ts's
//    HeatmapResult comment). Every tile renders as a rectangle at its exact
//    saved bounds — pixel-accurate, cell count equals however many tiles
//    FortyGuard actually returned for that AOI at its granularity (60/80/
//    100, from pickGranularity() in lib/mapConfig.ts — not re-derived here,
//    the real per-tile geometry already encodes it).
//
// 2. Approximate (sites saved before that field existed — heat_tiles only
//    has centroid + temp, the original per-tile polygon was discarded at
//    save time before this fix). Falls back to reconstructing a grid sized
//    to roughly match the real tile count, clearly labeled "approximate" so
//    it's never confused with the pixel-exact mode. Confirmed with user: no
//    re-fetch to FortyGuard to backfill old sites — that would spend credit
//    for a purely visual improvement, out of scope for this fix.
import { useMemo } from "react";
import type { Polygon } from "geojson";
import { computeSatelliteImageFrame } from "@/lib/satelliteImageProjection";
import { AOI_OUTLINE_HEX } from "@/lib/aoiOverlayStyle";
import { computeHotspotGridCells } from "@/lib/hotspotGridCells";
import { thermalColorForTemp, thermalGradientCss } from "@/lib/thermalColorScale";
import { zoneRowColForPoint } from "@/lib/heatmapUtils";
import type { HeatTileRecord } from "@/lib/siteRecord";
import AttributionBadge, { type AttributionStatus } from "./AttributionBadge";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";

const CELL_FILL_ALPHA = 0.8;

export default function HotspotPixelGridView({
  tiles,
  bbox,
  aoiGeometry,
  satellitePhotoUrl,
  heatStats,
  attribution,
  highlightedZoneId,
  onZoneHover,
}: {
  tiles: HeatTileRecord[];
  bbox: [number, number, number, number];
  aoiGeometry: Polygon;
  satellitePhotoUrl: string | null;
  heatStats: { minTempC: number; maxTempC: number } | null;
  attribution: AttributionStatus;
  /** Cross-highlight bridge to the chart + Satellite overlay (see HotspotPanel.tsx) — the zone id ("row-col") to highlight, if any. */
  highlightedZoneId?: string | null;
  /** Fires on cell hover/unhover (null). */
  onZoneHover?: (zoneId: string | null) => void;
}) {
  const frame = useMemo(() => computeSatelliteImageFrame(aoiGeometry), [aoiGeometry]);
  const ring = aoiGeometry.coordinates[0];
  const aoiPoints = useMemo(
    () => ring.map(([lng, lat]) => frame.project(lng, lat)).map((p) => `${p.x},${p.y}`).join(" "),
    [ring, frame]
  );

  const { cells, hasRealBounds } = useMemo(() => computeHotspotGridCells(tiles, bbox), [tiles, bbox]);

  // Which of the chart's 3x3 zones each pixel-native cell falls into, keyed
  // by each cell's OWN centroid — reuses zoneRowColForPoint(), the exact
  // same point-to-zone rule binTilesToZones() uses for the chart itself, so
  // this can never classify a cell differently than the chart would classify
  // a tile at the same spot. A zone can (and usually will) own several
  // pixel cells here, unlike the Satellite column's single big rectangle
  // per zone.
  const cellZoneIds = useMemo(
    () =>
      cells.map((cell) => {
        const [west, south, east, north] = cell.bounds;
        const { row, col } = zoneRowColForPoint((south + north) / 2, (west + east) / 2, bbox);
        return `${row}-${col}`;
      }),
    [cells, bbox]
  );

  const [minC, maxC] = useMemo(() => {
    if (heatStats) return [heatStats.minTempC, heatStats.maxTempC];
    const temps = tiles.map((t) => t.tempC);
    return [Math.min(...temps), Math.max(...temps)];
  }, [heatStats, tiles]);

  const hottestTempC = useMemo(
    () => cells.reduce((max, c) => Math.max(max, c.tempC), -Infinity),
    [cells]
  );

  if (!satellitePhotoUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-card-md border border-dashed border-border-subtle bg-surface p-4 text-center shadow-card">
        <p className="text-xs font-medium text-fg-muted">No satellite photo saved</p>
        <p className="text-[11px] text-fg-muted">
          Heatmap Grid needs the saved satellite photo as its base image.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-card-md border border-border-subtle shadow-card ${CARD_HOVER_CLASS}`}
    >
      <div className="relative h-full w-full flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satellitePhotoUrl} alt="Satellite reference photo" className="h-full w-full object-cover" />
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${frame.widthPx} ${frame.heightPx}`}
          preserveAspectRatio="xMidYMid slice"
          // Clear on leaving the WHOLE grid, not per-cell — with potentially
          // dozens of small adjacent cells sharing one zone, a per-cell
          // mouseleave firing null before the next cell's mouseenter fires
          // would flicker the highlight off/on while moving within one
          // zone. Satellite's overlay doesn't need this (one big rect per
          // zone, no adjacent same-zone neighbors to flicker between).
          onMouseLeave={() => onZoneHover?.(null)}
        >
          {cells.map((cell, i) => {
            const [west, south, east, north] = cell.bounds;
            const topLeft = frame.project(west, north);
            const bottomRight = frame.project(east, south);
            const [r, g, b] = thermalColorForTemp(cell.tempC, minC, maxC);
            return (
              <rect
                key={i}
                x={topLeft.x}
                y={topLeft.y}
                width={Math.max(0, bottomRight.x - topLeft.x)}
                height={Math.max(0, bottomRight.y - topLeft.y)}
                fill={`rgba(${r}, ${g}, ${b}, ${CELL_FILL_ALPHA})`}
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={0.75}
                onMouseEnter={() => onZoneHover?.(cellZoneIds[i])}
              />
            );
          })}
          {/* Highlight outlines drawn as a SEPARATE, later pass so a
              highlighted cell's thick accent border always paints on top of
              every fill — rendered in cells' own array order (above), a
              highlighted cell's border could get partially painted over by
              a later, unrelated neighboring cell sharing an edge. */}
          {highlightedZoneId != null &&
            cells.map((cell, i) => {
              if (cellZoneIds[i] !== highlightedZoneId) return null;
              const [west, south, east, north] = cell.bounds;
              const topLeft = frame.project(west, north);
              const bottomRight = frame.project(east, south);
              return (
                <rect
                  key={`hl-${i}`}
                  x={topLeft.x}
                  y={topLeft.y}
                  width={Math.max(0, bottomRight.x - topLeft.x)}
                  height={Math.max(0, bottomRight.y - topLeft.y)}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth={3}
                  style={{ filter: "drop-shadow(0 0 4px var(--accent))", pointerEvents: "none" }}
                />
              );
            })}
          <polygon
            points={aoiPoints}
            fill="none"
            stroke={AOI_OUTLINE_HEX}
            strokeWidth={3}
            strokeLinejoin="round"
            style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,0.85))" }}
          />
        </svg>

        {Number.isFinite(hottestTempC) && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-red-600 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-lg">
            🔴 Hottest: {hottestTempC.toFixed(1)}°C
          </div>
        )}
      </div>

      {/* Visible legend (not hover-only): colorbar built from the exact
          same thermal scale + domain as the grid cells, with this site's
          own min/max — not a repeated/hardcoded gradient. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border-subtle bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-medium text-fg-muted">
            {hasRealBounds ? "✓" : "⚠️"} Heatmap grid — FortyGuard heat_tiles ({tiles.length} tiles
            {hasRealBounds ? ", pixel-exact" : ", approximate — no per-tile bounds saved"})
          </span>
          <AttributionBadge status={attribution} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-fg-muted">{minC.toFixed(1)}°C</span>
          <div className="h-2 w-20 rounded-full" style={{ background: thermalGradientCss() }} />
          <span className="text-[10px] text-fg-muted">{maxC.toFixed(1)}°C</span>
        </div>
      </div>
    </div>
  );
}
