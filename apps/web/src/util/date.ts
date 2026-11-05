// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Safely parses any date string, number, or Date instance into a Date object in UTC.
 * Specifically handles SQLite UTC datetimes ("YYYY-MM-DD HH:MM:SS") and ISO strings
 * missing a 'Z' or timezone offset so they are never erroneously parsed as local time.
 */
export function parseUtcDate(dateInput: string | number | Date | null | undefined): Date {
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === "number") return new Date(dateInput);
  if (!dateInput || typeof dateInput !== "string") return new Date(NaN);

  const trimmed = dateInput.trim();
  if (!trimmed) return new Date(NaN);

  // SQLite datetime ("YYYY-MM-DD HH:MM:SS") or ISO without timezone ("YYYY-MM-DDTHH:MM:SS")
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return new Date(trimmed.replace(" ", "T") + "Z");
  }

  return new Date(trimmed);
}

/**
 * Formats a relative timestamp into Twitter/X-style concise units:
 * - Clock skew / future <= 1m: "1s"
 * - Seconds: "15s"
 * - Minutes: "5m"
 * - Hours: "3h"
 * - Past dates: "Nov 4" (same year) or "Nov 4, 2025" (different year)
 */
export function formatRelativeTime(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = parseUtcDate(dateInput);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // Handle slight client/server clock skew (e.g. post created a few seconds ahead of client clock)
  if (diffInSeconds < 0 && diffInSeconds >= -60) return "1s";
  // If significantly in the future, fallback to localized date
  if (diffInSeconds < 0) {
    if (now.getFullYear() !== date.getFullYear()) {
      return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  if (diffInSeconds < 60) return `${Math.max(1, diffInSeconds)}s`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h`;

  if (now.getFullYear() !== date.getFullYear()) {
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Formats full timestamp for tooltips, e.g. "10:32 PM · Nov 4, 2026"
 */
export function formatTooltipDate(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = parseUtcDate(dateInput);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
}

/**
 * Formats editorial date for notebooks/articles, e.g. "Nov 4, 2026"
 */
export function formatEditorialDate(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "";
  const date = parseUtcDate(dateInput);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
