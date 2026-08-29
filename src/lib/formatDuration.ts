// Formats a completed-phase caption: "3m 21s · done 2:41 AM".
//
// Manual formatting rather than Intl, matching this codebase's existing
// convention (lib/wbgt.ts's formatForecastTimeLabel) — Intl's locale-resolved
// AM/PM and separators vary by environment in ways that are easy to misread,
// and this project already avoids that class of bug rather than reintroducing
// it here.
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 3661000ms -> "1h 1m 1s"; 201000ms -> "3m 21s"; 4000ms -> "4s". Omits a leading zero unit. */
export function formatElapsedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** epoch ms -> "2:41 AM" (12-hour clock, no leading zero on the hour). */
export function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const period = hours24 < 12 ? "AM" : "PM";
  return `${hours12}:${pad2(d.getMinutes())} ${period}`;
}

/** "Completed in 3m 21s · done 2:41 AM" */
export function formatCompletionCaption(startedAt: number, completedAt: number): string {
  return `Completed in ${formatElapsedDuration(completedAt - startedAt)} · done ${formatClockTime(completedAt)}`;
}
