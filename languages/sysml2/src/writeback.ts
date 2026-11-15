// SPDX-License-Identifier: AGPL-3.0-or-later

import type { WritebackContext, WritebackEdit, WritebackHandler } from "@modelscript/dsl";
import {
  collectCstLeaves,
  findMatchingDelimiterLeaf,
  parseSysmlSource,
  sliceLeavesInRange,
  trimTrailingChars,
  type CstLeaf,
} from "./cst-utils.js";

function isAsciiIdentChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === "_";
}

function extractTrailingUnitSuffix(rawVal: string): string {
  const trimmed = rawVal.trimEnd();
  if (!trimmed.endsWith("]")) return "";
  const prefix = "attribute _w = ";
  const leaves = collectCstLeaves(parseSysmlSource(`${prefix}${trimmed};`));
  if (leaves.length < 4 || leaves[leaves.length - 1]!.text !== ";" || leaves[leaves.length - 2]!.text !== "]") {
    return "";
  }
  const closeIdx = leaves.length - 2;
  let depth = 0;
  let openIdx = -1;
  for (let i = closeIdx; i >= 0; i--) {
    const tok = leaves[i]!.text;
    if (tok === "=" || tok === ":=") break;
    if (tok === "]") depth++;
    else if (tok === "[") {
      depth--;
      if (depth === 0) {
        openIdx = i;
        break;
      }
    }
  }
  if (openIdx < 0) return "";
  // Ensure we didn't capture a multi-bracket expression if another ']' exists unpaired; findMatchingDelimiterLeaf confirms match
  if (findMatchingDelimiterLeaf(leaves, openIdx, "[", "]") !== closeIdx) return "";
  const startInVal = leaves[openIdx]!.start - prefix.length;
  const endInVal = leaves[closeIdx]!.end - prefix.length;
  if (startInVal < 0 || endInVal !== trimmed.length) return "";
  return trimmed.slice(startInVal, endInVal);
}

function buildWritebackEdit(fullText: string, valStart: number, valEnd: number, newValue: string): WritebackEdit {
  const rawVal = fullText.substring(valStart, valEnd);
  let replacement = newValue.trim();
  const unitSuffix = extractTrailingUnitSuffix(rawVal);
  if (unitSuffix && !replacement.includes("[")) {
    replacement = `${replacement} ${unitSuffix}`;
  }
  return {
    startOffset: valStart,
    endOffset: valEnd,
    newText: replacement,
  };
}

function skipAssignOperatorAndSpace(slice: string): number {
  let offset = 0;
  if (slice.startsWith(":=")) {
    offset = 2;
  } else if (slice.startsWith("=") && slice[1] !== "=" && slice[1] !== ">") {
    offset = 1;
  } else {
    return 0;
  }
  while (
    offset < slice.length &&
    (slice[offset] === " " || slice[offset] === "\t" || slice[offset] === "\r" || slice[offset] === "\n")
  ) {
    offset++;
  }
  return offset;
}

function findValueSpanAfterAssignLeaf(
  fullText: string,
  leaves: readonly CstLeaf[],
  opIdx: number,
): { startOffset: number; endOffset: number } | null {
  if (opIdx < 0 || opIdx + 1 >= leaves.length) return null;
  const firstLeaf = leaves[opIdx + 1]!;
  if (firstLeaf.text === ";" || firstLeaf.text === "}") return null;
  if (fullText.slice(leaves[opIdx]!.end, firstLeaf.start).includes("\n")) return null;

  let lastLeaf = firstLeaf;
  for (let i = opIdx + 1; i < leaves.length; i++) {
    const leaf = leaves[i]!;
    if (leaf.text === ";" || leaf.text === "}") break;
    if (i > opIdx + 1 && fullText.slice(leaves[i - 1]!.end, leaf.start).includes("\n")) break;
    lastLeaf = leaf;
  }
  return { startOffset: firstLeaf.start, endOffset: lastLeaf.end };
}

/**
 * First-class writeback handler for SysML v2 / KerML.
 * Handles attribute and value definitions, preserves unit brackets (e.g. `[kg]`),
 * and operates directly on source CST byte slices.
 */
export const sysml2Writeback: WritebackHandler = (ctx: WritebackContext): WritebackEdit | WritebackEdit[] | null => {
  const { entry, fullText, newValue } = ctx;
  if (!entry) return null;

  // 0. Exact CST node field range from AST indexing (Tier 0)
  if (entry.fieldRanges) {
    const valField =
      entry.fieldRanges["value"] ??
      entry.fieldRanges["expression"] ??
      entry.fieldRanges["ownedRelatedElement"] ??
      entry.fieldRanges["featureValue"];
    if (
      valField &&
      valField.startOffset != null &&
      valField.endOffset != null &&
      valField.endOffset > valField.startOffset
    ) {
      let valStart = valField.startOffset;
      let valEnd = valField.endOffset;
      const valSlice = fullText.substring(valStart, valEnd);
      valStart += skipAssignOperatorAndSpace(valSlice);
      const rawVal = trimTrailingChars(fullText.substring(valStart, valEnd), ";}\r\n \t");
      valEnd = valStart + rawVal.length;
      if (valEnd > valStart) {
        return buildWritebackEdit(fullText, valStart, valEnd, newValue);
      }
    }
  }

  const docLeaves = collectCstLeaves(parseSysmlSource(fullText));

  // 1. Precise CST byte-range replacement within the indexed declaration
  if (entry.startOffset != null && entry.endOffset != null && entry.endOffset > entry.startOffset) {
    const entryLeaves = sliceLeavesInRange(docLeaves, entry.startOffset, entry.endOffset);
    const opIdx = entryLeaves.findIndex((leaf) => leaf.text === "=" || leaf.text === ":=");
    if (opIdx >= 0) {
      const span = findValueSpanAfterAssignLeaf(fullText, entryLeaves, opIdx);
      if (span) {
        return buildWritebackEdit(fullText, span.startOffset, span.endOffset, newValue);
      }
    }
  }

  // 2. Lexical CST fallback for attributes / usages
  const name = entry.name;
  if (name) {
    for (let i = 0; i < docLeaves.length; i++) {
      const leaf = docLeaves[i]!;
      if (leaf.text !== name || leaf.text.length === 0 || !isAsciiIdentChar(leaf.text[0]!)) continue;
      let opIdx = -1;
      let j = i + 1;
      if (j < docLeaves.length && (docLeaves[j]!.text === "=" || docLeaves[j]!.text === ":=")) {
        opIdx = j;
      } else if (j < docLeaves.length && docLeaves[j]!.text === ":") {
        j++;
        while (j < docLeaves.length) {
          const tok = docLeaves[j]!.text;
          if (tok === "=" || tok === ":=") {
            opIdx = j;
            break;
          }
          if (tok === ";" || tok === "{" || tok === "}" || tok === ",") break;
          j++;
        }
      }
      if (opIdx >= 0) {
        const span = findValueSpanAfterAssignLeaf(fullText, docLeaves, opIdx);
        if (span) {
          return buildWritebackEdit(fullText, span.startOffset, span.endOffset, newValue);
        }
      }
    }
  }

  return null;
};
