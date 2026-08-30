"use client";

import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, NavigationControl, AttributionControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import * as turf from "@turf/turf";
import { useMapStore } from "@/store/mapStore";
import { useDrawStore } from "@/store/drawStore";
import { useAOIStore } from "@/store/aoiStore";
import { useAnalysisStore } from "@/store/analysisStore";
import { useRouteStore } from "@/store/routeStore";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAP_STYLE_URL,
  ESRI_SATELLITE_TILE_URL,
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_SOURCE_ID,
  ESRI_SATELLITE_LAYER_ID,
  ESRI_SATELLITE_MAX_ZOOM,
  ROUTE_COLORS_RGBA,
  ROUTE_ORIGIN_COLOR_RGBA,
  ROUTE_DESTINATION_COLOR_RGBA,
} from "@/lib/mapConfig";
import SearchBox from "./SearchBox";
import ViewControls from "./ViewControls";
import DrawControl from "./DrawControl";
import RouteControl from "./RouteControl";
import { LANDCOVER_COLORS_RGBA } from "@/lib/landcoverColors";
import {
  PHOTOREALISTIC_MAX_BUILDINGS,
  GROUND_HEIGHT_M,
  GROUND_SURFACE_CLEARANCE_M,
  WATER_DEPTH_M,
  WATER_FILL_ALPHA,
  PHOTO_BORDER_COLOR,
  PHOTO_BORDER_WIDTH_PX,
  CAP_THICKNESS_M,
  fetchAOISatelliteImage,
  computeAverageColors,
  darkenColor,
  buildRoofCapFeature,
  raiseFeatureZ,
  computeGroundFeature,
  type RGB,
} from "@/lib/photorealisticMassing";
import type { Feature, MultiPolygon, Polygon } from "geojson";

// §4.6 — Massing view (default) reads as an uncategorized 3D city model, so
// the eye reads shape + shadow rather than land-use category. Land-cover view
// recolors every category from the single shared palette in
// lib/landcoverColors.ts (§4.2) — building/road colors must NOT be redefined
// here; that duplication is exactly the bug §4.2 documents.
const MASSING_BUILDING_COLOR: [number, number, number, number] = [232, 232, 232, 235];
const MASSING_ROAD_COLOR: [number, number, number, number] = [176, 176, 176, 200];

// One AmbientLight + one shadow-casting DirectionalLight (§4.6 point 1). Built
// once at module scope — effects are static config, not per-render state.
// (Previously extracted to lib/mapLighting.ts for reuse by Operational
// Analyst's 3D Heat Zones column; that column was removed, so this is back
// to being MapCanvas's own — no need for a shared module with one consumer.)
const lightingEffect = new LightingEffect({
  ambientLight: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
  directionalLight: new DirectionalLight({
    color: [255, 255, 255],
    intensity: 2.0,
    direction: [-2, -3, -1],
    _shadow: true,
  }),
});

// §4.6 Photo-realistic Massing — per-building colors sampled from the real
// satellite image (lib/photorealisticMassing.ts). Kept as component-local
// state, not the shared mapStore: it's derived rendering data for one
// specific AOI's buildings, not a user preference like viewMode/renderMode.
type PhotorealState =
  | { status: "idle" }
  | { status: "too_large"; buildingCount: number }
  | { status: "loading" }
  | {
      status: "ready";
      buildingColors: RGB[];
      groundFeature: Feature<Polygon | MultiPolygon>;
      groundColor: RGB;
    }
  | { status: "error"; message: string };

const PHOTOREAL_FALLBACK_COLOR: [number, number, number, number] = [190, 190, 190, 235];

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const setMap = useMapStore((s) => s.setMap);
  const map = useMapStore((s) => s.map);
  const viewMode = useMapStore((s) => s.viewMode);
  const renderMode = useMapStore((s) => s.renderMode);
  const analysisData = useAnalysisStore((s) => s.data);
  const analysisStatus = useAnalysisStore((s) => s.status);
  const aoiGeometry = useAOIStore((s) => s.geometry);
  const setRenderMode = useMapStore((s) => s.setRenderMode);
  const routes = useRouteStore((s) => s.routes);
  const routeOrigin = useRouteStore((s) => s.origin);
  const routeDestination = useRouteStore((s) => s.destination);
  const [photorealState, setPhotorealState] = useState<PhotorealState>({ status: "idle" });

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      // Default attribution control renders fully expanded at its
      // bottom-left anchor, which collides with our own DrawControl button
      // (also bottom-left) on narrow/mobile widths. Own the control
      // explicitly instead: compact (an "i" toggle, not always-open text),
      // anchored top-right where nothing else lives at any breakpoint.
      attributionControl: false,
    });

    map.addControl(new AttributionControl({ compact: true }), "top-right");
    map.addControl(new NavigationControl(), "bottom-right");

    const overlay = new MapboxOverlay({ interleaved: false, layers: [], effects: [lightingEffect] });
    map.addControl(overlay);
    overlayRef.current = overlay;

    map.on("load", () => {
      map.addSource(ESRI_SATELLITE_SOURCE_ID, {
        type: "raster",
        tiles: [ESRI_SATELLITE_TILE_URL],
        tileSize: 256,
        maxzoom: ESRI_SATELLITE_MAX_ZOOM,
        attribution: ESRI_SATELLITE_ATTRIBUTION,
      });
      map.addLayer({
        id: ESRI_SATELLITE_LAYER_ID,
        type: "raster",
        source: ESRI_SATELLITE_SOURCE_ID,
        layout: {
          visibility: useMapStore.getState().viewMode === "satellite" ? "visible" : "none",
        },
      });

      const terraDraw = new TerraDraw({
        adapter: new TerraDrawMapLibreGLAdapter({ map }),
        modes: [new TerraDrawPolygonMode()],
      });

      terraDraw.on("finish", (id, context) => {
        if (context.action !== "draw") return;
        const feature = terraDraw.getSnapshotFeature(id);
        if (!feature || feature.geometry.type !== "Polygon") return;
        useAOIStore.getState().setAOI(feature.geometry);
        terraDraw.setMode("static");
        useDrawStore.getState().setIsDrawing(false);
      });

      terraDraw.start();
      terraDraw.setMode("static");
      useDrawStore.getState().setTerraDraw(terraDraw);

      // §4.5 Route tool — always attached, a no-op whenever no pick is in
      // progress (simpler and behaviorally identical to attaching/detaching
      // the listener on every pickingStage change).
      map.on("click", (e) => {
        if (useRouteStore.getState().pickingStage === "idle") return;
        useRouteStore.getState().handleMapClick([e.lngLat.lng, e.lngLat.lat]);
      });
    });

    setMap(map);

    return () => {
      useDrawStore.getState().setTerraDraw(null);
      useDrawStore.getState().setIsDrawing(false);
      useAOIStore.getState().clearAOI();
      useRouteStore.getState().clearRoute();
      overlayRef.current = null;
      map.remove();
      setMap(null);
    };
  }, [setMap]);

  // §4.6 Photo-realistic Massing — fetch the AOI's satellite export image and
  // sample one average color per building, eagerly whenever an analysis
  // succeeds (not lazily on first switching to the mode) so the toggle is
  // instant once colors are ready. Skipped entirely above
  // PHOTOREALISTIC_MAX_BUILDINGS — sampling is one getImageData() call per
  // building, and a large AOI has returned 20,000+ buildings before (see
  // mapConfig.ts's pickGranularity comment); the cap keeps this from ever
  // running slow rather than trying to make a slow path faster.
  useEffect(() => {
    const overpassResult = analysisData?.overpass.status === "ok" ? analysisData.overpass.result : null;
    if (!overpassResult || !aoiGeometry || overpassResult.buildingFeatures.length === 0) {
      setPhotorealState({ status: "idle" });
      return;
    }

    const buildingCount = overpassResult.buildingFeatures.length;
    if (buildingCount > PHOTOREALISTIC_MAX_BUILDINGS) {
      setPhotorealState({ status: "too_large", buildingCount });
      // Don't leave the user stuck on a mode that can't render for this AOI.
      if (useMapStore.getState().renderMode === "photoreal") setRenderMode("massing");
      return;
    }

    let cancelled = false;
    setPhotorealState({ status: "loading" });
    (async () => {
      try {
        const image = await fetchAOISatelliteImage(aoiGeometry);
        const buildingColors = computeAverageColors(image, aoiGeometry, overpassResult.buildingFeatures);
        // Item 5 — one more sample for the ground slab itself (AOI minus
        // water), reusing the exact same per-polygon averaging as buildings.
        const groundFeature = computeGroundFeature(aoiGeometry, overpassResult.waterFeatures);
        const [groundColor] = computeAverageColors(image, aoiGeometry, [groundFeature]);
        if (!cancelled) setPhotorealState({ status: "ready", buildingColors, groundFeature, groundColor });
      } catch (err) {
        if (!cancelled) {
          setPhotorealState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to sample satellite colors",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisData, aoiGeometry, setRenderMode]);

  // Rebuild the deck.gl overlay layers whenever fetched landcover data changes.
  //
  // The heatmap is deliberately NOT a layer here. deck.gl's MaskExtension
  // clips instanced layers per instance (at the instance anchor) rather than
  // per fragment, so 60 m cells were kept or dropped whole and spilled past
  // the AOI boundary. It is now rendered as a Canvas2D image clipped with
  // ctx.clip() — see lib/heatmapImage.ts and components/map/HeatmapImage.tsx.
  //
  // The building/road/vegetation/water recolor layers use Overpass's
  // per-category *Features arrays, which are already clipped exactly to the
  // AOI boundary server-side (see lib/overpass.ts), so no masking is needed.
  //
  // Buildings are extruded (§4.6): heightM comes from each feature's own
  // OSM height/building:levels tag (estimateBuildingHeightM in lib/overpass.ts),
  // not a flat guess, so massing view shows real relative building heights.
  // Roads stay flat in both modes — extruding a road buffer reads as a solid
  // block, not a street.
  //
  // Vegetation/water only render in Land-cover mode and Photo mode: Massing
  // view (§4.6) is specifically about building 3D form + shadow, and neither
  // category was part of that toggle's original building/road scope — flat
  // green/cyan blobs would clutter the uncategorized-massing read without
  // being asked for. Building/road keep rendering in all three modes.
  //
  // Photo mode's 5 visual passes (this file's §4.6 follow-up, refined
  // against an Autodesk Forma reference screenshot — see project.md §4.6):
  //   1. White semi-transparent borders (PHOTO_BORDER_COLOR) on every
  //      category layer except roads — a plain fill reads as flat cutouts
  //      without a boundary line; roads are thin enough already that an
  //      outline just added noise in testing.
  //   2. Buildings always extrude >0 — audited estimateBuildingHeightM
  //      (lib/overpass.ts): height tag -> building:levels tag -> an 8m
  //      DEFAULT_BUILDING_HEIGHT_M fallback, in that order, every path
  //      guarded to reject non-finite/zero/negative values. No code path
  //      already returns 0, so no fix was needed here — flat-looking
  //      buildings in earlier screenshots were the (now-fixed) uniform
  //      massing-gray fill, not a missing extrusion.
  //   3. Water sinks below the ground plane (WATER_DEPTH_M, negative) —
  //      a real depression against the slab, not a flat cyan patch.
  //   4. (RenderModeToggle.tsx) label shortened to "Photo".
  //   5. The whole AOI extrudes as one ground slab (computeGroundFeature,
  //      GROUND_HEIGHT_M) colored from its own satellite-sampled average,
  //      with roads/vegetation raised (raiseFeatureZ) to sit exactly on its
  //      surface — buildings rise out of it rather than floating over a
  //      flat texture.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const layers = [];
    const overpassResult = analysisData?.overpass.status === "ok" ? analysisData.overpass.result : null;
    const isMassing = renderMode === "massing";
    const isPhotoreal = renderMode === "photoreal";
    const ready = photorealState.status === "ready" ? photorealState : null;
    const capZ = GROUND_HEIGHT_M + GROUND_SURFACE_CLEARANCE_M;

    if (overpassResult) {
      // Ground slab first (item 5) so everything else draws on top of it.
      if (isPhotoreal && ready) {
        layers.push(
          new GeoJsonLayer({
            id: "photo-ground",
            data: turf.featureCollection([ready.groundFeature]),
            filled: true,
            stroked: true,
            extruded: true,
            getElevation: GROUND_HEIGHT_M,
            getFillColor: [...ready.groundColor, 235],
            getLineColor: PHOTO_BORDER_COLOR,
            lineWidthMinPixels: PHOTO_BORDER_WIDTH_PX,
            material: { ambient: 0.4, diffuse: 0.6, shininess: 16 },
            pickable: false,
          })
        );
      }

      layers.push(
        new GeoJsonLayer({
          id: "landcover-buildings",
          data: turf.featureCollection(overpassResult.buildingFeatures),
          filled: true,
          stroked: false,
          extruded: true,
          getElevation: (f) => f.properties.heightM,
          // Photo: walls get the same per-building color as the roof (see
          // the "landcover-buildings-roof" layer below), darkened ~30% as a
          // simple flat shade — a disclosed limitation, not a real
          // side-wall texture (lib/photorealisticMassing.ts). Falls back to
          // the neutral massing gray while colors are still loading.
          getFillColor: isMassing
            ? MASSING_BUILDING_COLOR
            : isPhotoreal
              ? (_f, { index }: { index: number }) => {
                  const c = ready?.buildingColors[index];
                  return c ? [...darkenColor(c), 235] : PHOTOREAL_FALLBACK_COLOR;
                }
              : LANDCOVER_COLORS_RGBA.building,
          material: { ambient: 0.35, diffuse: 0.6, shininess: 32 },
          pickable: true,
        })
      );

      // Roof cap: a second, non-extruded layer using the SAME footprints
      // raised to roofline height (buildRoofCapFeature) so the true sampled
      // color — and item 1's white border — show on top, undarkened. See
      // lib/photorealisticMassing.ts's header comment for why this needs
      // two layers instead of one.
      if (isPhotoreal && ready) {
        layers.push(
          new GeoJsonLayer({
            id: "landcover-buildings-roof",
            data: turf.featureCollection(overpassResult.buildingFeatures.map(buildRoofCapFeature)),
            filled: true,
            stroked: true,
            extruded: false,
            getFillColor: (_f, { index }: { index: number }) => {
              const c = ready.buildingColors[index];
              return c ? [...c, 255] : PHOTOREAL_FALLBACK_COLOR;
            },
            getLineColor: PHOTO_BORDER_COLOR,
            lineWidthMinPixels: PHOTO_BORDER_WIDTH_PX,
            pickable: false,
          })
        );
      }

      layers.push(
        new GeoJsonLayer({
          id: "landcover-roads",
          // Photo: raised to sit exactly on the ground slab's surface
          // (item 5) instead of at z=0, where the opaque slab above would
          // otherwise hide them entirely.
          data: turf.featureCollection(
            isPhotoreal && ready
              ? overpassResult.roadFeatures.map((r) => raiseFeatureZ(r, capZ))
              : overpassResult.roadFeatures
          ),
          filled: true,
          stroked: false,
          // A small real thickness instead of a flat plane — see
          // CAP_THICKNESS_M's comment (shadow-map banding on razor-thin
          // caps). `extruded`/`getElevation` are only spread in at all for
          // Photo mode — passing `getElevation: undefined` explicitly (an
          // object key present with value undefined, vs. the key being
          // absent) previously broke deck.gl's attribute manager on mode
          // switches ("accessor \"getElevation\" is not a function"),
          // silently leaving roads render-broken.
          ...(isPhotoreal ? { extruded: true, getElevation: CAP_THICKNESS_M } : {}),
          getFillColor: isMassing || isPhotoreal ? MASSING_ROAD_COLOR : LANDCOVER_COLORS_RGBA.road,
          pickable: true,
        })
      );

      if (!isMassing) {
        const vegData =
          isPhotoreal && ready
            ? overpassResult.vegetationFeatures.map((v) => raiseFeatureZ(v, capZ))
            : overpassResult.vegetationFeatures;
        layers.push(
          new GeoJsonLayer({
            id: "landcover-vegetation",
            data: turf.featureCollection(vegData),
            filled: true,
            stroked: isPhotoreal,
            ...(isPhotoreal ? { extruded: true, getElevation: CAP_THICKNESS_M } : {}),
            getFillColor: LANDCOVER_COLORS_RGBA.vegetation,
            getLineColor: PHOTO_BORDER_COLOR,
            lineWidthMinPixels: PHOTO_BORDER_WIDTH_PX,
            pickable: true,
          })
        );

        // Photo: water sinks below the ground plane (item 3) instead of
        // sitting flush with it — Land-cover mode keeps the existing flat
        // recolor, unchanged. Same undefined-vs-absent caveat as roads above.
        const waterPhotoColor: [number, number, number, number] = [
          LANDCOVER_COLORS_RGBA.water[0],
          LANDCOVER_COLORS_RGBA.water[1],
          LANDCOVER_COLORS_RGBA.water[2],
          WATER_FILL_ALPHA,
        ];
        layers.push(
          new GeoJsonLayer({
            id: "landcover-water",
            data: turf.featureCollection(overpassResult.waterFeatures),
            filled: true,
            stroked: isPhotoreal,
            ...(isPhotoreal ? { extruded: true, getElevation: WATER_DEPTH_M } : {}),
            getFillColor: isPhotoreal ? waterPhotoColor : LANDCOVER_COLORS_RGBA.water,
            getLineColor: PHOTO_BORDER_COLOR,
            lineWidthMinPixels: PHOTO_BORDER_WIDTH_PX,
            pickable: true,
          })
        );
      }
    }

    // §4.5 Route tool — one line per scored alternative (stable color per
    // INDEX, not per label, since labels can double up on one route) plus
    // origin/destination markers. Rendered on top of everything else so a
    // route is never hidden under an extruded building/ground layer.
    routes.forEach((r, i) => {
      layers.push(
        new GeoJsonLayer({
          id: `route-${i}`,
          data: turf.featureCollection([turf.feature(r.alt.geometry)]),
          filled: false,
          stroked: true,
          getLineColor: ROUTE_COLORS_RGBA[i] ?? ROUTE_COLORS_RGBA[ROUTE_COLORS_RGBA.length - 1],
          lineWidthMinPixels: 4,
          pickable: false,
        })
      );
    });
    if (routeOrigin) {
      layers.push(
        new ScatterplotLayer({
          id: "route-origin",
          data: [{ position: routeOrigin.lngLat }],
          getPosition: (d) => d.position,
          getFillColor: ROUTE_ORIGIN_COLOR_RGBA,
          getRadius: 8,
          radiusUnits: "pixels",
          pickable: false,
        })
      );
    }
    if (routeDestination) {
      layers.push(
        new ScatterplotLayer({
          id: "route-destination",
          data: [{ position: routeDestination.lngLat }],
          getPosition: (d) => d.position,
          getFillColor: ROUTE_DESTINATION_COLOR_RGBA,
          getRadius: 8,
          radiusUnits: "pixels",
          pickable: false,
        })
      );
    }

    overlay.setProps({ layers });
  }, [analysisData, renderMode, photorealState, routes, routeOrigin, routeDestination]);

  // §4.6 point 4 — frame the AOI in 3D once analysis completes, rather than
  // leaving the camera wherever the user last left it while drawing.
  // aoiGeometry only changes on a fresh draw, and a fresh draw always resets
  // status back to "idle" first (see AnalyzePanel's reset-on-geometry-change
  // effect) before analyzeAOI can set it to "success" again — so this fires
  // exactly once per completed analysis, not on every unrelated re-render.
  useEffect(() => {
    if (!map || analysisStatus !== "success" || !aoiGeometry) return;
    const [west, south, east, north] = turf.bbox(aoiGeometry);
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { pitch: 60, padding: { top: 100, bottom: 80, left: 60, right: 60 }, duration: 1000 }
    );
  }, [map, analysisStatus, aoiGeometry]);

  // Guarded on getLayer because the layer is only added once the "load"
  // event above fires — a toggle click in that brief window is a no-op.
  useEffect(() => {
    if (!map || !map.getLayer(ESRI_SATELLITE_LAYER_ID)) return;
    map.setLayoutProperty(
      ESRI_SATELLITE_LAYER_ID,
      "visibility",
      viewMode === "satellite" ? "visible" : "none"
    );
  }, [map, viewMode]);

  return (
    // h-[55vh] shrink-0 below `lg`: gives the map a real, fixed share of a
    // phone/tablet screen instead of collapsing to ~0 (flex-1 in a flex-col
    // with the AnalyzePanel would otherwise let the panel's natural content
    // height starve the map). At `lg`+ this reverts to the original
    // flex-1/h-auto side-by-side behavior, unchanged.
    <div className="relative h-[55vh] w-full shrink-0 lg:h-auto lg:w-auto lg:flex-1">
      <div ref={containerRef} className="h-full w-full" />
      {/* Mobile/tablet (<lg): stacked rows (search, then the view-controls
          trigger) so nothing overflows the map's width. At `lg`+: a single
          row, search on the left, view controls on the right. §4.6 bug fix —
          ViewModeToggle/RenderModeToggle (5 buttons across 2 toggles) used to
          render unconditionally side by side here and crowded/clipped labels;
          both now live inside ViewControls' collapsed-by-default panel. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex flex-col gap-2 lg:inset-x-4 lg:top-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="pointer-events-auto w-full lg:w-auto">
          <SearchBox />
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-1 self-end lg:self-auto">
          <ViewControls
            photorealDisabledReason={
              photorealState.status === "too_large"
                ? `Photo mode is unavailable for this AOI — ${photorealState.buildingCount.toLocaleString()} buildings exceeds the ${PHOTOREALISTIC_MAX_BUILDINGS}-building limit. Try a smaller AOI.`
                : null
            }
          />
          {renderMode === "photoreal" && photorealState.status === "loading" && (
            <span className="pointer-events-none rounded-full bg-surface px-2.5 py-1 text-[10px] text-fg-muted shadow-card">
              Sampling colors from satellite imagery…
            </span>
          )}
          {renderMode === "photoreal" && photorealState.status === "error" && (
            <span className="pointer-events-none rounded-full bg-surface px-2.5 py-1 text-[10px] text-red-500 shadow-card">
              Couldn&apos;t sample satellite colors — showing neutral gray instead.
            </span>
          )}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 lg:bottom-4 lg:left-4">
        <div className="pointer-events-auto">
          <DrawControl />
        </div>
        <div className="pointer-events-auto">
          <RouteControl />
        </div>
      </div>
    </div>
  );
}
