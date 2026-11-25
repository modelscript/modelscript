// SPDX-License-Identifier: AGPL-3.0-or-later

import { Cst, type SyntaxNode } from "../../../src-gen/bindings.js";
import type { FlattenerCstNode } from "../types.js";

export interface DiagnosticRange {
  startOffset: number;
  endOffset: number;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
}

export function getComponentClause<T extends FlattenerCstNode>(node: T | null | undefined): T | null {
  let curr: FlattenerCstNode | null | undefined = node;
  while (curr && curr.type !== "component_clause" && curr.parent) {
    curr = curr.parent;
  }
  return curr && curr.type === "component_clause" ? (curr as T) : null;
}

export function getElementDiagRange(target: FlattenerCstNode | null | undefined): DiagnosticRange | undefined {
  if (!target) return undefined;
  let node: FlattenerCstNode = target;
  if (node.type === "component_declaration") {
    const clause = getComponentClause(node);
    if (clause) node = clause;
  }
  while (
    node.parent &&
    node.type !== "component_clause" &&
    node.type !== "simple_equation" &&
    node.type !== "if_equation" &&
    node.type !== "if_statement" &&
    node.type !== "for_equation" &&
    node.type !== "for_statement" &&
    node.type !== "when_equation" &&
    node.type !== "when_statement" &&
    node.type !== "assignment_statement"
  ) {
    node = node.parent;
  }
  const text: string = node.text ?? "";
  const trimmedLen = text.endsWith(";") ? text.length - 1 : text.length;
  const startOffset = node.startIndex ?? node.startOffset ?? 0;
  const endOffset = startOffset + trimmedLen;
  let endPosition = node.endPosition;
  if (text.endsWith(";") && endPosition) {
    endPosition = {
      row: endPosition.row,
      column: Math.max(0, endPosition.column - 1),
    };
  }
  return {
    startOffset,
    endOffset,
    startPosition: node.startPosition,
    endPosition,
  };
}

export function getClassDiagRange(target: FlattenerCstNode | null | undefined): DiagnosticRange | undefined {
  if (!target) return undefined;
  let startOffset = target.startIndex ?? target.startOffset ?? 0;
  let startPosition = target.startPosition;
  const pfxNode: FlattenerCstNode | null | undefined =
    Cst.ClassDefinition.classPrefixes(target as SyntaxNode) ??
    target.children?.find((c) => c.type === "class_prefixes");
  if (pfxNode?.children) {
    for (const child of pfxNode.children) {
      if (child.type !== "comment" && child.type !== "description") {
        startPosition = child.startPosition ?? startPosition;
        startOffset = child.startIndex ?? child.startOffset ?? startOffset;
        break;
      }
    }
  }
  return {
    startOffset,
    endOffset: target.endIndex ?? target.endOffset ?? 0,
    startPosition,
    endPosition: target.endPosition,
  };
}
