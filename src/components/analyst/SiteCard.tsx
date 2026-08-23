"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type SiteCardProps = {
  id: string;
  name: string | null;
  siteAreaM2: number | null;
  /**
   * Pre-formatted by the server (see app/analyst/page.tsx), not raw
   * `created_at` — this is a Client Component, so a `toLocaleDateString()`
   * call here would hydrate against the browser's locale while the initial
   * HTML was rendered with Node's, mismatching whenever they differ.
   */
  createdAtLabel: string;
  heatPhotoUrl: string | null;
};

function SiteThumbnail({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-md bg-neutral-100 text-[11px] text-neutral-400 dark:bg-neutral-900 dark:text-neutral-600">
        No heat photo
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="Surface heat snapshot" className="aspect-video w-full rounded-md object-cover" />;
}

// Feature 2 — Edit (rename) and Delete actions for one saved site card.
// Split out from the async Server Component list (app/analyst/page.tsx) so
// this piece can hold interactive state (modals, in-flight requests) and
// trigger a router.refresh() once the underlying `sites` row changes.
export default function SiteCard({ id, name, siteAreaM2, createdAtLabel, heatPhotoUrl }: SiteCardProps) {
  const router = useRouter();
  const displayName = name ?? `Site ${id.slice(0, 8)}`;

  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState(name ?? "");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function openEdit() {
    setEditValue(name ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  async function handleEditSave() {
    setEditSaving(true);
    setEditError(null);
    try {
      const trimmed = editValue.trim();
      const res = await fetch(`/api/sites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed.length > 0 ? trimmed : null }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to save name");
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save name");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/sites/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to delete site");
      setDeleteOpen(false);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete site");
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <SiteThumbnail url={heatPhotoUrl} />
      <div className="flex flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-neutral-900 dark:text-white" title={id}>
          {displayName}
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {siteAreaM2 != null ? `${(siteAreaM2 / 1_000_000).toFixed(3)} km²` : "—"} · {createdAtLabel}
        </span>
      </div>

      <Link
        href={`/analyst?siteId=${id}`}
        className="mt-1 rounded-lg bg-neutral-900 px-3 py-2 text-center text-xs font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        View Analysis
      </Link>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={openEdit}
          className="flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => {
            setDeleteError(null);
            setDeleteOpen(true);
          }}
          className="flex-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          Delete
        </button>
      </div>

      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-950">
            <label htmlFor={`edit-name-${id}`} className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Site name
            </label>
            <input
              id={`edit-name-${id}`}
              type="text"
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              placeholder="e.g., Phoenix Industrial District, Downtown LA Warehouse"
              className="mt-2 w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:border-neutral-800 dark:text-white dark:placeholder:text-neutral-600"
            />
            {editError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{editError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                disabled={editSaving}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEditSave}
                disabled={editSaving}
                className="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
              >
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-neutral-950">
            <p className="text-sm text-neutral-900 dark:text-white">
              Are you sure you want to delete &lsquo;{displayName}&rsquo;? This action cannot be undone.
            </p>
            {deleteError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{deleteError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleting}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
