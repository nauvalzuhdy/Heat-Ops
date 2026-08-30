// §4.5 heat-aware routing — shared types across the OSRM client, the
// coverage/scoring pipeline, both API routes, the store, and the UI. No
// server-only marker: this file is pure types (plus one pure string
// constant), safe to import from client code (routeStore.ts, RoutePanel.tsx)
// as well as the server-only lib modules and API routes.
import type { LineString } from "geojson";

export type OSRMAlternative = {
  /** Position in OSRM's own `routes[]` array — 0..N-1, N is 1-3, never padded/forced to 3. */
  index: number;
  geometry: LineString;
  distanceM: number;
  durationS: number;
};

export type SamplePointCoverage =
  | { status: "covered"; tempC: number; sourceSiteId: string }
  | { status: "uncovered" };

export type SampledPoint = {
  lng: number;
  lat: number;
  distanceAlongM: number;
  coverage: SamplePointCoverage;
};

export type RouteCoverage = {
  coveredCount: number;
  totalCount: number;
  /** true only when totalCount > 0 and every sample is covered. */
  fullyCovered: boolean;
  /** Bboxes of contiguous uncovered stretches (buffered) — Phase 2 submits FortyGuard requests against these. */
  uncoveredBboxes: [number, number, number, number][];
};

export type ScoredRoute = {
  alt: OSRMAlternative;
  samples: SampledPoint[];
  coverage: RouteCoverage;
  /** Avg tempC across COVERED samples only. null when zero samples are covered — never a fabricated number. */
  heatExposureScore: number | null;
  /** = alt.durationS, raw seconds — always present, OSRM always returns a duration. */
  timeScore: number;
  /** Normalized 0-1 combination of heat+time. null whenever heatExposureScore is null (can't be scored). */
  efficiencyScore: number | null;
  /** "Fastest"/"Coolest"/"Efficient" — 0 to 3 entries; 2+ means a combined badge, never a fabricated extra route. */
  labels: string[];
};

export type RoutingResponse =
  | { status: "ok"; routes: ScoredRoute[]; disclosure: string }
  | { status: "error"; message: string };

// §spec point 7 — the exact required disclosure sentence, defined once here
// so the UI (RoutePanel.tsx) and the API routes that generate it can never
// drift apart on the wording.
export const ROUTE_DISCLOSURE_TEXT =
  "Routes are ranked from available alternatives, not independently optimized for heat — " +
  "based on standard routing alternatives from OSRM.";
