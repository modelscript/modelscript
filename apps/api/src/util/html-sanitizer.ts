// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Robust HTML sanitizer for untrusted remote ActivityPub content (posts, summaries, bios).
 * Strips active scripting vectors, unsafe tags, event handlers, and dangerous URL protocols
 * while preserving standard text formatting elements.
 */

const DANGEROUS_BLOCK_REGEX =
  /<(?:script|style|iframe|object|embed|applet|form|svg|math)\b[\s\S]*?<\/(?:script|style|iframe|object|embed|applet|form|svg|math)[^>]*>/gi;
const DANGEROUS_TAGS_REGEX =
  /<\/?(?:script|style|iframe|object|embed|applet|form|input|button|textarea|select|option|svg|math|meta|link|base)\b[^>]*>/gi;
const EVENT_HANDLER_REGEX = /\s+on[a-z]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;
const DANGEROUS_URL_REGEX = /\s+(?:href|src|xlink:href)\s*=\s*["']?\s*(?:javascript|vbscript|data):[^"'\s>]*/gi;

export function sanitizeRemoteHtml(input: string | undefined | null): string {
  if (!input || typeof input !== "string") return "";
  let clean = input;

  // Truncate excessively long inputs to prevent ReDoS / memory exhaustion
  if (clean.length > 65536) {
    clean = clean.slice(0, 65536);
  }

  // Repeatedly remove dangerous blocks, tags, handlers, and schemes until a clean fixed point is reached
  let prev: string;
  let iterations = 0;
  do {
    prev = clean;
    clean = clean
      .replace(DANGEROUS_BLOCK_REGEX, "")
      .replace(DANGEROUS_TAGS_REGEX, "")
      .replace(EVENT_HANDLER_REGEX, "")
      .replace(DANGEROUS_URL_REGEX, "");
    iterations++;
  } while (clean !== prev && iterations < 30);

  return clean.trim();
}
