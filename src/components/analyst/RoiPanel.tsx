"use client";

// Heat Mitigation Planner — decision canvas (project.md §5, Sub-task 4,
// revised twice: first for the data-driven recommendation engine, now for
// information architecture). Business logic is UNCHANGED from the previous
// revision — lib/roiSimulator.ts's formula and lib/heatMitigationRecommendation.ts's
// rules are untouched. This file only restructures how that same data is
// laid out and interacted with:
//
//   SITE EVIDENCE -> HEATOPS RECOMMENDATION -> YOUR SCENARIO
//   -> RUN SIMULATION -> RESULT STRIP -> PAYBACK TRAJECTORY / COMPARISON
//
// Laid out as a CSS Grid "decision canvas", not a vertical stack of cards —
// see development.md for the full before/after rationale.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  simulateROI,
  DEFAULT_ROI_INPUTS,
  HORIZON_YEAR_OPTIONS,
  KWH_SAVED_PER_M2_PER_DEGREE_C,
  KWH_ASSUMPTION_SHORT_TEXT,
  KWH_ASSUMPTION_METHODOLOGY_BULLETS,
  EXPECTED_COOLING_ASSUMPTION_TEXT,
  ELECTRICITY_RATE_ASSUMPTION_TEXT,
  type ROIInputs,
  type ROIResult,
  type HorizonYears,
} from "@/lib/roiSimulator";
import {
  buildHeatMitigationRecommendation,
  HEAT_MITIGATION_ASSUMPTIONS_TEXT,
  type HeatMitigationRecommendation,
  type SiteMetrics,
} from "@/lib/heatMitigationRecommendation";
import type { SiteRow } from "./types";
import AttributionBadge, { type AttributionStatus } from "./AttributionBadge";

function formatUSD(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatEnergy(kwh: number): string {
  if (kwh >= 1000) return `${(kwh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MWh`;
  return `${Math.round(kwh).toLocaleString()} kWh`;
}

function paybackLabel(result: ROIResult, horizonYears: number): string {
  if (result.totalCost <= 0 && result.annualSavingsUSD <= 0) return "—";
  if (result.paybackYears === null) return "Never";
  if (result.paybackBeyondHorizon) return `> ${horizonYears}y`;
  return `${result.paybackYears.toFixed(1)}y`;
}

// ---------------------------------------------------------------------------
// Column 1 — Site Evidence: the real, already-analyzed data behind "here is
// the problem." Dense label/value rows, not individually bordered stat
// cards — provenance shown inline via the existing AttributionBadge rather
// than a new badge system.
// ---------------------------------------------------------------------------
function EvidenceRow({
  label,
  value,
  status,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  status?: AttributionStatus;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <div>
        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</div>
        {note && <div className="text-[10px] text-neutral-400 dark:text-neutral-600">{note}</div>}
      </div>
      <div className="flex items-center gap-1.5">
        {status && <AttributionBadge status={status} />}
        <span className={emphasis ? "text-base font-semibold text-neutral-900 dark:text-white" : "text-sm font-medium text-neutral-700 dark:text-neutral-200"}>
          {value}
        </span>
      </div>
    </div>
  );
}

function SiteEvidencePanel({ metrics, row }: { metrics: SiteMetrics; row: SiteRow }) {
  const deficitPct =
    metrics.treeCanopyPct != null ? Math.max(0, 25 - metrics.treeCanopyPct) : null;

  return (
    <section className="flex flex-col border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="mb-1 border-b border-neutral-100 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-900 dark:text-neutral-400">
        Site Evidence
      </h2>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-900">
        <EvidenceRow
          label="Tree coverage"
          note="FortyGuard centroid spot-check — a point-sample, not measured across the whole AOI"
          value={metrics.treeCanopyPct != null ? `${metrics.treeCanopyPct.toFixed(1)}%` : "N/A"}
          status={row.attribution?.landcover_spotcheck ?? "unavailable"}
          emphasis
        />
        <EvidenceRow label="Planning benchmark" value="25%" />
        <EvidenceRow
          label="Deficit vs. benchmark"
          value={deficitPct != null ? `${deficitPct.toFixed(1)}%` : "N/A"}
        />
        <EvidenceRow
          label="Peak heat"
          value={row.heat_stats ? `${row.heat_stats.maxTempC.toFixed(1)}°C` : "N/A"}
          status={row.attribution?.heat ?? "unavailable"}
        />
        <EvidenceRow
          label="Hotspot exposure"
          note="Share of captured heat tiles classified Critical/High"
          value={metrics.hotspotFractionOfTiles != null ? `${Math.round(metrics.hotspotFractionOfTiles * 100)}% of site` : "N/A"}
          status={row.attribution?.heat ?? "unavailable"}
        />
        <EvidenceRow
          label="Hotspot area"
          value={metrics.hotspotAreaM2 != null ? `${Math.round(metrics.hotspotAreaM2).toLocaleString()} m²` : "N/A"}
        />
        <EvidenceRow
          label="Green coverage"
          note="Overpass, AOI-wide — trees, grass, and parks combined, not tree-specific"
          value={metrics.greenCoveragePct != null ? `${metrics.greenCoveragePct.toFixed(1)}%` : "N/A"}
          status={row.attribution?.landcover ?? "unavailable"}
        />
        <EvidenceRow
          label="Building area"
          value={metrics.buildingAreaM2 != null ? `${Math.round(metrics.buildingAreaM2).toLocaleString()} m²` : "N/A"}
          status={row.attribution?.landcover ?? "unavailable"}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Column 2 — HeatOps Recommendation: system-generated starting point, "here
// is what HeatOps recommends." Visually distinct from Your Scenario via an
// outlined (not filled) primary action — the recommendation is a suggestion,
// Run Simulation is the decision.
// ---------------------------------------------------------------------------
function RecommendationLine({ icon, label, value, muted }: { icon: string; label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-5 text-center text-sm leading-none">{icon}</span>
      <span className="w-20 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className={muted ? "text-sm text-neutral-400 dark:text-neutral-600" : "text-sm font-semibold text-neutral-900 dark:text-white"}>
        {value}
      </span>
    </div>
  );
}

function RecommendationPanel({
  recommendation,
  onUseRecommendation,
}: {
  recommendation: HeatMitigationRecommendation;
  onUseRecommendation: () => void;
}) {
  const { treeCanopy, solar, explanation } = recommendation;

  return (
    <section className="flex flex-col border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="mb-1 border-b border-neutral-100 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:border-neutral-900 dark:text-neutral-400">
        HeatOps Recommendation
      </h2>

      {treeCanopy.status === "unavailable" && (
        <p className="mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
          <span className="font-medium text-neutral-700 dark:text-neutral-200">Recommendation unavailable — insufficient site data.</span>{" "}
          {treeCanopy.reason}
        </p>
      )}

      {treeCanopy.status === "benchmark_met" && (
        <div className="mt-2 flex flex-col gap-1.5">
          <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Benchmark met — no canopy deficit detected.</p>
          <p className="text-xs leading-relaxed text-neutral-500 dark:text-neutral-400">
            Existing tree canopy already meets the {treeCanopy.targetTreeCanopyPct}% planning benchmark used here.
            Use Your Scenario to run an optional what-if instead — HeatOps isn&apos;t prescribing an intervention.
          </p>
        </div>
      )}

      {treeCanopy.status === "deficit" && (
        <>
          {explanation[0] && (
            <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300">{explanation[0]}</p>
          )}
          <div className="mt-2 flex flex-col divide-y divide-neutral-100 dark:divide-neutral-900">
            <RecommendationLine icon="🌳" label="Recommended" value={`+${treeCanopy.recommendedTrees.toLocaleString()} trees`} />
            <RecommendationLine icon="☂" label="Alternative" value={`+${treeCanopy.recommendedCanopyM2.toLocaleString()} m² canopy`} />
            <RecommendationLine icon="☀" label="Solar" value="Custom scenario" muted />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-600">
            Trees and canopy close the same estimated {Math.round(treeCanopy.deficitAreaM2).toLocaleString()} m² gap —
            two equivalent units of one recommendation, not additive line items.
          </p>
          <button
            type="button"
            onClick={onUseRecommendation}
            className="mt-3 border border-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white dark:border-white dark:text-white dark:hover:bg-white dark:hover:text-neutral-900"
          >
            Use Recommendation
          </button>
        </>
      )}

      {solar.status === "custom_scenario" && (
        <p className="mt-2 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-600">
          <span className="font-medium text-neutral-500 dark:text-neutral-400">Solar:</span> {solar.reason}
        </p>
      )}

      {explanation[1] && (
        <p className="mt-2 border-t border-neutral-100 pt-2 text-[10px] leading-relaxed text-neutral-400 dark:border-neutral-900 dark:text-neutral-600">
          {explanation[1]}
        </p>
      )}

      <details className="mt-2 text-[10px] text-neutral-400 dark:text-neutral-600">
        <summary className="cursor-pointer select-none font-medium text-neutral-500 dark:text-neutral-400">
          Recommendation assumptions
        </summary>
        <p className="mt-1 leading-relaxed">{HEAT_MITIGATION_ASSUMPTIONS_TEXT}</p>
      </details>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Column 3 — Your Scenario: the editable inputs, paired quantity + unit cost
// per intervention type (underline-style fields, not boxed cards) so the
// whole scenario reads as one compact spec sheet.
// ---------------------------------------------------------------------------
function UnderlineNumberField({
  value,
  onChange,
  step = 1,
  min = 0,
  width = "w-16",
  align = "right",
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  width?: string;
  align?: "right" | "left";
}) {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      step={step}
      min={min}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className={`${width} border-b border-neutral-200 bg-transparent px-0.5 py-0.5 text-sm outline-none focus:border-orange-500 dark:border-neutral-800 dark:text-white ${align === "right" ? "text-right" : "text-left"}`}
    />
  );
}

function InterventionRow({
  icon,
  label,
  qty,
  qtyUnit,
  onQtyChange,
  cost,
  costUnit,
  onCostChange,
}: {
  icon: string;
  label: string;
  qty: number;
  qtyUnit: string;
  onQtyChange: (n: number) => void;
  cost: number;
  costUnit: string;
  onCostChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b border-neutral-100 py-2 last:border-b-0 dark:border-neutral-900">
      <span className="w-5 text-center text-sm leading-none">{icon}</span>
      <span className="w-14 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">{label}</span>
      <UnderlineNumberField value={qty} onChange={onQtyChange} width="w-20" />
      <span className="text-[10px] text-neutral-400 dark:text-neutral-600">{qtyUnit}</span>
      <span className="ml-auto text-[10px] text-neutral-400 dark:text-neutral-600">@ $</span>
      <UnderlineNumberField value={cost} onChange={onCostChange} width="w-14" />
      <span className="text-[10px] text-neutral-400 dark:text-neutral-600">/{costUnit}</span>
    </div>
  );
}

function ScenarioPanel({
  inputs,
  set,
  onReset,
  onRun,
  hasUnsavedChanges,
  saveState,
  saveNote,
}: {
  inputs: ROIInputs;
  set: <K extends keyof ROIInputs>(key: K, value: ROIInputs[K]) => void;
  onReset: () => void;
  onRun: () => void;
  hasUnsavedChanges: boolean;
  saveState: "idle" | "saving" | "saved";
  saveNote: string | null;
}) {
  return (
    <section className="flex flex-col border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-1 flex items-center justify-between border-b border-neutral-100 pb-1.5 dark:border-neutral-900">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Your Scenario</h2>
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] text-neutral-400 hover:text-neutral-700 hover:underline dark:text-neutral-600 dark:hover:text-neutral-200"
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col">
        <InterventionRow
          icon="🌳"
          label="Trees"
          qty={inputs.numTrees}
          qtyUnit="trees"
          onQtyChange={(n) => set("numTrees", Math.max(0, n))}
          cost={inputs.costPerTreeUSD}
          costUnit="tree"
          onCostChange={(n) => set("costPerTreeUSD", Math.max(0, n))}
        />
        <InterventionRow
          icon="☂"
          label="Canopy"
          qty={inputs.canopyM2}
          qtyUnit="m²"
          onQtyChange={(n) => set("canopyM2", Math.max(0, n))}
          cost={inputs.costPerCanopyM2USD}
          costUnit="m²"
          onCostChange={(n) => set("costPerCanopyM2USD", Math.max(0, n))}
        />
        <InterventionRow
          icon="☀"
          label="Solar"
          qty={inputs.solarKW}
          qtyUnit="kW"
          onQtyChange={(n) => set("solarKW", Math.max(0, n))}
          cost={inputs.costPerSolarKWUSD}
          costUnit="kW"
          onCostChange={(n) => set("costPerSolarKWUSD", Math.max(0, n))}
        />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 border-t border-neutral-100 pt-2 dark:border-neutral-900">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Budget (optional)</span>
          <div className="flex items-center gap-0.5">
            <span className="text-[10px] text-neutral-400">$</span>
            <UnderlineNumberField value={inputs.budgetUSD ?? 0} onChange={(n) => set("budgetUSD", n || null)} width="w-full" align="left" />
          </div>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Electricity ($/kWh)</span>
          <UnderlineNumberField
            value={inputs.electricityRateUSDPerKWh}
            onChange={(n) => set("electricityRateUSDPerKWh", Math.max(0, n))}
            step={0.001}
            width="w-full"
            align="left"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-neutral-500 dark:text-neutral-400">Horizon</span>
          <select
            value={inputs.horizonYears}
            onChange={(e) => set("horizonYears", Number(e.target.value) as HorizonYears)}
            className="border-b border-neutral-200 bg-transparent py-0.5 text-sm outline-none focus:border-orange-500 dark:border-neutral-800 dark:text-white"
          >
            {HORIZON_YEAR_OPTIONS.map((y) => (
              <option key={y} value={y} className="text-neutral-900">
                {y}y
              </option>
            ))}
          </select>
        </label>
      </div>

      <details className="mt-2 text-[10px] text-neutral-400 dark:text-neutral-600">
        <summary className="cursor-pointer select-none font-medium text-neutral-500 dark:text-neutral-400">
          Cooling &amp; energy assumptions
        </summary>
        <div className="mt-1.5 flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5">
              <span>Expected cooling</span>
              <UnderlineNumberField value={inputs.expectedCoolingC} onChange={(n) => set("expectedCoolingC", Math.max(0, n))} step={0.1} width="w-12" align="left" />
              <span>°C</span>
            </label>
            <p className="leading-relaxed">{EXPECTED_COOLING_ASSUMPTION_TEXT}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1.5">
              <span>
                kWh/m²/°C (range {KWH_SAVED_PER_M2_PER_DEGREE_C.low}–{KWH_SAVED_PER_M2_PER_DEGREE_C.high})
              </span>
              <UnderlineNumberField value={inputs.kwhPerM2PerDegreeC} onChange={(n) => set("kwhPerM2PerDegreeC", Math.max(0, n))} step={0.05} width="w-12" align="left" />
            </label>
            <p className="leading-relaxed">{KWH_ASSUMPTION_SHORT_TEXT}</p>
            <ul className="list-disc space-y-1 pl-4 leading-relaxed">
              {KWH_ASSUMPTION_METHODOLOGY_BULLETS.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
          <p className="leading-relaxed">{ELECTRICITY_RATE_ASSUMPTION_TEXT}</p>
        </div>
      </details>

      <button
        type="button"
        onClick={onRun}
        className="mt-3 bg-orange-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-700"
      >
        Run Simulation
      </button>
      <p className="mt-1 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-600">
        {saveNote
          ? saveNote
          : hasUnsavedChanges
            ? "Results below already update live as you type — Run Simulation saves this scenario to the site."
            : saveState === "saving"
              ? "Saving…"
              : "✓ Scenario saved."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Result strip — one horizontal row, not four mini-cards.
// ---------------------------------------------------------------------------
function ResultMetric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className={`text-lg font-semibold ${accent ? "text-orange-600 dark:text-orange-400" : "text-neutral-900 dark:text-white"}`}>{value}</div>
    </div>
  );
}

function ResultStrip({ result, inputs, justRan }: { result: ROIResult; inputs: ROIInputs; justRan: boolean }) {
  const degenerate = result.totalCost <= 0 && result.annualSavingsUSD <= 0;
  const neverPaysBack = !degenerate && result.paybackYears === null;
  const beyondHorizon = !degenerate && !neverPaysBack && result.paybackBeyondHorizon;

  return (
    <section className={`border border-neutral-200 transition-shadow dark:border-neutral-800 ${justRan ? "ring-2 ring-orange-500" : ""}`}>
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5 dark:border-neutral-900">
        <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Simulation Result</h2>
        <span className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-600">
          Simulated · based on site data + your inputs
        </span>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-neutral-100 dark:divide-neutral-900 sm:grid-cols-4 sm:divide-y-0">
        <ResultMetric label="Investment" value={formatUSD(result.totalCost)} />
        <ResultMetric label="Annual savings" value={formatUSD(result.annualSavingsUSD)} />
        <ResultMetric label="Energy saved / yr" value={formatEnergy(result.estimatedKwhSavedPerYear)} />
        <ResultMetric label="Payback" value={paybackLabel(result, inputs.horizonYears)} accent={!degenerate && !neverPaysBack && !beyondHorizon} />
      </div>
      {(degenerate || neverPaysBack || beyondHorizon) && (
        <p className="border-t border-neutral-100 px-3 py-1.5 text-[11px] text-amber-600 dark:border-neutral-900 dark:text-amber-400">
          {degenerate
            ? "Enter a number of trees, canopy area, or solar capacity in Your Scenario to see a result."
            : neverPaysBack
              ? "With these assumptions, this investment does not pay back — estimated annual savings are $0."
              : `Estimated payback (~${result.paybackYears?.toFixed(1)} years) falls beyond your ${inputs.horizonYears}-year horizon.`}
        </p>
      )}
      {inputs.budgetUSD != null && inputs.budgetUSD > 0 && result.totalCost > inputs.budgetUSD && (
        <p className="border-t border-neutral-100 px-3 py-1.5 text-[11px] text-amber-600 dark:border-neutral-900 dark:text-amber-400">
          Total cost ({formatUSD(result.totalCost)}) exceeds your available budget ({formatUSD(inputs.budgetUSD)}).
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Payback Trajectory chart — hand-rolled SVG (unchanged math, restyled
// payback-line color to the app's existing orange accent instead of violet).
// ---------------------------------------------------------------------------
function PaybackTrajectoryChart({ result, horizonYears }: { result: ROIResult; horizonYears: number }) {
  const width = 480;
  const height = 180;
  const padL = 56;
  const padR = 12;
  const padT = 10;
  const padB = 20;

  const years = Array.from({ length: horizonYears }, (_, i) => i + 1);
  const maxY = Math.max(1, ...result.cumulativeCostByYear, ...result.cumulativeSavingsByYear);
  const xFor = (year: number) => padL + ((year - 1) / Math.max(1, horizonYears - 1)) * (width - padL - padR);
  const yFor = (val: number) => height - padB - (val / maxY) * (height - padT - padB);

  const costPath = years.map((y, i) => `${xFor(y)},${yFor(result.cumulativeCostByYear[i])}`).join(" ");
  const savingsPath = years.map((y, i) => `${xFor(y)},${yFor(result.cumulativeSavingsByYear[i])}`).join(" ");
  const paybackX =
    result.paybackYears != null && !result.paybackBeyondHorizon ? xFor(Math.max(1, result.paybackYears)) : null;

  const yTickCount = 3;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => (maxY / yTickCount) * i);
  const xLabelStep = Math.max(1, Math.ceil(horizonYears / 6));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Cumulative investment versus cumulative savings over the simulation horizon">
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={yFor(t)} x2={width - padR} y2={yFor(t)} stroke="currentColor" strokeOpacity={0.08} />
          <text x={padL - 6} y={yFor(t) + 3} fontSize={8} textAnchor="end" fill="currentColor" fillOpacity={0.5}>
            {t >= 1000 ? `$${Math.round(t / 1000)}k` : `$${Math.round(t)}`}
          </text>
        </g>
      ))}
      {years
        .filter((y) => y === 1 || y === horizonYears || y % xLabelStep === 0)
        .map((y) => (
          <text key={y} x={xFor(y)} y={height - padB + 14} fontSize={8} textAnchor="middle" fill="currentColor" fillOpacity={0.5}>
            {y}
          </text>
        ))}
      <polyline points={costPath} fill="none" stroke="#dc2626" strokeWidth={2} strokeLinejoin="round" />
      <polyline points={savingsPath} fill="none" stroke="#059669" strokeWidth={2} strokeLinejoin="round" />
      {paybackX != null && (
        <>
          <line x1={paybackX} y1={padT} x2={paybackX} y2={height - padB} stroke="#ea580c" strokeDasharray="4 3" strokeWidth={1.5} />
          <text x={paybackX} y={padT - 2} fontSize={8} fill="#ea580c" textAnchor="middle" fontWeight={600}>
            Payback
          </text>
        </>
      )}
    </svg>
  );
}

function PaybackTrajectoryPanel({ result, horizonYears }: { result: ROIResult; horizonYears: number }) {
  return (
    <section className="flex flex-col border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Payback Trajectory</h2>
      <p className="mb-1 text-[11px] text-neutral-500 dark:text-neutral-400">When does this intervention recover its initial investment?</p>
      <PaybackTrajectoryChart result={result} horizonYears={horizonYears} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-neutral-500 dark:text-neutral-400">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-red-600" /> Cumulative investment
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-emerald-600" /> Cumulative savings
        </span>
        {!result.paybackBeyondHorizon && result.paybackYears !== null && (
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-0.5 border-l-2 border-dashed border-orange-500" /> Payback point
          </span>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Intervention Comparison — re-runs the SAME unmodified simulateROI() in
// isolation per intervention type (zeroing the other two quantities), rather
// than inventing a per-intervention savings model that doesn't exist in the
// underlying formula. Only shown when the scenario actually has 2+
// intervention types with a nonzero quantity to compare.
// ---------------------------------------------------------------------------
type ComparisonRow = { key: string; icon: string; label: string; quantity: string; result: ROIResult };

function buildComparisonRows(inputs: ROIInputs, areaM2: number): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  if (inputs.numTrees > 0) {
    rows.push({
      key: "trees",
      icon: "🌳",
      label: "Trees",
      quantity: `${inputs.numTrees.toLocaleString()} trees`,
      result: simulateROI({ ...inputs, canopyM2: 0, solarKW: 0 }, areaM2),
    });
  }
  if (inputs.canopyM2 > 0) {
    rows.push({
      key: "canopy",
      icon: "☂",
      label: "Canopy",
      quantity: `${inputs.canopyM2.toLocaleString()} m²`,
      result: simulateROI({ ...inputs, numTrees: 0, solarKW: 0 }, areaM2),
    });
  }
  if (inputs.solarKW > 0) {
    rows.push({
      key: "solar",
      icon: "☀",
      label: "Solar",
      quantity: `${inputs.solarKW.toLocaleString()} kW`,
      result: simulateROI({ ...inputs, numTrees: 0, canopyM2: 0 }, areaM2),
    });
  }
  return rows;
}

function InterventionComparisonPanel({ inputs, areaM2 }: { inputs: ROIInputs; areaM2: number }) {
  const rows = useMemo(() => buildComparisonRows(inputs, areaM2), [inputs, areaM2]);

  return (
    <section className="flex flex-col border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">Intervention Comparison</h2>
      <p className="mb-1 text-[11px] text-neutral-500 dark:text-neutral-400">Which intervention gives the better financial outcome?</p>

      {rows.length < 2 ? (
        <p className="py-4 text-xs text-neutral-400 dark:text-neutral-600">
          Comparison unavailable — this scenario uses only {rows.length === 1 ? "one intervention type" : "no interventions yet"}.
          Add a second (trees, canopy, or solar) in Your Scenario to compare outcomes.
        </p>
      ) : (
        <>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-200 text-[10px] uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
                <th className="py-1.5 font-medium">Intervention</th>
                <th className="py-1.5 font-medium">Investment</th>
                <th className="py-1.5 font-medium">Annual savings</th>
                <th className="py-1.5 font-medium">Payback</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-neutral-100 last:border-b-0 dark:border-neutral-900">
                  <td className="py-1.5">
                    <span className="mr-1.5">{r.icon}</span>
                    {r.label}
                    <span className="ml-1.5 text-neutral-400 dark:text-neutral-600">({r.quantity})</span>
                  </td>
                  <td className="py-1.5 font-medium text-neutral-900 dark:text-white">{formatUSD(r.result.totalCost)}</td>
                  <td className="py-1.5 font-medium text-neutral-900 dark:text-white">{formatUSD(r.result.annualSavingsUSD)}</td>
                  <td className="py-1.5 font-medium text-neutral-900 dark:text-white">{paybackLabel(r.result, inputs.horizonYears)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-600">
            Each row re-runs the same ROI calculation using only that intervention&apos;s quantity, holding your other
            assumptions fixed — not a separate model.
          </p>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
const LOAD_STATE = { loading: "loading", ready: "ready" } as const;

export default function RoiPanel({ row, bbox }: { row: SiteRow; bbox: [number, number, number, number] | null }) {
  const [inputs, setInputs] = useState<ROIInputs>(DEFAULT_ROI_INPUTS);
  const [loadState, setLoadState] = useState<(typeof LOAD_STATE)[keyof typeof LOAD_STATE]>(LOAD_STATE.loading);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [lastSavedInputs, setLastSavedInputs] = useState<ROIInputs | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [justRan, setJustRan] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSaveRef = useRef(true); // true until the initial load finishes, so loading doesn't immediately re-save
  const justRanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recommendation = useMemo(
    () =>
      buildHeatMitigationRecommendation({
        siteAreaM2: row.site_area_m2,
        landcover: row.landcover,
        landcoverSpotcheck: row.landcover_spotcheck,
        heatTiles: row.heat_tiles,
        bbox,
      }),
    [row.site_area_m2, row.landcover, row.landcover_spotcheck, row.heat_tiles, bbox],
  );

  // Load any previously-saved inputs for this site; if none exist, seed
  // numTrees from the recommendation engine's initial scenario.
  useEffect(() => {
    let cancelled = false;
    setLoadState(LOAD_STATE.loading);
    skipNextSaveRef.current = true;

    fetch(`/api/sites/${row.id}/roi`)
      .then((res) => res.json())
      .then((body: { roiInputs: ROIInputs | null }) => {
        if (cancelled) return;
        let resolved: ROIInputs;
        if (body.roiInputs) {
          resolved = body.roiInputs;
        } else {
          const rec = buildHeatMitigationRecommendation({
            siteAreaM2: row.site_area_m2,
            landcover: row.landcover,
            landcoverSpotcheck: row.landcover_spotcheck,
            heatTiles: row.heat_tiles,
            bbox,
          });
          resolved = { ...DEFAULT_ROI_INPUTS, numTrees: rec.treeCanopy.status === "deficit" ? rec.treeCanopy.recommendedTrees : 0 };
        }
        setInputs(resolved);
        setLastSavedInputs(resolved);
        setLoadState(LOAD_STATE.ready);
      })
      .catch((err) => {
        console.error("[roi] failed to load saved inputs:", err);
        if (!cancelled) setLoadState(LOAD_STATE.ready);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  function persist(toSave: ROIInputs) {
    setSaveState("saving");
    return fetch(`/api/sites/${row.id}/roi`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roiInputs: toSave }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        setSaveNote(null);
        setSaveState("saved");
        setLastSavedInputs(toSave);
      })
      .catch((err) => {
        console.error("[roi] failed to save inputs:", err);
        setSaveNote("Couldn't save your inputs to this site — they'll still work for this session.");
        setSaveState("idle");
      });
  }

  // Debounced per-site autosave — still fires in the background even if the
  // user never clicks Run Simulation, so a scenario is never lost.
  useEffect(() => {
    if (loadState !== LOAD_STATE.ready) return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persist(inputs);
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, loadState, row.id]);

  useEffect(() => {
    return () => {
      if (justRanTimerRef.current) clearTimeout(justRanTimerRef.current);
    };
  }, []);

  const areaM2 = row.site_area_m2 ?? 0;
  // Live recompute — unchanged from before. Run Simulation (below) doesn't
  // gate this; it forces an immediate save + visible confirmation instead of
  // waiting for the debounce, since the computation itself is already
  // reactive on every input change.
  const result = useMemo(() => simulateROI(inputs, areaM2), [inputs, areaM2]);

  function set<K extends keyof ROIInputs>(key: K, value: ROIInputs[K]) {
    setInputs((prev) => ({ ...prev, [key]: value }));
  }

  function useRecommendedScenario() {
    const treeCanopy = recommendation.treeCanopy;
    if (treeCanopy.status !== "deficit") return;
    setInputs((prev) => ({ ...prev, numTrees: treeCanopy.recommendedTrees, canopyM2: 0 }));
  }

  function resetCustomScenario() {
    setInputs(DEFAULT_ROI_INPUTS);
  }

  function runSimulation() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    persist(inputs);
    setJustRan(true);
    if (justRanTimerRef.current) clearTimeout(justRanTimerRef.current);
    justRanTimerRef.current = setTimeout(() => setJustRan(false), 900);
  }

  const hasUnsavedChanges = lastSavedInputs !== null && JSON.stringify(lastSavedInputs) !== JSON.stringify(inputs);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between border-b border-neutral-200 pb-2 dark:border-neutral-800">
        <div>
          <h1 className="text-sm font-semibold text-neutral-900 dark:text-white">Heat Mitigation Planner</h1>
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Site evidence → HeatOps recommendation → your scenario → run simulation → result
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-[0.9fr_1.1fr_1.1fr]">
        <SiteEvidencePanel metrics={recommendation.metrics} row={row} />
        <RecommendationPanel recommendation={recommendation} onUseRecommendation={useRecommendedScenario} />
        <div className="md:col-span-2 lg:col-span-1">
          <ScenarioPanel
            inputs={inputs}
            set={set}
            onReset={resetCustomScenario}
            onRun={runSimulation}
            hasUnsavedChanges={hasUnsavedChanges}
            saveState={saveState}
            saveNote={saveNote}
          />
        </div>
      </div>

      <ResultStrip result={result} inputs={inputs} justRan={justRan} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PaybackTrajectoryPanel result={result} horizonYears={inputs.horizonYears} />
        <InterventionComparisonPanel inputs={inputs} areaM2={areaM2} />
      </div>

      <p className="text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-600">
        Cooling reduction and energy savings are ESTIMATED from the assumptions in Your Scenario, not measured —
        HeatOps does not directly measure the actual cooling or energy impact of any intervention.
      </p>
    </div>
  );
}
