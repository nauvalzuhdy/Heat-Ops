// Single shared AOI-outline style for Hotspot Detection's 3-column redesign
// (Operational Analyst §5) — same reasoning as lib/landcoverColors.ts: the
// AOI boundary line must read as "the same thing" across Satellite, Grid
// Zones, and 3D Heat Zones, so its color is defined once here rather than
// hardcoded 3 times and risking drift.
export const AOI_OUTLINE_HEX = "#FDE047"; // tailwind yellow-300 — contrasts against both satellite photo colors and the blue->red temp tint
export const AOI_OUTLINE_RGB: [number, number, number] = [253, 224, 71];
