// SPDX-License-Identifier: AGPL-3.0-or-later

import { Cst } from "../../../src-gen/bindings.js";

export interface DiagnosticRange {
  startByte: number;
  endByte: number;
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
}

export function getComponentClause(node: any): any {
  let curr = node;
  while (curr && curr.type !== "component_clause" && curr.parent) {
    curr = curr.parent;
  }
  return curr && curr.type === "component_clause" ? curr : null;
}

export function getElementDiagRange(target: any): DiagnosticRange | undefined {
  if (!target) return undefined;
  let node = target;
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
  const startByte = node.startIndex ?? node.startByte ?? 0;
  const endByte = startByte + trimmedLen;
  let endPosition = node.endPosition;
  if (text.endsWith(";") && endPosition) {
    endPosition = {
      row: endPosition.row,
      column: Math.max(0, endPosition.column - 1),
    };
  }
  return {
    startByte,
    endByte,
    startPosition: node.startPosition,
    endPosition,
  };
}

export function getClassDiagRange(target: any): DiagnosticRange | undefined {
  if (!target) return undefined;
  let startByte = target.startIndex ?? target.startByte ?? 0;
  let startPosition = target.startPosition;
  const pfxNode =
    Cst.ClassDefinition.classPrefixes(target) ?? target.children?.find((c: any) => c.type === "class_prefixes");
  if (pfxNode?.children) {
    for (const child of pfxNode.children) {
      if (child.type !== "comment" && child.type !== "description") {
        startPosition = child.startPosition ?? startPosition;
        startByte = child.startIndex ?? (child as any).startByte ?? startByte;
        break;
      }
    }
  }
  return {
    startByte,
    endByte: target.endIndex ?? target.endByte ?? 0,
    startPosition,
    endPosition: target.endPosition,
  };
}
