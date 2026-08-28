// Circular progress ring (Operational Analyst Overview redesign, project.md
// §5 — mission-control composition element from overview.png). Stroke color
// comes from the caller's chosen Severity, not a hardcoded palette, so it
// stays consistent with every other severity-driven card on the page.
"use client";

import { useMemo } from "react";
import { type Severity } from "@/lib/severity";

export default function RadialGauge({
  percent,
  severity,
  size = 76,
  strokeWidth = 8,
  label,
}: {
  /** 0-100. Values outside that range are clamped, not extrapolated. */
  percent: number;
  severity: Severity;
  size?: number;
  strokeWidth?: number;
  label?: string;
}) {
  const clamped = Math.min(100, Math.max(0, percent));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = useMemo(() => circumference * (1 - clamped / 100), [circumference, clamped]);
  const center = size / 2;
  const strokeVar = `var(--severity-${severity}-fg)`;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeVar}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold text-fg-primary">{Math.round(clamped)}%</span>
        {label && <span className="text-[9px] text-fg-muted">{label}</span>}
      </div>
    </div>
  );
}
