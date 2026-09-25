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
 * directly on source CST byte slices.
 */
export const modelicaWriteback: WritebackHandler = (ctx: WritebackContext): WritebackEdit | WritebackEdit[] | null => {
  const { entry, fullText, newValue } = ctx;
  if (!entry) return null;

  // 1. Precise CST byte-range replacement within the indexed declaration
  if (entry.startByte != null && entry.endByte != null && entry.endByte > entry.startByte) {
    const declText = fullText.substring(entry.startByte, entry.endByte);
    const eqMatch = declText.match(/(=(?!=))\s*([^;"\r\n]+)/);
    if (eqMatch && eqMatch.index !== undefined) {
      const rawVal = eqMatch[2].trimEnd();
      const valOffsetInDecl = eqMatch.index + declText.substring(eqMatch.index).indexOf(rawVal);
      const valStartByte = entry.startByte + valOffsetInDecl;
      const valEndByte = valStartByte + rawVal.length;

      return {
        startByte: valStartByte,
        endByte: valEndByte,
        newText: newValue.trim(),
      };
    }
  }

  // 2. Lexical scope fallback for parameter bindings
  const name = entry.name;
  if (name) {
    const regex = new RegExp(`(\\b${escapeRegex(name)}\\s*=\\s*)([^;"\\r\\n]+)`);
    const match = fullText.match(regex);
    if (match && match.index !== undefined) {
      const valStart = match.index + match[1].length;
      const valEnd = valStart + match[2].trimEnd().length;

      return {
        startByte: valStart,
        endByte: valEnd,
        newText: newValue.trim(),
      };
    }
  }

  return null;
};
