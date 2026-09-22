// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { computeEditRanges, UnifiedWorkspace } from "../src/index.js";

async function runTests() {
  console.log("Running UnifiedWorkspace tests...");

  // 1. computeEditRanges
  {
    const empty = computeEditRanges("model Foo end Foo;", "model Foo end Foo;");
    assert.strictEqual(empty.length, 0, "Identical strings should produce empty edit ranges");

    const prev = "model Foo\nend Foo;";
    const next = "model Foo\n  Real x;\nend Foo;";
    const ranges = computeEditRanges(prev, next);
    assert(ranges.length > 0, "Diff should produce edit ranges");
    assert.strictEqual(ranges[0].delta, next.length - prev.length, "Delta should match diff length");

    const prevId = "model MyModel end MyModel;";
    const nextId = "model MyNewModel end MyNewModel;";
    const rangesId = computeEditRanges(prevId, nextId);
    assert(rangesId.length > 0, "Identifier edit should produce ranges");
    console.log("✓ computeEditRanges tests passed");
  }

  // 2. Parser Registry
  {
    const ws = new UnifiedWorkspace();
    const mockParser = {
      parse: (input: string) => ({
        rootNode: {
          text: input,
          startIndex: 0,
          endIndex: input.length,
          descendantForIndex: (s: number, e: number) => ({ text: input.substring(s, e) }),
        },
      }),
    };

    ws.registerParser(".dummy", mockParser);
    assert.strictEqual(ws.getParser(".dummy"), mockParser, "Parser registered by .dummy");
    assert.strictEqual(ws.getParser("dummy"), mockParser, "Parser retrieved without dot");

    const tree = ws.parse(".dummy", "hello world");
    assert.strictEqual(tree.rootNode.text, "hello world", "Parsed text matches");
    console.log("✓ ParserRegistry tests passed");
  }

  // 3. Document Store & Auto Edit Ranges
  {
    const ws = new UnifiedWorkspace();
    ws.registerParser(".mo", {
      parse: (input: string) => ({
        rootNode: {
          text: input,
          startIndex: 0,
          endIndex: input.length,
          descendantForIndex: (s: number, e: number) => ({ text: input.substring(s, e) }),
        },
      }),
    });

    const res1 = ws.setDocument("file:///test.mo", "model A end A;");
    assert.strictEqual(res1.editRanges.length, 0, "Initial document has no edit ranges");
    assert.strictEqual(ws.getDocumentText("file:///test.mo"), "model A end A;");
    assert(ws.getDocumentTree("file:///test.mo") !== undefined, "Tree parsed on setDocument");

    const res2 = ws.setDocument("file:///test.mo", "model A\n  Real x;\nend A;");
    assert(res2.editRanges.length > 0, "Subsequent edit produces edit ranges");
    assert.strictEqual(res2.delta, "model A\n  Real x;\nend A;".length - "model A end A;".length);
    assert.strictEqual(ws.getDocument("file:///test.mo")?.version, 2, "Document version increments");
    console.log("✓ Document Store tests passed");
  }

  // 4. Default CST and Text Providers
  {
    const ws = new UnifiedWorkspace();
    ws.registerParser(".mo", {
      parse: (input: string) => ({
        rootNode: {
          text: input,
          startIndex: 0,
          endIndex: input.length,
          descendantForIndex: (s: number, e: number) => ({ text: input.substring(s, e) }),
        },
      }),
    });

    ws.setDocument("file:///test.mo", "model MyClass Real x; end MyClass;");

    const entry: any = {
      id: 1,
      name: "MyClass",
      resourceId: "file:///test.mo",
      startByte: 6,
      endByte: 13,
    };

    const text = ws.cstTextProvider!(entry.startByte, entry.endByte, entry);
    assert.strictEqual(text, "MyClass", "Default cstTextProvider returns correct slice");

    const mockSubWs: any = {
      toUnified: () => ({
        symbols: new Map([[1, entry]]),
        byName: new Map([["MyClass", [1]]]),
        childrenOf: new Map(),
      }),
      toUnifiedPartial: () => ({
        symbols: new Map([[1, entry]]),
        byName: new Map([["MyClass", [1]]]),
        childrenOf: new Map(),
      }),
    };
    ws.registerWorkspace("modelica", mockSubWs);

    const node: any = ws.cstNodeProvider!(1);
    assert(node !== null, "Default cstNodeProvider returns node");
    assert.strictEqual(node.text, "MyClass", "Default cstNodeProvider returns correct node text");
    console.log("✓ Default CST Providers tests passed");
  }

  // 5. Multi-Workspace Aggregation in toUnified
  {
    const ws = new UnifiedWorkspace();
    const entry1: any = { id: 1, name: "ClassM", kind: "Class" };
    const entry2: any = { id: 2, name: "DefS", kind: "Def" };

    const wsM: any = {
      toUnified: () => ({
        symbols: new Map([[1, entry1]]),
        byName: new Map([["ClassM", [1]]]),
        childrenOf: new Map([[0, [1]]]),
      }),
    };
    const wsS: any = {
      toUnified: () => ({
        symbols: new Map([[2, entry2]]),
        byName: new Map([["DefS", [2]]]),
        childrenOf: new Map([[0, [2]]]),
      }),
    };

    ws.registerWorkspace("modelica", wsM);
    ws.registerWorkspace("sysml2", wsS);

    const unified = ws.toUnified();
    assert.strictEqual(unified.symbols.size, 2, "Merged unified index has 2 symbols");
    assert.strictEqual(unified.symbols.get(1)?.name, "ClassM");
    assert.strictEqual(unified.symbols.get(1)?.language, "modelica");
    assert.strictEqual(unified.symbols.get(2)?.name, "DefS");
    assert.strictEqual(unified.symbols.get(2)?.language, "sysml2");
    assert.deepStrictEqual(unified.byName.get("ClassM"), [1]);
    assert.deepStrictEqual(unified.byName.get("DefS"), [2]);
    assert.deepStrictEqual(unified.childrenOf.get(0), [1, 2]);

    const symbolIdx = ws.toSymbolIndex();
    assert.strictEqual(symbolIdx.symbols.size, 2, "toSymbolIndex produces identical merged symbols");
    console.log("✓ Multi-Workspace Aggregation tests passed");
  }

  // 6. LanguageWorkspaceIndex and Composite Pattern Compliance
  {
    const { LanguageWorkspaceIndex, WorkspaceIndex, WasmWorkspaceIndex } = await import("../src/index.js");
    assert.strictEqual(LanguageWorkspaceIndex, WorkspaceIndex, "WorkspaceIndex is alias for LanguageWorkspaceIndex");
    assert.strictEqual(
      LanguageWorkspaceIndex,
      WasmWorkspaceIndex,
      "WasmWorkspaceIndex is alias for LanguageWorkspaceIndex",
    );

    const langIdx = new LanguageWorkspaceIndex();
    assert.strictEqual(langIdx.version, 0);
    assert.strictEqual(langIdx.fileCount, 0);

    const mockRootNode: any = {
      type: "model_clause",
      startIndex: 0,
      endIndex: 20,
      namedChildCount: 0,
      children: [],
    };

    // Test canonical indexDocument
    langIdx.indexDocument("file:///model.mo", () => mockRootNode);
    assert.strictEqual(langIdx.fileCount, 1, "File count is 1 after indexDocument");

    const symIdx = langIdx.toSymbolIndex();
    assert(symIdx !== undefined, "toSymbolIndex returns symbol index");
    assert.strictEqual(langIdx.toUnified(), symIdx, "toUnified alias returns same index as toSymbolIndex");

    // Test reindexDocument
    langIdx.reindexDocument("file:///model.mo", () => mockRootNode);
    assert(langIdx.version > 0, "Version bumps after reindex");

    // Test legacy markDirty alias
    const vBefore = langIdx.version;
    langIdx.markDirty("file:///model.mo", () => mockRootNode);
    assert(langIdx.version > vBefore, "Version bumps after markDirty");
    console.log("✓ LanguageWorkspaceIndex and aliases passed");
  }

  // 7. Automated Document Ingestion on setDocument
  {
    const { LanguageWorkspaceIndex } = await import("../src/index.js");
    const ws = new UnifiedWorkspace();
    const langWs = new LanguageWorkspaceIndex();

    ws.registerWorkspace("modelica", langWs);
    ws.registerParser(".mo", {
      parse: (text: string) => ({
        rootNode: {
          type: "model_clause",
          text,
          startIndex: 0,
          endIndex: text.length,
          namedChildCount: 0,
          children: [],
          descendantForIndex: (s: number, e: number) => ({ text: text.substring(s, e) }),
        },
      }),
    });

    // Calling setDocument should automatically index into langWs
    ws.setDocument("file:///auto.mo", "model Auto end Auto;");
    assert.strictEqual(langWs.fileCount, 1, "Language workspace automatically indexed document");
    assert.strictEqual(ws.fileCount, 1, "UnifiedWorkspace fileCount is 1");
    assert(langWs.has("file:///auto.mo"), "Language workspace contains document URI");

    console.log("✓ Automated Document Ingestion on setDocument passed");
  }

  // 8. Coordinated Document Deletion
  {
    const { LanguageWorkspaceIndex } = await import("../src/index.js");
    const ws = new UnifiedWorkspace();
    const langWs = new LanguageWorkspaceIndex();

    ws.registerWorkspace("modelica", langWs);
    ws.registerParser(".mo", {
      parse: (text: string) => ({
        rootNode: {
          type: "model_clause",
          text,
          startIndex: 0,
          endIndex: text.length,
          namedChildCount: 0,
          children: [],
        },
      }),
    });

    ws.setDocument("file:///temp.mo", "model Temp end Temp;");
    assert.strictEqual(langWs.fileCount, 1);
    assert.strictEqual(ws.fileCount, 1);

    const deleted = ws.deleteDocument("file:///temp.mo");
    assert.strictEqual(deleted, true, "Document successfully deleted");
    assert.strictEqual(ws.fileCount, 0, "UnifiedWorkspace fileCount is now 0");
    assert.strictEqual(langWs.fileCount, 0, "Language workspace stubs cleared for deleted document");

    console.log("✓ Coordinated Document Deletion passed");
  }

  // 9. First-Class CST & Query Methods on UnifiedWorkspace
  {
    const ws = new UnifiedWorkspace();
    ws.cstNodeProvider = (id: number) => ({ id, kind: "test-node" });
    ws.cstTextProvider = (start: number, end: number, entry: any) => `text_${entry.name}_${start}_${end}`;
    ws.queryProvider = (queryName: string, id: number) => ({ query: queryName, target: id });

    const node = ws.getCstNode(42);
    assert.deepStrictEqual(node, { id: 42, kind: "test-node" });

    const text = ws.getCstText(0, 10, { name: "Foo" } as any);
    assert.strictEqual(text, "text_Foo_0_10");

    const queryResult = ws.query("typeOf", 42);
    assert.deepStrictEqual(queryResult, { query: "typeOf", target: 42 });

    console.log("✓ First-class CST & Query methods passed");
  }

  console.log("All UnifiedWorkspace tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
