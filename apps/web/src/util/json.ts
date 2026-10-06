// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Safely parse a JSON string or return an existing object/fallback.
 * Prevents uncaught SyntaxError crashes when APIs return pre-parsed objects
 * (e.g., PostgreSQL JSONB) or malformed strings.
 */
export function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
