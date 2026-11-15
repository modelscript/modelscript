// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pure zero-dependency ASCII character and whitespace scanners shared across
 * the compiler, linter rules, writeback edits, and flattener utilities.
 * Kept leaf-level (no local imports) so WASM lint/AST extraction never traverses
 * cyclic flattener modules.
 */

/** Checks whether a UTF-16 code unit is an ASCII identifier start (`A-Z`, `a-z`, `_`). */
export function isAsciiIdentStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

/** Checks whether a UTF-16 code unit is an ASCII identifier continuation (`A-Z`, `a-z`, `0-9`, `_`). */
export function isAsciiIdentContinue(code: number): boolean {
  return isAsciiIdentStart(code) || (code >= 48 && code <= 57);
}

/** Checks whether `s` is a valid non-empty ASCII identifier `[A-Za-z_][A-Za-z0-9_]*`. */
export function isAsciiIdentifier(s: string): boolean {
  if (s.length === 0 || !isAsciiIdentStart(s.charCodeAt(0))) return false;
  for (let i = 1; i < s.length; i++) {
    if (!isAsciiIdentContinue(s.charCodeAt(i))) return false;
  }
  return true;
}

/** Checks whether `s` consists solely of one or more ASCII decimal digits (`0-9`). */
export function isAsciiDigitsOnly(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** Checks whether a UTF-16 code unit is ASCII whitespace (`space`, `tab`, `LF`, `CR`, `VT`, `FF`). */
export function isAsciiWhitespaceCode(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13);
}

/** Collapses runs of ASCII whitespace to single spaces and trims leading/trailing whitespace. */
export function collapseAsciiWhitespace(s: string): string {
  let out = "";
  let inWs = true;
  for (let i = 0; i < s.length; i++) {
    if (isAsciiWhitespaceCode(s.charCodeAt(i))) {
      if (!inWs) {
        out += " ";
        inWs = true;
      }
    } else {
      out += s.charAt(i);
      inWs = false;
    }
  }
  return out.endsWith(" ") ? out.substring(0, out.length - 1) : out;
}

/** Extracts the first ASCII whitespace-delimited token from `s`. */
export function firstAsciiToken(s: string): string {
  let i = 0;
  while (i < s.length && isAsciiWhitespaceCode(s.charCodeAt(i))) i++;
  const start = i;
  while (i < s.length && !isAsciiWhitespaceCode(s.charCodeAt(i))) i++;
  return s.substring(start, i);
}
