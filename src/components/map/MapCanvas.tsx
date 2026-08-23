"use client";

import { useEffect, useRef } from "react";
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { GeoJsonLayer } from "@deck.gl/layers";
import { AmbientLight, DirectionalLight, LightingEffect } from "@deck.gl/core";
import * as turf from "@turf/turf";
import { useMapStore } from "@/store/mapStore";
import { useDrawStore } from "@/store/drawStore";
import { useAOIStore } from "@/store/aoiStore";
import { useAnalysisStore } from "@/store/analysisStore";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  MAP_STYLE_URL,
  ESRI_SATELLITE_TILE_URL,
  ESRI_SATELLITE_ATTRIBUTION,
  ESRI_SATELLITE_SOURCE_ID,
  ESRI_SATELLITE_LAYER_ID,
  ESRI_SATELLITE_MAX_ZOOM,
} from "@/lib/mapConfig";
import SearchBox from "./SearchBox";
import ViewModeToggle from "./ViewModeToggle";
import RenderModeToggle from "./RenderModeToggle";
import DrawControl from "./DrawControl";
import { LANDCOVER_COLORS_RGBA } from "@/lib/landcoverColors";

// §4.6 — Massing view (default) reads as an uncategorized 3D city model, so
// the eye reads shape + shadow rather than land-use category. Land-cover view
// recolors every category from the single shared palette in
// lib/landcoverColors.ts (§4.2) — building/road colors must NOT be redefined
// here; that duplication is exactly the bug §4.2 documents.
const MASSING_BUILDING_COLOR: [number, number, number, number] = [232, 232, 232, 235];
const MASSING_ROAD_COLOR: [number, number, number, number] = [176, 176, 176, 200];

// One AmbientLight + one shadow-casting DirectionalLight (§4.6 point 1). Built
// once at module scope — effects are static config, not per-render state.
const lightingEffect = new LightingEffect({
  ambientLight: new AmbientLight({ color: [255, 255, 255], intensity: 1.0 }),
  directionalLight: new DirectionalLight({
    color: [255, 255, 255],
    intensity: 2.0,
    direction: [-2, -3, -1],
    _shadow: true,
  }),
});

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

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE_URL,
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

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
    });

    setMap(map);

    return () => {
      useDrawStore.getState().setTerraDraw(null);
      useDrawStore.getState().setIsDrawing(false);
      useAOIStore.getState().clearAOI();
      overlayRef.current = null;
      map.remove();
      setMap(null);
    };
  }, [setMap]);

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
  // Vegetation/water only render in Land-cover mode: Massing view (§4.6) is
  // specifically about building 3D form + shadow, and neither category was
  // part of that toggle's original building/road scope — flat green/cyan
  // blobs would clutter the uncategorized-massing read without being asked
  // for. Building/road keep rendering in both modes as before.
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    const layers = [];
    const overpassResult = analysisData?.overpass.status === "ok" ? analysisData.overpass.result : null;
    const isMassing = renderMode === "massing";

    if (overpassResult) {
      layers.push(
        new GeoJsonLayer({
          id: "landcover-buildings",
          data: turf.featureCollection(overpassResult.buildingFeatures),
          filled: true,
          stroked: false,
          extruded: true,
          getElevation: (f) => f.properties.heightM,
          getFillColor: isMassing ? MASSING_BUILDING_COLOR : LANDCOVER_COLORS_RGBA.building,
          material: { ambient: 0.35, diffuse: 0.6, shininess: 32 },
          pickable: true,
        })
      );
      layers.push(
        new GeoJsonLayer({
          id: "landcover-roads",
          data: turf.featureCollection(overpassResult.roadFeatures),
          filled: true,
          stroked: false,
          getFillColor: isMassing ? MASSING_ROAD_COLOR : LANDCOVER_COLORS_RGBA.road,
          pickable: true,
        })
      );

      if (!isMassing) {
        layers.push(
          new GeoJsonLayer({
            id: "landcover-vegetation",
            data: turf.featureCollection(overpassResult.vegetationFeatures),
            filled: true,
            stroked: false,
            getFillColor: LANDCOVER_COLORS_RGBA.vegetation,
            pickable: true,
          })
        );
        layers.push(
          new GeoJsonLayer({
            id: "landcover-water",
            data: turf.featureCollection(overpassResult.waterFeatures),
            filled: true,
            stroked: false,
            getFillColor: LANDCOVER_COLORS_RGBA.water,
            pickable: true,
          })
        );
      }
    }

    overlay.setProps({ layers });
  }, [analysisData, renderMode]);

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
    <div className="relative flex-1">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-x-4 top-4 z-10 grid grid-cols-[auto_1fr_auto] items-start gap-4">
        <div className="pointer-events-auto">
          <SearchBox />
        </div>
        <div className="pointer-events-auto justify-self-center">
          <ViewModeToggle />
        </div>
        <div className="pointer-events-auto justify-self-end">
          <RenderModeToggle />
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-4 left-4 z-10">
        <div className="pointer-events-auto">
          <DrawControl />
        </div>
      </div>
    </div>
  );
}
