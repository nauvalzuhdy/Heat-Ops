// Hotspot Detection, Satellite column (project.md §5 — Heatmap section
// redesign, Kolom 1). Renders the site's already-saved `satellite_photo_url`
// as a plain <img> with an SVG AOI-outline overlay — no live MapLibre map,
// no tile fetch of any kind. Two reasons this replaced the earlier live-map
// version:
//   1. Constraint: Kolom 1/2 must render from data already saved on the
//      `sites` row only, with zero new network requests.
//   2. Root-cause fix (see HotspotPixelGridView.tsx's header for the full
//      writeup): constructing a MapLibre map against a remote-fetched style
//      on every mount raced under React 18 dev StrictMode's double-invoke
//      and produced a permanently mis-framed map. A static <img> has no such
//      failure mode.
//
// `satellite_photo_url` is an ArcGIS Export Image (Esri World Imagery)
// fetched with bbox=turf.bbox(aoi_geometry) — see lib/arcgisSatellite.ts.
// It is NOT from FortyGuard at all (that's the Grid Thermal column next to
// it) — the caption below says "Esri" explicitly, and this column
// intentionally carries no Real/Cached attribution badge, since that
// provenance concept applies to FortyGuard/Overpass data, not a one-time
// Esri export saved alongside it.
//
// Container height: fixed to match the sibling columns (h-full from the
// parent grid cell — see HotspotPanel.tsx), image cropped with
// object-cover rather than letting the card's height follow the photo's
// own aspect ratio. An earlier version forced the container's aspect-ratio
// to the photo's native ratio, which for a portrait-shaped AOI (taller bbox
// than wide) made this column much taller than its siblings and forced a
// page scroll to see the whole row — the fix is a plain h-full box; the SVG
// overlay already scales for a "cover" crop via preserveAspectRatio="xMidYMid
// slice", so the AOI outline stays pixel-accurate under cropping too.
//
// SpatialZoneOverlay (zone-chart merge pass): a permanent 3x3 grid + compass
// label drawn on TOP of this same satellite photo, deliberately kept as its
// own SVG layer rather than merged into HotspotPixelGridView's per-tile
// pixel-thermal grid next door — those are two different scales (this is
// "which named region is this", the pixel grid is "what temperature is this
// exact spot"), mixing the COLOR SCALES would make both harder to read. Uses
// the exact same lib/heatmapUtils.ts zoneLabel() the bar chart uses, and the
// exact same zoneLngLatBounds() math HotspotPixelGridView already trusts for
// its own per-cell rectangles, projected through this column's own
// computeSatelliteImageFrame() so the boxes land pixel-accurate under the
// "cover" crop.
//
// The scales stay separate, but the cross-highlight does NOT: hovering a
// zone here (or a chart bar) also lights up the matching group of pixel
// cells in HotspotPixelGridView — see its own header for how it classifies
// each cell into one of these same 9 zones.
"use client";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { Polygon } from "geojson";
import { computeSatelliteImageFrame } from "@/lib/satelliteImageProjection";
import { AOI_OUTLINE_HEX } from "@/lib/aoiOverlayStyle";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";
import { zoneLngLatBounds, type OverlayZone } from "@/lib/heatmapUtils";

function AoiOutlineSvg({ frame, points }: { frame: { widthPx: number; heightPx: number }; points: string }) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${frame.widthPx} ${frame.heightPx}`}
      preserveAspectRatio="xMidYMid slice"
    >
      <polygon
        points={points}
        fill="none"
        stroke={AOI_OUTLINE_HEX}
        strokeWidth={3}
        strokeLinejoin="round"
        style={{ filter: "drop-shadow(0 0 2px rgba(0,0,0,0.85))" }}
      />
    </svg>
  );
}

// Permanent grid-line + label overlay — see file header. Each cell is a real
// interactive <rect> (mouse enter/leave drives the cross-highlight lifted to
// HotspotPanel; click forwards to the same zoom handler the photo itself
// uses, so this overlay doesn't remove the pre-existing "click photo to
// zoom" feature even though it now visually covers the whole image).
function SpatialZoneOverlay({
  frame,
  bbox,
  zones,
  highlightedZoneId,
  onZoneHover,
  onCellClick,
}: {
  frame: { widthPx: number; heightPx: number; project: (lng: number, lat: number) => { x: number; y: number } };
  bbox: [number, number, number, number];
  zones: OverlayZone[];
  highlightedZoneId?: string | null;
  onZoneHover?: (zoneId: string | null) => void;
  onCellClick?: () => void;
}) {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox={`0 0 ${frame.widthPx} ${frame.heightPx}`}
      preserveAspectRatio="xMidYMid slice"
    >
      {zones.map((zone) => {
        const [west, south, east, north] = zoneLngLatBounds(bbox, zone.row, zone.col);
        const topLeft = frame.project(west, north);
        const bottomRight = frame.project(east, south);
        const x = Math.min(topLeft.x, bottomRight.x);
        const y = Math.min(topLeft.y, bottomRight.y);
        const width = Math.abs(bottomRight.x - topLeft.x);
        const height = Math.abs(bottomRight.y - topLeft.y);
        const cx = x + width / 2;
        const cy = y + height / 2;
        const highlighted = zone.id === highlightedZoneId;

        return (
          <g
            key={zone.id}
            onMouseEnter={() => onZoneHover?.(zone.id)}
            onMouseLeave={() => onZoneHover?.(null)}
            onClick={onCellClick}
            style={{ cursor: "zoom-in" }}
          >
            {/* Hit target + fill — transparent normally, tinted accent when
                highlighted so the connection to the chart bar is unmistakable
                (a thick, high-contrast border, not a subtle tint alone). */}
            <rect
              x={x}
              y={y}
              width={width}
              height={height}
              fill={highlighted ? "var(--accent-soft-bg)" : "transparent"}
              stroke={highlighted ? "var(--accent)" : "rgba(255,255,255,0.55)"}
              strokeWidth={highlighted ? 4 : 1.5}
              style={{
                filter: highlighted ? "drop-shadow(0 0 6px var(--accent))" : "drop-shadow(0 0 1.5px rgba(0,0,0,0.9))",
                transition: "stroke-width 120ms ease, fill 120ms ease",
              }}
            />
            <text
              x={cx}
              y={zone.meanTempC != null ? cy - 6 : cy}
              textAnchor="middle"
              fontSize={highlighted ? 12 : 11}
              fontWeight={highlighted ? 700 : 600}
              fill={highlighted ? "var(--accent)" : "#FFFFFF"}
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))", pointerEvents: "none" }}
            >
              {zone.label}
            </text>
            {zone.meanTempC != null && (
              <text
                x={cx}
                y={cy + 10}
                textAnchor="middle"
                fontSize={10}
                fill={highlighted ? "var(--accent)" : "rgba(255,255,255,0.85)"}
                style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))", pointerEvents: "none" }}
              >
                {zone.meanTempC.toFixed(1)}°C
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Lightbox({
  photoUrl,
  frame,
  points,
  onClose,
}: {
  photoUrl: string;
  frame: { widthPx: number; heightPx: number };
  points: string;
  onClose: () => void;
}) {
  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/85 p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={20} />
      </button>
      <div
        className="relative max-h-[90vh] max-w-[90vw]"
        style={{ aspectRatio: `${frame.widthPx} / ${frame.heightPx}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl} alt="Satellite reference photo — full size" className="h-full max-h-[90vh] w-auto max-w-[90vw] object-contain" />
        <AoiOutlineSvg frame={frame} points={points} />
      </div>
    </div>,
    document.body
  );
}

export default function HotspotSatelliteView({
  aoiGeometry,
  bbox,
  satellitePhotoUrl,
  zones,
  highlightedZoneId,
  onZoneHover,
}: {
  aoiGeometry: Polygon;
  bbox?: [number, number, number, number] | null;
  satellitePhotoUrl: string | null;
  /** When provided (with `bbox`), draws the permanent 3x3 zone grid + compass label overlay. */
  zones?: OverlayZone[];
  highlightedZoneId?: string | null;
  onZoneHover?: (zoneId: string | null) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const frame = useMemo(() => computeSatelliteImageFrame(aoiGeometry), [aoiGeometry]);
  const ring = aoiGeometry.coordinates[0];
  const points = useMemo(
    () => ring.map(([lng, lat]) => frame.project(lng, lat)).map((p) => `${p.x},${p.y}`).join(" "),
    [ring, frame]
  );

  if (!satellitePhotoUrl) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 rounded-card-md border border-dashed border-border-subtle bg-surface p-4 text-center shadow-card">
        <p className="text-xs font-medium text-fg-muted">No satellite photo saved</p>
        <p className="text-[11px] text-fg-muted">
          This site was saved before satellite export photos were captured.
        </p>
      </div>
    );
  }

  const hasZoneOverlay = !!bbox && !!zones && zones.length > 0;

  return (
    <div
      className={`relative flex h-full w-full flex-col overflow-hidden rounded-card-md border border-border-subtle shadow-card ${CARD_HOVER_CLASS}`}
    >
      <div className="relative block h-full w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={satellitePhotoUrl} alt="Satellite reference photo" className="h-full w-full object-cover" />
        <AoiOutlineSvg frame={frame} points={points} />
        {hasZoneOverlay ? (
          <SpatialZoneOverlay
            frame={frame}
            bbox={bbox as [number, number, number, number]}
            zones={zones as OverlayZone[]}
            highlightedZoneId={highlightedZoneId}
            onZoneHover={onZoneHover}
            onCellClick={() => setZoomed(true)}
          />
        ) : (
          // No zone data (e.g. no heat tiles saved) — fall back to the
          // original whole-image click-to-zoom button, unchanged.
          <button
            type="button"
            onClick={() => setZoomed(true)}
            className="absolute inset-0 h-full w-full cursor-zoom-in"
            aria-label="View full-size satellite photo"
          />
        )}
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/70 px-2.5 py-1.5 text-[10px] text-white">
        📷 Satellite — Esri World Imagery (ArcGIS Export)
      </div>

      {zoomed && (
        <Lightbox photoUrl={satellitePhotoUrl} frame={frame} points={points} onClose={() => setZoomed(false)} />
      )}
    </div>
  );
}
