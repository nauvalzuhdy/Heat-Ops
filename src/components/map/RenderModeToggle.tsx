"use client";

import { useMapStore, type RenderMode } from "@/store/mapStore";
import SegmentedControl, { type SegmentedOption } from "@/components/ui/SegmentedControl";

// Label shortened from "Photo-real"/"Photo-realistic Massing" to just
// "Photo" per user feedback — the mode only samples roof/ground color from
// a satellite photo, it doesn't render actual photo texture (walls are a
// flat darkened shade, not a real side view) — "Photo-realistic" read as
// overclaiming that. See lib/photorealisticMassing.ts's header comment.
const BASE_OPTIONS: { value: RenderMode; label: string }[] = [
  { value: "massing", label: "Massing" },
  { value: "landcover", label: "Land-cover" },
  { value: "photoreal", label: "Photo" },
];

export default function RenderModeToggle({
  photorealDisabledReason,
}: {
  // Set when the current AOI has too many buildings for §4.6's Photo mode
  // (see PHOTOREALISTIC_MAX_BUILDINGS) — the option stays visible but
  // disabled, with this string as its tooltip, rather than hiding it outright.
  photorealDisabledReason?: string | null;
}) {
  const renderMode = useMapStore((s) => s.renderMode);
  const setRenderMode = useMapStore((s) => s.setRenderMode);

  const options: SegmentedOption<RenderMode>[] = BASE_OPTIONS.map((opt) =>
    opt.value === "photoreal" && photorealDisabledReason
      ? { ...opt, disabled: true, title: photorealDisabledReason }
      : opt
  );

  return <SegmentedControl options={options} value={renderMode} onChange={setRenderMode} className="shadow-card" />;
}
