// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "../../utils/cst-facade.js";
import { getNodeChildrenSafe, isNodeHealthy, nodeEndOffset, nodeStartOffset } from "../session.js";
import { CstTransaction } from "../transaction.js";

/**
 * Language-agnostic CST adapter for columnar & line-oriented record formats
 * (PSS/E `.raw`/`.dyr`, SPICE `.cir`/`.sp`, EPANET, SWMM, etc.).
 *
 * Updates individual CST field tokens in place so untouched columns, numeric formatting,
 * precision, and inline comments are preserved verbatim even when other lines contain errors.
 */
export class CstRecordAdapter {
  /** Returns healthy named/leaf field children of a CST record node. */
  static getRecordFields(recordNode: SyntaxNode, predicate?: (child: SyntaxNode) => boolean): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (const ch of getNodeChildrenSafe(recordNode)) {
      if (!isNodeHealthy(ch)) continue;
      if (predicate && !predicate(ch)) continue;
      out.push(ch);
    }
    return out;
  }

  /** Surgically replaces a single field token CST node inside a record without reformatting sibling fields. */
  static updateFieldNode(tx: CstTransaction, fieldNode: SyntaxNode, formattedValue: string): void {
    tx.replaceNode(fieldNode, formattedValue);
  }

  /** Replaces the `index`-th matching field child of `recordNode`. */
  static updateFieldAt(
    tx: CstTransaction,
    recordNode: SyntaxNode,
    index: number,
    formattedValue: string,
    predicate?: (child: SyntaxNode) => boolean,
  ): boolean {
    const fields = this.getRecordFields(recordNode, predicate);
    const target = fields[index];
    if (!target) {
      tx.recordSkipped(`record field index ${index} out of range (${fields.length})`, recordNode.type);
      return false;
    }
    tx.replaceNode(target, formattedValue);
    return true;
  }

  /**
   * Upserts a metadata tag inside a record line's trailing comment (e.g. `/ @pos(100, 200)` in PSS/E
   * or `; @pos(100, 200)` in SPICE) anchored strictly to the CST record's line span.
   */
  static upsertTrailingCommentTag(
    tx: CstTransaction,
    recordNode: SyntaxNode,
    commentMarker: string,
    tagRegex: RegExp,
    formattedTag: string,
  ): void {
    const source = tx.session.text;
    const recStart = nodeStartOffset(recordNode);
    let lineEnd = nodeEndOffset(recordNode);
    while (lineEnd < source.length && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") {
      lineEnd++;
    }
    const lineSlice = source.slice(recStart, lineEnd);
    const existing = tagRegex.exec(lineSlice);
    if (existing) {
      tx.replaceRange(recStart + existing.index, recStart + existing.index + existing[0].length, formattedTag);
      return;
    }
    // Check if an unquoted comment marker already exists on this record's line
    let inSingle = false;
    let inDouble = false;
    let hasComment = false;
    for (let i = 0; i < lineSlice.length; i++) {
      const ch = lineSlice[i]!;
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (!inSingle && !inDouble && lineSlice.startsWith(commentMarker, i)) {
        hasComment = true;
        break;
      }
    }
    let trimEnd = lineEnd;
    while (trimEnd > recStart && (source[trimEnd - 1] === " " || source[trimEnd - 1] === "\t")) {
      trimEnd--;
    }
    tx.replaceRange(trimEnd, lineEnd, hasComment ? ` ${formattedTag}` : ` ${commentMarker} ${formattedTag}`);
  }

  /** Inserts a new record line immediately before `anchorNode` (e.g. a section terminator like `0 / END OF BUS DATA`). */
  static insertRecordBefore(tx: CstTransaction, anchorNode: SyntaxNode, recordLine: string): void {
    const source = tx.session.text;
    const eol = tx.session.eol;
    let start = nodeStartOffset(anchorNode);
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    const indent = tx.session.lineIndentAt(nodeStartOffset(anchorNode));
    tx.insertAt(start, `${indent}${recordLine}${eol}`);
  }

  /** Deletes a record CST node together with its full line and trailing EOL. */
  static deleteRecord(tx: CstTransaction, recordNode: SyntaxNode): void {
    const source = tx.session.text;
    let start = nodeStartOffset(recordNode);
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    let end = nodeEndOffset(recordNode);
    while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
    if (source[end] === "\r") end++;
    if (source[end] === "\n") end++;
    tx.deleteRange(start, end);
  }
}
