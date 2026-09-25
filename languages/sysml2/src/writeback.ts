// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit, WritebackHandler } from "@modelscript/dsl";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First-class writeback handler for SysML v2 / KerML.
 * Handles attribute and value definitions, preserves unit brackets (e.g. `[kg]`),
 * and operates directly on source CST byte slices.
 */
export const sysml2Writeback: WritebackHandler = (ctx: WritebackContext): WritebackEdit | WritebackEdit[] | null => {
  const { entry, fullText, newValue } = ctx;
  if (!entry) return null;

  // 1. Precise CST byte-range replacement within the indexed declaration
  if (entry.startByte != null && entry.endByte != null && entry.endByte > entry.startByte) {
    const declText = fullText.substring(entry.startByte, entry.endByte);
    const eqMatch = declText.match(/(:=|=(?!=))\s*([^;}\r\n]+)/);
    if (eqMatch && eqMatch.index !== undefined) {
      const rawVal = eqMatch[2].trimEnd();
      const valOffsetInDecl = eqMatch.index + declText.substring(eqMatch.index).indexOf(rawVal);
      const valStartByte = entry.startByte + valOffsetInDecl;
      const valEndByte = valStartByte + rawVal.length;

      let replacement = newValue.trim();
      const unitMatch = rawVal.match(/(\[[^\]]+\])$/);
      if (unitMatch && !replacement.includes("[")) {
        replacement = `${replacement} ${unitMatch[1]}`;
      }

      return {
        startByte: valStartByte,
        endByte: valEndByte,
        newText: replacement,
      };
    }
  }

  // 2. Lexical scope fallback for attributes / usages
  const name = entry.name;
  if (name) {
    const regex = new RegExp(`((?:attribute|:>>|\\b)${escapeRegex(name)}(?:\\s*:[^=]+)?\\s*(=|:=)\\s*)([^;}\\r\\n]+)`);
    const match = fullText.match(regex);
    if (match && match.index !== undefined) {
      const valStart = match.index + match[1].length;
      const rawVal = match[3].trimEnd();
      const valEnd = valStart + rawVal.length;

      let replacement = newValue.trim();
      const unitMatch = rawVal.match(/(\[[^\]]+\])$/);
      if (unitMatch && !replacement.includes("[")) {
        replacement = `${replacement} ${unitMatch[1]}`;
      }

      return {
        startByte: valStart,
        endByte: valEnd,
        newText: replacement,
      };
    }
  }

  return null;
};
