"use client";

// Rendered inline when the simulate_roi tool resolves — a compact readout of
// the same ROIResult shape lib/roiSimulator.ts's simulateROI() returns,
// styled as a chat aside rather than reusing RoiPanel.tsx's full dashboard
// layout. resultBest/resultWorst are the high/low ends of a researched
// canopy-cooling range (see lib/copilotTools.ts's simulateRoiRange), not a
// single guaranteed number — identical for solar-only scenarios.
type ROIResult = {
  totalCost: number;
  annualSavingsUSD: number;
  estimatedKwhSavedPerYear: number;
  paybackYears: number | null;
  paybackBeyondHorizon: boolean;
};

type SimulateRoiData = {
  inputs: { horizonYears: number };
  resultBest: ROIResult;
  resultWorst: ROIResult;
  isRange: boolean;
  solarWarning: string | null;
};

function isSimulateRoiData(data: unknown): data is SimulateRoiData {
  return typeof data === "object" && data !== null && "resultBest" in (data as Record<string, unknown>);
}

function formatUSD(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatRange(low: number, high: number, formatter: (n: number) => string): string {
  if (Math.abs(high - low) < 1e-9) return formatter(low);
  return `${formatter(low)} – ${formatter(high)}`;
}

function paybackLabel(result: ROIResult, horizonYears: number): string {
  if (result.totalCost <= 0 && result.annualSavingsUSD <= 0) return "—";
  if (result.paybackYears === null) return "Never";
  if (result.paybackBeyondHorizon) return `> ${horizonYears}y`;
  return `${result.paybackYears.toFixed(1)}y`;
}

export default function RoiResultMiniCard({ data }: { data: unknown }) {
  if (!isSimulateRoiData(data)) return null;
  const { resultBest, resultWorst, inputs, solarWarning } = data;
  const bestPayback = paybackLabel(resultBest, inputs.horizonYears);
  const worstPayback = paybackLabel(resultWorst, inputs.horizonYears);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-3 divide-x divide-neutral-200 rounded-lg border border-neutral-200 bg-neutral-50 dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900/40">
        <div className="p-2.5">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Investment</div>
          <div className="text-sm font-semibold text-neutral-900 dark:text-white">{formatUSD(resultWorst.totalCost)}</div>
        </div>
        <div className="p-2.5">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Annual savings</div>
          <div className="text-sm font-semibold text-neutral-900 dark:text-white">
            {formatRange(resultWorst.annualSavingsUSD, resultBest.annualSavingsUSD, formatUSD)}
          </div>
        </div>
        <div className="p-2.5">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Payback</div>
          <div className="text-sm font-semibold text-accent">
            {bestPayback === worstPayback ? bestPayback : `${bestPayback} – ${worstPayback}`}
          </div>
        </div>
      </div>
      {solarWarning && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <span aria-hidden>⚠</span>
          {solarWarning}
        </p>
      )}
    </div>
  );
}
