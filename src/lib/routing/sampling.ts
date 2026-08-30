// §4.5 — samples points along a route line at a fixed interval, for the
// heat-exposure scoring pipeline to look up a temperature at each one.
import * as turf from "@turf/turf";
import type { LineString } from "geojson";
import { ROUTE_SAMPLE_INTERVAL_M } from "@/lib/mapConfig";

export type RouteSamplePoint = { lng: number; lat: number; distanceAlongM: number };

export function sampleRouteLine(
  geometry: LineString,
  intervalM: number = ROUTE_SAMPLE_INTERVAL_M
): RouteSamplePoint[] {
  const line = turf.lineString(geometry.coordinates);
  const lengthKm = turf.length(line, { units: "kilometers" });

  // Degenerate/zero-length line (e.g. origin === destination) — one sample
  // at the start point rather than a zero-iteration or infinite loop.
  if (!Number.isFinite(lengthKm) || lengthKm <= 0) {
    const [lng, lat] = geometry.coordinates[0];
    return [{ lng, lat, distanceAlongM: 0 }];
  }

  const intervalKm = intervalM / 1000;
  const points: RouteSamplePoint[] = [];
  for (let dKm = 0; dKm < lengthKm; dKm += intervalKm) {
    const pt = turf.along(line, dKm, { units: "kilometers" });
    const [lng, lat] = pt.geometry.coordinates;
    points.push({ lng, lat, distanceAlongM: dKm * 1000 });
  }

  // Always include the exact final endpoint — the loop above stops strictly
  // before lengthKm, so the last partial interval would otherwise never be
  // sampled.
  const lastCoord = geometry.coordinates[geometry.coordinates.length - 1];
  points.push({ lng: lastCoord[0], lat: lastCoord[1], distanceAlongM: lengthKm * 1000 });

  return points;
}
