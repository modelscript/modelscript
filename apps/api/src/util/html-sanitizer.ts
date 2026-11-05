// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Robust HTML sanitizer for untrusted remote ActivityPub content (posts, summaries, bios).
 * Strips active scripting vectors, unsafe tags, event handlers, and dangerous URL protocols
 * while preserving standard text formatting elements.
 */

const DANGEROUS_BLOCK_REGEX =
  /<(?:script|style|iframe|object|embed|applet|form|svg|math)[\s\S]*?<\/(?:script|style|iframe|object|embed|applet|form|svg|math)>/gi;
const DANGEROUS_TAGS_REGEX =
  /<\/?(?:script|style|iframe|object|embed|applet|form|input|button|textarea|select|option|svg|math|meta|link|base)[^>]*>/gi;
const EVENT_HANDLER_REGEX = /\s+on[a-z]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;
const DANGEROUS_URL_REGEX = /\s+(?:href|src|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data):[^"'\s>]*/gi;

export function sanitizeRemoteHtml(input: string | undefined | null): string {
  if (!input || typeof input !== "string") return "";
  let clean = input;

  // Truncate excessively long inputs to prevent ReDoS / memory exhaustion
  if (clean.length > 65536) {
    clean = clean.slice(0, 65536);
  }

  // Remove full blocks of dangerous tags first (e.g. <script>...</script>)
  clean = clean.replace(DANGEROUS_BLOCK_REGEX, "");

  // Remove individual dangerous open/close tags
  clean = clean.replace(DANGEROUS_TAGS_REGEX, "");

  // Remove event handlers (e.g. onload, onerror, onclick)
  clean = clean.replace(EVENT_HANDLER_REGEX, "");

  // Remove dangerous URI schemes
  clean = clean.replace(DANGEROUS_URL_REGEX, "");

  return clean.trim();
}
