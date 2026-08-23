// Renders the drawn AOI's basemap (satellite imagery or the schematic style,
// matching whichever the user is currently viewing) into a detached canvas,
// plus the Web Mercator projector needed to draw heat tiles on top of it in
// exact register.
//
// A throwaway offscreen MapLibre instance is used rather than reading the
// live map's canvas: the live map would need preserveDrawingBuffer (a
// permanent cost on every frame), would only cover whatever happens to be in
// the viewport, would be capped at the on-screen resolution, and would bake
// in the terra-draw AOI outline. The offscreen map is framed on the AOI bbox
// exactly and thrown away straight after the pixels are copied out.

import { Map as MapLibreMap } from "maplibre-gl";
import type { Polygon, Position } from "geojson";
import {
  MAP_STYLE_URL,
  ESRI_SATELLITE_TILE_URL,
  ESRI_SATELLITE_SOURCE_ID,
  ESRI_SATELLITE_LAYER_ID,
  ESRI_SATELLITE_MAX_ZOOM,
} from "./mapConfig";

const MAX_W = 700;
const MAX_H = 620;
const LOAD_TIMEOUT_MS = 9000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
// Web Mercator northing. x stays linear in longitude, so with both axes in
// radians the projection is conformal and one unit of x equals one unit of y
// on screen — which is what makes the aspect maths below valid.
const mercY = (latDeg: number) => Math.log(Math.tan(Math.PI / 4 + toRad(latDeg) / 2));

export type BasemapCapture = {
  /** Basemap pixels, sized width*scale x height*scale. */
  image: HTMLCanvasElement;
  /** Logical (CSS) dimensions the projector maps into. */
  width: number;
  height: number;
  /** Device pixels per logical pixel in `image`. */
  scale: number;
  project: (pos: Position) => [number, number];
};

function bboxOf(geometry: Polygon) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
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

// Resolves true if the event fired, false on timeout — a timed-out capture
// still yields a usable (if partially tiled) basemap, which beats none.
function waitFor(map: MapLibreMap, event: "load" | "idle", ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), ms);
    map.once(event, () => finish(true));
  });
}

export async function captureBasemap(
  aoiGeometry: Polygon,
  viewMode: "schematic" | "satellite"
): Promise<BasemapCapture | null> {
  if (typeof document === "undefined") return null;

  const { west, south, east, north } = bboxOf(aoiGeometry);
  const mercW = toRad(east) - toRad(west);
  const mercH = mercY(north) - mercY(south);
  if (!(mercW > 0) || !(mercH > 0)) return null;

  const aspect = mercW / mercH;
  let width = MAX_W;
  let height = MAX_W / aspect;
  if (height > MAX_H) {
    height = MAX_H;
    width = MAX_H * aspect;
  }
  width = Math.round(width);
  height = Math.round(height);

  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(container);

  let map: MapLibreMap | null = null;
  try {
    map = new MapLibreMap({
      container,
      style: MAP_STYLE_URL,
      interactive: false,
      attributionControl: false,
      // Required to read pixels back out after the frame is drawn.
      preserveDrawingBuffer: true,
      fadeDuration: 0,
      bounds: [
        [west, south],
        [east, north],
      ],
      fitBoundsOptions: { padding: 0, animate: false },
    });

    await waitFor(map, "load", LOAD_TIMEOUT_MS);

    if (viewMode === "satellite") {
      map.addSource(ESRI_SATELLITE_SOURCE_ID, {
        type: "raster",
        tiles: [ESRI_SATELLITE_TILE_URL],
        tileSize: 256,
        maxzoom: ESRI_SATELLITE_MAX_ZOOM,
      });
      map.addLayer({ id: ESRI_SATELLITE_LAYER_ID, type: "raster", source: ESRI_SATELLITE_SOURCE_ID });
    }

    await waitFor(map, "idle", LOAD_TIMEOUT_MS);

    const mapCanvas = map.getCanvas();
    const image = document.createElement("canvas");
    image.width = mapCanvas.width;
    image.height = mapCanvas.height;
    const ictx = image.getContext("2d");
    if (!ictx) return null;
    ictx.drawImage(mapCanvas, 0, 0);

    // Cheap taint probe: if any tile came back without usable CORS headers the
    // canvas is poisoned and toDataURL would throw later, deep inside the
    // caller. Detect it here and let the caller fall back to a basemap-less
    // render instead.
    try {
      ictx.getImageData(0, 0, 1, 1);
    } catch {
      return null;
    }

    // Projector is built from the bounds actually shown, not the requested
    // bbox — fitBounds lands on a slightly wider frame whenever the AOI aspect
    // and the canvas aspect disagree, and register has to follow the pixels.
    const b = map.getBounds();
    const x0 = toRad(b.getWest());
    const xSpan = toRad(b.getEast()) - x0;
    const y0 = mercY(b.getNorth());
    const ySpan = mercY(b.getSouth()) - y0;

    const project = ([lon, lat]: Position): [number, number] => [
      ((toRad(lon) - x0) / xSpan) * width,
      ((mercY(lat) - y0) / ySpan) * height,
    ];

    return { image, width, height, scale: mapCanvas.width / width, project };
  } catch {
    return null;
  } finally {
    map?.remove();
    container.remove();
  }
}
