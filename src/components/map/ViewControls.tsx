"use client";

// §4.6 bug fix — the map's view-mode controls (Schematic/Satellite +
// Massing/Land-cover/Photo, 5 buttons across 2 independent toggles) used to
// render side by side unconditionally, which crowded/clipped labels once the
// AOI toolbar and Photo-mode status badges were also competing for the same
// strip of space (worst on narrow/mobile widths, but tight on desktop too).
// Collapsed by default into one compact "View mode" trigger; expanding it
// reveals both toggles stacked with full, unclipped labels. The two toggles
// stay functionally independent (base map vs. 3D render mode are orthogonal,
// e.g. Satellite+Massing is a valid combination) — this only changes the
// container around them, not their logic (ViewModeToggle.tsx/
// RenderModeToggle.tsx are unmodified).
//
// Open/closed is local component state, not global store state: nothing
// outside this component needs to read or react to it, and picking a mode
// option only ever touches mapStore's viewMode/renderMode, never this flag —
// so it never resets just from choosing a different mode, for as long as
// MapCanvas stays mounted (i.e. the whole Map View session).
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ViewModeToggle from "./ViewModeToggle";
import RenderModeToggle from "./RenderModeToggle";

const LayersIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.75} stroke="currentColor" className="h-4 w-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="m12 3.75 8.25 4.5-8.25 4.5-8.25-4.5 8.25-4.5Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 12.75 8.25 4.5 8.25-4.5" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth={1.75}
    stroke="currentColor"
    className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
  </svg>
);

export default function ViewControls({
  photorealDisabledReason,
}: {
  photorealDisabledReason?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2 px-3 py-1.5 text-xs font-medium text-fg-secondary shadow-card transition-colors hover:text-fg-primary"
      >
        <LayersIcon />
        View mode
        <ChevronIcon open={expanded} />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="w-full overflow-hidden"
          >
            <div className="flex flex-col items-end gap-3 rounded-lg border border-border-subtle bg-surface p-3 shadow-card">
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">Base map</span>
                <ViewModeToggle />
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">3D render</span>
                <RenderModeToggle photorealDisabledReason={photorealDisabledReason} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
