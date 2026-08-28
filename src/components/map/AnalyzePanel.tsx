"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAOIStore } from "@/store/aoiStore";
import { useAnalysisStore } from "@/store/analysisStore";
import type { AnalysisTaskState } from "@/store/analysisStore";
import { MAX_AOI_AREA_SQKM, FORECAST_HOUR_OFFSETS } from "@/lib/mapConfig";
import { LANDCOVER_COLORS } from "@/lib/landcoverColors";
import { generateSegmentationImage } from "@/lib/segmentationImage";
import { formatFallbackDateLabel } from "@/lib/relativeTime";
import { isSpatiallyUniform } from "@/lib/heatmapUtils";
import AreaMetricCard, { SourceBadge } from "./AreaMetricCard";
import AnalyzeProgress from "./AnalyzeProgress";
import HeatmapImage from "./HeatmapImage";
import ForecastPanel from "./ForecastPanel";
import SiteNameModal from "./SiteNameModal";

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-md bg-neutral-50 px-2 py-2 dark:bg-neutral-900">
      <span className="text-[10px] text-neutral-500 dark:text-neutral-500">{label}</span>
      <span className="text-sm font-semibold text-neutral-900 dark:text-white">{value}</span>
    </div>
  );
}

function CardShell({
  title,
  badge,
  children,
}: {
  title: string;
  badge: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  );
}

function DataSourceBadge({ cached, realLabel }: { cached?: boolean; realLabel: string }) {
  return cached ? <SourceBadge tone="cached">Cached (dev, no credit)</SourceBadge> : <SourceBadge>{realLabel}</SourceBadge>;
}

// `state` is this ONE source's real progress. The two top-level requests run
// in parallel but land at different times, and the panel only reveals numbers
// once both have (analysisStore's Promise.all) — so a card whose own source has
// already returned should say so instead of showing the same "Loading" as one
// still waiting on FortyGuard's queue.
function LoadingRow({ state }: { state?: AnalysisTaskState }) {
  const label =
    state === "done"
      ? "Returned — finishing analysis…"
      : state === "failed"
        ? "Failed — finishing analysis…"
        : "Loading…";
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-neutral-400 dark:text-neutral-600">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "done"
            ? "bg-severity-nominal"
            : state === "failed"
              ? "bg-severity-critical"
              : "animate-pulse bg-neutral-400 dark:bg-neutral-600"
        }`}
      />
      {label}
    </div>
  );
}

export default function AnalyzePanel() {
  const geometry = useAOIStore((s) => s.geometry);
  const areaSqKm = useAOIStore((s) => s.areaSqKm);
  const isOverAreaLimit = useAOIStore((s) => s.isOverAreaLimit);

  const status = useAnalysisStore((s) => s.status);
  const data = useAnalysisStore((s) => s.data);
  const error = useAnalysisStore((s) => s.error);
  const analyzeAOI = useAnalysisStore((s) => s.analyzeAOI);
  const reset = useAnalysisStore((s) => s.reset);
  const heatmapImageUrl = useAnalysisStore((s) => s.heatmapImageUrl);
  const heatForecast = useAnalysisStore((s) => s.heatForecast);
  const capturingForecast = useAnalysisStore((s) => s.capturingForecast);
  const progress = useAnalysisStore((s) => s.progress);
  const capturedForecastCount = FORECAST_HOUR_OFFSETS.filter((h) => heatForecast[h]?.status === "ok").length;

  // Drop stale results whenever the AOI changes shape or is cleared/redrawn.
  useEffect(() => {
    reset();
  }, [geometry, reset]);

  const showCards = status === "analyzing" || status === "success";

  // §4.7 — saves a `sites` row once analysis completes. Feature 1 (site
  // naming) gates that save behind a name prompt instead of firing it
  // automatically: as soon as the row is ready to be written, open the
  // naming modal; the actual POST only happens once the user confirms
  // (custom name) or an auto-generated one is resolved.
  const [siteSaveStatus, setSiteSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [siteId, setSiteId] = useState<string | null>(null);
  const [nameModalOpen, setNameModalOpen] = useState(false);
  const [namePrompted, setNamePrompted] = useState(false);

  useEffect(() => {
    setSiteSaveStatus("idle");
    setSiteId(null);
    setNameModalOpen(false);
    setNamePrompted(false);
  }, [geometry]);

  useEffect(() => {
    if (status !== "success" || !data || !geometry) return;
    if (namePrompted) return;
    // Wait for the heat photo to finish rendering (HeatmapImage's own effect,
    // async basemap capture) rather than prompting before it — unless the
    // heatmap call itself failed, in which case there's nothing to wait for.
    if (data.heatmap.status === "ok" && !heatmapImageUrl) return;

    setNamePrompted(true);
    setNameModalOpen(true);
  }, [status, data, geometry, heatmapImageUrl, namePrompted]);

  async function saveSite(name: string | null) {
    if (!data || !geometry) return;
    setSiteSaveStatus("saving");

    const segmentationImageDataUrl =
      data.overpass.status === "ok" ? generateSegmentationImage(geometry, data.overpass.result).toDataURL("image/png") : null;

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          aoiGeometry: geometry,
          areaSqKm: data.areaSqKm,
          centroid: data.centroid,
          heatmap: data.heatmap,
          satellite: data.satellite,
          overpass: data.overpass,
          segmentationImageDataUrl,
          heatImageDataUrl: heatmapImageUrl,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save site record");
      setSiteId(body.siteId);
      setSiteSaveStatus("saved");
    } catch (err) {
      console.error("[sites] save failed:", err);
      setSiteSaveStatus("error");
    }
  }

  // Empty input -> auto-generate "Site near <address>" from the AOI centroid
  // via reverse geocoding; if that fails for any reason, fall back to
  // coordinates rather than blocking the save.
  async function resolveAutoName(): Promise<string> {
    if (!data) return "Untitled site";
    try {
      const res = await fetch(`/api/geocode?lat=${data.centroid.lat}&lon=${data.centroid.lon}`);
      const body = await res.json();
      if (res.ok && body.displayName) return `Site near ${body.displayName}`;
    } catch (err) {
      console.error("[sites] reverse geocode failed:", err);
    }
    return `Site near ${data.centroid.lat.toFixed(4)}, ${data.centroid.lon.toFixed(4)}`;
  }

  async function handleModalSave(rawName: string) {
    setNameModalOpen(false);
    const trimmed = rawName.trim();
    const name = trimmed.length > 0 ? trimmed : await resolveAutoName();
    await saveSite(name);
  }

  function handleModalCancel() {
    setNameModalOpen(false);
  }

  return (
    // Below `lg`: full-width block below the map, border-top, no height/
    // scroll of its own (the page column itself scrolls — see app/map/page.tsx).
    // At `lg`+: unchanged original fixed w-96 side panel, its own h-full +
    // overflow-y-auto, border-left instead of border-top.
    <aside className="flex w-full shrink-0 flex-col border-t border-neutral-200 bg-white text-neutral-900 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-200 lg:h-full lg:w-96 lg:overflow-y-auto lg:border-l lg:border-t-0">
      <div className="border-b border-neutral-200 px-5 py-5 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-900 dark:text-white">Analyze</h2>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-500">
          Draw an AOI on the map to see land-cover and heat metrics here.
        </p>
      </div>

      {areaSqKm === null ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-neutral-400 dark:text-neutral-600">
          No AOI selected yet.
        </div>
      ) : (
        <div className="flex flex-col gap-3 px-5 py-5">
          <div className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <div className="text-xs text-neutral-500 dark:text-neutral-500">AOI area</div>
            <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-white">
              {areaSqKm < 1 ? `${(areaSqKm * 100).toFixed(1)} ha` : `${areaSqKm.toFixed(2)} km²`}
            </div>
          </div>

          {isOverAreaLimit && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              AOI exceeds FortyGuard&apos;s ~{MAX_AOI_AREA_SQKM} km² (50 mi²) limit for heatmap and
              satellite analysis. Redraw a smaller area to continue.
            </div>
          )}

          {!isOverAreaLimit && status !== "success" && (
            <button
              type="button"
              disabled={status === "analyzing" || !geometry}
              onClick={() => geometry && analyzeAOI(geometry)}
              className="rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              {status === "analyzing" ? "Analyzing land cover…" : "Analyze land cover"}
            </button>
          )}

          {/* Real per-request progress, replacing a static sentence that gave no
              sense of how far along a ~45s run was. See AnalyzeProgress.tsx for
              why this counts requests rather than tiles. */}
          {status === "analyzing" && <AnalyzeProgress />}

          {status === "error" && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
              <button
                type="button"
                onClick={() => geometry && analyzeAOI(geometry)}
                className="mt-2 block font-medium underline underline-offset-2"
              >
                Retry
              </button>
            </div>
          )}

          {showCards && (
            <div className="flex flex-col gap-5">
              <CardShell title="Footprint cross-check" badge={<SourceBadge>Real (OpenStreetMap)</SourceBadge>}>
                {status === "analyzing" ? (
                  <LoadingRow state={progress.landcover} />
                ) : data?.overpass.status === "error" ? (
                  <p className="text-xs text-neutral-400 dark:text-neutral-600">{data.overpass.message}</p>
                ) : data?.overpass.status === "ok" ? (
                  <>
                    <div className="flex flex-col gap-3">
                      <AreaMetricCard label="Buildings" valuePct={data.overpass.result.buildingPct} barColor={LANDCOVER_COLORS.building} />
                      <AreaMetricCard label="Roads" valuePct={data.overpass.result.roadPct} barColor={LANDCOVER_COLORS.road} />
                      <AreaMetricCard label="Vegetation" valuePct={data.overpass.result.vegetationPct} barColor={LANDCOVER_COLORS.vegetation} />
                      <AreaMetricCard label="Water" valuePct={data.overpass.result.waterPct} barColor={LANDCOVER_COLORS.water} />
                      <AreaMetricCard label="Other" valuePct={data.overpass.result.otherPct} barColor={LANDCOVER_COLORS.other} />
                    </div>
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-600">
                      {data.overpass.result.buildingCount} building{data.overpass.result.buildingCount === 1 ? "" : "s"},{" "}
                      {data.overpass.result.roadCount} road segment{data.overpass.result.roadCount === 1 ? "" : "s"},{" "}
                      {data.overpass.result.vegetationCount} vegetation area{data.overpass.result.vegetationCount === 1 ? "" : "s"}, and{" "}
                      {data.overpass.result.waterCount} water feature{data.overpass.result.waterCount === 1 ? "" : "s"} clipped
                      exactly to the drawn AOI boundary — this is the AOI-wide, boundary-exact breakdown. Also
                      recolored on the map (Land-cover view) with the same colors shown here.
                    </p>
                  </>
                ) : null}
              </CardShell>

              <CardShell
                title="Surface heatmap"
                badge={<DataSourceBadge cached={data?.heatmap.status === "ok" ? data.heatmap.cached : undefined} realLabel="Real (FortyGuard)" />}
              >
                {status === "analyzing" ? (
                  <LoadingRow state={progress.heatmap} />
                ) : data?.heatmap.status === "error" ? (
                  <p className="text-xs text-neutral-400 dark:text-neutral-600">{data.heatmap.message}</p>
                ) : data?.heatmap.status === "ok" ? (
                  <>
                    {data.heatmap.isFallbackDate && data.heatmap.dateUsed && (
                      <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                        Showing {formatFallbackDateLabel(data.heatmap.dateUsed)} data — today&apos;s FortyGuard data
                        isn&apos;t available yet.
                      </p>
                    )}
                    <div className="grid grid-cols-3 gap-2">
                      <StatCell label="Min" value={`${data.heatmap.result.stats_data.temperature_stats.minimum.toFixed(1)}°C`} />
                      <StatCell label="Mean" value={`${data.heatmap.result.stats_data.temperature_stats.mean.toFixed(1)}°C`} />
                      <StatCell label="Max" value={`${data.heatmap.result.stats_data.temperature_stats.maximum.toFixed(1)}°C`} />
                    </div>
                    {geometry && (
                      <HeatmapImage tiles={data.heatmap.result.map_data.features} aoiGeometry={geometry} />
                    )}
                    {isSpatiallyUniform(
                      data.heatmap.result.stats_data.temperature_stats.minimum,
                      data.heatmap.result.stats_data.temperature_stats.maximum
                    ) && (
                      <p className="rounded-md border border-neutral-300 bg-neutral-100 px-2 py-1.5 text-[11px] leading-relaxed text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
                        FortyGuard returned one uniform value across this AOI, so there&apos;s no hot/cool variation to
                        map — the reading is real, but the image below is a single flat color. A larger AOI usually
                        returns more spatial detail.
                      </p>
                    )}
                    <p className="text-[11px] text-neutral-400 dark:text-neutral-600">
                      {data.heatmap.result.map_data.features.length} tile
                      {data.heatmap.result.map_data.features.length === 1 ? "" : "s"} tinted over the AOI&apos;s own
                      imagery, clipped to the drawn boundary. Untinted patches inside the outline are AOI the API
                      returned no tile for.
                      {data.heatmap.cached && " Synthetic values for dev/testing — not a real measurement."}
                    </p>
                  </>
                ) : null}
              </CardShell>

              {/* Rendered whenever Analyze has finished, regardless of the
                  main whole-day heatmap's own success — forecast now runs as
                  its own independent branch (project.md §2/§4.4), not gated
                  behind the unrelated whole-day result. */}
              {status === "success" && geometry && <ForecastPanel geometry={geometry} siteId={siteId} />}

              {/*
                /v1/satellite is deliberately NOT surfaced here. It samples a
                single fixed-size image at the AOI centroid, so on a large AOI
                its class percentages read as an AOI-wide breakdown while
                describing a small patch — a 93.5 km² AOI reported Building
                97.4%. It is still fetched and carried into the site record as
                `landcover_spotcheck` (see lib/siteRecord.ts) for use on the
                Operational Analyst page as one extra reference point, never as
                the primary land-cover source. Overpass's footprint
                cross-check above is the only land-cover figure shown here.
              */}

              {namePrompted && !nameModalOpen && siteSaveStatus === "idle" && (
                <button
                  type="button"
                  onClick={() => setNameModalOpen(true)}
                  className="rounded-lg border border-neutral-200 px-4 py-2.5 text-center text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
                >
                  Name & save this site
                </button>
              )}
              {siteSaveStatus === "saving" && (
                <p className="text-xs text-neutral-400 dark:text-neutral-600">Saving site record…</p>
              )}
              {siteSaveStatus === "error" && (
                <p className="text-xs text-red-600 dark:text-red-400">Failed to save site record. Check console for details.</p>
              )}
              {siteSaveStatus === "saved" && siteId && (
                <>
                  {/* All 5 offsets are captured automatically right after
                      Analyze (analysisStore.ts's captureFullForecast) — this
                      only shows up if one genuinely failed at FortyGuard, or
                      capture is still finishing when the user reaches this
                      button. Never implies the user needs to do anything
                      manual anymore. */}
                  {capturingForecast ? (
                    <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-600">
                      Still capturing the forecast window ({capturedForecastCount} of {FORECAST_HOUR_OFFSETS.length} so
                      far) — safe to continue, Shift Schedule will show whatever completes.
                    </p>
                  ) : (
                    capturedForecastCount < FORECAST_HOUR_OFFSETS.length && (
                      <p className="text-[11px] leading-relaxed text-neutral-400 dark:text-neutral-600">
                        {capturedForecastCount} of {FORECAST_HOUR_OFFSETS.length} forecast slots available — FortyGuard
                        didn&apos;t return data for the rest, Shift Schedule will mark those as unavailable.
                      </p>
                    )
                  )}
                  <Link
                    href={`/analyst?siteId=${siteId}`}
                    className="block rounded-lg bg-neutral-900 px-4 py-2.5 text-center text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
                  >
                    Analyze this site
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <SiteNameModal
        open={nameModalOpen}
        saving={siteSaveStatus === "saving"}
        onCancel={handleModalCancel}
        onSave={handleModalSave}
      />
    </aside>
  );
}
