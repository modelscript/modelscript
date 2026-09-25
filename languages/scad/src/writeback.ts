// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit, WritebackHandler } from "@modelscript/dsl";
import { ScadPatcher } from "./patcher.js";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * First-class writeback handler for OpenSCAD.
 * Uses ScadPatcher and CST byte-ranges to update top-level variables and parameters.
 */
export const scadWriteback: WritebackHandler = (ctx: WritebackContext): WritebackEdit | WritebackEdit[] | null => {
  const { entry, fullText, newValue, rootCst } = ctx;
  if (!entry) return null;

  // 1. Try ScadPatcher if root CST is provided
  if (rootCst && entry.name) {
    const patchRes = ScadPatcher.patchVariable(fullText, rootCst, entry.name, newValue);
    if (patchRes) {
      return {
        startByte: patchRes.replacedRange.startByte,
        endByte: patchRes.replacedRange.endByte,
        newText: String(newValue).trim(),
      };
    }
  }

  // 2. Precise CST byte-range replacement within the indexed declaration
  if (entry.startByte != null && entry.endByte != null && entry.endByte > entry.startByte) {
    const declText = fullText.substring(entry.startByte, entry.endByte);
    const eqMatch = declText.match(/(=(?!=))\s*([^;}\r\n]+)/);
    if (eqMatch && eqMatch.index !== undefined) {
      const rawVal = eqMatch[2].trimEnd();
      const valOffsetInDecl = eqMatch.index + declText.substring(eqMatch.index).indexOf(rawVal);
      const valStartByte = entry.startByte + valOffsetInDecl;
      const valEndByte = valStartByte + rawVal.length;

      return {
        startByte: valStartByte,
        endByte: valEndByte,
        newText: String(newValue).trim(),
      };
    }
  }

  // 3. Fallback by variable identifier
  const name = entry.name;
  if (name) {
    const regex = new RegExp(`(\\b${escapeRegex(name)}\\s*=\\s*)([^;\\r\\n]+)`);
    const match = fullText.match(regex);
    if (match && match.index !== undefined) {
      const valStart = match.index + match[1].length;
      const valEnd = valStart + match[2].trimEnd().length;

      return {
        startByte: valStart,
        endByte: valEnd,
        newText: String(newValue).trim(),
      };
    }
  }

  return null;
};
