"use client";

// §4.5 — route summary sidebar: legend, per-route cards (distance/duration/
// avg temp/labels), the required disclosure text, and the Phase 2
// "Analyze heat for uncovered routes" button. Styled like RoiResultMiniCard's
// bordered/rounded Tailwind card convention, light/dark aware. Only occupies
// screen space once the Route tool is actually in use — unlike AnalyzePanel,
// it renders null when there's nothing to show.
import { useRouteStore } from "@/store/routeStore";
import { useMapStore } from "@/store/mapStore";
import { ROUTE_COLORS_RGBA } from "@/lib/mapConfig";
import type { ScoredRoute } from "@/lib/routing/types";
import LocationAutocomplete, { type LocationSuggestion } from "./LocationAutocomplete";

// Builds the same concise "name, city, state" shape the dropdown itself
// already shows in two lines (LocationAutocomplete's suggestion item),
// collapsed to one string — avoids the raw full-country-and-postcode
// `displayName` chain, and keeps a search-picked point's label in the same
// ballpark length as a map-clicked point's reverse-geocoded label.
function suggestionToPointName(s: LocationSuggestion): string {
  const primary = s.displayName.split(",")[0].trim();
  const shortPrimary = s.shortAddress.split(",")[0].trim();
  return primary === shortPrimary ? s.shortAddress : `${primary}, ${s.shortAddress}`;
}

function rgba([r, g, b, a]: [number, number, number, number], alpha?: number): string {
  return `rgba(${r}, ${g}, ${b}, ${alpha ?? a / 255})`;
}

function formatKm(distanceM: number): string {
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function formatMinutes(durationS: number): string {
  return `${Math.round(durationS / 60)} min`;
}

function formatTemp(tempC: number | null): string {
  return tempC == null ? "Heat data unavailable" : `${tempC.toFixed(1)}°C`;
}

// Efficiency-score breakdown popover — same <details>/<summary> mechanism
// RoiPanel.tsx ("Recommendation assumptions"/"Cooling & energy assumptions")
// and ShiftSchedulePanel.tsx ("How this is calculated") already use for every
// other methodology disclosure in this app: native toggle, no new tooltip
// library/state machine. Styled as a small icon + absolutely-positioned
// panel here (vs. those two's inline expanding block) since this one sits
// next to a small per-route badge rather than at the bottom of a whole
// section. `name="efficiency-info"` groups every route's popover into one
// native exclusive-accordion set, so opening one auto-closes any other.
//
// Always renders numbers actually carried on THIS route (route.timeScore,
// route.heatExposureScore, route.efficiencyScore, route.coverage) plus the
// fastest/coolest values across the CURRENT route set — never static/generic
// copy. Mirrors scoring.ts's own null-handling: a route with no heat
// coverage has heatExposureScore/efficiencyScore === null (never a
// fabricated "time-only" score, see the routing feature's own data-integrity
// audit), so this discloses that plainly instead of a fake breakdown.
function EfficiencyInfo({
  route,
  fastestTimeS,
  coolestHeatC,
}: {
  route: ScoredRoute;
  fastestTimeS: number;
  coolestHeatC: number | null;
}) {
  const timeMin = route.timeScore / 60;
  const fastestMin = fastestTimeS / 60;
  const hasScore = route.heatExposureScore != null && route.efficiencyScore != null;

  return (
    <details name="efficiency-info" className="group relative">
      <summary
        aria-label="How the efficiency score is calculated"
        className="flex h-4 w-4 cursor-pointer list-none items-center justify-center rounded-full border border-neutral-300 text-[9px] font-semibold leading-none text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-700 dark:border-neutral-700 dark:text-neutral-400 dark:hover:border-neutral-600 dark:hover:text-neutral-200 [&::-webkit-details-marker]:hidden"
      >
        i
      </summary>
      <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-64 rounded-lg border border-neutral-200 bg-white p-3 text-[10px] leading-relaxed text-neutral-600 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
        <p className="font-medium text-neutral-900 dark:text-white">
          Efficient score balances travel time and heat exposure equally (50/50) — lower is better.
        </p>
        {hasScore ? (
          <p className="mt-1.5">
            This route: {timeMin.toFixed(1)} min (fastest: {fastestMin.toFixed(1)} min) + {route.heatExposureScore!.toFixed(1)}°C avg heat
            {coolestHeatC != null && ` (coolest: ${coolestHeatC.toFixed(1)}°C)`} → Efficiency score: {route.efficiencyScore!.toFixed(2)}
          </p>
        ) : (
          <p className="mt-1.5">
            Heat data unavailable for this route ({route.coverage.coveredCount}/{route.coverage.totalCount} sample points covered) —
            efficiency score can&apos;t be computed. This route: {timeMin.toFixed(1)} min (fastest: {fastestMin.toFixed(1)} min).
          </p>
        )}
      </div>
    </details>
  );
}

export default function RoutePanel() {
  const map = useMapStore((s) => s.map);
  const pickingStage = useRouteStore((s) => s.pickingStage);
  const phase1Status = useRouteStore((s) => s.phase1Status);
  const phase1Error = useRouteStore((s) => s.phase1Error);
  const routes = useRouteStore((s) => s.routes);
  const disclosure = useRouteStore((s) => s.disclosure);
  const phase2Status = useRouteStore((s) => s.phase2Status);
  const phase2Error = useRouteStore((s) => s.phase2Error);
  const runPhase2 = useRouteStore((s) => s.runPhase2);
  const origin = useRouteStore((s) => s.origin);
  const destination = useRouteStore((s) => s.destination);
  const setOrigin = useRouteStore((s) => s.setOrigin);
  const setDestination = useRouteStore((s) => s.setDestination);

  // `pickingStage !== "idle"` covers the search boxes' own reason for
  // existing: they must be visible from the moment Route mode starts
  // (RouteControl.tsx's "Route" button -> startPicking()), not only once a
  // fetch has begun/finished — otherwise a search-only pick (no map click at
  // all) would have nowhere to render its search boxes.
  const hasContent = pickingStage !== "idle" || phase1Status === "loading" || phase1Status === "error" || routes.length > 0;
  if (!hasContent) return null;

  const hasUncovered = routes.some((r) => !r.coverage.fullyCovered);

  // Comparison values EfficiencyInfo needs — recomputed from the same
  // `routes` already in state (not a new fetch/metric), mirroring exactly
  // what lib/routing/scoring.ts's assignRouteLabels() used server-side to
  // decide Fastest/Coolest, so the popover's numbers can never disagree
  // with the badges shown above it.
  const fastestTimeS = routes.length > 0 ? Math.min(...routes.map((r) => r.timeScore)) : 0;
  const coveredHeatScores = routes.map((r) => r.heatExposureScore).filter((v): v is number => v != null);
  const coolestHeatC = coveredHeatScores.length > 0 ? Math.min(...coveredHeatScores) : null;

  return (
    <aside className="flex w-full shrink-0 flex-col border-t border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 lg:h-full lg:w-96 lg:overflow-y-auto lg:border-l lg:border-t-0">
      <div className="border-b border-neutral-200 px-5 py-5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Route</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          Heat-aware route comparison.
        </p>
      </div>

      <div className="flex flex-col gap-3 p-5">
        {/* Alternative to clicking the map directly (RouteControl.tsx/
            MapCanvas.tsx's click handler, unchanged) — both funnel through
            routeStore's setOrigin/setDestination, so whichever method sets a
            point LAST wins for it, search or click, in either order. */}
        <div className="flex flex-col gap-1.5">
          <LocationAutocomplete
            label="From"
            placeholder="Type to search origin…"
            helperText="Select a location from the list, or press Enter to use the top result."
            displayValue={origin?.name ?? ""}
            onSelect={(r: LocationSuggestion) => setOrigin({ lngLat: [r.lon, r.lat], name: suggestionToPointName(r) })}
            getBiasCenter={() => (map ? [map.getCenter().lng, map.getCenter().lat] : null)}
          />
          <LocationAutocomplete
            label="To"
            placeholder="Type to search destination…"
            helperText="Select a location from the list, or press Enter to use the top result."
            displayValue={destination?.name ?? ""}
            onSelect={(r: LocationSuggestion) => setDestination({ lngLat: [r.lon, r.lat], name: suggestionToPointName(r) })}
            getBiasCenter={() => (map ? [map.getCenter().lng, map.getCenter().lat] : null)}
          />
        </div>

        {phase1Status === "loading" && (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">Fetching route alternatives…</p>
        )}

        {phase1Status === "error" && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {phase1Error}
          </p>
        )}

        {routes.length > 0 && (
          <>
            <p className="text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">{disclosure}</p>

            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {routes.map((r, i) => (
                <div key={r.alt.index} className="flex items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: rgba(ROUTE_COLORS_RGBA[i] ?? ROUTE_COLORS_RGBA[ROUTE_COLORS_RGBA.length - 1]) }}
                  />
                  Route {i + 1}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              {routes.map((r, i) => (
                <div
                  key={r.alt.index}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-neutral-900 dark:text-white">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: rgba(ROUTE_COLORS_RGBA[i] ?? ROUTE_COLORS_RGBA[ROUTE_COLORS_RGBA.length - 1]) }}
                      />
                      Route {i + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {r.labels.length > 0 && (
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                          style={{ background: rgba(ROUTE_COLORS_RGBA[i] ?? ROUTE_COLORS_RGBA[ROUTE_COLORS_RGBA.length - 1], 1) }}
                        >
                          {r.labels.join(" & ")}
                        </span>
                      )}
                      <EfficiencyInfo route={r} fastestTimeS={fastestTimeS} coolestHeatC={coolestHeatC} />
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 divide-x divide-neutral-200 rounded-md border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-950">
                    <div className="p-2 text-center">
                      <div className="text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Distance</div>
                      <div className="text-xs font-semibold text-neutral-900 dark:text-white">{formatKm(r.alt.distanceM)}</div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Duration</div>
                      <div className="text-xs font-semibold text-neutral-900 dark:text-white">{formatMinutes(r.alt.durationS)}</div>
                    </div>
                    <div className="p-2 text-center">
                      <div className="text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Avg temp</div>
                      <div className="text-xs font-semibold text-neutral-900 dark:text-white">{formatTemp(r.heatExposureScore)}</div>
                    </div>
                  </div>
                  {!r.coverage.fullyCovered && (
                    <p className="mt-1.5 text-[10px] text-neutral-500 dark:text-neutral-500">
                      {r.coverage.coveredCount}/{r.coverage.totalCount} sample points covered by existing heat data.
                    </p>
                  )}
                </div>
              ))}
            </div>

            {hasUncovered && (
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={runPhase2}
                  disabled={phase2Status === "loading"}
                  className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 shadow-sm transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:bg-neutral-900"
                >
                  {phase2Status === "loading" ? "Analyzing heat…" : "Analyze heat for uncovered routes"}
                </button>
                <p className="text-[10px] text-neutral-500 dark:text-neutral-500">
                  Submits ONE new FortyGuard heat analysis (1 credit) covering the stretches above with no existing coverage.
                </p>
                {phase2Status === "error" && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                    {phase2Error}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
