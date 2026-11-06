// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit, WritebackHandler } from "@modelscript/dsl";

function escapeRegex(str: string): string {
  let res = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str.charAt(i);
    if (
      ch === "." ||
      ch === "*" ||
      ch === "+" ||
      ch === "?" ||
      ch === "^" ||
      ch === "$" ||
      ch === "{" ||
      ch === "}" ||
      ch === "(" ||
      ch === ")" ||
      ch === "|" ||
      ch === "[" ||
      ch === "]" ||
      ch === "\\"
    ) {
      res += "\\" + ch;
    } else {
      res += ch;
    }
  }
  return res;
}

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
      entry.fieldRanges.value ??
      entry.fieldRanges.expression ??
      entry.fieldRanges.modification ??
      entry.fieldRanges.binding;
    if (
      valField &&
      valField.startOffset != null &&
      valField.endOffset != null &&
      valField.endOffset > valField.startOffset
    ) {
      let valStart = valField.startOffset;
      let valEnd = valField.endOffset;
      const valSlice = fullText.substring(valStart, valEnd);
      const opMatch = valSlice.match(/^(=(?!=))\s*/);
      if (opMatch) {
        valStart += opMatch[0].length;
      }
      const trimmedVal = fullText
        .substring(valStart, valEnd)
        .replace(/[;\r\n]+$/, "")
        .trimEnd();
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
    const eqMatch = declText.match(/(=(?!=))\s*([^;"\r\n]+)/);
    if (eqMatch && eqMatch.index !== undefined) {
      const rawVal = eqMatch[2]!.trimEnd();
      const valOffsetInDecl = eqMatch.index + declText.substring(eqMatch.index).indexOf(rawVal);
      const valStartByte = entry.startOffset + valOffsetInDecl;
      const valEndByte = valStartByte + rawVal.length;

      return {
        startOffset: valStartByte,
        endOffset: valEndByte,
        newText: newValue.trim(),
      };
    }
  }

  // 2. Lexical scope fallback for parameter bindings, strictly constrained to enclosing parent class
  const name = entry.name;
  if (name && entry.parentId != null && queryEngine?.index?.symbols) {
    const parent = queryEngine.index.symbols.get(entry.parentId);
    if (parent && parent.startOffset != null && parent.endOffset != null && parent.endOffset > parent.startOffset) {
      const parentText = fullText.substring(parent.startOffset, parent.endOffset);
      const regex = new RegExp(`(\\b${escapeRegex(name)}\\s*=\\s*)([^;"\\r\\n]+)`);
      const match = parentText.match(regex);
      if (match && match.index !== undefined) {
        const valStart = parent.startOffset + match.index + match[1]!.length;
        const valEnd = valStart + match[2]!.trimEnd().length;

        return {
          startOffset: valStart,
          endOffset: valEnd,
          newText: newValue.trim(),
        };
      }
    }
  }

  return null;
};
