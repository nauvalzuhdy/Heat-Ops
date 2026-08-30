// §4.5 — thin client for OSRM's public routing server. Server-only (called
// only from src/app/api/routing/route.ts), same convention as
// lib/overpass.ts/lib/fortyguard.ts: an external API never called directly
// from the browser, so retries/timeouts/error-shaping live in one place.
import "server-only";
import type { LineString } from "geojson";
import type { OSRMAlternative } from "./types";

const OSRM_BASE_URL = "https://router.project-osrm.org";
// OSRM's public demo server is usually fast; this only guards against a
// genuinely hung connection, not slow-but-alive responses — no retry loop
// here (unlike Overpass's mirror list), this is a free public demo endpoint
// with no credit cost, a single attempt is enough at this project's scope.
const OSRM_FETCH_TIMEOUT_MS = 15_000;

type OSRMRouteResponse = {
  code: string;
  message?: string;
  routes?: {
    geometry: LineString;
    distance: number;
    duration: number;
  }[];
};

export type OSRMFetchResult = { ok: true; alternatives: OSRMAlternative[] } | { ok: false; message: string };

export async function fetchOSRMAlternatives(
  origin: [number, number],
  destination: [number, number]
): Promise<OSRMFetchResult> {
  const [olng, olat] = origin;
  const [dlng, dlat] = destination;
  const url =
    `${OSRM_BASE_URL}/route/v1/driving/${olng},${olat};${dlng},${dlat}` +
    `?alternatives=true&geometries=geojson&overview=full`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(OSRM_FETCH_TIMEOUT_MS) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `OSRM request failed: ${message}` };
  }

  if (!res.ok) {
    return { ok: false, message: `OSRM request failed: HTTP ${res.status}` };
  }

  let body: OSRMRouteResponse;
  try {
    body = await res.json();
  } catch {
    return { ok: false, message: "OSRM returned a non-JSON response" };
  }

  if (body.code !== "Ok" || !body.routes || body.routes.length === 0) {
    return { ok: false, message: body.message ?? `OSRM returned no route (code: ${body.code})` };
  }

  // OSRM's public server typically returns 2-3 alternatives, never
  // guaranteed 3 — mapped 1:1 here, never sliced/padded to force a count.
  const alternatives: OSRMAlternative[] = body.routes.map((r, index) => ({
    index,
    geometry: r.geometry,
    distanceM: r.distance,
    durationS: r.duration,
  }));

  return { ok: true, alternatives };
}
