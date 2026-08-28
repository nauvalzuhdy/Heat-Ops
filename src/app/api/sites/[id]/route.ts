// Feature 2 — per-site rename (name only, per spec) and delete from the
// /analyst list. Separate from the bulk PATCH in app/api/sites/route.ts,
// which is dedicated to §4.4's heat_forecast accumulation and keyed
// differently (body.siteId rather than a path param).
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabaseServer";
import type { HeatForecastEntry } from "@/lib/siteRecord";

// Read-only, Supabase-only (no FortyGuard call) — lets Map View's
// ForecastPanel show this site's most recent STORED forecast entry as
// historical supporting context when every slot in the current Analyze run
// fails (project.md §4.4's "Latest available forecast data" fallback).
// Map View otherwise has no way to read a site's already-saved data mid
// session (only Operational Analyst fetches full rows).
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("sites").select("heat_forecast").eq("id", params.id).maybeSingle();

  if (error) {
    console.error("[sites] heat_forecast load failed:", error.message);
    return NextResponse.json({ heatForecast: null });
  }

  return NextResponse.json({ heatForecast: (data?.heat_forecast as HeatForecastEntry[] | null) ?? null });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  let body: { name: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.name !== "string" && body.name !== null) {
    return NextResponse.json({ error: "Missing or invalid 'name'" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("sites").update({ name: body.name }).eq("id", params.id);

  if (error) {
    console.error("[sites] rename failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// Row delete only — the satellite/segmentation/heat photos already uploaded
// to Storage for this site are not cleaned up, matching this feature's scope
// (removing the `sites` row from the list), not a full storage GC pass.
export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase.from("sites").delete().eq("id", params.id);

  if (error) {
    console.error("[sites] delete failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
