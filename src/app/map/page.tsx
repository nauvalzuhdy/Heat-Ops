"use client";

import Header from "@/components/layout/Header";
import AppSidebar from "@/components/layout/AppSidebar";
import MapCanvas from "@/components/map/MapCanvas";
import AnalyzePanel from "@/components/map/AnalyzePanel";
import RoutePanel from "@/components/map/RoutePanel";
import AnalystPanelToggle from "@/components/map/AnalystPanelToggle";
import { useRouteStore } from "@/store/routeStore";

export default function MapPage() {
  const pickingStage = useRouteStore((s) => s.pickingStage);
  const routes = useRouteStore((s) => s.routes);
  const analystPanelOpen = useRouteStore((s) => s.analystPanelOpen);

  // Route mode "active" = the user has started using the Route tool this
  // session (still picking origin/destination, or already has results) —
  // AnalyzePanel auto-hides for map space the moment this becomes true
  // (routeStore.startPicking() resets analystPanelOpen to false), but stays
  // toggleable via AnalystPanelToggle for as long as it's true. Once Route
  // mode fully clears (back to idle, no routes), AnalyzePanel always shows
  // again regardless of analystPanelOpen's last value — its prior "default
  // always visible" behavior, unaffected by Route mode ever having run.
  const routeModeActive = pickingStage !== "idle" || routes.length > 0;
  const showAnalyzePanel = !routeModeActive || analystPanelOpen;

  return (
    <div className="flex h-app-shell w-full flex-col overflow-hidden">
      <Header title="Map View" />
      {/* Below `lg` (1024px): map on top, analysis panel below, the whole
          column scrolls — "map dulu, analysis di bawah" for phones/tablets.
          At `lg`+: unchanged original side-by-side row (map flex-1,
          analysis panel a fixed w-96), not touched by the responsive rules. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <AppSidebar />
        <MapCanvas />
        {routeModeActive && <AnalystPanelToggle />}
        {/* `hidden` (display:none) rather than unmounting AnalyzePanel —
            keeps its internal state (in-progress save flow, etc.) intact
            across repeated toggle clicks; `contents` makes the wrapper
            itself layout-invisible when shown, so AnalyzePanel's own flex-
            item sizing is unaffected by this extra wrapper (same technique
            MapCanvas.tsx already uses for its own responsive wrappers). */}
        <div className={showAnalyzePanel ? "contents" : "hidden"}>
          <AnalyzePanel />
        </div>
        <RoutePanel />
      </div>
    </div>
  );
}
