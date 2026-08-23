import type { TabKey } from "./useAnalystTabs";
import type { SiteRow } from "./types";
import type { ForecastTimelineSlot } from "@/lib/wbgt";
import OverviewPanel from "./OverviewPanel";
import HotspotPanel from "./HotspotPanel";
import ShiftSchedulePanel from "./ShiftSchedulePanel";
import RoiPanel from "./RoiPanel";
import ChartsPanel from "./ChartsPanel";
import ComingSoonPanel from "./ComingSoonPanel";

const COMING_SOON_LABELS: Partial<Record<TabKey, string>> = {
  pdf: "Download PDF",
};

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
    return <OverviewPanel row={row} bbox={bbox} createdAtLabel={createdAtLabel} createdAtTimeLabel={createdAtTimeLabel} />;
  }
  if (activeTab === "hotspot") {
    return <HotspotPanel tiles={row.heat_tiles ?? []} bbox={bbox} attribution={row.attribution?.heat ?? "unavailable"} />;
  }
  if (activeTab === "shift") {
    return <ShiftSchedulePanel timeline={forecastTimeline} />;
  }
  if (activeTab === "roi") {
    return <RoiPanel row={row} bbox={bbox} />;
  }
  if (activeTab === "charts") {
    return <ChartsPanel tiles={row.heat_tiles ?? []} bbox={bbox} attribution={row.attribution?.heat ?? "unavailable"} />;
  }
  return <ComingSoonPanel label={COMING_SOON_LABELS[activeTab] ?? activeTab} />;
}
