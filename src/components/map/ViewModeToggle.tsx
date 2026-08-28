"use client";

import { useMapStore, type ViewMode } from "@/store/mapStore";
import SegmentedControl from "@/components/ui/SegmentedControl";

const OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "schematic", label: "Schematic" },
  { value: "satellite", label: "Satellite" },
];

export default function ViewModeToggle() {
  const viewMode = useMapStore((s) => s.viewMode);
  const setViewMode = useMapStore((s) => s.setViewMode);

  return <SegmentedControl options={OPTIONS} value={viewMode} onChange={setViewMode} className="shadow-card" />;
}
