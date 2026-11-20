// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Connection,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
  TextDocuments,
} from "vscode-languageserver";

import { TextDocument } from "vscode-languageserver-textdocument";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import type { CstNodeLike, CstParserLike, CstTreeLike } from "../utils/ast-utils.js";

const DEFAULT_TYPE_KEYWORDS = ["Real", "Integer", "Boolean", "String", "Natural"];

const tokenTypes = [
  "keyword",
  "type",
  "class",
  "variable",
  "parameter",
  "function",
  "string",
  "number",
  "operator",
  "comment",
  "namespace",
  "enumMember",
];

const tokenModifiers = ["declaration", "readonly"];

const TOKEN_TYPE_INDEX = new Map<string, number>(tokenTypes.map((t, i) => [t, i]));

const legend: SemanticTokensLegend = { tokenTypes, tokenModifiers };

export { legend };

interface RawSemanticToken {
  line: number;
  char: number;
  length: number;
  typeIndex: number;
  modifier: number;
}

/**
 * Maps flat UTF-16 character offsets to zero-based `(line, char)` coordinates
 * without duplicating per-handler line splitting.
 */
class LineIndex {
  private readonly lineStarts: number[];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
    this.lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) {
        this.lineStarts.push(i + 1);
      }
    }
  }

  public get lineCount(): number {
    return this.lineStarts.length;
  }

  public lineRange(lineIdx: number): { start: number; end: number } {
    const start = this.lineStarts[lineIdx] ?? this.text.length;
    const rawEnd = lineIdx + 1 < this.lineStarts.length ? this.lineStarts[lineIdx + 1]! - 1 : this.text.length;
    const end = rawEnd > start && this.text.charCodeAt(rawEnd - 1) === 13 ? rawEnd - 1 : rawEnd;
    return { start, end };
  }

  public positionAt(offset: number): { line: number; char: number } {
    const clamped = Math.max(0, Math.min(offset, this.text.length));
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const start = this.lineStarts[mid]!;
      if (start <= clamped) {
        if (mid + 1 >= this.lineStarts.length || this.lineStarts[mid + 1]! > clamped) {
          return { line: mid, char: clamped - start };
        }
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { line: 0, char: clamped };
  }
}

/**
 * Shared token buffer handling deduplication, sorting, overlap prevention, and multi-line emission.
 */
class TokenCollector {
  private readonly rawTokens: RawSemanticToken[] = [];
  private readonly seenPositions = new Set<string>();

  public push(line: number, char: number, length: number, typeName: string, modifier = 0): void {
    if (length <= 0 || line < 0 || char < 0) return;
    const typeIndex = TOKEN_TYPE_INDEX.get(typeName);
    if (typeIndex === undefined) return;
    const key = `${line}:${char}`;
    if (this.seenPositions.has(key)) return;
    this.seenPositions.add(key);
    this.rawTokens.push({ line, char, length, typeIndex, modifier });
  }

  public pushNode(node: CstNodeLike | null | undefined, typeName: string, modifier = 0): void {
    const start = node?.startPosition;
    const end = node?.endPosition;
    if (!start || !end) return;
    if (start.row === end.row) {
      this.push(start.row, start.column, end.column - start.column, typeName, modifier);
      return;
    }
    const text = String(node.text ?? "");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i]!;
      const len = rawLine.endsWith("\r") ? rawLine.length - 1 : rawLine.length;
      if (len > 0) {
        this.push(start.row + i, i === 0 ? start.column : 0, len, typeName, modifier);
      }
    }
  }

  public pushOffsetSpan(
    _text: string,
    lineIndex: LineIndex,
    startOffset: number,
    endOffset: number,
    typeName: string,
    modifier = 0,
  ): void {
    if (endOffset <= startOffset) return;
    const startPos = lineIndex.positionAt(startOffset);
    const endPos = lineIndex.positionAt(endOffset);
    if (startPos.line === endPos.line) {
      this.push(startPos.line, startPos.char, endPos.char - startPos.char, typeName, modifier);
      return;
    }
    for (let line = startPos.line; line <= endPos.line; line++) {
      const range = lineIndex.lineRange(line);
      const segStart = line === startPos.line ? startOffset : range.start;
      const segEnd = line === endPos.line ? Math.min(endOffset, range.end) : range.end;
      const len = segEnd - segStart;
      if (len > 0) {
        this.push(line, segStart - range.start, len, typeName, modifier);
      }
    }
  }

  public flushTo(builder: SemanticTokensBuilder): SemanticTokens {
    this.rawTokens.sort((a, b) => (a.line !== b.line ? a.line - b.line : a.char - b.char));
    let lastLine = -1;
    let lastEndChar = -1;
    for (const token of this.rawTokens) {
      if (token.line > lastLine || token.char >= lastEndChar) {
        lastLine = token.line;
        lastEndChar = token.char + token.length;
        builder.push(token.line, token.char, token.length, token.typeIndex, token.modifier);
      }
    }
    return builder.build();
  }
}

function getChildren(node: CstNodeLike | null | undefined): readonly CstNodeLike[] {
  if (!node) return [];
  if (Array.isArray(node.children) && node.children.length > 0) {
    return node.children;
  }
  const count = node.childCount ?? 0;
  if (count <= 0 || typeof node.child !== "function") return [];
  const res: CstNodeLike[] = [];
  for (let i = 0; i < count; i++) {
    const c = node.child(i);
    if (c) res.push(c);
  }
  return res;
}

/**
 * Walks CST leaves in source order and invokes `emitGap` on every skipped `extras` gap
 * `[prevEndIndex, nextStartIndex)` so comments outside AST child nodes are classified
 * without ever scanning inside string literal or identifier leaves.
 */
function collectCstGapComments(
  rootNode: CstNodeLike,
  text: string,
  lineIndex: LineIndex,
  collector: TokenCollector,
  emitGap: (text: string, gapStart: number, gapEnd: number, lineIndex: LineIndex, collector: TokenCollector) => void,
): void {
  let cursor = 0;
  const visitLeaves = (node: CstNodeLike): void => {
    const children = getChildren(node);
    if (children.length === 0) {
      const start = typeof node.startIndex === "number" ? node.startIndex : cursor;
      const end = typeof node.endIndex === "number" ? node.endIndex : start;
      if (start > cursor) {
        emitGap(text, cursor, start, lineIndex, collector);
      }
      if (end > cursor) cursor = end;
      return;
    }
    for (const child of children) {
      visitLeaves(child);
    }
  };
  visitLeaves(rootNode);
  if (cursor < text.length) {
    emitGap(text, cursor, text.length, lineIndex, collector);
  }
}

function emitGapBlockComments(
  text: string,
  gapStart: number,
  gapEnd: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
): void {
  let i = gapStart;
  while (i + 1 < gapEnd) {
    if (text[i] === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close !== -1 && close + 2 <= gapEnd ? close + 2 : gapEnd;
      collector.pushOffsetSpan(text, lineIndex, i, end, "comment");
      i = end;
    } else {
      i++;
    }
  }
}

function emitGapLineComments(
  markers: readonly string[],
  text: string,
  gapStart: number,
  gapEnd: number,
  lineIndex: LineIndex,
  collector: TokenCollector,
): void {
  let i = gapStart;
  while (i < gapEnd) {
    let matched = false;
    for (const marker of markers) {
      if (text.startsWith(marker, i) && i + marker.length <= gapEnd) {
        if (marker === "!" && text[i + 1] === "=") continue;
        let lineEnd = text.indexOf("\n", i);
        if (lineEnd === -1 || lineEnd > gapEnd) lineEnd = gapEnd;
        if (lineEnd > i && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
        collector.pushOffsetSpan(text, lineIndex, i, lineEnd, "comment");
        i = lineEnd + 1;
        matched = true;
        break;
      }
    }
    if (!matched) i++;
  }
}

// ---------------------------------------------------------------------------
// Provider Registration
// ---------------------------------------------------------------------------

function extractUriExtension(uri: string): string {
  const cleanUri = uri.split(/[?#]/)[0] || "";
  const dot = cleanUri.lastIndexOf(".");
  if (dot === -1) return ".mo";
  const slash = Math.max(cleanUri.lastIndexOf("/"), cleanUri.lastIndexOf("\\"));
  return dot > slash ? cleanUri.slice(dot) : ".mo";
}

function getModelicaClauseVariability(clause: CstNodeLike | null | undefined): "constant" | "parameter" | null {
  if (!clause) return null;
  let variability: "constant" | "parameter" | null = null;
  for (const child of getChildren(clause)) {
    if (child.type === "type_prefix" || child.type === "TypePrefix") {
      const stack = getChildren(child);
      if (stack.length === 0) {
        if (child.text === "constant") return "constant";
        if (child.text === "parameter") variability = "parameter";
      } else {
        for (const kw of stack) {
          if (kw.text === "constant") return "constant";
          if (kw.text === "parameter") variability = "parameter";
        }
      }
    } else if (child.text === "constant") {
      return "constant";
    } else if (child.text === "parameter") {
      variability = "parameter";
    }
  }
  return variability;
}

interface DocumentTreeEntryLike {
  tree?: CstTreeLike | null;
  text?: string;
}

export function registerSemanticTokensProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  getDocumentTree: (uri: string) => DocumentTreeEntryLike | CstTreeLike | null | undefined,
  getSysml2Parser: () => CstParserLike | null | undefined,
  isSysml2ParserReady: () => boolean,
  parseFallback?: (ext: string, text: string) => DocumentTreeEntryLike | CstTreeLike | null | undefined,
  ensureParserLoaded?: (languageIdOrUri: string) => Promise<void>,
) {
  const tokensCache = new Map<string, { version: number; tokens: SemanticTokens }>();

  documents.onDidClose((e) => {
    tokensCache.delete(e.document.uri);
  });

  function resolveDocumentTree(
    textDocument: TextDocument,
    text: string,
  ): { tree: CstTreeLike | null | undefined; ownsFallbackTree: boolean } {
    const docTree = getDocumentTree(textDocument.uri);
    let tree: CstTreeLike | null | undefined =
      docTree && typeof docTree === "object" && "tree" in docTree
        ? docTree.tree
        : (docTree as CstTreeLike | null | undefined);
    const treeText = docTree && typeof docTree === "object" && "text" in docTree ? docTree.text : tree?.sourceCode;
    let ownsFallbackTree = false;

    if ((!tree || !tree.rootNode || (treeText && treeText !== text)) && parseFallback) {
      try {
        const ext = extractUriExtension(textDocument.uri);
        const fallbackTree = parseFallback(ext, text);
        if (fallbackTree) {
          tree =
            typeof fallbackTree === "object" && "tree" in fallbackTree
              ? fallbackTree.tree
              : (fallbackTree as CstTreeLike);
          ownsFallbackTree = true;
        }
      } catch {
        // Ignore parse fallback error; callers handle missing tree
      }
    }
    return { tree, ownsFallbackTree };
  }

  function computeSemanticTokens(textDocument: TextDocument): SemanticTokens {
    const cached = tokensCache.get(textDocument.uri);
    if (cached && cached.version === textDocument.version) {
      return cached.tokens;
    }

    const builder = new SemanticTokensBuilder();
    const text = textDocument.getText();
    const cleanUri = textDocument.uri.split(/[?#]/)[0] || "";

    const { tree, ownsFallbackTree } = resolveDocumentTree(textDocument, text);
    try {
      const cacheResult = (tokens: SemanticTokens): SemanticTokens => {
        tokensCache.set(textDocument.uri, { version: textDocument.version, tokens });
        return tokens;
      };

      const pluginForTokens = globalLanguageRegistry.getPluginForLanguageIdOrUri(
        textDocument.languageId,
        textDocument.uri,
        text,
      );
      if (pluginForTokens?.customHandlers?.semanticTokens) {
        let effectiveTree = tree;
        let ownsSysmlTree = false;
        if (
          !effectiveTree?.rootNode &&
          (pluginForTokens.id === "sysml2" || pluginForTokens.id === "sysml") &&
          isSysml2ParserReady()
        ) {
          try {
            effectiveTree = getSysml2Parser()?.parse(text) ?? null;
            ownsSysmlTree = Boolean(effectiveTree);
          } catch {
            // Fall through to plugin handler
          }
        }
        try {
          const customData = pluginForTokens.customHandlers.semanticTokens(textDocument, effectiveTree);
          if (Array.isArray(customData)) {
            return cacheResult({ data: customData });
          }
        } finally {
          if (ownsSysmlTree) {
            effectiveTree?.delete?.();
          }
        }
      }

      if (!tree || !tree.rootNode) {
        return builder.build();
      }

      const isModelica = textDocument.languageId === "modelica" || cleanUri.toLowerCase().endsWith(".mo");

      // Try WASM-compiled semantic tokens (lsp_semanticTokens_full) for polyglot languages
      if (!isModelica) {
        try {
          const rootPtr = typeof tree.rootNode.getPtr === "function" ? tree.rootNode.getPtr() : undefined;
          const runtime = tree.runtime ?? tree.rootNode.runtime;
          const wasmTokens: Uint32Array | undefined =
            typeof tree.getSemanticTokens === "function"
              ? tree.getSemanticTokens()
              : rootPtr && typeof runtime?.getSemanticTokens === "function"
                ? runtime.getSemanticTokens(rootPtr, text)
                : undefined;
          if (wasmTokens && wasmTokens.length >= 5) {
            let curLine = 0;
            let curChar = 0;
            for (let i = 0; i + 4 < wasmTokens.length; i += 5) {
              const dLine = wasmTokens[i]!;
              const dChar = wasmTokens[i + 1]!;
              const len = wasmTokens[i + 2]!;
              const tType = wasmTokens[i + 3]!;
              const tMod = wasmTokens[i + 4]!;
              curLine += dLine;
              curChar = dLine === 0 ? curChar + dChar : dChar;
              if (len > 0) {
                builder.push(curLine, curChar, len, tType, tMod);
              }
            }
            return cacheResult(builder.build());
          }
        } catch {
          // Fall back to CST traversal below
        }
      }

      const collector = new TokenCollector();
      const plugin = globalLanguageRegistry.getPluginForUri(textDocument.uri);
      const typeKws = (plugin?.monarch?.typeKeywords as string[]) ?? DEFAULT_TYPE_KEYWORDS;
      const langKws = new Set<string>((plugin?.monarch?.keywords as string[]) ?? []);

      const traverseTree = (node: CstNodeLike) => {
        let tokenType: string | null = null;
        let modifier = 0;

        if (node.type === "IDENT" || node.type === "identifier" || node.type === "IDENTIFIER") {
          const parent = node.parent;
          let p = parent;
          while (p && (p.type === "Name" || p.type === "name" || p.type === "component_reference")) {
            p = p.parent;
          }

          let inError = false;
          let curr = node.parent;
          while (curr) {
            if (curr.type === "ERROR" || curr.isError) {
              inError = true;
              break;
            }
            curr = curr.parent;
          }

          if (typeKws.includes(node.text)) {
            tokenType = "type";
          } else if (!isModelica && langKws.has(node.text)) {
            tokenType = "keyword";
          } else if (inError) {
            tokenType = "variable";
          } else if (
            p?.type === "LongClassSpecifier" ||
            p?.type === "long_class_specifier" ||
            p?.type === "ShortClassSpecifier" ||
            p?.type === "short_class_specifier" ||
            p?.type === "DerClassSpecifier" ||
            p?.type === "der_class_specifier"
          ) {
            tokenType = "class";
            modifier = 1;
          } else if (
            p?.type === "WithinDirective" ||
            p?.type === "within_clause" ||
            p?.type === "ExtendsClause" ||
            p?.type === "extends_clause" ||
            p?.type === "TypeSpecifier" ||
            p?.type === "type_specifier"
          ) {
            tokenType = "type";
          } else if (p?.type === "Declaration" || p?.type === "component_declaration" || p?.type === "declaration") {
            let clause: CstNodeLike | null | undefined = p;
            while (
              clause &&
              clause.type !== "component_clause" &&
              clause.type !== "ComponentClause" &&
              clause.type !== "element"
            ) {
              clause = clause.parent;
            }
            const variability = getModelicaClauseVariability(clause);
            if (variability === "constant") {
              tokenType = "parameter";
              modifier = 3;
            } else if (variability === "parameter") {
              tokenType = "parameter";
              modifier = 1;
            } else {
              tokenType = "variable";
              modifier = 1;
            }
          } else if (parent?.type === "Argument") {
            tokenType = "parameter";
          } else if (parent?.type === "ModuleDeclaration" || parent?.type === "FunctionDeclaration") {
            tokenType = "function";
            modifier = 1;
          } else if (parent?.type === "VariableDeclaration") {
            tokenType = "variable";
            modifier = 1;
          } else if (
            parent?.type === "function_call" ||
            p?.type === "function_call" ||
            parent?.type === "function_call_args" ||
            (p?.type === "primary" && p.children?.some((c) => c.type === "function_call_args")) ||
            parent?.type === "ModuleCall" ||
            parent?.type === "FunctionCall"
          ) {
            tokenType = "function";
          } else {
            tokenType = "variable";
          }
        } else if (node.type === "STRING" || node.type === "string_literal" || node.type === "description_string") {
          tokenType = "string";
        } else if (
          node.type === "UNSIGNED_INTEGER" ||
          node.type === "UNSIGNED_REAL" ||
          node.type === "unsigned_integer" ||
          node.type === "unsigned_real" ||
          node.type === "NUMBER"
        ) {
          tokenType = "number";
        } else if (node.type === "BOOLEAN") {
          tokenType = "keyword";
        } else if (
          node.type === "comment" ||
          node.type === "line_comment" ||
          node.type === "block_comment" ||
          node.type === "COMMENT"
        ) {
          tokenType = "comment";
        } else if (["+", "-", "*", "/", "=", "<", ">", "<=", ">=", "==", "<>", "!="].includes(node.type)) {
          tokenType = "operator";
        } else if (!isModelica && (!node.children || node.children.length === 0)) {
          if (typeKws.includes(node.text)) {
            tokenType = "type";
          } else if (langKws.has(node.text)) {
            tokenType = "keyword";
          } else if (
            node.parent &&
            /^(BooleanOp|TransformOp|ExtrudeOp|.*Primitive)$/.test(node.parent.type) &&
            /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(node.text)
          ) {
            tokenType = "function";
          }
        }

        if (tokenType !== null) {
          collector.pushNode(node, tokenType, modifier);
          if (
            node.type === "IDENTIFIER" ||
            node.type === "NUMBER" ||
            node.type === "STRING" ||
            node.type === "BOOLEAN" ||
            node.type === "COMMENT"
          ) {
            return;
          }
        }

        for (const child of node.children || []) {
          traverseTree(child);
        }
      };

      traverseTree(tree.rootNode);
      if (!isModelica) {
        const lineIndex = new LineIndex(text);
        collectCstGapComments(tree.rootNode, text, lineIndex, collector, (src, gs, ge, li, col) => {
          emitGapBlockComments(src, gs, ge, li, col);
          emitGapLineComments(["//"], src, gs, ge, li, col);
        });
      }
      return cacheResult(collector.flushTo(builder));
    } finally {
      if (ownsFallbackTree) {
        tree?.delete?.();
      }
    }
  }

  connection.onRequest("textDocument/semanticTokens/full", (params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) {
      return { data: [] };
    }
    if (ensureParserLoaded && !getDocumentTree(document.uri)) {
      return ensureParserLoaded(document.languageId || document.uri).then(
        () => computeSemanticTokens(document),
        () => computeSemanticTokens(document),
      );
    }
    return computeSemanticTokens(document);
  });
}
