"use client";

import { useEffect, useRef } from "react";
import { useUIStore } from "@/store/uiStore";

export default function ThemeSync() {
  const theme = useUIStore((s) => s.theme);
  const setTheme = useUIStore((s) => s.setTheme);
  const skipNextWrite = useRef(true);

  // Reconcile the store's static default with whatever ThemeScript already
  // applied to <html> pre-hydration (real theme from localStorage/system).
  useEffect(() => {
    const actual = document.documentElement.classList.contains("dark") ? "dark" : "light";
    if (actual !== theme) setTheme(actual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The first run reflects the reconciliation above (or the untouched
    // default), and the DOM/localStorage are already correct at that point —
    // writing here would clobber a real stored preference with the store's
    // stale initial default. Only persist on actual theme changes after that.
    if (skipNextWrite.current) {
      skipNextWrite.current = false;
      return;
    }
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("heatops-theme", theme);
    } catch {
      // ignore storage failures (e.g. private browsing)
    }
  }, [theme]);

  return null;
}
