// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Robust HTML sanitizer for untrusted remote ActivityPub content (posts, summaries, bios).
 * Strips active scripting vectors, unsafe tags, event handlers, and dangerous URL protocols
 * while preserving standard text formatting elements.
 */

const DANGEROUS_BLOCK_REGEX =
  /<(?:script|style|iframe|object|embed|applet|form|svg|math|audio|video|details|template|noscript)\b[\s\S]*?<\/(?:script|style|iframe|object|embed|applet|form|svg|math|audio|video|details|template|noscript)[^>]*>/gi;
const DANGEROUS_TAGS_REGEX =
  /<\/?(?:script|style|iframe|object|embed|applet|form|input|button|textarea|select|option|svg|math|audio|video|details|template|noscript|meta|link|base)\b[^>]*>/gi;
const EVENT_HANDLER_REGEX = /(?:[\s/]+)on[a-z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi;
const DANGEROUS_URL_REGEX =
  /(?:[\s/]+)(?:href|src|xlink:href|action|formaction|poster|data)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

function decodeHtmlEntities(val: string): string {
  return val
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&(?:tab|newline);/gi, "");
}

function stripDangerousUrls(input: string): string {
  return input.replace(DANGEROUS_URL_REGEX, (fullMatch, dq, sq, uq) => {
    const rawUrl = String(dq ?? sq ?? uq ?? "");
    const decoded = decodeHtmlEntities(rawUrl)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0020]+/g, "")
      .toLowerCase();
    if (decoded.startsWith("javascript:") || decoded.startsWith("vbscript:") || decoded.startsWith("data:")) {
      return "";
    }
    return fullMatch;
  });
}

function stripRepeatedly(input: string, pattern: RegExp): string {
  let prev: string;
  let curr = input;
  do {
    prev = curr;
    curr = curr.replace(pattern, "");
  } while (curr !== prev);
  return curr;
}

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
    clean = stripRepeatedly(clean, DANGEROUS_BLOCK_REGEX);
    clean = stripRepeatedly(clean, DANGEROUS_TAGS_REGEX);
    clean = stripRepeatedly(clean, EVENT_HANDLER_REGEX);
    clean = stripDangerousUrls(clean);
    iterations++;
  } while (clean !== prev && iterations < 30);

  return clean.trim();
}
