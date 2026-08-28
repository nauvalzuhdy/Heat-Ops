// Hotspot zone binning (project.md §5, Sub-task 2). Pure and dependency-free
// like siteRecord.ts — bins the `heat_tiles` a site already has saved into a
// 3x3 zone grid, so the Operational Analyst page never re-calls
// FortyGuard's /v1/heatmap to answer "which part of this AOI is hottest".
import type { HeatTileRecord } from "./siteRecord";

export type HotspotLevel = "critical" | "high" | "moderate" | "low";

// Fixed absolute bands specified for this feature (project.md Sub-task 2
// spec, "asumsi Phoenix") — a discrete classification for zone badges. This is
// a deliberately different scale from lib/tempToColor.ts's NIOSH-anchored
// thresholds, which color individual tiles in the Map View's continuous
// heatmap image; the two are unrelated so they aren't required to match.
export function classifyLevel(meanTempC: number): HotspotLevel {
  if (meanTempC > 35) return "critical";
  if (meanTempC >= 30) return "high";
  if (meanTempC >= 25) return "moderate";
  return "low";
}

// FortyGuard sometimes returns a spatially FLAT field for an AOI: every tile
// carries an identical (or near-identical) temperature, so Min = Mean = Max,
// the card reads "±0.0°C", and the heatmap image renders as one uniform
// color. Verified against saved sites — Giga Texas 2026-08-26 came back as 75
// tiles holding exactly one distinct value, and two other AOIs that day spanned
// under 0.08°C, while Portland on 2026-08-25 spanned a genuine 2.24°C.
//
// The data is real (it is what the API returned, nothing is fabricated), it
// just carries no usable spatial detail — which looks like a broken render if
// nothing says so. Consumers use this to show a short plain-language note
// instead of leaving the user to guess why every number is the same.
//
// 0.1°C is the cutoff because it cleanly separates the observed flat cases
// (0.00 / 0.02 / 0.07°C spreads) from a genuinely varied one (2.24°C), and it
// lines up with the "±0.0°C" the stats card already prints once the standard
// deviation rounds to zero at one decimal place.
export const UNIFORM_FIELD_MAX_SPREAD_C = 0.1;

export function isSpatiallyUniform(minTempC: number, maxTempC: number): boolean {
  return maxTempC - minTempC < UNIFORM_FIELD_MAX_SPREAD_C;
}

// Spatial zone labels (project.md §5, zone-label consistency pass). Single
// source of truth for how a (row, col) cell of the 3x3 bbox grid is named —
// every consumer (chart, map overlay, AI Copilot tools/prompt, PDF report)
// imports this instead of deriving its own label, which is what let a
// previous alphabet-index scheme ("Zone A".."Zone I") drift into being
// maintained as two separately hand-copied formulas (ZoneTemperatureBarChart.tsx
// and lib/reportData.ts) that happened to agree only because no one had
// edited one without the other yet.
//
// Compass names, not letters: row 0 = north, row 2 = south, col 0 = west,
// col 2 = east (see binTilesToZones()'s own row/col contract above) — this
// is always geometrically valid regardless of the AOI's actual shape,
// because the grid is binned over the AOI's axis-aligned bbox, not its
// polygon outline. An elongated/non-square AOI still has a well-defined
// north/south/east/west; it just won't look like a neat square on screen.
const ZONE_SPATIAL_LABELS: readonly (readonly string[])[] = [
  ["Northwest", "North", "Northeast"],
  ["West", "Center", "East"],
  ["Southwest", "South", "Southeast"],
];

export function zoneLabel(row: number, col: number): string {
  return ZONE_SPATIAL_LABELS[row]?.[col] ?? `Zone ${row},${col}`;
}

// Slim zone shape shared between the bar chart and the Satellite column's
// map overlay (HotspotPanel.tsx computes one list, passes it to both) — kept
// here rather than defined in either component file so importing it never
// risks a circular import between them.
export type OverlayZone = {
  id: string;
  row: number;
  col: number;
  label: string;
  meanTempC: number | null;
  isHottest: boolean;
};

export type HotspotZone = {
  id: string;
  row: number; // 0 = northernmost row (highest latitude)
  col: number; // 0 = westernmost column (lowest longitude)
  meanTempC: number | null; // null when the zone has no tiles
  tileCount: number;
  level: HotspotLevel | null;
  /** 1 = hottest, among zones that have at least one tile. Null when empty. */
  rank: number | null;
  isHottest: boolean;
  /** Highest rank number among zones that have data (i.e. the coldest one with a measurement). False when empty. */
  isCoolest: boolean;
};

const GRID_SIZE = 3;

/**
 * Single source of truth for "which of the 3x3 zones does this lat/lng point
 * belong to" — a point exactly on an interior boundary falls into the zone
 * whose floor() bucket it lands in (west/south edges are IN a zone, east/
 * north edges belong to the next zone over), except at the AOI's own outer
 * edge, which clamps into the last row/col instead of overflowing.
 *
 * Extracted out of binTilesToZones() below (which used to inline this same
 * arithmetic) so any OTHER caller that needs to classify a point by the same
 * rule — e.g. HotspotPixelGridView.tsx placing its pixel-native FortyGuard
 * cells into the chart's 3x3 zones for cross-highlighting — reuses this
 * exact function instead of re-deriving the boundary math a second time and
 * risking the two disagreeing on a cell near a zone edge.
 */
export function zoneRowColForPoint(
  lat: number,
  lng: number,
  bbox: [number, number, number, number]
): { row: number; col: number } {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // A degenerate bbox (zero width/height, e.g. a single-point AOI) would
  // divide by zero — fall back to a step of 1 so every point lands in cell 0.
  const lngStep = (maxLng - minLng) / GRID_SIZE || 1;
  const latStep = (maxLat - minLat) / GRID_SIZE || 1;
  const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((lng - minLng) / lngStep)));
  const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((maxLat - lat) / latStep)));
  return { row, col };
}

/**
 * Splits `bbox` ([minLng, minLat, maxLng, maxLat], e.g. from `turf.bbox()`)
 * into a 3x3 grid and assigns each tile to the cell containing its
 * centroid, then averages temperature per cell. Always returns exactly 9
 * zones (row-major, row 0 = north) — empty cells come back with
 * `meanTempC: null` and `tileCount: 0` rather than being dropped, so the
 * grid always renders as a complete 3x3.
 */
export function binTilesToZones(tiles: HeatTileRecord[], bbox: [number, number, number, number]): HotspotZone[] {
  const sums: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
  const counts: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

  for (const tile of tiles) {
    const { row, col } = zoneRowColForPoint(tile.lat, tile.lng, bbox);
    sums[row][col] += tile.tempC;
    counts[row][col] += 1;
  }

  const zones: HotspotZone[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const tileCount = counts[row][col];
      const meanTempC = tileCount > 0 ? sums[row][col] / tileCount : null;
      zones.push({
        id: `${row}-${col}`,
        row,
        col,
        meanTempC,
        tileCount,
        level: meanTempC != null ? classifyLevel(meanTempC) : null,
        rank: null,
        isHottest: false,
        isCoolest: false,
      });
    }
  }

  // Rank only zones that actually have data — ranking an empty cell against
  // real measurements would be meaningless. isCoolest used to be re-derived
  // independently by each consumer (ZoneTemperatureBarChart.tsx's own
  // "max rank among zones with data" computation) — moved here so the chart,
  // the map overlays, and the PDF report all read the exact same flag
  // instead of three separate call sites agreeing only by construction.
  const ranked = zones.filter((z) => z.meanTempC != null).sort((a, b) => (b.meanTempC as number) - (a.meanTempC as number));
  ranked.forEach((zone, i) => {
    zone.rank = i + 1;
    zone.isHottest = i === 0;
    zone.isCoolest = i === ranked.length - 1;
  });

  return zones;
}

/**
 * Lng/lat rectangle for one grid cell — same row/col binning math as
 * `binTilesToZones()` above, exposed separately so a live-map view (Sub-task
 * 2 revision's Grid tab) can project exact zone corners with
 * `map.project()` instead of approximating a CSS grid over a static image.
 */
export function zoneLngLatBounds(
  bbox: [number, number, number, number],
  row: number,
  col: number
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / GRID_SIZE || 1;
  const latStep = (maxLat - minLat) / GRID_SIZE || 1;
  const west = minLng + col * lngStep;
  const east = minLng + (col + 1) * lngStep;
  const north = maxLat - row * latStep;
  const south = maxLat - (row + 1) * latStep;
  return [west, south, east, north];
}

export type HeatGridCell = {
  row: number;
  col: number;
  meanTempC: number;
  /** Centroid of the actual tiles that landed in this cell, not the cell's own center. */
  lat: number;
  lng: number;
  tileCount: number;
};

/**
 * Lng/lat rectangle for one cell of an arbitrary rows x cols grid over
 * `bbox` — same math as `zoneLngLatBounds()` above but with a caller-chosen
 * grid size instead of a fixed 3x3. Paired with `binTilesToGrid()`'s
 * row/col so a caller can draw each returned cell's actual rectangle, used
 * by the Hotspot Detection page's pixel-grid column to reconstruct an
 * approximate grid for sites saved before per-tile bounds existed (see
 * lib/siteRecord.ts's HeatTileRecord.bounds comment).
 */
export function gridCellLngLatBounds(
  bbox: [number, number, number, number],
  row: number,
  col: number,
  rows: number,
  cols: number
): [number, number, number, number] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / cols || 1;
  const latStep = (maxLat - minLat) / rows || 1;
  const west = minLng + col * lngStep;
  const east = minLng + (col + 1) * lngStep;
  const north = maxLat - row * latStep;
  const south = maxLat - (row + 1) * latStep;
  return [west, south, east, north];
}

/**
 * General-purpose version of `binTilesToZones()` above with a caller-chosen
 * grid size instead of a fixed 3x3 — used by the Heat Points column
 * (Operational Analyst §5) to thin a dense `heat_tiles` array down to a
 * legible number of dots by averaging nearby tiles into one cell, rather
 * than rendering every saved tile (which gets visually crowded well before
 * granularity 100). Unlike `binTilesToZones`, empty cells are dropped
 * entirely rather than returned as null placeholders — there is no fixed
 * grid for a caller to expect a complete 9-cell result from.
 */
export function binTilesToGrid(
  tiles: HeatTileRecord[],
  bbox: [number, number, number, number],
  rows: number,
  cols: number
): HeatGridCell[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngStep = (maxLng - minLng) / cols || 1;
  const latStep = (maxLat - minLat) / rows || 1;

  const tempSums: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const latSums: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const lngSums: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  const counts: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (const tile of tiles) {
    const col = Math.min(cols - 1, Math.max(0, Math.floor((tile.lng - minLng) / lngStep)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor((maxLat - tile.lat) / latStep)));
    tempSums[row][col] += tile.tempC;
    latSums[row][col] += tile.lat;
    lngSums[row][col] += tile.lng;
    counts[row][col] += 1;
  }

  const cells: HeatGridCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const count = counts[row][col];
      if (count === 0) continue;
      cells.push({
        row,
        col,
        meanTempC: tempSums[row][col] / count,
        lat: latSums[row][col] / count,
        lng: lngSums[row][col] / count,
        tileCount: count,
      });
    }
  }
  return cells;
}
