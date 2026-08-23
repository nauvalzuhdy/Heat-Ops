"use client";

import { useState } from "react";

type SiteNameModalProps = {
  open: boolean;
  saving?: boolean;
  onCancel: () => void;
  onSave: (name: string) => void;
};

// Feature 1 — appears once analysis succeeds and the site record is about to
// be saved, so the user can give it a meaningful name instead of it landing
// in Supabase auto-named. See AnalyzePanel.tsx for the trigger.
export default function SiteNameModal({ open, saving, onCancel, onSave }: SiteNameModalProps) {
  const [value, setValue] = useState("");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-950">
        <label htmlFor="site-name-input" className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
          Give this site a name (optional)
        </label>
        <input
          id="site-name-input"
          type="text"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g., Phoenix Industrial District, Downtown LA Warehouse"
          className="mt-2 w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-800 dark:text-white dark:placeholder:text-neutral-600"
        />
        <p className="mt-1.5 text-[11px] text-neutral-400 dark:text-neutral-600">
          Leave blank to auto-generate a name from the site&apos;s location.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(value)}
            disabled={saving}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            {saving ? "Saving…" : "Save & Analyze"}
          </button>
        </div>
      </div>
    </div>
  );
}
