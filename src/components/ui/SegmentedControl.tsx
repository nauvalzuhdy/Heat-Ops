"use client";

// Shared segmented control (visual redesign, Phase 1) — for the Map View
// phase's time selector (Now/+3h/.../+12h), 3D mode toggle (Massing/
// Land-cover), and Satellite/Schematic view toggle. Generic over the option
// value type so each caller keeps its own real union type instead of this
// component inventing one.
export type SegmentedOption<T extends string> = { value: T; label: string; disabled?: boolean; title?: string };

export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-0.5 rounded-full border border-border-subtle bg-surface-2 p-1 ${className}`} role="group">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => !opt.disabled && onChange(opt.value)}
            aria-pressed={active}
            aria-disabled={opt.disabled}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors duration-200 ${
              opt.disabled
                ? "cursor-not-allowed text-fg-muted opacity-40"
                : active
                  ? "bg-accent text-accent-fg"
                  : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
