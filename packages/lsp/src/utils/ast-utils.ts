// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SyntaxNode } from "./cst-facade.js";

export function isClassInstance(obj: any): boolean {
  return obj && "classKind" in obj;
}

/**
 * Compute the position (row, column) at a given byte index in a string.
 */
export function indexToPoint(text: string, index: number): { row: number; column: number } {
  let row = 0;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      row++;
      lastNewline = i;
    }
  }
  return { row, column: index - lastNewline - 1 };
}

/**
 * Compute a tree-sitter Edit by finding the common prefix and suffix between
 * old and new text. This is O(n) but practically near-instant since we stop
 * at the first/last differing character.
 */
export function computeTreeEdit(
  oldText: string,
  newText: string,
): {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
} {
  // Find common prefix
  const minLen = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefixLen && newSuffix > prefixLen && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }

  return {
    startIndex: prefixLen,
    oldEndIndex: oldSuffix,
    newEndIndex: newSuffix,
    get startPosition() {
      return indexToPoint(oldText, prefixLen);
    },
    get oldEndPosition() {
      return indexToPoint(oldText, oldSuffix);
    },
    get newEndPosition() {
      return indexToPoint(newText, newSuffix);
    },
  };
}

export function nodeRange(node: SyntaxNode): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}
