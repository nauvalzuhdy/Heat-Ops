"use client";

// §4.1 (SearchBox Map View) + §4.5 (RoutePanel From/To) — ONE reusable
// autocomplete input backing both call sites, so the debounce/race-condition/
// keyboard-nav logic can't drift between two separate implementations (the
// exact pattern of bug project.md calls out re: landcover colors).
//
// Debounced live suggestions from /api/geocode (Nominatim), which already
// restricts to `countrycodes=us` server-side (project.md §2) — so an
// out-of-US place simply never appears in the dropdown, rather than
// appearing and then being rejected on selection. isInUS/US_ONLY_MESSAGE is
// kept as a defensive second check only (belt-and-suspenders against a
// Nominatim edge case), not the primary enforcement.
import { useEffect, useId, useRef, useState } from "react";
import { isInUS, US_ONLY_MESSAGE } from "@/lib/usBounds";

export type LocationSuggestion = {
  lat: number;
  lon: number;
  displayName: string;
  shortAddress: string;
};

const DEBOUNCE_MS = 350;
const MIN_QUERY_LENGTH = 2;
const MAX_SUGGESTIONS = 5;

type Props = {
  placeholder: string;
  onSelect: (result: LocationSuggestion) => void;
  /** Compact "From"/"To" label prefix (RoutePanel). Omit for the full
   *  search-icon style (SearchBox's "Search" tab). */
  label?: string;
  autoFocus?: boolean;
  /** Read fresh at request time (not a static prop) so a map pan between
   *  keystrokes is picked up — biases Nominatim ranking toward the current
   *  map view (e.g. "Phoenix" -> POIs in Phoenix, AZ, not Phoenix, IL). */
  getBiasCenter?: () => [number, number] | null;
  /** Small hint rendered under the input ("Select a location from the
   *  list…") — the only way to confirm a pick is click-a-suggestion (or
   *  Enter, which falls back to the first suggestion below), and that
   *  wasn't otherwise obvious from the input alone. Hidden while the
   *  dropdown itself is open, since it would sit underneath it. */
  helperText?: string;
  /** Externally-driven display text (RoutePanel's origin/destination.name)
   *  — synced into the input whenever it changes, so a point set some other
   *  way (map click + reverse geocode, landing later) still shows up here.
   *  Omit for a purely self-contained instance (SearchBox), where nothing
   *  outside this component ever needs to override what's typed/picked. */
  displayValue?: string;
};

export default function LocationAutocomplete({
  placeholder,
  onSelect,
  label,
  autoFocus,
  getBiasCenter,
  helperText,
  displayValue,
}: Props) {
  const listboxId = useId();
  const [query, setQuery] = useState(displayValue ?? "");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Bumped on every keystroke-triggered request; a response only applies if
  // it's still the most recent one requested — the classic autocomplete
  // race-condition fix (a slow stale request must never clobber a faster,
  // newer one), on top of the AbortController that cancels the in-flight
  // fetch outright.
  const requestIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Only reacts to displayValue actually changing (e.g. routeStore's origin
  // was just set by a map click, or its reverse-geocoded name just landed).
  // Typing in this input never changes displayValue itself, so this never
  // fights an in-progress keystroke.
  useEffect(() => {
    if (displayValue !== undefined) setQuery(displayValue);
  }, [displayValue]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  async function runSearch(text: string) {
    const requestId = ++requestIdRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setErrorMessage("");

    const params = new URLSearchParams({ q: text });
    const biasCenter = getBiasCenter?.();
    if (biasCenter) {
      params.set("near_lon", String(biasCenter[0]));
      params.set("near_lat", String(biasCenter[1]));
    }

    try {
      const res = await fetch(`/api/geocode?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = await res.json();

      if (requestId !== requestIdRef.current) return; // superseded by a newer keystroke

      if (!res.ok) throw new Error(data.error ?? "Search failed");

      const results = (data as LocationSuggestion[]).slice(0, MAX_SUGGESTIONS);
      setSuggestions(results);
      setStatus("idle");
      setIsOpen(true);
      setActiveIndex(-1);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setSuggestions([]);
      setStatus("error");
      setErrorMessage("Search failed. Try again.");
      setIsOpen(true);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setQuery(text);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = text.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      requestIdRef.current++; // invalidate any in-flight request too
      setSuggestions([]);
      setStatus("idle");
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS);
  }

  function commitSelection(s: LocationSuggestion) {
    if (!isInUS(s.lat, s.lon)) {
      setStatus("error");
      setErrorMessage(US_ONLY_MESSAGE);
      setIsOpen(true);
      return;
    }
    setQuery(s.displayName);
    setSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(s);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // No suggestion highlighted yet (user hasn't pressed an arrow key) —
      // standard search-box behavior is to accept the top suggestion rather
      // than do nothing, since Enter is the natural first thing to reach for.
      commitSelection(suggestions[activeIndex >= 0 ? activeIndex : 0]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
    }
  }

  const isCompact = Boolean(label);

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        className={
          isCompact
            ? "flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 shadow-sm dark:border-neutral-800 dark:bg-neutral-950"
            : "flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 shadow-md dark:border-neutral-800 dark:bg-neutral-950"
        }
      >
        {isCompact ? (
          <span className="w-8 shrink-0 text-[9px] font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
            {label}
          </span>
        ) : (
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
        )}
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          placeholder={placeholder}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={isOpen}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          className={
            isCompact
              ? "w-full bg-transparent text-xs text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-white dark:placeholder:text-neutral-500"
              : "w-full bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-white dark:placeholder:text-neutral-500"
          }
        />
        {status === "loading" && (
          <div
            className={
              isCompact
                ? "h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-orange-500 dark:border-neutral-700"
                : "h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-neutral-300 border-t-orange-500 dark:border-neutral-700"
            }
          />
        )}
      </div>

      {helperText && !isOpen && (
        <p className="mt-1 text-[10px] leading-relaxed text-neutral-400 dark:text-neutral-500">{helperText}</p>
      )}

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-800 dark:bg-neutral-950"
        >
          {status === "error" ? (
            <li className="px-3 py-2 text-xs text-red-500">{errorMessage}</li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400">No results found</li>
          ) : (
            suggestions.map((s, i) => {
              const [name, ...rest] = s.displayName.split(",");
              return (
                <li key={`${s.lat}-${s.lon}-${i}`} role="option" aria-selected={i === activeIndex} id={`${listboxId}-option-${i}`}>
                  <button
                    type="button"
                    // Prevent the input's blur (which would close the dropdown
                    // via handleClickOutside before onClick fires) on mousedown.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitSelection(s)}
                    className={`block w-full px-3 py-1.5 text-left text-xs transition-colors ${
                      i === activeIndex
                        ? "bg-orange-50 dark:bg-orange-950/30"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    }`}
                  >
                    <div className="truncate font-medium text-neutral-900 dark:text-white">{name.trim()}</div>
                    <div className="truncate text-[10px] text-neutral-500 dark:text-neutral-400">
                      {s.shortAddress || rest.join(",").trim()}
                    </div>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
