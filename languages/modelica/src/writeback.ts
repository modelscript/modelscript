// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit, WritebackHandler } from "@modelscript/dsl";
import { isAsciiIdentContinue, isAsciiWhitespaceCode } from "./ascii.js";

const trimTrailingTerminators = (s: string): string => {
  let end = s.length;
  while (end > 0) {
    const ch = s[end - 1]!;
    if (ch === ";" || ch === "\r" || ch === "\n") {
      end--;
    } else {
      break;
    }
  }
  return s.slice(0, end).trimEnd();
};

const readValueAfterEquals = (text: string, eqIdx: number): { valStart: number; valEnd: number } | null => {
  let i = eqIdx + 1;
  while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i++;
  const start = i;
  let depth = 0;
  let inString = false;
  let inQuotedIdent = false;
  let valueStartedWithQuote = text[start] === '"';
  let sawValueToken = false;

  while (i < text.length) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (inString) {
      if (ch === "\\" && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === '"') {
        inString = false;
        sawValueToken = true;
      }
      i++;
      continue;
    }

    if (inQuotedIdent) {
      if (ch === "\\" && i + 1 < text.length) {
        i += 2;
        continue;
      }
      if (ch === "'") {
        inQuotedIdent = false;
        sawValueToken = true;
      }
      i++;
      continue;
    }

    if (ch === "/" && (next === "/" || next === "*")) {
      if (depth === 0) break;
      if (next === "/") {
        i += 2;
        while (i < text.length && text[i] !== "\n") i++;
        continue;
      }
      i += 2;
      while (i < text.length) {
        if (text[i] === "*" && text[i + 1] === "/") {
          i += 2;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === '"') {
      // Opening quote of a String value (e.g. parameter String s = "Pump") vs trailing description string
      if (depth === 0 && !valueStartedWithQuote && sawValueToken) {
        break;
      }
      if (depth === 0 && valueStartedWithQuote && sawValueToken) {
        // Second string at depth 0 is a trailing description string
        break;
      }
      inString = true;
      i++;
      continue;
    }

    if (ch === "'") {
      inQuotedIdent = true;
      i++;
      continue;
    }

    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      sawValueToken = true;
      i++;
      continue;
    }

    if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) break;
      depth--;
      sawValueToken = true;
      i++;
      continue;
    }

    if (depth === 0) {
      if (ch === ";" || ch === ",") break;
      if (
        text.startsWith("annotation", i) &&
        (i === start || !isAsciiIdentContinue(text.charCodeAt(i - 1))) &&
        (i + 10 >= text.length || !isAsciiIdentContinue(text.charCodeAt(i + 10)) || text[i + 10] === "(")
      ) {
        let k = i + 10;
        while (k < text.length && isAsciiWhitespaceCode(text.charCodeAt(k))) k++;
        if (text[k] === "(") break;
      }
      if (!isAsciiWhitespaceCode(text.charCodeAt(i))) {
        sawValueToken = true;
      }
    }

    i++;
  }

  if (i === start) return null;
  const trimmed = text.slice(start, i).trimEnd();
  if (trimmed.length === 0) return null;
  return { valStart: start, valEnd: start + trimmed.length };
};

const isBindingEqualsAt = (text: string, i: number): boolean => {
  if (text[i] !== "=") return false;
  if (text[i + 1] === "=") return false;
  const prev = i > 0 ? text[i - 1] : "";
  return prev !== ":" && prev !== "<" && prev !== ">" && prev !== "!";
};

const findFirstSingleEqualsValue = (text: string): { valStart: number; valEnd: number } | null => {
  let inString = false;
  let inQuoted = false;
  let inLineComment = false;
  let inBlockComment = false;
  let depth = 0;
  let fallbackNestedEqIdx = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (inQuoted) {
      if (ch === "\\") i++;
      else if (ch === "'") inQuoted = false;
      continue;
    }

    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inQuoted = true;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      if (depth > 0) depth--;
      continue;
    }

    if (isBindingEqualsAt(text, i)) {
      if (depth === 0) {
        return readValueAfterEquals(text, i);
      }
      if (fallbackNestedEqIdx === -1) {
        fallbackNestedEqIdx = i;
      }
    }
  }
  return fallbackNestedEqIdx !== -1 ? readValueAfterEquals(text, fallbackNestedEqIdx) : null;
};

const findNamedAssignmentValue = (text: string, name: string): { valStart: number; valEnd: number } | null => {
  let idx = 0;
  while (idx <= text.length - name.length) {
    const pos = text.indexOf(name, idx);
    if (pos < 0) return null;
    const prevOk = pos === 0 || !isAsciiIdentContinue(text.charCodeAt(pos - 1));
    const afterName = pos + name.length;
    const nextOk = afterName >= text.length || !isAsciiIdentContinue(text.charCodeAt(afterName));
    if (prevOk && nextOk) {
      let i = afterName;
      while (i < text.length && isAsciiWhitespaceCode(text.charCodeAt(i))) i++;
      if (i < text.length && isBindingEqualsAt(text, i)) {
        const span = readValueAfterEquals(text, i);
        if (span) return span;
      }
    }
    idx = pos + 1;
  }
  return null;
};

/**
 * First-class writeback handler for Modelica.
 * Handles parameter bindings, component declarations, and equation modifications
 * directly on source CST byte slices, strictly scoped to the declaration or parent class bounds.
 */
export const modelicaWriteback: WritebackHandler = (ctx: WritebackContext): WritebackEdit | WritebackEdit[] | null => {
  const { entry, fullText, newValue, queryEngine } = ctx;
  if (!entry) return null;

  // 0. Exact CST node field range from AST indexing (Tier 0)
  if (entry.fieldRanges) {
    const valField =
      entry.fieldRanges["value"] ??
      entry.fieldRanges["expression"] ??
      entry.fieldRanges["modification"] ??
      entry.fieldRanges["binding"];
    if (
      valField &&
      valField.startOffset != null &&
      valField.endOffset != null &&
      valField.endOffset > valField.startOffset
    ) {
      let valStart = valField.startOffset;
      let valEnd = valField.endOffset;
      const valSlice = fullText.substring(valStart, valEnd);
      if (valSlice.startsWith("=") && !valSlice.startsWith("==")) {
        let adv = 1;
        while (adv < valSlice.length && isAsciiWhitespaceCode(valSlice.charCodeAt(adv))) adv++;
        valStart += adv;
      }
      const trimmedVal = trimTrailingTerminators(fullText.substring(valStart, valEnd));
      valEnd = valStart + trimmedVal.length;
      if (valEnd > valStart) {
        return {
          startOffset: valStart,
          endOffset: valEnd,
          newText: newValue.trim(),
        };
      }
    }
  }

  // 1. Precise CST byte-range replacement within the indexed declaration
  if (entry.startOffset != null && entry.endOffset != null && entry.endOffset > entry.startOffset) {
    const declText = fullText.substring(entry.startOffset, entry.endOffset);
    const span = findFirstSingleEqualsValue(declText);
    if (span) {
      return {
        startOffset: entry.startOffset + span.valStart,
        endOffset: entry.startOffset + span.valEnd,
        newText: newValue.trim(),
      };
    }
  }

  // 2. Lexical scope fallback for parameter bindings, strictly constrained to enclosing parent class
  const name = entry.name;
  const typedQueryEngine = queryEngine as
    | { index?: { symbols?: Map<number, { startOffset?: number; endOffset?: number }> } }
    | undefined;
  if (name && entry.parentId != null && typedQueryEngine?.index?.symbols) {
    const parent = typedQueryEngine.index.symbols.get(entry.parentId);
    if (parent && parent.startOffset != null && parent.endOffset != null && parent.endOffset > parent.startOffset) {
      const parentText = fullText.substring(parent.startOffset, parent.endOffset);
      const span = findNamedAssignmentValue(parentText, name);
      if (span) {
        return {
          startOffset: parent.startOffset + span.valStart,
          endOffset: parent.startOffset + span.valEnd,
          newText: newValue.trim(),
        };
      }
    }
  }

  return null;
};
