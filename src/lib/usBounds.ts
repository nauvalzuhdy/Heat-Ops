// Single source of truth for the "US-only" constraint (project.md §2 —
// FortyGuard coverage is US-only; demo AOIs must be in a US city like
// Phoenix/Houston/Miami/New York/San Jose). Before this file, NOTHING in
// the codebase actually enforced this — not SearchBox, not /api/geocode,
// not AnalyzePanel. Now used by both regular search (SearchBox.tsx) and
// the "paste a map link" feature, so the two paths can't drift apart.
//
// Continental US (CONUS) bounding box — matches the project's demo cities,
// all in the contiguous 48 states. Alaska/Hawaii/territories are the US too
// but outside what project.md's demo coverage actually exercises, so
// deliberately excluded rather than guessed at.
export const CONUS_BOUNDS = {
  west: -125.0,
  south: 24.5,
  east: -66.9,
  north: 49.5,
};

export function isInUS(lat: number, lon: number): boolean {
  return (
    lat >= CONUS_BOUNDS.south &&
    lat <= CONUS_BOUNDS.north &&
    lon >= CONUS_BOUNDS.west &&
    lon <= CONUS_BOUNDS.east
  );
}

export const US_ONLY_MESSAGE =
  "This location is outside FortyGuard's coverage area (continental US only). Try a US city instead.";
