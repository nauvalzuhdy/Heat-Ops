import { NextRequest, NextResponse } from "next/server";
import type { Polygon } from "geojson";
import { fetchSatelliteExportImage } from "@/lib/arcgisSatellite";

// Exposes lib/arcgisSatellite.ts's ArcGIS Export Image fetch (already used
// server-side for §4.7's saved "satellite photo") to the client during the
// live Map View analyze flow — needed for §4.6's Photo-realistic Massing
// mode, which samples this same flat, known-bbox image per building
// footprint (lib/photorealisticMassing.ts). Public Esri endpoint, no key,
// no credit — unrelated to FortyGuard's cached/live gate.
export async function POST(request: NextRequest) {
  let geometry: Polygon;
  try {
    const body = await request.json();
    geometry = body.geometry;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!geometry || geometry.type !== "Polygon") {
    return NextResponse.json({ error: "Missing or invalid 'geometry' (expected a GeoJSON Polygon)" }, { status: 400 });
  }

  try {
    const buffer = await fetchSatelliteExportImage(geometry);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Satellite export image fetch failed" },
      { status: 502 }
    );
  }
}
