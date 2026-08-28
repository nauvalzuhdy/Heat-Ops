// Fire/thermal colormap (dark blue-purple -> red -> orange -> bright
// yellow) for Operational Analyst §5's Heat Points column — single source
// of truth for both the per-point dot colors and the legend colorbar below
// them, so the two can never be defined twice and drift apart (same
// reasoning as lib/landcoverColors.ts for land-cover).
//
// Deliberately NOT lib/tempToColor.ts's green->yellow->orange->red ramp
// (that one is anchored to fixed absolute NIOSH-aligned thresholds for a
// different, unrelated visualization — Map View's heatmap image / the
// zone bar chart). This scale's domain is each site's OWN min/max
// heat_tiles temperature, not a fixed global range — a mild 25°C site and a
// scorching 40°C site each get their own full dark->yellow spread.
type RGB = readonly [number, number, number];

export const THERMAL_COLOR_STOPS: { t: number; rgb: RGB }[] = [
  { t: 0, rgb: [13, 8, 60] }, // dark blue-purple — coolest
  { t: 0.25, rgb: [84, 20, 105] }, // purple/magenta
  { t: 0.5, rgb: [186, 43, 62] }, // red
  { t: 0.75, rgb: [237, 106, 23] }, // orange
  { t: 1, rgb: [255, 231, 68] }, // bright yellow — hottest
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Normalized position (0=coolest, 1=hottest) along the ramp -> [r,g,b]. */
export function thermalColorAt(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < THERMAL_COLOR_STOPS.length - 1; i++) {
    const a = THERMAL_COLOR_STOPS[i];
    const b = THERMAL_COLOR_STOPS[i + 1];
    if (clamped >= a.t && clamped <= b.t) {
      const localT = (clamped - a.t) / (b.t - a.t || 1);
      return [
        Math.round(lerp(a.rgb[0], b.rgb[0], localT)),
        Math.round(lerp(a.rgb[1], b.rgb[1], localT)),
        Math.round(lerp(a.rgb[2], b.rgb[2], localT)),
      ];
    }
  }
  const last = THERMAL_COLOR_STOPS[THERMAL_COLOR_STOPS.length - 1];
  return [last.rgb[0], last.rgb[1], last.rgb[2]];
}

/**
 * Absolute temperature -> color, scaled against this specific site's own
 * min/max (e.g. from its saved `heat_stats`) rather than a fixed constant.
 * `minC === maxC` (a single-tile or perfectly uniform site) falls back to
 * the ramp's midpoint instead of dividing by zero.
 */
export function thermalColorForTemp(tempC: number, minC: number, maxC: number): [number, number, number] {
  const span = maxC - minC;
  const t = span > 0 ? (tempC - minC) / span : 0.5;
  return thermalColorAt(t);
}

/**
 * CSS gradient built from the exact same stops the dots use — the legend
 * colorbar is a rendering of this scale, not a second hand-typed gradient.
 */
export function thermalGradientCss(): string {
  const stops = THERMAL_COLOR_STOPS.map(
    (s) => `rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]}) ${Math.round(s.t * 100)}%`
  );
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
