"use client";

// Rendered inline when the compare_interventions tool resolves — a compact
// cousin of RoiPanel.tsx's Intervention Comparison table, over whatever two
// options the model asked to compare (not necessarily trees/canopy/solar).
// resultBest/resultWorst are the high/low ends of a researched
// canopy-cooling range (see lib/copilotTools.ts's simulateRoiRange), not a
// single guaranteed number — identical for solar-only options.
type ROIResult = {
  totalCost: number;
  annualSavingsUSD: number;
  paybackYears: number | null;
  paybackBeyondHorizon: boolean;
};

type Option = {
  label: string;
  inputs: { horizonYears: number };
  resultBest: ROIResult;
  resultWorst: ROIResult;
  solarWarning: string | null;
};
type CompareData = { optionA: Option; optionB: Option };

function isCompareData(data: unknown): data is CompareData {
  return (
    typeof data === "object" &&
    data !== null &&
    "optionA" in (data as Record<string, unknown>) &&
    "optionB" in (data as Record<string, unknown>) &&
    "resultBest" in ((data as Record<string, unknown>).optionA as Record<string, unknown>)
  );
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

export default function InterventionComparisonMiniTable({ data }: { data: unknown }) {
  if (!isCompareData(data)) return null;
  const rows = [data.optionA, data.optionB];

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-neutral-200 text-[9px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            <th className="px-2.5 py-1.5 font-medium">Option</th>
            <th className="px-2.5 py-1.5 font-medium">Investment</th>
            <th className="px-2.5 py-1.5 font-medium">Savings/yr</th>
            <th className="px-2.5 py-1.5 font-medium">Payback</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const bestPayback = paybackLabel(r.resultBest, r.inputs.horizonYears);
            const worstPayback = paybackLabel(r.resultWorst, r.inputs.horizonYears);
            return (
              <tr key={r.label} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
                <td className="px-2.5 py-1.5 font-medium text-neutral-900 dark:text-white">{r.label}</td>
                <td className="px-2.5 py-1.5">{formatUSD(r.resultWorst.totalCost)}</td>
                <td className="px-2.5 py-1.5">{formatRange(r.resultWorst.annualSavingsUSD, r.resultBest.annualSavingsUSD, formatUSD)}</td>
                <td className="px-2.5 py-1.5 font-medium text-accent">
                  {bestPayback === worstPayback ? bestPayback : `${bestPayback} – ${worstPayback}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.some((r) => r.solarWarning) && (
        <div className="flex flex-col gap-1.5 border-t border-neutral-200 p-2.5 dark:border-neutral-800">
          {rows
            .filter((r) => r.solarWarning)
            .map((r) => (
              <p key={r.label} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                <span aria-hidden>⚠</span>
                <span>
                  <span className="font-medium">{r.label}:</span> {r.solarWarning}
                </span>
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
