// §4.5 heat-aware routing — origin/destination picking + the two-phase
// fetch (see api/routing/route.ts and api/routing/analyze/route.ts).
// Mirrors analysisStore.ts's conventions: status unions, a "latest request
// wins" ticket guard so a superseded fetch can never clobber a newer pick.
import { create } from "zustand";
import { useDrawStore } from "./drawStore";
import type { RoutingResponse, ScoredRoute } from "@/lib/routing/types";

type PickingStage = "idle" | "picking_origin" | "picking_destination";
type AsyncStatus = "idle" | "loading" | "success" | "error";

// A point now carries a human-readable `name` alongside its coordinate —
// RoutePanel.tsx's From/To inputs display this, not the raw lng/lat, so a
// point picked by clicking the map needs one too (via reverse geocoding
// below), not just points picked via LocationAutocomplete search (which
// already had a name from the search result).
export type RoutePoint = {
  lngLat: [number, number];
  name: string;
};

function formatCoords(lngLat: [number, number]): string {
  return `${lngLat[1].toFixed(4)}, ${lngLat[0].toFixed(4)}`;
}

function sameLngLat(a: [number, number], b: [number, number]): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

// Reverse geocode via the existing /api/geocode?lat=&lon= proxy (already
// used by AnalyzePanel.tsx's "Site near <address>" auto-naming — same
// Nominatim /reverse call, not a second integration). Never throws/rejects:
// a failed lookup or an unnamed spot (ocean, empty desert) falls back to the
// coordinates themselves, so a map-clicked point is never left with no
// label at all.
async function reverseGeocodeName(lngLat: [number, number]): Promise<string> {
  try {
    const res = await fetch(`/api/geocode?lat=${lngLat[1]}&lon=${lngLat[0]}`);
    if (!res.ok) return formatCoords(lngLat);
    const data: { displayName?: string } = await res.json();
    return data.displayName && data.displayName.length > 0 ? data.displayName : formatCoords(lngLat);
  } catch {
    return formatCoords(lngLat);
  }
}

type RouteState = {
  pickingStage: PickingStage;
  origin: RoutePoint | null;
  destination: RoutePoint | null;

  phase1Status: AsyncStatus;
  phase1Error: string | null;
  routes: ScoredRoute[];
  disclosure: string | null;

  phase2Status: AsyncStatus;
  phase2Error: string | null;

  // Whether the map page's Analyze (AnalyzePanel) sidebar is shown while
  // Route mode is active — see app/map/page.tsx. Route mode auto-hides it
  // for map space (starts false on every fresh startPicking()), but the
  // user can reopen/close it freely afterward via AnalystPanelToggle; this
  // flag is meaningless once Route mode is fully inactive (page.tsx always
  // shows AnalyzePanel then, regardless of this value) and is independent
  // of uiStore's main-sidebar `sidebarOpen`.
  analystPanelOpen: boolean;

  startPicking: () => void;
  cancelPicking: () => void;
  clearRoute: () => void;
  handleMapClick: (lngLat: [number, number]) => void;
  // Sets origin/destination from location search (LocationAutocomplete.tsx, in RoutePanel.tsx) —
  // an alternative to handleMapClick, not a replacement for it. Both funnel
  // through these two so map-click and search can never disagree on when a
  // fetch fires or how pickingStage advances: whichever of the two sets a
  // point LAST wins for that point, and a fetch fires the moment both
  // origin and destination are non-null, regardless of which method set which.
  // Search already knows the point's name synchronously; handleMapClick
  // (below) is the caller that doesn't, and patches `name` in after an
  // async reverse-geocode instead.
  setOrigin: (point: RoutePoint) => void;
  setDestination: (point: RoutePoint) => void;
  fetchPhase1: () => Promise<void>;
  runPhase2: () => Promise<void>;
  toggleAnalystPanel: () => void;
};

let latestPhase1RequestId = 0;

export const useRouteStore = create<RouteState>((set, get) => ({
  pickingStage: "idle",
  origin: null,
  destination: null,

  phase1Status: "idle",
  phase1Error: null,
  routes: [],
  disclosure: null,

  phase2Status: "idle",
  phase2Error: null,

  analystPanelOpen: false,

  startPicking: () => {
    // Mutual exclusion with AOI drawing — the other direction lives in
    // DrawControl.tsx's startDrawing().
    const draw = useDrawStore.getState();
    if (draw.isDrawing && draw.terraDraw) {
      draw.terraDraw.setMode("static");
      draw.setIsDrawing(false);
    }
    latestPhase1RequestId++; // invalidate any in-flight fetch from a prior route
    set({
      pickingStage: "picking_origin",
      origin: null,
      destination: null,
      routes: [],
      disclosure: null,
      phase1Status: "idle",
      phase1Error: null,
      phase2Status: "idle",
      phase2Error: null,
      analystPanelOpen: false,
    });
  },

  cancelPicking: () => set({ pickingStage: "idle", origin: null, destination: null }),

  clearRoute: () => {
    latestPhase1RequestId++;
    set({
      pickingStage: "idle",
      origin: null,
      destination: null,
      routes: [],
      disclosure: null,
      phase1Status: "idle",
      phase1Error: null,
      phase2Status: "idle",
      phase2Error: null,
      analystPanelOpen: false,
    });
  },

  toggleAnalystPanel: () => set((state) => ({ analystPanelOpen: !state.analystPanelOpen })),

  handleMapClick: (lngLat) => {
    const { pickingStage } = get();
    if (pickingStage === "picking_origin") {
      get().setOrigin({ lngLat, name: formatCoords(lngLat) });
      void reverseGeocodeName(lngLat).then((name) => {
        const current = get().origin;
        if (current && sameLngLat(current.lngLat, lngLat)) set({ origin: { lngLat, name } });
      });
      return;
    }
    if (pickingStage === "picking_destination") {
      get().setDestination({ lngLat, name: formatCoords(lngLat) });
      void reverseGeocodeName(lngLat).then((name) => {
        const current = get().destination;
        if (current && sameLngLat(current.lngLat, lngLat)) set({ destination: { lngLat, name } });
      });
    }
  },

  setOrigin: (point) => {
    latestPhase1RequestId++; // invalidate any in-flight fetch tied to the previous origin
    const { destination } = get();
    set({ origin: point, pickingStage: destination ? "idle" : "picking_destination" });
    if (destination) void get().fetchPhase1();
  },

  setDestination: (point) => {
    latestPhase1RequestId++;
    const { origin } = get();
    set({ destination: point, pickingStage: origin ? "idle" : "picking_origin" });
    if (origin) void get().fetchPhase1();
  },

  fetchPhase1: async () => {
    const { origin, destination } = get();
    if (!origin || !destination) return;

    const requestId = ++latestPhase1RequestId;
    set({ phase1Status: "loading", phase1Error: null });

    try {
      const res = await fetch("/api/routing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: origin.lngLat, destination: destination.lngLat }),
      });
      const body: RoutingResponse = await res.json();
      if (requestId !== latestPhase1RequestId) return; // superseded by a newer pick

      if (body.status === "error") {
        set({ phase1Status: "error", phase1Error: body.message });
        return;
      }
      set({ phase1Status: "success", routes: body.routes, disclosure: body.disclosure });
    } catch (err) {
      if (requestId !== latestPhase1RequestId) return;
      set({ phase1Status: "error", phase1Error: err instanceof Error ? err.message : "Routing failed" });
    }
  },

  runPhase2: async () => {
    const { routes } = get();
    const targetBboxes = routes.flatMap((r) => r.coverage.uncoveredBboxes);
    if (targetBboxes.length === 0) return;

    set({ phase2Status: "loading", phase2Error: null });
    try {
      const res = await fetch("/api/routing/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routes, targetBboxes }),
      });
      const body: RoutingResponse = await res.json();

      if (body.status === "error") {
        set({ phase2Status: "error", phase2Error: body.message });
        return;
      }
      set({ phase2Status: "success", routes: body.routes, disclosure: body.disclosure });
    } catch (err) {
      set({ phase2Status: "error", phase2Error: err instanceof Error ? err.message : "Heat analysis failed" });
    }
  },
}));
