"use client";

import { useState } from "react";
import { LayoutDashboard, Flame, HardHat, Calculator, TreePine, Building2, Camera, LineChart, Download, type LucideIcon } from "lucide-react";

export type TabKey = "overview" | "hotspot" | "shift" | "roi" | "solar" | "building" | "photo" | "charts" | "pdf";

export type TabConfig = {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  /** false = Sub-task not built yet; tab still clicks through to a "coming soon" placeholder. */
  implemented: boolean;
};

// Order and labels follow project.md §5's feature table; icon choices favor
// what each feature literally does (e.g. Calculator for ROI) over a literal
// re-skin of the original emoji sketch.
export const ANALYST_TABS: TabConfig[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, implemented: true },
  { key: "hotspot", label: "Hotspot Detection", icon: Flame, implemented: true },
  { key: "shift", label: "Shift Schedule", icon: HardHat, implemented: true },
  { key: "roi", label: "Heat Mitigation Planner", icon: Calculator, implemented: true },
  { key: "solar", label: "Solar vs Canopy", icon: TreePine, implemented: false },
  { key: "building", label: "Building Evaluation", icon: Building2, implemented: false },
  { key: "photo", label: "Photo Analysis", icon: Camera, implemented: false },
  { key: "charts", label: "Charts & Metrics", icon: LineChart, implemented: true },
  { key: "pdf", label: "Download PDF", icon: Download, implemented: false },
];

export function useAnalystTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  return { activeTab, setActiveTab, tabs: ANALYST_TABS };
}
