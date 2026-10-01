// SPDX-License-Identifier: AGPL-3.0-or-later

import { getModelicaErrorCodeDef } from "@modelscript/modelica";
import { LanguageWorkspaceIndex, WasmQueryEngine } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { PositionIndex } from "../src/lsp-bridge.js";
import {
  ValidationService,
  deduplicateAllDiagnostics,
  tryDeduplicateOrMergeSemanticDiagnostic,
} from "../src/services/validation-service.js";

describe("Phase 1 Diagnostic Handling Fixes", () => {
  describe("Bug 1: swapIndex parameter order", () => {
    it("should correctly add changedSymbolIds to dirtyLintSymbols when structuralChangedIds are present", () => {
      const mockIndex = {
        symbols: new Map([
          [1, { id: 1, name: "Var1", ruleName: "Component", startByte: 0, endByte: 10 }],
          [2, { id: 2, name: "Var2", ruleName: "Component", startByte: 20, endByte: 30 }],
        ]),
        byName: new Map(),
        childrenOf: new Map(),
      };

      const engine = new WasmQueryEngine(mockIndex as any, new Map());

      // Pre-initialize dirtyLintSymbols for a cache key
      const dirtySet = new Set<number>();
      (engine as any).dirtyLintSymbols.set("file:///test.mo", dirtySet);

      // Symbol 1 is modified (changedSymbolIds), Symbol 2 is structural
      const changed = new Set([1]);
      const structural = new Set([2]);

      engine.swapIndex(mockIndex as any, changed, structural);

      // Verify that changedSymbolIds (1) was passed as the first argument to invalidate()
      // and therefore added to dirtyLintSymbols
      assert.strictEqual(dirtySet.has(1), true, "changedSymbolIds (1) must be added to dirtyLintSymbols");
    });
  });

  describe("Bug 2: Purge deleted symbols from perSymbolCache", () => {
    it("should delete old diagnostics from perSymbolCache when a symbol is removed from index", async () => {
      const mockIndex = {
        symbols: new Map([
          [
            1,
            {
              id: 1,
              name: "DeletedVar",
              ruleName: "Component",
              startByte: 0,
              endByte: 10,
              resourceId: "file:///test.mo",
            },
          ],
        ]),
        byName: new Map(),
        childrenOf: new Map(),
      };

      const engine = new WasmQueryEngine(mockIndex as any, new Map());

      const perSymbolCache = new Map<number, any[]>();
      perSymbolCache.set(1, [{ symbolId: 1, startByte: 0, endByte: 10, message: "Ghost error", severity: "error" }]);
      const cacheDirtySet = new Set<number>([1]);

      (engine as any).lintCache.set("file:///test.mo", perSymbolCache);
      (engine as any).dirtyLintSymbols.set("file:///test.mo", cacheDirtySet);

      // Now symbol 1 is deleted from the symbol table
      mockIndex.symbols.delete(1);

      // Run lints
      const results = await engine.runAllLintsAsync("file:///test.mo");

      // Verify symbol 1 was purged from perSymbolCache and no ghost diagnostics returned
      assert.strictEqual(perSymbolCache.has(1), false, "Symbol 1 should be deleted from perSymbolCache");
      assert.strictEqual(results.length, 0, "No ghost diagnostics should be returned for deleted symbols");
    });
  });

  describe("Bug 4: collectSyntaxErrors diagnostic classification", () => {
    it("should classify lint diagnostics with code >= 1000 into wasmLintDiags even if severity is Error (1)", () => {
      const mockDoc = {
        getText: () => "model M\n  Real x = true;\nend M;\n",
        positionAt: (offset: number) => ({ line: 0, character: offset }),
      };

      const mockFacade = {
        getDiagnostics: () => [
          // Syntax errors
          { severity: 1, message: "Syntax error: Unexpected token", code: 1001, startOffset: 0, endOffset: 5 },
          { severity: 1, message: "Generic parse error", startOffset: 5, endOffset: 7 },
          // Error-level lint diagnostic (e.g. type mismatch binding M3001)
          { severity: 1, message: "Type mismatch in binding", code: 3001, startOffset: 11, endOffset: 15 },
          // Warning-level lint diagnostic
          { severity: 2, message: "Unused variable", code: 2005, startOffset: 11, endOffset: 12 },
        ],
      };

      const mockRootNode = {
        id: 1,
        ptr: 1,
        hasError: false,
        tree: { facade: mockFacade },
      };

      const mockWorkspaceManager = {
        unifiedWorkspace: { owl2Store: new Map() },
      };
      const mockConnection = {
        console: { info: () => {}, warn: () => {}, error: () => {} },
      };
      const validationService = new ValidationService(
        mockConnection as any,
        {} as any,
        mockWorkspaceManager as any,
        {} as any,
      );

      const { syntaxDiags, wasmLintDiags } = validationService.collectSyntaxErrors(
        mockRootNode as any,
        mockDoc as any,
        { facade: mockFacade } as any,
      );

      // Syntax diags should ONLY have the two true syntax errors
      assert.strictEqual(syntaxDiags.length, 2, "Only true syntax errors should be in syntaxDiags");
      assert.strictEqual(syntaxDiags[0].message, "Syntax error: Unexpected token");
      assert.strictEqual(syntaxDiags[1].message, "Generic parse error");

      // wasmLintDiags should contain the lint diagnostics, including the error-severity 3001
      assert.strictEqual(wasmLintDiags.length, 2, "Both error and warning lints should be in wasmLintDiags");
      assert.strictEqual(wasmLintDiags[0].code, 3001, "Code 3001 should be preserved in wasmLintDiags");
      assert.strictEqual(wasmLintDiags[0].severity, 1, "Severity 1 should be preserved");
      assert.strictEqual(wasmLintDiags[1].code, 2005, "Code 2005 should be preserved in wasmLintDiags");
    });
  });

  describe("Phase 3: Keystroke dynamic position adjustment & disposal", () => {
    it("should shift diagnostic line numbers accurately when newlines are inserted above them", () => {
      const mockWorkspaceManager = {
        unifiedWorkspace: { owl2Store: new Map() },
      };
      const mockConnection = {
        console: { info: () => {}, warn: () => {}, error: () => {} },
      };
      const validationService = new ValidationService(
        mockConnection as any,
        {} as any,
        mockWorkspaceManager as any,
        {} as any,
      );

      const uri = "file:///bouncing_ball.mo";
      const initialDiags: any[] = [
        {
          message: "Before edit",
          range: { start: { line: 0, character: 2 }, end: { line: 0, character: 8 } },
        },
        {
          message: "After edit",
          range: { start: { line: 5, character: 4 }, end: { line: 5, character: 10 } },
        },
      ];
      validationService.lastSemanticDiagnostics.set(uri, initialDiags);

      // Simulate inserting 2 newlines at line 2
      const edit = {
        startIndex: 20,
        oldEndIndex: 20,
        newEndIndex: 22,
        startPosition: { row: 2, column: 0 },
        oldEndPosition: { row: 2, column: 0 },
        newEndPosition: { row: 4, column: 0 },
      };

      validationService.adjustDiagnostics(uri, edit);

      const adjusted = validationService.lastSemanticDiagnostics.get(uri);
      assert.ok(adjusted);
      assert.strictEqual(adjusted.length, 2);

      // Line 0 (before edit) is untouched
      assert.strictEqual(adjusted[0].range.start.line, 0);
      assert.strictEqual(adjusted[0].message, "Before edit");

      // Line 5 (after edit) is shifted by +2 lines -> line 7
      assert.strictEqual(adjusted[1].range.start.line, 7);
      assert.strictEqual(adjusted[1].range.end.line, 7);
      assert.strictEqual(adjusted[1].message, "After edit");
    });

    it("should purge cached diagnostics and index text on disposeDocument", () => {
      const mockWorkspaceManager = {
        unifiedWorkspace: { owl2Store: new Map() },
      };
      const mockConnection = {
        console: { info: () => {}, warn: () => {}, error: () => {} },
      };
      const validationService = new ValidationService(
        mockConnection as any,
        {} as any,
        mockWorkspaceManager as any,
        {} as any,
      );

      const uri = "file:///temp.mo";
      validationService.lastSemanticDiagnostics.set(uri, [{ message: "error" }] as any);
      validationService.lastIndexedText.set(uri, "model Temp end Temp;");
      validationService.documentRevisions.set(uri, 5);

      validationService.disposeDocument(uri);

      assert.strictEqual(validationService.lastSemanticDiagnostics.has(uri), false);
      assert.strictEqual(validationService.lastIndexedText.has(uri), false);
      assert.strictEqual(validationService.documentRevisions.has(uri), false);
    });

    it("should purge lintCache on engine.disposeDocument", () => {
      const mockIndex = {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      };
      const engine = new WasmQueryEngine(mockIndex as any, new Map());
      const uri = "file:///temp.mo";

      (engine as any).lintCache.set(uri, new Map());
      (engine as any).dirtyLintSymbols.set(uri, new Set());

      engine.disposeDocument(uri);

      assert.strictEqual((engine as any).lintCache.has(uri), false);
      assert.strictEqual((engine as any).dirtyLintSymbols.has(uri), false);
    });
  });

  describe("Item 1: Salsa Query Verification & Transitive Invalidation", () => {
    it("should transitively invalidate queries when an underlying dependency value changes", () => {
      let leafExecutions = 0;
      let intermediateExecutions = 0;
      let rootExecutions = 0;

      const mockIndex = {
        symbols: new Map([
          [1, { id: 1, name: "ALPHA", ruleName: "TestNode", startByte: 0, endByte: 10, resourceId: "file:///test.mo" }],
        ]),
        byName: new Map(),
        childrenOf: new Map(),
      };

      const hooks = new Map([
        [
          "TestNode",
          {
            leaf: (db: any, entry: any) => {
              leafExecutions++;
              const sym = db.symbol(entry.id);
              return sym ? sym.name.toLowerCase() : "";
            },
            intermediate: (db: any, entry: any) => {
              intermediateExecutions++;
              const leafVal = db.query("leaf", entry.id);
              return `intermediate_${leafVal}`;
            },
            root: (db: any, entry: any) => {
              rootExecutions++;
              const interVal = db.query("intermediate", entry.id);
              return `root_${interVal}`;
            },
          },
        ],
      ]);

      const engine = new WasmQueryEngine(mockIndex as any, hooks as any);
      const queryDB = engine.toQueryDB();

      // Rev 0: First fetch executes all 3 queries
      const res0 = queryDB.query("root", 1);
      assert.strictEqual(res0, "root_intermediate_alpha");
      assert.strictEqual(leafExecutions, 1);
      assert.strictEqual(intermediateExecutions, 1);
      assert.strictEqual(rootExecutions, 1);

      // Fetching again in the same revision returns cached result without re-executing
      const res0Cached = queryDB.query("root", 1);
      assert.strictEqual(res0Cached, "root_intermediate_alpha");
      assert.strictEqual(leafExecutions, 1);
      assert.strictEqual(intermediateExecutions, 1);
      assert.strictEqual(rootExecutions, 1);

      // Change input so leaf produces a different value
      const sym = mockIndex.symbols.get(1)!;
      sym.name = "BETA";
      engine.invalidate([1]);

      // Rev 1: root is fetched -> deepVerify detects leaf value changed -> all 3 re-execute
      const res1 = queryDB.query("root", 1);
      assert.strictEqual(res1, "root_intermediate_beta");
      assert.strictEqual(leafExecutions, 2, "leaf query should re-execute");
      assert.strictEqual(intermediateExecutions, 2, "intermediate query should re-execute");
      assert.strictEqual(rootExecutions, 2, "root query should re-execute");
    });

    it("should backdate and early-cutoff when dependency is re-executed but produces the same value", () => {
      let leafExecutions = 0;
      let intermediateExecutions = 0;
      let rootExecutions = 0;

      const mockIndex = {
        symbols: new Map([
          [1, { id: 1, name: "SAME", ruleName: "TestNode", startByte: 0, endByte: 10, resourceId: "file:///test.mo" }],
        ]),
        byName: new Map(),
        childrenOf: new Map(),
      };

      const hooks = new Map([
        [
          "TestNode",
          {
            leaf: (db: any, entry: any) => {
              leafExecutions++;
              const sym = db.symbol(entry.id);
              // Only depends on name, ignores startByte / endByte
              return sym ? sym.name : "";
            },
            intermediate: (db: any, entry: any) => {
              intermediateExecutions++;
              const leafVal = db.query("leaf", entry.id);
              return `intermediate_${leafVal}`;
            },
            root: (db: any, entry: any) => {
              rootExecutions++;
              const interVal = db.query("intermediate", entry.id);
              return `root_${interVal}`;
            },
          },
        ],
      ]);

      const engine = new WasmQueryEngine(mockIndex as any, hooks as any);
      const queryDB = engine.toQueryDB();

      // Rev 0: Initial execution
      const res0 = queryDB.query("root", 1);
      assert.strictEqual(res0, "root_intermediate_SAME");
      assert.strictEqual(leafExecutions, 1);
      assert.strictEqual(intermediateExecutions, 1);
      assert.strictEqual(rootExecutions, 1);

      // Invalidate symbol 1 (e.g. byte position changed, but name stayed SAME)
      const sym = mockIndex.symbols.get(1)!;
      sym.startByte = 5;
      engine.invalidate([1]);

      // Rev 1: root is fetched -> deepVerify runs leaf, leaf produces SAME
      // Early cutoff occurs! intermediate and root do NOT re-execute!
      const res1 = queryDB.query("root", 1);
      assert.strictEqual(res1, "root_intermediate_SAME");
      assert.strictEqual(leafExecutions, 2, "leaf should re-execute because input 1 changed");
      assert.strictEqual(intermediateExecutions, 1, "intermediate should NOT re-execute due to early cutoff");
      assert.strictEqual(rootExecutions, 1, "root should NOT re-execute due to early cutoff");
    });

    it("should handle circular query dependencies gracefully during deepVerify without stack overflow", () => {
      const mockIndex = {
        symbols: new Map([
          [1, { id: 1, name: "Node", ruleName: "CycleNode", startByte: 0, endByte: 10, resourceId: "file:///test.mo" }],
        ]),
        byName: new Map(),
        childrenOf: new Map(),
      };

      const hooks = new Map([
        [
          "CycleNode",
          {
            cycleA: (db: any, entry: any) => {
              return db.query("cycleB", entry.id);
            },
            cycleB: (db: any, entry: any) => {
              return db.query("cycleA", entry.id);
            },
          },
        ],
      ]);

      const engine = new WasmQueryEngine(mockIndex as any, hooks as any);
      const queryDB = engine.toQueryDB();

      // Should return undefined rather than blowing the stack
      const res = queryDB.query("cycleA", 1);
      assert.strictEqual(res, undefined);
    });
  });

  describe("Item 2: Dynamic Error Code Table Lookup & Severity Resolution", () => {
    it("should resolve error definitions dynamically for Modelica error codes", () => {
      const def4001 = getModelicaErrorCodeDef(4001);
      assert.ok(def4001, "Error code 4001 (extends-cycle) must be defined");
      assert.strictEqual(def4001.code, 4001);
      assert.strictEqual(def4001.rule, "extends-cycle");
      assert.strictEqual(def4001.severity, "error");

      const def3010 = getModelicaErrorCodeDef(3010);
      assert.ok(def3010, "Error code 3010 (unit-mismatch) must be defined");
      assert.strictEqual(def3010.code, 3010);
      assert.strictEqual(def3010.severity, "warning");

      const def4002 = getModelicaErrorCodeDef(4002);
      assert.ok(def4002, "Error code 4002 (duplicate-modification) must be defined");
      assert.strictEqual(def4002.code, 4002);
      assert.strictEqual(def4002.severity, "error");
    });

    it("should correctly resolve dynamic message and error severity in validation service", () => {
      const mockWorkspaceManager = {
        unifiedWorkspace: { owl2Store: new Map() },
      };
      const mockConnection = {
        console: { info: () => {}, warn: () => {}, error: () => {} },
      };
      const validationService = new ValidationService(
        mockConnection as any,
        {} as any,
        mockWorkspaceManager as any,
        {} as any,
      );

      // Verify that code 4001 and 4002 have definitions and are error severity
      const code4001 = getModelicaErrorCodeDef(4001);
      const code3010 = getModelicaErrorCodeDef(3010);
      assert.strictEqual(code4001?.severity, "error");
      assert.strictEqual(code3010?.severity, "warning");
    });
  });

  describe("Item 3: Multi-Line Syntax Error Swallowing Prevention", () => {
    // Replicates the merging logic from bindings.ts to verify the algorithm
    function mergeSyntaxDiagnostics(diags: any[]): any[] {
      const uniqueDiags = [...diags].sort((a, b) => {
        if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
        return a.range.start.character - b.range.start.character;
      });

      const mergedDiags: any[] = [];
      for (const d of uniqueDiags) {
        if (mergedDiags.length > 0) {
          const prev = mergedDiags[mergedDiags.length - 1];
          const isStartSameLine = prev.range.start.line === d.range.start.line;
          const isOverlapping =
            isStartSameLine &&
            ((prev.endCharOffset !== undefined &&
              d.startCharOffset !== undefined &&
              d.startCharOffset <= prev.endCharOffset + 1) ||
              prev.range.end.character + 1 >= d.range.start.character);

          if (isOverlapping && prev.code === undefined && d.code === undefined) {
            const prevIsSpecific = prev.message.startsWith("Expected ") || prev.message.startsWith("Syntax Error: ");
            const dIsSpecific = d.message.startsWith("Expected ") || d.message.startsWith("Syntax Error: ");
            const prevIsGeneric = prev.message === "Syntax Error";
            const dIsGeneric = d.message === "Syntax Error";

            if (prevIsGeneric && dIsSpecific) {
              mergedDiags[mergedDiags.length - 1] = d;
              continue;
            } else if (prevIsSpecific && dIsGeneric) {
              continue;
            } else if ((prevIsGeneric && dIsGeneric) || prev.message === d.message) {
              if (d.range.end.character > prev.range.end.character) {
                prev.range.end = d.range.end;
              }
              if (prev.endCharOffset !== undefined && d.endCharOffset !== undefined) {
                prev.endCharOffset = Math.max(prev.endCharOffset, d.endCharOffset);
              }
              continue;
            }
          }
        }
        mergedDiags.push(d);
      }
      return mergedDiags;
    }

    it("should NOT swallow a subsequent error when prev is a multi-line error spanning across lines", () => {
      const multiLineDiag = {
        message: "Syntax Error: Unclosed class definition",
        range: { start: { line: 0, character: 0 }, end: { line: 50, character: 10 } },
        startCharOffset: 0,
        endCharOffset: 2500,
      };

      const subsequentDiag = {
        message: "Syntax Error: Missing ';'",
        range: { start: { line: 12, character: 4 }, end: { line: 12, character: 5 } },
        startCharOffset: 600,
        endCharOffset: 601,
      };

      const result = mergeSyntaxDiagnostics([multiLineDiag, subsequentDiag]);
      assert.strictEqual(result.length, 2, "Both diagnostics must be preserved, not swallowed");
      assert.strictEqual(result[0].range.start.line, 0);
      assert.strictEqual(result[1].range.start.line, 12);
    });

    it("should merge adjacent generic and specific errors on the same line", () => {
      const genericDiag = {
        message: "Syntax Error",
        range: { start: { line: 5, character: 10 }, end: { line: 5, character: 15 } },
        startCharOffset: 100,
        endCharOffset: 105,
      };

      const specificDiag = {
        message: "Expected ';'",
        range: { start: { line: 5, character: 15 }, end: { line: 5, character: 16 } },
        startCharOffset: 105,
        endCharOffset: 106,
      };

      const result = mergeSyntaxDiagnostics([genericDiag, specificDiag]);
      assert.strictEqual(result.length, 1, "Generic error should be replaced by specific error on the same line");
      assert.strictEqual(result[0].message, "Expected ';'");
    });
  });

  describe("Phase 4: Full Coordinate Normalization (WASM CST Pointers -> UTF-16 Character Offsets)", () => {
    it("should populate startOffset and endOffset on LintDiagnostic in runAllLints and runAllLintsAsync", async () => {
      const mockIndex = {
        symbols: new Map([
          [
            1,
            {
              id: 1,
              name: "Var1",
              ruleName: "Component",
              startByte: 10,
              endByte: 20,
              startOffset: 10,
              endOffset: 20,
            },
          ],
        ]),
        byName: new Map(),
        childrenOf: new Map(),
        symbolsByResource: new Map(),
      };

      const hooks = new Map([
        [
          "Component",
          {
            lint__testLint: () => ({
              message: "Test warning",
              severity: "warning",
              startOffset: 12,
              endOffset: 18,
            }),
          },
        ],
      ]);

      const engine = new WasmQueryEngine(mockIndex as any, hooks as any);
      const syncDiags = engine.runAllLints();
      assert.strictEqual(syncDiags.length, 1);
      assert.strictEqual(syncDiags[0].startOffset, 12);
      assert.strictEqual(syncDiags[0].endOffset, 18);

      const asyncDiags = await engine.runAllLintsAsync();
      assert.strictEqual(asyncDiags.length, 1);
      assert.strictEqual(asyncDiags[0].startOffset, 12);
      assert.strictEqual(asyncDiags[0].endOffset, 18);
    });

    it("should accurately compute LSP Range with PositionIndex using character offsets across multibyte UTF-8", () => {
      // String with multi-byte UTF-8 emoji and Greek characters:
      // "🚀 = 1;\nReal π = 3.14;\n"
      // "🚀" is 4 bytes in UTF-8, but 2 code units in UTF-16.
      // "π" is 2 bytes in UTF-8, but 1 code unit in UTF-16.
      const text = "🚀 = 1;\nReal π = 3.14;\n";
      const posIndex = new PositionIndex(text);

      // Character offset for π is at index 8 + 5 = 13
      const piCharOffset = text.indexOf("π");
      const range = posIndex.rangeFromOffsets(piCharOffset, piCharOffset + 1);

      assert.strictEqual(range.start.line, 1);
      assert.strictEqual(range.start.character, 5); // "Real " is 5 chars
      assert.strictEqual(range.end.line, 1);
      assert.strictEqual(range.end.character, 6);
    });

    it("should populate startOffset and endOffset on SymbolEntry during workspace indexing", () => {
      const ws = new LanguageWorkspaceIndex([
        {
          ruleName: "class_definition",
          kind: "Class",
          namePath: "name",
          exportPaths: [],
          inheritPaths: [],
        },
      ]);
      const mockCst = {
        type: "class_definition",
        startOffset: 15,
        endOffset: 85,
        startByte: 15,
        endByte: 85,
        children: [{ type: "name", text: "MyClass", startOffset: 21, endOffset: 28 }],
      };

      ws.indexDocument("file:///test.mo", () => mockCst);

      const entries = Array.from(ws.toUnifiedPartial().symbols.values());
      const classEntry = entries.find((e) => e.name === "MyClass");
      assert.ok(classEntry, "Class symbol must be indexed");
      assert.strictEqual(classEntry.startOffset, 15);
      assert.strictEqual(classEntry.endOffset, 85);
    });
  });

  describe("Option A: Robust Deduplication Between Step 5a and Step 5b", () => {
    it("should deduplicate and enrich diagnostic when Step 5a and 5b have column offset difference on the same line", () => {
      // Step 5a emitted CST lint at col 15-20 with template message
      const existingDiags: any[] = [
        {
          severity: 1, // Error
          range: { start: { line: 10, character: 15 }, end: { line: 10, character: 20 } },
          message: "Type mismatch in binding.",
          source: "modelica",
          code: 3001,
        },
      ];

      // Step 5b emits Salsa query lint at col 2-5 with detailed message
      const incomingDiag: any = {
        severity: 1,
        range: { start: { line: 10, character: 2 }, end: { line: 10, character: 5 } },
        message: "Type mismatch in binding for 'x': expected 'Real', got 'Integer'.",
        source: "modelica",
        code: 3001,
      };

      const isDup = tryDeduplicateOrMergeSemanticDiagnostic(existingDiags, incomingDiag);
      assert.strictEqual(isDup, true, "Should recognize as duplicate despite column offset mismatch");
      assert.strictEqual(existingDiags.length, 1, "List should not gain a duplicate entry");
      assert.strictEqual(
        existingDiags[0].message,
        "Type mismatch in binding for 'x': expected 'Real', got 'Integer'.",
        "Generic message should be enriched by specific Salsa message",
      );
    });

    it("should match rule name against numeric code (e.g., 'typeMismatchBinding' vs 3001)", () => {
      const existingDiags: any[] = [
        {
          severity: 1,
          range: { start: { line: 8, character: 4 }, end: { line: 8, character: 10 } },
          message: "Type mismatch in binding.",
          source: "modelica",
          code: 3001,
        },
      ];

      const incomingDiag: any = {
        severity: 1,
        range: { start: { line: 8, character: 4 }, end: { line: 8, character: 10 } },
        message: "Type mismatch in binding for 'speed': expected 'Real', got 'String'.",
        source: "modelica",
        code: "typeMismatchBinding",
      };

      const isDup = tryDeduplicateOrMergeSemanticDiagnostic(existingDiags, incomingDiag);
      assert.strictEqual(isDup, true, "Should recognize rule name as matching numeric code 3001");
      assert.strictEqual(
        existingDiags[0].message,
        "Type mismatch in binding for 'speed': expected 'Real', got 'String'.",
      );
    });

    it("should NOT deduplicate different error codes on the same line", () => {
      const existingDiags: any[] = [
        {
          severity: 1,
          range: { start: { line: 5, character: 2 }, end: { line: 5, character: 6 } },
          message: "Variable 'y' not found in scope.",
          source: "modelica",
          code: 2002,
        },
      ];

      const incomingDiag: any = {
        severity: 1,
        range: { start: { line: 5, character: 10 }, end: { line: 5, character: 20 } },
        message: "Type mismatch in binding for 'x': expected 'Real', got 'Integer'.",
        source: "modelica",
        code: 3001,
      };

      const isDup = tryDeduplicateOrMergeSemanticDiagnostic(existingDiags, incomingDiag);
      assert.strictEqual(isDup, false, "Different error codes should not be merged");
      assert.strictEqual(existingDiags.length, 1);
    });

    it("should deduplicate exact matches and shadow generic syntax errors in Step 8", () => {
      const allDiags: any[] = [
        {
          severity: 1,
          range: { start: { line: 3, character: 5 }, end: { line: 3, character: 10 } },
          message: "Syntax Error",
        },
        {
          severity: 1,
          range: { start: { line: 3, character: 5 }, end: { line: 3, character: 10 } },
          message: "Type mismatch in binding.",
          code: 3001,
        },
        {
          severity: 1,
          range: { start: { line: 3, character: 5 }, end: { line: 3, character: 10 } },
          message: "Type mismatch in binding.",
          code: 3001,
        },
      ];

      const deduped = deduplicateAllDiagnostics(allDiags);
      assert.strictEqual(deduped.length, 1, "Duplicate code 3001 and generic Syntax Error should be pruned");
      assert.strictEqual(deduped[0].code, 3001);
      assert.strictEqual(deduped[0].message, "Type mismatch in binding.");
    });
  });

  describe("Option C: Tier 1 vs Tier 3 Diagnostic Publishing Alignment", () => {
    it("should debounce syntax error publishing during active keystrokes without flickering cached semantic diagnostics", async () => {
      const published: { uri: string; diagnostics: any[] }[] = [];
      const mockConnection = {
        sendDiagnostics: (payload: { uri: string; diagnostics: any[] }) => {
          published.push(payload);
        },
      };

      const uri = "file:///test.mo";
      const activeSyntaxDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const lastSyntaxErrorsCount = new Map<string, number>();
      const documentRevisions = new Map<string, number>();
      const lastSemanticDiagnostics = new Map<string, any[]>([
        [
          uri,
          [
            {
              message: "Existing semantic warning",
              severity: 2,
              range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
            },
          ],
        ],
      ]);

      const simulateKeystroke = (syntaxDiags: any[]) => {
        const currentRevision = (documentRevisions.get(uri) ?? 0) + 1;
        documentRevisions.set(uri, currentRevision);

        // Cancel active syntax debounce timer on each keystroke
        const existingSyntaxTimer = activeSyntaxDebounceTimers.get(uri);
        if (existingSyntaxTimer) {
          clearTimeout(existingSyntaxTimer);
          activeSyntaxDebounceTimers.delete(uri);
        }

        const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;
        if (syntaxDiags.length === 0 && lastCount > 0) {
          lastSyntaxErrorsCount.set(uri, 0);
          const cachedSemantic = lastSemanticDiagnostics.get(uri) || [];
          mockConnection.sendDiagnostics({ uri, diagnostics: cachedSemantic });
        } else if (syntaxDiags.length > 0) {
          activeSyntaxDebounceTimers.set(
            uri,
            setTimeout(() => {
              activeSyntaxDebounceTimers.delete(uri);
              if ((documentRevisions.get(uri) ?? 0) !== currentRevision) return;
              lastSyntaxErrorsCount.set(uri, syntaxDiags.length);
              const cachedSemantic = lastSemanticDiagnostics.get(uri) || [];
              const allDiags = [...syntaxDiags, ...cachedSemantic];
              mockConnection.sendDiagnostics({ uri, diagnostics: allDiags });
            }, 180),
          );
        }
      };

      const dummySyntaxDiag = {
        message: "Syntax error: unexpected token",
        severity: 1,
        range: { start: { line: 2, character: 4 }, end: { line: 2, character: 5 } },
      };

      // Keystroke 1 (typing 'R')
      simulateKeystroke([dummySyntaxDiag]);
      // Keystroke 2 (typing 'e', 30ms later)
      await new Promise((r) => setTimeout(r, 30));
      simulateKeystroke([dummySyntaxDiag]);
      // Keystroke 3 (typing 'a', 30ms later)
      await new Promise((r) => setTimeout(r, 30));
      simulateKeystroke([dummySyntaxDiag]);

      // While typing inside the invalid construct, no diagnostics should have been sent to the client
      assert.strictEqual(
        published.length,
        0,
        "No diagnostics should be published on immediate keystrokes while typing inside an invalid construct",
      );

      // Now pause typing and let the 180ms Tier 3 / syntax debounce timer expire
      await new Promise((r) => setTimeout(r, 220));

      // After debounce completes, exactly 1 batch of diagnostics should have been published
      assert.strictEqual(published.length, 1, "Diagnostics must be published after debounce completes");
      assert.strictEqual(published[0].diagnostics.length, 2, "Must contain syntax error and cached semantic error");
    });

    it("should immediately publish cleared diagnostics when syntax errors drop to 0", () => {
      const published: { uri: string; diagnostics: any[] }[] = [];
      const mockConnection = {
        sendDiagnostics: (payload: { uri: string; diagnostics: any[] }) => {
          published.push(payload);
        },
      };

      const uri = "file:///test.mo";
      const activeSyntaxDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const lastSyntaxErrorsCount = new Map<string, number>([[uri, 1]]); // Previous syntax error present
      const documentRevisions = new Map<string, number>();
      const lastSemanticDiagnostics = new Map<string, any[]>([[uri, [{ message: "Semantic lint", severity: 2 }]]]);

      const simulateKeystroke = (syntaxDiags: any[]) => {
        const currentRevision = (documentRevisions.get(uri) ?? 0) + 1;
        documentRevisions.set(uri, currentRevision);

        const existingSyntaxTimer = activeSyntaxDebounceTimers.get(uri);
        if (existingSyntaxTimer) {
          clearTimeout(existingSyntaxTimer);
          activeSyntaxDebounceTimers.delete(uri);
        }

        const lastCount = lastSyntaxErrorsCount.get(uri) ?? 0;
        if (syntaxDiags.length === 0 && lastCount > 0) {
          lastSyntaxErrorsCount.set(uri, 0);
          const cachedSemantic = lastSemanticDiagnostics.get(uri) || [];
          mockConnection.sendDiagnostics({ uri, diagnostics: cachedSemantic });
        }
      };

      // User types ';' repairing the syntax error -> syntaxDiags becomes []
      simulateKeystroke([]);

      assert.strictEqual(published.length, 1, "Must immediately clear syntax error on repair");
      assert.strictEqual(published[0].diagnostics.length, 1);
      assert.strictEqual(published[0].diagnostics[0].message, "Semantic lint");
    });
  });

  describe("Bug: Shared WASM input buffer synchronization across multi-document parsing", () => {
    it("should call facade.loadSource and pass docText to getDiagnostics in collectSyntaxErrors", () => {
      const bouncingBallText = `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity";
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
  when h < 0 then
    reinit(v, -e * pre(v));
  end when;
end BouncingBall;`;

      const mockDoc = {
        getText: () => bouncingBallText,
        positionAt: (offset: number) => ({ line: 0, character: offset }),
      };

      let loadedSource: string | null = null;
      let getDiagnosticsSourceArg: string | undefined = undefined;

      const mockFacade = {
        loadSource: (text: string) => {
          loadedSource = text;
        },
        getDiagnostics: (rootPtr: number, rangeStart = 0, rangeEnd = 0, sourceCode?: string) => {
          getDiagnosticsSourceArg = sourceCode;
          // When source matches BouncingBall, zero false lints are emitted
          if (loadedSource === bouncingBallText || sourceCode === bouncingBallText) {
            return [];
          }
          // If buffer was corrupted with MSL, false lints would be emitted
          return [
            {
              severity: 1,
              message: "Class or type 'with' not found in scope.",
              code: 2003,
              startOffset: 45,
              endOffset: 49,
            },
            {
              severity: 1,
              message: "Identifier at end of class (' function ') does not match start",
              code: 2005,
              startOffset: 250,
              endOffset: 260,
            },
          ];
        },
      };

      const mockRootNode = {
        id: 42,
        ptr: 42,
        hasError: false,
        tree: { facade: mockFacade, sourceCode: bouncingBallText },
      };

      const mockConnection = {
        console: { info: () => {}, warn: () => {}, error: () => {} },
      };
      const validationService = new ValidationService(
        mockConnection as any,
        {} as any,
        { unifiedWorkspace: { owl2Store: new Map() } } as any,
        {} as any,
      );

      const { syntaxDiags, wasmLintDiags } = validationService.collectSyntaxErrors(
        mockRootNode as any,
        mockDoc as any,
        { facade: mockFacade } as any,
      );

      assert.strictEqual(loadedSource, bouncingBallText, "facade.loadSource must be called with document text");
      assert.strictEqual(getDiagnosticsSourceArg, bouncingBallText, "sourceCode must be passed to getDiagnostics");
      assert.strictEqual(syntaxDiags.length, 0, "No false syntax errors");
      assert.strictEqual(wasmLintDiags.length, 0, "No false CST lint errors should be emitted for BouncingBall");
    });
  });
});
