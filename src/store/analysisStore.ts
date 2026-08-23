import { create } from "zustand";
import type { Polygon } from "geojson";
import type { HeatmapResult, SatelliteSegmentationResult } from "@/lib/fortyguard";
import type { OverpassLandCover } from "@/lib/overpass";
import { FORECAST_HOUR_OFFSETS } from "@/lib/mapConfig";

// `cached` marks results served by FortyGuard's cached/dev mode (see
// lib/fortyguard.ts) instead of a live, credit-consuming call — always
// `false`/absent for Overpass, which is free and never cached.
export type EndpointResult<T> = { status: "ok"; result: T; cached?: boolean } | { status: "error"; message: string };

type AnalysisData = {
  areaSqKm: number;
  centroid: { lat: number; lon: number };
  heatmap: EndpointResult<HeatmapResult>;
  satellite: EndpointResult<SatelliteSegmentationResult>;
  overpass: EndpointResult<OverpassLandCover>;
};

// §4.4 — one fetched forecast slot. Kept separately from `data.heatmap`
// (the §4.3 whole-day analysis, filter_type 3) since a slot is a specific-hour
// query (filter_type 1). `targetTime` is the real date+time this slot is FOR
// (server-computed in app/api/heatmap/route.ts from the actual clock at
// request time) — not to be confused with `capturedAt`, which is just when
// the fetch happened to resolve.
export type ForecastSlot =
  | { status: "ok"; result: HeatmapResult; cached?: boolean; meanTempC: number; targetTime: string; capturedAt: string }
  | { status: "error"; message: string; capturedAt: string };

type AnalysisState = {
  status: "idle" | "analyzing" | "success" | "error";
  data: AnalysisData | null;
  error: string | null;
  // Set by HeatmapImage.tsx once it finishes rendering the AOI's heat canvas.
  // §4.7's "heat photo" reads this rather than regenerating — same bytes the
  // Surface heatmap card already shows, not a fresh render.
  heatmapImageUrl: string | null;
  setHeatmapImageUrl: (url: string | null) => void;
  analyzeAOI: (geometry: Polygon) => Promise<void>;
  reset: () => void;
  // §4.4 forecast slots, keyed by hour offset (0/3/6/9/12). `null` selection
  // means "showing the §4.3 whole-day result", not a slot.
  heatForecast: Record<number, ForecastSlot>;
  selectedHourOffset: number | null;
  loadingHourOffset: number | null;
  selectForecastSlot: (geometry: Polygon, hourOffset: number) => Promise<void>;
  // True while captureFullForecast() has slots in flight — distinct from
  // loadingHourOffset (which is per-slot, set by a user's individual click)
  // since the auto-capture below fetches all 5 offsets at once.
  capturingForecast: boolean;
  captureFullForecast: (geometry: Polygon) => Promise<void>;
};

type HeatmapRouteBody =
  | { areaSqKm: number; cached: boolean; result: HeatmapResult; granularity: 60 | 80 | 100; targetTime: string }
  | { error: string };

type LandcoverRouteBody =
  | {
      areaSqKm: number;
      centroid: { lat: number; lon: number };
      fortyguard: EndpointResult<SatelliteSegmentationResult>;
      overpass: EndpointResult<OverpassLandCover>;
    }
  | { error: string };

async function postJSON<TBody>(
  url: string,
  geometry: Polygon,
  hourOffset?: number
): Promise<{ ok: boolean; body: TBody }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(hourOffset === undefined ? { geometry } : { geometry, hourOffset }),
  });
  const body: TBody = await res.json();
  return { ok: res.ok, body };
}

// Shared by selectForecastSlot (one user-clicked offset) and
// captureFullForecast (all 5 offsets at once, after Analyze succeeds) — both
// just need "fetch this one offset's slot", differing only in how many they
// call and what else they touch in the store around it.
async function fetchForecastSlot(geometry: Polygon, hourOffset: number): Promise<ForecastSlot> {
  try {
    const res = await postJSON<HeatmapRouteBody>("/api/heatmap", geometry, hourOffset);
    if (res.ok && "result" in res.body) {
      return {
        status: "ok",
        result: res.body.result,
        cached: res.body.cached,
        meanTempC: res.body.result.stats_data.temperature_stats.mean,
        // Route always returns this for a slot request; the `?? new Date()`
        // fallback only guards a malformed/old response shape, not a real
        // "unknown time" case — it should never actually fire.
        targetTime: res.body.targetTime ?? new Date().toISOString(),
        capturedAt: new Date().toISOString(),
      };
    }
    return {
      status: "error",
      message: ("error" in res.body && res.body.error) || "Forecast fetch failed",
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "Forecast fetch failed",
      capturedAt: new Date().toISOString(),
    };
  }
}

// Guards against a stale analyzeAOI() call overwriting a newer one. Drawing
// AOI #2 before AOI #1's fetch resolves does NOT cancel AOI #1's request —
// it keeps running, and without this guard, whichever call happens to finish
// LAST would win regardless of draw order, potentially landing AFTER the
// store has already moved on to a different `geometry` (from useAOIStore).
// §4.7's auto-save effect would then save a row whose aoi_geometry (current)
// doesn't match its landcover/heat_tiles (from the stale, superseded call) —
// silently wrong data, not just an extra row. Every call gets a ticket;
// a result only commits if its ticket is still the latest when it resolves.
let latestRequestId = 0;
// Same "latest wins" guard as analyzeAOI, but per forecast slot: switching
// from +3h to +6h before +3h's fetch resolves must not let +3h's late
// response overwrite +6h's already-settled entry in `heatForecast`.
let latestForecastRequestId = 0;

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  status: "idle",
  data: null,
  error: null,
  heatmapImageUrl: null,
  setHeatmapImageUrl: (heatmapImageUrl) => set({ heatmapImageUrl }),
  heatForecast: {},
  selectedHourOffset: null,
  loadingHourOffset: null,
  capturingForecast: false,
  selectForecastSlot: async (geometry, hourOffset) => {
    set({ selectedHourOffset: hourOffset });

    // Already fetched this slot (almost always true now — captureFullForecast
    // fetches it automatically right after Analyze) — just switch the view,
    // don't resubmit and burn another FortyGuard credit for the same AOI/hour.
    if (get().heatForecast[hourOffset]) return;

    const requestId = ++latestForecastRequestId;
    set({ loadingHourOffset: hourOffset });
    const slot = await fetchForecastSlot(geometry, hourOffset);
    if (requestId !== latestForecastRequestId) return; // superseded by a newer slot pick

    set((state) => ({
      loadingHourOffset: state.loadingHourOffset === hourOffset ? null : state.loadingHourOffset,
      heatForecast: { ...state.heatForecast, [hourOffset]: slot },
    }));
  },
  // Fires automatically once analyzeAOI() succeeds — captures the complete
  // supported +0/+3/+6/+9/+12h window in one go (all offsets requested in
  // parallel) instead of requiring 5 individual clicks in ForecastPanel.
  // Offsets that fail simply don't get an entry — never a fabricated value
  // (see ForecastPanel's sync effect, which only ever persists "ok" slots).
  captureFullForecast: async (geometry) => {
    const requestId = ++latestForecastRequestId;
    set({ capturingForecast: true });

    const results = await Promise.all(
      FORECAST_HOUR_OFFSETS.map(async (hourOffset) => [hourOffset, await fetchForecastSlot(geometry, hourOffset)] as const)
    );

    if (requestId !== latestForecastRequestId) {
      // Superseded by a redraw or a fresh analysis — that newer call (or
      // reset()) owns `capturingForecast` now, so don't touch it here.
      return;
    }

    set((state) => {
      const heatForecast = { ...state.heatForecast };
      for (const [hourOffset, slot] of results) heatForecast[hourOffset] = slot;
      return { heatForecast, capturingForecast: false };
    });
  },
  analyzeAOI: async (geometry) => {
    const requestId = ++latestRequestId;
    latestForecastRequestId++; // invalidate any in-flight forecast fetch from a prior analysis
    set({
      status: "analyzing",
      error: null,
      data: null,
      heatmapImageUrl: null,
      heatForecast: {},
      selectedHourOffset: null,
      loadingHourOffset: null,
      capturingForecast: false,
    });
    try {
      // /v1/heatmap and /v1/satellite are submitted in parallel; /api/landcover
      // itself already fetches /v1/satellite and Overpass in parallel server-side
      // (see app/api/landcover/route.ts), so all three run concurrently.
      const [heatmapRes, landcoverRes] = await Promise.all([
        postJSON<HeatmapRouteBody>("/api/heatmap", geometry),
        postJSON<LandcoverRouteBody>("/api/landcover", geometry),
      ]);

      if (!heatmapRes.ok && !landcoverRes.ok) {
        const heatmapErr = "error" in heatmapRes.body ? heatmapRes.body.error : undefined;
        const landcoverErr = "error" in landcoverRes.body ? landcoverRes.body.error : undefined;
        throw new Error(heatmapErr ?? landcoverErr ?? "Analysis failed");
      }

      if (requestId !== latestRequestId) return; // superseded by a newer analyzeAOI() — discard

      set({
        status: "success",
        data: {
          areaSqKm: landcoverRes.ok && "areaSqKm" in landcoverRes.body
            ? landcoverRes.body.areaSqKm
            : heatmapRes.ok && "areaSqKm" in heatmapRes.body
              ? heatmapRes.body.areaSqKm
              : 0,
          centroid:
            landcoverRes.ok && "centroid" in landcoverRes.body ? landcoverRes.body.centroid : { lat: 0, lon: 0 },
          heatmap:
            heatmapRes.ok && "result" in heatmapRes.body
              ? { status: "ok", result: heatmapRes.body.result, cached: heatmapRes.body.cached }
              : {
                  status: "error",
                  message: ("error" in heatmapRes.body && heatmapRes.body.error) || "Heatmap generation failed",
                },
          satellite:
            landcoverRes.ok && "fortyguard" in landcoverRes.body
              ? landcoverRes.body.fortyguard
              : {
                  status: "error",
                  message: ("error" in landcoverRes.body && landcoverRes.body.error) || "Land-cover analysis failed",
                },
          overpass:
            landcoverRes.ok && "overpass" in landcoverRes.body
              ? landcoverRes.body.overpass
              : {
                  status: "error",
                  message: ("error" in landcoverRes.body && landcoverRes.body.error) || "Land-cover analysis failed",
                },
        },
      });

      // One Analyze action now captures the complete supported forecast
      // window automatically — not awaited: the main results above are
      // already ready to show, and forecast slots fill in over the next
      // few seconds (ForecastPanel reflects `heatForecast`/`capturingForecast`
      // reactively as they arrive). Only fires when the whole-day heatmap
      // itself actually succeeded — an AOI whose base heatmap failed has no
      // useful forecast to chase either.
      if (heatmapRes.ok && "result" in heatmapRes.body) {
        get().captureFullForecast(geometry);
      }
    } catch (err) {
      if (requestId !== latestRequestId) return; // superseded — a stale failure shouldn't clobber a newer run either
      set({ status: "error", error: err instanceof Error ? err.message : "Analysis failed" });
    }
  },
  // Also bumps the ticket: reset() runs on every AOI redraw (AnalyzePanel's
  // useEffect keyed on geometry), so a still-pending analyzeAOI from the
  // PREVIOUS AOI is invalidated the moment a new one is drawn, before the
  // user even clicks Analyze again.
  reset: () => {
    latestRequestId++;
    latestForecastRequestId++;
    set({
      status: "idle",
      data: null,
      error: null,
      heatmapImageUrl: null,
      capturingForecast: false,
      heatForecast: {},
      selectedHourOffset: null,
      loadingHourOffset: null,
    });
  },
}));
