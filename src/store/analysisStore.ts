import { create } from "zustand";
import type { Polygon } from "geojson";
import type { HeatmapResult, SatelliteSegmentationResult } from "@/lib/fortyguard";
import type { OverpassLandCover } from "@/lib/overpass";
import { FORECAST_HOUR_OFFSETS } from "@/lib/mapConfig";

// `cached` marks results served by FortyGuard's cached/dev mode (see
// lib/fortyguard.ts) instead of a live, credit-consuming call — always
// `false`/absent for Overpass, which is free and never cached. `dateUsed`/
// `isFallbackDate` are heatmap-specific (lib/fortyguard.ts's
// runHeatmapWithDateFallback — see project.md §2/§4.4 for why a single
// yesterday-fallback exists) and stay undefined for satellite/overpass,
// which have no such fallback.
export type EndpointResult<T> =
  | { status: "ok"; result: T; cached?: boolean; dateUsed?: string; isFallbackDate?: boolean }
  | { status: "error"; message: string };

// Satellite tree-canopy segmentation is fetched as its own, separate,
// non-blocking request (2026-08-29 performance investigation — see
// api/satellite/segmentation/route.ts) fired alongside the main heatmap +
// landcover call rather than gating it. `data.satellite` therefore starts
// "pending" the moment `status` flips to "success" and resolves to ok/error
// independently afterward — unlike heatmap/overpass, which are only ever
// present once already settled. Nothing outside analysisStore ever
// constructs a "pending" value; AnalyzePanel's save-prompt effect waits for
// it to leave "pending" before opening, so app/api/sites/route.ts's
// buildSiteRecord() still only ever receives ok/error, exactly as before —
// zero changes needed to persistence, Operational Analyst, or the canopy
// recommendation/ROI pipeline that reads it.
export type SatelliteResult = EndpointResult<SatelliteSegmentationResult> | { status: "pending" };

type AnalysisData = {
  areaSqKm: number;
  centroid: { lat: number; lon: number };
  heatmap: EndpointResult<HeatmapResult>;
  satellite: SatelliteResult;
  overpass: EndpointResult<OverpassLandCover>;
};

// §4.4 — one fetched forecast slot. Kept separately from `data.heatmap`
// (the §4.3 whole-day analysis, filter_type 3) since a slot is a specific-hour
// query (filter_type 1). `targetTime` is the real date+time this slot is FOR
// (server-computed in app/api/heatmap/route.ts from the actual clock at
// request time) — not to be confused with `capturedAt`, which is just when
// the fetch happened to resolve.
export type ForecastSlot =
  | {
      status: "ok";
      result: HeatmapResult;
      cached?: boolean;
      meanTempC: number;
      targetTime: string;
      capturedAt: string;
      // See project.md §2/§4.4 — this slot's date_time.start_date shifted
      // back one day because "today" returned no usable data. Must always be
      // labeled as such, never shown as today's forecast.
      dateUsed: string;
      isFallbackDate: boolean;
    }
  | { status: "error"; message: string; capturedAt: string };

// Progress reporting for the Analyze run (UI feedback pass).
//
// Deliberately reports only what is REALLY known. FortyGuard is submit-then-
// poll: /v1/heatmap returns an activity_id and the entire tile set arrives at
// once when the activity reaches Completed. There is no per-tile stream to
// subscribe to, so a "122 of 122 tiles" bar would be an animation, not
// progress — the same fabrication this codebase refuses for measurements.
//
// What IS real: the two top-level requests resolve independently (they are
// already issued in parallel, but Promise.all below hid that from the UI until
// the slower one landed), and each of the five forecast slots is its own
// request. Seven genuinely observable completions, plus a real elapsed clock.
export type AnalysisTaskState = "pending" | "done" | "failed";

export type AnalysisProgress = {
  /** epoch ms when the current run started, or null when idle. Drives a real elapsed timer. */
  startedAt: number | null;
  /**
   * epoch ms once heatmap + landcover (the two requests Map View's main
   * result waits for) have settled, or null while still running/idle.
   * Drives the "Completed in Xm Ys · done H:MM" caption. Deliberately NOT
   * gated on satellite — see `satellite` below and the 2026-08-29
   * performance investigation: canopy is independent enrichment, tracked in
   * its own field, and must never delay this timestamp or the main result
   * it represents.
   */
  completedAt: number | null;
  /** FortyGuard /v1/heatmap, whole-day. */
  heatmap: AnalysisTaskState;
  /** /api/landcover — Overpass only (see api/landcover/route.ts's 2026-08-29 split). */
  landcover: AnalysisTaskState;
  /**
   * FortyGuard /v1/satellite tree-canopy segmentation, fetched as its own
   * request (api/satellite/segmentation/route.ts) fired alongside, never
   * gating, the two above. Surfaced separately so the UI can show real,
   * non-fabricated status for it ("Tree canopy: analyzing…" / "done" /
   * "unavailable this run") without implying it blocks anything.
   */
  satellite: AnalysisTaskState;
};

const IDLE_PROGRESS: AnalysisProgress = {
  startedAt: null,
  completedAt: null,
  heatmap: "pending",
  landcover: "pending",
  satellite: "pending",
};

export type PhaseProgress = { startedAt: number | null; completedAt: number | null };
const IDLE_PHASE: PhaseProgress = { startedAt: null, completedAt: null };

type AnalysisState = {
  status: "idle" | "analyzing" | "success" | "error";
  data: AnalysisData | null;
  error: string | null;
  // Set by HeatmapImage.tsx once it finishes rendering the AOI's heat canvas.
  // §4.7's "heat photo" reads this rather than regenerating — same bytes the
  // Surface heatmap card already shows, not a fresh render.
  heatmapImageUrl: string | null;
  setHeatmapImageUrl: (url: string | null) => void;
  /** Read-only from the UI's point of view — only analyzeAOI()/reset() write it. */
  progress: AnalysisProgress;
  /** Same idea as `progress`, scoped to captureFullForecast's +0..+12h window. */
  forecastProgress: PhaseProgress;
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
  captureFullForecast: (geometry: Polygon, daysBackHint?: number) => Promise<void>;
};

type HeatmapRouteBody =
  | {
      areaSqKm: number;
      cached: boolean;
      result: HeatmapResult;
      granularity: 60 | 80 | 100;
      targetTime: string;
      dateUsed: string;
      isFallbackDate: boolean;
      daysBack: number;
    }
  | { error: string };

type LandcoverRouteBody =
  | {
      areaSqKm: number;
      centroid: { lat: number; lon: number };
      overpass: EndpointResult<OverpassLandCover>;
    }
  | { error: string };

type SatelliteRouteBody = { fortyguard: EndpointResult<SatelliteSegmentationResult> } | { error: string };

// Never rejects. Found 2026-08-29: the satellite call below is fired as
// `void postJSON(...).then(...)` — not awaited inside analyzeAOI's own
// try/catch, so a rejection here (a network failure, or res.json() failing to
// parse) became a genuinely unhandled promise rejection that never reached
// the `.then()` at all. `data.satellite` then stayed `{status:"pending"}`
// forever, which the save-prompt gate (correctly) waits on indefinitely —
// that combination is exactly the "stuck on Analyzing tree canopy, can't
// save" symptom this fixes. Catching internally and always resolving with
// `{ok:false, body:{error}}` makes every caller's existing error handling
// (which already treats `ok:false` as a normal, expected outcome) cover this
// case too, for heatmap/landcover/forecast as well as satellite — none of
// them need their own try/catch added.
async function postJSON<TBody>(
  url: string,
  geometry: Polygon,
  hourOffset?: number,
  daysBackHint?: number
): Promise<{ ok: boolean; body: TBody }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geometry,
        ...(hourOffset === undefined ? {} : { hourOffset }),
        ...(daysBackHint === undefined ? {} : { daysBackHint }),
      }),
      // Defense in depth alongside the server-side fetch timeouts added the
      // same day (lib/fortyguard.ts): a browser fetch has no meaningful
      // default timeout of its own, so a hung client<->server connection
      // (as opposed to a hung FortyGuard call, which the server-side fix
      // already bounds) would otherwise wait indefinitely too. 120s is
      // generous against every route this calls, including satellite's own
      // worst-case bounded wait.
      signal: AbortSignal.timeout(120_000),
    });
    const body: TBody = await res.json();
    return { ok: res.ok, body };
  } catch (err) {
    console.error(`[postJSON] ${url} failed:`, err);
    return { ok: false, body: { error: err instanceof Error ? err.message : "Request failed" } as TBody };
  }
}

// Shared by selectForecastSlot (one user-clicked offset) and
// captureFullForecast (all 5 offsets at once, after Analyze succeeds) — both
// just need "fetch this one offset's slot", differing only in how many they
// call and what else they touch in the store around it.
async function fetchForecastSlot(
  geometry: Polygon,
  hourOffset: number,
  daysBackHint?: number
): Promise<ForecastSlot> {
  try {
    const res = await postJSON<HeatmapRouteBody>("/api/heatmap", geometry, hourOffset, daysBackHint);
    if (res.ok && "result" in res.body) {
      // app/api/heatmap/route.ts now guarantees a usable
      // stats_data.temperature_stats.mean (normalizing/computing it
      // server-side, or failing the request with a specific message instead
      // of returning a malformed one) — this is defense in depth, not the
      // primary fix, for the bug where an unguarded read here ("Cannot read
      // properties of undefined (reading 'mean')") was silently turning
      // every one of a live analysis's 5 forecast slots into that same
      // generic, unhelpful error message.
      const meanTempC = res.body.result.stats_data?.temperature_stats?.mean;
      if (typeof meanTempC !== "number") {
        return {
          status: "error",
          message: `FortyGuard returned no usable temperature data for the +${hourOffset}h slot.`,
          capturedAt: new Date().toISOString(),
        };
      }
      return {
        status: "ok",
        result: res.body.result,
        cached: res.body.cached,
        meanTempC,
        // Route always returns this for a slot request; the `?? new Date()`
        // fallback only guards a malformed/old response shape, not a real
        // "unknown time" case — it should never actually fire.
        targetTime: res.body.targetTime ?? new Date().toISOString(),
        capturedAt: new Date().toISOString(),
        dateUsed: res.body.dateUsed,
        isFallbackDate: res.body.isFallbackDate,
      };
    }
    return {
      status: "error",
      message: ("error" in res.body && res.body.error) || `FortyGuard forecast fetch failed for +${hourOffset}h.`,
      capturedAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? `${err.message} (+${hourOffset}h slot)` : `Forecast fetch failed for +${hourOffset}h.`,
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
  progress: IDLE_PROGRESS,
  forecastProgress: IDLE_PHASE,
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
  captureFullForecast: async (geometry, daysBackHint) => {
    const forecastStartedAt = performance.now();
    console.log("[captureFullForecast] START — 5 slots requested in parallel");
    const requestId = ++latestForecastRequestId;
    set({ capturingForecast: true, forecastProgress: { startedAt: Date.now(), completedAt: null } });

    // Each slot is committed to the store the moment IT resolves, not batched
    // until all five have. The five requests already ran in parallel, but a
    // single set() after Promise.all meant nothing appeared for 20-30s and then
    // everything did at once — which read as "no feedback, then a sudden jump"
    // and left the progress bar below stuck at 0/5 for the whole window.
    // Same latest-wins ticket as before: a superseded run drops its slot rather
    // than writing over a newer capture.
    await Promise.all(
      FORECAST_HOUR_OFFSETS.map(async (hourOffset) => {
        const slotStartedAt = performance.now();
        const slot = await fetchForecastSlot(geometry, hourOffset, daysBackHint);
        console.log(
          `[captureFullForecast] +${hourOffset}h settled (${slot.status}) — ${((performance.now() - slotStartedAt) / 1000).toFixed(1)}s`,
        );
        if (requestId !== latestForecastRequestId) return;
        set((state) => ({ heatForecast: { ...state.heatForecast, [hourOffset]: slot } }));
      })
    );
    console.log(
      `[captureFullForecast] all 5 slots settled — ${((performance.now() - forecastStartedAt) / 1000).toFixed(1)}s total`,
    );
    if (requestId === latestForecastRequestId) {
      set((state) => ({ forecastProgress: { ...state.forecastProgress, completedAt: Date.now() } }));
    }

    if (requestId !== latestForecastRequestId) {
      // Superseded by a redraw or a fresh analysis — that newer call (or
      // reset()) owns `capturingForecast` now, so don't touch it here.
      return;
    }

    set({ capturingForecast: false });
  },
  analyzeAOI: async (geometry) => {
    const analyzeStartedAt = performance.now();
    console.log("[analyzeAOI] START");
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
      progress: { startedAt: Date.now(), completedAt: null, heatmap: "pending", landcover: "pending", satellite: "pending" },
      forecastProgress: IDLE_PHASE,
    });
    try {
      // Records one task's real completion the moment it lands. Guarded by the
      // same requestId ticket the result handling below uses, so a superseded
      // run can never write progress over a newer one.
      const markTask = (task: "heatmap" | "landcover" | "satellite", ok: boolean) => {
        if (requestId !== latestRequestId) return;
        set((state) => ({ progress: { ...state.progress, [task]: ok ? "done" : "failed" } }));
      };

      // Tree-canopy segmentation (2026-08-29 performance investigation) is
      // fired here, immediately, alongside heatmap/landcover — but its
      // promise is deliberately NOT part of the Promise.all below. It is
      // genuinely independent enrichment (a centroid land-cover sample,
      // unrelated to the AOI-wide temperature tiles or the Overpass
      // footprint), and four to five live probes tonight found FortyGuard's
      // /v1/satellite taking 174-181s before answering "Failed" during a
      // service-side degradation — bundling it into the main gate meant
      // Map View's heat display could not appear until that whole wait was
      // over, every single time, regardless of how fast heatmap/landcover
      // themselves were. It resolves into `data.satellite` whenever it
      // lands, via the `.then()` below, without blocking anything above it.
      void postJSON<SatelliteRouteBody>("/api/satellite/segmentation", geometry).then((res) => {
        markTask("satellite", res.ok);
        if (requestId !== latestRequestId) return; // superseded — a stale result must not land on a newer run's data
        const satellite: SatelliteResult =
          res.ok && "fortyguard" in res.body
            ? res.body.fortyguard
            : { status: "error", message: ("error" in res.body && res.body.error) || "Tree-canopy segmentation failed." };
        // A no-op if analyzeAOI ultimately failed and never set `data` at
        // all (state.data stays null) — nothing to attach this to in that
        // case, matching how forecast slots already behave on a failed run.
        set((state) => (state.data ? { data: { ...state.data, satellite } } : state));
      });

      // /v1/heatmap and Overpass are submitted in parallel — these two are
      // what Map View's main result waits for.
      //
      // The .then() hooks only report progress — they return the response
      // untouched, so Promise.all and every consumer below behave exactly as
      // before. A rejected fetch skips its hook and still rejects Promise.all,
      // landing in the same catch as always.
      const [heatmapRes, landcoverRes] = await Promise.all([
        postJSON<HeatmapRouteBody>("/api/heatmap", geometry).then((res) => {
          markTask("heatmap", res.ok);
          return res;
        }),
        postJSON<LandcoverRouteBody>("/api/landcover", geometry).then((res) => {
          markTask("landcover", res.ok);
          return res;
        }),
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
              ? {
                  status: "ok",
                  result: heatmapRes.body.result,
                  cached: heatmapRes.body.cached,
                  dateUsed: heatmapRes.body.dateUsed,
                  isFallbackDate: heatmapRes.body.isFallbackDate,
                }
              : {
                  status: "error",
                  message: ("error" in heatmapRes.body && heatmapRes.body.error) || "Heatmap generation failed",
                },
          // Fired separately above and not part of this Promise.all — this
          // is its initial state the instant Map View shows the main
          // result; the satellitePromise .then() updates it in place once
          // /v1/satellite actually settles, independent of everything here.
          satellite: { status: "pending" } satisfies SatelliteResult,
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
      // reactively as they arrive). Runs independently of whether the main
      // whole-day heatmap succeeded (project.md §2/§4.4 investigation) — a
      // whole-day request can fail for a reason that has nothing to do with
      // forecast (e.g. FortyGuard has no same-day data yet, even after this
      // app's own one-step yesterday retry), and each forecast slot already
      // fails independently and explicitly via its own retry rather than
      // fabricating data — so there is no reason to skip trying it just
      // because the unrelated whole-day call failed.
      //
      // When the whole-day call DID succeed, its `daysBack` is passed along
      // so each slot starts its own search at the offset already proven to
      // hold data for this AOI seconds ago, instead of re-probing (and
      // re-paying for) the same empty dates five more times. Omitted when the
      // whole-day call failed — then each slot searches from scratch.
      console.log(
        `[analyzeAOI] main results COMPLETE — ${((performance.now() - analyzeStartedAt) / 1000).toFixed(1)}s ` +
          `(forecast capture continues in the background, see [captureFullForecast] logs)`,
      );
      set((state) => ({ progress: { ...state.progress, completedAt: Date.now() } }));
      get().captureFullForecast(
        geometry,
        heatmapRes.ok && "daysBack" in heatmapRes.body ? heatmapRes.body.daysBack : undefined
      );
    } catch (err) {
      if (requestId !== latestRequestId) return; // superseded — a stale failure shouldn't clobber a newer run either
      console.log(
        `[analyzeAOI] FAILED — ${((performance.now() - analyzeStartedAt) / 1000).toFixed(1)}s — ` +
          (err instanceof Error ? err.message : String(err)),
      );
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
      progress: IDLE_PROGRESS,
      forecastProgress: IDLE_PHASE,
    });
  },
}));
