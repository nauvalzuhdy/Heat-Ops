// "Foto segmentasi" (§4.7) — a thematic map of the AOI's Overpass land-cover
// categories, clipped to the drawn AOI shape via ctx.clip() (same technique
// as lib/heatmapImage.ts). Colors come exclusively from lib/landcoverColors.ts
// — no new colors defined here, per §4.2's single-source-of-truth rule.
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { OverpassLandCover } from "./overpass";
import { LANDCOVER_COLORS } from "./landcoverColors";

const MAX_W = 640;
const MAX_H = 560;
const LEGEND_H = 40;
const PAD = 12;
const SCALE = 2;
const OUTLINE = "#1f2937";

type Rings = Feature<Polygon | MultiPolygon>["geometry"]["coordinates"];
type Projector = (pos: Position) => [number, number];

function ringBounds(geometry: Polygon) {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of geometry.coordinates) {
    for (const [lon, lat] of ring) {
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return { west, south, east, north };
}

// Polygon and MultiPolygon differ by one nesting level (rings vs. list of
// rings-per-part); flatten both to a flat list of rings so the caller can
// trace either shape identically.
function flattenRings(coordinates: Rings): Position[][] {
  if (typeof coordinates[0]?.[0]?.[0] === "number") return coordinates as Position[][];
  return (coordinates as Position[][][]).flat();
}

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

function fillFeatures(
  ctx: CanvasRenderingContext2D,
  features: Feature<Polygon | MultiPolygon, unknown>[],
  color: string,
  project: Projector
) {
  ctx.fillStyle = color;
  for (const f of features) {
    ctx.beginPath();
    tracePolygon(ctx, flattenRings(f.geometry.coordinates), project);
    ctx.fill("evenodd");
  }
}

function drawLegend(ctx: CanvasRenderingContext2D, top: number, width: number) {
  const entries: [string, string][] = [
    ["Building", LANDCOVER_COLORS.building],
    ["Road", LANDCOVER_COLORS.road],
    ["Vegetation", LANDCOVER_COLORS.vegetation],
    ["Water", LANDCOVER_COLORS.water],
    ["Other", LANDCOVER_COLORS.other],
  ];
  const swatch = 12;
  const gapAfterSwatch = 5;
  ctx.font = "11px system-ui, sans-serif";
  ctx.textBaseline = "middle";

  // Lay out left-to-right, wrapping if the row would overflow width — five
  // short labels fit on one line at MAX_W, but this keeps it correct if not.
  let x = PAD;
  let y = top + LEGEND_H / 2;
  for (const [label, color] of entries) {
    const labelWidth = ctx.measureText(label).width;
    const entryWidth = swatch + gapAfterSwatch + labelWidth + 18;
    if (x + entryWidth > width - PAD) {
      x = PAD;
      y += 18;
    }
    ctx.fillStyle = color;
    ctx.fillRect(x, y - swatch / 2, swatch, swatch);
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.strokeRect(x, y - swatch / 2, swatch, swatch);
    ctx.fillStyle = "#374151";
    ctx.fillText(label, x + swatch + gapAfterSwatch, y);
    x += entryWidth;
  }
}

/**
 * Renders a flat thematic map: AOI clipped, background filled as "other"
 * (anything not covered by the four explicit categories IS the remainder
 * category, so no separate "other" geometry is needed), then vegetation/water
 * as ground cover, roads, and buildings on top — same z-order real land-use
 * would layer in. Returns a fresh detached canvas per call.
 */
export function generateSegmentationImage(aoiGeometry: Polygon, overpass: OverpassLandCover): HTMLCanvasElement {
  const { west, south, east, north } = ringBounds(aoiGeometry);
  const lonSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;
  const centerLat = (south + north) / 2;
  const aspect = (lonSpan * Math.cos((centerLat * Math.PI) / 180)) / latSpan;

  let innerW = MAX_W - PAD * 2;
  let innerH = innerW / aspect;
  if (innerH > MAX_H - PAD * 2) {
    innerH = MAX_H - PAD * 2;
    innerW = innerH * aspect;
  }
  const width = Math.round(innerW + PAD * 2);
  const mapH = Math.round(innerH + PAD * 2);

  const project: Projector = ([lon, lat]) => [
    PAD + ((lon - west) / lonSpan) * innerW,
    PAD + ((north - lat) / latSpan) * innerH,
  ];

  const canvas = document.createElement("canvas");
  canvas.width = width * SCALE;
  canvas.height = (mapH + LEGEND_H) * SCALE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.scale(SCALE, SCALE);

  const aoiRings = flattenRings(aoiGeometry.coordinates as unknown as Rings);

  ctx.save();
  ctx.beginPath();
  tracePolygon(ctx, aoiRings, project);
  ctx.clip("evenodd");

  // Background = "other": whatever the four explicit categories don't cover.
  ctx.fillStyle = LANDCOVER_COLORS.other;
  ctx.fillRect(0, 0, width, mapH);

  fillFeatures(ctx, overpass.vegetationFeatures, LANDCOVER_COLORS.vegetation, project);
  fillFeatures(ctx, overpass.waterFeatures, LANDCOVER_COLORS.water, project);
  fillFeatures(ctx, overpass.roadFeatures, LANDCOVER_COLORS.road, project);
  fillFeatures(ctx, overpass.buildingFeatures, LANDCOVER_COLORS.building, project);
  ctx.restore();

  ctx.beginPath();
  tracePolygon(ctx, aoiRings, project);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  drawLegend(ctx, mapH, width);

  return canvas;
}
