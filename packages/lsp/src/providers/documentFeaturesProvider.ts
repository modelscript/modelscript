/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/prefer-for-of, @typescript-eslint/no-non-null-assertion */
import { Connection, DocumentHighlightKind, TextDocuments } from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Node as SyntaxNode } from "web-tree-sitter";
import { nodeRange } from "../utils/astUtils";

export function registerDocumentFeaturesProvider(
  connection: Connection,
  documents: TextDocuments<TextDocument>,
  documentLSPBridges: Map<string, any>,
  getDocumentTree: (uri: string) => any,
  getLineIndexForDoc: (uri: string) => any,
  isParserReady: () => boolean,
  isSysml2ParserReady: () => boolean,
  getSysml2Parser: () => any,
) {
  /* Document symbols — enables Outline panel and breadcrumb navigation */
  connection.onDocumentSymbol((params) => {
    try {
      const bridge = documentLSPBridges.get(params.textDocument.uri);
      if (!bridge) return [];
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

    // SysML2 folding ranges
    if (params.textDocument.uri.endsWith(".sysml")) {
      if (!isSysml2ParserReady()) return [];
      const sysml2Parser = getSysml2Parser();
      if (!sysml2Parser) return [];
      const text = document.getText();
      const tree = sysml2Parser.parse(text);
      if (!tree) return [];

      const ranges: { startLine: number; endLine: number; kind?: string }[] = [];
      // Fold any node whose type ends in Definition, Usage, or is a package/body block
      const collectFolds = (node: SyntaxNode) => {
        const t = node.type;
        if (
          t.endsWith("Definition") ||
          t.endsWith("Usage") ||
          t === "Package" ||
          t === "LibraryPackage" ||
          t === "Namespace" ||
          t === "Comment"
        ) {
          const startLine = node.startPosition.row;
          const endLine = node.endPosition.row;
          if (endLine > startLine) {
            ranges.push({
              startLine,
              endLine,
              kind: t === "Comment" ? "comment" : undefined,
            });
          }
        }
        const children = node.children || [];
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (child) collectFolds(child);
        }
      };
      collectFolds(tree.rootNode);
      return ranges as any[];
    }

    // Modelica folding ranges
    if (!isParserReady()) return [];

    const tree = getDocumentTree(document.uri);
    if (!tree) return [];
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
    ]);

    const collectFolds = (node: SyntaxNode) => {
      if (FOLDABLE_NODES.has(node.type)) {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;
        if (endLine > startLine) {
          ranges.push({ startLine, endLine });
        }
      }
      // Block comments
      if (node.type === "Comment" || node.type === "comment") {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;
        if (endLine > startLine) {
          ranges.push({ startLine, endLine, kind: "comment" });
        }
      }
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (child) collectFolds(child);
      }
    };

    collectFolds(tree.rootNode);
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
          range: nodeRange(ancestor),
          parent: current,
        };
      }

      return current ?? { range: nodeRange(tree.rootNode) };
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

    for (let i = 0; i < indexData.tokens.length; i++) {
      const node = indexData.tokens[i]!;
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
