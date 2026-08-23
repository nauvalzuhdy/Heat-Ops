// Server-only Overpass client. Used as an independent, AOI-exact cross-check
// against FortyGuard's point-based satellite segmentation (see fortyguard.ts) —
// FortyGuard analyzes imagery centered on the AOI centroid, while this clips
// building/road footprints to the drawn polygon boundary precisely via Turf.
// The returned per-object geometries (buildingFeatures/roadFeatures) are also
// the only source for the map's building/road recolor layer — /v1/satellite
// only returns aggregate class %, with no per-object geometry to render.
import "server-only";
import * as turf from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

// Tried in this order — large AOIs regularly 504 on the primary host, so a
// query is only given up on after every mirror has been exhausted (§7).
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];
// Overpass's Apache front-end returns 406 Not Acceptable for requests with no
// User-Agent/Accept header (Node's fetch sends neither by default) — same
// descriptive-UA requirement as Nominatim, see src/app/api/geocode/route.ts.
const OVERPASS_USER_AGENT = "HeatOps/1.0 (FortyGuard Hackathon 2026)";

// One value per retry (not per total attempt): attempt 1 fires immediately,
// then a 2s/5s/10s backoff precedes retries 1/2/3 — 4 requests max per mirror.
const OVERPASS_RETRY_BACKOFF_MS = [2000, 5000, 10000];
// The query's own [timeout:25] bounds Overpass's server-side execution; this
// bounds our client-side wait per attempt so a connection that never gets a
// response (vs. a prompt 504) can't stall a retry cycle indefinitely.
const OVERPASS_FETCH_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Surfaced verbatim in the Analyze panel — see AnalyzePanel.tsx's
// `data.overpass.message` — so it must never be Overpass's own error body
// (HTML/plain-text gateway pages, not JSON), only ever this fixed string.
const OSM_UNAVAILABLE_MESSAGE =
  "Data OSM sedang tidak bisa diakses, coba lagi sebentar lagi atau perkecil AOI.";

// Estimated road-surface width by highway class, in meters. Used only for the
// buffer used to approximate paved area — not a survey-grade measurement.
const ROAD_WIDTH_M: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 12,
  secondary: 10,
  tertiary: 9,
  residential: 7,
  service: 4,
  unclassified: 6,
  living_street: 6,
  pedestrian: 4,
  footway: 2,
  cycleway: 2,
  track: 3,
};
const DEFAULT_ROAD_WIDTH_M = 6;

// Overpass has no reliable width for waterway lines (rivers/canals mapped as
// centerlines, not banks), so — same approximation strategy as roads above —
// every waterway is buffered by this fixed width regardless of class.
const WATERWAY_WIDTH_M = 8;

// Vegetation area tags (§4.2 follow-up: expanded beyond the original
// grass/forest/wood set). natural=tree stays deliberately excluded — it's
// tagged on individual point nodes (single street trees), which have no area
// to contribute to a % breakdown.
const VEGETATION_LANDUSE = new Set(["grass", "forest", "farmland", "orchard", "vineyard", "meadow"]);
const VEGETATION_NATURAL = new Set(["wood", "scrub", "grassland"]);
const VEGETATION_LEISURE = new Set(["park", "garden"]);

type OverpassNode = { type: "node"; id: number; lat: number; lon: number };
type OverpassWay = {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
};
type OverpassElement = OverpassNode | OverpassWay;

export type BuildingProperties = { heightM: number };

export type OverpassLandCover = {
  buildingPct: number;
  roadPct: number;
  vegetationPct: number;
  waterPct: number;
  otherPct: number;
  buildingCount: number;
  roadCount: number;
  vegetationCount: number;
  waterCount: number;
  // Per-object footprints, each already clipped exactly to the AOI boundary
  // via Turf — the actual geometry to recolor on the map (buildings/roads/
  // vegetation/water), as opposed to /v1/satellite which only returns
  // aggregate class %, with no per-object geometry to render. buildingFeatures
  // carry heightM (§4.6 extrusion) — see estimateBuildingHeightM.
  buildingFeatures: Feature<Polygon | MultiPolygon, BuildingProperties>[];
  roadFeatures: Feature<Polygon | MultiPolygon>[];
  vegetationFeatures: Feature<Polygon | MultiPolygon>[];
  waterFeatures: Feature<Polygon | MultiPolygon>[];
};

// building:levels is far more commonly tagged in OSM than height. 3.2m/level
// approximates a mixed residential/commercial story height; neither figure is
// survey-grade, only enough to give the 3D massing view real variation instead
// of every building rendering at one flat block height.
const METERS_PER_LEVEL = 3.2;
const DEFAULT_BUILDING_HEIGHT_M = 8; // ~2-3 stories — used when OSM has neither tag

function estimateBuildingHeightM(tags: Record<string, string> | undefined): number {
  const heightTag = tags?.height;
  if (heightTag) {
    const parsed = parseFloat(heightTag);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const levelsTag = tags?.["building:levels"];
  if (levelsTag) {
    const parsed = parseFloat(levelsTag);
    if (Number.isFinite(parsed) && parsed > 0) return parsed * METERS_PER_LEVEL;
  }
  return DEFAULT_BUILDING_HEIGHT_M;
}

async function fetchFromMirror(url: string, query: string): Promise<{ elements: OverpassElement[] }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": OVERPASS_USER_AGENT,
        Accept: "*/*",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!res.ok) {
      // Read only for the server-side log line below — this text is a raw
      // HTML/plain-text gateway error page and must never reach the client.
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200).replace(/\s+/g, " ").trim()}`);
    }

    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`timed out after ${OVERPASS_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpassElements(aoi: Polygon): Promise<OverpassElement[]> {
  const [west, south, east, north] = turf.bbox(aoi);
  const bbox = `${south},${west},${north},${east}`;
  // Vegetation/water are area tags only — natural=tree is deliberately
  // excluded: it's tagged on individual point nodes (single street trees),
  // which have no area to contribute to a % breakdown (per user decision).
  const query =
    `[out:json][timeout:25];(` +
    `way["building"](${bbox});` +
    `way["highway"](${bbox});` +
    `way["landuse"="grass"](${bbox});` +
    `way["landuse"="forest"](${bbox});` +
    `way["landuse"="farmland"](${bbox});` +
    `way["landuse"="orchard"](${bbox});` +
    `way["landuse"="vineyard"](${bbox});` +
    `way["landuse"="meadow"](${bbox});` +
    `way["natural"="wood"](${bbox});` +
    `way["natural"="scrub"](${bbox});` +
    `way["natural"="grassland"](${bbox});` +
    `way["leisure"="park"](${bbox});` +
    `way["leisure"="garden"](${bbox});` +
    `way["natural"="water"](${bbox});` +
    `way["landuse"="reservoir"](${bbox});` +
    `way["waterway"](${bbox});` +
    `);out body;>;out skel qt;`;

  const attemptsPerMirror = OVERPASS_RETRY_BACKOFF_MS.length + 1;
  const log: string[] = [];

  for (const mirror of OVERPASS_MIRRORS) {
    for (let attempt = 1; attempt <= attemptsPerMirror; attempt++) {
      if (attempt > 1) await sleep(OVERPASS_RETRY_BACKOFF_MS[attempt - 2]);

      try {
        const body = await fetchFromMirror(mirror, query);
        console.log(
          `[overpass] OK — ${mirror} attempt ${attempt}/${attemptsPerMirror}` +
            (log.length ? ` (after: ${log.join("; ")})` : "")
        );
        return body.elements;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.push(`${mirror} #${attempt}: ${message}`);
        console.warn(`[overpass] FAILED — ${mirror} attempt ${attempt}/${attemptsPerMirror}: ${message}`);
      }
    }
    console.warn(`[overpass] exhausted all attempts on ${mirror}, falling back to next mirror`);
  }

  console.error(`[overpass] all mirrors exhausted, giving up:\n  ${log.join("\n  ")}`);
  throw new Error(OSM_UNAVAILABLE_MESSAGE);
}

function clipToAOI(polygon: Feature<Polygon>, aoi: Feature<Polygon>): Feature<Polygon | MultiPolygon> | null {
  if (!turf.booleanIntersects(polygon, aoi)) return null;
  return turf.intersect(turf.featureCollection([polygon, aoi]));
}

export async function fetchLandCoverFromOverpass(aoiGeometry: Polygon): Promise<OverpassLandCover> {
  const aoi = turf.feature(aoiGeometry);
  const aoiAreaSqM = turf.area(aoi);

  const elements = await fetchOverpassElements(aoiGeometry);

  const nodes = new Map<number, [number, number]>();
  for (const el of elements) {
    if (el.type === "node") nodes.set(el.id, [el.lon, el.lat]);
  }

  let buildingAreaSqM = 0;
  let buildingCount = 0;
  let roadAreaSqM = 0;
  let roadCount = 0;
  let vegetationAreaSqM = 0;
  let vegetationCount = 0;
  let waterAreaSqM = 0;
  let waterCount = 0;
  const buildingFeatures: Feature<Polygon | MultiPolygon, BuildingProperties>[] = [];
  const roadFeatures: Feature<Polygon | MultiPolygon>[] = [];
  const vegetationFeatures: Feature<Polygon | MultiPolygon>[] = [];
  const waterFeatures: Feature<Polygon | MultiPolygon>[] = [];

  for (const el of elements) {
    if (el.type !== "way") continue;
    const coords = el.nodes.map((id) => nodes.get(id)).filter((c): c is [number, number] => !!c);
    if (coords.length < 2) continue;

    const isClosed =
      coords.length >= 4 &&
      coords[0][0] === coords[coords.length - 1][0] &&
      coords[0][1] === coords[coords.length - 1][1];

    if (el.tags?.building && isClosed) {
      try {
        const poly = turf.polygon([coords]);
        const clipped = clipToAOI(poly, aoi);
        if (clipped) {
          clipped.properties = { heightM: estimateBuildingHeightM(el.tags) };
          buildingAreaSqM += turf.area(clipped);
          buildingFeatures.push(clipped as Feature<Polygon | MultiPolygon, BuildingProperties>);
          buildingCount++;
        }
      } catch {
        // malformed ring — skip rather than fail the whole request
      }
      continue;
    }

    if (el.tags?.highway) {
      try {
        const line = turf.lineString(coords);
        const widthM = ROAD_WIDTH_M[el.tags.highway] ?? DEFAULT_ROAD_WIDTH_M;
        const buffered = turf.buffer(line, widthM / 2, { units: "meters" });
        if (buffered) {
          const clipped = clipToAOI(buffered as Feature<Polygon>, aoi);
          if (clipped) {
            roadAreaSqM += turf.area(clipped);
            roadFeatures.push(clipped);
            roadCount++;
          }
        }
      } catch {
        // malformed line — skip rather than fail the whole request
      }
      continue;
    }

    const isVegetation =
      (el.tags?.landuse && VEGETATION_LANDUSE.has(el.tags.landuse)) ||
      (el.tags?.natural && VEGETATION_NATURAL.has(el.tags.natural)) ||
      (el.tags?.leisure && VEGETATION_LEISURE.has(el.tags.leisure));
    if (isVegetation && isClosed) {
      try {
        const poly = turf.polygon([coords]);
        const clipped = clipToAOI(poly, aoi);
        if (clipped) {
          vegetationAreaSqM += turf.area(clipped);
          vegetationFeatures.push(clipped);
          vegetationCount++;
        }
      } catch {
        // malformed ring — skip rather than fail the whole request
      }
      continue;
    }

    const isClosedWater = el.tags?.natural === "water" || el.tags?.landuse === "reservoir";
    if (isClosedWater && isClosed) {
      try {
        const poly = turf.polygon([coords]);
        const clipped = clipToAOI(poly, aoi);
        if (clipped) {
          waterAreaSqM += turf.area(clipped);
          waterFeatures.push(clipped);
          waterCount++;
        }
      } catch {
        // malformed ring — skip rather than fail the whole request
      }
      continue;
    }

    // Rivers/canals are mapped as centerlines (waterway=river/canal/stream/…),
    // not bank polygons — buffered the same way highways are, since Overpass
    // has no reliable width for them either.
    if (el.tags?.waterway) {
      try {
        const line = turf.lineString(coords);
        const buffered = turf.buffer(line, WATERWAY_WIDTH_M / 2, { units: "meters" });
        if (buffered) {
          const clipped = clipToAOI(buffered as Feature<Polygon>, aoi);
          if (clipped) {
            waterAreaSqM += turf.area(clipped);
            waterFeatures.push(clipped);
            waterCount++;
          }
        }
      } catch {
        // malformed line — skip rather than fail the whole request
      }
    }
  }

  // Overlapping features aren't de-duplicated (rare within a few-block AOI)
  // — good enough for a cross-check display, not a survey. Each category is
  // clamped against whatever budget the previous ones left, in the same
  // building -> road -> vegetation -> water -> other precedence order as the
  // classification loop above, so the five percentages always sum to 100.
  const buildingPct = Math.min(100, (buildingAreaSqM / aoiAreaSqM) * 100);
  const roadPct = Math.min(100 - buildingPct, (roadAreaSqM / aoiAreaSqM) * 100);
  const vegetationPct = Math.min(100 - buildingPct - roadPct, (vegetationAreaSqM / aoiAreaSqM) * 100);
  const waterPct = Math.min(100 - buildingPct - roadPct - vegetationPct, (waterAreaSqM / aoiAreaSqM) * 100);
  const otherPct = Math.max(0, 100 - buildingPct - roadPct - vegetationPct - waterPct);

  return {
    buildingPct,
    roadPct,
    vegetationPct,
    waterPct,
    otherPct,
    buildingCount,
    roadCount,
    vegetationCount,
    waterCount,
    buildingFeatures,
    roadFeatures,
    vegetationFeatures,
    waterFeatures,
  };
}
