// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Exact 11-Character ENDF-6 Fortran Float & Card Codec.
 *
 * ENDF-6 uses fixed 80-column Hollerith/Fortran cards:
 *   - Columns 1–66:  Six 11-character numeric fields (`E11.4` / `I11` or exponent-omitted `±d.dddddd±d`)
 *   - Columns 67–70: `MAT` (4-character integer)
 *   - Columns 71–72: `MF`  (2-character integer)
 *   - Columns 73–75: `MT`  (3-character integer)
 *   - Columns 76–80: `NS`  (5-character sequence number, optional)
 */

/**
 * Parses an 11-character ENDF-6 floating-point field.
 *
 * Supports:
 * - Standard ENDF-6 exponent-omitted notation: `" 9.223500+4"` -> `92235`, `"-1.234567-5"` -> `-1.234567e-5`
 * - Fortran `E`/`D` scientific notation: `" 1.0000E+05"`, `" 2.5300D-02"`
 * - Plain decimals and integers: `" 0.0"`, `" 125"`
 * - Blank / whitespace fields -> `0`
 *
 * Returns `NaN` if the field is non-empty and cannot be parsed as a valid ENDF-6 number.
 */
export function parseEndfFloat(rawField: string): number {
  const trimmed = rawField.trim();
  if (trimmed.length === 0) return 0;

  // Replace Fortran 'D'/'d' exponent marker with 'e'
  let normalized = trimmed.replace(/[dD]/g, "e");

  // Handle ENDF-6 exponent-omitted format: e.g. "9.223500+4", "-1.2345-12", "1.0+0", "2.53-2"
  // Also allow internal whitespace between mantissa and exponent sign like " 1.00000 +4"
  normalized = normalized.replace(/\s+/g, "");

  // If there's no 'e'/'E', check for a trailing exponent sign (+/-) after at least one digit
  if (!/[eE]/.test(normalized)) {
    const match = /^([+-]?(?:\d+\.?\d*|\.\d+))([+-]\d+)$/.exec(normalized);
    if (match) {
      normalized = `${match[1]}e${match[2]}`;
    }
  }

  // Strict validation so malformed garbage returns NaN
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) {
    return Number.NaN;
  }

  return Number.parseFloat(normalized);
}

/**
 * Parses an integer field (11-char field, MAT, MF, MT, or NS).
 * Blank fields return `0`. Malformed fields return `NaN`.
 */
export function parseEndfInt(rawField: string): number {
  const trimmed = rawField.trim();
  if (trimmed.length === 0) return 0;
  if (/^[+-]?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  // Occasionally integer slots carry ENDF float like " 0.000000+0"
  const asFloat = parseEndfFloat(trimmed);
  if (Number.isFinite(asFloat) && Math.abs(asFloat - Math.round(asFloat)) < 1e-9) {
    return Math.round(asFloat);
  }
  return Number.NaN;
}

/**
 * Formats a JavaScript number into a canonical 11-character ENDF-6 exponent-omitted float string.
 *
 * Examples:
 * - `92235`    -> `" 9.223500+4"`
 * - `0.0253`   -> `" 2.530000-2"`
 * - `-1.5e-12` -> `"-1.50000-12"`
 * - `0`        -> `" 0.000000+0"`
 */
export function formatEndfFloat(value: number): string {
  if (!Number.isFinite(value) || value === 0) {
    return " 0.000000+0";
  }

  const sign = value < 0 ? "-" : " ";
  const absVal = Math.abs(value);
  const exp = Math.floor(Math.log10(absVal));
  const expSign = exp >= 0 ? "+" : "-";
  const expDigits = String(Math.abs(exp));

  // Total width is 11: sign(1) + mantissa(M) + expSign(1) + expDigits(E)
  // For single-digit exponent (E=1): mantissa width = 8 -> "d.dddddd" (6 decimals)
  // For two-digit exponent (E=2): mantissa width = 7 -> "d.ddddd" (5 decimals)
  // For three-digit exponent (E=3): mantissa width = 6 -> "d.dddd" (4 decimals)
  const decimals = Math.max(1, 7 - expDigits.length);
  let mantissa = absVal / Math.pow(10, exp);
  let rounded = mantissa.toFixed(decimals);

  // Handle rounding rollover (e.g. 9.9999999 -> 10.000000)
  if (Number.parseFloat(rounded) >= 10) {
    const newExp = exp + 1;
    const newExpSign = newExp >= 0 ? "+" : "-";
    const newExpDigits = String(Math.abs(newExp));
    const newDecimals = Math.max(1, 7 - newExpDigits.length);
    mantissa = absVal / Math.pow(10, newExp);
    rounded = mantissa.toFixed(newDecimals);
    return `${sign}${rounded}${newExpSign}${newExpDigits}`.padStart(11, " ");
  }

  return `${sign}${rounded}${expSign}${expDigits}`.padStart(11, " ");
}

/**
 * Formats an integer right-aligned into a fixed-width ENDF-6 field (default width 11).
 */
export function formatEndfInt(value: number, width: number = 11): string {
  const s = String(Math.trunc(value));
  if (s.length >= width) return s.slice(0, width);
  return s.padStart(width, " ");
}

/**
 * Formats a complete 80-column ENDF-6 card from 6 field values and MAT/MF/MT/NS identifiers.
 *
 * Numbers are formatted as ENDF-6 floats unless passed as `{ int: number }`.
 * Strings are padded/truncated to 11 characters.
 */
export function formatEndfCard(
  fields: ReadonlyArray<number | string | { int: number }>,
  mat: number,
  mf: number,
  mt: number,
  ns: number = 0,
): string {
  let body = "";
  for (let i = 0; i < 6; i++) {
    const f = fields[i];
    if (f === undefined) {
      body += "           ";
    } else if (typeof f === "number") {
      body += formatEndfFloat(f);
    } else if (typeof f === "string") {
      body += f.length >= 11 ? f.slice(0, 11) : f.padEnd(11, " ");
    } else {
      body += formatEndfInt(f.int, 11);
    }
  }
  const matStr = formatEndfInt(mat, 4);
  const mfStr = formatEndfInt(mf, 2);
  const mtStr = formatEndfInt(mt, 3);
  const nsStr = ns > 0 ? formatEndfInt(ns, 5) : "     ";
  return `${body}${matStr}${mfStr}${mtStr}${nsStr}`;
}

/**
 * Formats a 66-character text card (e.g. TPID or MF=1 MT=451 comment line).
 */
export function formatEndfTextCard(text: string, mat: number, mf: number, mt: number, ns: number = 0): string {
  const body = text.length >= 66 ? text.slice(0, 66) : text.padEnd(66, " ");
  const matStr = formatEndfInt(mat, 4);
  const mfStr = formatEndfInt(mf, 2);
  const mtStr = formatEndfInt(mt, 3);
  const nsStr = ns > 0 ? formatEndfInt(ns, 5) : "     ";
  return `${body}${matStr}${mfStr}${mtStr}${nsStr}`;
}
