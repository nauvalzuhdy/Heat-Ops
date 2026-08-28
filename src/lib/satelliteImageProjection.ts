// Shared lng/lat -> pixel projection for the site's saved `satellite_photo_url`
// (Operational Analyst §5 Hotspot Detection redesign, Kolom 1/2). That image
// is an ArcGIS Export Image requested with bbox=turf.bbox(aoi_geometry) and a
// size computed from that bbox's aspect ratio — see lib/arcgisSatellite.ts.
// No bbox/width/height is stored alongside the photo URL in `sites`, but
// because generation is fully deterministic from aoi_geometry alone, this
// recomputes the exact same frame the photo was exported at, so overlays
// (AOI outline, zone grid) land pixel-exact without guessing.
//
// MUST stay numerically identical to lib/arcgisSatellite.ts's own
// bbox/aspect/size math — if that file's formula ever changes, this one has
// to change with it, or every saved photo's overlay silently drifts out of
// registration.
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";

const MAX_DIMENSION_PX = 800; // mirrors ARCGIS export's MAX_DIMENSION_PX

export type SatelliteImageFrame = {
  bbox: [number, number, number, number]; // west, south, east, north
  widthPx: number;
  heightPx: number;
  /** Projects a lng/lat into pixel space of the exported image (origin top-left). */
  project: (lng: number, lat: number) => { x: number; y: number };
};

export function computeSatelliteImageFrame(aoiGeometry: Polygon): SatelliteImageFrame {
  const [west, south, east, north] = turf.bbox(aoiGeometry) as [number, number, number, number];
  const lonSpan = east - west || 1e-9;
  const latSpan = north - south || 1e-9;
  const centerLat = (south + north) / 2;
  const aspect = (lonSpan * Math.cos((centerLat * Math.PI) / 180)) / latSpan;

  let width = MAX_DIMENSION_PX;
  let height = MAX_DIMENSION_PX / aspect;
  if (height > MAX_DIMENSION_PX) {
    height = MAX_DIMENSION_PX;
    width = MAX_DIMENSION_PX * aspect;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));

  function project(lng: number, lat: number) {
    return {
      x: ((lng - west) / lonSpan) * width,
      y: ((north - lat) / latSpan) * height,
    };
  }

  return { bbox: [west, south, east, north], widthPx: width, heightPx: height, project };
}
