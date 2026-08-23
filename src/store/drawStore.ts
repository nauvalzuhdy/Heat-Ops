import { create } from "zustand";
import type { TerraDraw } from "terra-draw";

type DrawState = {
  terraDraw: TerraDraw | null;
  isDrawing: boolean;
  setTerraDraw: (terraDraw: TerraDraw | null) => void;
  setIsDrawing: (isDrawing: boolean) => void;
};

export const useDrawStore = create<DrawState>((set) => ({
  terraDraw: null,
  isDrawing: false,
  setTerraDraw: (terraDraw) => set({ terraDraw }),
  setIsDrawing: (isDrawing) => set({ isDrawing }),
}));
