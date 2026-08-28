"use client";

import { useState } from "react";
import { useMapStore } from "@/store/mapStore";
import { SEARCH_RESULT_ZOOM } from "@/lib/mapConfig";
import { isInUS, US_ONLY_MESSAGE } from "@/lib/usBounds";
import { parseLocationUrl, isShortMapLink } from "@/lib/parseLocationUrl";

type GeocodeResult = {
  lat: number;
  lon: number;
  displayName: string;
};

const NOT_A_LINK_MESSAGE =
  "Couldn't read a location from this link. Try pasting a Google Maps or OpenStreetMap link, or use the search box instead.";

export default function SearchBox() {
  const map = useMapStore((s) => s.map);
  const [mode, setMode] = useState<"search" | "paste">("search");
  const [query, setQuery] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Shared by both search and paste-link — one place enforcing the US-only
  // coverage constraint (project.md §2) so the two entry points can't drift
  // apart on when they allow/reject a location.
  function flyToIfInUS(lat: number, lon: number): boolean {
    if (!isInUS(lat, lon)) {
      setStatus("error");
      setErrorMessage(US_ONLY_MESSAGE);
      return false;
    }
    map?.flyTo({ center: [lon, lat], zoom: SEARCH_RESULT_ZOOM });
    setStatus("idle");
    return true;
  }

  function switchMode(next: "search" | "paste") {
    setMode(next);
    setStatus("idle");
    setErrorMessage("");
  }

  async function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || !map) return;

    setStatus("loading");
    setErrorMessage("");

    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Search failed");
      }

      const results = data as GeocodeResult[];
      if (results.length === 0) {
        setStatus("error");
        setErrorMessage("No results found.");
        return;
      }

      const first = results[0];
      flyToIfInUS(first.lat, first.lon);
    } catch {
      setStatus("error");
      setErrorMessage("Search failed. Try again.");
    }
  }

  async function handlePasteSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = linkInput.trim();
    if (!trimmed || !map) return;

    setStatus("loading");
    setErrorMessage("");

    // 1. Try both known long-URL patterns directly — no server round-trip.
    const direct = parseLocationUrl(trimmed);
    if (direct) {
      flyToIfInUS(direct.lat, direct.lng);
      return;
    }

    // 2. Only known Google short-link hosts are worth a server resolve —
    // anything else, don't bother making a request for garbage input.
    if (isShortMapLink(trimmed)) {
      try {
        const res = await fetch("/api/resolve-map-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = await res.json();

        if (!res.ok) {
          setStatus("error");
          setErrorMessage(NOT_A_LINK_MESSAGE);
          return;
        }

        flyToIfInUS(data.lat, data.lng);
      } catch {
        setStatus("error");
        setErrorMessage(NOT_A_LINK_MESSAGE);
      }
      return;
    }

    // 3. Neither pattern matched, and it's not a recognized short-link
    // host — a clear message, never a silent no-op.
    setStatus("error");
    setErrorMessage(NOT_A_LINK_MESSAGE);
  }

  return (
    <div className="w-full max-w-[18rem]">
      <div className="mb-1 flex items-center gap-1 text-[11px]">
        <button
          type="button"
          onClick={() => switchMode("search")}
          className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
            mode === "search"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => switchMode("paste")}
          className={`rounded-full px-2 py-0.5 font-medium transition-colors ${
            mode === "paste"
              ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
              : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          Paste a map link
        </button>
      </div>

      {mode === "search" ? (
        <form onSubmit={handleSearchSubmit}>
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md dark:border-neutral-800 dark:bg-neutral-950">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={1.75}
              stroke="currentColor"
              className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500"
            >
              <circle cx="11" cy="11" r="6.25" />
              <path strokeLinecap="round" d="m20 20-4-4" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a location…"
              className="w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-white dark:placeholder:text-neutral-500"
            />
            {status === "loading" && (
              <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-orange-500 dark:border-neutral-700" />
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={handlePasteSubmit}>
          <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md dark:border-neutral-800 dark:bg-neutral-950">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth={1.75}
              stroke="currentColor"
              className="h-4 w-4 shrink-0 text-neutral-400 dark:text-neutral-500"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6.5 17 3a3.5 3.5 0 0 1 5 5l-3.5 3.5m-5 5L10 20a3.5 3.5 0 0 1-5-5l3.5-3.5m1-1 5 5"
              />
            </svg>
            <input
              type="text"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="Paste a Google Maps or OSM link…"
              className="w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-white dark:placeholder:text-neutral-500"
            />
            {status === "loading" && (
              <div className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-orange-500 dark:border-neutral-700" />
            )}
          </div>
        </form>
      )}

      {status === "error" && (
        <p className="mt-1.5 rounded-md bg-white/90 px-2 py-1 text-xs text-red-500 shadow-sm dark:bg-neutral-950/90">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
