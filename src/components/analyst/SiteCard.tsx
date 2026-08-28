"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { CARD_HOVER_CLASS } from "@/lib/motionVariants";

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
  /** "3h ago" / "2d ago" — also pre-formatted server-side, see lib/relativeTime.ts. */
  analyzedAgoLabel: string;
  heatPhotoUrl: string | null;
  satellitePhotoUrl: string | null;
};

// Feature 2 — Edit (rename) and Delete actions for one saved site card.
// Split out from the async Server Component list (app/analyst/page.tsx) so
// this piece can hold interactive state (modals, in-flight requests) and
// trigger a router.refresh() once the underlying `sites` row changes.
//
// Visual redesign (project.md §5): hero-style card — the site's own
// heat_photo_url (falling back to satellite_photo_url when no heat capture
// exists yet) fills the entire card as a background image instead of a
// small thumbnail, with a dark gradient overlay for text legibility. Edit/
// Delete are icon buttons that fade in on hover instead of always-visible
// text buttons, so the card reads clean when not being interacted with.
// The edit/delete STATE and MODALS below are unchanged from the previous
// revision — this is a shell restructure, not a logic change.
//
// No entrance animation (follow-up request, project.md §5) — the card used
// to fade+slide up on mount via framer-motion; that's removed so the card
// sits still at its final position from the first frame. Hover treatment
// reuses the shared CARD_HOVER_CLASS (lib/motionVariants.ts) instead of its
// own hardcoded hover:scale/shadow-xl — that scale used to make this card
// visually overlap its grid neighbors on hover (the same hover-popup bug
// fixed there), and duplicating the hover style here separately was exactly
// the drift that bug slipped through in.
export default function SiteCard({
  id,
  name,
  siteAreaM2,
  createdAtLabel,
  analyzedAgoLabel,
  heatPhotoUrl,
  satellitePhotoUrl,
}: SiteCardProps) {
  const router = useRouter();
  const displayName = name ?? `Site ${id.slice(0, 8)}`;
  const photoUrl = heatPhotoUrl ?? satellitePhotoUrl;

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
    <div className={`group relative h-56 overflow-hidden rounded-xl border border-neutral-200 shadow-sm dark:border-neutral-800 ${CARD_HOVER_CLASS}`}>
      {/* Whole-card link — everything except the edit/delete buttons below
          sits inside it, including the image/gradient/text, so clicking
          anywhere on the photo or name opens the analysis. Edit/Delete are
          deliberately siblings positioned AFTER this in the DOM (not
          descendants of it) so their clicks never also trigger navigation —
          nesting interactive buttons inside an <a> is both invalid HTML and
          unreliable for click handling. */}
      <Link href={`/analyst?siteId=${id}`} className="absolute inset-0 flex flex-col justify-end" aria-label={`View analysis for ${displayName}`}>
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-neutral-100 dark:bg-neutral-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

        <span className="absolute left-3 top-3 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          Analyzed {analyzedAgoLabel}
        </span>

        <div className="relative z-10 flex flex-col gap-0.5 p-4">
          <span className="truncate text-sm font-semibold text-white" title={id}>
            {displayName}
          </span>
          <span className="text-xs text-white/80">
            {siteAreaM2 != null ? `${(siteAreaM2 / 1_000_000).toFixed(3)} km²` : "—"} · {createdAtLabel}
          </span>
        </div>
      </Link>

      {/* Hidden until hover/focus (z-20, above the Link's implicit stacking)
          — icon-only so a clean card doesn't read as cluttered with two
          always-visible text buttons. */}
      <div className="absolute right-3 top-3 z-20 flex gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            openEdit();
          }}
          aria-label="Edit site name"
          className="rounded-full bg-black/55 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setDeleteError(null);
            setDeleteOpen(true);
          }}
          aria-label="Delete site"
          className="rounded-full bg-black/55 p-1.5 text-white backdrop-blur-sm transition-colors hover:bg-red-600"
        >
          <Trash2 size={14} />
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
