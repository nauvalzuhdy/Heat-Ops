// Shared dashboard-card hover treatment (project.md §5). A fade+slide-up
// entrance animation used to live here too (CARD_CONTAINER_VARIANTS /
// CARD_ITEM_VARIANTS, staggered via framer-motion) but was removed by a
// follow-up request — cards now render statically at their final position
// from the first frame. Only the animation *inside* each card (bar/line
// charts, count-up numbers) still animates; see OverviewPanel.tsx,
// RoiPanel.tsx, and ZoneTemperatureBarChart.tsx for those.
//
// Bug fix (project.md §5, hover-popup removal pass): this used to be
// `hover:scale-[1.02] hover:shadow-lg` — scaling a card up in place doesn't
// reflow the grid around it, so in any tight multi-column row (Overview's
// 6-card grid, ROI's 3-column grid) the enlarged card visually overlapped
// its neighbors on hover, reading exactly like an unwanted popup/overlay
// rather than a subtle hover state. Replaced with a border/shadow-only
// treatment (both already-existing tokens — --border-strong,
// --shadow-float — no new color/shadow invented) that never changes the
// card's box size, so it can never cover adjacent content.
export const CARD_HOVER_CLASS = "transition-shadow duration-200 hover:shadow-float hover:border-border-strong";
