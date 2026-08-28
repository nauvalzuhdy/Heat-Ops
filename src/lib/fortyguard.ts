// Server-only FortyGuard API client. Never import this from a client component
// — FORTYGUARD_API_KEY must stay off the client bundle entirely.
import "server-only";
import type { FeatureCollection, Polygon } from "geojson";
import {
  generateCachedHeatmapResult,
  generateCachedSatelliteResult,
  generateCachedEnvParamsResult,
} from "./fortyguardFixtures";

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

// ---------------------------------------------------------------------------
// /v1/env_params — hourly environmental parameters at a single point.
//
// Added so lib/wbgt.ts can stop assuming a flat 40% relative humidity. That
// stand-in was the single largest source of error in the Shift Schedule: at the
// Houston Ship Channel on 2026-08-26 the real hourly humidity ran 34.2% to
// 92.8% across one day, so the assumption was roughly right mid-afternoon and
// badly wrong at dawn — in the direction that UNDERSTATES heat stress, which is
// the dangerous direction for a tool that tells crews when it is safe to work.
//
// Contract confirmed against the live API on 2026-08-28, not assumed from docs:
// a GET returns 405 (the endpoint exists — a non-existent path returns 404), and
// POSTing an empty body returns a 422 naming every required field. Neither
// probe creates an activity, so neither costs credit.
//
// Note the shape: `temperature` is an INPUT. The endpoint takes a temperature
// (here, the one FortyGuard already measured for this AOI) and returns hourly
// environmental parameters around it, so this composes with /v1/heatmap rather
// than duplicating it. One call with filter_type 3 returns all 24 hours of a
// day in the location's own timezone, which covers every forecast slot at once.
// ---------------------------------------------------------------------------
export type EnvParamsResult = {
  metadata: {
    timezone: string;
    timezone_offset_hours: number;
    time_range: { start: string; end: string; interval: string; count: number };
    /** ISO 8601, each carrying the location's own UTC offset — one per hourly sample. */
    timestamps: string[];
  };
  locations: {
    lat: number;
    lon: number;
    elevation: number;
    temperature: number;
    /**
     * Every entry is a 24-element hourly series aligned to `metadata.timestamps`.
     * Only the fields HeatOps actually consumes are named; the live response also
     * carries air-quality, CO2 and methane series, left untyped rather than
     * half-modelled.
     */
    parameters: {
      relative_humidity_percent?: number[];
      wet_bulb_temperature_celsius?: number[];
      heat_index_celsius?: number[];
      apparent_temperature_celsius?: number[];
      cloud_cover_octas?: number[];
    };
    solar_irradiance?: { clear_sky?: { ghi: number; dni: number; dhi: number }; description?: string };
  }[];
};

async function submitEnvParams(params: {
  latitude: number;
  longitude: number;
  temperature: number;
  startDate: string;
}): Promise<string> {
  const res = await fetch(`${FORTYGUARD_BASE_URL}/v1/env_params`, {
    method: "POST",
    headers: { "api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      latitude: params.latitude,
      longitude: params.longitude,
      temperature: params.temperature,
      // filter_type 3 (whole day) — same meaning as /v1/heatmap's, and the
      // reason one call covers every forecast slot.
      date_time: { start_date: params.startDate, filter_type: 3 },
    }),
  });

  if (!res.ok) {
    throw new Error(`FortyGuard /v1/env_params submit failed: ${res.status} ${await res.text()}`);
  }

  const body: SubmitResponse = await res.json();
  if (body.error || !body.data?.activity_id) {
    throw new Error(`FortyGuard /v1/env_params submit rejected: ${body.message}`);
  }
  return body.data.activity_id;
}

export async function runEnvParams(params: {
  latitude: number;
  longitude: number;
  temperature: number;
  startDate: string;
}): Promise<{ cached: boolean; result: EnvParamsResult }> {
  if (isCachedMode()) {
    console.log("[FortyGuard] CACHED mode — returning synthetic env_params, no credit spent");
    return { cached: true, result: generateCachedEnvParamsResult(params) };
  }

  logMode("/v1/env_params");
  const activityId = await submitEnvParams(params);
  try {
    const result = await pollUntilDone<EnvParamsResult>(activityId);
    return { cached: false, result };
  } catch (err) {
    console.error(`FortyGuard env_params activity_id=${activityId} error:`, err);
    throw err;
  }
}

/**
 * Relative humidity (%) at the hourly sample nearest `targetTimeIso`, or null
 * when the response carries no humidity series or no timestamp within an hour
 * of the target.
 *
 * Matched on absolute instant, never on clock-face hour: `metadata.timestamps`
 * are in the LOCATION's timezone (GMT-6 for the Texas AOI this was built
 * against) while a forecast slot's `targetTime` is UTC. Comparing the two as
 * strings, or by getHours(), would silently pick a reading several hours off —
 * which for a diurnal humidity curve is the difference between 34% and 92%.
 *
 * The one-hour tolerance keeps a target outside the returned day (e.g. a slot
 * that crosses midnight into a day this response does not cover) from silently
 * snapping to that day's first or last sample.
 */
export function relativeHumidityAt(result: EnvParamsResult, targetTimeIso: string): number | null {
  const series = result.locations?.[0]?.parameters?.relative_humidity_percent;
  const stamps = result.metadata?.timestamps;
  if (!series?.length || !stamps?.length) return null;

  const targetMs = new Date(targetTimeIso).getTime();
  if (!Number.isFinite(targetMs)) return null;

  let bestIndex = -1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < Math.min(stamps.length, series.length); i++) {
    const ms = new Date(stamps[i]).getTime();
    if (!Number.isFinite(ms)) continue;
    const delta = Math.abs(ms - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = i;
    }
  }

  if (bestIndex < 0 || bestDelta > 3_600_000) return null;
  const value = series[bestIndex];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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

function isDegenerateHeatmapResult(result: HeatmapResult): boolean {
  return result.map_data.features.length === 0;
}

function shiftDateString(dateStr: string, deltaDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * A segmentation that completed but carries no classes — the satellite equivalent
 * of the heatmap's `n_cells: 0` empty result. Treated as "no data for this
 * date" so the caller can fall back, rather than being stored as a real
 * spot-check with nothing in it.
 */
function isDegenerateSatelliteResult(result: SatelliteSegmentationResult): boolean {
  const segments = result?.segmentation?.segments;
  return !segments || Object.keys(segments).length === 0;
}

export type SatelliteWithDateFallback = {
  cached: boolean;
  result: SatelliteSegmentationResult;
  /** The date the returned segmentation is actually FOR — not necessarily the one requested. */
  dateUsed: string;
  isFallbackDate: boolean;
};

/**
 * Walks backward day-by-day until /v1/satellite actually returns a
 * segmentation, exactly as runHeatmapWithDateFallback() already does for
 * /v1/heatmap.
 *
 * Why this exists: the two calls were asymmetric. The heatmap has walked back
 * up to MAX_HEATMAP_DAYS_BACK since the availability-lag investigation, but the
 * satellite call was still pinned to `new Date()` with no fallback at all
 * (app/api/landcover/route.ts). FortyGuard's availability lag is variable and
 * applies to both endpoints, so on a day when same-day data was not ready yet
 * the heatmap quietly recovered and the segmentation just failed — which is
 * precisely the "FortyGuard satellite segmentation isn't available for this site
 * yet" state seen on sites whose heatmap came back fine. Losing the
 * segmentation loses the tree-canopy percentage, and with it the entire canopy
 * recommendation and its ROI, so a whole half of the product went missing for a
 * reason that had nothing to do with the site.
 *
 * Credit behaviour is the same as the heatmap walk: a task that Fails costs
 * nothing, and a date is only retried when the previous one produced no usable
 * segmentation. The search is capped at the same MAX_HEATMAP_DAYS_BACK.
 *
 * It is ALSO capped in wall-clock time, which the heatmap walk does not need to
 * be. A single poll cycle can run to POLL_MAX_ATTEMPTS (~105s) before giving up,
 * so a naive four-date walk over repeated timeouts would spend ~7 minutes — and
 * /api/landcover is one of the two requests the user is already waiting on.
 * Walking back helps when a date genuinely has no data yet (fast, cheap answers);
 * it does not help when the endpoint is simply slow, so once the budget is spent
 * this stops and reports rather than compounding the wait.
 */
/**
 * Wall-clock budget for ADDITIONAL date attempts (the first is always made).
 * Sized just under one full poll cycle so a single slow-but-successful call is
 * never cut short, while a chain of timeouts cannot stack up.
 */
const SATELLITE_FALLBACK_BUDGET_MS = 90_000;

export async function runSatelliteWithDateFallback(params: {
  latitude: number;
  longitude: number;
  startDate: string;
  granularity: 60 | 80 | 100;
  maxDaysBack?: number;
}): Promise<SatelliteWithDateFallback> {
  const maxDaysBack = params.maxDaysBack ?? MAX_HEATMAP_DAYS_BACK;
  const attempted: string[] = [];
  let lastError: unknown = null;
  const startedAt = Date.now();

  for (let daysBack = 0; daysBack <= maxDaysBack; daysBack++) {
    // Never skips the first date — only additional walk-back attempts are budgeted.
    if (daysBack > 0 && Date.now() - startedAt > SATELLITE_FALLBACK_BUDGET_MS) {
      console.warn(
        `[FortyGuard] satellite date walk-back stopped after ` +
          `${Math.round((Date.now() - startedAt) / 1000)}s — budget spent, not retrying further dates.`,
      );
      break;
    }

    const startDate = shiftDateString(params.startDate, -daysBack);
    attempted.push(startDate);

    try {
      const attempt = await runSatelliteSegmentation({ ...params, startDate });
      if (attempt.cached || !isDegenerateSatelliteResult(attempt.result)) {
        if (daysBack > 0) {
          console.warn(
            `[FortyGuard] satellite using ${startDate} (${daysBack} day(s) back from ${params.startDate}).`,
          );
        }
        return { cached: attempt.cached, result: attempt.result, dateUsed: startDate, isFallbackDate: daysBack > 0 };
      }
      console.warn(`[FortyGuard] satellite ${startDate} returned an empty segmentation.`);
    } catch (err) {
      // A Failed activity or a rejected submit for one date says nothing about
      // the previous day, so keep walking instead of giving up here — but hold
      // on to the error so the final message is the real one, not a generic.
      lastError = err;
      console.warn(
        `[FortyGuard] satellite ${startDate} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  throw new Error(
    `No satellite segmentation available from FortyGuard for ${attempted.length} date(s) tried ` +
      `(${attempted[0]} back to ${attempted[attempted.length - 1]})` +
      (lastError instanceof Error ? ` — last error: ${lastError.message}` : "") +
      ` — try again later.`,
  );
}

export type HeatmapWithDateFallback = {
  cached: boolean;
  result: HeatmapResult;
  dateUsed: string;
  isFallbackDate: boolean;
  /** How many days back from the requested date this result came from (0 = the requested date itself). */
  daysBack: number;
};

// How many days back the search may walk before giving up. Was 1 ("yesterday
// only"); raised to 3 after 2026-08-28's live evidence below.
export const MAX_HEATMAP_DAYS_BACK = 3;

// Walks backward day-by-day until FortyGuard actually returns tiles, starting
// from the requested date (project.md §2/§4.4).
//
// Why a backward search exists at all: FortyGuard's data availability is NOT
// a fixed lag. 2026-08-23, -25, and -26 all returned real data through this
// app's default "today" request, while 2026-08-27 returned FortyGuard's
// undocumented degenerate shape (stats_data reduced to just
// {activity_id, n_cells: 0}, empty map_data.features) at every granularity
// (60/80/100) and both filter_type 1 and 3, live, repeatedly.
//
// Why the depth is 3 and not 1: the original single-step version assumed the
// gap never exceeds one day. On 2026-08-28 at 00:30 UTC that proved wrong —
// Gigafactory Texas returned the degenerate shape for BOTH 08-28 and 08-27,
// and only came back with real tiles at 08-26 (D-2), 08-25, and 08-24. The
// timing is the likely explanation: 08-27 UTC had ended only ~30 minutes
// earlier, so a day appears to need to be finished PLUS several hours of
// processing before it is queryable — meaning the required offset is larger
// early in the UTC day and smaller later on. Depth 3 covers the observed
// 2-day case with one day of margin.
//
// Cost is real, so the search is bounded and always tries the requested date
// FIRST: FortyGuard bills on status "Completed" (their own docs) and a
// degenerate result still reaches "Completed", so every extra step is a
// billed ~30s round trip. `initialDaysBack` lets a caller that already
// discovered the working offset moments ago (see analysisStore.ts's
// captureFullForecast, which reuses the whole-day analysis's own `daysBack`)
// skip re-probing dates that were just proven empty in the same run — it is
// never used to skip a genuinely untested "today".
//
// Applies identically to the whole-day analysis (filter_type 3) and every
// forecast slot (filter_type 1) through this one shared function. A forecast
// slot's fallback shifts its date back while keeping the same wall-clock
// start_time — the caller MUST label an `isFallbackDate: true` result as what
// it actually is (a real reading from `dateUsed`), never as "now" or as a
// genuine forecast.
export async function runHeatmapWithDateFallback(params: {
  aoiGeometry: Polygon;
  startDate: string;
  startTime?: string;
  filterType?: 1 | 3;
  hourOffset?: number;
  granularity: 60 | 80 | 100;
  /** Start the search this many days back instead of at `startDate` (see comment above). */
  initialDaysBack?: number;
  maxDaysBack?: number;
}): Promise<HeatmapWithDateFallback> {
  const maxDaysBack = params.maxDaysBack ?? MAX_HEATMAP_DAYS_BACK;
  const startAt = Math.max(0, Math.min(params.initialDaysBack ?? 0, maxDaysBack));
  const attempted: string[] = [];

  for (let daysBack = startAt; daysBack <= maxDaysBack; daysBack++) {
    const startDate = shiftDateString(params.startDate, -daysBack);
    attempted.push(startDate);

    const attempt = await runHeatmapGeneration({ ...params, startDate });
    if (attempt.cached || !isDegenerateHeatmapResult(attempt.result)) {
      if (daysBack > startAt || daysBack > 0) {
        console.warn(`[FortyGuard] using ${startDate} (${daysBack} day(s) back from ${params.startDate}).`);
      }
      return {
        cached: attempt.cached,
        result: attempt.result,
        dateUsed: startDate,
        isFallbackDate: daysBack > 0,
        daysBack,
      };
    }

    console.warn(`[FortyGuard] ${startDate} returned no usable data (empty map_data.features).`);
  }

  throw new Error(
    `No temperature data available from FortyGuard for ${attempted.length} date(s) tried ` +
      `(${attempted[0]} back to ${attempted[attempted.length - 1]}) — try again later.`
  );
}
