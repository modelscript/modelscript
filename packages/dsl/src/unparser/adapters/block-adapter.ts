// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "../../utils/cst-facade.js";
import { getNodeChildrenSafe, isNodeHealthy, isNodeMissing, nodeEndOffset, nodeStartOffset } from "../session.js";
import { CstTransaction } from "../transaction.js";

/**
 * Language-agnostic CST adapter for block-structured textual languages
 * (Modelica, SysML v2, OWL 2, OpenSCAD, GenericDSL).
 *
 * Inserts, updates, and deletes statements using CST node spans while remaining resilient
 * when a block's closing delimiter (`}`, `)`, `end`) is missing due to an in-progress edit.
 */
export class CstBlockAdapter {
  /**
   * Inserts `statementText` into a block/body CST node, inheriting indentation from existing
   * sibling statements and anchoring before the closing delimiter (or after the last healthy
   * child if the closing delimiter is `isMissing`).
   */
  static insertStatement(
    tx: CstTransaction,
    blockNode: SyntaxNode,
    statementText: string,
    options?: {
      closingDelimiterTokens?: ReadonlyArray<string> | undefined;
      beforeNode?: SyntaxNode | undefined;
      afterNode?: SyntaxNode | undefined;
    },
  ): void {
    const source = tx.session.text;
    const eol = tx.session.eol;
    const parentIndent = tx.session.lineIndentAt(nodeStartOffset(blockNode));
    const closingSet = new Set(options?.closingDelimiterTokens ?? ["}", ")", "end"]);

    const kids = getNodeChildrenSafe(blockNode);
    const healthyBodyKids = kids.filter(
      (c) =>
        isNodeHealthy(c) &&
        !closingSet.has(c.type) &&
        c.type !== "{" &&
        c.type !== "(" &&
        !closingSet.has(source.slice(nodeStartOffset(c), nodeEndOffset(c)).trim()),
    );
    const stmtIndent =
      healthyBodyKids.length > 0 ? tx.session.lineIndentAt(nodeStartOffset(healthyBodyKids[0]!)) : `${parentIndent}  `;

    const indentedStmt = statementText
      .split(/\r?\n/)
      .map((line) => (line.length > 0 ? `${stmtIndent}${line}` : line))
      .join(eol);

    if (options?.beforeNode) {
      let at = nodeStartOffset(options.beforeNode);
      while (at > 0 && (source[at - 1] === " " || source[at - 1] === "\t")) at--;
      tx.insertAt(at, `${indentedStmt}${eol}`);
      return;
    }

    if (options?.afterNode) {
      let at = nodeEndOffset(options.afterNode);
      while (at < source.length && (source[at] === " " || source[at] === "\t")) at++;
      if (source[at] === "\r") at++;
      if (source[at] === "\n") at++;
      tx.insertAt(at, `${indentedStmt}${eol}`);
      return;
    }

    // Anchor before the closing delimiter if healthy and present
    const lastKid = kids[kids.length - 1];
    if (
      lastKid &&
      !isNodeMissing(lastKid) &&
      (closingSet.has(lastKid.type) ||
        closingSet.has(source.slice(nodeStartOffset(lastKid), nodeEndOffset(lastKid)).trim()))
    ) {
      let at = nodeStartOffset(lastKid);
      while (at > nodeStartOffset(blockNode) && (source[at - 1] === " " || source[at - 1] === "\t")) at--;
      const needsLead = at > 0 && source[at - 1] !== "\n";
      tx.insertAt(at, `${needsLead ? eol : ""}${indentedStmt}${eol}`);
      return;
    }

    // Error-recovered unclosed block: insert after last healthy child (or block end)
    const anchor =
      healthyBodyKids.length > 0
        ? nodeEndOffset(healthyBodyKids[healthyBodyKids.length - 1]!)
        : nodeEndOffset(blockNode);
    tx.insertAt(anchor, `${eol}${indentedStmt}`);
  }

  /** Deletes a statement CST node along with its leading indent and trailing line break. */
  static deleteStatement(tx: CstTransaction, stmtNode: SyntaxNode): void {
    const source = tx.session.text;
    let start = nodeStartOffset(stmtNode);
    while (start > 0 && (source[start - 1] === " " || source[start - 1] === "\t")) start--;
    let end = nodeEndOffset(stmtNode);
    while (end < source.length && (source[end] === " " || source[end] === "\t")) end++;
    if (source[end] === "\r") end++;
    if (source[end] === "\n") end++;
    tx.deleteRange(start, end);
  }
}
