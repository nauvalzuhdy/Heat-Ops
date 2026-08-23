import { create } from "zustand";
import * as turf from "@turf/turf";
import type { Polygon } from "geojson";
import { MAX_AOI_AREA_SQKM } from "@/lib/mapConfig";

type AOIState = {
  geometry: Polygon | null;
  areaSqKm: number | null;
  isOverAreaLimit: boolean;
  setAOI: (geometry: Polygon) => void;
  clearAOI: () => void;
};

export const useAOIStore = create<AOIState>((set) => ({
  geometry: null,
  areaSqKm: null,
  isOverAreaLimit: false,
  setAOI: (geometry) => {
    const areaSqKm = turf.area(geometry) / 1_000_000;
    set({ geometry, areaSqKm, isOverAreaLimit: areaSqKm > MAX_AOI_AREA_SQKM });
  },
  clearAOI: () => set({ geometry: null, areaSqKm: null, isOverAreaLimit: false }),
}));
