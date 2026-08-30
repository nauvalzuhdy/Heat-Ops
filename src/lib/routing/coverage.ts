// §4.5 Phase 1 — reuses heat_tiles from already-analyzed sites to score a
// route, entirely without any FortyGuard call. Server-only: touches Supabase
// directly, same convention as lib/reportData.ts.
import "server-only";
import * as turf from "@turf/turf";
import type { Feature, LineString, Polygon } from "geojson";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import { ROUTE_UNCOVERED_TILE_MAX_DISTANCE_M } from "@/lib/mapConfig";
import type { HeatTileRecord } from "@/lib/siteRecord";

export type CoverageSite = { id: string; aoiGeometry: Polygon; heatTiles: HeatTileRecord[] };
export type CoverageTilePool = { id: string; heatTiles: HeatTileRecord[] };

// Bounded batch, same rationale as copilotTools.ts's ALL_SITES_QUERY_LIMIT —
// but that existing query deliberately excludes aoi_geometry/heat_tiles (too
// heavy for its own cross-site summary use case), so this is a separate,
// purpose-built query, not a reuse of that one.
const ROUTE_COVERAGE_SITES_QUERY_LIMIT = 100;

export async function fetchSitesForRouteCoverage(): Promise<CoverageSite[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("sites")
    .select("id, aoi_geometry, heat_tiles")
    .order("created_at", { ascending: false })
    .limit(ROUTE_COVERAGE_SITES_QUERY_LIMIT);

  if (error || !data) return [];
  return (data as { id: string; aoi_geometry: Polygon | null; heat_tiles: HeatTileRecord[] | null }[])
    .filter((row): row is { id: string; aoi_geometry: Polygon; heat_tiles: HeatTileRecord[] } => row.aoi_geometry != null)
    .map((row) => ({ id: row.id, aoiGeometry: row.aoi_geometry, heatTiles: row.heat_tiles ?? [] }));
}

export function findOverlappingSites(routeLine: Feature<LineString>, sites: CoverageSite[]): CoverageTilePool[] {
  return sites
    .filter((site) => {
      try {
        return turf.booleanIntersects(routeLine, turf.feature(site.aoiGeometry));
      } catch {
        // Malformed AOI geometry — skip rather than fail the whole route.
        return false;
      }
    })
    .map((site) => ({ id: site.id, heatTiles: site.heatTiles }));
}

export function nearestTileTemp(
  point: { lng: number; lat: number },
  pool: CoverageTilePool[],
  maxDistanceM: number = ROUTE_UNCOVERED_TILE_MAX_DISTANCE_M
): { tempC: number; sourceSiteId: string } | null {
  // Pass 1: a tile whose own real footprint (bounds) contains the point is
  // authoritative — no distance ambiguity at all.
  for (const site of pool) {
    for (const tile of site.heatTiles) {
      if (!tile.bounds) continue;
      const [west, south, east, north] = tile.bounds;
      if (point.lng >= west && point.lng <= east && point.lat >= south && point.lat <= north) {
        return { tempC: tile.tempC, sourceSiteId: site.id };
      }
    }
  }

  // Pass 2: nearest tile centroid (covers older sites with no `bounds`, and
  // any point that fell between tile footprints) — only within the
  // threshold; beyond it, this point is genuinely uncovered, not guessed.
  let best: { tempC: number; sourceSiteId: string; distanceKm: number } | null = null;
  for (const site of pool) {
    for (const tile of site.heatTiles) {
      const distanceKm = turf.distance([point.lng, point.lat], [tile.lng, tile.lat], { units: "kilometers" });
      if (!best || distanceKm < best.distanceKm) {
        best = { tempC: tile.tempC, sourceSiteId: site.id, distanceKm };
      }
    }
  }

  if (best && best.distanceKm * 1000 <= maxDistanceM) {
    return { tempC: best.tempC, sourceSiteId: best.sourceSiteId };
  }
  return null;
}
