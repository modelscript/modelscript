// SPDX-License-Identifier: AGPL-3.0-or-later
//
// SysML2 diagram-to-code edit computation.
// Produces LSP TextEdit arrays for inserting, modifying, and deleting
// SysML2 elements and connections in `.sysml` source text.

import { CstDocumentSession, CstTransaction, type CstTextEdit } from "@modelscript/dsl/unparser";
import { Range, TextEdit } from "vscode-languageserver";
import {
  collectCstLeaves,
  offsetToLineColumn,
  parseSysmlSource,
  sliceLeavesInRange,
  stripNamespaceWildcard,
  trimTrailingChars,
} from "../cst-utils.js";

// ── SysML2 Code Generation Templates ──

const INDENT = "  ";

/**
 * Maps SysML2 element type keys to source code snippet generators.
 */
const ELEMENT_TEMPLATES: Record<string, (name: string, indent: string) => string> = {
  // Structural
  PartDefinition: (name, ind) => `${ind}part def ${name} {\n${ind}}\n`,
  PartUsage: (name, ind) => `${ind}part ${name};\n`,
  AttributeDefinition: (name, ind) => `${ind}attribute def ${name} {\n${ind}}\n`,
  AttributeUsage: (name, ind) => `${ind}attribute ${name};\n`,
  PortDefinition: (name, ind) => `${ind}port def ${name} {\n${ind}}\n`,
  PortUsage: (name, ind) => `${ind}port ${name};\n`,
  ItemDefinition: (name, ind) => `${ind}item def ${name} {\n${ind}}\n`,
  ItemUsage: (name, ind) => `${ind}item ${name};\n`,
  EnumerationDefinition: (name, ind) => `${ind}enum def ${name} {\n${ind}}\n`,

  // Behavioral
  ActionDefinition: (name, ind) => `${ind}action def ${name} {\n${ind}}\n`,
  ActionUsage: (name, ind) => `${ind}action ${name};\n`,
  StateDefinition: (name, ind) => `${ind}state def ${name} {\n${ind}}\n`,
  StateUsage: (name, ind) => `${ind}state ${name};\n`,
  CalculationDefinition: (name, ind) => `${ind}calc def ${name} {\n${ind}}\n`,
  CalculationUsage: (name, ind) => `${ind}calc ${name};\n`,

  // Requirements
  RequirementDefinition: (name, ind) => `${ind}requirement def ${name} {\n${ind}}\n`,
  RequirementUsage: (name, ind) => `${ind}requirement ${name};\n`,
  ConcernDefinition: (name, ind) => `${ind}concern def ${name} {\n${ind}}\n`,
  ConcernUsage: (name, ind) => `${ind}concern ${name};\n`,
  ConstraintDefinition: (name, ind) => `${ind}constraint def ${name} {\n${ind}}\n`,
  ConstraintUsage: (name, ind) => `${ind}constraint ${name};\n`,

  // Analysis
  UseCaseDefinition: (name, ind) => `${ind}use case def ${name} {\n${ind}}\n`,
  UseCaseUsage: (name, ind) => `${ind}use case ${name};\n`,
  AnalysisCaseDefinition: (name, ind) => `${ind}analysis case def ${name} {\n${ind}}\n`,
  AnalysisCaseUsage: (name, ind) => `${ind}analysis case ${name};\n`,
  VerificationCaseDefinition: (name, ind) => `${ind}verification def ${name} {\n${ind}}\n`,
  VerificationCaseUsage: (name, ind) => `${ind}verification ${name};\n`,
  CaseDefinition: (name, ind) => `${ind}case def ${name} {\n${ind}}\n`,
  CaseUsage: (name, ind) => `${ind}case ${name};\n`,

  // Interconnection
  ConnectionDefinition: (name, ind) => `${ind}connection def ${name} {\n${ind}}\n`,
  InterfaceDefinition: (name, ind) => `${ind}interface def ${name} {\n${ind}}\n`,
  AllocationDefinition: (name, ind) => `${ind}allocation def ${name} {\n${ind}}\n`,
  FlowDefinition: (name, ind) => `${ind}flow def ${name} {\n${ind}}\n`,

  // Views
  ViewDefinition: (name, ind) => `${ind}view def ${name} {\n${ind}}\n`,
  ViewUsage: (name, ind) => `${ind}view ${name};\n`,
  ViewpointDefinition: (name, ind) => `${ind}viewpoint def ${name} {\n${ind}}\n`,
  ViewpointUsage: (name, ind) => `${ind}viewpoint ${name};\n`,
  RenderingDefinition: (name, ind) => `${ind}rendering def ${name} {\n${ind}}\n`,
  RenderingUsage: (name, ind) => `${ind}rendering ${name};\n`,

  // Meta
  OccurrenceDefinition: (name, ind) => `${ind}occurrence def ${name} {\n${ind}}\n`,

  // Activity Control Nodes
  ForkNode: (name, ind) => `${ind}fork ${name};\n`,
  JoinNode: (name, ind) => `${ind}join ${name};\n`,
  DecisionNode: (name, ind) => `${ind}decide ${name};\n`,
  MergeNode: (name, ind) => `${ind}merge ${name};\n`,
  AcceptActionNode: (name, ind) => `${ind}accept ${name};\n`,
  SendActionNode: (name, ind) => `${ind}send ${name};\n`,

  // Actors
  ActorDefinition: (name, ind) => `${ind}actor def ${name} {\n${ind}}\n`,
  ActorUsage: (name, ind) => `${ind}actor ${name};\n`,
};

// ── Insert new element ──

// ── CST Traversal Helpers ──

export interface DiagramCstNode {
  type?: string | undefined;
  text?: string | undefined;
  parent?: DiagramCstNode | null | undefined;
  namedChildCount?: number | undefined;
  namedChild(index: number): DiagramCstNode;
  startPosition?: { row: number; column: number } | undefined;
  endPosition?: { row: number; column: number } | undefined;
}

export interface DiagramCstTree {
  rootNode?: DiagramCstNode | null | undefined;
}

/**
 * Searches the parsed CST tree for a definition or usage node whose identifier matches `name`.
 */
export function findCstNodeByName(node: DiagramCstNode | null | undefined, name: string): DiagramCstNode | null {
  if (!node) return null;
  const isDecl =
    node.type?.endsWith("Usage") ||
    node.type?.endsWith("Def") ||
    node.type?.endsWith("Definition") ||
    node.type?.endsWith("Declaration") ||
    node.type === "Package";

  if (isDecl) {
    for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
      const child = node.namedChild(i);
      if (
        (child.type === "Name" || child.type === "Identifier" || child.type?.includes("Identification")) &&
        child.text === name
      ) {
        return node;
      }
    }
  }

  for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
    const found = findCstNodeByName(node.namedChild(i), name);
    if (found) return found;
  }
  return null;
}

/**
 * Finds the enclosing block or package node in the CST for inserting child elements.
 */
export function findCstEnclosingBlock(
  tree: DiagramCstTree | null | undefined,
  elementName?: string,
): { line: number; indent: string } | null {
  if (!tree?.rootNode) return null;
  const root = tree.rootNode;

  let targetBlockNode: DiagramCstNode | null | undefined = null;
  if (elementName) {
    const el = findCstNodeByName(root, elementName);
    if (el) {
      targetBlockNode = el.parent;
      while (
        targetBlockNode &&
        !targetBlockNode.type?.includes("Body") &&
        !targetBlockNode.type?.endsWith("Def") &&
        !targetBlockNode.type?.endsWith("Definition") &&
        targetBlockNode.type !== "Package"
      ) {
        targetBlockNode = targetBlockNode.parent;
      }
    }
  }

  if (!targetBlockNode) {
    targetBlockNode = root;
    for (let i = 0; i < (root.namedChildCount ?? 0); i++) {
      const ch = root.namedChild(i);
      if (ch.type === "Package" || ch.type?.includes("Body") || ch.type?.endsWith("Def")) {
        targetBlockNode = ch;
        break;
      }
    }
  }

  if (targetBlockNode) {
    const endLine = targetBlockNode.endPosition?.row;
    if (typeof endLine === "number" && endLine >= 0) {
      return { line: endLine, indent: INDENT };
    }
  }
  return null;
}

/**
 * Finds all CST connection or transition nodes connecting source and target.
 */
export function findCstConnectionNodes(
  root: DiagramCstNode | null | undefined,
  source: string,
  target: string,
): DiagramCstNode[] {
  const matches: DiagramCstNode[] = [];
  function walk(node: DiagramCstNode | null | undefined) {
    if (!node) return;
    const isConn =
      node.type === "ConnectionUsage" ||
      node.type === "TransitionUsage" ||
      node.type?.includes("Connection") ||
      node.type?.includes("Succession");
    if (isConn) {
      const text = node.text || "";
      if ((text.includes(source) && text.includes(target)) || (text.includes(target) && text.includes(source))) {
        matches.push(node);
      }
    }
    for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
      walk(node.namedChild(i));
    }
  }
  walk(root);
  return matches;
}

// ── Insert new element ──

/**
 * Options for inserting cross-language or typed SysML2 declarations via diagram drops.
 */
export interface SysML2CrossLanguageInsertOptions {
  /** Explicit SysML2 type annotation (dots `.` are normalized to `::`). */
  typeName?: string | undefined;
  /** Semantic usage keyword when `typeName` or custom type is supplied. Defaults to `"part"`. */
  usageKind?: "part" | "port" | "attribute" | "item" | undefined;
  /** Optional SysML2 import path (e.g. `Pkg::Type` or `Pkg::*`) inserted if not already present. */
  importPath?: string | undefined;
  /** Optional unindented black-box definition stub inserted alongside the typed usage. */
  stubBlock?: string | undefined;
}

function normalizeSysmlTypePath(raw: string): string {
  const trimmed = raw.trim();
  let out = "";
  let i = 0;
  while (i < trimmed.length) {
    if (trimmed[i] === ".") {
      while (i < trimmed.length && trimmed[i] === ".") i++;
      out += "::";
    } else {
      out += trimmed[i]!;
      i++;
    }
  }
  let start = 0;
  let end = out.length;
  while (start < end && out[start] === ":") start++;
  while (end > start && out[end - 1] === ":") end--;
  return out.slice(start, end);
}

function hasSysmlImport(docText: string, importTarget: string): boolean {
  const clean = stripNamespaceWildcard(normalizeSysmlTypePath(importTarget));
  if (!clean) return true;
  const segments = clean.split("::");
  const pkgWildcard = segments.length >= 2 ? `${segments.slice(0, -1).join("::")}::*` : "";
  const normalizedTarget = normalizeSysmlTypePath(importTarget);

  const leaves = collectCstLeaves(parseSysmlSource(docText));
  for (let i = 0; i < leaves.length; i++) {
    if (leaves[i]!.text !== "import") continue;
    let j = i + 1;
    if (leaves[j]?.text === "all") j++;
    let target = "";
    while (j < leaves.length && leaves[j]!.text !== ";" && leaves[j]!.text !== "{" && leaves[j]!.text !== "}") {
      target += leaves[j]!.text;
      j++;
    }
    if (leaves[j]?.text !== ";") continue;
    const normImported = normalizeSysmlTypePath(target);
    if (normImported === normalizedTarget || target === importTarget) return true;
    if (pkgWildcard && (normImported === pkgWildcard || normImported === `${pkgWildcard}*`)) return true;
  }
  return false;
}

function findEnclosingOpenBraceLine(lines: string[], closingLine: number): number {
  let depth = 0;
  for (let i = Math.min(closingLine, lines.length - 1); i >= 0; i--) {
    const line = lines[i]!;
    for (let c = line.length - 1; c >= 0; c--) {
      const ch = line[c]!;
      if (ch === "}") {
        depth++;
      } else if (ch === "{") {
        depth--;
        if (depth < 0) return i;
      }
    }
  }
  return -1;
}

function indentBlockLines(block: string, indent: string): string {
  const joined = block
    .split("\n")
    .map((line) => (line.trim().length > 0 ? `${indent}${line}` : ""))
    .join("\n");
  return trimTrailingChars(joined, "\n");
}

/**
 * Insert a new SysML2 element declaration at the appropriate position.
 * Uses the parsed CST tree if provided, falling back to brace counting.
 */
export function computeSysML2ElementInsert(
  docText: string,
  elementType: string,
  elementName: string,
  insertionLine?: number,
  tree?: DiagramCstTree | null,
  options?: SysML2CrossLanguageInsertOptions,
): TextEdit[] {
  const lines = docText.split("\n");
  const template = ELEMENT_TEMPLATES[elementType];
  const resolvedType = options?.typeName
    ? normalizeSysmlTypePath(options.typeName)
    : !template && (elementType.includes(".") || elementType.includes("::"))
      ? normalizeSysmlTypePath(elementType)
      : undefined;

  if (!template && !resolvedType) {
    // Fallback: generic part usage
    return computeSysML2ElementInsert(docText, "PartUsage", elementName, insertionLine, tree);
  }

  // Find the best insertion point
  let targetLine: number;
  let indent: string;

  if (insertionLine !== undefined && insertionLine >= 0 && insertionLine < lines.length) {
    targetLine = insertionLine;
    indent = getIndentAt(lines, targetLine);
  } else {
    const cstBlock = tree ? findCstEnclosingBlock(tree) : null;
    if (cstBlock) {
      targetLine = cstBlock.line;
      const braceIndent = getIndentAt(lines, targetLine);
      indent = braceIndent + INDENT;
    } else {
      // Find the last closing `}` in the document (end of the outermost package body)
      targetLine = -1;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i]!.trim() === "}") {
          targetLine = i;
          break;
        }
      }
      if (targetLine === -1) {
        // No closing brace found — append at end
        targetLine = lines.length;
        indent = docText.trim().length === 0 ? "" : INDENT;
      } else {
        // Indent one level deeper than the closing brace
        const braceIndent = getIndentAt(lines, targetLine);
        indent = braceIndent + INDENT;
      }
    }
  }

  if (docText.trim().length === 0 && elementType !== "Package") {
    const pkgIndent = INDENT;
    const pkgSnippet = resolvedType
      ? `${pkgIndent}${options?.usageKind === "port" || options?.usageKind === "attribute" || options?.usageKind === "item" ? options.usageKind : "part"} ${elementName} : ${resolvedType};`
      : (() => {
          const g = template!(elementName, pkgIndent);
          return g.endsWith("\n") ? g.slice(0, -1) : g;
        })();
    const normImport = options?.importPath ? normalizeSysmlTypePath(options.importPath) : undefined;
    const pkgImport = normImport ? `${pkgIndent}import ${normImport};` : undefined;
    const pkgStub = options?.stubBlock ? indentBlockLines(options.stubBlock, pkgIndent) : undefined;
    const inner = [pkgImport, pkgStub, pkgSnippet].filter((c): c is string => Boolean(c)).join("\n");
    return [TextEdit.insert({ line: 0, character: 0 }, `package Model {\n${inner}\n}\n`)];
  }

  let snippet: string;
  if (resolvedType) {
    const kw = options?.usageKind ?? "part";
    const declKw = kw === "port" || kw === "attribute" || kw === "item" ? kw : "part";
    snippet = `${indent}${declKw} ${elementName} : ${resolvedType};`;
  } else {
    const generated = template!(elementName, indent);
    snippet = generated.endsWith("\n") ? generated.slice(0, -1) : generated;
  }

  const normalizedImport = options?.importPath ? normalizeSysmlTypePath(options.importPath) : undefined;
  const needsImport = Boolean(normalizedImport && !hasSysmlImport(docText, normalizedImport));
  const importStmt = needsImport ? `${indent}import ${normalizedImport};` : undefined;
  const stubText = options?.stubBlock ? indentBlockLines(options.stubBlock, indent) : undefined;

  const edits: TextEdit[] = [];
  const openBraceLine = findEnclosingOpenBraceLine(lines, Math.max(0, targetLine - 1));
  const targetLineText = lines[targetLine] ?? "";
  const closingSuffix = targetLine === lines.length && openBraceLine >= 0 ? "}\n" : "";

  if (
    openBraceLine === -1 &&
    targetLine < lines.length &&
    targetLineText.includes("{") &&
    targetLineText.includes("}")
  ) {
    // Single-line enclosing block like `package P { }`: insert inside `{ ... }`
    const braceCol = targetLineText.indexOf("{") + 1;
    const chunks = [importStmt, stubText, snippet].filter((c): c is string => Boolean(c));
    edits.push(TextEdit.insert({ line: targetLine, character: braceCol }, `\n${chunks.join("\n")}\n`));
    return edits;
  }

  if (importStmt && openBraceLine >= 0 && openBraceLine < targetLine) {
    const openText = lines[openBraceLine] ?? "";
    const braceIdx = openText.indexOf("{");
    if (braceIdx >= 0) {
      const trailing = openText.slice(braceIdx + 1);
      const insertText = trailing.trim().length === 0 ? `\n${importStmt}` : `\n${importStmt}\n${indent}`;
      edits.push(TextEdit.insert({ line: openBraceLine, character: braceIdx + 1 }, insertText));
    }
  } else if (importStmt) {
    // No separate enclosing header line — include import right before stub/snippet
    const chunks = [importStmt, stubText, snippet].filter((c): c is string => Boolean(c));
    edits.push(TextEdit.insert({ line: targetLine, character: 0 }, `${chunks.join("\n")}\n${closingSuffix}`));
    return edits;
  }

  const bodyChunks = [stubText, snippet].filter((c): c is string => Boolean(c));
  edits.push(TextEdit.insert({ line: targetLine, character: 0 }, `${bodyChunks.join("\n")}\n${closingSuffix}`));
  return edits;
}

// ── Delete element ──

/**
 * Delete a SysML2 element by finding its declaration in the source text.
 * Uses the parsed CST tree if provided, falling back to keyword line scanning.
 */
export function computeSysML2ElementDelete(
  docText: string,
  elementNames: string[],
  tree?: DiagramCstTree | null,
): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];
  const nameSet = new Set(elementNames);

  for (const name of nameSet) {
    if (tree?.rootNode) {
      const cstNode = findCstNodeByName(tree.rootNode, name);
      if (cstNode?.startPosition && cstNode?.endPosition) {
        const startLine = cstNode.startPosition.row;
        const endLine = cstNode.endPosition.row;
        if (endLine + 1 < lines.length) {
          edits.push(TextEdit.del(Range.create(startLine, 0, endLine + 1, 0)));
        } else {
          edits.push(TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0)));
        }
        continue;
      }
    }

    // Fallback: regex search
    const { startLine, endLine } = findElementRange(lines, name);
    if (startLine === -1) continue;

    if (endLine + 1 < lines.length) {
      edits.push(TextEdit.del(Range.create(startLine, 0, endLine + 1, 0)));
    } else {
      edits.push(TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0)));
    }
  }

  // Also delete connection usages that reference deleted elements
  if (tree?.rootNode) {
    for (const name of nameSet) {
      const conns = findCstConnectionNodes(tree.rootNode, name, "");
      for (const conn of conns) {
        if (conn.startPosition && conn.endPosition) {
          const cs = conn.startPosition.row;
          const ce = conn.endPosition.row;
          if (ce + 1 < lines.length) {
            edits.push(TextEdit.del(Range.create(cs, 0, ce + 1, 0)));
          } else {
            edits.push(TextEdit.del(Range.create(cs, 0, ce, lines[ce]?.length ?? 0)));
          }
        }
      }
    }
  } else {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.startsWith("connection") && line.includes("connect")) {
        for (const name of nameSet) {
          if (line.includes(name)) {
            const { startLine: cs, endLine: ce } = findStatementRange(lines, i);
            if (ce + 1 < lines.length) {
              edits.push(TextEdit.del(Range.create(cs, 0, ce + 1, 0)));
            } else {
              edits.push(TextEdit.del(Range.create(cs, 0, ce, lines[ce]?.length ?? 0)));
            }
            break;
          }
        }
      }
    }
  }

  return deduplicateAndSort(edits);
}

// ── Helper: find enclosing block's closing brace ──

function findEnclosingBlockBrace(lines: string[], elementName?: string, tree?: DiagramCstTree | null): number {
  if (tree?.rootNode) {
    const cstBlock = findCstEnclosingBlock(tree, elementName);
    if (cstBlock) return cstBlock.line;
  }

  if (elementName) {
    const docJoined = lines.join("\n");
    const docLeaves = collectCstLeaves(parseSysmlSource(docJoined));
    const foundLeaf = docLeaves.find((leaf) => leaf.text === elementName);
    const declLine = foundLeaf ? offsetToLineColumn(docJoined, foundLeaf.start).line : -1;
    if (declLine !== -1) {
      let depth = 0;
      for (let i = declLine; i < lines.length; i++) {
        const line = lines[i]!;
        for (const ch of line) {
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth < 0) {
              return i;
            }
          }
        }
      }
    }
  }

  // Fallback: search backwards for the last closing brace
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() === "}") {
      return i;
    }
  }
  return lines.length;
}

// ── Insert connection ──

/**
 * Insert a `connection` usage connecting two elements.
 * If the document contains state definitions/usages (state machine context),
 * inserts a `transition` usage instead.
 */
export function computeSysML2ConnectionInsert(
  docText: string,
  source: string,
  target: string,
  tree?: DiagramCstTree | null,
): TextEdit[] {
  // Context-aware connection detection: check if source/target elements are states or actions
  let isStateMachineContext = false;
  let isActivityContext = false;

  if (tree?.rootNode) {
    const srcNode = findCstNodeByName(tree.rootNode, source);
    const tgtNode = findCstNodeByName(tree.rootNode, target);
    const isState = (n: DiagramCstNode | null) =>
      Boolean(n && (n.type?.includes("State") || n.parent?.type?.includes("State")));
    const isAction = (n: DiagramCstNode | null) =>
      Boolean(n && (n.type?.includes("Action") || n.parent?.type?.includes("Action")));

    if (isState(srcNode) || isState(tgtNode)) {
      isStateMachineContext = true;
    } else if (isAction(srcNode) || isAction(tgtNode)) {
      isActivityContext = true;
    }
  } else {
    // CST leaf fallback: inspect source and target declarations
    const docLeaves = collectCstLeaves(parseSysmlSource(docText));
    const hasTypedDecl = (kindKw: "state" | "action", name: string) => {
      for (let i = 0; i + 1 < docLeaves.length; i++) {
        if (docLeaves[i]!.text !== kindKw) continue;
        const nameIdx = docLeaves[i + 1]!.text === "def" ? i + 2 : i + 1;
        if (docLeaves[nameIdx]?.text === name) return true;
      }
      return false;
    };

    if (hasTypedDecl("state", source) || hasTypedDecl("state", target)) {
      isStateMachineContext = true;
    } else if (hasTypedDecl("action", source) || hasTypedDecl("action", target)) {
      isActivityContext = true;
    }
  }

  if (isStateMachineContext) {
    return computeSysML2TransitionInsert(docText, source, target, tree);
  }
  if (isActivityContext) {
    return computeSysML2SuccessionInsert(docText, source, target, tree);
  }

  const lines = docText.split("\n");
  const targetLine = findEnclosingBlockBrace(lines, source, tree);

  const braceIndent = getIndentAt(lines, targetLine);
  const indent = braceIndent + INDENT;

  // Generate a connection name from source and target
  const connName = `${source}_to_${target}`;
  const snippet = `${indent}connection ${connName} : Connect\n${indent}${INDENT}connect ${source} to ${target};\n\n`;

  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
}

// ── Insert transition (state machine) ──

/**
 * Insert a `transition` usage connecting two states.
 * Generates: `transition first sourceState then targetState;`
 */
export function computeSysML2TransitionInsert(
  docText: string,
  source: string,
  target: string,
  tree?: DiagramCstTree | null,
): TextEdit[] {
  const lines = docText.split("\n");
  const targetLine = findEnclosingBlockBrace(lines, source, tree);

  const braceIndent = getIndentAt(lines, targetLine);
  const indent = braceIndent + INDENT;

  const snippet = `${indent}transition first ${source} then ${target};\n`;

  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
}

// ── Insert succession (activity diagram) ──

/**
 * Insert a `succession` usage connecting two actions in an activity diagram.
 * Generates: `first source then target;`
 */
export function computeSysML2SuccessionInsert(
  docText: string,
  source: string,
  target: string,
  tree?: DiagramCstTree | null,
): TextEdit[] {
  const lines = docText.split("\n");
  let targetLine = findEnclosingBlockBrace(lines, source, tree);

  if (targetLine === -1) targetLine = lines.length;

  const braceIndent = getIndentAt(lines, targetLine);
  const indent = braceIndent + INDENT;

  const snippet = `${indent}first ${source} then ${target};\n`;

  return [TextEdit.insert({ line: targetLine, character: 0 }, snippet)];
}

// ── Delete connection ──

/**
 * Delete a connection usage by finding matching `connect source to target` text.
 * Uses the parsed CST tree if available, falling back to line scanning.
 */
export function computeSysML2ConnectionDelete(
  docText: string,
  source: string,
  target: string,
  tree?: DiagramCstTree | null,
): TextEdit[] {
  const lines = docText.split("\n");
  const edits: TextEdit[] = [];

  if (tree?.rootNode) {
    const conns = findCstConnectionNodes(tree.rootNode, source, target);
    for (const conn of conns) {
      if (conn.startPosition && conn.endPosition) {
        const startLine = conn.startPosition.row;
        const endLine = conn.endPosition.row;
        if (endLine + 1 < lines.length) {
          edits.push(TextEdit.del(Range.create(startLine, 0, endLine + 1, 0)));
        } else {
          edits.push(TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0)));
        }
      }
    }
    if (edits.length > 0) {
      return deduplicateAndSort(edits);
    }
  }

  // Fallback: line scanning
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (
      line.includes("connect") &&
      ((line.includes(source) && line.includes(target)) || (line.includes(target) && line.includes(source)))
    ) {
      const { startLine, endLine } = findStatementRange(lines, i);
      if (endLine + 1 < lines.length) {
        edits.push(TextEdit.del(Range.create(startLine, 0, endLine + 1, 0)));
      } else {
        edits.push(TextEdit.del(Range.create(startLine, 0, endLine, lines[endLine]?.length ?? 0)));
      }
    }
  }

  return deduplicateAndSort(edits);
}

// ── Update Component Name ──

export function computeSysML2NameEdit(tree: unknown, docText: string, oldName: string, newName: string): TextEdit[] {
  const edits: TextEdit[] = [];

  function findName(node: DiagramCstNode) {
    if (
      (node.type === "Name" || node.type === "Identifier" || node.type?.includes("Identification")) &&
      node.text === oldName
    ) {
      if (
        (node.parent?.type?.includes("Usage") ||
          node.parent?.type?.includes("Def") ||
          node.parent?.type?.includes("Declaration")) &&
        node.startPosition &&
        node.endPosition
      ) {
        edits.push(
          TextEdit.replace(
            Range.create(
              node.startPosition.row,
              node.startPosition.column,
              node.endPosition.row,
              node.endPosition.column,
            ),
            newName,
          ),
        );
      }
    }
    for (let i = 0; i < (node.namedChildCount ?? 0); i++) {
      findName(node.namedChild(i));
    }
  }

  const cstTree = tree as DiagramCstTree | null | undefined;
  if (cstTree?.rootNode) {
    findName(cstTree.rootNode);
  }

  if (edits.length === 0) {
    // Fallback CST leaf replacement
    const leaves = collectCstLeaves(parseSysmlSource(docText));
    for (const leaf of leaves) {
      if (leaf.text !== oldName) continue;
      const startPos = offsetToLineColumn(docText, leaf.start);
      const endPos = offsetToLineColumn(docText, leaf.end);
      edits.push(
        TextEdit.replace(Range.create(startPos.line, startPos.character, endPos.line, endPos.character), newName),
      );
    }
  }

  return deduplicateAndSort(edits);
}

// ── Update Component Description ──

export function computeSysML2DescriptionEdit(
  tree: DiagramCstTree | null | undefined,
  docText: string,
  elementName: string,
  newDescription: string,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const lines = docText.split("\n");

  let startLine = -1;
  let endLine = -1;

  if (tree?.rootNode) {
    const cstNode = findCstNodeByName(tree.rootNode, elementName);
    if (cstNode?.startPosition && cstNode?.endPosition) {
      startLine = cstNode.startPosition.row;
      endLine = cstNode.endPosition.row;
    }
  }

  if (startLine === -1) {
    const range = findElementRange(lines, elementName);
    startLine = range.startLine;
    endLine = range.endLine;
  }

  if (startLine === -1) return [];

  const escapedDesc = newDescription.replaceAll("*/", "* /");
  const docString = `doc /* ${escapedDesc} */`;

  // Check if there is an existing doc inside the element body
  for (let i = startLine; i <= endLine; i++) {
    const trimLine = lines[i]!.trimStart();
    if (
      lines[i]!.includes("doc /*") ||
      (trimLine.startsWith("doc") && trimLine.length > 3 && (trimLine[3] === " " || trimLine[3] === "\t"))
    ) {
      const docStart = lines[i]!.indexOf("doc");
      const docEndIdx = lines[i]!.indexOf("*/");
      if (docEndIdx !== -1) {
        edits.push(TextEdit.replace(Range.create(i, docStart, i, docEndIdx + 2), docString));
        return edits;
      }
    }
  }

  // If no existing doc, if it's a block with `{`, insert after `{`
  const declLine = lines[startLine]!;
  if (declLine.includes("{")) {
    const braceCol = declLine.indexOf("{");
    edits.push(
      TextEdit.insert(
        { line: startLine, character: braceCol + 1 },
        `\n${getIndentAt(lines, startLine)}${INDENT}${docString}`,
      ),
    );
  } else {
    const semiCol = declLine.indexOf(";");
    if (semiCol !== -1) {
      edits.push(TextEdit.replace(Range.create(startLine, semiCol, startLine, semiCol + 1), ` { ${docString} }`));
    }
  }

  return edits;
}

// ── Update Component Parameter ──

export function computeSysML2ParameterEdit(
  _tree: unknown,
  docText: string,
  elementName: string,
  parameterName: string,
  newValue: string,
): TextEdit[] {
  const edits: TextEdit[] = [];
  const lines = docText.split("\n");
  const { startLine, endLine } = findElementRange(lines, elementName);
  if (startLine === -1) return [];

  let paramLineIdx = -1;
  const leaves = collectCstLeaves(parseSysmlSource(docText));
  let rangeStartOffset = 0;
  for (let i = 0; i < startLine; i++) rangeStartOffset += lines[i]!.length + 1;
  let rangeEndOffset = rangeStartOffset;
  for (let i = startLine; i <= endLine && i < lines.length; i++) rangeEndOffset += lines[i]!.length + 1;
  const rangeLeaves = sliceLeavesInRange(leaves, rangeStartOffset, rangeEndOffset);

  // A common syntax for redefinition in usages is `:>> param = value;`
  for (let k = 0; k + 2 < rangeLeaves.length; k++) {
    if (
      rangeLeaves[k]!.text === ":>>" &&
      rangeLeaves[k + 1]!.text === parameterName &&
      rangeLeaves[k + 2]!.text === "="
    ) {
      paramLineIdx = offsetToLineColumn(docText, rangeLeaves[k]!.start).line;
      let semi = k + 3;
      while (semi < rangeLeaves.length && rangeLeaves[semi]!.text !== ";") {
        semi++;
      }
      if (semi < rangeLeaves.length && semi > k + 3) {
        const startPos = offsetToLineColumn(docText, rangeLeaves[k + 2]!.end);
        const endPos = offsetToLineColumn(docText, rangeLeaves[semi]!.start);
        edits.push(
          TextEdit.replace(
            Range.create(startPos.line, startPos.character, endPos.line, endPos.character),
            ` ${newValue}`,
          ),
        );
        return edits;
      }
    } else if (rangeLeaves[k]!.text === parameterName && rangeLeaves[k + 1]!.text === "=") {
      paramLineIdx = offsetToLineColumn(docText, rangeLeaves[k]!.start).line;
    }
  }

  // Insert if missing
  if (paramLineIdx === -1) {
    const declLine = lines[startLine]!;
    const paramStr = `:>> ${parameterName} = ${newValue};`;
    if (declLine.includes("{")) {
      const braceCol = declLine.indexOf("{");
      edits.push(
        TextEdit.insert(
          { line: startLine, character: braceCol + 1 },
          `\n${getIndentAt(lines, startLine)}${INDENT}${paramStr}`,
        ),
      );
    } else {
      const semiCol = declLine.indexOf(";");
      if (semiCol !== -1) {
        edits.push(TextEdit.replace(Range.create(startLine, semiCol, startLine, semiCol + 1), ` { ${paramStr} }`));
      }
    }
  }

  return edits;
}

// ── Unique name generation ──

/**
 * Generate a unique name for a new element by appending an incrementing suffix.
 */
export function generateUniqueName(docText: string, baseName: string): string {
  let suffix = 1;
  let candidate = baseName;
  while (docText.includes(candidate)) {
    candidate = `${baseName}${suffix}`;
    suffix++;
  }
  return candidate;
}

// ── Helpers ──

/**
 * Find the line range of an element declaration by searching for its name.
 */
function findElementRange(lines: string[], name: string): { startLine: number; endLine: number } {
  // SysML2 keywords that precede element names
  const keywords = [
    "part def",
    "part",
    "attribute def",
    "attribute",
    "port def",
    "port",
    "action def",
    "action",
    "state def",
    "state",
    "calc def",
    "calc",
    "requirement def",
    "requirement",
    "constraint def",
    "constraint",
    "use case def",
    "use case",
    "verification def",
    "verification",
    "analysis case def",
    "analysis case",
    "case def",
    "case",
    "connection def",
    "connection",
    "interface def",
    "interface",
    "allocation def",
    "allocation",
    "flow def",
    "flow",
    "item def",
    "item",
    "enum def",
    "concern def",
    "concern",
    "view def",
    "view",
    "viewpoint def",
    "viewpoint",
    "rendering def",
    "rendering",
    "occurrence def",
    "package",
  ];

  const docText = lines.join("\n");
  const leaves = collectCstLeaves(parseSysmlSource(docText));
  const keywordTuples = keywords.map((kw) => kw.split(" "));

  for (let i = 0; i < leaves.length; i++) {
    for (const kwParts of keywordTuples) {
      if (i + kwParts.length + 1 >= leaves.length) continue;
      let matched = true;
      for (let k = 0; k < kwParts.length; k++) {
        if (leaves[i + k]!.text !== kwParts[k]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      if (leaves[i + kwParts.length]!.text !== name) continue;
      const delimTok = leaves[i + kwParts.length + 1]!.text;
      if (delimTok !== "{" && delimTok !== ";") continue;

      const startLine = offsetToLineColumn(docText, leaves[i]!.start).line;
      if (delimTok === ";") {
        return { startLine, endLine: startLine };
      }
      const endLine = findMatchingBrace(lines, startLine);
      return { startLine, endLine };
    }
  }

  return { startLine: -1, endLine: -1 };
}

const STATEMENT_PREFIX_MODIFIERS = new Set([
  "public",
  "private",
  "protected",
  "abstract",
  "readonly",
  "derived",
  "constant",
  "ref",
  "in",
  "out",
  "inout",
  "doc",
]);

const STATEMENT_DECL_KEYWORDS = new Set([
  "part",
  "attribute",
  "port",
  "action",
  "state",
  "calc",
  "requirement",
  "constraint",
  "case",
  "connection",
  "interface",
  "allocation",
  "flow",
  "item",
  "enum",
  "concern",
  "view",
  "viewpoint",
  "rendering",
  "occurrence",
  "package",
  "import",
  "verification",
]);

function startsWithSysmlDeclHeader(trimmedLine: string): boolean {
  if (!trimmedLine) return false;
  const leaves = collectCstLeaves(parseSysmlSource(trimmedLine));
  let idx = 0;
  while (idx < leaves.length && STATEMENT_PREFIX_MODIFIERS.has(leaves[idx]!.text)) {
    idx++;
  }
  if (idx >= leaves.length) return false;
  const tok = leaves[idx]!.text;
  if (STATEMENT_DECL_KEYWORDS.has(tok)) return true;
  if (tok === "use" && leaves[idx + 1]?.text === "case") return true;
  if (tok === "analysis" && leaves[idx + 1]?.text === "case") return true;
  return false;
}

/**
 * Find the statement range starting at a given line (handles multi-line statements).
 */
function findStatementRange(lines: string[], startLine: number): { startLine: number; endLine: number } {
  let endLine = startLine;
  let line = lines[startLine]!.trim();
  while (startLine > 0 && !startsWithSysmlDeclHeader(line)) {
    startLine--;
    line = lines[startLine]!.trim();
  }

  // Walk forward to find the statement end (`;` or matching `}`)
  if (lines[endLine]?.trim().includes("{")) {
    endLine = findMatchingBrace(lines, endLine);
  } else {
    while (endLine < lines.length - 1 && !lines[endLine]!.trim().endsWith(";")) {
      endLine++;
    }
  }

  return { startLine, endLine };
}

/**
 * Find the line with the matching closing brace for an opening brace on the given line.
 * Accurately tracks nested strings and line/block comments to ignore braces inside comments or literals.
 */
function findMatchingBrace(lines: string[], startLine: number): number {
  let depth = 0;
  let inString = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]!;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c]!;
      const next = c + 1 < line.length ? line[c + 1]! : "";

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          c++;
        }
        continue;
      }

      if (ch === "/" && next === "/") {
        break; // line comment, skip rest of line
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        c++;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return startLine; // fallback
}

/**
 * Get the indentation string at a given line.
 */
function getIndentAt(lines: string[], line: number): string {
  if (line < 0 || line >= lines.length) return INDENT;
  const text = lines[line]!;
  let k = 0;
  while (k < text.length && (text[k] === " " || text[k] === "\t")) {
    k++;
  }
  return text.slice(0, k);
}

/**
 * Sort edits by position and remove overlapping edits.
 */
function deduplicateAndSort(edits: TextEdit[]): TextEdit[] {
  edits.sort((a, b) => {
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
    return a.range.start.character - b.range.start.character;
  });

  return edits.filter((edit, i) => {
    if (i === 0) return true;
    const prev = edits[i - 1]!;
    return !(
      edit.range.start.line < prev.range.end.line ||
      (edit.range.start.line === prev.range.end.line && edit.range.start.character < prev.range.end.character)
    );
  });
}

/**
 * Plans SysML v2 diagram actions directly against a live {@link CstDocumentSession},
 * coalescing all resulting edits atomically through {@link CstTransaction}.
 * Usable both inside the Dedicated CST Edit Worker (zero-LSP roundtrip) and the LSP backend.
 */
export function planSysml2EditsOnSession(
  session: CstDocumentSession,
  actions: ReadonlyArray<{
    type: string;
    source?: string | undefined;
    target?: string | undefined;
    edgeType?: string | undefined;
    oldSource?: string | undefined;
    oldTarget?: string | undefined;
    newSource?: string | undefined;
    newTarget?: string | undefined;
    names?: string[] | undefined;
    oldName?: string | undefined;
    newName?: string | undefined;
    name?: string | undefined;
    description?: string | undefined;
    parameter?: string | undefined;
    key?: string | undefined;
    value?: unknown;
    className?: string | undefined;
  }>,
): { edits: CstTextEdit[]; hasStructural: boolean } {
  const docText = session.text;
  const tree = session.tree as DiagramCstTree | null;
  const tx = new CstTransaction(session);
  let hasStructural = false;

  const pushEdits = (rawEdits: TextEdit[]) => {
    for (const e of rawEdits) {
      const startOff = session.positionToOffset(e.range.start);
      const endOff = session.positionToOffset(e.range.end);
      tx.replaceRange(startOff, endOff, e.newText);
    }
  };

  for (const act of actions) {
    if (act.type === "connect" && act.source && act.target) {
      const edgeType = act.edgeType ?? "connection";
      if (edgeType === "transition") {
        pushEdits(computeSysML2TransitionInsert(docText, act.source, act.target, tree));
      } else if (edgeType === "succession") {
        pushEdits(computeSysML2SuccessionInsert(docText, act.source, act.target, tree));
      } else {
        pushEdits(computeSysML2ConnectionInsert(docText, act.source, act.target, tree));
      }
      hasStructural = true;
    } else if (act.type === "disconnect" && act.source && act.target) {
      pushEdits(computeSysML2ConnectionDelete(docText, act.source, act.target, tree));
      hasStructural = true;
    } else if (act.type === "reconnect" && act.oldSource && act.oldTarget && act.newSource && act.newTarget) {
      pushEdits(computeSysML2ConnectionDelete(docText, act.oldSource, act.oldTarget, tree));
      pushEdits(computeSysML2ConnectionInsert(docText, act.newSource, act.newTarget, tree));
      hasStructural = true;
    } else if (act.type === "deleteComponents" && Array.isArray(act.names)) {
      pushEdits(computeSysML2ElementDelete(docText, act.names, tree));
      hasStructural = true;
    } else if (act.type === "updateName" && act.oldName && act.newName) {
      pushEdits(computeSysML2NameEdit(tree, docText, act.oldName, act.newName));
      hasStructural = true;
    } else if (act.type === "updateDescription" && act.name && typeof act.description === "string") {
      pushEdits(computeSysML2DescriptionEdit(tree, docText, act.name, act.description));
    } else if (act.type === "updateParameter" && act.name && act.parameter) {
      pushEdits(computeSysML2ParameterEdit(tree, docText, act.name, act.parameter, String(act.value ?? "")));
    } else if (act.type === "updateProperty" && act.name && act.key) {
      pushEdits(computeSysML2ParameterEdit(tree, docText, act.name, act.key, String(act.value ?? "")));
    } else if (act.type === "addComponent" && act.className) {
      if (ELEMENT_TEMPLATES[act.className]) {
        const uniqueName =
          act.name ||
          generateUniqueName(docText, act.className.replace(/Definition|Usage/g, "").toLowerCase() || "part");
        pushEdits(computeSysML2ElementInsert(docText, act.className, uniqueName, undefined, tree));
        hasStructural = true;
      }
    }
  }

  return { edits: tx.commit().edits, hasStructural };
}
