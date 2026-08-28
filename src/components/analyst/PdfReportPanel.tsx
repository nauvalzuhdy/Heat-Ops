"use client";

// Download PDF Report tab (project.md §5, P1 Sub-task 6). The actual PDF is
// assembled server-side (app/api/sites/[id]/report/route.ts) — this panel is
// just the trigger + loading/error state, since generation involves a
// DeepSeek call for the narrative section and can take a few seconds.
import { useState } from "react";
import { Download } from "lucide-react";
import type { SiteRow } from "./types";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";

export default function PdfReportPanel({ row }: { row: SiteRow }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/sites/${row.id}/report`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `heatops-report-${(row.name ?? row.id.slice(0, 8)).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report");
      setStatus("error");
    }
  }

  return (
    <div
      className={`flex h-full min-h-[280px] flex-col items-center justify-center gap-3 rounded-card-lg border border-dashed border-border-subtle bg-surface py-16 text-center shadow-card ${CARD_HOVER_CLASS}`}
    >
      <Download size={28} className="text-fg-muted" />
      <div>
        <p className="text-sm font-medium text-fg-primary">Download PDF Report</p>
        <p className="mt-1 max-w-sm text-xs text-fg-muted">
          Compiles land-cover, hotspot zones, the Heat Mitigation recommendation, and an AI Copilot-written narrative
          summary into one PDF.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={status === "loading"}
        className="rounded-btn bg-accent px-4 py-2 text-xs font-semibold text-accent-fg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status === "loading" ? "Generating…" : "Download PDF"}
      </button>
      {error && <p className="max-w-sm text-xs text-red-500">{error}</p>}
    </div>
  );
}
