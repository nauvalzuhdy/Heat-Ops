"use client";

// §4.6 "Photo" mode (named "Photo-realistic Massing" during development —
// shortened per user feedback so the toggle label doesn't read as a claim
// of full photorealism) — an ADDITIONAL 3D render mode alongside the
// existing Massing (neutral gray) and Land-cover (blue/yellow) modes, not a
// replacement for either. Colors each building's roof from the real
// satellite image instead of a uniform swatch, and (per the Autodesk Forma
// reference this pass was built against) extrudes the ENTIRE AOI as one
// solid block rather than floating buildings over a flat photo:
//
//   1. Fetch one flat, known-bbox satellite export image for the AOI
//      (api/satellite/export -> lib/arcgisSatellite.ts's ArcGIS Export
//      Image — the same source §4.7 already uses for the saved "satellite
//      photo", just called earlier in the live analyze flow here).
//   2. Draw it once to an offscreen canvas and, per polygon (building OR
//      the ground slab below), crop its footprint's bounding box via
//      getImageData() and average the RGB — a real sample, not a
//      computed/interpolated color.
//   3. Building walls reuse that same color darkened ~30% (WALL_DARKEN_AMOUNT)
//      as a simple flat shade — NOT a real photo texture on the sides. This
//      is a disclosed limitation (see the UI copy in RenderModeToggle/
//      MapCanvas), not something to hide: deck.gl's SolidPolygonLayer only
//      exposes one getFillColor for the whole extrusion, so the roof's true
//      color has to be layered back on top separately via raiseFeatureZ().
//   4. The ground slab is the AOI polygon minus only its water features
//      (computeGroundFeature) — NOT minus buildings/roads/vegetation too.
//      Buildings/roads/vegetation don't need a hole under them: they're
//      either opaque volumes taller than the thin slab (buildings) or flat
//      caps raised to sit exactly on the slab's top surface (roads,
//      vegetation — see GROUND_HEIGHT_M). Only water needs an actual gap,
//      since it renders BELOW the slab's top (WATER_DEPTH_M is negative)
//      and would otherwise be hidden under it.
//
// Deliberately capped (PHOTOREALISTIC_MAX_BUILDINGS) — sampling is one
// getImageData() call per building, plus one more for the ground slab. Cheap
// per call, but a ~90km² AOI has returned 20,000+ features before (see
// mapConfig.ts's pickGranularity comment) where that adds up. Over the cap,
// callers skip fetching/sampling entirely rather than let it run slow.
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import type { BuildingProperties } from "./overpass";

export const PHOTOREALISTIC_MAX_BUILDINGS = 500;
export const WALL_DARKEN_AMOUNT = 0.3;

// Item 5 — the ground slab's own thickness (extruded from 0 up to this many
// meters) and the small clearance above it that roads/vegetation "caps" sit
// at so they read as painted onto the slab's surface, not buried in it.
export const GROUND_HEIGHT_M = 0.75;
export const GROUND_SURFACE_CLEARANCE_M = 0.05;
// Roads/vegetation caps get a small REAL thickness rather than a
// zero-thickness flat plane — a razor-thin coplanar-ish surface floating
// just above the ground slab produced visible shadow-map banding (a beaded/
// dashed look along roads) under this scene's shadow-casting directional
// light. A small actual volume gives the shadow map real depth to resolve
// against and reads as a subtle raised curb, not a visual regression.
export const CAP_THICKNESS_M = 0.15;

// Item 3 — water sinks below the ground plane instead of sitting flush with
// it. Negative getElevation on an extruded deck.gl polygon draws its top
// face below z=0, which reads as a depression against the slab around it.
export const WATER_DEPTH_M = -2.5;
export const WATER_FILL_ALPHA = 190;

// Item 1 — white, semi-transparent boundary lines on every category layer
// except roads (left plain per the brief: thin strips read fine without an
// outline, and bordering them added visual noise without a legibility gain
// in testing). White holds contrast against every fill color this mode
// uses (photo-sampled roofs/ground, and land-cover's own vegetation/water
// swatches) — the same reason Google Maps/OSM outline building footprints
// in a light color regardless of the fill underneath.
export const PHOTO_BORDER_COLOR: [number, number, number, number] = [255, 255, 255, 190];
export const PHOTO_BORDER_WIDTH_PX = 1.25;

export type RGB = [number, number, number];

export async function fetchAOISatelliteImage(geometry: Polygon): Promise<HTMLImageElement> {
  const res = await fetch("/api/satellite/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ geometry }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Satellite export image fetch failed (${res.status})`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode satellite export image"));
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

// One average RGB per input polygon, in the same order given — index
// alignment is how MapCanvas's getFillColor accessors look these up (via
// deck.gl's `{index}` accessor arg), so callers must not reorder/filter
// the array between this call and building the layers. Used for both
// per-building roof colors and the single ground-slab color (item 5) —
// genuinely generic over any AOI-clipped polygon, not building-specific,
// so it isn't typed to BuildingProperties.
export function computeAverageColors(
  image: HTMLImageElement,
  aoiGeometry: Polygon,
  polygons: Feature<Polygon | MultiPolygon>[]
): RGB[] {
  const [west, south, east, north] = turf.bbox(aoiGeometry);
  const lonSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fallback: RGB = [190, 190, 190];
  if (!ctx) return polygons.map(() => fallback);
  ctx.drawImage(image, 0, 0);

  return polygons.map((polygon) => {
    const [bw, bs, be, bn] = turf.bbox(polygon);
    // Image row 0 is the AOI's north edge, so a polygon's northern
    // (max-lat) edge maps to the smaller/top pixel row.
    let px = Math.floor(((bw - west) / lonSpan) * canvas.width);
    let py = Math.floor(((north - bn) / latSpan) * canvas.height);
    let pw = Math.ceil(((be - bw) / lonSpan) * canvas.width);
    let ph = Math.ceil(((bn - bs) / latSpan) * canvas.height);

    px = Math.max(0, Math.min(px, canvas.width - 1));
    py = Math.max(0, Math.min(py, canvas.height - 1));
    pw = Math.max(1, Math.min(pw, canvas.width - px));
    ph = Math.max(1, Math.min(ph, canvas.height - py));

    const { data } = ctx.getImageData(px, py, pw, ph);
    let r = 0;
    let g = 0;
    let b = 0;
    const pixelCount = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    if (pixelCount === 0) return fallback;
    return [Math.round(r / pixelCount), Math.round(g / pixelCount), Math.round(b / pixelCount)];
  });
}

export function darkenColor([r, g, b]: RGB, amount = WALL_DARKEN_AMOUNT): RGB {
  return [Math.round(r * (1 - amount)), Math.round(g * (1 - amount)), Math.round(b * (1 - amount))];
}

// The "raised cap" trick: deck.gl's GeoJsonLayer/SolidPolygonLayer reads a
// position's 3rd coordinate (if present) as an absolute elevation in
// meters. Cloning a footprint with every vertex raised to a fixed height,
// then rendering that as a flat (non-extruded) fill, draws it exactly at
// that height with its own color — separate from whatever's extruded
// underneath. Used for: building roofs (raised to their own heightM+
// clearance, undarkened, over the extruded wall layer below), and roads/
// vegetation in Photo mode (raised to GROUND_HEIGHT_M+clearance, so they
// read as painted onto the ground slab's surface rather than buried in it
// or floating above it disconnected).
export function raiseFeatureZ<P>(feature: Feature<Polygon | MultiPolygon, P>, z: number): Feature<Polygon | MultiPolygon, P> {
  const raise = (ring: Position[]): Position[] => ring.map(([x, y]) => [x, y, z]);
  const geometry =
    feature.geometry.type === "Polygon"
      ? { type: "Polygon" as const, coordinates: feature.geometry.coordinates.map(raise) }
      : { type: "MultiPolygon" as const, coordinates: feature.geometry.coordinates.map((poly) => poly.map(raise)) };
  return { ...feature, geometry };
}

export function buildRoofCapFeature(
  building: Feature<Polygon | MultiPolygon, BuildingProperties>
): Feature<Polygon | MultiPolygon, BuildingProperties> {
  return raiseFeatureZ(building, building.properties.heightM + GROUND_SURFACE_CLEARANCE_M);
}

// Item 5 — the AOI polygon minus only its water features (see the header
// comment for why buildings/roads/vegetation don't also need subtracting).
// Cheap fast path when there's no water at all (the common case): skip
// turf.difference entirely rather than pay for a no-op clip. turf.difference
// (v7) chains through every feature in the collection in one polyclip call —
// no separate union step needed even when there are several water features.
// Falls back to the plain AOI (no hole) on any clipping failure — a slightly
// wrong-looking water depression is a far better failure mode than losing
// the ground slab (and therefore all of Photo mode) to a geometry edge case.
export function computeGroundFeature(
  aoiGeometry: Polygon,
  waterFeatures: Feature<Polygon | MultiPolygon>[]
): Feature<Polygon | MultiPolygon> {
  const aoiFeature = turf.feature(aoiGeometry);
  if (waterFeatures.length === 0) return aoiFeature;
  try {
    const result = turf.difference(turf.featureCollection([aoiFeature, ...waterFeatures]));
    return result ?? aoiFeature;
  } catch (err) {
    console.warn("[photorealisticMassing] ground/water difference failed, using un-clipped AOI:", err);
    return aoiFeature;
  }
}
