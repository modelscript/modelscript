// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Tag-Driven Generic LSP Provider (GraalVM Instrumentation API pattern).
 *
 * Uses `SemanticCstTag` bitmasks from `@modelscript/dsl` to provide universal
 * `DocumentSymbol`, `FoldingRange`, and breakpoint-line extraction across all
 * 106+ languages without requiring custom per-language `PluginCustomHandlers`.
 */

import { getNodeSemanticTags, SemanticCstTag, type SemanticTagTable, type TaggableCstNode } from "@modelscript/dsl";
import {
  type DocumentSymbol,
  type FoldingRange,
  FoldingRangeKind,
  type Range,
  SymbolKind,
} from "vscode-languageserver";

function nodeToRange(node: TaggableCstNode): Range {
  const start = node.startPosition ?? { row: 0, column: 0 };
  const end = node.endPosition ?? start;
  return {
    start: { line: start.row, character: start.column },
    end: { line: end.row, character: end.column },
  };
}

function extractNodeName(node: TaggableCstNode): string {
  if (typeof node.childForFieldName === "function") {
    const nameField = node.childForFieldName("name") ?? node.childForFieldName("id");
    if (nameField?.text) return nameField.text.trim();
  }
  const kids = node.namedChildren ?? node.children ?? [];
  for (const child of kids) {
    const t = typeof child?.type === "string" ? child.type.toLowerCase() : "";
    if (t.includes("ident") || t === "name" || t === "id") {
      if (child.text) return child.text.trim();
    }
  }
  if (node.text) {
    const firstLine = node.text.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (firstLine.length > 0) return firstLine.slice(0, 64);
  }
  return node.type;
}

function mapTagMaskToSymbolKind(mask: number): SymbolKind {
  if ((mask & SemanticCstTag.Function) !== 0) return SymbolKind.Function;
  if ((mask & SemanticCstTag.Port) !== 0) return SymbolKind.Interface;
  if ((mask & SemanticCstTag.Parameter) !== 0) return SymbolKind.Property;
  if ((mask & SemanticCstTag.Component) !== 0) return SymbolKind.Field;
  if ((mask & SemanticCstTag.State) !== 0) return SymbolKind.EnumMember;
  if ((mask & SemanticCstTag.Requirement) !== 0) return SymbolKind.Object;
  if ((mask & SemanticCstTag.Equation) !== 0) return SymbolKind.Operator;
  if ((mask & SemanticCstTag.Scope) !== 0) return SymbolKind.Class;
  return SymbolKind.Variable;
}

const OUTLINE_MASK =
  SemanticCstTag.Declaration |
  SemanticCstTag.Component |
  SemanticCstTag.Function |
  SemanticCstTag.Port |
  SemanticCstTag.Parameter |
  SemanticCstTag.State |
  SemanticCstTag.Requirement;

/**
 * Extracts hierarchical LSP `DocumentSymbol[]` from any CST using `SemanticCstTag` bitmasks.
 */
export function extractDocumentSymbolsByTags(root: TaggableCstNode, table?: SemanticTagTable): DocumentSymbol[] {
  const result: DocumentSymbol[] = [];

  const visit = (node: TaggableCstNode, target: DocumentSymbol[]): void => {
    const mask = getNodeSemanticTags(node, table);
    const kids = node.namedChildren ?? node.children ?? [];

    if ((mask & SemanticCstTag.Root) === 0 && (mask & OUTLINE_MASK) !== 0) {
      const range = nodeToRange(node);
      const children: DocumentSymbol[] = [];
      for (const child of kids) {
        visit(child, children);
      }
      target.push({
        name: extractNodeName(node),
        kind: mapTagMaskToSymbolKind(mask),
        range,
        selectionRange: range,
        ...(children.length > 0 ? { children } : {}),
      });
      return;
    }

    for (const child of kids) {
      visit(child, target);
    }
  };

  visit(root, result);
  return result;
}

const FOLDABLE_MASK = SemanticCstTag.Scope | SemanticCstTag.Block | SemanticCstTag.Comment | SemanticCstTag.Import;

/**
 * Extracts LSP `FoldingRange[]` from any CST using `SemanticCstTag` bitmasks.
 */
export function extractFoldingRangesByTags(root: TaggableCstNode, table?: SemanticTagTable): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  const visit = (node: TaggableCstNode): void => {
    const mask = getNodeSemanticTags(node, table);
    if ((mask & SemanticCstTag.Root) === 0 && (mask & FOLDABLE_MASK) !== 0) {
      const startLine = node.startPosition?.row ?? 0;
      const endLine = node.endPosition?.row ?? startLine;
      if (endLine > startLine) {
        let kind: FoldingRangeKind | undefined;
        if ((mask & SemanticCstTag.Comment) !== 0) kind = FoldingRangeKind.Comment;
        else if ((mask & SemanticCstTag.Import) !== 0) kind = FoldingRangeKind.Imports;
        else kind = FoldingRangeKind.Region;
        ranges.push({ startLine, endLine, kind });
      }
    }

    const kids = node.namedChildren ?? node.children ?? [];
    for (const child of kids) {
      visit(child);
    }
  };

  visit(root);
  return ranges;
}

const BREAKPOINT_MASK = SemanticCstTag.Equation | SemanticCstTag.Statement | SemanticCstTag.Transition;

/**
 * Extracts 0-based line numbers eligible for DAP simulation/algorithm breakpoints
 * across any language purely from `SemanticCstTag` bitmasks.
 */
export function extractBreakpointLinesByTags(root: TaggableCstNode, table?: SemanticTagTable): number[] {
  const lines = new Set<number>();

  const visit = (node: TaggableCstNode): void => {
    const mask = getNodeSemanticTags(node, table);
    if ((mask & BREAKPOINT_MASK) !== 0 && node.startPosition !== undefined) {
      lines.add(node.startPosition.row);
    }
    const kids = node.namedChildren ?? node.children ?? [];
    for (const child of kids) {
      visit(child);
    }
  };

  visit(root);
  return Array.from(lines).sort((a, b) => a - b);
}

/**
 * Standard LSP semantic token type indices aligned with VS Code default legends:
 * 0: type/class, 1: function, 2: variable/component, 3: parameter, 4: property/port, 5: comment, 6: number/literal
 */
function mapTagMaskToSemanticTokenType(mask: number): number {
  if ((mask & SemanticCstTag.Comment) !== 0) return 5;
  if ((mask & SemanticCstTag.Function) !== 0) return 1;
  if ((mask & SemanticCstTag.Port) !== 0) return 4;
  if ((mask & SemanticCstTag.Parameter) !== 0) return 3;
  if ((mask & SemanticCstTag.Component) !== 0) return 2;
  if ((mask & SemanticCstTag.Scope) !== 0) return 0;
  if ((mask & SemanticCstTag.Literal) !== 0) return 6;
  return -1;
}

/**
 * Extracts LSP delta-encoded `SemanticTokens.data` (`[deltaLine, deltaChar, length, tokenType, tokenModifiers]`)
 * for any language purely from `SemanticCstTag` bitmasks.
 */
export function extractSemanticTokensByTags(root: TaggableCstNode, table?: SemanticTagTable): number[] {
  const raw: Array<{ line: number; col: number; len: number; tokenType: number }> = [];

  const visit = (node: TaggableCstNode): void => {
    const mask = getNodeSemanticTags(node, table);
    if ((mask & SemanticCstTag.Root) === 0 && node.startPosition && node.endPosition) {
      const tokenType = mapTagMaskToSemanticTokenType(mask);
      if (tokenType >= 0 && node.startPosition.row === node.endPosition.row) {
        const len = Math.max(1, node.endPosition.column - node.startPosition.column);
        raw.push({
          line: node.startPosition.row,
          col: node.startPosition.column,
          len,
          tokenType,
        });
      }
    }
    const kids = node.namedChildren ?? node.children ?? [];
    for (const child of kids) {
      visit(child);
    }
  };

  visit(root);
  raw.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.col - b.col));

  const data: number[] = [];
  let prevLine = 0;
  let prevCol = 0;
  for (const tok of raw) {
    const deltaLine = tok.line - prevLine;
    const deltaCol = deltaLine === 0 ? tok.col - prevCol : tok.col;
    data.push(deltaLine, Math.max(0, deltaCol), tok.len, tok.tokenType, 0);
    prevLine = tok.line;
    prevCol = tok.col;
  }
  return data;
}

export interface TagExtractedDiagram {
  components: Array<{ name: string; kind: string; line: number }>;
  ports: Array<{ name: string; kind: string; line: number }>;
  connections: Array<{ text: string; line: number }>;
}

/**
 * Extracts baseline schematic diagram elements (components, ports, connections) from any
 * language's CST purely using `SemanticCstTag` bitmasks.
 */
export function extractDiagramElementsByTags(root: TaggableCstNode, table?: SemanticTagTable): TagExtractedDiagram {
  const result: TagExtractedDiagram = { components: [], ports: [], connections: [] };

  const visit = (node: TaggableCstNode): void => {
    const mask = getNodeSemanticTags(node, table);
    const line = node.startPosition?.row ?? 0;
    if ((mask & SemanticCstTag.Connection) !== 0) {
      result.connections.push({ text: (node.text ?? node.type).trim(), line });
    } else if ((mask & SemanticCstTag.Port) !== 0) {
      result.ports.push({ name: extractNodeName(node), kind: node.type, line });
    } else if ((mask & SemanticCstTag.Component) !== 0) {
      result.components.push({ name: extractNodeName(node), kind: node.type, line });
    }
    const kids = node.namedChildren ?? node.children ?? [];
    for (const child of kids) {
      visit(child);
    }
  };

  visit(root);
  return result;
}
