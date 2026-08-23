// Server-only. "Foto satelit asli" (§4.7) via Esri's ArcGIS REST Export Image
// operation — the same World_Imagery service already used for the map's
// satellite basemap tiles (see ESRI_SATELLITE_TILE_URL in lib/mapConfig.ts),
// just its /export operation instead of /tile/{z}/{y}/{x}. Public, no key,
// verified directly against the live endpoint before wiring this in.
import "server-only";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";

const ARCGIS_EXPORT_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
const MAX_DIMENSION_PX = 800;

export async function fetchSatelliteExportImage(aoiGeometry: Polygon): Promise<Buffer> {
  const [west, south, east, north] = turf.bbox(aoiGeometry);
  const lonSpan = east - west;
  const latSpan = north - south;
  const centerLat = (south + north) / 2;
  // Longitude degrees are narrower than latitude degrees away from the
  // equator — same aspect correction as lib/heatmapImage.ts's fallback frame.
  const aspect = (lonSpan * Math.cos((centerLat * Math.PI) / 180)) / latSpan;

  let width = MAX_DIMENSION_PX;
  let height = MAX_DIMENSION_PX / aspect;
  if (height > MAX_DIMENSION_PX) {
    height = MAX_DIMENSION_PX;
    width = MAX_DIMENSION_PX * aspect;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));

  const url =
    `${ARCGIS_EXPORT_URL}?bbox=${west},${south},${east},${north}&bboxSR=4326&imageSR=4326` +
    `&size=${width},${height}&format=png&f=image`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`ArcGIS Export Image failed: ${res.status} ${await res.text()}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
