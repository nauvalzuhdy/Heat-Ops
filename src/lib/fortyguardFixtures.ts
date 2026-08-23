// Cached-mode fixtures for FortyGuard's credit-consuming endpoints, mirroring
// the FortyGuard Quickstart notebook's CACHED=True testing mode: "the
// Quickstart has a cached mode you can use to test your code without
// spending credits". Field names/shapes match real captured responses (see
// development.md) — but the actual values are synthesized (not real
// measurements), positioned at whatever AOI/point the caller passes in so
// the UI/map render sensibly during dev without a live call.
import "server-only";
import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import type { HeatmapResult, HeatmapTileProperties, SatelliteSegmentationResult } from "./fortyguard";

// Smallest-valid 1x1 transparent PNG — verified structurally (signature +
// IHDR/IDAT/IEND chunks) before use. Stands in for real satellite imagery
// bytes, which cached mode has none of.
const PLACEHOLDER_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// Deterministic pseudo-random 0..1 value from a 2D cell coordinate, so the
// generated heatmap looks like a plausible smooth surface (not flat/noisy)
// and is stable across repeated calls for the same AOI/grid position.
function cellNoise(row: number, col: number): number {
  const seed = Math.sin(row * 12.9898 + col * 78.233) * 43758.5453;
  return seed - Math.floor(seed);
}

// The real API tiles the whole polygon, so the fixture has to as well —
// capping this low made a large AOI come back covered only in one corner,
// which reads as a coverage bug rather than as fixture thrift. Still bounded
// so a pathological AOI can't spin the dev server: 200 per axis is 40k tiles,
// past what a 130 km² AOI needs at the finest granularity.
const MAX_TILES_PER_AXIS = 200;

// §4.4 — a plausible diurnal curve (warmest mid-afternoon, coolest before
// dawn) so cached-mode forecast slots trend up/down across +12h instead of
// all landing on the same Mean, which would make the feature look broken in
// dev/testing (FORTYGUARD_MODE=cached is the default — see project memory).
function diurnalShiftC(hourOffset: number): number {
  const hourOfDay = (new Date().getUTCHours() + hourOffset) % 24;
  return 4 * Math.sin(((hourOfDay - 9) / 24) * 2 * Math.PI);
}

export function generateCachedHeatmapResult(
  aoiGeometry: Polygon,
  granularityM: 60 | 80 | 100,
  hourOffset = 0
): HeatmapResult {
  const shiftC = diurnalShiftC(hourOffset);
  // Offsetting the noise phase per-slot (not just the mean) so the
  // regenerated tile image visibly changes between slots too, not just the
  // stats row.
  const noiseColOffset = hourOffset * 97;
  const [west, south, east, north] = turf.bbox(aoiGeometry);
  const aoi = turf.feature(aoiGeometry);
  const centerLat = (south + north) / 2;

  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);
  const cellHeightDeg = granularityM / metersPerDegLat;
  const cellWidthDeg = granularityM / metersPerDegLon;

  const cols = Math.min(MAX_TILES_PER_AXIS, Math.max(1, Math.ceil((east - west) / cellWidthDeg)));
  const rows = Math.min(MAX_TILES_PER_AXIS, Math.max(1, Math.ceil((north - south) / cellHeightDeg)));

  const features: Feature<Polygon, HeatmapTileProperties>[] = [];
  const temps: number[] = [];
  let tileId = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cellWest = west + c * cellWidthDeg;
      const cellSouth = south + r * cellHeightDeg;
      const cellEast = cellWest + cellWidthDeg;
      const cellNorth = cellSouth + cellHeightDeg;
      const cellPoly = turf.polygon([
        [
          [cellWest, cellSouth],
          [cellEast, cellSouth],
          [cellEast, cellNorth],
          [cellWest, cellNorth],
          [cellWest, cellSouth],
        ],
      ]);
      if (!turf.booleanIntersects(cellPoly, aoi)) continue;

      const noise = cellNoise(r, c + noiseColOffset);
      const avgTemp = 27 + noise * 8 + shiftC; // 27-35°C baseline — spans tempToColor's low->extreme bands
      const jitter = 0.6 + noise * 0.8;

      features.push({
        id: String(tileId),
        type: "Feature",
        properties: {
          tile_id: tileId,
          average_temperature: Number(avgTemp.toFixed(4)),
          min_temperature: Number((avgTemp - jitter).toFixed(4)),
          max_temperature: Number((avgTemp + jitter).toFixed(4)),
        },
        geometry: cellPoly.geometry,
      });
      temps.push(avgTemp);
      tileId++;
    }
  }

  if (features.length === 0) {
    const [lon, lat] = turf.centroid(aoi).geometry.coordinates;
    const halfW = cellWidthDeg / 2;
    const halfH = cellHeightDeg / 2;
    const avgTemp = 30 + shiftC;
    features.push({
      id: "0",
      type: "Feature",
      properties: { tile_id: 0, average_temperature: avgTemp, min_temperature: avgTemp - 0.8, max_temperature: avgTemp + 0.8 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon - halfW, lat - halfH],
            [lon + halfW, lat - halfH],
            [lon + halfW, lat + halfH],
            [lon - halfW, lat + halfH],
            [lon - halfW, lat - halfH],
          ],
        ],
      },
    });
    temps.push(avgTemp);
  }

  const minimum = Math.min(...temps);
  const maximum = Math.max(...temps);
  const mean = temps.reduce((a, b) => a + b, 0) / temps.length;
  const variance = temps.reduce((a, b) => a + (b - mean) ** 2, 0) / temps.length;
  const standard_deviation = Math.sqrt(variance);

  const bucketCount = 8;
  const bucketSize = (maximum - minimum) / bucketCount || 1;
  const freqCounts = new Array(bucketCount).fill(0);
  for (const t of temps) {
    const idx = Math.min(bucketCount - 1, Math.floor((t - minimum) / bucketSize));
    freqCounts[idx]++;
  }
  const freqLabels = Array.from({ length: bucketCount }, (_, i) => Math.round(minimum + i * bucketSize));

  const xAxis = Array.from({ length: 40 }, (_, i) => minimum + (i / 39) * (maximum - minimum || 1));
  const yAxis = xAxis.map(
    (x) =>
      (1 / (standard_deviation * Math.sqrt(2 * Math.PI) || 1)) *
      Math.exp(-((x - mean) ** 2) / (2 * standard_deviation ** 2 || 1))
  );

  const sorted = [...temps].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

  return {
    map_data: { type: "FeatureCollection", features },
    stats_data: {
      temperature_stats: { minimum, maximum, mean, standard_deviation },
      overall_temperature_distribution: [sorted[0], q(0.25), q(0.5), q(0.75), sorted[sorted.length - 1]],
      normal_temperature_distribution: { x_axis: xAxis, y_axis: yAxis },
      temperature_frequency: { x_axis: freqLabels, y_axis: freqCounts },
    },
  };
}

// Class names/legend colors match a real captured /v1/satellite response
// (Step 4) — percentages here are representative placeholders, not measured.
const CACHED_SEGMENTS: Record<string, number> = {
  Building: 27.4,
  "Road, Route": 21.8,
  "Sidewalk, Pavement": 9.6,
  Tree: 19.2,
  "Earth, Ground": 13.1,
  Grass: 8.9,
};
const CACHED_IMAGE_LEGEND: Record<string, [number, number, number]> = {
  Building: [59, 130, 246],
  "Road, Route": [234, 179, 8],
  "Sidewalk, Pavement": [148, 163, 184],
  Tree: [34, 197, 94],
  "Earth, Ground": [168, 141, 109],
  Grass: [132, 204, 22],
};

export function generateCachedSatelliteResult(latitude: number, longitude: number): SatelliteSegmentationResult {
  return {
    coordinates: { latitude: String(latitude), longitude: String(longitude) },
    orignal_image: [PLACEHOLDER_IMAGE_BASE64],
    image_year: new Date().getFullYear(),
    segmentation: {
      image_dimensions: { height: 350, width: 350 },
      mode: "sat",
      processing_time_seconds: 0.27,
      request_id: `cached-${Date.now()}`,
      segments: CACHED_SEGMENTS,
      image_legend: CACHED_IMAGE_LEGEND,
      image_content: PLACEHOLDER_IMAGE_BASE64,
    },
  };
}
