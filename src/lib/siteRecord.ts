// Shapes one analysed AOI into the row that Map View will insert into the
// Supabase `sites` table (project.md §9b). Pure and dependency-free so it can
// be unit-checked and reused once the Supabase client lands.
//
// Divergence from project.md §9b, deliberate: that schema comments `landcover`
// as coming from /v1/satellite. It doesn't any more. /v1/satellite samples one
// fixed-size image at the AOI centroid, so on a large AOI it describes a small
// patch while looking like an AOI-wide figure (a 93.5 km² AOI reported
// Building 97.4%). Overpass is AOI-wide and clipped exactly to the drawn
// boundary, so it owns `landcover`; the FortyGuard sample is kept alongside as
// `landcover_spotcheck` — a supporting reference point for the Operational
// Analyst page, never the primary source.

import type { Polygon } from "geojson";
import type { HeatmapResult, SatelliteSegmentationResult } from "./fortyguard";
import type { OverpassLandCover } from "./overpass";

export type HeatTileRecord = {
  lat: number;
  lng: number;
  tempC: number;
  /**
   * [west, south, east, north] of this tile's own FortyGuard polygon
   * (map_data.features[i].geometry — confirmed a real per-tile Polygon
   * against a live API response, not a center-point-only shape; see
   * lib/fortyguard.ts's HeatmapResult comment). Optional because it was
   * added after some sites were already saved — those rows only have the
   * centroid (lat/lng) below, which is all binTilesToZones() and every
   * consumer of it (Shift Schedule, ROI Simulator, recommend_intervention,
   * AI Copilot tools) ever reads; this field is purely additive for the
   * Hotspot Detection page's pixel-grid visualization and changes nothing
   * about how those consumers bin/read tiles.
   */
  bounds?: [number, number, number, number];
};

// §4.4 — one resolved forecast slot, matching the `sites.heat_forecast`
// column. Written via PATCH /api/sites once Map View's Analyze action
// auto-captures the full +0/+3/+6/+9/+12h window (see analysisStore.ts's
// captureFullForecast), after the initial `sites` row insert — see
// app/api/sites/route.ts.
//
// `targetTime` is the real, server-computed date+time this snapshot is
// FOR — not when it was fetched (that's `capturedAt`, kept for audit/
// debugging only, never shown as "the" forecast time). Computed once in
// app/api/heatmap/route.ts from the actual clock at request time
// (`now + hourOffset`), not reconstructed or guessed anywhere downstream —
// see that route for why. `cached` records this specific slot's own
// real-vs-cached provenance (FORTYGUARD_MODE is a single global flag, so in
// practice every slot in one Analyze run shares the same value, but storing
// it per-entry rather than assuming a global stays correct if that ever
// changes).
export type HeatForecastEntry = {
  hourOffset: number;
  targetTime: string;
  meanTempC: number;
  cached: boolean;
  capturedAt: string;
  // See project.md §2/§4.4 — this slot's date shifted back one day because
  // "today" returned no usable FortyGuard data. Consumers must label a
  // fallback entry as what it is, never show it as today's forecast.
  dateUsed: string;
  isFallbackDate: boolean;
  /**
   * Relative humidity (%) measured by FortyGuard's /v1/env_params at THIS slot's
   * own hour, attached server-side when the forecast is persisted
   * (app/api/sites/route.ts). Optional on purpose: every site saved before this
   * existed has no humidity, and jsonb needs no migration for a new key — those
   * rows keep working and fall back to lib/wbgt.ts's assumed value, labelled as
   * assumed. Absent also when the env_params call failed or returned no reading
   * for the hour; never back-filled with a guess.
   */
  relativeHumidityPct?: number;
  /** True when relativeHumidityPct came from cached-mode fixtures rather than a live call. */
  humidityCached?: boolean;
};

export type SiteLandcover = {
  source: "overpass";
  buildingPct: number;
  roadPct: number;
  vegetationPct: number;
  waterPct: number;
  otherPct: number;
  buildingCount: number;
  roadCount: number;
  vegetationCount: number;
  waterCount: number;
};

export type SiteLandcoverSpotcheck = {
  source: "fortyguard_satellite";
  /** Centroid the sample was taken at — NOT the AOI as a whole. */
  sampledAt: { lat: number; lon: number };
  imageYear: number;
  imageDimensions: { height: number; width: number };
  /** Raw class -> coverage % as returned, unnormalised. */
  segments: Record<string, number>;
  /** True when served by cached/dev mode, i.e. synthetic and not measured. */
  synthetic: boolean;
};

export type SiteRecord = {
  name: string | null;
  aoi_geometry: Polygon;
  site_area_m2: number;
  landcover: SiteLandcover | null;
  landcover_spotcheck: SiteLandcoverSpotcheck | null;
  heat_tiles: HeatTileRecord[];
  heat_stats: {
    avgTempC: number;
    maxTempC: number;
    minTempC: number;
    stdDevC: number;
    tileCount: number;
    capturedAt: string;
    // See project.md §2/§4.4 — the actual date_time.start_date this snapshot
    // came from, and whether it's the app's default "today" request or the
    // one-step yesterday fallback. Any consumer showing this data as
    // "current" must check isFallbackDate and label it honestly if true.
    dateUsed: string;
    isFallbackDate: boolean;
  } | null;
  attribution: {
    landcover: "real" | "unavailable";
    landcover_spotcheck: "real" | "synthetic" | "unavailable";
    heat: "real" | "synthetic" | "unavailable";
  };
};

// Mirrors the discriminated union the analysis store already carries, without
// importing the store into what is otherwise a pure module.
type Maybe<T> =
  | { status: "ok"; result: T; cached?: boolean; dateUsed?: string; isFallbackDate?: boolean }
  | { status: "error"; message: string };

// Exported for lib/routing/'s Phase 2 (§4.5) — it derives HeatTileRecord[]
// from a fresh HeatmapResult the exact same way buildSiteRecord() does below,
// for a one-off route-scoring probe that's never saved as a site.
export function centroidOfRing(ring: number[][]): { lat: number; lng: number } {
  let lat = 0;
  let lng = 0;
  // Last vertex repeats the first in a closed GeoJSON ring; skip it so it is
  // not double-weighted.
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return { lat: lat / n, lng: lng / n };
}

export function boundsOfRing(ring: number[][]): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < west) west = lng;
    if (lng > east) east = lng;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [west, south, east, north];
}

export function buildSiteRecord(input: {
  name?: string | null;
  aoiGeometry: Polygon;
  areaSqKm: number;
  centroid: { lat: number; lon: number };
  heatmap: Maybe<HeatmapResult>;
  satellite: Maybe<SatelliteSegmentationResult>;
  overpass: Maybe<OverpassLandCover>;
}): SiteRecord {
  const { heatmap, satellite, overpass } = input;

  const heatTiles: HeatTileRecord[] =
    heatmap.status === "ok"
      ? heatmap.result.map_data.features.map((f) => {
          const ring = f.geometry.coordinates[0];
          const c = centroidOfRing(ring);
          return {
            lat: c.lat,
            lng: c.lng,
            tempC: f.properties.average_temperature,
            bounds: boundsOfRing(ring),
          };
        })
      : [];

  const stats = heatmap.status === "ok" ? heatmap.result.stats_data.temperature_stats : null;
  const heatDateUsed = heatmap.status === "ok" ? heatmap.dateUsed : undefined;
  const heatIsFallbackDate = heatmap.status === "ok" ? heatmap.isFallbackDate : undefined;

  return {
    name: input.name ?? null,
    aoi_geometry: input.aoiGeometry,
    site_area_m2: input.areaSqKm * 1_000_000,

    landcover:
      overpass.status === "ok"
        ? {
            source: "overpass",
            buildingPct: overpass.result.buildingPct,
            roadPct: overpass.result.roadPct,
            vegetationPct: overpass.result.vegetationPct,
            waterPct: overpass.result.waterPct,
            otherPct: overpass.result.otherPct,
            buildingCount: overpass.result.buildingCount,
            roadCount: overpass.result.roadCount,
            vegetationCount: overpass.result.vegetationCount,
            waterCount: overpass.result.waterCount,
          }
        : null,

    landcover_spotcheck:
      satellite.status === "ok"
        ? {
            source: "fortyguard_satellite",
            sampledAt: { lat: input.centroid.lat, lon: input.centroid.lon },
            imageYear: satellite.result.image_year,
            imageDimensions: satellite.result.segmentation.image_dimensions,
            segments: satellite.result.segmentation.segments,
            synthetic: Boolean(satellite.cached),
          }
        : null,

    heat_tiles: heatTiles,
    heat_stats: stats
      ? {
          avgTempC: stats.mean,
          maxTempC: stats.maximum,
          minTempC: stats.minimum,
          stdDevC: stats.standard_deviation,
          tileCount: heatTiles.length,
          capturedAt: new Date().toISOString(),
          dateUsed: heatDateUsed ?? "",
          isFallbackDate: Boolean(heatIsFallbackDate),
        }
      : null,

    attribution: {
      landcover: overpass.status === "ok" ? "real" : "unavailable",
      landcover_spotcheck:
        satellite.status !== "ok" ? "unavailable" : satellite.cached ? "synthetic" : "real",
      heat: heatmap.status !== "ok" ? "unavailable" : heatmap.cached ? "synthetic" : "real",
    },
  };
}
