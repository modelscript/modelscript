// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ScadCstNode } from "./patcher.js";

export type ScadFeatureKind = "boolean" | "transform" | "primitive" | "loop" | "module";

export type ScadModifierChar = "*" | "!" | "#" | "%";

export interface ScadFeatureNode {
  readonly id: string;
  readonly kind: ScadFeatureKind;
  readonly op: string;
  readonly label: string;
  readonly line: number;
  readonly startOffset: number;
  readonly opOffset: number;
  readonly modifier: ScadModifierChar | null;
  readonly children: ScadFeatureNode[];
}

function getChildren(node: ScadCstNode | null | undefined): ScadCstNode[] {
  if (!node) return [];
  if (Array.isArray(node.children)) {
    return node.children as ScadCstNode[];
  }
  const out: ScadCstNode[] = [];
  const count = node.childCount ?? 0;
  for (let i = 0; i < count; i++) {
    const ch = node.child(i);
    if (ch) out.push(ch);
  }
  return out;
}

function findChild(node: ScadCstNode | null | undefined, type: string): ScadCstNode | undefined {
  for (const ch of getChildren(node)) {
    if (ch.type === type) return ch;
  }
  return undefined;
}

function nodeStartOffset(node: ScadCstNode): number {
  return node.startIndex ?? node.startOffset ?? node._startOffset ?? 0;
}

function computeLineStarts(source: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid]! <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(1, hi + 1);
}

function compactArgsText(raw: string): string {
  const compact = raw
    .replace(/\s+/g, " ")
    .replace(/\s*=\s*/g, "=")
    .replace(/\s*,\s*/g, ", ")
    .trim();
  if (!compact) return "";
  return compact.length > 36 ? `${compact.slice(0, 35)}…` : compact;
}

function detectPrecedingModifier(
  source: string,
  opOffset: number,
): {
  modifier: ScadModifierChar | null;
  startOffset: number;
} {
  let i = opOffset - 1;
  while (i >= 0 && (source[i] === " " || source[i] === "\t")) i--;
  if (i >= 0) {
    const ch = source[i]!;
    if (ch === "*" || ch === "!" || ch === "#" || ch === "%") {
      return { modifier: ch as ScadModifierChar, startOffset: i };
    }
  }
  return { modifier: null, startOffset: opOffset };
}

const PRIMITIVE_CST_TYPES = new Set([
  "CubePrimitive",
  "CylinderPrimitive",
  "SpherePrimitive",
  "PolyhedronPrimitive",
  "PolygonPrimitive",
  "CirclePrimitive",
  "SquarePrimitive",
  "TextPrimitive",
  "SurfacePrimitive",
  "ImportPrimitive",
]);

const SKIP_CST_TYPES = new Set([
  "ModuleDeclaration",
  "FunctionDeclaration",
  "VariableDeclaration",
  "IncludeStatement",
  "UseStatement",
  "Comment",
  "LINE_COMMENT",
  "BLOCK_COMMENT",
]);

/**
 * Extracts a hierarchical CSG Feature / Operation Tree directly from the native
 * WASM GLR OpenSCAD CST (`ScadCstNode`), with exact byte offsets and 1-based line numbers.
 */
export function buildScadFeatureTreeFromCst(rootNode: ScadCstNode, source?: string): ScadFeatureNode[] {
  const fullSource = source ?? rootNode.tree?.sourceCode ?? rootNode.text ?? "";
  const lineStarts = computeLineStarts(fullSource);

  const isNamedNode = (n: ScadCstNode): boolean => {
    const named = (n as { isNamed?: boolean }).isNamed;
    if (typeof named === "boolean") return named;
    return /^[A-Z]/.test(n.type);
  };

  const unwrapStmt = (n: ScadCstNode | null | undefined): ScadCstNode | null => {
    if (!n) return null;
    if (n.type === "Statement") {
      return getChildren(n).find(isNamedNode) ?? null;
    }
    return n;
  };

  const makeNode = (
    kind: ScadFeatureKind,
    op: string,
    argsText: string,
    anchorNode: ScadCstNode,
    children: ScadFeatureNode[],
  ): ScadFeatureNode => {
    const opOffset = nodeStartOffset(anchorNode);
    const { modifier, startOffset } = detectPrecedingModifier(fullSource, opOffset);
    const argsShort = compactArgsText(argsText);
    const label = argsShort ? `${op}(${argsShort})` : `${op}()`;
    const line = offsetToLine(lineStarts, opOffset);
    return {
      id: `op:${opOffset}`,
      kind,
      op,
      label,
      line,
      startOffset,
      opOffset,
      modifier,
      children,
    };
  };

  const visit = (rawNode: ScadCstNode | null | undefined): ScadFeatureNode[] => {
    const node = unwrapStmt(rawNode);
    if (!node || SKIP_CST_TYPES.has(node.type)) return [];

    if (node.type === "SourceFile" || node.type === "Program" || node.type === "BlockStatement") {
      const out: ScadFeatureNode[] = [];
      for (const ch of getChildren(node)) {
        out.push(...visit(ch));
      }
      return out;
    }

    if (node.type === "ForStatement" || node.type === "IntersectionForStatement" || node.type === "IfStatement") {
      const children = getChildren(node);
      const op =
        node.type === "IntersectionForStatement" ? "intersection_for" : node.type === "IfStatement" ? "if" : "for";
      // Collect header expression text between '(' and ')' from direct CST children
      let argsText = "";
      let inHeader = false;
      for (const ch of children) {
        if (ch.text === "(" && !inHeader) {
          inHeader = true;
          continue;
        }
        if (inHeader) {
          if (ch.text === ")") break;
          argsText += (argsText ? " " : "") + ch.text.trim();
        }
      }
      const bodyChildren: ScadFeatureNode[] = [];
      for (const ch of children) {
        if (ch.type === "Statement" || ch.type === "BlockStatement") {
          bodyChildren.push(...visit(ch));
        }
      }
      return [makeNode("loop", op, argsText, node, bodyChildren)];
    }

    if (node.type === "PrefixSolid") {
      const children = getChildren(node);
      const opNode = children.find(
        (c) =>
          c.type === "BooleanOp" ||
          c.type === "TransformOp" ||
          c.type === "LinearExtrudeOp" ||
          c.type === "RotateExtrudeOp" ||
          c.type === "TagPortOp" ||
          c.type === "ColorOp",
      );
      if (!opNode) {
        const out: ScadFeatureNode[] = [];
        for (const ch of children) {
          if (isNamedNode(ch)) out.push(...visit(ch));
        }
        return out;
      }

      const opChildren = getChildren(opNode);
      const opName = opChildren[0]?.text?.trim() || opNode.type;
      const argList = findChild(opNode, "ArgumentList");
      const argsText = argList?.text?.trim() ?? "";
      const kind: ScadFeatureKind = opNode.type === "BooleanOp" ? "boolean" : "transform";

      const bodyChildren: ScadFeatureNode[] = [];
      for (const ch of children) {
        if (ch !== opNode && isNamedNode(ch)) {
          bodyChildren.push(...visit(ch));
        }
      }
      return [makeNode(kind, opName, argsText, opNode, bodyChildren)];
    }

    if (node.type === "ChainedSolidStatement") {
      const chained = findChild(node, "ChainedSolid");
      return chained ? visit(chained) : [];
    }

    if (node.type === "ChainedSolid") {
      const primary = findChild(node, "PrimarySolid");
      return primary ? visit(primary) : [];
    }

    if (node.type === "PrimarySolid") {
      const target = getChildren(node).find(isNamedNode);
      return target ? visit(target) : [];
    }

    if (PRIMITIVE_CST_TYPES.has(node.type)) {
      const primName = getChildren(node)[0]?.text?.trim() || node.type.replace(/Primitive$/, "").toLowerCase();
      const argList = findChild(node, "ArgumentList");
      return [makeNode("primitive", primName, argList?.text?.trim() ?? "", node, [])];
    }

    if (node.type === "ModuleInstantiation") {
      const callee = findChild(node, "IDENTIFIER")?.text?.trim();
      if (!callee) return [];
      const argList = findChild(node, "ArgumentList");
      const bodyChildren: ScadFeatureNode[] = [];
      for (const ch of getChildren(node)) {
        if (ch.type === "Statement" || ch.type === "BlockStatement") {
          bodyChildren.push(...visit(ch));
        }
      }
      return [makeNode("module", callee, argList?.text?.trim() ?? "", node, bodyChildren)];
    }

    return [];
  };

  return visit(rootNode);
}

export interface ScadFeatureOverrides {
  readonly suppressedIds: ReadonlySet<string>;
  readonly isolatedId: string | null;
  readonly ghostIds: ReadonlySet<string>;
}

export const EMPTY_SCAD_FEATURE_OVERRIDES: ScadFeatureOverrides = {
  suppressedIds: new Set<string>(),
  isolatedId: null,
  ghostIds: new Set<string>(),
};

export function countScadFeatureNodes(nodes: readonly ScadFeatureNode[]): number {
  let total = 0;
  for (const n of nodes) {
    total += 1 + countScadFeatureNodes(n.children);
  }
  return total;
}

export function hasActiveScadOverrides(overrides: ScadFeatureOverrides): boolean {
  return overrides.suppressedIds.size > 0 || overrides.isolatedId !== null || overrides.ghostIds.size > 0;
}

/**
 * Produces a non-destructive derived OpenSCAD source string by splicing `*` (suppress),
 * `!` (isolate), and `#` (debug/ghost) modifiers at the exact CST byte offsets reported
 * by `buildScadFeatureTreeFromCst`.
 */
export function applyScadOperationOverrides(
  source: string,
  nodes: readonly ScadFeatureNode[],
  overrides: ScadFeatureOverrides,
): string {
  if (!hasActiveScadOverrides(overrides) || nodes.length === 0) {
    return source;
  }

  const edits: Array<{ start: number; end: number; text: string }> = [];
  const visit = (list: readonly ScadFeatureNode[]) => {
    for (const node of list) {
      let desiredMod: ScadModifierChar | undefined;
      if (overrides.suppressedIds.has(node.id)) {
        desiredMod = "*";
      } else if (overrides.isolatedId === node.id) {
        desiredMod = "!";
      } else if (overrides.ghostIds.has(node.id)) {
        desiredMod = "#";
      }

      if (desiredMod !== undefined) {
        if (node.modifier) {
          edits.push({ start: node.startOffset, end: node.startOffset + 1, text: desiredMod });
        } else {
          edits.push({ start: node.opOffset, end: node.opOffset, text: desiredMod });
        }
      }
      if (node.children.length > 0) {
        visit(node.children);
      }
    }
  };
  visit(nodes);

  if (edits.length === 0) return source;
  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

export interface ScadParameterInfo {
  readonly name: string;
  readonly value: number;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly valueStartOffset: number;
  readonly valueEndOffset: number;
  readonly line: number;
}

function nodeEndOffset(node: ScadCstNode): number {
  const end = node.endIndex ?? node.endOffset;
  if (typeof end === "number") return end;
  return nodeStartOffset(node) + (node.text?.length ?? 0);
}

function extractScalarNumberFromExpr(
  node: ScadCstNode | null | undefined,
): { value: number; startOffset: number; endOffset: number } | null {
  if (!node) return null;

  if (node.type === "Expression" || node.type === "PrimaryExpression") {
    const chs = getChildren(node);
    if (chs.length === 1) {
      return extractScalarNumberFromExpr(chs[0]);
    }
    return null;
  }

  if (node.type === "NUMBER") {
    const num = Number(node.text.trim());
    if (!Number.isFinite(num)) return null;
    return {
      value: num,
      startOffset: nodeStartOffset(node),
      endOffset: nodeEndOffset(node),
    };
  }

  if (node.type === "UnaryExpression") {
    const chs = getChildren(node);
    if (chs.length === 2) {
      const op = chs[0]?.text?.trim();
      if (op === "-" || op === "+") {
        const inner = extractScalarNumberFromExpr(chs[1]);
        if (inner) {
          return {
            value: op === "-" ? -inner.value : inner.value,
            startOffset: nodeStartOffset(node),
            endOffset: nodeEndOffset(node),
          };
        }
      }
    }
    return null;
  }

  return null;
}

/**
 * Extracts top-level scalar numeric `VariableDeclaration` CST nodes (skipping `$` special variables),
 * returning exact byte offsets for both the declaration and its numeric literal value expression.
 */
export function extractScadParametersFromCst(rootNode: ScadCstNode, source?: string): ScadParameterInfo[] {
  const fullSource = source ?? rootNode.tree?.sourceCode ?? rootNode.text ?? "";
  const lineStarts = computeLineStarts(fullSource);
  const params: ScadParameterInfo[] = [];

  for (const rawChild of getChildren(rootNode)) {
    const decl = rawChild.type === "Statement" ? (findChild(rawChild, "VariableDeclaration") ?? null) : rawChild;
    if (!decl || decl.type !== "VariableDeclaration") continue;

    const nameNode = findChild(decl, "IDENTIFIER");
    const exprNode = findChild(decl, "Expression");
    const name = nameNode?.text?.trim() ?? "";
    if (!name || name.startsWith("$") || !exprNode) continue;

    const numeric = extractScalarNumberFromExpr(exprNode);
    if (!numeric) continue;

    const startOffset = nodeStartOffset(decl);
    const endOffset = nodeEndOffset(decl);
    params.push({
      name,
      value: numeric.value,
      startOffset,
      endOffset,
      valueStartOffset: numeric.startOffset,
      valueEndOffset: numeric.endOffset,
      line: offsetToLine(lineStarts, startOffset),
    });
  }

  return params;
}
