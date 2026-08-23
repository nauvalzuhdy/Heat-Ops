// Maps a tile temperature (°C) to a green -> yellow -> orange -> red color,
// anchored to fixed absolute thresholds rather than the current AOI's own
// min/max — so a mild 25°C site and a scorching 40°C site are never both
// forced onto the same "coolest to hottest" gradient.
//
// Thresholds are landmarked on the published NIOSH/OSHA-NIOSH heat-stress
// flag system (the WBGT-based Low/Moderate/High/Very-High risk bands used in
// the OSHA-NIOSH Heat Safety Tool and outdoor-worker heat flag programs,
// themselves aligned with ISO 7243's WBGT reference values): ~26.7°C (80°F),
// ~29.4°C (85°F), ~31.1°C (88°F). FortyGuard's tile value is a surface/air
// temperature, not a true WBGT (which needs humidity, wind, and radiant heat
// FortyGuard doesn't return) — these thresholds are used here as a visual
// proxy for relative heat-stress risk, not a certified WBGT classification.
export const HEAT_RISK_THRESHOLDS_C = {
  low: 26.7,
  moderate: 29.4,
  high: 31.1,
  extreme: 33.3,
} as const;

export const HEAT_RISK_COLORS = {
  low: [34, 197, 94] as const, // green
  moderate: [234, 179, 8] as const, // yellow
  high: [249, 115, 22] as const, // orange
  extreme: [239, 68, 68] as const, // red
};

type RGB = readonly [number, number, number];

function lerpColor(from: RGB, to: RGB, t: number): [number, number, number] {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ];
}

export function tempToColor(tempC: number): [number, number, number] {
  const { low, moderate, high, extreme } = HEAT_RISK_THRESHOLDS_C;
  const { low: green, moderate: yellow, high: orange, extreme: red } = HEAT_RISK_COLORS;

  if (tempC <= low) return [...green];
  if (tempC <= moderate) return lerpColor(green, yellow, (tempC - low) / (moderate - low));
  if (tempC <= high) return lerpColor(yellow, orange, (tempC - moderate) / (high - moderate));
  if (tempC <= extreme) return lerpColor(orange, red, (tempC - high) / (extreme - high));
  return [...red];
}
