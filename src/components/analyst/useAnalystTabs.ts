"use client";

import { useState } from "react";
import { LayoutDashboard, Flame, HardHat, Calculator, Download, type LucideIcon } from "lucide-react";

// Solar vs Canopy, Building Evaluation, and Photo Analysis were REMOVED
// permanently (project.md §5's "REVISI: dashboard vs chat" table + §6) —
// their compute logic moved to AI Copilot tools (compare_interventions,
// check_new_building_feasibility, analyze_field_photo) instead of staying as
// dedicated Analyst tabs. Not a hidden/disabled state — the keys themselves
// no longer exist. See the forward-pointer banner on OverviewPanel.
export type TabKey = "overview" | "hotspot" | "shift" | "roi" | "pdf";

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
//
// "charts" (Charts & Metrics) was REMOVED as its own tab — the zone
// temperature bar chart it held now lives inside Hotspot Detection, next to
// the Satellite/Grid Thermal columns it explains, instead of a separate tab
// disconnected from the map (see HotspotPanel.tsx / ZoneTemperatureBarChart.tsx).
export const ANALYST_TABS: TabConfig[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, implemented: true },
  { key: "hotspot", label: "Hotspot Detection", icon: Flame, implemented: true },
  { key: "shift", label: "Shift Schedule", icon: HardHat, implemented: true },
  { key: "roi", label: "Heat Mitigation Planner", icon: Calculator, implemented: true },
  { key: "pdf", label: "Download PDF", icon: Download, implemented: true },
];

export function useAnalystTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  return { activeTab, setActiveTab, tabs: ANALYST_TABS };
}
