// Composites the FortyGuard heatmap tiles over a crop of the AOI's own
// basemap (satellite or schematic), clipped precisely to the drawn AOI shape.
//
// Why a 2D canvas instead of a deck.gl layer on the map: deck.gl's
// MaskExtension clips instanced layers per instance (at the instance anchor)
// rather than per fragment, so 60 m cells were kept or dropped whole and
// spilled past the AOI boundary. Canvas2D's ctx.clip() is per-pixel and
// honours an arbitrary polygon path, including freehand/concave AOIs.

import type { Feature, Polygon, Position } from "geojson";
import type { HeatmapTileProperties } from "./fortyguard";
import type { BasemapCapture } from "./basemapCapture";
import { tempToColor, HEAT_RISK_THRESHOLDS_C } from "./tempToColor";

const LEGEND_H = 66;
const PAD = 12;
// Heat sits over real imagery, so it has to read as a tint rather than paint
// over the streets and roofs the tint is meant to be interpreted against.
const HEAT_ALPHA = 0.62;
// Everything outside the AOI is dimmed so the analysed area reads as the
// subject rather than as one patch of a larger picture.
const OUTSIDE_VEIL = "rgba(15,23,42,0.42)";

// Fallback geometry, used only when no basemap could be captured.
const FALLBACK_MAX_W = 640;
const FALLBACK_MAX_H = 560;
const FALLBACK_SCALE = 2;

const LEGEND_MIN_C = 24;
const LEGEND_MAX_C = 35;

// --- Interpolation (IDW) -------------------------------------------------
// Tiles are samples of a continuous surface, so they are interpolated into a
// smooth field rather than painted as one solid rect each. Weight is
// 1/distance^2 over the k nearest tiles, per §4.3.
const IDW_K = 4;
// Past this multiple of the local tile size there is no nearby sample to
// interpolate from. Rather than extrapolate a plausible-looking surface over
// AOI the API returned no data for, the field fades out — the gap stays
// visible instead of being invented.
const INFLUENCE_TILES = 1.6;
const FADE_TILES = 0.5;
// Per-pixel tempToColor() would mean millions of branch-and-lerp calls, so the
// ramp is quantised once into a lookup table.
const LUT_STEPS = 512;

const COLOR_LUT = (() => {
  const lut = new Uint8ClampedArray(LUT_STEPS * 3);
  for (let i = 0; i < LUT_STEPS; i++) {
    const [r, g, b] = tempToColor(LEGEND_MIN_C + (i / (LUT_STEPS - 1)) * (LEGEND_MAX_C - LEGEND_MIN_C));
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return lut;
})();

// Baked into the PNG, so it can't follow the viewer's theme — this neutral
// mid-grey stays legible on both the light and dark Analyze panel.
const INK = "#9ca3af";
const OUTLINE = "#f8fafc";

type Tile = Feature<Polygon, HeatmapTileProperties>;
type Projector = (pos: Position) => [number, number];

export type HeatmapImageInput = {
  tiles: Tile[];
  aoiGeometry: Polygon;
  basemap: BasemapCapture | null;
};

// Adds every ring of a polygon to the current path. Callers fill/clip with
// "evenodd" so holes work regardless of the winding order real-world GeoJSON
// happens to use.
function tracePolygon(ctx: CanvasRenderingContext2D, rings: Position[][], project: Projector) {
  for (const ring of rings) {
    ring.forEach((pos, i) => {
      const [x, y] = project(pos);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, top: number, width: number) {
  const { low, moderate, high } = HEAT_RISK_THRESHOLDS_C;
  const x0 = PAD;
  const x1 = width - PAD;
  const span = x1 - x0;
  const barTop = top + 20;
  const barH = 12;

  const tempToX = (t: number) => x0 + ((t - LEGEND_MIN_C) / (LEGEND_MAX_C - LEGEND_MIN_C)) * span;

  // Sample tempToColor across the domain so the bar is the exact gradient the
  // tiles were tinted with, not a hand-picked approximation of it.
  const grad = ctx.createLinearGradient(x0, 0, x1, 0);
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [r, g, b] = tempToColor(LEGEND_MIN_C + t * (LEGEND_MAX_C - LEGEND_MIN_C));
    grad.addColorStop(t, `rgb(${r},${g},${b})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x0, barTop, span, barH);

  ctx.font = "600 10px system-ui, sans-serif";
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  const bands: [string, number, number][] = [
    ["Cool", LEGEND_MIN_C, low],
    ["Moderate", low, moderate],
    ["Hot", moderate, high],
    ["Extreme", high, LEGEND_MAX_C],
  ];
  for (const [label, from, to] of bands) {
    ctx.fillText(label, tempToX((from + to) / 2), top + 12);
  }

  ctx.font = "10px system-ui, sans-serif";
  for (const t of [low, moderate, high]) {
    const x = tempToX(t);
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, barTop);
    ctx.lineTo(x, barTop + barH);
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.fillText(`${t}°`, x, barTop + barH + 13);
  }

  ctx.textAlign = "left";
  ctx.fillText(`${LEGEND_MIN_C}°C`, x0, barTop + barH + 13);
  ctx.textAlign = "right";
  ctx.fillText(`${LEGEND_MAX_C}°C`, x1, barTop + barH + 13);
  ctx.textAlign = "left";
}

/**
 * Interpolates the tile samples into a smooth temperature field, returned as
 * an opaque-where-covered canvas sized in device pixels.
 *
 * Returned as a canvas rather than written straight into the caller's context
 * with putImageData because putImageData ignores the clipping region entirely
 * — it writes raw pixels. Handing back a canvas lets the caller drawImage() it
 * inside its AOI clip, which drawImage does respect.
 */
function renderHeatField(
  tiles: Tile[],
  project: Projector,
  wDev: number,
  hDev: number,
  scale: number
): HTMLCanvasElement | null {
  const n = tiles.length;
  if (n === 0) return null;

  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const temps = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Typical on-screen tile size, measured from the tiles' own geometry so a
  // non-uniform or offset grid is described correctly rather than assumed.
  let sizeSum = 0;
  const sampleCount = Math.min(n, 50);

  for (let i = 0; i < n; i++) {
    const ring = tiles[i].geometry.coordinates[0];
    const m = ring.length - 1; // last vertex repeats the first
    let lonSum = 0;
    let latSum = 0;
    for (let j = 0; j < m; j++) {
      lonSum += ring[j][0];
      latSum += ring[j][1];
    }
    const [cx, cy] = project([lonSum / m, latSum / m]);
    xs[i] = cx * scale;
    ys[i] = cy * scale;
    temps[i] = tiles[i].properties.average_temperature;

    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];

    if (i < sampleCount) {
      let rx0 = Infinity;
      let rx1 = -Infinity;
      let ry0 = Infinity;
      let ry1 = -Infinity;
      for (const p of ring) {
        const [tx, ty] = project(p);
        if (tx < rx0) rx0 = tx;
        if (tx > rx1) rx1 = tx;
        if (ty < ry0) ry0 = ty;
        if (ty > ry1) ry1 = ty;
      }
      sizeSum += Math.max(rx1 - rx0, ry1 - ry0);
    }
  }

  const tileSize = Math.max((sizeSum / sampleCount) * scale, 1);
  const influence = tileSize * INFLUENCE_TILES;
  const fade = tileSize * FADE_TILES;

  // Uniform-grid spatial index, one cell per tile-size, so the k-nearest
  // search touches a constant handful of candidates regardless of tile count.
  const cell = tileSize;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const buckets: (number[] | undefined)[] = new Array(cols * rows);
  for (let i = 0; i < n; i++) {
    const cxi = Math.min(cols - 1, Math.max(0, Math.floor((xs[i] - minX) / cell)));
    const cyi = Math.min(rows - 1, Math.max(0, Math.floor((ys[i] - minY) / cell)));
    const b = cyi * cols + cxi;
    (buckets[b] ??= []).push(i);
  }

  const canvas = document.createElement("canvas");
  canvas.width = wDev;
  canvas.height = hDev;
  const fctx = canvas.getContext("2d");
  if (!fctx) return null;
  const img = fctx.createImageData(wDev, hDev);
  const data = img.data;

  // Only pixels within reach of some tile can be coloured; the rest stay at
  // alpha 0 and are skipped outright.
  const x0 = Math.max(0, Math.floor(minX - influence));
  const x1 = Math.min(wDev - 1, Math.ceil(maxX + influence));
  const y0 = Math.max(0, Math.floor(minY - influence));
  const y1 = Math.min(hDev - 1, Math.ceil(maxY + influence));

  const ring = Math.max(1, Math.ceil(influence / cell));
  const bestD2 = new Float64Array(IDW_K);
  const bestI = new Int32Array(IDW_K);
  const influence2 = influence * influence;
  const lutSpan = LEGEND_MAX_C - LEGEND_MIN_C;

  for (let py = y0; py <= y1; py++) {
    const cyi = Math.floor((py - minY) / cell);
    const rowStart = Math.max(0, cyi - ring);
    const rowEnd = Math.min(rows - 1, cyi + ring);

    for (let px = x0; px <= x1; px++) {
      const cxi = Math.floor((px - minX) / cell);
      const colStart = Math.max(0, cxi - ring);
      const colEnd = Math.min(cols - 1, cxi + ring);

      let found = 0;
      for (let by = rowStart; by <= rowEnd; by++) {
        const base = by * cols;
        for (let bx = colStart; bx <= colEnd; bx++) {
          const bucket = buckets[base + bx];
          if (!bucket) continue;
          for (const idx of bucket) {
            const dx = xs[idx] - px;
            const dy = ys[idx] - py;
            const d2 = dx * dx + dy * dy;
            if (d2 > influence2) continue;
            // Keep the k smallest, nearest first (k is 4, so a straight
            // insertion beats any heap).
            if (found < IDW_K) {
              let j = found++;
              while (j > 0 && bestD2[j - 1] > d2) {
                bestD2[j] = bestD2[j - 1];
                bestI[j] = bestI[j - 1];
                j--;
              }
              bestD2[j] = d2;
              bestI[j] = idx;
            } else if (d2 < bestD2[IDW_K - 1]) {
              let j = IDW_K - 1;
              while (j > 0 && bestD2[j - 1] > d2) {
                bestD2[j] = bestD2[j - 1];
                bestI[j] = bestI[j - 1];
                j--;
              }
              bestD2[j] = d2;
              bestI[j] = idx;
            }
          }
        }
      }

      if (found === 0) continue;

      let temp: number;
      if (bestD2[0] < 1e-6) {
        // Pixel sits on a sample; 1/d^2 would blow up.
        temp = temps[bestI[0]];
      } else {
        let wSum = 0;
        let tSum = 0;
        for (let j = 0; j < found; j++) {
          const w = 1 / bestD2[j]; // 1/d^2
          wSum += w;
          tSum += w * temps[bestI[j]];
        }
        temp = tSum / wSum;
      }

      // Fade out over the last stretch of the influence radius so the edge of
      // covered ground is soft rather than a hard disc.
      let alpha = 255;
      const nearest = Math.sqrt(bestD2[0]);
      if (nearest > influence - fade) {
        alpha = Math.round((255 * (influence - nearest)) / fade);
        if (alpha <= 0) continue;
      }

      let lutIdx = Math.round(((temp - LEGEND_MIN_C) / lutSpan) * (LUT_STEPS - 1));
      if (lutIdx < 0) lutIdx = 0;
      else if (lutIdx > LUT_STEPS - 1) lutIdx = LUT_STEPS - 1;

      const o = (py * wDev + px) * 4;
      const l = lutIdx * 3;
      data[o] = COLOR_LUT[l];
      data[o + 1] = COLOR_LUT[l + 1];
      data[o + 2] = COLOR_LUT[l + 2];
      data[o + 3] = alpha;
    }
  }

  fctx.putImageData(img, 0, 0);
  return canvas;
}

// Equirectangular frame used only when captureBasemap returned null. Linear in
// both axes, which is close enough at AOI scale and needs no map instance.
function fallbackFrame(aoiGeometry: Polygon) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of aoiGeometry.coordinates) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  const lonSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;
  const centerLat = (south + north) / 2;
  const aspect = (lonSpan * Math.cos((centerLat * Math.PI) / 180)) / latSpan;

  let innerW = FALLBACK_MAX_W - PAD * 2;
  let innerH = innerW / aspect;
  if (innerH > FALLBACK_MAX_H - PAD * 2) {
    innerH = FALLBACK_MAX_H - PAD * 2;
    innerW = innerH * aspect;
  }

  const project: Projector = ([lon, lat]) => [
    PAD + ((lon - west) / lonSpan) * innerW,
    PAD + ((north - lat) / latSpan) * innerH,
  ];

  return {
    width: Math.round(innerW + PAD * 2),
    height: Math.round(innerH + PAD * 2),
    scale: FALLBACK_SCALE,
    project,
  };
}

/**
 * Returns a fresh detached canvas per call, so callers can never end up
 * showing a previous AOI's pixels.
 */
export function generateHeatmapImage({ tiles, aoiGeometry, basemap }: HeatmapImageInput): HTMLCanvasElement {
  const frame = basemap ?? fallbackFrame(aoiGeometry);
  const { width, height: mapH, scale, project } = frame;
  const rings = aoiGeometry.coordinates;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round((mapH + LEGEND_H) * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(scale, scale);

  if (basemap) {
    ctx.drawImage(basemap.image, 0, 0, width, mapH);
    // Dim outside the AOI: whole map rect plus the AOI rings, filled evenodd,
    // leaves the AOI itself untouched.
    ctx.beginPath();
    ctx.rect(0, 0, width, mapH);
    tracePolygon(ctx, rings, project);
    ctx.fillStyle = OUTSIDE_VEIL;
    ctx.fill("evenodd");
  }

  ctx.save();
  ctx.beginPath();
  tracePolygon(ctx, rings, project);
  ctx.clip("evenodd");

  if (!basemap) {
    // No imagery to show through, so mark the AOI footprint explicitly —
    // anywhere this wash still shows is AOI the API returned no tile for.
    ctx.fillStyle = "rgba(148,163,184,0.18)";
    ctx.fillRect(0, 0, width, mapH);
  }

  // drawImage (unlike putImageData) honours the clip set above, so the
  // interpolated field is cut to the AOI outline without any per-pixel
  // point-in-polygon test.
  const field = renderHeatField(
    tiles,
    project,
    Math.round(width * scale),
    Math.round(mapH * scale),
    scale
  );
  if (field) {
    ctx.globalAlpha = basemap ? HEAT_ALPHA : 1;
    ctx.drawImage(field, 0, 0, width, mapH);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Outline drawn unclipped so the full AOI boundary stays a crisp 2 px,
  // rather than being halved by its own clip region.
  ctx.beginPath();
  tracePolygon(ctx, rings, project);
  ctx.strokeStyle = basemap ? OUTLINE : "#94a3b8";
  ctx.lineWidth = 2;
  ctx.stroke();

  drawLegend(ctx, mapH, width);

  return canvas;
}
