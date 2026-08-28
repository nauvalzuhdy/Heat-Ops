// Shared pixel-grid cell computation for Operational Analyst's Hotspot
// Detection "Heatmap Grid" column (components/analyst/HotspotPixelGridView.tsx)
// AND the PDF report's matching section (lib/pdf/SiteReportDocument.tsx) —
// pulled out here, rather than left duplicated in the browser component,
// specifically so the two can never draw a different grid for the same site.
// Pure and dependency-free (no "server-only", no DOM) so both a client
// component and a Node.js PDF route can import it identically.
//
// Two modes, chosen per-site from what's actually in its saved heat_tiles —
// see HotspotPixelGridView.tsx's header for the full history/reasoning:
//   1. Real bounds — sites analyzed after lib/siteRecord.ts started saving
//      tiles[].bounds (the tile's own FortyGuard polygon). Every tile
//      renders at its exact saved bounds.
//   2. Approximate — older sites whose heat_tiles only has centroid + temp.
//      Reconstructs a grid sized near the real tile count via
//      lib/heatmapUtils.ts's binTilesToGrid.
import { binTilesToGrid, gridCellLngLatBounds } from "./heatmapUtils";
import type { HeatTileRecord } from "./siteRecord";

export type HotspotGridCell = { bounds: [number, number, number, number]; tempC: number };

export type HotspotGridCells = {
  cells: HotspotGridCell[];
  /** true = every cell is a real FortyGuard tile's own saved bounds; false = reconstructed approximation. */
  hasRealBounds: boolean;
};

function realBoundsCells(tiles: HeatTileRecord[]): HotspotGridCell[] {
  return tiles
    .filter((t): t is HeatTileRecord & { bounds: [number, number, number, number] } => t.bounds != null)
    .map((t) => ({ bounds: t.bounds, tempC: t.tempC }));
}

// Reconstructs a grid sized to land near the real tile count (not a fixed
// 3x3) — aspect-aware, same approach the column's earlier dot-thinning logic
// used.
function approximateCells(tiles: HeatTileRecord[], bbox: [number, number, number, number]): HotspotGridCell[] {
  const [west, south, east, north] = bbox;
  const aspect = (east - west) / (north - south || 1) || 1;
  const targetCells = Math.max(1, tiles.length);
  const cols = Math.max(1, Math.round(Math.sqrt(targetCells * aspect)));
  const rows = Math.max(1, Math.round(targetCells / cols));
  return binTilesToGrid(tiles, bbox, rows, cols).map((c) => ({
    bounds: gridCellLngLatBounds(bbox, c.row, c.col, rows, cols),
    tempC: c.meanTempC,
  }));
}

export function computeHotspotGridCells(
  tiles: HeatTileRecord[],
  bbox: [number, number, number, number]
): HotspotGridCells {
  const hasRealBounds = tiles.length > 0 && tiles[0].bounds != null;
  return {
    hasRealBounds,
    cells: hasRealBounds ? realBoundsCells(tiles) : approximateCells(tiles, bbox),
  };
}
