// TEMPORARY diagnostic route — reports whether the next FortyGuard call will
// spend credit, WITHOUT calling FortyGuard. Delete once the cached-mode
// question is settled.
//
// It imports isCachedMode() from lib/fortyguard.ts rather than re-implementing
// the comparison. An earlier version of this route duplicated the logic, and
// when the comparison in fortyguard.ts was changed the copy here kept
// reporting "cached" while live calls were going out — a diagnostic that lies
// is worse than no diagnostic at all.
import { NextResponse } from "next/server";
import { isCachedMode } from "@/lib/fortyguard";

export const dynamic = "force-dynamic";

export async function GET() {
  const cached = isCachedMode();
  return NextResponse.json({
    rawValue: process.env.FORTYGUARD_MODE ?? null,
    isCachedMode: cached,
    // One mode now governs both endpoints — no separate satellite gate.
    nextCallWill: cached
      ? "return synthetic data for /v1/heatmap AND /v1/satellite, spend NO credit"
      : "hit the live API for /v1/heatmap AND /v1/satellite, SPEND CREDIT",
    hasApiKey: Boolean(process.env.FORTYGUARD_API_KEY),
  });
}
