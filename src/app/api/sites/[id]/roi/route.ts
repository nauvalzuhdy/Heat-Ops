// ROI Simulator per-site input persistence (project.md §5.1: "Semua input
// user tersimpan per-site... bisa diubah ulang"). Deliberately its own tiny
// route rather than folded into the existing name-only PATCH
// (app/api/sites/[id]/route.ts) or the heat_forecast bulk PATCH
// (app/api/sites/route.ts) — this reads/writes a `roi_inputs` jsonb column
// that doesn't exist on `sites` until a one-time migration runs (no DB
// migration tooling was available to run it directly — see development.md).
// Both handlers below degrade gracefully if that column is missing, so the
// ROI Simulator tab still works interactively (just without persistence)
// before the migration runs, rather than the whole tab erroring out.
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import type { ROIInputs } from "@/lib/roiSimulator";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("sites").select("roi_inputs").eq("id", params.id).maybeSingle();

  if (error) {
    // Most likely cause pre-migration: 42703 undefined_column. Treated the
    // same as "nothing saved yet" rather than failing the panel — the
    // migration's absence shouldn't block using the calculator.
    console.error("[sites/roi] load failed (has the roi_inputs column been added yet?):", error.message);
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
    console.error("[sites/roi] save failed (has the roi_inputs column been added yet?):", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
