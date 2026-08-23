import type { ReactNode } from "react";

type AreaMetricCardProps = {
  label: string;
  valuePct: number;
  barColor: string;
};

export default function AreaMetricCard({ label, valuePct, barColor }: AreaMetricCardProps) {
  const clamped = Math.max(0, Math.min(100, valuePct));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-neutral-600 dark:text-neutral-400">{label}</span>
        <span className="font-medium text-neutral-900 dark:text-white">{clamped.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-900">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${clamped}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

export function SourceBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "cached" }) {
  const toneClasses =
    tone === "cached"
      ? "border-amber-300 text-amber-700 dark:border-amber-900 dark:text-amber-400"
      : "border-neutral-200 text-neutral-500 dark:border-neutral-800 dark:text-neutral-400";
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${toneClasses}`}>{children}</span>;
}
