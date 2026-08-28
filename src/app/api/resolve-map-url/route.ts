import { NextRequest, NextResponse } from "next/server";
import { parseLocationUrl, isShortMapLink } from "@/lib/parseLocationUrl";

// §4.1 "paste a map link" — short Google Maps links (maps.app.goo.gl,
// goo.gl/maps) hide their coordinates behind a redirect the client can't
// follow itself (CORS), so this resolves it server-side and re-runs the
// same regex parser lib/parseLocationUrl.ts uses for long URLs against the
// final landing URL.
export async function POST(request: NextRequest) {
  let url: unknown;
  try {
    const body = await request.json();
    url = body.url;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "Missing 'url'" }, { status: 400 });
  }

  // Only ever fetch known Google short-link hosts — an arbitrary
  // user-supplied URL here would make this route an open server-side
  // fetch proxy (SSRF), not just a maps-link resolver.
  if (!isShortMapLink(url)) {
    return NextResponse.json({ error: "Not a recognized short map link host" }, { status: 400 });
  }

  try {
    const res = await fetch(url, { redirect: "follow" });
    const finalUrl = res.url;
    const parsed = parseLocationUrl(finalUrl);

    if (!parsed) {
      return NextResponse.json(
        { error: "Couldn't find coordinates in the resolved link" },
        { status: 422 }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve the link" },
      { status: 502 }
    );
  }
}
