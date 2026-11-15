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
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === ";" || ch === '"' || ch === "\r" || ch === "\n") break;
    i++;
  }
  if (i === start) return null;
  const trimmed = text.slice(start, i).trimEnd();
  return { valStart: start, valEnd: start + trimmed.length };
};

const findFirstSingleEqualsValue = (text: string): { valStart: number; valEnd: number } | null => {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && text[i + 1] !== "=") {
      return readValueAfterEquals(text, i);
    }
  }
  return null;
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
      if (i < text.length && text[i] === "=" && text[i + 1] !== "=") {
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
