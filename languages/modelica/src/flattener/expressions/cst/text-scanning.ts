// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Modelica Flattener - Pure text scanning, stripping, identifier, subscript, and literal helpers.
 */

import { VarType } from "@modelscript/runtime";
import {
  collapseAsciiWhitespace,
  isAsciiDigitsOnly,
  isAsciiIdentContinue,
  isAsciiIdentifier,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
} from "../../../ascii.js";
import { parseArrayLiteralElements } from "../eval.js";
import type { ParsedRawLiteral } from "./types.js";

export function stripArraySubscripts(s: string): string {
  let result = "";
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "[") {
      depth++;
    } else if (s[i] === "]") {
      if (depth > 0) depth--;
    } else if (depth === 0) {
      result += s[i];
    }
  }
  return result;
}

export function stripComments(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i + 2);
      i = nl === -1 ? s.length : nl + 1;
    } else if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

export function stripCommentsAndStrings(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "/") {
      const nl = s.indexOf("\n", i + 2);
      i = nl === -1 ? s.length : nl + 1;
    } else if (s[i] === "/" && s[i + 1] === "*") {
      const end = s.indexOf("*/", i + 2);
      i = end === -1 ? s.length : end + 2;
    } else if (s[i] === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === "\\") {
          j += 2;
        } else if (s[j] === '"') {
          j++;
          break;
        } else {
          j++;
        }
      }
      i = j;
      result += " ";
    } else {
      result += s[i];
      i++;
    }
  }
  return result;
}

export function stripAnnotation(str: string): string {
  const needle = "annotation";
  let from = 0;
  while (from <= str.length - needle.length) {
    const idx = str.indexOf(needle, from);
    if (idx < 0) return str;
    const beforeOk = idx === 0 || !isAsciiIdentContinue(str.charCodeAt(idx - 1));
    const afterIdx = idx + needle.length;
    const afterOk = afterIdx === str.length || !isAsciiIdentContinue(str.charCodeAt(afterIdx));
    if (beforeOk && afterOk) {
      return str.slice(0, idx);
    }
    from = idx + 1;
  }
  return str;
}

export function generateArrayIndices(dims: number[]): string[] {
  if (dims.length === 0) return [""];
  if (dims.length === 1) return Array.from({ length: dims[0]! }, (_, i) => `[${i + 1}]`);
  const results: string[] = [];
  const gen = (dim: number, cur: number[]) => {
    if (dim >= dims.length) {
      results.push(`[${cur.join(",")}]`);
      return;
    }
    for (let i = 1; i <= dims[dim]!; i++) {
      gen(dim + 1, [...cur, i]);
    }
  };
  gen(0, []);
  return results;
}

export function generateArrayTuples(dims: number[]): number[][] {
  if (dims.length === 0) return [[]];
  if (dims.length === 1) return Array.from({ length: dims[0]! }, (_, i) => [i + 1]);
  const results: number[][] = [];
  const gen = (dim: number, cur: number[]) => {
    if (dim >= dims.length) {
      results.push([...cur]);
      return;
    }
    for (let i = 1; i <= dims[dim]!; i++) {
      gen(dim + 1, [...cur, i]);
    }
  };
  gen(0, []);
  return results;
}

export function getIndexedElementText(text: string, indices: number[]): string {
  let curr = text.trim();
  if (!curr.startsWith("{") || !curr.endsWith("}")) return curr;
  let depth = 0;
  let probe = curr;
  while (probe.startsWith("{") && probe.endsWith("}")) {
    depth++;
    const elems = parseArrayLiteralElements(probe);
    if (elems.length === 0 || elems[0] === probe) break;
    probe = elems[0]!;
  }
  const topElems = parseArrayLiteralElements(curr);
  const effectiveIndices =
    depth > 0 && depth < indices.length && topElems.length !== indices.length
      ? indices.slice(indices.length - depth)
      : indices;
  for (let i = 0; i < effectiveIndices.length; i++) {
    const idx = effectiveIndices[i]!;
    if (curr.startsWith("{") && curr.endsWith("}")) {
      const elems = parseArrayLiteralElements(curr);
      const k = idx - 1;
      if (k >= 0 && k < elems.length) {
        curr = elems[k]!.trim();
      } else {
        return curr;
      }
    } else {
      const remaining = effectiveIndices.slice(i);
      return `${curr}[${remaining.join(",")}]`;
    }
  }
  return curr;
}

export function splitTopLevel(text: string, delimiter: string = ","): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && (i === 0 || text[i - 1] !== "\\")) {
      inString = !inString;
      current += ch;
      continue;
    }
    if (!inString) {
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") depth--;
      else if (ch === delimiter && depth === 0) {
        if (current.trim()) parts.push(current.trim());
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function splitTopLevelArgs(text: string): string[] {
  return splitTopLevel(text, ",");
}

export function parseRawLiteralArg(argStr: string): ParsedRawLiteral | null {
  const trimmed = argStr.trim();
  const num = Number(trimmed);
  if (!isNaN(num)) return num;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    const parts = splitTopLevelArgs(inner);
    const parsed = parts.map(parseRawLiteralArg);
    if (parsed.every((p): p is ParsedRawLiteral => p !== null)) return parsed;
  }
  return null;
}

export function formatArenaValForMod(val: unknown, targetType?: VarType | string): string {
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") {
    if (targetType === VarType.Integer || targetType === "Integer") {
      return String(Math.round(val));
    }
    return Number.isInteger(val) ? `${val}.0` : String(val);
  }
  if (Array.isArray(val)) {
    return `{${val.map((v) => formatArenaValForMod(v, targetType)).join(", ")}}`;
  }
  return String(val);
}

/** Checks whether `s` matches a signed decimal/scientific number literal without regexes. */
export function isSignedAsciiNumberText(s: string): boolean {
  const n = s.length;
  if (n === 0) return false;
  let i = 0;
  if (s[i] === "+" || s[i] === "-") i++;
  if (i >= n) return false;
  let intDigits = 0;
  while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
    intDigits++;
    i++;
  }
  let fracDigits = 0;
  if (i < n && s[i] === ".") {
    i++;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      fracDigits++;
      i++;
    }
  }
  if (intDigits === 0 && fracDigits === 0) return false;
  if (i < n && (s[i] === "e" || s[i] === "E")) {
    i++;
    if (i < n && (s[i] === "+" || s[i] === "-")) i++;
    let expDigits = 0;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      expDigits++;
      i++;
    }
    if (expDigits === 0) return false;
  }
  return i === n;
}

/** Strips a single leading dot from a Modelica qualified name if present. */
export function stripLeadingDot(s: string): string {
  return s.startsWith(".") ? s.slice(1) : s;
}

/** Strips all leading dots from a Modelica path if present. */
export function stripLeadingDots(s: string): string {
  let i = 0;
  while (i < s.length && s[i] === ".") i++;
  return i > 0 ? s.slice(i) : s;
}

/** Strips a single leading and/or trailing `'` from a quoted Modelica operator/identifier. */
export function stripOuterSingleQuotes(s: string): string {
  let res = s;
  if (res.startsWith("'")) res = res.slice(1);
  if (res.endsWith("'")) res = res.slice(0, -1);
  return res;
}

/** Strips a single leading and/or trailing `"` from a string token. */
export function stripOuterDoubleQuotes(s: string): string {
  let res = s;
  if (res.startsWith('"')) res = res.slice(1);
  if (res.endsWith('"')) res = res.slice(0, -1);
  return res;
}

/** Strips a trailing `[...]` suffix from a component name if present (equivalent to `/\[.*\]$/`). */
export function stripTrailingArraySubscripts(s: string): string {
  if (!s.endsWith("]")) return s;
  const idx = s.indexOf("[");
  return idx >= 0 ? s.slice(0, idx) : s;
}

/** Extracts each flat `[...]` subscript substring (without nested brackets inside) in left-to-right order. */
export function extractBracketSubscripts(s: string): string[] {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") {
      start = i + 1;
    } else if (ch === "]" && start >= 0) {
      out.push(s.slice(start, i));
      start = -1;
    }
  }
  return out;
}

/**
 * Parses a scalarized DAE variable name of the form `base[i1, i2, ...]` where `base` has no brackets
 * and the subscript contains only decimal digits, commas, and whitespace.
 */
export function parseTrailingNumericSubscripts(s: string): { base: string; indices: number[] } | null {
  const openIdx = s.indexOf("[");
  if (openIdx <= 0 || !s.endsWith("]")) return null;
  const base = s.slice(0, openIdx);
  if (base.includes("]")) return null;
  const inner = s.slice(openIdx + 1, -1);
  if (inner.length === 0) return null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    const code = ch.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isSpace = ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\v" || ch === "\f";
    if (!isDigit && ch !== "," && !isSpace) return null;
  }
  const indices = inner.split(",").map((part) => Number.parseInt(part.trim(), 10));
  return { base, indices };
}

/**
 * Validates that a runtime component path string matches `[A-Za-z_]\w*(?:\s*\[[^\]]*\]|\.[A-Za-z_]\w*)*`.
 */
export function isValidDottedComponentPath(pathStr: string): boolean {
  const len = pathStr.length;
  if (len === 0 || !isAsciiIdentStart(pathStr.charCodeAt(0))) return false;
  let i = 1;
  while (i < len && isAsciiIdentContinue(pathStr.charCodeAt(i))) i++;
  while (i < len) {
    const ch = pathStr[i]!;
    if (ch === ".") {
      i++;
      if (i >= len || !isAsciiIdentStart(pathStr.charCodeAt(i))) return false;
      i++;
      while (i < len && isAsciiIdentContinue(pathStr.charCodeAt(i))) i++;
      continue;
    }
    let j = i;
    while (j < len) {
      const ws = pathStr[j]!;
      if (ws === " " || ws === "\t" || ws === "\n" || ws === "\r" || ws === "\v" || ws === "\f") {
        j++;
      } else {
        break;
      }
    }
    if (j >= len || pathStr[j] !== "[") return false;
    const closeIdx = pathStr.indexOf("]", j + 1);
    if (closeIdx < 0) return false;
    i = closeIdx + 1;
  }
  return true;
}

/** Checks whether `s` is a non-empty dot-separated chain of ASCII identifiers (`A(.B)*`). */
export function isDottedIdentifierChain(s: string): boolean {
  if (!s) return false;
  const parts = s.split(".");
  for (const part of parts) {
    if (!isAsciiIdentifier(part)) return false;
  }
  return true;
}

/** Extracts all trailing balanced `[...]` bracket groups from the end of `s` (e.g., `a[1][2]` -> `[1][2]`). */
export function extractTrailingBrackets(s: string): string {
  let tailStart = s.length;
  while (tailStart > 0 && s[tailStart - 1] === "]") {
    const open = s.lastIndexOf("[", tailStart - 1);
    if (open === -1) break;
    tailStart = open;
  }
  return s.slice(tailStart);
}

/** Parses `base[N]` with a single non-empty unsigned integer subscript at the end of `s`. */
export function parseTrailingSingleIntSubscript(s: string): { base: string; index: number } | null {
  if (!s.endsWith("]")) return null;
  const open = s.lastIndexOf("[");
  if (open <= 0) return null;
  const base = s.slice(0, open);
  if (base.includes("\n") || base.includes("\r")) return null;
  const inner = s.slice(open + 1, -1);
  if (!isAsciiDigitsOnly(inner)) return null;
  return { base, index: Number.parseInt(inner, 10) };
}

const KNOWN_MATH_PKG_PREFIXES = [
  "Modelica.Math.",
  "Math.",
  "Modelica.SIunits.Conversions.",
  "SIunits.Conversions.",
  "Modelica.Units.Conversions.",
  "Units.Conversions.",
  "Cv.",
  "Conversions.",
];

/** Strips a known Modelica math or unit conversion package qualifier from `ident`. */
export function stripMathPackagePrefix(ident: string): string {
  for (const prefix of KNOWN_MATH_PKG_PREFIXES) {
    if (ident.startsWith(prefix)) return ident.slice(prefix.length);
  }
  return ident;
}

/** Returns the length of an unsigned decimal/scientific number starting at `start` in `s`, or `0`. */
export function readUnsignedNumberLength(s: string, start: number): number {
  const n = s.length;
  let i = start;
  let intDigits = 0;
  while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
    intDigits++;
    i++;
  }
  let fracDigits = 0;
  if (i < n && s[i] === ".") {
    i++;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      fracDigits++;
      i++;
    }
  }
  if (intDigits === 0 && fracDigits === 0) return 0;
  if (i < n && (s[i] === "e" || s[i] === "E")) {
    const expMarker = i;
    i++;
    if (i < n && (s[i] === "+" || s[i] === "-")) i++;
    let expDigits = 0;
    while (i < n && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
      expDigits++;
      i++;
    }
    if (expDigits === 0) i = expMarker;
  }
  return i - start;
}

/** Checks whether `s` is an optional sign followed by one or more ASCII decimal digits. */
export function isSignedAsciiIntText(s: string, allowPlus = true): boolean {
  if (!s) return false;
  let start = 0;
  if (s[0] === "-" || (allowPlus && s[0] === "+")) start = 1;
  return start < s.length && isAsciiDigitsOnly(s.slice(start));
}

/** Removes all ASCII whitespace characters from `s`. */
export function stripAsciiWhitespace(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (!isAsciiWhitespaceCode(s.charCodeAt(i))) {
      out += s[i];
    }
  }
  return out;
}

/** Strips Modelica comments and splits remaining tokens by ASCII whitespace. */
export function tokenizeCommentStrippedWords(s: string): string[] {
  const collapsed = collapseAsciiWhitespace(stripComments(s));
  return collapsed ? collapsed.split(" ") : [];
}

/** Trims `s`, removes a single leading `=`, and trims again. */
export function stripLeadingEquals(s: string): string {
  const t = s.trim();
  return t.startsWith("=") ? t.slice(1).trim() : t;
}

/** Removes a single leading `-` and any immediately following whitespace. */
export function stripLeadingMinusWs(s: string): string {
  return s.startsWith("-") ? s.slice(1).trimStart() : s;
}

/** Inserts a single space after commas followed immediately by non-whitespace. */
export function spaceAfterCommas(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    out += ch;
    if (ch === "," && i + 1 < s.length && !isAsciiWhitespaceCode(s.charCodeAt(i + 1))) {
      out += " ";
    }
  }
  return out;
}

/** Extracts whole ASCII identifiers (or dotted chains when `includeDots` is true) from `s`. */
export function extractAsciiIdentifiers(s: string, includeDots = false): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (isAsciiIdentStart(c)) {
      const start = i++;
      while (i < n && isAsciiIdentContinue(s.charCodeAt(i))) i++;
      if (includeDots) {
        while (i + 1 < n && s[i] === "." && isAsciiIdentStart(s.charCodeAt(i + 1))) {
          i++;
          while (i < n && isAsciiIdentContinue(s.charCodeAt(i))) i++;
        }
      }
      out.push(s.slice(start, i));
    } else if (c >= 48 && c <= 57) {
      i++;
      while (i < n && isAsciiIdentContinue(s.charCodeAt(i))) i++;
    } else {
      i++;
    }
  }
  return out;
}

/** Counts whole-word occurrences of `target` outside string literals and Modelica comments. */
export function countWordOccurrencesOutsideStrings(text: string, target: string, stopAfterOne = false): number {
  if (!text || !target) return 0;
  const n = text.length;
  const tLen = target.length;
  let count = 0;
  let i = 0;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      i = nl === -1 ? n : nl + 1;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
    } else if (ch === '"') {
      i++;
      while (i < n) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
    } else if (
      text.startsWith(target, i) &&
      (i === 0 || !isAsciiIdentContinue(text.charCodeAt(i - 1))) &&
      (i + tLen === n || !isAsciiIdentContinue(text.charCodeAt(i + tLen)))
    ) {
      count++;
      if (stopAfterOne) return 1;
      i += tLen;
    } else {
      i++;
    }
  }
  return count;
}

/** Returns true if `target` appears as a whole word/dotted-token outside string literals and comments. */
export function containsWholeWordOutsideStrings(text: string, target: string): boolean {
  return countWordOccurrencesOutsideStrings(text, target, true) > 0;
}

/** Replaces whole-word occurrences of `word` outside string literals and comments. */
export function replaceWordOutsideStrings(
  text: string,
  word: string,
  replacement: string,
  skipDottedAccess = true,
): string {
  if (!text || !word) return text;
  const n = text.length;
  const wLen = word.length;
  let out = "";
  let i = 0;
  while (i < n) {
    const ch = text[i]!;
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i + 2);
      const end = nl === -1 ? n : nl + 1;
      out += text.slice(i, end);
      i = end;
    } else if (ch === "/" && text[i + 1] === "*") {
      const endIdx = text.indexOf("*/", i + 2);
      const end = endIdx === -1 ? n : endIdx + 2;
      out += text.slice(i, end);
      i = end;
    } else if (ch === '"') {
      const start = i++;
      while (i < n) {
        if (text[i] === "\\") i += 2;
        else if (text[i] === '"') {
          i++;
          break;
        } else {
          i++;
        }
      }
      out += text.slice(start, i);
    } else if (
      text.startsWith(word, i) &&
      (i === 0 || !isAsciiIdentContinue(text.charCodeAt(i - 1))) &&
      (i + wLen === n || !isAsciiIdentContinue(text.charCodeAt(i + wLen))) &&
      !(skipDottedAccess && i > 0 && text[i - 1] === ".")
    ) {
      out += replacement;
      i += wLen;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Parses a call expression `<callee>(<args>)` whose outer `(` closes at the end of trimmed `s`. */
export function parseNamedCallArgsFromText(s: string): { callee: string; argsText: string } | null {
  const t = s.trim();
  if (!t.endsWith(")")) return null;
  let i = 0;
  while (i < t.length) {
    const ch = t[i]!;
    const code = t.charCodeAt(i);
    if (isAsciiIdentContinue(code) || ch === "." || ch === "$") {
      i++;
    } else {
      break;
    }
  }
  if (i === 0) return null;
  const callee = t.slice(0, i);
  let j = i;
  while (j < t.length && isAsciiWhitespaceCode(t.charCodeAt(j))) j++;
  if (j >= t.length || t[j] !== "(") return null;
  let depth = 0;
  let inStr = false;
  for (let k = j; k < t.length; k++) {
    const ch = t[k]!;
    if (inStr) {
      if (ch === "\\") k++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        if (k !== t.length - 1) return null;
        return { callee, argsText: t.slice(j + 1, k) };
      }
    }
  }
  return null;
}

/** Parses `size(<ident>, <digits>)` into `{ target, dim, dimStr }`, or returns null. */
export function parseSizeCallIdentDim(s: string): { target: string; dim: number; dimStr: string } | null {
  const call = parseNamedCallArgsFromText(s);
  if (!call || call.callee !== "size") return null;
  const commaIdx = call.argsText.indexOf(",");
  if (commaIdx < 0 || call.argsText.indexOf(",", commaIdx + 1) >= 0) return null;
  const target = call.argsText.slice(0, commaIdx).trim();
  const dimStr = call.argsText.slice(commaIdx + 1).trim();
  if (!isAsciiIdentifier(target) || !isAsciiDigitsOnly(dimStr)) return null;
  return { target, dim: Number(dimStr), dimStr };
}

/** Parses a named call/modification argument `name = expr` (rejecting `==`). */
export function parseNamedArgAssignment(s: string): { name: string; valueText: string } | null {
  const t = s.trim();
  if (t.length === 0 || !isAsciiIdentStart(t.charCodeAt(0))) return null;
  let i = 1;
  while (i < t.length && isAsciiIdentContinue(t.charCodeAt(i))) i++;
  const name = t.slice(0, i);
  while (i < t.length && isAsciiWhitespaceCode(t.charCodeAt(i))) i++;
  if (i >= t.length || t[i] !== "=" || t[i + 1] === "=") return null;
  const valueText = t.slice(i + 1);
  if (valueText.length === 0) return null;
  return { name, valueText };
}

/** Checks `ident([subscripts])(.ident([subscripts]))*` with either numeric comma lists or arbitrary non-empty subscripts. */
export function isDottedComponentRefWithSubscripts(s: string, numericOnlySubscripts = true): boolean {
  const len = s.length;
  if (len === 0 || !isAsciiIdentStart(s.charCodeAt(0))) return false;
  let i = 1;
  while (i < len && isAsciiIdentContinue(s.charCodeAt(i))) i++;
  while (i < len) {
    if (s[i] === "[") {
      const closeIdx = s.indexOf("]", i + 1);
      if (closeIdx <= i + 1) return false;
      const inner = s.slice(i + 1, closeIdx);
      if (numericOnlySubscripts) {
        const parts = inner.split(",");
        for (const p of parts) {
          if (!isAsciiDigitsOnly(p)) return false;
        }
      }
      i = closeIdx + 1;
      if (i >= len) return true;
    }
    if (s[i] !== ".") return false;
    i++;
    if (i >= len || !isAsciiIdentStart(s.charCodeAt(i))) return false;
    i++;
    while (i < len && isAsciiIdentContinue(s.charCodeAt(i))) i++;
  }
  return true;
}

/** Parses `<ident> [ <subscript> ]` at the full-string level. */
export function parseIdentSubscriptText(s: string): { base: string; subscript: string } | null {
  if (s.length === 0 || !isAsciiIdentStart(s.charCodeAt(0)) || !s.endsWith("]")) return null;
  let i = 1;
  while (i < s.length && isAsciiIdentContinue(s.charCodeAt(i))) i++;
  const base = s.slice(0, i);
  while (i < s.length && isAsciiWhitespaceCode(s.charCodeAt(i))) i++;
  if (i >= s.length || s[i] !== "[") return null;
  const inner = s.slice(i + 1, -1);
  if (inner.includes("]")) return null;
  return { base, subscript: inner };
}

/** Returns leading identifier before a dot (`foo.bar` -> `foo`), or null. */
export function leadingIdentifierBeforeDot(s: string): string | null {
  const dotIdx = s.indexOf(".");
  if (dotIdx <= 0) return null;
  const head = s.slice(0, dotIdx);
  return isAsciiIdentifier(head) ? head : null;
}

/** Returns the first `[ident]` identifier inside `s`, or null. */
export function firstBracketedIdentifier(s: string): string | null {
  let pos = 0;
  while (pos < s.length) {
    const open = s.indexOf("[", pos);
    if (open < 0) return null;
    const close = s.indexOf("]", open + 1);
    if (close < 0) return null;
    const inner = s.slice(open + 1, close);
    if (isAsciiIdentifier(inner)) return inner;
    pos = open + 1;
  }
  return null;
}

/** Returns true if `s` contains `[:]` or `[:,:]` with optional whitespace inside brackets. */
export function hasColonSubscript(s: string, allowMultiDim = false): boolean {
  let pos = 0;
  while (pos < s.length) {
    const open = s.indexOf("[", pos);
    if (open < 0) return false;
    const close = s.indexOf("]", open + 1);
    if (close > open) {
      const inner = s.slice(open + 1, close);
      const parts = allowMultiDim ? inner.split(",") : [inner];
      if (parts.length > 0 && parts.every((p) => p.trim() === ":")) return true;
    }
    pos = open + 1;
  }
  return false;
}

/** Parses `<dottedIdentA> - <dottedIdentB>` into `[a, b]`, or returns null. */
export function parseBinaryIdentSubtraction(s: string): [string, string] | null {
  const minusIdx = s.indexOf("-");
  if (minusIdx <= 0) return null;
  if (s.indexOf("-", minusIdx + 1) >= 0) return null;
  const lhs = s.slice(0, minusIdx).trim();
  const rhs = s.slice(minusIdx + 1).trim();
  if (!isDottedIdentifierChain(lhs) || !isDottedIdentifierChain(rhs)) return null;
  return [lhs, rhs];
}

/** Splits `s` on `{`, `}`, and `,`, trims tokens, and omits empty entries. */
export function splitBraceCommasAndTrim(s: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i <= s.length; i++) {
    const ch = i < s.length ? s[i] : ",";
    if (ch === "{" || ch === "}" || ch === ",") {
      const tok = s.slice(start, i).trim();
      if (tok) out.push(tok);
      start = i + 1;
    }
  }
  return out;
}

/** Returns true if trimmed `s` starts with an optional sign and `digits.digits`. */
export function startsWithSignedDecimalFloat(s: string): boolean {
  let i = 0;
  if (s[i] === "+" || s[i] === "-") i++;
  let intDigits = 0;
  while (i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57) {
    intDigits++;
    i++;
  }
  if (intDigits === 0 || i >= s.length || s[i] !== ".") return false;
  i++;
  return i < s.length && s.charCodeAt(i) >= 48 && s.charCodeAt(i) <= 57;
}

/**
 * Expands Modelica `Text(textString=...)` dynamic macros (`%%`, `%name`, `%class`, `%comment`, `%{expr}`, `%ident`)
 * in a single left-to-right pass without intermediate placeholders or regular expressions.
 */
export function expandModelicaTextMacros(
  rawText: string,
  nameText: string,
  classText: string,
  commentText: string,
  evaluateExpr: (expr: string) => string,
): string {
  let out = "";
  let i = 0;
  const n = rawText.length;
  while (i < n) {
    const ch = rawText[i]!;
    if (ch !== "%" || i + 1 >= n) {
      out += ch;
      i++;
      continue;
    }
    const next = rawText[i + 1]!;
    if (next === "%") {
      out += "%";
      i += 2;
      continue;
    }
    if (next === "{") {
      const closeIdx = rawText.indexOf("}", i + 2);
      if (closeIdx >= 0) {
        out += evaluateExpr(rawText.slice(i + 2, closeIdx));
        i = closeIdx + 1;
        continue;
      }
    }
    if (isAsciiIdentContinue(rawText.charCodeAt(i + 1))) {
      let end = i + 2;
      while (end < n && isAsciiIdentContinue(rawText.charCodeAt(end))) end++;
      const ident = rawText.slice(i + 1, end);
      if (ident === "name") out += nameText;
      else if (ident === "class") out += classText;
      else if (ident === "comment") out += commentText;
      else out += evaluateExpr(ident);
      i = end;
      continue;
    }
    out += "%";
    i++;
  }
  return out;
}
