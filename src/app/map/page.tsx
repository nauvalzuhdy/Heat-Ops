import Header from "@/components/layout/Header";
import AppSidebar from "@/components/layout/AppSidebar";
import MapCanvas from "@/components/map/MapCanvas";
import AnalyzePanel from "@/components/map/AnalyzePanel";

export default function MapPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <Header title="Map View" />
      {/* Below `lg` (1024px): map on top, analysis panel below, the whole
          column scrolls — "map dulu, analysis di bawah" for phones/tablets.
          At `lg`+: unchanged original side-by-side row (map flex-1,
          analysis panel a fixed w-96), not touched by the responsive rules. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <AppSidebar />
        <MapCanvas />
        <AnalyzePanel />
      </div>
    </div>
  );
}
