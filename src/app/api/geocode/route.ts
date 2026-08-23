import { NextRequest, NextResponse } from "next/server";

// Nominatim usage policy requires a descriptive User-Agent identifying the
// app — anonymous/browser-default requests get rate-limited or blocked, so
// this route proxies server-side instead of calling Nominatim from the client.
const NOMINATIM_USER_AGENT = "HeatOps/1.0 (FortyGuard Hackathon 2026)";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
  boundingbox: [string, string, string, string];
};

export async function GET(request: NextRequest) {
  const lat = request.nextUrl.searchParams.get("lat");
  const lon = request.nextUrl.searchParams.get("lon");

  // Feature 1 (site naming) — reverse geocode a centroid into a short address
  // for the "Site near <address>" auto-generated name fallback.
  if (lat && lon) {
    return handleReverse(lat, lon);
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();

  if (!q) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": NOMINATIM_USER_AGENT },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Nominatim request failed" }, { status: 502 });
    }

    const results: NominatimResult[] = await res.json();

    return NextResponse.json(
      results.map((r) => ({
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        displayName: r.display_name,
        boundingBox: r.boundingbox.map(Number) as [number, number, number, number],
      }))
    );
  } catch {
    return NextResponse.json({ error: "Failed to reach Nominatim" }, { status: 502 });
  }
}

async function handleReverse(lat: string, lon: string) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("format", "json");

  try {
    const res = await fetch(url, { headers: { "User-Agent": NOMINATIM_USER_AGENT } });

    if (!res.ok) {
      return NextResponse.json({ error: "Nominatim reverse request failed" }, { status: 502 });
    }

    const result: { display_name?: string } = await res.json();
    if (!result.display_name) {
      return NextResponse.json({ error: "No address found for this location" }, { status: 404 });
    }

    // display_name is a long comma-separated chain (house number -> country).
    // The first couple of segments read like a place name; the rest is noise
    // for a "Site near <address>" label.
    const shortAddress = result.display_name
      .split(",")
      .slice(0, 2)
      .map((s) => s.trim())
      .join(", ");

    return NextResponse.json({ displayName: shortAddress });
  } catch {
    return NextResponse.json({ error: "Failed to reach Nominatim" }, { status: 502 });
  }
}
