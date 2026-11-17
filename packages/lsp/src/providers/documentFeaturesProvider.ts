// SPDX-License-Identifier: AGPL-3.0-or-later

import { getPscadDocumentSymbols, getPscadFoldingRanges } from "@modelscript/pscad";
import { Connection, DocumentHighlightKind, DocumentSymbol, FoldingRange, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { nodeRange } from "../utils/ast-utils.js";
import type { SyntaxNode } from "../utils/cst-facade.js";
import { extractWordAtOffset, isDigitCode } from "../utils/lexical-utils.js";

function isPosBefore(a: { line: number; character: number }, b: { line: number; character: number }): boolean {
  return a.line < b.line || (a.line === b.line && a.character < b.character);
}

export function sanitizeDocumentSymbols(symbols: unknown): DocumentSymbol[] {
  if (!Array.isArray(symbols)) return [];
  const sanitized: DocumentSymbol[] = [];

  for (const s of symbols) {
    if (!s || typeof s !== "object") continue;
    const sObj = s as Record<string, unknown>;
    const name = typeof sObj["name"] === "string" && sObj["name"].trim().length > 0 ? sObj["name"] : "anonymous";

    let range: { start: { line: number; character: number }; end: { line: number; character: number } };
    const rawRange = sObj["range"] as
      | { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
      | undefined;
    if (!rawRange || typeof rawRange.start?.line !== "number" || typeof rawRange.end?.line !== "number") {
      range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
    } else {
      let rStart = { line: Math.max(0, rawRange.start.line), character: Math.max(0, rawRange.start.character ?? 0) };
      let rEnd = { line: Math.max(0, rawRange.end.line), character: Math.max(0, rawRange.end.character ?? 0) };
      if (isPosBefore(rEnd, rStart)) {
        rEnd = { ...rStart };
      }
      range = { start: rStart, end: rEnd };
    }

    let sel: { start: { line: number; character: number }; end: { line: number; character: number } };
    const rawSel = sObj["selectionRange"] as
      | { start?: { line?: number; character?: number }; end?: { line?: number; character?: number } }
      | undefined;
    if (!rawSel || typeof rawSel.start?.line !== "number" || typeof rawSel.end?.line !== "number") {
      sel = { start: { ...range.start }, end: { ...range.end } };
    } else {
      let sStart = { line: Math.max(0, rawSel.start.line), character: Math.max(0, rawSel.start.character ?? 0) };
      let sEnd = { line: Math.max(0, rawSel.end.line), character: Math.max(0, rawSel.end.character ?? 0) };
      if (isPosBefore(sEnd, sStart)) sEnd = { ...sStart };
      if (isPosBefore(sStart, range.start)) sStart = { ...range.start };
      if (isPosBefore(range.end, sStart)) sStart = { ...range.end };
      if (isPosBefore(sEnd, sStart)) sEnd = { ...sStart };
      if (isPosBefore(range.end, sEnd)) sEnd = { ...range.end };
      if (isPosBefore(sEnd, sStart) || isPosBefore(sStart, range.start) || isPosBefore(range.end, sEnd)) {
        sStart = { ...range.start };
        sEnd = { ...range.end };
      }
      sel = { start: sStart, end: sEnd };
    }

    const children =
      Array.isArray(sObj["children"]) && sObj["children"].length > 0
        ? sanitizeDocumentSymbols(sObj["children"])
        : undefined;

    sanitized.push({
      ...(s as DocumentSymbol),
      name,
      range: range as { start: { line: number; character: number }; end: { line: number; character: number } },
      selectionRange: sel as { start: { line: number; character: number }; end: { line: number; character: number } },
      ...(children !== undefined ? { children } : {}),
    });
  }

  return sanitized;
}

export function registerDocumentFeaturesProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, any>,
  getDocumentTree: (uri: string) => any,
  getLineIndexForDoc: (uri: string) => any,
  isParserReady: () => boolean,
  isSysml2ParserReady: () => boolean,
  getSysml2Parser: () => any,
  validationService?: any,
) {
  /* Document symbols — enables Outline panel and breadcrumb navigation */
  connection.onDocumentSymbol(async (params) => {
    try {
      const normalize = (u: string) => {
        try {
          return decodeURIComponent(u).replace(/^[a-z0-9+-]+:\/\/?/, "/");
        } catch {
          return u;
        }
      };

      const findBridge = (targetUri: string) => {
        let b = documentLSPBridges.get(targetUri);
        if (b) return b;
        const targetNorm = normalize(targetUri);
        for (const [k, val] of documentLSPBridges.entries()) {
          const kNorm = normalize(k);
          if (k === targetUri || kNorm === targetNorm || kNorm.endsWith(targetNorm) || targetNorm.endsWith(kNorm)) {
            return val;
          }
        }
        return null;
      };

      const getDoc = (targetUri: string) => {
        let d = documents.get(targetUri);
        if (d) return d;
        const norm = normalize(targetUri);
        for (const doc of documents.all()) {
          if (doc.uri === targetUri || normalize(doc.uri) === norm) {
            return doc;
          }
        }
        return undefined;
      };

      if (/\.(pscx|pslx|pswx|psmx)$/i.test(params.textDocument.uri)) {
        const doc = getDoc(params.textDocument.uri);
        const text = doc ? doc.getText() : getDocumentTree(params.textDocument.uri)?.text;
        if (text) {
          return sanitizeDocumentSymbols(getPscadDocumentSymbols(text));
        }
      }

      const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
      const isModelicaUri = !plugin || plugin.id === "modelica";
      const isSysmlUri = plugin?.id === "sysml2" || plugin?.id === "sysml";
      const isTargetParserReady = () => {
        if (plugin?.parser) return true;
        if (isSysmlUri) return isSysml2ParserReady();
        if (isModelicaUri) return isParserReady();
        return Boolean(plugin?.parser);
      };

      // Wait up to 500ms for the relevant parser to be ready if currently initializing
      if (!isTargetParserReady()) {
        const start = Date.now();
        while (!isTargetParserReady() && Date.now() - start < 500) {
          await new Promise((r) => setTimeout(r, 25));
        }
      }

      let bridge = findBridge(params.textDocument.uri);

      // Fast instant bridge creation for immediate Outline response (0-5ms)
      const parser =
        plugin?.parser ??
        (isSysmlUri
          ? getSysml2Parser()
          : isModelicaUri
            ? (validationService as any)?.parserService?.parser
            : undefined);
      if (!bridge && parser) {
        const doc = getDoc(params.textDocument.uri);
        const text = doc ? doc.getText() : getDocumentTree(params.textDocument.uri)?.text;
        const wm = validationService?.workspaceManager;
        if (text) {
          let tree: any = null;
          try {
            tree = parser.parse(text);
            const langId = plugin?.id ?? "modelica";
            const ws = plugin?.workspaceIndex ?? wm?.getWorkspaceIndex(langId);
            if (!ws) return [];
            ws.register(params.textDocument.uri, () => tree.rootNode);
            ws.getFileIndex(params.textDocument.uri);
            const unified =
              wm?.unifiedWorkspace?.getIndex?.() ?? (typeof ws.getIndex === "function" ? ws.getIndex() : ws);
            const realEngine = plugin?.queryEngine ?? wm?.getQueryEngine(langId);
            const engine = realEngine ?? {
              toQueryDB: () => ({ index: unified }),
              index: unified,
            };
            bridge = new LSPBridge(unified as any, engine as any, new PositionIndex(text), params.textDocument.uri, {
              documentLSPBridges,
              documents: { get: (u: string) => getDoc(u) },
            });
            if (realEngine) {
              documentLSPBridges.set(params.textDocument.uri, bridge);
            }
          } catch (fastErr) {
            connection.console.warn(`[onDocumentSymbol] Fast bridge build error: ${fastErr}`);
          } finally {
            tree?.delete?.();
          }
        }
      }

      if (!bridge && (!plugin?.customHandlers?.symbols || plugin?.queryEngine)) {
        const doc = getDoc(params.textDocument.uri);
        const treeWrapper = getDocumentTree(params.textDocument.uri);
        const text = doc?.getText() ?? treeWrapper?.text;
        const unifiedIndex = validationService?.workspaceManager?.unifiedWorkspace?.getIndex();
        const engine = plugin?.queryEngine ?? validationService?.workspaceManager?.globalModelicaQueryEngine;
        if (text && unifiedIndex && engine) {
          bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), params.textDocument.uri, {
            documentLSPBridges,
            documents: { get: (u: string) => getDoc(u) },
          });
          documentLSPBridges.set(params.textDocument.uri, bridge);
        }
      }

      if (!bridge) {
        if (plugin) {
          if (plugin.customHandlers?.symbols) {
            const treeOrText =
              getDocumentTree(params.textDocument.uri) ?? getDoc(params.textDocument.uri)?.getText() ?? "";
            return sanitizeDocumentSymbols(plugin.customHandlers.symbols(treeOrText));
          }
          if (plugin.facade?.getDocumentSymbols && parser) {
            try {
              const doc = getDoc(params.textDocument.uri);
              const text = doc?.getText() ?? getDocumentTree(params.textDocument.uri)?.text;
              if (text) {
                const tree = parser.parse(text);
                try {
                  const rootPtr = tree?.rootNode?.id ?? tree?.rootNode?.ptr ?? (tree as any)?.rootPtr ?? 0;
                  if (rootPtr) {
                    const symbols = plugin.facade.getDocumentSymbols(rootPtr);
                    if (symbols && symbols.length > 0) return sanitizeDocumentSymbols(symbols);
                  }
                } finally {
                  tree?.delete?.();
                }
              }
            } catch {}
          }
        }
        return [];
      }
      return sanitizeDocumentSymbols(bridge.documentSymbols());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      connection.console.error(`[documentSymbol] ${message}`);
      return [];
    }
  });

  /* Folding Ranges — enables code folding for classes, sections, annotations, comments, and control structures */
  type InternalFoldingRange = {
    startLine: number;
    startCharacter?: number | undefined;
    endLine: number;
    endCharacter?: number | undefined;
    kind?: "comment" | "imports" | "region" | undefined;
    collapsedText?: string | undefined;
    defaultCollapsed?: boolean | undefined;
  };

  type NormalizedFoldRule = {
    kind?: "comment" | "imports" | "region" | undefined;
    defaultCollapsed?: boolean | undefined;
    collapsedText?: string | undefined;
  };

  type FoldRulePlugin = {
    languageDef?: {
      lsp?: {
        folding?: Array<
          | string
          | {
              rule?: string;
              kind?: "comment" | "imports" | "region";
              defaultCollapsed?: boolean;
              collapsedText?: string;
            }
        >;
      };
    };
  };

  const buildFoldRuleMap = (plugin: FoldRulePlugin | null | undefined): Map<string, NormalizedFoldRule> => {
    const map = new Map<string, NormalizedFoldRule>();
    const folding = plugin?.languageDef?.lsp?.folding;
    if (!Array.isArray(folding)) return map;
    for (const item of folding) {
      if (typeof item === "string") {
        map.set(item, {});
      } else if (item && typeof item === "object" && typeof item.rule === "string") {
        map.set(item.rule, {
          kind: item.kind,
          defaultCollapsed: item.defaultCollapsed,
          collapsedText: item.collapsedText,
        });
      }
    }
    return map;
  };

  const scanCommentFoldingRanges = (text: string): InternalFoldingRange[] => {
    const out: InternalFoldingRange[] = [];
    const lines = text.split(/\r?\n/);
    let inBlock: { startLine: number; endToken: string } | null = null;
    let lineCommentStart = -1;
    let lineCommentEnd = -1;

    const flushLineComment = () => {
      if (lineCommentStart !== -1 && lineCommentEnd > lineCommentStart) {
        out.push({ startLine: lineCommentStart, endLine: lineCommentEnd, kind: "comment" });
      }
      lineCommentStart = -1;
      lineCommentEnd = -1;
    };

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();
      if (inBlock) {
        if (trimmed.includes(inBlock.endToken)) {
          if (i > inBlock.startLine) {
            out.push({ startLine: inBlock.startLine, endLine: i, kind: "comment" });
          }
          inBlock = null;
        }
        continue;
      }

      if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
        flushLineComment();
        inBlock = { startLine: i, endToken: "*/" };
        continue;
      }
      if (trimmed.startsWith("<!--") && !trimmed.includes("-->")) {
        flushLineComment();
        inBlock = { startLine: i, endToken: "-->" };
        continue;
      }
      if (trimmed.startsWith("(*") && !trimmed.includes("*)")) {
        flushLineComment();
        inBlock = { startLine: i, endToken: "*)" };
        continue;
      }

      if (trimmed.startsWith("//") && !trimmed.startsWith("///")) {
        if (lineCommentStart === -1) lineCommentStart = i;
        lineCommentEnd = i;
      } else {
        flushLineComment();
      }
    }
    flushLineComment();
    return out;
  };

  const FOLDABLE_NODES = new Set([
    "ClassDefinition",
    "EquationSection",
    "InitialEquationSection",
    "AlgorithmSection",
    "InitialAlgorithmSection",
    "IfEquation",
    "ForEquation",
    "WhenEquation",
    "IfStatement",
    "ForStatement",
    "WhileStatement",
    "WhenStatement",
    "AnnotationClause",
    "annotation_clause",
    "ExternalClause",
    "external_clause",
    "Package",
    "LibraryPackage",
    "Namespace",
  ]);

  const DEFAULT_COLLAPSED_FALLBACK_NODES = new Set(["AnnotationClause", "annotation_clause"]);

  const computeFoldingRanges = (uri: string): InternalFoldingRange[] => {
    const document = documents.get(uri);
    if (!document) return [];

    if (/\.(pscx|pslx|pswx|psmx)$/i.test(uri)) {
      return getPscadFoldingRanges(document.getText()) as InternalFoldingRange[];
    }

    const plugin = globalLanguageRegistry.getPluginForUri(uri);
    const parser = plugin?.parser ?? (isParserReady() ? (validationService as any)?.parserService?.parser : undefined);

    const treeWrapper = getDocumentTree(document.uri);
    let tree = treeWrapper?.tree ?? treeWrapper;
    let ownsTree = false;
    if (!tree && parser) {
      try {
        tree = parser.parse(document.getText());
        ownsTree = true;
      } catch {}
    }
    if (!tree) return scanCommentFoldingRanges(document.getText());

    try {
      const rootNode = tree.rootNode ?? tree;
      const rootPtr = rootNode?.id ?? rootNode?.ptr ?? (tree as any)?.rootPtr ?? 0;

      if (plugin?.customHandlers?.folding) {
        try {
          const customFolds = plugin.customHandlers.folding(tree);
          if (Array.isArray(customFolds) && customFolds.length > 0) {
            return customFolds;
          }
        } catch {}
      }

      const ruleMap = buildFoldRuleMap(plugin);
      const rangeMap = new Map<string, InternalFoldingRange>();
      const addRange = (r: InternalFoldingRange) => {
        if (r.endLine <= r.startLine) return;
        const key = `${r.startLine}:${r.endLine}`;
        const existing = rangeMap.get(key);
        if (!existing) {
          rangeMap.set(key, r);
        } else {
          if (r.kind && !existing.kind) existing.kind = r.kind;
          if (r.defaultCollapsed) existing.defaultCollapsed = true;
          if (r.collapsedText && !existing.collapsedText) existing.collapsedText = r.collapsedText;
        }
      };

      if (plugin?.facade?.getFoldingRanges && rootPtr) {
        try {
          const folds = plugin.facade.getFoldingRanges(rootPtr);
          if (Array.isArray(folds)) {
            for (const f of folds) {
              if (!f || typeof f !== "object") continue;
              if (typeof f.startLine === "number" && typeof f.endLine === "number") {
                addRange(f as InternalFoldingRange);
              } else if (f.start && f.end && typeof f.start.line === "number" && typeof f.end.line === "number") {
                if (f.end.line > f.start.line) {
                  let kind: "comment" | "imports" | "region" | undefined = f.kind;
                  if (!kind) {
                    const lineStart = document
                      .getText({
                        start: { line: f.start.line, character: f.start.character ?? 0 },
                        end: { line: f.start.line + 1, character: 0 },
                      })
                      .trimStart();
                    if (
                      lineStart.startsWith("/*") ||
                      lineStart.startsWith("//") ||
                      lineStart.startsWith("(*") ||
                      lineStart.startsWith("<!--")
                    ) {
                      kind = "comment";
                    }
                  }
                  addRange({
                    startLine: f.start.line,
                    startCharacter: f.start.character,
                    endLine: f.end.line,
                    endCharacter: f.end.character,
                    kind,
                    defaultCollapsed: f.defaultCollapsed,
                    collapsedText: f.collapsedText,
                  });
                }
              }
            }
          }
        } catch {}
      }

      // Walk CST to cover newly-configured rules on older WASMs, attach collapsedText/defaultCollapsed,
      // or provide fallback folding when facade.getFoldingRanges is unavailable.
      const needsCstWalk = rangeMap.size === 0 || ruleMap.size > 0;
      if (needsCstWalk && rootNode) {
        type FoldCstNode = {
          type?: string;
          startPosition?: { row?: number; line?: number; column?: number };
          endPosition?: { row?: number; line?: number; column?: number };
          children?: FoldCstNode[];
        };
        const collectFolds = (node: FoldCstNode | undefined) => {
          if (!node) return;
          const t = node.type || "";
          const isComment = t === "Comment" || t === "comment";
          const ruleCfg = ruleMap.get(t);
          const isFoldable =
            Boolean(ruleCfg) ||
            (rangeMap.size === 0 &&
              (FOLDABLE_NODES.has(t) ||
                t.endsWith("Definition") ||
                t.endsWith("Usage") ||
                t.endsWith("Block") ||
                isComment));

          if (isFoldable && node.startPosition && node.endPosition) {
            const startLine = node.startPosition.row ?? node.startPosition.line;
            const endLine = node.endPosition.row ?? node.endPosition.line;
            if (startLine !== undefined && endLine !== undefined && endLine > startLine) {
              addRange({
                startLine,
                endLine,
                kind: ruleCfg?.kind ?? (isComment ? "comment" : undefined),
                defaultCollapsed: ruleCfg?.defaultCollapsed ?? (DEFAULT_COLLAPSED_FALLBACK_NODES.has(t) || undefined),
                collapsedText: ruleCfg?.collapsedText,
              });
            }
          }

          const children = node.children || [];
          for (let i = 0; i < children.length; i++) {
            collectFolds(children[i]);
          }
        };
        collectFolds(rootNode as FoldCstNode);
      }

      for (const commentRange of scanCommentFoldingRanges(document.getText())) {
        addRange(commentRange);
      }

      return Array.from(rangeMap.values());
    } finally {
      if (ownsTree) {
        tree?.delete?.();
      }
    }
  };

  connection.onFoldingRanges((params): FoldingRange[] => {
    return computeFoldingRanges(params.textDocument.uri).map((r) => {
      const fr: FoldingRange = { startLine: r.startLine, endLine: r.endLine };
      if (r.startCharacter !== undefined) fr.startCharacter = r.startCharacter;
      if (r.endCharacter !== undefined) fr.endCharacter = r.endCharacter;
      if (r.kind !== undefined) fr.kind = r.kind;
      if (r.collapsedText !== undefined) fr.collapsedText = r.collapsedText;
      return fr;
    });
  });

  connection.onRequest("modelscript/getDefaultFoldLines", (params: { textDocument?: { uri?: string } }) => {
    const uri = params?.textDocument?.uri;
    if (!uri) return { lines: [] };
    const ranges = computeFoldingRanges(uri);
    const lines = Array.from(
      new Set(ranges.filter((r) => r.defaultCollapsed && r.endLine > r.startLine).map((r) => r.startLine)),
    ).sort((a, b) => a - b);
    return { lines };
  });

  /* Selection Ranges — enables smart Expand/Shrink selection */
  connection.onSelectionRanges((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const tree = getDocumentTree(document.uri);
    if (!tree) return [];

    const results = params.positions.map((pos) => {
      let node: SyntaxNode | null = null;
      const indexData = getLineIndexForDoc(document.uri);
      if (indexData) {
        const idx = indexData.lineIndex.tokenIndexAt(pos.line, pos.character);
        if (idx !== -1) node = indexData.tokens[idx]!;
      }

      if (!node) {
        node = tree.rootNode.descendantForPosition({
          row: pos.line,
          column: pos.character,
        });
      }

      // Build the chain from innermost to outermost
      const ancestors: SyntaxNode[] = [];
      while (node) {
        ancestors.push(node);
        node = node.parent;
      }

      // Build linked list from outermost to innermost so innermost is at the head
      let current: any = undefined;
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const r = nodeRange(ancestors[i] as any);
        if (
          current &&
          current.range.start.line === r.start.line &&
          current.range.start.character === r.start.character &&
          current.range.end.line === r.end.line &&
          current.range.end.character === r.end.character
        ) {
          continue;
        }
        current = {
          range: r,
          parent: current,
        };
      }

      return current ?? { range: nodeRange(tree.rootNode as any) };
    });

    return results as any[];
  });

  /* Document Highlights — highlights all occurrences of the symbol under cursor */
  connection.onDocumentHighlight((params) => {
    if (!isParserReady()) return [];
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const text = document.getText();
    const lines = text.split("\n");
    const lineContent = lines[params.position.line] ?? "";

    // Find the word under cursor
    const word = extractWordAtOffset(lineContent, params.position.character).token;
    if (!word || isDigitCode(word.charCodeAt(0))) return []; // Skip empty or numeric tokens

    // Find all occurrences of the word in the document using LineIndex
    const indexData = getLineIndexForDoc(document.uri);
    if (!indexData) return [];

    const highlights: {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      kind: DocumentHighlightKind;
    }[] = [];

    for (const node of indexData.tokens) {
      if ((node.type === "IDENT" || node.type === "identifier") && node.text === word) {
        highlights.push({
          range: nodeRange(node),
          kind: DocumentHighlightKind.Text,
        });
      }
    }

    return highlights;
  });
}
