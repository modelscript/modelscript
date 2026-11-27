// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  CompletionItem,
  CompletionItemKind,
  Hover,
  Location,
  MarkupKind,
  Position,
  Range,
} from "vscode-languageserver";
import type { SyntaxNode, Tree } from "../utils/cst-facade.js";

const IDENT_TEXT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const QUOTED_KEYWORD_RE = /^"[a-zA-Z_][a-zA-Z0-9_-]*"$/;

const IDENT_TYPE_RE = /(?:ident|name|id$|_id$|symbol|label|word|ref$)/i;

const DECL_NODE_INCLUDE_RE =
  /(?:def|definition|decl|declaration|module|package|function|component|subckt|block|class|model|part|port|attribute|action|state|requirement|interface|entity|architecture|process|struct|enum|type|signal|param|var|usage|item|device|element|rule|section|macro|procedure|subroutine|task|circuit|cell|instance)/i;

const DECL_NODE_EXCLUDE_RE =
  /(?:reference|call|expr|expression|literal|comment|string|list|body|root|file|source|program|statements|document|compilation|translation)/i;

const NAME_WRAPPER_RE = /(?:identification|name|declarator|header|signature|specifier|id$)/i;

const MAX_CST_WALK_NODES = 60_000;

function isCommentOrStringNode(node: SyntaxNode): boolean {
  const t = (node.type ?? "").toLowerCase();
  return t.includes("comment") || t.includes("string") || t === "documentation" || t === "doc_comment";
}

function getChildren(node: SyntaxNode): SyntaxNode[] {
  if (Array.isArray(node.children)) return node.children;
  const out: SyntaxNode[] = [];
  const count = typeof node.childCount === "number" ? node.childCount : 0;
  for (let i = 0; i < count; i++) {
    const ch = node.child?.(i);
    if (ch) out.push(ch);
  }
  return out;
}

function nodeToLspRange(node: SyntaxNode): Range {
  const start = node.startPosition ?? { row: 0, column: 0 };
  const end = node.endPosition ?? start;
  return {
    start: { line: start.row, character: start.column },
    end: { line: end.row, character: end.column },
  };
}

function positionInNode(node: SyntaxNode, pos: Position): boolean {
  const s = node.startPosition;
  const e = node.endPosition;
  if (!s || !e) return false;
  if (pos.line < s.row || pos.line > e.row) return false;
  if (pos.line === s.row && pos.character < s.column) return false;
  if (pos.line === e.row && pos.character > e.column) return false;
  return true;
}

function findDeepestNodeManual(node: SyntaxNode, pos: Position): SyntaxNode | null {
  if (!positionInNode(node, pos)) return null;
  const children = getChildren(node);
  for (const child of children) {
    if (positionInNode(child, pos)) {
      return findDeepestNodeManual(child, pos) ?? child;
    }
  }
  return node;
}

function findNodeAtPoint(root: SyntaxNode, pos: Position): SyntaxNode | null {
  if (typeof root.descendantForPosition === "function") {
    try {
      const hit = root.descendantForPosition({ row: pos.line, column: pos.character });
      if (hit) return hit;
    } catch {
      // Fall through to manual walk
    }
  }
  return findDeepestNodeManual(root, pos);
}

function isIdentifierNode(node: SyntaxNode | null | undefined): boolean {
  if (!node || isCommentOrStringNode(node)) return false;
  const text = (node.text ?? "").trim();
  if (!text || !IDENT_TEXT_RE.test(text)) return false;

  const type = node.type ?? "";
  // Anonymous keyword tokens (e.g. type === "part", text === "part", isNamed === false) are keywords, not identifiers
  if (node.isNamed === false && type === text) {
    return false;
  }

  if (IDENT_TYPE_RE.test(type)) {
    return true;
  }

  const children = getChildren(node);
  return children.length === 0 && node.isNamed !== false;
}

function resolveIdentifierNodeAtPosition(root: SyntaxNode, position: Position): SyntaxNode | null {
  const candidates: Position[] = [position];
  if (position.character > 0) {
    candidates.push({ line: position.line, character: position.character - 1 });
  }

  for (const pos of candidates) {
    let node = findNodeAtPoint(root, pos);
    if (!node) continue;
    if (isIdentifierNode(node)) return node;
    // Promote anonymous inner token to named identifier parent when they share exact text
    if (node.parent && isIdentifierNode(node.parent) && (node.parent.text ?? "").trim() === (node.text ?? "").trim()) {
      return node.parent;
    }
  }
  return null;
}

function isDeclarationNode(node: SyntaxNode, root: SyntaxNode): boolean {
  if (node === root) return false;
  if (node.isNamed === false) return false;
  if (isCommentOrStringNode(node)) return false;
  const type = node.type ?? "";
  if (!type) return false;
  return DECL_NODE_INCLUDE_RE.test(type) && !DECL_NODE_EXCLUDE_RE.test(type);
}

function findFirstIdentifierInSubtree(node: SyntaxNode, maxDepth: number): SyntaxNode | null {
  if (maxDepth < 0 || isCommentOrStringNode(node)) return null;
  if (isIdentifierNode(node)) return node;
  for (const child of getChildren(node)) {
    const found = findFirstIdentifierInSubtree(child, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

function extractDeclarationNameNode(declNode: SyntaxNode, root: SyntaxNode): SyntaxNode | null {
  if (typeof declNode.childForFieldName === "function") {
    const byName = declNode.childForFieldName("name") ?? declNode.childForFieldName("id");
    if (byName) {
      if (isIdentifierNode(byName)) return byName;
      const inner = findFirstIdentifierInSubtree(byName, 3);
      if (inner) return inner;
    }
  }

  if (!isDeclarationNode(declNode, root)) return null;

  for (const child of getChildren(declNode)) {
    if (isCommentOrStringNode(child)) continue;
    if (isIdentifierNode(child)) return child;
    if (child.isNamed !== false && NAME_WRAPPER_RE.test(child.type ?? "")) {
      const inner = findFirstIdentifierInSubtree(child, 3);
      if (inner) return inner;
    }
  }
  return null;
}

interface DeclarationMatch {
  declNode: SyntaxNode;
  nameNode: SyntaxNode;
  name: string;
}

function collectDeclarations(root: SyntaxNode): DeclarationMatch[] {
  const results: DeclarationMatch[] = [];
  const seenDeclStarts = new Set<string>();
  let visited = 0;

  const walk = (node: SyntaxNode) => {
    if (++visited > MAX_CST_WALK_NODES) return;
    if (isCommentOrStringNode(node)) return;

    const nameNode = extractDeclarationNameNode(node, root);
    if (nameNode) {
      const name = (nameNode.text ?? "").trim();
      if (name && IDENT_TEXT_RE.test(name)) {
        const key = `${name}@${nameNode.startPosition?.row ?? 0}:${nameNode.startPosition?.column ?? 0}`;
        if (!seenDeclStarts.has(key)) {
          seenDeclStarts.add(key);
          results.push({ declNode: node, nameNode, name });
        }
      }
    }

    for (const child of getChildren(node)) {
      walk(child);
    }
  };

  walk(root);
  return results;
}

function findEnclosingDeclaration(node: SyntaxNode, root: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent;
  while (cur && cur !== root) {
    if (isDeclarationNode(cur, root)) return cur;
    cur = cur.parent;
  }
  return null;
}

function buildSnippet(node: SyntaxNode, text: string): string {
  let raw = node.text ?? "";
  if (!raw && typeof node.startIndex === "number" && typeof node.endIndex === "number") {
    raw = text.slice(node.startIndex, node.endIndex);
  }
  const lines = raw
    .trim()
    .split(/\r?\n/)
    .slice(0, 3)
    .map((l) => l.trimEnd());
  let snippet = lines.join("\n");
  if (snippet.length > 200) {
    snippet = `${snippet.slice(0, 197)}...`;
  }
  return snippet;
}

function humanizeNodeKind(nodeType: string): string {
  return nodeType
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function inferCompletionKind(declType: string): CompletionItemKind {
  const t = declType.toLowerCase();
  if (
    t.includes("func") ||
    t.includes("proc") ||
    t.includes("subroutine") ||
    t.includes("action") ||
    t.includes("task")
  ) {
    return CompletionItemKind.Function;
  }
  if (t.includes("module") || t.includes("package") || t.includes("namespace")) {
    return CompletionItemKind.Module;
  }
  if (t.includes("interface") || t.includes("port")) {
    return CompletionItemKind.Interface;
  }
  if (t.includes("enum")) {
    return CompletionItemKind.Enum;
  }
  if (t.includes("struct") || t.includes("record")) {
    return CompletionItemKind.Struct;
  }
  if (t.includes("param") || t.includes("const")) {
    return CompletionItemKind.Constant;
  }
  if (
    t.includes("class") ||
    t.includes("model") ||
    t.includes("part") ||
    t.includes("block") ||
    t.includes("subckt") ||
    t.includes("component") ||
    t.includes("entity") ||
    t.includes("type")
  ) {
    return CompletionItemKind.Class;
  }
  return CompletionItemKind.Variable;
}

function isSameSpan(a: SyntaxNode, b: SyntaxNode): boolean {
  return (
    a.startPosition?.row === b.startPosition?.row &&
    a.startPosition?.column === b.startPosition?.column &&
    a.endPosition?.row === b.endPosition?.row &&
    a.endPosition?.column === b.endPosition?.column
  );
}

/**
 * Pure CST-based hover fallback for any WASM-backed language.
 */
export function getWasmCstHover(tree: Tree, text: string, position: Position, langName?: string): Hover | null {
  const root = tree?.rootNode;
  if (!root) return null;

  const identNode = resolveIdentifierNodeAtPosition(root, position);
  const targetNode = identNode ?? findNodeAtPoint(root, position);
  if (!targetNode || targetNode === root || isCommentOrStringNode(targetNode)) return null;

  const trimmed = (targetNode.text ?? "").trim();
  if (!trimmed) return null;

  const fenceLang = langName ? langName.toLowerCase().replace(/[^a-z0-9_-]/g, "") : "";
  const langBadge = langName ? ` *(${langName})*` : "";

  if (identNode) {
    const decls = collectDeclarations(root);
    const matchingDecl = decls.find((d) => d.name === trimmed);
    if (matchingDecl) {
      const kindLabel = humanizeNodeKind(matchingDecl.declNode.type || "symbol");
      const snippet = buildSnippet(matchingDecl.declNode, text);
      const md = [
        `**${kindLabel}** \`${trimmed}\`${langBadge}`,
        snippet ? `\n\`\`\`${fenceLang}\n${snippet}\n\`\`\`` : "",
      ]
        .filter(Boolean)
        .join("\n");
      return {
        contents: { kind: MarkupKind.Markdown, value: md },
        range: nodeToLspRange(identNode),
      };
    }

    const enclosing = findEnclosingDeclaration(identNode, root);
    const kindLabel = humanizeNodeKind(enclosing?.type || identNode.type || "identifier");
    const snippet = buildSnippet(enclosing ?? identNode, text);
    const md = [
      `**${kindLabel}** \`${trimmed}\`${langBadge}`,
      snippet ? `\n\`\`\`${fenceLang}\n${snippet}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return {
      contents: { kind: MarkupKind.Markdown, value: md },
      range: nodeToLspRange(identNode),
    };
  }

  // Non-identifier token: only hover if it's a named node or has an enclosing declaration
  const enclosing = findEnclosingDeclaration(targetNode, root);
  if (targetNode.isNamed === false && !enclosing) return null;

  const displayNode = targetNode.isNamed !== false ? targetNode : (enclosing ?? targetNode);
  const kindLabel = humanizeNodeKind(displayNode.type || "node");
  const snippet = buildSnippet(displayNode, text);
  if (!snippet) return null;

  const md = `**${kindLabel}**${langBadge}\n\n\`\`\`${fenceLang}\n${snippet}\n\`\`\``;
  return {
    contents: { kind: MarkupKind.Markdown, value: md },
    range: nodeToLspRange(targetNode),
  };
}

/**
 * Pure CST-based go-to-definition fallback for any WASM-backed language.
 */
export function getWasmCstDefinition(tree: Tree, uri: string, position: Position): Location | null {
  const root = tree?.rootNode;
  if (!root) return null;

  const identNode = resolveIdentifierNodeAtPosition(root, position);
  if (!identNode) return null;

  const targetName = (identNode.text ?? "").trim();
  if (!targetName) return null;

  const decls = collectDeclarations(root).filter((d) => d.name === targetName);
  if (decls.length === 0) return null;

  const preferred = decls.find((d) => !isSameSpan(d.nameNode, identNode)) ?? decls[0]!;
  return {
    uri,
    range: nodeToLspRange(preferred.nameNode),
  };
}

/**
 * Pure CST-based find-references fallback for any WASM-backed language.
 */
export function getWasmCstReferences(tree: Tree, uri: string, position: Position): Location[] {
  const root = tree?.rootNode;
  if (!root) return [];

  const identNode = resolveIdentifierNodeAtPosition(root, position);
  if (!identNode) return [];

  const targetName = (identNode.text ?? "").trim();
  if (!targetName) return [];

  const locations: Location[] = [];
  const seen = new Set<string>();
  let visited = 0;

  const walk = (node: SyntaxNode) => {
    if (++visited > MAX_CST_WALK_NODES) return;
    if (isCommentOrStringNode(node)) return;

    if (isIdentifierNode(node) && (node.text ?? "").trim() === targetName) {
      const range = nodeToLspRange(node);
      const key = `${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
      if (!seen.has(key)) {
        seen.add(key);
        locations.push({ uri, range });
      }
      return;
    }

    for (const child of getChildren(node)) {
      walk(child);
    }
  };

  walk(root);
  return locations;
}

/**
 * Pure CST-based completion fallback combining declared CST symbols and quoted grammar keywords.
 */
export function getWasmCstCompletions(
  tree: Tree | null | undefined,
  syntaxNames?: readonly string[],
): CompletionItem[] {
  const items: CompletionItem[] = [];
  const seen = new Set<string>();

  if (tree?.rootNode) {
    const decls = collectDeclarations(tree.rootNode);
    for (const decl of decls) {
      if (seen.has(decl.name)) continue;
      seen.add(decl.name);
      items.push({
        label: decl.name,
        kind: inferCompletionKind(decl.declNode.type ?? ""),
        detail: humanizeNodeKind(decl.declNode.type ?? "symbol"),
      });
    }
  }

  if (syntaxNames && syntaxNames.length > 0) {
    for (const raw of syntaxNames) {
      if (!QUOTED_KEYWORD_RE.test(raw)) continue;
      const kw = raw.slice(1, -1);
      if (seen.has(kw)) continue;
      seen.add(kw);
      items.push({
        label: kw,
        kind: CompletionItemKind.Keyword,
        detail: "keyword",
      });
    }
  }

  return items;
}
