"use client";

import { useState } from "react";
import { useMapStore } from "@/store/mapStore";
import { SEARCH_RESULT_ZOOM } from "@/lib/mapConfig";

type GeocodeResult = {
  lat: number;
  lon: number;
  displayName: string;
};

export default function SearchBox() {
  const map = useMapStore((s) => s.map);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
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
      map.flyTo({ center: [first.lon, first.lat], zoom: SEARCH_RESULT_ZOOM });
      setStatus("idle");
    } catch {
      setStatus("error");
      setErrorMessage("Search failed. Try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-72">
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
      {status === "error" && (
        <p className="mt-1.5 rounded-md bg-white/90 px-2 py-1 text-xs text-red-500 shadow-sm dark:bg-neutral-950/90">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
