import type { TabKey } from "./useAnalystTabs";
import type { SiteRow } from "./types";
import type { ForecastTimelineSlot } from "@/lib/wbgt";
import OverviewPanel from "./OverviewPanel";
import HotspotPanel from "./HotspotPanel";
import ShiftSchedulePanel from "./ShiftSchedulePanel";
import RoiPanel from "./RoiPanel";
import PdfReportPanel from "./PdfReportPanel";
import ComingSoonPanel from "./ComingSoonPanel";

const COMING_SOON_LABELS: Partial<Record<TabKey, string>> = {};

export default function ContentArea({
  activeTab,
  row,
  bbox,
  createdAtLabel,
  createdAtTimeLabel,
  forecastTimeline,
}: {
  activeTab: TabKey;
  row: SiteRow;
  bbox: [number, number, number, number] | null;
  createdAtLabel: string;
  createdAtTimeLabel: string;
  forecastTimeline: ForecastTimelineSlot[];
}) {
  if (activeTab === "overview") {
    return (
      <OverviewPanel
        row={row}
        bbox={bbox}
        createdAtLabel={createdAtLabel}
        createdAtTimeLabel={createdAtTimeLabel}
        forecastTimeline={forecastTimeline}
      />
    );
  }
  if (activeTab === "hotspot") {
    return (
      <HotspotPanel
        tiles={row.heat_tiles ?? []}
        bbox={bbox}
        aoiGeometry={row.aoi_geometry ?? null}
        satellitePhotoUrl={row.satellite_photo_url}
        heatStats={row.heat_stats ? { minTempC: row.heat_stats.minTempC, maxTempC: row.heat_stats.maxTempC } : null}
        attribution={row.attribution?.heat ?? "unavailable"}
      />
    );
  }
  if (activeTab === "shift") {
    return (
      <ShiftSchedulePanel
        timeline={forecastTimeline}
        heatPhotoUrl={row.heat_photo_url}
        satellitePhotoUrl={row.satellite_photo_url}
      />
    );
  }
  if (activeTab === "roi") {
    return <RoiPanel row={row} bbox={bbox} />;
  }
  if (activeTab === "pdf") {
    return <PdfReportPanel row={row} />;
  }
  return <ComingSoonPanel label={COMING_SOON_LABELS[activeTab] ?? activeTab} />;
}
