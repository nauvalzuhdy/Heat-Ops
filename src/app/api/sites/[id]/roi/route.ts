// ROI Simulator per-site input persistence (project.md §5.1: "Semua input
// user tersimpan per-site... bisa diubah ulang"). Deliberately its own tiny
// route rather than folded into the existing name-only PATCH
// (app/api/sites/[id]/route.ts) or the heat_forecast bulk PATCH
// (app/api/sites/route.ts) — this reads/writes the `roi_inputs` jsonb column
// on `sites`.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import type { ROIInputs } from "@/lib/roiSimulator";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("sites").select("roi_inputs").eq("id", params.id).maybeSingle();

  if (error) {
    // Treated the same as "nothing saved yet" rather than failing the panel.
    console.error("[sites/roi] load failed:", error.message);
    return NextResponse.json({ roiInputs: null });
  }

  return NextResponse.json({ roiInputs: (data?.roi_inputs as ROIInputs | null) ?? null });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let body: { roiInputs: ROIInputs };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.roiInputs || typeof body.roiInputs !== "object") {
    return NextResponse.json({ error: "Missing or invalid 'roiInputs'" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("sites").update({ roi_inputs: body.roiInputs }).eq("id", params.id);

  if (error) {
    console.error("[sites/roi] save failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
