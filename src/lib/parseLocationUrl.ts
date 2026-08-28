// §4.1 "paste a map link" — extracts a lat/lng from a pasted Google Maps or
// OpenStreetMap URL, no server round-trip needed for the two known long-URL
// patterns. Short links (maps.app.goo.gl, goo.gl/maps) hide the coordinates
// behind a redirect and can't be parsed directly — see isShortMapLink()
// below and api/resolve-map-url/route.ts, which follows the redirect
// server-side and re-runs this same parser on the final URL.
export type ParsedLocation = { lat: number; lng: number };

// Google Maps: .../@{lat},{lng},{zoom}z — appears in both short-form URLs
// (google.com/maps/@33.4484,-112.074,15z) and place URLs
// (google.com/maps/place/Some+Place/@33.4484,-112.074,15z/data=...).
const GOOGLE_MAPS_AT_PATTERN = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),\d+(?:\.\d+)?z/;

// OpenStreetMap: #map={zoom}/{lat}/{lng}
const OSM_HASH_PATTERN = /#map=\d+(?:\.\d+)?\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/;

function toFiniteCoords(latStr: string, lngStr: string): ParsedLocation | null {
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Tries both known long-URL patterns. Returns null if neither matches —
// callers decide from there whether it's worth resolving as a short link
// (isShortMapLink) or just showing the "couldn't read a location" error.
export function parseLocationUrl(url: string): ParsedLocation | null {
  const googleMatch = url.match(GOOGLE_MAPS_AT_PATTERN);
  if (googleMatch) {
    const parsed = toFiniteCoords(googleMatch[1], googleMatch[2]);
    if (parsed) return parsed;
  }

  const osmMatch = url.match(OSM_HASH_PATTERN);
  if (osmMatch) {
    const parsed = toFiniteCoords(osmMatch[1], osmMatch[2]);
    if (parsed) return parsed;
  }

  return null;
}

// Google's shortened share-link hosts. Deliberately an allowlist, not a
// generic "any URL with a redirect" check — api/resolve-map-url/route.ts
// fetches whatever host is passed to it server-side, so only forwarding
// requests for hosts we actually expect keeps that route from becoming an
// open URL-fetching proxy for arbitrary user-supplied hosts.
const SHORT_LINK_HOSTS = ["maps.app.goo.gl", "goo.gl"];

export function isShortMapLink(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return SHORT_LINK_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}
