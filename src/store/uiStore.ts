import { create } from "zustand";

type Theme = "light" | "dark";

type UIState = {
  sidebarOpen: boolean;
  theme: Theme;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
};

// Initial value must match the server-rendered default exactly (no reading
// document/localStorage here) or React's hydration diff fails. ThemeScript
// already applied the real theme to <html> before hydration runs, and
// ThemeSync reconciles this store with that DOM state right after mount —
// see ThemeSync for why that reconciliation is guarded against re-writing
// localStorage with this stale default.
export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  theme: "dark",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
  setTheme: (theme) => set({ theme }),
}));
