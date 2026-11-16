// SPDX-License-Identifier: AGPL-3.0-or-later

import { xml } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "./wasm_workspace.js";

/**
 * Supported inputs for multi-file workspace linters:
 * - A `UnifiedWorkspace` instance
 * - A `Map<uri, text>`
 * - A plain `Record<uri, text>`
 */
export type WorkspaceDocumentInput = UnifiedWorkspace | ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export interface WorkspaceLintDiagnostic {
  uri: string;
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  range?:
    | {
        startLine: number;
        startColumn: number;
        endLine: number;
        endColumn: number;
        startOffset?: number | undefined;
        endOffset?: number | undefined;
      }
    | undefined;
}

/**
 * Normalizes a `UnifiedWorkspace`, `Map<string, string>`, or `Record<string, string>`
 * into an ordered `Map<string, string>` of `uri -> sourceText`.
 */
export function collectWorkspaceDocuments(input: WorkspaceDocumentInput): Map<string, string> {
  const docs = new Map<string, string>();
  if (input instanceof Map) {
    for (const [uri, text] of input.entries()) {
      docs.set(uri, text);
    }
    return docs;
  }
  const maybeUnified = input as Partial<UnifiedWorkspace> & {
    getDocumentUris?: () => string[];
    getDocumentText?: (uri: string) => string | undefined;
    documents?: Map<string, { text?: string }>;
  };
  if (typeof maybeUnified.getDocumentUris === "function" && typeof maybeUnified.getDocumentText === "function") {
    for (const uri of maybeUnified.getDocumentUris()) {
      const text = maybeUnified.getDocumentText(uri);
      if (typeof text === "string") docs.set(uri, text);
    }
    return docs;
  }
  if (maybeUnified.documents instanceof Map) {
    for (const [uri, rec] of maybeUnified.documents.entries()) {
      if (typeof rec?.text === "string") docs.set(uri, rec.text);
    }
    return docs;
  }
  for (const [uri, text] of Object.entries(input as Record<string, string>)) {
    if (typeof text === "string") docs.set(uri, text);
  }
  return docs;
}

/**
 * Resolves a relative include/import path against a source document URI
 * and finds a matching key in `docs` (supporting exact, normalized POSIX, or basename fallback).
 */
export function resolveRelativeUri(
  fromUri: string,
  relPath: string,
  docs: ReadonlyMap<string, string>,
): string | undefined {
  const cleanRel = relPath
    .trim()
    .replace(/^["'<]+|["'>]+$/g, "")
    .replace(/\\/g, "/");
  if (!cleanRel) return undefined;
  if (docs.has(cleanRel)) return cleanRel;

  const normalizedFrom = fromUri.replace(/\\/g, "/");
  const slashIdx = normalizedFrom.lastIndexOf("/");
  const baseDir = slashIdx >= 0 ? normalizedFrom.slice(0, slashIdx + 1) : "";

  const joined = `${baseDir}${cleanRel}`;
  const parts: string[] = [];
  for (const seg of joined.split("/")) {
    if (seg === "" || seg === ".") {
      if (parts.length === 0 && joined.startsWith("/")) parts.push("");
      continue;
    }
    if (seg === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "") parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const normalizedJoined = parts.join("/");
  if (docs.has(normalizedJoined)) return normalizedJoined;

  // Try matching by suffix or basename when URIs use file:// or virtual roots
  const targetSuffix = cleanRel.replace(/^\.\//, "");
  for (const candidate of docs.keys()) {
    const normCand = candidate.replace(/\\/g, "/");
    if (normCand === normalizedJoined || normCand.endsWith(`/${targetSuffix}`) || normCand === targetSuffix) {
      return candidate;
    }
  }
  const baseName = targetSuffix.split("/").pop();
  if (baseName) {
    for (const candidate of docs.keys()) {
      if (candidate.replace(/\\/g, "/").split("/").pop() === baseName) {
        return candidate;
      }
    }
  }
  return undefined;
}

/**
 * Detects if following include/import edges from `startUri` reaches a cycle.
 * Returns the cycle path `[start, ..., repeated]` if found, or `null`.
 */
export function findIncludeCycle(edges: ReadonlyMap<string, readonly string[]>, startUri: string): string[] | null {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();

  function dfs(u: string): string[] | null {
    if (onStack.has(u)) {
      const idx = stack.indexOf(u);
      return [...stack.slice(idx), u];
    }
    if (visited.has(u)) return null;
    visited.add(u);
    onStack.add(u);
    stack.push(u);
    for (const next of edges.get(u) ?? []) {
      const cyc = dfs(next);
      if (cyc) return cyc;
    }
    stack.pop();
    onStack.delete(u);
    return null;
  }

  return dfs(startUri);
}

/** Minimal structural interface matching WASM GLR parser `SyntaxNode`s. */
export interface CstNodeLike {
  type: string;
  text: string;
  namedChildren?: readonly CstNodeLike[] | undefined;
  children?: readonly CstNodeLike[] | undefined;
  startPosition?: { row: number; column: number } | undefined;
  startIndex?: number | undefined;
  endIndex?: number | undefined;
}

/**
 * Traverses a WASM CST iteratively and returns all nodes whose `type` is in `targetTypes`.
 */
export function collectCstNodes(root: CstNodeLike | null | undefined, targetTypes: readonly string[]): CstNodeLike[] {
  if (!root) return [];
  const wanted = new Set(targetTypes);
  const out: CstNodeLike[] = [];
  const stack: CstNodeLike[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (wanted.has(node.type)) out.push(node);
    const kids = node.namedChildren ?? node.children ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push(kids[i]!);
    }
  }
  return out;
}

/**
 * Extracts `{ tagName, attrs, node }` records from an XML WASM CST (`xmlRules` or `Element`/`Attribute`).
 */
export function extractXmlTagAttributesFromCst(
  root: CstNodeLike | null | undefined,
): Array<{ tagName: string; attrs: Record<string, string>; node: CstNodeLike }> {
  const tags = collectCstNodes(root, ["XmlSelfClosingTag", "XmlOpenTag", "Element"]);
  const results: Array<{ tagName: string; attrs: Record<string, string>; node: CstNodeLike }> = [];
  for (const tag of tags) {
    const kids = tag.namedChildren ?? tag.children ?? [];
    const nameNode = kids.find((k) => k.type === "XmlName" || k.type === "TagIdentifier");
    const tagName = nameNode?.text ?? "";
    const attrs: Record<string, string> = {};
    for (const attr of kids) {
      if (attr.type !== "XmlAttribute" && attr.type !== "Attribute") continue;
      const akids = attr.namedChildren ?? attr.children ?? [];
      const kNode = akids.find((k) => k.type === "XmlName" || k.type === "AttrIdentifier");
      const vNode = akids.find((k) => k.type === "XmlAttrValue" || k.type === "StringLiteral");
      if (kNode && vNode) {
        attrs[kNode.text] = vNode.text.replace(/^["']|["']$/g, "");
      }
    }
    results.push({ tagName, attrs, node: tag });
  }
  return results;
}

/**
 * Returns all leaf (token) nodes in a WASM CST in source order.
 */
export function extractCstLeafNodes(root: CstNodeLike | null | undefined): CstNodeLike[] {
  if (!root) return [];
  const out: CstNodeLike[] = [];
  const stack: CstNodeLike[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const kids = node.namedChildren ?? node.children ?? [];
    if (kids.length === 0) {
      out.push(node);
    } else {
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push(kids[i]!);
      }
    }
  }
  return out;
}

/**
 * Parses `xmlText` using `@modelscript/dsl`'s compiled XML WASM GLR parser and
 * returns all elements with `{ tagName, attrs, text }`.
 */
export interface XmlElementWithSpans {
  tagName: string;
  attrs: Record<string, string>;
  text: string;
  start: number;
  end: number;
  openEnd: number;
  closeStart: number;
  attrSpans: Record<string, { start: number; end: number }>;
}

/**
 * Converts a `[startOffset, endOffset]` span in `text` to a 1-based line/column range.
 */
export function offsetSpanToRange(
  text: string,
  startOffset: number,
  endOffset: number,
): {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
} {
  const clampedStart = Math.max(0, Math.min(startOffset, text.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endOffset, text.length));
  let line = 1;
  let lineStart = 0;
  let startLine = 1;
  let startColumn = 1;
  for (let i = 0; i < clampedEnd; i++) {
    if (i === clampedStart) {
      startLine = line;
      startColumn = i - lineStart + 1;
    }
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  if (clampedStart === clampedEnd) {
    startLine = line;
    startColumn = clampedStart - lineStart + 1;
  }
  return {
    startLine,
    startColumn,
    endLine: line,
    endColumn: clampedEnd - lineStart + 1,
    startOffset: clampedStart,
    endOffset: clampedEnd,
  };
}

export function collectXmlElementsFromWasm(xmlText: string): XmlElementWithSpans[] {
  const doc = xml.parseXml(xmlText);
  if (!doc.root) return [];
  const out: XmlElementWithSpans[] = [];
  const stack = [doc.root];
  while (stack.length > 0) {
    const el = stack.pop()!;
    const attrs: Record<string, string> = {};
    const attrSpans: Record<string, { start: number; end: number }> = {};
    for (const a of el.attributes) {
      attrs[a.name] = a.value;
      attrSpans[a.name] = { start: a.valueStart, end: a.valueEnd };
    }
    out.push({
      tagName: el.name,
      attrs,
      text: el.text,
      start: el.start,
      end: el.end,
      openEnd: el.openEnd,
      closeStart: el.closeStart,
      attrSpans,
    });
    for (let i = el.children.length - 1; i >= 0; i--) {
      stack.push(el.children[i]!);
    }
  }
  return out;
}

/**
 * Groups WASM CST leaf tokens by 0-based source line (`startPosition.row`).
 */
export function groupCstLeavesByLine(
  root: CstNodeLike | null | undefined,
): Array<{ row: number; tokens: CstNodeLike[] }> {
  const leaves = extractCstLeafNodes(root);
  const byRow = new Map<number, CstNodeLike[]>();
  for (const leaf of leaves) {
    const row = leaf.startPosition?.row ?? 0;
    let bucket = byRow.get(row);
    if (!bucket) {
      bucket = [];
      byRow.set(row, bucket);
    }
    bucket.push(leaf);
  }
  return Array.from(byRow.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([row, tokens]) => ({ row, tokens }));
}

/**
 * Groups all WASM CST leaf tokens (including unnamed keywords and punctuation via
 * `children`) by 0-based source line (`startPosition.row`).
 */
export function groupAllCstTokensByLine(
  root: CstNodeLike | null | undefined,
): Array<{ row: number; tokens: CstNodeLike[] }> {
  if (!root) return [];
  const leaves: CstNodeLike[] = [];
  const stack: CstNodeLike[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const kids = (node.children && node.children.length > 0 ? node.children : node.namedChildren) ?? [];
    if (kids.length === 0) {
      leaves.push(node);
    } else {
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push(kids[i]!);
      }
    }
  }
  const byRow = new Map<number, CstNodeLike[]>();
  const pushLeaf = (row: number, token: CstNodeLike) => {
    let bucket = byRow.get(row);
    if (!bucket) {
      bucket = [];
      byRow.set(row, bucket);
    }
    bucket.push(token);
  };
  for (const leaf of leaves) {
    const startRow = leaf.startPosition?.row ?? 0;
    const text = leaf.text ?? "";
    if (!text.includes("\n")) {
      pushLeaf(startRow, leaf);
      continue;
    }
    let pos = 0;
    let r = startRow;
    const baseIdx = leaf.startIndex;
    while (pos <= text.length) {
      const nl = text.indexOf("\n", pos);
      const end = nl === -1 ? text.length : nl;
      const slice = text.slice(pos, end).replace(/\r$/, "");
      if (slice.length > 0) {
        pushLeaf(r, {
          type: leaf.type,
          text: slice,
          startPosition: {
            row: r,
            column: r === startRow ? (leaf.startPosition?.column ?? 0) : 0,
          },
          startIndex: typeof baseIdx === "number" ? baseIdx + pos : undefined,
          endIndex: typeof baseIdx === "number" ? baseIdx + pos + slice.length : undefined,
        });
      }
      if (nl === -1) break;
      pos = nl + 1;
      r++;
    }
  }
  return Array.from(byRow.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([row, tokens]) => ({ row, tokens }));
}

/**
 * Reconstructs the source slice spanned by a CST line's leaf tokens using their
 * exact byte offsets when available, falling back to token text concatenation.
 */
export function cstLineText(source: string, tokens: CstNodeLike[]): string {
  if (tokens.length === 0) return "";
  const first = tokens[0]!;
  const last = tokens[tokens.length - 1]!;
  if (typeof first.startIndex === "number" && typeof last.endIndex === "number" && last.endIndex >= first.startIndex) {
    return source.slice(first.startIndex, last.endIndex);
  }
  return tokens
    .map((t) => t.text ?? "")
    .filter(Boolean)
    .join(" ");
}
