import { Connection, DocumentHighlightKind, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { LSPBridge, PositionIndex } from "../lsp-bridge.js";
import { globalLanguageRegistry } from "../registry/LanguageRegistry.js";
import { nodeRange } from "../utils/astUtils.js";
import type { SyntaxNode } from "../utils/tree-sitter.js";

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

      // Wait up to 5 seconds for parser to be ready if currently initializing
      if (!isParserReady()) {
        const start = Date.now();
        while (!isParserReady() && Date.now() - start < 5000) {
          await new Promise((r) => setTimeout(r, 50));
        }
      }

      let bridge = findBridge(params.textDocument.uri);

      // Fast instant bridge creation for immediate Outline response (0-5ms)
      const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
      const parser = plugin?.parser ?? (validationService as any)?.parserService?.parser;
      if (!bridge && parser) {
        const doc = getDoc(params.textDocument.uri);
        const text = doc ? doc.getText() : getDocumentTree(params.textDocument.uri)?.text;
        const wm = validationService?.workspaceManager;
        if (text) {
          try {
            const tree = parser.parse(text);
            const langId = plugin?.id ?? "modelica";
            const ws = plugin?.workspaceIndex ?? wm?.getWorkspaceIndex(langId);
            if (!ws) return [];
            ws.register(params.textDocument.uri, () => tree.rootNode);
            ws.getFileIndex(params.textDocument.uri);
            const unified =
              wm?.unifiedWorkspace?.toUnifiedPartial?.() ??
              (typeof ws.toUnifiedPartial === "function" ? ws.toUnifiedPartial() : ws.toUnified());
            const engine = plugin?.queryEngine ??
              wm?.getQueryEngine(langId) ?? {
                toQueryDB: () => ({ index: unified }),
                index: unified,
              };
            bridge = new LSPBridge(unified as any, engine as any, new PositionIndex(text), params.textDocument.uri);
            documentLSPBridges.set(params.textDocument.uri, bridge);
          } catch (fastErr) {
            connection.console.warn(`[onDocumentSymbol] Fast bridge build error: ${fastErr}`);
          }
        }
      }

      if (!bridge) {
        const doc = getDoc(params.textDocument.uri);
        const treeWrapper = getDocumentTree(params.textDocument.uri);
        const text = doc?.getText() ?? treeWrapper?.text;
        const unifiedIndex = validationService?.workspaceManager?.unifiedWorkspace?.toUnifiedPartial();
        const engine = plugin?.queryEngine ?? validationService?.workspaceManager?.globalModelicaQueryEngine;
        if (text && unifiedIndex && engine) {
          bridge = new LSPBridge(unifiedIndex, engine, new PositionIndex(text), params.textDocument.uri);
          documentLSPBridges.set(params.textDocument.uri, bridge);
        }
      }

      if (!bridge) {
        if (plugin) {
          if (plugin.customHandlers?.symbols) {
            return plugin.customHandlers.symbols(getDocumentTree(params.textDocument.uri));
          }
          if (plugin.facade?.getDocumentSymbols && parser) {
            try {
              const doc = getDoc(params.textDocument.uri);
              const text = doc?.getText() ?? getDocumentTree(params.textDocument.uri)?.text;
              if (text) {
                const tree = parser.parse(text);
                const rootPtr = tree?.rootNode?.id ?? tree?.rootNode?.ptr ?? (tree as any)?.rootPtr ?? 0;
                if (rootPtr) {
                  const symbols = plugin.facade.getDocumentSymbols(rootPtr);
                  if (symbols && symbols.length > 0) return symbols;
                }
              }
            } catch {}
          }
        }
        return [];
      }
      return bridge.documentSymbols() as any[];
    } catch (e: any) {
      connection.console.error(`[documentSymbol] ${e.message}`);
      return [];
    }
  });

  /* Folding Ranges — enables code folding for classes, sections, and control structures */
  connection.onFoldingRanges((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];

    const plugin = globalLanguageRegistry.getPluginForUri(params.textDocument.uri);
    const parser = plugin?.parser ?? (isParserReady() ? (validationService as any)?.parserService?.parser : undefined);

    let treeWrapper = getDocumentTree(document.uri);
    let tree = treeWrapper?.tree ?? treeWrapper;
    if (!tree && parser) {
      try {
        tree = parser.parse(document.getText());
      } catch {}
    }
    if (!tree) return [];

    const rootNode = tree.rootNode ?? tree;
    const rootPtr = rootNode?.id ?? rootNode?.ptr ?? (tree as any)?.rootPtr ?? 0;

    if (plugin?.facade?.getFoldingRanges && rootPtr) {
      try {
        const folds = plugin.facade.getFoldingRanges(rootPtr);
        if (folds && folds.length > 0) return folds;
      } catch {}
    }

    const ranges: { startLine: number; endLine: number; kind?: string }[] = [];
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
      "Package",
      "LibraryPackage",
      "Namespace",
    ]);

    const collectFolds = (node: any) => {
      if (!node) return;
      const t = node.type || "";
      const isComment = t === "Comment" || t === "comment";
      const isFoldable =
        FOLDABLE_NODES.has(t) || t.endsWith("Definition") || t.endsWith("Usage") || t.endsWith("Block") || isComment;

      if (isFoldable && node.startPosition && node.endPosition) {
        const startLine = node.startPosition.row ?? node.startPosition.line;
        const endLine = node.endPosition.row ?? node.endPosition.line;
        if (endLine > startLine) {
          ranges.push({
            startLine,
            endLine,
            kind: isComment ? "comment" : undefined,
          });
        }
      }

      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        collectFolds(children[i]);
      }
    };

    collectFolds(rootNode);
    return ranges as any[];
  });

  /* Selection Ranges — enables smart Expand/Shrink selection */
  connection.onSelectionRanges((params) => {
    if (!isParserReady()) return [];
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
      let current: any = null;
      const ancestors: SyntaxNode[] = [];
      while (node) {
        ancestors.push(node);
        node = node.parent;
      }

      // Build linked list from outermost to innermost
      for (const ancestor of ancestors) {
        current = {
          range: nodeRange(ancestor as any),
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
    let wordStart = params.position.character;
    let wordEnd = params.position.character;
    while (wordStart > 0 && /[_a-zA-Z0-9]/.test(lineContent[wordStart - 1])) wordStart--;
    while (wordEnd < lineContent.length && /[_a-zA-Z0-9]/.test(lineContent[wordEnd])) wordEnd++;
    const word = lineContent.substring(wordStart, wordEnd);
    if (!word || /^\d/.test(word)) return []; // Skip empty or numeric tokens

    // Find all occurrences of the word in the document using LineIndex
    const indexData = getLineIndexForDoc(document.uri);
    if (!indexData) return [];

    const highlights: {
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      kind: DocumentHighlightKind;
    }[] = [];

    for (const node of indexData.tokens) {
      if (node.type === "IDENT" && node.text === word) {
        highlights.push({
          range: nodeRange(node),
          kind: DocumentHighlightKind.Text,
        });
      }
    }

    return highlights;
  });
}
