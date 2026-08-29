// Download PDF report (project.md §5, P1 Sub-task 6). Compiles chart data +
// the deterministic Heat Mitigation headline + an AI Copilot-generated
// narrative into one PDF — same data-assembly path as the AI Copilot's
// `generate_report` tool (lib/reportData.ts), so the two never disagree on
// what "the report" contains. Runs in the Node.js runtime (the default for
// Route Handlers) — @react-pdf/renderer needs Node APIs, not Edge.
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { buildReportData, generateReportNarrative } from "@/lib/reportData";
import SiteReportDocument from "@/lib/pdf/SiteReportDocument";
// Route Handlers are cached by default unless marked dynamic. This one
// reads live Supabase data with no cache-busting dynamic API of its own
// (no cookies()/headers()/searchParams), so without this it could silently
// serve a stale response after a refresh — the exact bug class the
// site-wide refresh feature exists to prevent. Matches app/analyst/page.tsx
// and app/copilot/page.tsx, which already do this for the same reason.
export const dynamic = "force-dynamic";


// Fetches the site's already-saved satellite photo from Supabase Storage —
// the same asset Operational Analyst's Hotspot Detection columns render via
// a plain <img src>, just read into a Buffer here since react-pdf's <Image>
// needs one (or a URL it fetches itself; pre-fetching once lets both PDF
// image sections below share the same bytes instead of two separate
// requests). NOT a FortyGuard/Overpass/Esri call — that photo was captured
// once at Map View analyze-time and never regenerated here. Failure (missing
// URL, 404, network hiccup) degrades gracefully: the PDF still generates,
// just without the two image sections, same pattern as the narrative's own
// fallback below.
async function fetchSatellitePhotoBuffer(url: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[report] satellite photo fetch failed:", err);
    return null;
  }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const data = await buildReportData(params.id);
  if ("error" in data) {
    return NextResponse.json({ error: data.error }, { status: 404 });
  }

  const [narrative, satellitePhotoBuffer] = await Promise.all([
    generateReportNarrative(data),
    fetchSatellitePhotoBuffer(data.site.satellitePhotoUrl),
  ]);
  const generatedAt = new Date().toISOString();

  const buffer = await renderToBuffer(
    SiteReportDocument({ data, narrative, generatedAt, satellitePhotoBuffer })
  );

  const filenameSafeName = (data.site.name ?? `site-${data.site.id.slice(0, 8)}`)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="heatops-report-${filenameSafeName || data.site.id}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
