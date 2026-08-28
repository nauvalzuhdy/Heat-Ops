import type { Config } from "tailwindcss";

// HeatOps design tokens (visual redesign, Phase 1). Maps to the CSS variables
// defined in app/globals.css. These are UI/brand tokens only — they never
// touch lib/landcoverColors.ts (land-cover categories) or lib/tempToColor.ts
// (heat gradient), which stay hardcoded hex values on purpose (single source
// of truth for domain-semantic color, per project.md §4.2).
const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",

        app: "var(--bg-app)",
        surface: "var(--bg-surface)",
        "surface-2": "var(--bg-surface-2)",
        "border-subtle": "var(--border-subtle)",
        "border-strong": "var(--border-strong)",

        "fg-primary": "var(--fg-primary)",
        "fg-secondary": "var(--fg-secondary)",
        "fg-muted": "var(--fg-muted)",

        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft-bg)",
          border: "var(--accent-border)",
          fg: "var(--accent-fg-on-accent)",
        },

        status: {
          real: "var(--status-real-fg)",
          "real-bg": "var(--status-real-bg)",
          cached: "var(--status-cached-fg)",
          "cached-bg": "var(--status-cached-bg)",
          simulated: "var(--status-simulated-fg)",
          "simulated-bg": "var(--status-simulated-bg)",
          unavailable: "var(--status-unavailable-fg)",
          "unavailable-bg": "var(--status-unavailable-bg)",
        },

        // Severity (risk/urgency level) — a third, independent color category
        // from accent (brand/selection) and status (data provenance). Used by
        // Operational Analyst Overview's severity-glow cards/gauge only. Never
        // reused for lib/landcoverColors.ts or lib/thermalColorScale.ts.
        severity: {
          nominal: "var(--severity-nominal-fg)",
          "nominal-bg": "var(--severity-nominal-bg)",
          "nominal-glow": "var(--severity-nominal-glow)",
          caution: "var(--severity-caution-fg)",
          "caution-bg": "var(--severity-caution-bg)",
          "caution-glow": "var(--severity-caution-glow)",
          critical: "var(--severity-critical-fg)",
          "critical-bg": "var(--severity-critical-bg)",
          "critical-glow": "var(--severity-critical-glow)",
        },
      },
      borderRadius: {
        "card-lg": "1.75rem", // 28px — large immersive cards (map overlays, hero cards)
        "card-md": "1.25rem", // 20px — standard content cards
        "card-sm": "0.875rem", // 14px — compact cards, list items
        btn: "0.75rem", // 12px — buttons, inputs
      },
      boxShadow: {
        card: "var(--shadow-card)",
        float: "var(--shadow-float)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
export default config;
