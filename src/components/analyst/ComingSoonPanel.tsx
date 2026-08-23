// Placeholder content for icon-toolbar tabs whose Sub-task hasn't shipped
// yet (project.md §5, Sub-task 3+). Keeps every tab clickable now so the
// toolbar's shape doesn't change as each panel gets filled in.
export default function ComingSoonPanel({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-200 text-center dark:border-neutral-800">
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="text-xs text-neutral-400 dark:text-neutral-600">Coming in a later sub-task.</p>
    </div>
  );
}
