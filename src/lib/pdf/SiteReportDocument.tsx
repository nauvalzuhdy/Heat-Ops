// PDF report layout (project.md §5: "compile chart + rekomendasi headline +
// ringkasan naratif dari AI Copilot jadi 1 PDF"). Built with @react-pdf/renderer
// (project.md §3's own choice over WeasyPrint — this is a Node/Next.js app,
// not Python, so a JS-native renderer avoids a second runtime). Charts are
// hand-drawn with react-pdf's Svg/Rect primitives (Recharts is a DOM/canvas
// library, not usable inside react-pdf's own renderer) — colors intentionally
// reuse lib/landcoverColors.ts and lib/tempToColor.ts's exact gradients
// rather than picking new ones, so a PDF a user prints matches what they saw
// on screen in Map View / Operational Analyst.
//
// Visual redesign pass (professional-report style, confirmed with the user:
// light/neutral background, not the dashboard's dark theme — this report was
// ALREADY light-background before this pass, just plainly laid out; nothing
// here is a dark→light conversion, it's cover page + header/footer + section
// numbering + figure captions + a cleaner attribution-badge treatment layered
// onto the same light page). Every color below is copied from this project's
// own light-mode design tokens (app/globals.css's :root block / lib/severity.ts's
// light values) rather than inventing a new print-only palette — see COLORS
// below for the exact source of each value. This pass is STYLING ONLY: every
// number, label, and section's underlying data/computation is byte-identical
// to before — only how it's laid out on the page changed.
import { Fragment } from "react";
import { Document, Page, View, Text, StyleSheet, Svg, Rect, Polygon, Polyline, Line, Image, Defs, LinearGradient, Stop } from "@react-pdf/renderer";
import type { Polygon as GeoPolygon } from "geojson";
import { LANDCOVER_COLORS } from "../landcoverColors";
import { tempToColor } from "../tempToColor";
import { computeSatelliteImageFrame } from "../satelliteImageProjection";
import { AOI_OUTLINE_HEX } from "../aoiOverlayStyle";
import { THERMAL_COLOR_STOPS, thermalColorForTemp } from "../thermalColorScale";
import { zoneLngLatBounds, isSpatiallyUniform } from "../heatmapUtils";
import {
  overallShiftRisk,
  SHIFT_RISK_RECOMMENDATION,
  ASSUMED_RELATIVE_HUMIDITY_PCT,
  summarizeHumidityProvenance,
  WORKLOAD_LABEL,
  ACCLIMATIZATION_LABEL,
  type ShiftRisk,
  type ForecastTimelineSlot,
} from "../wbgt";
import type { ROIResult } from "../roiSimulator";
import { formatOutcomeSegments } from "../siteOutcome";
import type { SiteReportData } from "../reportData";

// Mirrors components/analyst/AttributionBadge.tsx's exact vocabulary
// (Real/Cached/N/A) — that component renders an HTML/Tailwind pill, which
// react-pdf's renderer can't use directly, so the label text is duplicated
// here rather than the component itself.
const ATTRIBUTION_LABEL: Record<string, string> = { real: "Real", synthetic: "Cached", unavailable: "N/A" };

// Print-safe light palette — every value copied from app/globals.css's :root
// (light mode) block or lib/severity.ts's light-mode tokens, not invented
// here. react-pdf can't read CSS custom properties (no var() support in its
// renderer), so these are literal copies, same pattern this file already
// used for ATTRIBUTION_LABEL and the thermal/landcover color imports above.
const COLORS = {
  ink: "#17170F", // --fg-primary (light)
  inkSecondary: "#5B5B52", // --fg-secondary (light)
  inkMuted: "#8A8A7E", // --fg-muted (light)
  borderSubtle: "#E6E5DF", // --border-subtle (light)
  borderStrong: "#D4D3CB", // --border-strong (light)
  surface: "#FFFFFF",
  accent: "#6E8F2A", // --accent (light)
  accentStrong: "#5C7A21", // --accent-strong (light)
  // --accent-soft-bg (light) is rgba(110, 143, 42, 0.10); flattened here to
  // the opaque hex it composites to over white. react-pdf can render rgba,
  // but a translucent fill is at the mercy of whatever a PDF viewer or
  // printer does with transparency — an opaque value prints identically
  // everywhere, and this band must stay legible on paper.
  accentSoftBg: "#F3F6E9",
  // --status-real/cached/unavailable (light) — the same provenance concept
  // AttributionBadge.tsx renders on screen, reused here rather than a
  // separate print palette.
  statusReal: "#2F9E5B",
  statusRealBg: "#EAF7EF",
  statusCached: "#B8860B",
  statusCachedBg: "#FBF2DF",
  statusUnavailable: "#8A8A7E",
  statusUnavailableBg: "#F1F1EE",
  // lib/severity.ts's light-mode nominal/caution/critical — Shift Schedule's
  // safe/caution/danger reuses these exactly (see RISK_COLORS below), the
  // same tokens ShiftSchedulePanel.tsx's dashboard version now reads, instead
  // of this file's previous separately-invented emerald/amber pair.
  severityNominal: "#2F9E5B",
  severityCaution: "#B8860B",
  severityCritical: "#DC2626",
} as const;

const styles = StyleSheet.create({
  // --- Cover page -----------------------------------------------------
  coverPage: { padding: 0, fontFamily: "Helvetica", color: COLORS.ink },
  coverAccentBar: { height: 10, backgroundColor: COLORS.accent },
  coverContent: { padding: 48, flexGrow: 1, justifyContent: "space-between" },
  coverBrandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  coverBrand: { fontSize: 13, fontWeight: 700, letterSpacing: 1.5, color: COLORS.accentStrong, textTransform: "uppercase" },
  coverMetaTop: { fontSize: 9, color: COLORS.inkMuted },
  coverTitleBlock: { marginTop: 150 },
  coverEyebrow: { fontSize: 11, color: COLORS.inkMuted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12 },
  coverTitle: { fontSize: 30, fontWeight: 700, color: COLORS.ink, lineHeight: 1.2 },
  coverSiteName: { fontSize: 20, fontWeight: 700, color: COLORS.accentStrong, marginTop: 16 },
  coverMetaBlock: { flexDirection: "row", gap: 28, marginBottom: 16 },
  coverMetaLabel: { fontSize: 8, color: COLORS.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  coverMetaValue: { fontSize: 12, fontWeight: 700, color: COLORS.ink },
  coverFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    paddingTop: 12,
  },
  coverFooterText: { fontSize: 8, color: COLORS.inkMuted },

  // --- Body page + running header/footer -------------------------------
  page: { paddingTop: 64, paddingBottom: 54, paddingHorizontal: 40, fontSize: 10, fontFamily: "Helvetica", color: COLORS.ink },
  pageHeader: {
    position: "absolute",
    top: 26,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderSubtle,
    paddingBottom: 8,
  },
  pageHeaderBrand: { fontSize: 8, fontWeight: 700, color: COLORS.accentStrong, textTransform: "uppercase", letterSpacing: 1 },
  pageHeaderSite: { fontSize: 8, color: COLORS.inkMuted },
  pageFooter: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderSubtle,
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  pageFooterText: { fontSize: 7.5, color: COLORS.inkMuted, maxWidth: 400 },

  // --- Section headers ---------------------------------------------------
  sectionBlock: { marginTop: 20 },
  sectionEyebrow: { fontSize: 8, fontWeight: 700, color: COLORS.accentStrong, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 3 },
  sectionHeading: { fontSize: 13, fontWeight: 700, color: COLORS.ink },
  sectionSubtitle: { fontSize: 9, color: COLORS.inkMuted, marginTop: 3 },
  sectionRule: { height: 1, backgroundColor: COLORS.borderSubtle, marginTop: 8, marginBottom: 10 },

  // --- Executive-summary stat cards ---------------------------------------
  // Headline outcome band — the report's single quotable sentence, sitting
  // above the four Executive Summary stat cards. Left accent rule + tinted
  // ground so it reads as a pull-quote, not a fifth stat card.
  outcomeBand: {
    borderWidth: 1,
    borderColor: COLORS.accent,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.accentStrong,
    backgroundColor: COLORS.accentSoftBg,
    padding: 10,
    marginBottom: 12,
  },
  outcomeEyebrow: {
    fontSize: 7.5,
    fontWeight: 700,
    color: COLORS.accentStrong,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 5,
  },
  outcomeNowText: { fontSize: 9.5, lineHeight: 1.4, color: COLORS.ink, marginBottom: 8 },
  outcomeProvenance: { fontSize: 7.5, color: COLORS.statusCached, marginBottom: 6 },
  outcomeSplitRow: { flexDirection: "row", alignItems: "flex-end", gap: 14 },
  outcomeCol: { flex: 1 },
  outcomeLabel: { fontSize: 7.5, color: COLORS.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  outcomeAction: { fontSize: 9.5, fontWeight: 700, color: COLORS.ink },
  outcomeDelta: { fontSize: 20, fontWeight: 700, color: COLORS.accentStrong },
  outcomeEconomics: { fontSize: 8.5, color: COLORS.inkSecondary, marginTop: 6 },
  executiveRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, borderWidth: 1, borderColor: COLORS.borderSubtle, borderTopWidth: 3, borderTopColor: COLORS.accent, padding: 10 },
  statLabel: { fontSize: 7.5, color: COLORS.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  statValue: { fontSize: 15, fontWeight: 700, color: COLORS.ink, marginBottom: 5 },

  // --- Small clean attribution/status badge (legend-style, not a garish
  // dashboard pill) — a light tint background with dark-enough text to still
  // read correctly if the PDF is printed or viewed in grayscale, since the
  // WORD itself ("Real"/"Cached"/"N/A") already carries the meaning and never
  // depends on color alone. -----------------------------------------------
  badge: { borderRadius: 2, paddingHorizontal: 5, paddingVertical: 2, alignSelf: "flex-start" },
  badgeText: { fontSize: 7, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 },

  bodyText: { fontSize: 10, lineHeight: 1.5, color: COLORS.inkSecondary },
  caveat: { fontSize: 8.5, lineHeight: 1.4, color: COLORS.inkMuted, marginTop: 4, fontStyle: "italic" },
  table: { marginTop: 4 },
  tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.borderSubtle, paddingVertical: 4 },
  tableHeaderRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: COLORS.borderStrong, paddingBottom: 4, marginBottom: 2 },
  tableCellZone: { width: 60, fontSize: 9 },
  tableCellTemp: { width: 70, fontSize: 9 },
  tableCellLevel: { width: 70, fontSize: 9, textTransform: "capitalize" },
  tableHeaderText: { fontSize: 8, color: COLORS.inkMuted, textTransform: "uppercase" },
  legendRow: { flexDirection: "row", gap: 10, marginTop: 6, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendText: { fontSize: 8, color: COLORS.inkSecondary },
  imagesRow: { flexDirection: "row", gap: 12, marginTop: 4 },
  imageColumn: { flex: 1 },
  imageFrame: { position: "relative", borderWidth: 1, borderColor: COLORS.borderSubtle },
  imageCaption: { fontSize: 7.5, color: COLORS.inkSecondary, marginTop: 4 },
  imageLegendRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  imageLegendText: { fontSize: 7.5, color: COLORS.inkSecondary },
  imageFallback: { fontSize: 8.5, color: COLORS.inkMuted, padding: 10, borderWidth: 1, borderColor: COLORS.borderSubtle, borderStyle: "dashed" },
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// Attribution badge — a small tinted-background label, same Real/Cached/N/A
// vocabulary and same underlying site.attribution value as the dashboard's
// AttributionBadge.tsx, just rendered as a react-pdf View/Text pair instead
// of an HTML pill.
function AttributionBadgePdf({ status }: { status: "real" | "synthetic" | "unavailable" }) {
  const tone =
    status === "real"
      ? { fg: COLORS.statusReal, bg: COLORS.statusRealBg }
      : status === "synthetic"
        ? { fg: COLORS.statusCached, bg: COLORS.statusCachedBg }
        : { fg: COLORS.statusUnavailable, bg: COLORS.statusUnavailableBg };
  return (
    <View style={[styles.badge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.badgeText, { color: tone.fg }]}>{ATTRIBUTION_LABEL[status]}</Text>
    </View>
  );
}

function SectionHeader({ index, title, subtitle }: { index: number; title: string; subtitle: string }) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={styles.sectionEyebrow}>{`Section ${String(index).padStart(2, "0")}`}</Text>
      <Text style={styles.sectionHeading}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
      <View style={styles.sectionRule} />
    </View>
  );
}

function LandcoverBar({ landcover }: { landcover: SiteReportData["site"]["landcover"] }) {
  if (!landcover) {
    return <Text style={styles.bodyText}>Land-cover data unavailable for this site.</Text>;
  }
  const width = 495;
  const height = 14;
  const segments: { key: keyof typeof LANDCOVER_COLORS; label: string; pct: number }[] = [
    { key: "building", label: "Building", pct: landcover.buildingPct },
    { key: "road", label: "Road", pct: landcover.roadPct },
    { key: "vegetation", label: "Vegetation", pct: landcover.vegetationPct },
    { key: "water", label: "Water", pct: landcover.waterPct },
    { key: "other", label: "Other", pct: landcover.otherPct },
  ];
  let x = 0;
  return (
    <View>
      <Svg width={width} height={height}>
        {segments.map((s) => {
          const w = Math.max(0, (s.pct / 100) * width);
          const rect = <Rect key={s.key} x={x} y={0} width={w} height={height} fill={LANDCOVER_COLORS[s.key]} />;
          x += w;
          return rect;
        })}
      </Svg>
      <View style={styles.legendRow}>
        {segments.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: LANDCOVER_COLORS[s.key] }]} />
            <Text style={styles.legendText}>
              {s.label} {s.pct.toFixed(0)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// Shared by both image sections below — sizes the displayed image to fit a
// max box while preserving the saved photo's real aspect ratio ("contain",
// not the dashboard's "cover"/crop: a printed report benefits more from
// showing the AOI's full extent uncropped than from filling a fixed-height
// card, which was purely a UI layout constraint, not a correctness one).
const MAX_IMG_WIDTH = 237;
const MAX_IMG_HEIGHT = 300;

function computeDisplaySize(widthPx: number, heightPx: number): { width: number; height: number } {
  let width = MAX_IMG_WIDTH;
  let height = (heightPx / widthPx) * width;
  if (height > MAX_IMG_HEIGHT) {
    height = MAX_IMG_HEIGHT;
    width = (widthPx / heightPx) * height;
  }
  return { width, height };
}

function aoiPolygonPoints(
  aoiGeometry: GeoPolygon,
  project: (lng: number, lat: number) => { x: number; y: number }
): string {
  return aoiGeometry.coordinates[0]
    .map(([lng, lat]) => {
      const p = project(lng, lat);
      return `${p.x},${p.y}`;
    })
    .join(" ");
}

// Zone grid overlay — the SAME 3x3 boundaries (zoneLngLatBounds()) and SAME
// compass labels (each zone's own already-computed `zoneLabel`) as
// Operational Analyst's HotspotSatelliteView.tsx draws on its Satellite
// column. This was missing entirely from the PDF's images before (audit
// finding) — dropped in here as plain Svg children so both image sections
// below can include it inside their existing outline <Svg>, rather than a
// second overlay layer.
function ZoneOverlayElements({
  frame,
  bbox,
  zones,
}: {
  frame: ReturnType<typeof computeSatelliteImageFrame>;
  bbox: [number, number, number, number];
  zones: SiteReportData["hotspotZones"];
}) {
  return (
    <>
      {zones.map((zone) => {
        const [west, south, east, north] = zoneLngLatBounds(bbox, zone.row, zone.col);
        const topLeft = frame.project(west, north);
        const bottomRight = frame.project(east, south);
        const x = Math.min(topLeft.x, bottomRight.x);
        const y = Math.min(topLeft.y, bottomRight.y);
        const w = Math.abs(bottomRight.x - topLeft.x);
        const h = Math.abs(bottomRight.y - topLeft.y);
        return (
          <Fragment key={zone.zoneLabel}>
            <Rect x={x} y={y} width={w} height={h} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={1} />
            <Text x={x + w / 2} y={y + h / 2} style={{ fontSize: 8, fontWeight: 700 }}>
              {zone.zoneLabel}
            </Text>
          </Fragment>
        );
      })}
    </>
  );
}

// Satellite image section — same source lib/arcgisSatellite.ts saves and
// Operational Analyst's HotspotSatelliteView.tsx renders: an ArcGIS Export
// Image (Esri World Imagery), full AOI-bbox coverage, not FortyGuard. AOI
// outline projected with the exact same lib/satelliteImageProjection.ts
// frame math the dashboard uses, so the line lands in the same place.
function SatelliteImageSection({
  aoiGeometry,
  photoBuffer,
  bbox,
  zones,
}: {
  aoiGeometry: GeoPolygon;
  photoBuffer: Buffer;
  bbox: [number, number, number, number] | null;
  zones: SiteReportData["hotspotZones"];
}) {
  const frame = computeSatelliteImageFrame(aoiGeometry);
  const { width, height } = computeDisplaySize(frame.widthPx, frame.heightPx);
  const points = aoiPolygonPoints(aoiGeometry, frame.project);

  return (
    <View style={styles.imageColumn}>
      <View style={[styles.imageFrame, { width, height }]}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive, not an HTML <img>; it has no alt prop */}
        <Image src={{ data: photoBuffer, format: "png" }} style={{ width, height }} />
        <Svg
          width={width}
          height={height}
          viewBox={`0 0 ${frame.widthPx} ${frame.heightPx}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {bbox && zones.length > 0 && <ZoneOverlayElements frame={frame} bbox={bbox} zones={zones} />}
          <Polygon points={points} stroke={AOI_OUTLINE_HEX} strokeWidth={3} fill="none" />
        </Svg>
      </View>
      <Text style={styles.imageCaption}>Figure 1. Satellite — Esri World Imagery (ArcGIS Export)</Text>
    </View>
  );
}

// Heatmap Grid image section — identical cell data
// (lib/hotspotGridCells.ts's computeHotspotGridCells(), precomputed once in
// lib/reportData.ts as data.heatGrid) and identical fire/thermal color scale
// (lib/thermalColorScale.ts) as Operational Analyst's HotspotPixelGridView.tsx,
// so this can never draw a different grid for the same site — no second,
// independently re-derived drawing logic. Source is FortyGuard heat_tiles,
// not Esri and not Overpass.
function HeatmapGridImageSection({
  aoiGeometry,
  photoBuffer,
  heatGrid,
  minC,
  maxC,
  bbox,
  zones,
}: {
  aoiGeometry: GeoPolygon;
  photoBuffer: Buffer;
  heatGrid: SiteReportData["heatGrid"] & {};
  minC: number;
  maxC: number;
  bbox: [number, number, number, number] | null;
  zones: SiteReportData["hotspotZones"];
}) {
  const frame = computeSatelliteImageFrame(aoiGeometry);
  const { width, height } = computeDisplaySize(frame.widthPx, frame.heightPx);
  const points = aoiPolygonPoints(aoiGeometry, frame.project);

  return (
    <View style={styles.imageColumn}>
      <View style={[styles.imageFrame, { width, height }]}>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf's own Image primitive, not an HTML <img>; it has no alt prop */}
        <Image src={{ data: photoBuffer, format: "png" }} style={{ width, height }} />
        <Svg
          width={width}
          height={height}
          viewBox={`0 0 ${frame.widthPx} ${frame.heightPx}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ position: "absolute", top: 0, left: 0 }}
        >
          {heatGrid.cells.map((cell, i) => {
            const [west, south, east, north] = cell.bounds;
            const topLeft = frame.project(west, north);
            const bottomRight = frame.project(east, south);
            const [r, g, b] = thermalColorForTemp(cell.tempC, minC, maxC);
            return (
              <Rect
                key={i}
                x={topLeft.x}
                y={topLeft.y}
                width={Math.max(0, bottomRight.x - topLeft.x)}
                height={Math.max(0, bottomRight.y - topLeft.y)}
                fill={`rgb(${r}, ${g}, ${b})`}
                fillOpacity={0.8}
              />
            );
          })}
          {bbox && zones.length > 0 && <ZoneOverlayElements frame={frame} bbox={bbox} zones={zones} />}
          <Polygon points={points} stroke={AOI_OUTLINE_HEX} strokeWidth={3} fill="none" />
        </Svg>
      </View>
      <Text style={styles.imageCaption}>
        Figure 2. {heatGrid.hasRealBounds ? "Surface temperature distribution" : "Surface temperature distribution (approximate — no per-tile bounds saved)"} —
        FortyGuard heat_tiles ({heatGrid.cells.length} tiles)
      </Text>
      {isSpatiallyUniform(minC, maxC) && (
        <Text style={[styles.imageCaption, { color: COLORS.inkMuted }]}>
          FortyGuard returned one uniform value across this AOI — the reading is real, but there is no spatial
          variation, so this renders as a single flat color.
        </Text>
      )}
      <View style={styles.imageLegendRow}>
        <Text style={styles.imageLegendText}>{minC.toFixed(1)}°C</Text>
        <Svg width={90} height={8}>
          <Defs>
            <LinearGradient id="thermalScale" x1="0" y1="0" x2="1" y2="0">
              {THERMAL_COLOR_STOPS.map((s, i) => (
                <Stop key={i} offset={s.t} stopColor={`rgb(${s.rgb[0]}, ${s.rgb[1]}, ${s.rgb[2]})`} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={90} height={8} fill="url(#thermalScale)" />
        </Svg>
        <Text style={styles.imageLegendText}>{maxC.toFixed(1)}°C</Text>
      </View>
    </View>
  );
}

// Both sections together, with the graceful-degradation fallbacks a PDF
// route should have (same principle as the narrative's own try/catch
// fallback): missing AOI geometry, missing/failed satellite photo fetch, or
// no heat_tiles each get a plain explanatory line instead of a broken/blank
// image — the rest of the report still generates.
function SiteImagesSection({
  aoiGeometry,
  satellitePhotoBuffer,
  heatGrid,
  heatStats,
  bbox,
  zones,
}: {
  aoiGeometry: GeoPolygon | null;
  satellitePhotoBuffer: Buffer | null;
  heatGrid: SiteReportData["heatGrid"];
  heatStats: SiteReportData["site"]["heatStats"];
  bbox: [number, number, number, number] | null;
  zones: SiteReportData["hotspotZones"];
}) {
  if (!aoiGeometry) {
    return <Text style={styles.imageFallback}>No AOI geometry saved for this site — satellite/heatmap grid images unavailable.</Text>;
  }
  if (!satellitePhotoBuffer) {
    return (
      <Text style={styles.imageFallback}>
        Satellite photo unavailable for this site (not saved, or could not be fetched) — satellite/heatmap grid images
        skipped.
      </Text>
    );
  }

  const temps = heatGrid?.cells.map((c) => c.tempC) ?? [];
  const minC = heatStats?.minTempC ?? (temps.length > 0 ? Math.min(...temps) : null);
  const maxC = heatStats?.maxTempC ?? (temps.length > 0 ? Math.max(...temps) : null);

  return (
    <View style={styles.imagesRow}>
      <SatelliteImageSection aoiGeometry={aoiGeometry} photoBuffer={satellitePhotoBuffer} bbox={bbox} zones={zones} />
      {heatGrid && minC != null && maxC != null ? (
        <HeatmapGridImageSection
          aoiGeometry={aoiGeometry}
          photoBuffer={satellitePhotoBuffer}
          heatGrid={heatGrid}
          minC={minC}
          maxC={maxC}
          bbox={bbox}
          zones={zones}
        />
      ) : (
        <View style={styles.imageColumn}>
          <Text style={styles.imageFallback}>No saved heat tiles for this site — heatmap grid image unavailable.</Text>
        </View>
      )}
    </View>
  );
}

// Hottest/coolest colors match the dashboard's ZoneTemperatureBarChart.tsx
// exactly (HOTTEST_STROKE/COOLEST_STROKE there) — the same red/blue border +
// text-label convention, not a new print-only palette.
const HOTSPOT_HOTTEST_COLOR = "#dc2626";
const HOTSPOT_COOLEST_COLOR = "#2563eb";

function HotspotBarChart({ zones }: { zones: SiteReportData["hotspotZones"] }) {
  const withData = zones.filter((z) => z.meanTempC != null);
  if (withData.length === 0) {
    return <Text style={styles.bodyText}>No saved heat tiles for this site — hotspot zones unavailable.</Text>;
  }

  const width = 495;
  const height = 90;
  const barGap = 6;
  const barWidth = (width - barGap * (withData.length - 1)) / withData.length;
  const temps = withData.map((z) => z.meanTempC as number);
  const min = Math.min(...temps) - 1;
  const max = Math.max(...temps) + 1;
  const span = max - min || 1;

  return (
    <Svg width={width} height={height + 30}>
      {withData.map((z, i) => {
        const t = z.meanTempC as number;
        const barHeight = Math.max(2, ((t - min) / span) * height);
        const x = i * (barWidth + barGap);
        const y = height - barHeight;
        const stroke = z.isHottest ? HOTSPOT_HOTTEST_COLOR : z.isCoolest ? HOTSPOT_COOLEST_COLOR : undefined;
        return (
          <Rect
            key={z.zoneLabel}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            fill={rgbToHex(tempToColor(t))}
            stroke={stroke}
            strokeWidth={stroke ? 2 : 0}
          />
        );
      })}
      {/* Hottest/Coolest tags above their bar — same convention as the
          dashboard chart's LabelList, so a reader sees the same "which zone
          is hottest" answer whether they're looking at the screen or the
          printed page. */}
      {withData.map((z, i) => {
        if (!z.isHottest && !z.isCoolest) return null;
        const t = z.meanTempC as number;
        const barHeight = Math.max(2, ((t - min) / span) * height);
        const x = i * (barWidth + barGap) + barWidth / 2;
        const y = height - barHeight - 4;
        return (
          <Text
            key={`tag-${z.zoneLabel}`}
            x={x}
            y={y}
            textAnchor="middle"
            style={{ fontSize: 6, fontWeight: 700, color: z.isHottest ? HOTSPOT_HOTTEST_COLOR : HOTSPOT_COOLEST_COLOR }}
          >
            {z.isHottest ? "Hottest" : "Coolest"}
          </Text>
        );
      })}
      {withData.map((z, i) => {
        const x = i * (barWidth + barGap);
        // Word-wrapped rather than a single fixed line — every current
        // compass label is one word ("Northwest", "Southeast", ...) so this
        // renders on one line today, but stays correct without change if a
        // future label were ever 2 words again, instead of needing an
        // abbreviation that would then disagree with the exact same
        // zoneLabel() string shown everywhere else in this PDF.
        const words = z.zoneLabel.split(" ");
        return (
          <Fragment key={z.zoneLabel}>
            {words.map((word, wi) => (
              <Text key={word} x={x} y={height + 10 + wi * 8} style={{ fontSize: 6.5 }}>
                {word}
              </Text>
            ))}
          </Fragment>
        );
      })}
    </Svg>
  );
}

function HotspotZoneCaption({ zones }: { zones: SiteReportData["hotspotZones"] }) {
  const hottest = zones.find((z) => z.isHottest);
  const coolest = zones.find((z) => z.isCoolest);
  if (!hottest && !coolest) return null;
  return (
    <Text style={[styles.imageCaption, { marginTop: 4 }]}>
      {hottest && `Hottest: ${hottest.zoneLabel} (${hottest.meanTempC?.toFixed(1)}°C)`}
      {hottest && coolest && "  ·  "}
      {coolest && `Coolest: ${coolest.zoneLabel} (${coolest.meanTempC?.toFixed(1)}°C)`}
    </Text>
  );
}

function RecommendationSection({ recommendation }: { recommendation: SiteReportData["recommendation"] }) {
  const { treeCanopy } = recommendation;
  if (treeCanopy.status === "deficit") {
    return (
      <View>
        <Text style={styles.bodyText}>
          Tree canopy is estimated at {treeCanopy.currentTreeCanopyPct.toFixed(1)}%, below the{" "}
          {treeCanopy.targetTreeCanopyPct}% planning benchmark used here — an estimated{" "}
          {Math.round(treeCanopy.deficitAreaM2).toLocaleString()} m² canopy gap.
        </Text>
        <Text style={[styles.bodyText, { fontWeight: 700, marginTop: 4 }]}>
          Recommended: +{treeCanopy.recommendedTrees.toLocaleString()} trees (or +
          {treeCanopy.recommendedCanopyM2.toLocaleString()} m² artificial canopy — same gap, alternate unit, not
          additive). Solar: custom scenario (no roof-area basis available to auto-size).
        </Text>
        {treeCanopy.dataSynthetic && (
          <Text style={styles.caveat}>Tree-canopy figure is from a cached/synthetic FortyGuard spot-check.</Text>
        )}
      </View>
    );
  }
  if (treeCanopy.status === "benchmark_met") {
    return (
      <Text style={styles.bodyText}>
        Existing tree canopy ({treeCanopy.currentTreeCanopyPct.toFixed(1)}%) already meets the{" "}
        {treeCanopy.targetTreeCanopyPct}% planning benchmark used here — no canopy deficit detected.
      </Text>
    );
  }
  return <Text style={styles.bodyText}>Recommendation unavailable — {treeCanopy.reason}</Text>;
}

// Shift Schedule section (audit finding: this was never in the PDF at all —
// reportData.ts's buildForecastTimeline() call is new). Same 5-slot
// (+0/+3/+6/+9/+12h) timeline, same WBGT estimate, same NIOSH REL risk bands
// as ShiftSchedulePanel.tsx — no second classification. Colors now reuse the
// exact same lib/severity.ts light-mode tokens the dashboard's
// ShiftSchedulePanel.tsx reads (safe→nominal, caution→caution, danger→critical)
// instead of this file's own previously-separate emerald/amber pair.
const RISK_COLORS: Record<ShiftRisk, string> = {
  safe: COLORS.severityNominal,
  caution: COLORS.severityCaution,
  danger: COLORS.severityCritical,
};
const RISK_LABELS: Record<ShiftRisk, string> = { safe: "Safe", caution: "Caution", danger: "Danger" };

function ShiftScheduleSection({ timeline }: { timeline: SiteReportData["shiftTimeline"] }) {
  if (timeline.length === 0) {
    return (
      <Text style={styles.bodyText}>
        No forecast slots captured yet for this site — Shift Schedule unavailable.
      </Text>
    );
  }

  const available = timeline.filter(
    (s): s is Extract<ForecastTimelineSlot, { available: true }> => s.available,
  );
  const overall = overallShiftRisk(available.map((s) => s.risk));
  const humidity = summarizeHumidityProvenance(timeline);

  // The table below has no date column (only clock times), so on a fallback
  // day the banner must name the actual measurement date outright — otherwise
  // the reader has no way to tell these aren't today's forward hours.
  const fallbackDates = available
    .filter((s) => s.isFallbackDate)
    .map((s) => s.dateLabel)
    .filter((d, i, all) => all.indexOf(d) === i);

  return (
    <View>
      {fallbackDates.length > 0 && (
        <View style={[styles.badge, { backgroundColor: COLORS.statusCachedBg, alignSelf: "stretch", marginBottom: 6, paddingVertical: 5 }]}>
          <Text style={[styles.badgeText, { color: COLORS.statusCached, textTransform: "none" }]}>
            Not a forward forecast — FortyGuard had no data for the requested day. These are real readings measured
            at these same clock times on {fallbackDates.join(", ")}.
          </Text>
        </View>
      )}
      {overall && (
        <Text style={[styles.bodyText, { fontWeight: 700, marginBottom: 6, color: RISK_COLORS[overall] }]}>
          Overall: {RISK_LABELS[overall]} — {SHIFT_RISK_RECOMMENDATION[overall]}
        </Text>
      )}
      <View style={styles.table}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.tableHeaderText, styles.tableCellZone]}>Time</Text>
          <Text style={[styles.tableHeaderText, styles.tableCellTemp]}>Air Temp</Text>
          <Text style={[styles.tableHeaderText, styles.tableCellTemp]}>Est. WBGT</Text>
          <Text style={[styles.tableHeaderText, styles.tableCellLevel]}>Risk</Text>
        </View>
        {timeline.map((slot) => (
          <View key={slot.targetTime} style={styles.tableRow}>
            <Text style={styles.tableCellZone}>
              {slot.timeLabel} ({slot.offsetHours === 0 ? "Now" : `+${slot.offsetHours}h`})
            </Text>
            {slot.available ? (
              <>
                <Text style={styles.tableCellTemp}>{slot.airTemperatureC.toFixed(1)}°C</Text>
                <Text style={styles.tableCellTemp}>{slot.wbgtC.toFixed(1)}°C</Text>
                <Text style={[styles.tableCellLevel, { color: RISK_COLORS[slot.risk], fontWeight: 700 }]}>
                  {RISK_LABELS[slot.risk]}
                </Text>
              </>
            ) : (
              <>
                <Text style={[styles.tableCellTemp, { color: COLORS.inkMuted }]}>—</Text>
                <Text style={[styles.tableCellTemp, { color: COLORS.inkMuted }]}>—</Text>
                <Text style={[styles.tableCellLevel, { color: COLORS.inkMuted }]}>Unavailable</Text>
              </>
            )}
          </View>
        ))}
      </View>
      {/* Mirrors the dashboard's own humidity provenance wording: the report must
          not describe a flat assumption for a site whose slots used FortyGuard's
          measured hourly humidity, nor claim a measurement for one that did not. */}
      <Text style={styles.caveat}>
        {humidity.measuredCount > 0
          ? `WBGT is derived (not directly measured) from FortyGuard air temperature and FortyGuard's measured ` +
            `relative humidity for each slot's own hour` +
            (humidity.assumedCount > 0
              ? ` for ${humidity.measuredCount} of ${humidity.measuredCount + humidity.assumedCount} slots; the rest use an assumed ${ASSUMED_RELATIVE_HUMIDITY_PCT}%.`
              : `.`)
          : humidity.cachedCount > 0
            ? `Humidity for this site came from cached-mode fixtures, not a live FortyGuard call — those values are synthetic, not measurements.`
            : `WBGT is estimated (not directly measured) from air temperature using an assumed ${ASSUMED_RELATIVE_HUMIDITY_PCT}% relative humidity.`}
        {" "}Risk bands use NIOSH&apos;s 2016 Recommended Exposure Limits for {WORKLOAD_LABEL.toLowerCase()} work,{" "}
        {ACCLIMATIZATION_LABEL.toLowerCase()}.
      </Text>
    </View>
  );
}

// ROI Simulator section (audit finding: never in the PDF — reportData.ts now
// computes roi.bestResult/worstResult with the EXACT same simulateROI() +
// best/worst-case cooling-range logic RoiPanel.tsx runs, from either the
// site's saved sites.roi_inputs or, if none exists yet, the same
// default+recommendation seed RoiPanel.tsx shows on first load. Confirmed
// with the user: always render this section, clearly labeled either way —
// never silently guess which case it is.
function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
function formatEnergy(kwh: number): string {
  if (kwh >= 1000) return `${(kwh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MWh`;
  return `${Math.round(kwh).toLocaleString()} kWh`;
}
function formatRangeUSD(low: number, high: number): string {
  return Math.abs(high - low) < 1e-6 ? formatUSD(low) : `${formatUSD(low)} – ${formatUSD(high)}`;
}
function formatRangeEnergy(low: number, high: number): string {
  return Math.abs(high - low) < 1e-6 ? formatEnergy(low) : `${formatEnergy(low)} – ${formatEnergy(high)}`;
}
function paybackLabel(result: ROIResult, horizonYears: number): string {
  if (result.totalCost <= 0 && result.annualSavingsUSD <= 0) return "—";
  if (result.paybackYears === null) return "Never";
  if (result.paybackBeyondHorizon) return `> ${horizonYears}y`;
  return `${result.paybackYears.toFixed(1)}y`;
}

function RoiBreakevenChart({
  bestResult,
  worstResult,
  horizonYears,
}: {
  bestResult: ROIResult;
  worstResult: ROIResult;
  horizonYears: number;
}) {
  const width = 495;
  const height = 110;
  const padL = 46;
  const padR = 8;
  const padT = 8;
  const padB = 16;
  const isRange = Math.abs(bestResult.annualSavingsUSD - worstResult.annualSavingsUSD) > 1e-6;

  const years = Array.from({ length: horizonYears }, (_, i) => i + 1);
  const maxY = Math.max(1, ...worstResult.cumulativeCostByYear, ...bestResult.cumulativeSavingsByYear, ...worstResult.cumulativeSavingsByYear);
  const xFor = (year: number) => padL + ((year - 1) / Math.max(1, horizonYears - 1)) * (width - padL - padR);
  const yFor = (val: number) => height - padB - (val / maxY) * (height - padT - padB);

  const costPoints = years.map((y, i) => `${xFor(y)},${yFor(worstResult.cumulativeCostByYear[i])}`).join(" ");
  const bestSavingsPoints = years.map((y, i) => `${xFor(y)},${yFor(bestResult.cumulativeSavingsByYear[i])}`).join(" ");
  const worstSavingsPoints = years.map((y, i) => `${xFor(y)},${yFor(worstResult.cumulativeSavingsByYear[i])}`).join(" ");

  const yTicks = [0, 0.5, 1].map((f) => maxY * f);

  return (
    <View>
      <Text style={styles.imageCaption}>Figure 4. Cumulative investment vs. cumulative savings</Text>
      <Svg width={width} height={height}>
        {yTicks.map((t, i) => (
          <Fragment key={i}>
            <Line x1={padL} y1={yFor(t)} x2={width - padR} y2={yFor(t)} stroke={COLORS.borderSubtle} strokeWidth={1} />
            <Text x={padL - 4} y={yFor(t) + 3} style={{ fontSize: 6.5, color: COLORS.inkMuted }} textAnchor="end">
              {t >= 1000 ? `$${Math.round(t / 1000)}k` : `$${Math.round(t)}`}
            </Text>
          </Fragment>
        ))}
        <Polyline points={costPoints} fill="none" stroke="#dc2626" strokeWidth={2} />
        <Polyline points={bestSavingsPoints} fill="none" stroke="#059669" strokeWidth={2} />
        {isRange && <Polyline points={worstSavingsPoints} fill="none" stroke="#059669" strokeWidth={1.5} strokeDasharray="4 3" />}
      </Svg>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#dc2626" }]} />
          <Text style={styles.legendText}>Cumulative investment</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: "#059669" }]} />
          <Text style={styles.legendText}>Cumulative savings (best case)</Text>
        </View>
        {isRange && (
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: "#059669" }]} />
            <Text style={styles.legendText}>Cumulative savings (worst case, dashed)</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function RoiSimulatorSection({ roi }: { roi: SiteReportData["roi"] }) {
  const { inputs, isSaved, bestResult, worstResult } = roi;
  const degenerate = worstResult.totalCost <= 0 && worstResult.annualSavingsUSD <= 0 && bestResult.annualSavingsUSD <= 0;

  return (
    <View>
      <Text style={[styles.bodyText, { fontWeight: 700 }]}>
        Scenario: {isSaved ? "Your saved scenario" : "Default scenario (not customized)"}
      </Text>
      <Text style={[styles.bodyText, { marginTop: 2, marginBottom: 6 }]}>
        {inputs.numTrees.toLocaleString()} trees · {inputs.canopyM2.toLocaleString()} m² artificial canopy ·{" "}
        {inputs.solarKW.toLocaleString()} kW solar · {inputs.horizonYears}-year horizon
      </Text>

      {degenerate ? (
        <Text style={styles.bodyText}>
          No intervention quantity in this scenario yet — enter trees, canopy area, or solar capacity in the
          dashboard&apos;s Heat Mitigation Planner to see a simulated result here.
        </Text>
      ) : (
        <>
          <View style={styles.executiveRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Investment</Text>
              <Text style={styles.statValue}>{formatUSD(worstResult.totalCost)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Annual Savings</Text>
              <Text style={styles.statValue}>{formatRangeUSD(worstResult.annualSavingsUSD, bestResult.annualSavingsUSD)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Energy Saved / yr</Text>
              <Text style={styles.statValue}>{formatRangeEnergy(worstResult.estimatedKwhSavedPerYear, bestResult.estimatedKwhSavedPerYear)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Payback</Text>
              <Text style={styles.statValue}>
                {paybackLabel(bestResult, inputs.horizonYears) === paybackLabel(worstResult, inputs.horizonYears)
                  ? paybackLabel(bestResult, inputs.horizonYears)
                  : `${paybackLabel(bestResult, inputs.horizonYears)} – ${paybackLabel(worstResult, inputs.horizonYears)}`}
              </Text>
            </View>
          </View>
          <View style={{ marginTop: 10 }}>
            <RoiBreakevenChart bestResult={bestResult} worstResult={worstResult} horizonYears={inputs.horizonYears} />
          </View>
        </>
      )}
      <Text style={styles.caveat}>
        Simulated — cooling reduction and energy savings are estimated from the scenario&apos;s inputs and researched
        cooling ranges, not directly measured for this site.
      </Text>
    </View>
  );
}

// Cover page — title page, confirmed light/professional-report style with
// the user rather than continuing the dashboard's dark theme (this report's
// body pages were already light-background before this pass; the cover is
// new). The accent bar and eyebrow/heading colors are lib/globals.css's own
// light-mode --accent/--accent-strong tokens, not a new brand color.
function CoverPage({ site, generatedAt }: { site: SiteReportData["site"]; generatedAt: string }) {
  const siteName = site.name ?? `Site ${site.id.slice(0, 8)}`;
  return (
    <Page size="A4" style={styles.coverPage}>
      <View style={styles.coverAccentBar} />
      <View style={styles.coverContent}>
        <View>
          <View style={styles.coverBrandRow}>
            <Text style={styles.coverBrand}>HeatOps</Text>
            <Text style={styles.coverMetaTop}>FortyGuard Hackathon&apos;26</Text>
          </View>
          <View style={styles.coverTitleBlock}>
            <Text style={styles.coverEyebrow}>Urban Heat Site Assessment</Text>
            <Text style={styles.coverTitle}>Site Heat{"\n"}Assessment Report</Text>
            <Text style={styles.coverSiteName}>{siteName}</Text>
          </View>
        </View>
        <View>
          <View style={styles.coverMetaBlock}>
            <View>
              <Text style={styles.coverMetaLabel}>Site Area</Text>
              <Text style={styles.coverMetaValue}>
                {site.siteAreaM2 != null ? `${(site.siteAreaM2 / 1_000_000).toFixed(3)} km²` : "N/A"}
              </Text>
            </View>
            <View>
              <Text style={styles.coverMetaLabel}>Analyzed</Text>
              <Text style={styles.coverMetaValue}>{formatDate(site.createdAt)}</Text>
            </View>
            <View>
              <Text style={styles.coverMetaLabel}>Report Generated</Text>
              <Text style={styles.coverMetaValue}>{formatDate(generatedAt)}</Text>
            </View>
          </View>
          <View style={styles.coverFooterRow}>
            <Text style={styles.coverFooterText}>Site ID: {site.id}</Text>
            <Text style={styles.coverFooterText}>Data sources: FortyGuard · Overpass (OSM) · Esri World Imagery</Text>
          </View>
        </View>
      </View>
    </Page>
  );
}

// The report's headline sentence. Every string comes from
// lib/siteOutcome.ts's formatOutcomeSegments(), the same call
// components/analyst/OutcomeBanner.tsx makes — so the printed report and
// the dashboard state the same outcome in the same words, not merely from
// the same numbers. No Fragments here: every branch returns a real View, so
// react-pdf's layout engine never has to flatten one.
// One lever inside the headline band. Mirrors components/analyst/OutcomeBanner
// .tsx's LeverCard: the delta is the only thing set at display size, and when a
// lever is unavailable its reason takes the same slot at body size so an absent
// option never reads as a missing number.
function OutcomeLever({
  label,
  action,
  headline,
  detail,
  note,
}: {
  label: string;
  action: string | null;
  headline: string | null;
  detail: string | null;
  note: string | null;
}) {
  return (
    <View style={styles.outcomeCol}>
      <Text style={styles.outcomeLabel}>{label}</Text>
      {headline ? (
        <View>
          {action ? <Text style={styles.outcomeAction}>{action}</Text> : null}
          <Text style={styles.outcomeDelta}>{headline}</Text>
          {detail ? <Text style={styles.outcomeEconomics}>{detail}</Text> : null}
        </View>
      ) : (
        <Text style={styles.outcomeEconomics}>{note}</Text>
      )}
    </View>
  );
}

function OutcomeBand({ outcome }: { outcome: SiteReportData["outcome"] }) {
  const segments = formatOutcomeSegments(outcome);
  const { provenance } = outcome;
  const provenanceNotes: string[] = [];
  if (provenance.heatSynthetic) provenanceNotes.push("heat figures are cached/synthetic, not live measurements");
  if (provenance.canopySynthetic) provenanceNotes.push("tree-canopy share is from a cached spot-check");

  return (
    <View style={styles.outcomeBand} wrap={false}>
      <Text style={styles.outcomeEyebrow}>Headline Outcome — Estimate</Text>
      <Text style={styles.outcomeNowText}>
        {segments.exposure ? `${segments.now} · ${segments.exposure}.` : `${segments.now}.`}
      </Text>
      {provenanceNotes.length > 0 && (
        <Text style={styles.outcomeProvenance}>Note: {provenanceNotes.join("; ")}.</Text>
      )}

      {/* Two levers, rescheduling first: it costs nothing and applies today,
          where the canopy scenario is capital spend recovered over years. */}
      <View style={styles.outcomeSplitRow}>
        <OutcomeLever
          label="Today · no capital"
          action={segments.scheduleAction}
          headline={segments.scheduleDeltaHeadline}
          detail={segments.scheduleDelta}
          note={segments.scheduleNote}
        />
        <OutcomeLever
          label={
            outcome.intervention.status === "available" && outcome.intervention.isSavedScenario
              ? "Longer term · saved scenario"
              : "Longer term · recommended"
          }
          action={segments.action}
          headline={segments.delta}
          detail={segments.economics}
          note={segments.interventionNote}
        />
      </View>

      <Text style={styles.caveat}>
        Exposure hours are the forecast hours actually captured for this site (not a continuous window),
        classified against NIOSH limits — see Section 5 for each hour and its humidity source.
        {segments.delta
          ? " Cooling is estimated from published canopy-cover research indexed to how much canopy this scenario adds; energy and payback use the disclosed planning-grade assumptions in Section 6. This is a planning estimate for this site, not a measured or guaranteed result."
          : ""}
        {outcome.intervention.status === "available" &&
          outcome.intervention.beyondValidatedRange &&
          " This scenario adds more canopy than the source studies tested, so its cooling figure is a linear extrapolation beyond validated range."}
      </Text>
    </View>
  );
}

function PageHeader({ siteName }: { siteName: string }) {
  return (
    <View style={styles.pageHeader} fixed>
      <Text style={styles.pageHeaderBrand}>HeatOps · Site Assessment Report</Text>
      <Text style={styles.pageHeaderSite}>{siteName}</Text>
    </View>
  );
}

function PageFooter({ generatedAt }: { generatedAt: string }) {
  return (
    <View style={styles.pageFooter} fixed>
      <Text style={styles.pageFooterText}>
        Generated {formatDate(generatedAt)} — figures marked &quot;Cached&quot; are synthetic (dev mode), not live
        measurements.
      </Text>
      <Text
        style={styles.pageFooterText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

export default function SiteReportDocument({
  data,
  narrative,
  generatedAt,
  satellitePhotoBuffer,
}: {
  data: SiteReportData;
  narrative: string;
  generatedAt: string;
  satellitePhotoBuffer: Buffer | null;
}) {
  const { site, hotspotZones, recommendation, heatGrid, shiftTimeline, roi, outcome } = data;
  const hottest = hotspotZones.find((z) => z.isHottest);
  const siteName = site.name ?? `Site ${site.id.slice(0, 8)}`;

  return (
    <Document title={`HeatOps Site Report — ${siteName}`}>
      <CoverPage site={site} generatedAt={generatedAt} />

      <Page size="A4" style={styles.page}>
        <PageHeader siteName={siteName} />

        <View wrap={false}>
          <SectionHeader
            index={1}
            title="Executive Summary"
            subtitle="Key metrics at a glance, computed from this site's saved analysis — no figures recalculated for this report."
          />
          {site.heatStats?.isFallbackDate && site.heatStats.dateUsed && (
            <View style={[styles.badge, { backgroundColor: COLORS.statusCachedBg, alignSelf: "stretch", marginBottom: 8, paddingVertical: 5 }]}>
              <Text style={[styles.badgeText, { color: COLORS.statusCached, textTransform: "none" }]}>
                Heat figures below are from {site.heatStats.dateUsed} — FortyGuard had no same-day data available
                when this site was analyzed.
              </Text>
            </View>
          )}
          {/* Above the stat cards deliberately: the four cards below are
              inputs, this is the conclusion drawn from them. A reader who
              only ever looks at page 1 should still leave with the outcome. */}
          <OutcomeBand outcome={outcome} />

          <View style={styles.executiveRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Mean Temp</Text>
              <Text style={styles.statValue}>{site.heatStats ? `${site.heatStats.avgTempC.toFixed(1)}°C` : "N/A"}</Text>
              <AttributionBadgePdf status={site.attribution?.heat ?? "unavailable"} />
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Peak Temp</Text>
              <Text style={styles.statValue}>{site.heatStats ? `${site.heatStats.maxTempC.toFixed(1)}°C` : "N/A"}</Text>
              <AttributionBadgePdf status={site.attribution?.heat ?? "unavailable"} />
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Hottest Zone</Text>
              <Text style={styles.statValue}>{hottest ? `${hottest.zoneLabel} · ${hottest.meanTempC?.toFixed(1)}°C` : "N/A"}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Tree Canopy</Text>
              <Text style={styles.statValue}>
                {recommendation.treeCanopy.status !== "unavailable" ? `${recommendation.treeCanopy.currentTreeCanopyPct.toFixed(1)}%` : "N/A"}
              </Text>
              <AttributionBadgePdf status={site.attribution?.landcover_spotcheck ?? "unavailable"} />
            </View>
          </View>
        </View>

        {/* wrap={false} on every section below: without it, react-pdf can
            split a section's heading onto one page and its Svg/Image content
            onto the next (Svg/Image can't be split at all, so it just moves
            wholesale) — an orphaned heading over blank space. Keeping each
            section atomic means the worst case is the *whole* section moving
            to the next page together, never a broken half-render. */}
        <View wrap={false}>
          <SectionHeader
            index={2}
            title="Site Imagery"
            subtitle="Satellite reference and FortyGuard surface temperature grid, with the same 3×3 zone overlay shown on screen."
          />
          <SiteImagesSection
            aoiGeometry={site.aoiGeometry}
            satellitePhotoBuffer={satellitePhotoBuffer}
            heatGrid={heatGrid}
            heatStats={site.heatStats}
            bbox={data.bbox}
            zones={hotspotZones}
          />
        </View>

        <View wrap={false}>
          <SectionHeader
            index={3}
            title="Land Cover"
            subtitle="AOI-wide land-cover breakdown from Overpass (OpenStreetMap), clipped exactly to the drawn boundary."
          />
          <LandcoverBar landcover={site.landcover} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
            <Text style={styles.imageCaption}>Source: Overpass (OpenStreetMap), AOI-wide.</Text>
            <AttributionBadgePdf status={site.attribution?.landcover ?? "unavailable"} />
          </View>
        </View>

        <View wrap={false}>
          <SectionHeader
            index={4}
            title="Hotspot Zones"
            subtitle="Mean surface temperature across the site's 3×3 zone grid, labeled by compass position."
          />
          <Text style={styles.imageCaption}>Figure 3. Mean temperature by zone (compass position)</Text>
          <View style={{ marginTop: 4 }}>
            <HotspotBarChart zones={hotspotZones} />
          </View>
          <HotspotZoneCaption zones={hotspotZones} />
        </View>

        <View wrap={false}>
          <SectionHeader
            index={5}
            title="Shift Schedule"
            subtitle="Estimated outdoor-work heat risk (NIOSH REL / WBGT-based) across the +0 to +12 hour forecast window."
          />
          <ShiftScheduleSection timeline={shiftTimeline} />
        </View>

        <View wrap={false}>
          <SectionHeader
            index={6}
            title="Heat Mitigation Recommendation"
            subtitle="Deterministic canopy-deficit heuristic — not simulated or AI-generated."
          />
          <RecommendationSection recommendation={recommendation} />
        </View>

        <View wrap={false}>
          <SectionHeader
            index={7}
            title="Heat Mitigation Planner"
            subtitle="Simulated return-on-investment for the site's current planning scenario."
          />
          <RoiSimulatorSection roi={roi} />
        </View>

        <View>
          <SectionHeader
            index={8}
            title="Narrative Summary"
            subtitle="AI Copilot-generated synthesis of the findings above, from this site's saved data only."
          />
          <Text style={styles.bodyText}>{narrative}</Text>
        </View>

        <PageFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}
