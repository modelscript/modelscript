// SPDX-License-Identifier: AGPL-3.0-or-later

import { type DAEBuilder, type QueryDB, type SymbolId } from "@modelscript/runtime";
import { type SyntaxNode } from "../../../src-gen/bindings.js";
import { ModelicaErrorCode } from "../../errors.js";

export function pushError(
  dae: DAEBuilder,
  code: number,
  rule: string,
  message: string,
  node?: SyntaxNode | null,
): void {
  dae.diagnostics.push({
    code,
    rule,
    severity: "error",
    message,
    range: node ? { startOffset: node.startIndex, endOffset: node.endIndex } : null,
  });
}

export function pushNotification(
  dae: DAEBuilder,
  node?: SyntaxNode | null,
  code: number = ModelicaErrorCode.NOTIFICATION_FROM_HERE.code,
): void {
  if (!node) return;
  dae.diagnostics.push({
    code,
    rule: ModelicaErrorCode.NOTIFICATION_FROM_HERE.rule,
    severity: "notification",
    message: "From here:",
    range: { startOffset: node.startIndex, endOffset: node.endIndex },
  });
}

export function findNodeAtByteRange(
  root: SyntaxNode,
  startByte: number,
  endByte: number,
  targetTypes: string[],
): SyntaxNode | null {
  let best: SyntaxNode | null = null;
  function visit(n: SyntaxNode): void {
    if (n.startIndex <= startByte && n.endIndex >= endByte) {
      if (targetTypes.includes(n.type)) {
        best = n;
      }
      for (const ch of n.namedChildren) {
        visit(ch);
      }
    }
  }
  visit(root);
  return best;
}

export function cstOf(db: QueryDB, id: SymbolId): SyntaxNode | null {
  return (db.cstNode(id) as SyntaxNode | null) ?? null;
}
