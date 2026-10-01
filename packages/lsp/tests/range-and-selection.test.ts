// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { LSPBridge, PositionIndex } from "../src/lsp-bridge.js";
import { registerDocumentFeaturesProvider } from "../src/providers/documentFeaturesProvider.js";

test("LSP Range & Selection Precision Test Suite", async (t) => {
  const uri = "file:///bouncing-ball/BouncingBall.mo";
  const validMo = `model BouncingBall "A bouncing ball"
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real g = 9.81 "Gravity";
  Real h(start = 1) "Height";
  Real v "Velocity";
equation
  der(h) = v;
  der(v) = -g;
end BouncingBall;`;

  const positions = new PositionIndex(validMo);

  // Build SymbolIndex matching the runtime indexer output
  const ballNameOffset = validMo.indexOf("BouncingBall");
  const gNameOffset = validMo.indexOf("g = 9.81");
  const vNameOffset = validMo.indexOf('v "Velocity"');

  const symbols = new Map<number, any>([
    [
      1,
      {
        id: 1,
        kind: "Class",
        name: "BouncingBall",
        ruleName: "ClassDefinition",
        namePath: "name",
        parentId: null,
        resourceId: uri,
        startByte: 0,
        endByte: validMo.length,
        startOffset: 0,
        endOffset: validMo.length,
        fieldRanges: {
          name: {
            startByte: ballNameOffset,
            endByte: ballNameOffset + "BouncingBall".length,
            startOffset: ballNameOffset,
            endOffset: ballNameOffset + "BouncingBall".length,
          },
        },
      },
    ],
    [
      2,
      {
        id: 2,
        kind: "Component",
        name: "g",
        ruleName: "ComponentDeclaration",
        namePath: "name",
        parentId: 1,
        resourceId: uri,
        startByte: validMo.indexOf("parameter Real g"),
        endByte: validMo.indexOf("parameter Real g") + 'parameter Real g = 9.81 "Gravity";'.length,
        startOffset: validMo.indexOf("parameter Real g"),
        endOffset: validMo.indexOf("parameter Real g") + 'parameter Real g = 9.81 "Gravity";'.length,
        fieldRanges: {
          name: {
            startByte: gNameOffset,
            endByte: gNameOffset + 1,
            startOffset: gNameOffset,
            endOffset: gNameOffset + 1,
          },
        },
      },
    ],
    [
      3,
      {
        id: 3,
        kind: "Component",
        name: "v",
        ruleName: "ComponentDeclaration",
        namePath: "name",
        parentId: 1,
        resourceId: uri,
        startByte: validMo.indexOf("Real v"),
        endByte: validMo.indexOf("Real v") + 'Real v "Velocity";'.length,
        startOffset: validMo.indexOf("Real v"),
        endOffset: validMo.indexOf("Real v") + 'Real v "Velocity";'.length,
        fieldRanges: {
          name: {
            startByte: vNameOffset,
            endByte: vNameOffset + 1,
            startOffset: vNameOffset,
            endOffset: vNameOffset + 1,
          },
        },
      },
    ],
  ]);

  const byName = new Map<string, number[]>([
    ["BouncingBall", [1]],
    ["g", [2]],
    ["v", [3]],
  ]);

  const childrenOf = new Map<number | null, number[]>([
    [null, [1]],
    [1, [2, 3]],
  ]);

  const mockIndex: any = {
    symbols,
    byName,
    childrenOf,
    symbolsByResource: new Map([[uri, [1, 2, 3]]]),
  };

  const mockEngine: any = {
    toQueryDB: () => ({ index: mockIndex }),
    index: mockIndex,
    cstText: (start: number, end: number) => validMo.slice(start, end),
  };

  const bridge = new LSPBridge(mockIndex, mockEngine, positions, uri);

  await t.test("Hover over equation variable narrows strictly to the token range", () => {
    // Offset for 'v' in 'der(h) = v;'
    const eqVOffset = validMo.indexOf("= v;") + 2;
    assert.strictEqual(validMo[eqVOffset], "v");

    const hoverResult = bridge.hover(eqVOffset, validMo);
    assert.ok(hoverResult, "Hover should resolve for equation variable 'v'");
    assert.ok(hoverResult.range, "Hover must provide a range");

    // Range must be 1 character wide (for 'v'), NOT the whole class or document!
    const range = hoverResult.range;
    assert.strictEqual(range.start.line, 6);
    assert.strictEqual(range.end.line, 6);
    assert.strictEqual(range.end.character - range.start.character, 1);
  });

  await t.test("Hover over whitespace or operators returns null", () => {
    // Whitespace on empty line or inside equation
    const wsOffset = validMo.indexOf("equation\n") + "equation\n".length;
    const hoverWs = bridge.hover(wsOffset, validMo);
    assert.strictEqual(hoverWs, null, "Hover on whitespace should be null");

    // Operator '=' in equation
    const opOffset = validMo.indexOf("der(h) =") + "der(h) ".length;
    assert.strictEqual(validMo[opOffset], "=");
    const hoverOp = bridge.hover(opOffset, validMo);
    assert.strictEqual(hoverOp, null, "Hover on operator '=' should be null");
  });

  await t.test("Hover over class declaration name highlights only the class name", () => {
    const hoverClass = bridge.hover(ballNameOffset + 2, validMo);
    assert.ok(hoverClass, "Hover should resolve on class name");
    assert.ok(hoverClass.range, "Hover must have range");
    assert.strictEqual(hoverClass.range.start.line, 0);
    assert.strictEqual(hoverClass.range.end.line, 0);
    assert.strictEqual(
      hoverClass.range.end.character - hoverClass.range.start.character,
      "BouncingBall".length,
      "Class hover range must only cover 'BouncingBall', not the full model",
    );
  });

  await t.test("Document symbols outline provides narrow selectionRange for symbol name", () => {
    const docSymbols = bridge.documentSymbols();
    assert.strictEqual(docSymbols.length, 1);
    const classSymbol = docSymbols[0]!;
    assert.strictEqual(classSymbol.name, "BouncingBall");

    // Enclosing range spans the whole class (lines 0 to 8)
    assert.strictEqual(classSymbol.range.start.line, 0);
    assert.strictEqual(classSymbol.range.end.line, 8);

    // selectionRange must be strictly on line 0 covering 'BouncingBall'
    assert.strictEqual(classSymbol.selectionRange.start.line, 0);
    assert.strictEqual(classSymbol.selectionRange.end.line, 0);
    assert.strictEqual(
      classSymbol.selectionRange.end.character - classSymbol.selectionRange.start.character,
      "BouncingBall".length,
    );
  });

  await t.test("Definition of variable in equation targets the declaration name range", () => {
    const eqVOffset = validMo.indexOf("= v;") + 2;
    const loc = bridge.definition(eqVOffset, validMo);
    assert.ok(loc, "Definition must resolve for variable 'v'");
    assert.strictEqual(loc.uri, uri);

    // Declaration line for Real v "Velocity" is line 4
    assert.strictEqual(loc.range.start.line, 4);
    assert.strictEqual(loc.range.end.line, 4);
    assert.strictEqual(loc.range.end.character - loc.range.start.character, 1);
  });

  await t.test("Smart selection ranges build innermost-to-outermost hierarchy", () => {
    const handlers = new Map<string, (...args: any[]) => any>();
    const mockConn: any = {
      onSelectionRanges: (handler: (...args: any[]) => any) => handlers.set("onSelectionRanges", handler),
      onDocumentSymbol: () => {},
      onFoldingRanges: () => {},
      onDocumentHighlight: () => {},
      console: { warn: () => {}, error: () => {} },
    };

    const mockDocs: any = {
      get: () => ({
        uri,
        getText: () => validMo,
      }),
    };

    // Create a mock AST tree: rootNode -> classNode -> eqNode -> identNode
    const identNode: any = {
      type: "IDENT",
      startPosition: { row: 6, column: 11 },
      endPosition: { row: 6, column: 12 },
      parent: null,
    };
    const eqNode: any = {
      type: "SimpleEquation",
      startPosition: { row: 6, column: 2 },
      endPosition: { row: 6, column: 13 },
      parent: null,
    };
    const classNode: any = {
      type: "ClassDefinition",
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 8, column: 18 },
      parent: null,
    };
    const rootNode: any = {
      type: "SourceFile",
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 8, column: 18 },
      parent: null,
      descendantForPosition: () => identNode,
    };

    identNode.parent = eqNode;
    eqNode.parent = classNode;
    classNode.parent = rootNode;

    registerDocumentFeaturesProvider(
      mockConn,
      mockDocs,
      new Map([[uri, bridge]]),
      () => ({ rootNode, text: validMo }),
      () => null,
      () => true,
      () => true,
      () => null,
    );

    const onSelectionRanges = handlers.get("onSelectionRanges")!;
    const res = onSelectionRanges({
      textDocument: { uri },
      positions: [{ line: 6, character: 11 }],
    });

    assert.ok(res && res.length === 1);
    const sel = res[0];

    // Innermost head must be identNode (line 6, col 11 to 12)
    assert.strictEqual(sel.range.start.line, 6);
    assert.strictEqual(sel.range.start.character, 11);
    assert.strictEqual(sel.range.end.character, 12);

    // Parent must be eqNode (line 6, col 2 to 13)
    assert.ok(sel.parent);
    assert.strictEqual(sel.parent.range.start.character, 2);
    assert.strictEqual(sel.parent.range.end.character, 13);

    // Grandparent must be classNode/rootNode (line 0 to 8)
    assert.ok(sel.parent.parent);
    assert.strictEqual(sel.parent.parent.range.start.line, 0);
    assert.strictEqual(sel.parent.parent.range.end.line, 8);
  });
});
