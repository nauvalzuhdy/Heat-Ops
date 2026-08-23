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
};

const GRID_SIZE = 3;

/**
 * Splits `bbox` ([minLng, minLat, maxLng, maxLat], e.g. from `turf.bbox()`)
 * into a 3x3 grid and assigns each tile to the cell containing its
 * centroid, then averages temperature per cell. Always returns exactly 9
 * zones (row-major, row 0 = north) — empty cells come back with
 * `meanTempC: null` and `tileCount: 0` rather than being dropped, so the
 * grid always renders as a complete 3x3.
 */
export function binTilesToZones(tiles: HeatTileRecord[], bbox: [number, number, number, number]): HotspotZone[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  // A degenerate bbox (zero width/height, e.g. a single-point AOI) would
  // divide by zero — fall back to a step of 1 so every tile lands in cell 0.
  const lngStep = (maxLng - minLng) / GRID_SIZE || 1;
  const latStep = (maxLat - minLat) / GRID_SIZE || 1;

  const sums: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
  const counts: number[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));

  for (const tile of tiles) {
    const col = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((tile.lng - minLng) / lngStep)));
    const row = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor((maxLat - tile.lat) / latStep)));
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
      });
    }
  }

  // Rank only zones that actually have data — ranking an empty cell against
  // real measurements would be meaningless.
  const ranked = zones.filter((z) => z.meanTempC != null).sort((a, b) => (b.meanTempC as number) - (a.meanTempC as number));
  ranked.forEach((zone, i) => {
    zone.rank = i + 1;
    zone.isHottest = i === 0;
  });

  return zones;
}

// Continuous blue (cool) -> red (hot) tint for the zone-overlay map view,
// requested explicitly for that visualization (distinct from the
// green->yellow->orange->red gradient lib/tempToColor.ts bakes into the
// heatmap PNG itself — that one stays as-is since it's already baked into
// saved images). Domain is anchored a couple degrees either side of the
// Critical/Low bands above so the two visuals agree on what reads as
// "hot"/"cool" even though their color ramps differ.
const TINT_DOMAIN_C = { cool: 22, hot: 38 } as const;
const TINT_COOL_RGB: [number, number, number] = [37, 99, 235]; // tailwind blue-600
const TINT_HOT_RGB: [number, number, number] = [239, 68, 68]; // tailwind red-500

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

export function zoneTintColor(meanTempC: number): [number, number, number] {
  const { cool, hot } = TINT_DOMAIN_C;
  const t = Math.max(0, Math.min(1, (meanTempC - cool) / (hot - cool)));
  return [
    Math.round(TINT_COOL_RGB[0] + (TINT_HOT_RGB[0] - TINT_COOL_RGB[0]) * t),
    Math.round(TINT_COOL_RGB[1] + (TINT_HOT_RGB[1] - TINT_COOL_RGB[1]) * t),
    Math.round(TINT_COOL_RGB[2] + (TINT_HOT_RGB[2] - TINT_COOL_RGB[2]) * t),
  ];
}
