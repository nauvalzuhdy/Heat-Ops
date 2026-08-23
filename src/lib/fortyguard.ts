// Server-only FortyGuard API client. Never import this from a client component
// — FORTYGUARD_API_KEY must stay off the client bundle entirely.
import "server-only";
import type { FeatureCollection, Polygon } from "geojson";
import { generateCachedHeatmapResult, generateCachedSatelliteResult } from "./fortyguardFixtures";

const FORTYGUARD_BASE_URL = "https://api.fortyguard.com";

function apiKey(): string {
  const key = process.env.FORTYGUARD_API_KEY;
  if (!key) throw new Error("FORTYGUARD_API_KEY is not set");
  return key;
}

// One flag governs both /v1/heatmap and /v1/satellite — mirrors the
// FortyGuard Quickstart notebook's CACHED=True testing mode ("a cached mode
// you can use to test your code without spending credits"). Overpass
// (free/unlimited) is unaffected and always runs live regardless.
//
// Deliberately NOT a plain boolean read as === "true": defaulting to cached
// on anything unset/misspelled is the safe failure mode for a flag that
// gates real money — only the exact string "live" spends credit.
// FORTYGUARD_SATELLITE_ENABLED used to gate /v1/satellite independently of
// this (added when its usage dashboard showed 345,600 credits burned for a
// card Map View doesn't render — see §4.2). That was a permanent kill switch;
// this project now wants satellite to follow the SAME cached/live mode as
// heatmap instead — cached mode already returns a fixture with zero real
// calls, so a separate always-off switch was solving a problem isCachedMode()
// already solves. Removed; see .env.local's FORTYGUARD_MODE.
export function isCachedMode(): boolean {
  return process.env.FORTYGUARD_MODE !== "live";
}

// Logged on every credit-spending path so the dev-server log always states
// which mode a run actually took. Silence used to mean "live", which is the
// wrong default for the mode that costs money.
function logMode(endpoint: string) {
  console.warn(
    `[FortyGuard] LIVE mode — ${endpoint} will spend credit (FORTYGUARD_MODE=${process.env.FORTYGUARD_MODE ?? "unset"})`
  );
}

type SubmitResponse = {
  error: boolean;
  status_code: number;
  message: string;
  data: { activity_id: string };
};

type StatusResponse<TResult> = {
  error: boolean;
  status_code: number;
  message: string;
  data: {
    activity_id: string;
    status: "Processing" | "Completed" | "Failed" | string;
    result?: TResult;
  };
};

export type SatelliteSegmentationResult = {
  coordinates: { latitude: string; longitude: string };
  orignal_image: string[];
  image_year: number;
  segmentation: {
    image_dimensions: { height: number; width: number };
    mode: string;
    processing_time_seconds: number;
    request_id: string;
    segments: Record<string, number>;
    image_legend: Record<string, unknown>;
    image_content: string;
  };
};

async function submitSatelliteSegmentation(params: {
  latitude: number;
  longitude: number;
  startDate: string;
  granularity: 60 | 80 | 100;
}): Promise<string> {
  const res = await fetch(`${FORTYGUARD_BASE_URL}/v1/satellite`, {
    method: "POST",
    headers: { "api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      sat: { latitude: params.latitude, longitude: params.longitude },
      date_time: { start_date: params.startDate, filter_type: 3 },
      granularity: params.granularity,
    }),
  });

  if (!res.ok) {
    throw new Error(`FortyGuard /v1/satellite submit failed: ${res.status} ${await res.text()}`);
  }

  const body: SubmitResponse = await res.json();
  if (body.error || !body.data?.activity_id) {
    throw new Error(`FortyGuard /v1/satellite submit rejected: ${body.message}`);
  }
  return body.data.activity_id;
}

async function checkStatus<TResult>(activityId: string): Promise<StatusResponse<TResult>["data"]> {
  const res = await fetch(`${FORTYGUARD_BASE_URL}/v1/status/${activityId}`, {
    headers: { "api-key": apiKey() },
  });

  if (!res.ok) {
    throw new Error(`FortyGuard /v1/status/${activityId} failed: ${res.status} ${await res.text()}`);
  }

  const body: StatusResponse<TResult> = await res.json();
  return body.data;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Backoff: 3s, 6s, 12s, then hold at 12s. Gives up after POLL_MAX_ATTEMPTS
// attempts (~2 minutes total) so a stuck activity doesn't hang the request forever.
const POLL_BACKOFF_MS = [3000, 6000, 12000];
const POLL_MAX_ATTEMPTS = 10;

async function pollUntilDone<TResult>(activityId: string): Promise<TResult> {
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await sleep(POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)]);

    const data = await checkStatus<TResult>(activityId);
    if (data.status === "Completed") {
      if (!data.result) throw new Error(`FortyGuard activity ${activityId} completed with no result`);
      return data.result;
    }
    if (data.status === "Failed") {
      // Failed tasks don't consume credits, but log the activity_id for debugging.
      console.error(`FortyGuard activity ${activityId} failed`);
      throw new Error(`FortyGuard activity ${activityId} failed`);
    }
    // otherwise "Processing" — keep polling
  }
  throw new Error(`FortyGuard activity ${activityId} timed out after ${POLL_MAX_ATTEMPTS} polls`);
}

export async function runSatelliteSegmentation(params: {
  latitude: number;
  longitude: number;
  startDate: string;
  granularity: 60 | 80 | 100;
}): Promise<{ cached: boolean; result: SatelliteSegmentationResult }> {
  if (isCachedMode()) {
    console.log("[FortyGuard] CACHED mode — returning synthetic satellite segmentation, no credit spent");
    return { cached: true, result: generateCachedSatelliteResult(params.latitude, params.longitude) };
  }

  logMode("/v1/satellite");
  const activityId = await submitSatelliteSegmentation(params);
  try {
    const result = await pollUntilDone<SatelliteSegmentationResult>(activityId);
    return { cached: false, result };
  } catch (err) {
    console.error(`FortyGuard satellite segmentation activity_id=${activityId} error:`, err);
    throw err;
  }
}

// Shape confirmed against a real completed /v1/heatmap activity (live call,
// not the docs' "{}" placeholder example — see development.md Step 5 notes).
// Note the docs prose describes stats_data with capitalized keys
// (Temperature_stats.Minimum/Maximum/...); the real API returns lowercase
// snake_case instead, which is what's typed below.
export type HeatmapTileProperties = {
  tile_id: number;
  average_temperature: number;
  min_temperature: number;
  max_temperature: number;
};

export type HeatmapResult = {
  map_data: FeatureCollection<Polygon, HeatmapTileProperties>;
  stats_data: {
    temperature_stats: {
      minimum: number;
      maximum: number;
      mean: number;
      standard_deviation: number;
    };
    overall_temperature_distribution: number[];
    normal_temperature_distribution: { x_axis: number[]; y_axis: number[] };
    temperature_frequency: { x_axis: number[]; y_axis: number[] };
  };
};

async function submitHeatmap(params: {
  aoiGeometry: Polygon;
  startDate: string;
  // §4.4 forecast slots use filter_type 1 (specific hour) with start_time;
  // §4.3's full-AOI analysis uses filter_type 3 (whole day), no start_time.
  startTime?: string;
  filterType: 1 | 3;
  granularity: 60 | 80 | 100;
}): Promise<string> {
  const res = await fetch(`${FORTYGUARD_BASE_URL}/v1/heatmap`, {
    method: "POST",
    headers: { "api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      // Full AOI polygon, not a centroid/point — /v1/heatmap (unlike
      // /v1/satellite) tiles the whole polygon.
      polygon_aoi: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: params.aoiGeometry }],
      },
      date_time: {
        start_date: params.startDate,
        filter_type: params.filterType,
        ...(params.filterType === 1 && params.startTime ? { start_time: params.startTime } : {}),
      },
      granularity: params.granularity,
    }),
  });

  if (!res.ok) {
    throw new Error(`FortyGuard /v1/heatmap submit failed: ${res.status} ${await res.text()}`);
  }

  const body: SubmitResponse = await res.json();
  if (body.error || !body.data?.activity_id) {
    throw new Error(`FortyGuard /v1/heatmap submit rejected: ${body.message}`);
  }
  return body.data.activity_id;
}

export async function runHeatmapGeneration(params: {
  aoiGeometry: Polygon;
  startDate: string;
  startTime?: string;
  filterType?: 1 | 3;
  // Hours ahead of now this call targets (§4.4). Only used to vary the
  // cached-mode fixture so forecast slots don't all return the same Mean —
  // has no effect on the live request, which already gets a distinct
  // start_time/filter_type from the caller.
  hourOffset?: number;
  granularity: 60 | 80 | 100;
}): Promise<{ cached: boolean; result: HeatmapResult }> {
  const filterType = params.filterType ?? 3;

  if (isCachedMode()) {
    console.log("[FortyGuard] CACHED mode — returning synthetic heatmap, no credit spent");
    return {
      cached: true,
      result: generateCachedHeatmapResult(params.aoiGeometry, params.granularity, params.hourOffset ?? 0),
    };
  }

  logMode("/v1/heatmap");
  const activityId = await submitHeatmap({ ...params, filterType });
  try {
    const result = await pollUntilDone<HeatmapResult>(activityId);
    return { cached: false, result };
  } catch (err) {
    console.error(`FortyGuard heatmap activity_id=${activityId} error:`, err);
    throw err;
  }
}
