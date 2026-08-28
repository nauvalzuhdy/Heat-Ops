// Shared button primitive (visual redesign, Phase 1). Three variants cover
// every existing button style in the app (primary CTA, bordered secondary,
// text-only ghost) so later phases can swap raw `<button className="...">`
// markup for this without changing what any button actually does.
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-btn font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-strong",
  secondary: "border border-border-subtle bg-surface text-fg-primary hover:bg-surface-2",
  ghost: "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary",
  danger: "border border-status-cached-bg bg-transparent text-red-500 hover:bg-red-500/10",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export default function Button({ variant = "secondary", size = "md", className = "", ...rest }: ButtonProps) {
  return <button className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`} {...rest} />;
}
