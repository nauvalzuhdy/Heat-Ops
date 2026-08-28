// Shared card primitive (visual redesign, Phase 1 — design system). "Physical
// surfaces floating slightly above the application," per the redesign brief:
// subtle border, soft shadow, no heavy outlines, no glassmorphism/blur by
// default. `floating` is for elements genuinely overlaid on the map/canvas
// (a stronger shadow to read as detached from the surface below), not a
// general-purpose "make it fancier" toggle.
import type { HTMLAttributes, ReactNode } from "react";

export type CardSize = "lg" | "md" | "sm";

const RADIUS: Record<CardSize, string> = {
  lg: "rounded-card-lg",
  md: "rounded-card-md",
  sm: "rounded-card-sm",
};

const PADDING: Record<CardSize, string> = {
  lg: "p-6",
  md: "p-5",
  sm: "p-3.5",
};

type CardProps = {
  size?: CardSize;
  floating?: boolean;
  translucent?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>;

export default function Card({ size = "md", floating = false, translucent = false, className = "", children, ...rest }: CardProps) {
  return (
    <div
      className={[
        "border border-border-subtle text-fg-primary",
        translucent ? "bg-surface/85 backdrop-blur-md" : "bg-surface",
        RADIUS[size],
        PADDING[size],
        floating ? "shadow-float" : "shadow-card",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
