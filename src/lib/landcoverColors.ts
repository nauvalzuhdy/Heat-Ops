// Single source of truth for land-cover category colors (project.md §4.2).
// A real bug shipped from defining these twice — once as inline `barColor`
// props in AnalyzePanel.tsx, once as separate deck.gl color arrays in
// MapCanvas.tsx — which drifted out of sync (bar chart and map disagreed on
// every category). Every place that shows a land-cover color MUST import
// from here; nothing else may hardcode a land-cover hex/rgb value.
//
// Not related to lib/tempToColor.ts, which is a separate gradient for heatmap
// temperature, not land-use category.
export const LANDCOVER_COLORS = {
  building: "#3B82F6", // blue
  road: "#EAB308", // yellow
  vegetation: "#22C55E", // green
  water: "#06B6D4", // cyan — deliberately distinct from building's blue
  other: "#6B7280", // grey
} as const;

export type LandcoverCategory = keyof typeof LANDCOVER_COLORS;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** RGBA tuples derived from LANDCOVER_COLORS for deck.gl's getFillColor — never hand-copy these, they're computed from the hex above so the two can't drift. */
export const LANDCOVER_COLORS_RGBA: Record<LandcoverCategory, [number, number, number, number]> = Object.fromEntries(
  Object.entries(LANDCOVER_COLORS).map(([key, hex]) => [key, [...hexToRgb(hex), 180]])
) as Record<LandcoverCategory, [number, number, number, number]>;
