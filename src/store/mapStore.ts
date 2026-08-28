import { create } from "zustand";
import type { Map as MapLibreMap } from "maplibre-gl";

export type ViewMode = "schematic" | "satellite";
// Independent of ViewMode (basemap choice): this toggles the deck.gl
// building/road styling — Massing favors the 3D form + shadow (§4.6),
// Land-cover keeps the category recolor (blue buildings, yellow roads),
// Photoreal colors each building roof from the real satellite image
// (lib/photorealisticMassing.ts) — an ADDITIONAL mode, not a replacement.
export type RenderMode = "massing" | "landcover" | "photoreal";

type MapState = {
  map: MapLibreMap | null;
  viewMode: ViewMode;
  renderMode: RenderMode;
  setMap: (map: MapLibreMap | null) => void;
  setViewMode: (mode: ViewMode) => void;
  setRenderMode: (mode: RenderMode) => void;
};

export const useMapStore = create<MapState>((set) => ({
  map: null,
  viewMode: "schematic",
  renderMode: "massing",
  setMap: (map) => set({ map }),
  setViewMode: (viewMode) => set({ viewMode }),
  setRenderMode: (renderMode) => set({ renderMode }),
}));
