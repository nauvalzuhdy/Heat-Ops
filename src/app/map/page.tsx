import Header from "@/components/layout/Header";
import AppSidebar from "@/components/layout/AppSidebar";
import MapCanvas from "@/components/map/MapCanvas";
import AnalyzePanel from "@/components/map/AnalyzePanel";

export default function MapPage() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <AppSidebar />
        <MapCanvas />
        <AnalyzePanel />
      </div>
    </div>
  );
}
