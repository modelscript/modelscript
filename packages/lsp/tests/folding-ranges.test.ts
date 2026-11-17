// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { registerDocumentFeaturesProvider } from "../src/providers/documentFeaturesProvider.js";
import { globalLanguageRegistry, type LanguagePlugin } from "../src/registry/LanguageRegistry.js";

test("Grammar-based folding ranges, comment scanning, and default-collapsed lines", async () => {
  const requestHandlers = new Map<string, (...args: any[]) => any>();
  let foldingHandler: ((params: any) => any) | null = null;

  const mockConnection: any = {
    onDocumentSymbol: () => {},
    onFoldingRanges: (cb: (params: any) => any) => {
      foldingHandler = cb;
    },
    onSelectionRanges: () => {},
    onDocumentHighlight: () => {},
    onRequest: (method: string, cb: (...args: any[]) => any) => {
      requestHandlers.set(method, cb);
    },
    console: { warn: () => {}, error: () => {} },
  };

  const uri = "file:///test/FoldSample.mo";
  const text = [
    "/* Header",
    "   block comment */",
    "model FoldSample",
    "  import Modelica.Units.SI;",
    "  Real x;",
    "  // line comment 1",
    "  // line comment 2",
    "equation",
    "  der(x) = -x;",
    "  annotation (",
    "    Icon(graphics={Rectangle(extent={{-100,-100},{100,100}})}),",
    '    Documentation(info="<html>hi</html>")',
    "  );",
    "end FoldSample;",
  ].join("\n");

  const doc = TextDocument.create(uri, "modelica", 1, text);
  const mockDocuments: any = {
    get: (u: string) => (u === uri ? doc : undefined),
    all: () => [doc],
  };

  // Mock CST matching Modelica rule names
  const mockTree = {
    rootNode: {
      type: "stored_definition",
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 13, column: 15 },
      children: [
        {
          type: "class_definition",
          startPosition: { row: 2, column: 0 },
          endPosition: { row: 13, column: 15 },
          children: [
            {
              type: "import_clause",
              startPosition: { row: 3, column: 2 },
              endPosition: { row: 3, column: 27 },
              children: [],
            },
            {
              type: "equation_section",
              startPosition: { row: 7, column: 0 },
              endPosition: { row: 8, column: 14 },
              children: [],
            },
            {
              type: "annotation_clause",
              startPosition: { row: 9, column: 2 },
              endPosition: { row: 12, column: 3 },
              children: [],
            },
          ],
        },
      ],
    },
  };

  const prevPlugin = globalLanguageRegistry.getPluginForUri(uri);
  const testPlugin: LanguagePlugin = {
    id: "modelica",
    name: "Modelica",
    extensions: [".mo"],
    languageDef: {
      lsp: {
        folding: [
          "class_definition",
          "equation_section",
          { rule: "import_clause", kind: "imports" },
          { rule: "annotation_clause", kind: "region", defaultCollapsed: true, collapsedText: "annotation(...)" },
        ],
      },
    },
  };
  globalLanguageRegistry.register(testPlugin);

  try {
    registerDocumentFeaturesProvider(
      mockConnection,
      mockDocuments,
      new Map(),
      () => mockTree,
      () => null,
      () => true,
      () => false,
      () => null,
    );

    assert.ok(foldingHandler, "onFoldingRanges handler should be registered");
    const ranges = foldingHandler!({ textDocument: { uri } });

    // Multi-line block comment (lines 0-1)
    assert.ok(ranges.some((r: any) => r.startLine === 0 && r.endLine === 1 && r.kind === "comment"));
    // Consecutive // comments (lines 5-6)
    assert.ok(ranges.some((r: any) => r.startLine === 5 && r.endLine === 6 && r.kind === "comment"));
    // class_definition (lines 2-13)
    assert.ok(ranges.some((r: any) => r.startLine === 2 && r.endLine === 13));
    // equation_section (lines 7-8)
    assert.ok(ranges.some((r: any) => r.startLine === 7 && r.endLine === 8));
    // Single-line import_clause should not produce a folding range
    assert.ok(!ranges.some((r: any) => r.startLine === 3 && r.endLine === 3));
    // annotation_clause (lines 9-12) with region kind & collapsedText, and defaultCollapsed stripped from LSP output
    const annRange = ranges.find((r: any) => r.startLine === 9 && r.endLine === 12);
    assert.ok(annRange, "annotation_clause folding range should exist");
    assert.strictEqual(annRange.kind, "region");
    assert.strictEqual(annRange.collapsedText, "annotation(...)");
    assert.strictEqual("defaultCollapsed" in annRange, false);

    // modelscript/getDefaultFoldLines should return [9]
    const defaultFoldHandler = requestHandlers.get("modelscript/getDefaultFoldLines");
    assert.ok(defaultFoldHandler, "modelscript/getDefaultFoldLines handler should be registered");
    const defaultFoldRes = defaultFoldHandler!({ textDocument: { uri } });
    assert.deepStrictEqual(defaultFoldRes, { lines: [9] });
  } finally {
    if (prevPlugin) {
      globalLanguageRegistry.register(prevPlugin);
    }
  }
});
