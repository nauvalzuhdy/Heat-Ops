// FortyGuard coverage is US-only. Centered on Gigafactory Texas (Austin, TX) —
// the current demo site, and the state this project's FortyGuard API key is
// registered to. Was Phoenix, AZ before that.
export const DEFAULT_CENTER: [number, number] = [-97.6169, 30.2219];
export const DEFAULT_ZOOM = 12;
export const SEARCH_RESULT_ZOOM = 14;

export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

// Esri uses a {z}/{y}/{x} tile path order (not the usual {z}/{x}/{y}).
export const ESRI_SATELLITE_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_SATELLITE_ATTRIBUTION =
  "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
export const ESRI_SATELLITE_SOURCE_ID = "esri-satellite";
export const ESRI_SATELLITE_LAYER_ID = "esri-satellite-layer";
// Native imagery resolution runs out around z19 in most areas — Esri serves
// a fixed-size "map data not available" placeholder tile past that instead
// of a 404. Capping maxzoom here makes MapLibre over-scale the last real
// tile for closer zooms rather than requesting the placeholder.
export const ESRI_SATELLITE_MAX_ZOOM = 19;

// FortyGuard's /v1/heatmap and /v1/satellite endpoints cap AOI size at
// ~130 km² (50 mi²) — see project memory. AOIs larger than this are still
// drawable but flagged in the UI since a submit would fail at those APIs.
export const MAX_AOI_AREA_SQKM = 130;

// FortyGuard only accepts these three granularities for /v1/heatmap (§7) — a
// fixed 60m regardless of AOI size once returned 20,948 tiles for a ~90 km²
// AOI (slow to render, and left part of the AOI uncovered because the
// cached-mode fixture's own per-axis tile cap was reached first) while a tiny
// AOI would come back as a single tile. Picking granularity from AOI area
// keeps the tile count in a useful range instead.
//
// Note: 100m is the coarsest granularity the API offers, so this is a ceiling,
// not a guarantee — an AOI far past the point where idealCellSize crosses 90m
// still returns quadratically more tiles than targetTiles as area grows,
// because there's no coarser setting left to fall back to.
export function pickGranularity(areaM2: number): 60 | 80 | 100 {
  const targetTiles = 150;
  const idealCellSize = Math.sqrt(areaM2 / targetTiles);
  if (idealCellSize <= 70) return 60;
  if (idealCellSize <= 90) return 80;
  return 100;
}

// §4.4 forecast — hard-capped at +12h by FortyGuard's own date-range
// constraint (see project memory), not an arbitrary UI choice.
export const FORECAST_HOUR_OFFSETS = [0, 3, 6, 9, 12] as const;
export type ForecastHourOffset = (typeof FORECAST_HOUR_OFFSETS)[number];
