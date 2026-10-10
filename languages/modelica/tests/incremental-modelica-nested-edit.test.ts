// SPDX-License-Identifier: AGPL-3.0-or-later

import path from "path";
import { fileURLToPath } from "url";
import { createWasmParser } from "../src-gen/bindings.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica Incremental Nested Model Edit Test", () => {
  let activeFacade: any;

  beforeAll(async () => {
    const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
    const res = await createWasmParser(modelicaWasm);
    activeFacade = res.facade;
  });

  it("should cleanly resolve syntax errors when inner model is closed with end;", () => {
    // 1. Initial valid document
    const initialCode = `model X\n\n\nend X;\n`;
    activeFacade.lastAstRoot = 0;
    const ast0 = activeFacade.parseIncremental(initialCode, 0, 0, initialCode.length, "file:///test.mo");
    expect(ast0).toBeGreaterThan(0);
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // 2. Insert unclosed inner model '  model Y\n'
    const insertOffset1 = initialCode.indexOf("\n\n") + 1;
    const insertText1 = "  model Y\n";
    const text2 = initialCode.slice(0, insertOffset1) + insertText1 + initialCode.slice(insertOffset1);
    const ast1 = activeFacade.parseIncremental(insertText1, insertOffset1, 0, text2.length, "file:///test.mo");
    expect(ast1).toBeGreaterThan(0);
    const diags1 = activeFacade.getDiagnostics(ast1);
    expect(diags1.length).toBeGreaterThan(0);

    // 3. Complete inner model by inserting '  end;\n'
    const insertOffset2 = insertOffset1 + insertText1.length;
    const insertText2 = "  end;\n";
    const text3 = text2.slice(0, insertOffset2) + insertText2 + text2.slice(insertOffset2);
    const ast2 = activeFacade.parseIncremental(insertText2, insertOffset2, 0, text3.length, "file:///test.mo");
    expect(ast2).toBeGreaterThan(0);
    const diags2 = activeFacade.getDiagnostics(ast2);
    expect(diags2).toHaveLength(0);
  });

  it("should handle parseIncrementalBatch with multiple edits in arbitrary order", () => {
    const baseCode = `model X\n  Real a;\n  Real b;\nend X;\n`;
    activeFacade.lastAstRoot = 0;
    const ast0 = activeFacade.parseIncremental(baseCode, 0, 0, baseCode.length, "file:///test.mo");
    expect(activeFacade.getDiagnostics(ast0)).toHaveLength(0);

    // Two edits: one near top, one near bottom
    const offsetA = baseCode.indexOf("Real a");
    const offsetB = baseCode.indexOf("Real b");

    // Edits passed in ascending order
    const editsAsc = [
      { text: "parameter Real a = 1.0", rangeOffset: offsetA, rangeLength: "Real a".length },
      { text: "parameter Real b = 2.0", rangeOffset: offsetB, rangeLength: "Real b".length },
    ];
    const newTotalLength =
      baseCode.length +
      (editsAsc[0].text.length - editsAsc[0].rangeLength) +
      (editsAsc[1].text.length - editsAsc[1].rangeLength);

    const astBatch = activeFacade.parseIncrementalBatch(editsAsc, newTotalLength, "file:///test.mo");
    expect(astBatch).toBeGreaterThan(0);
    const diags = activeFacade.getDiagnostics(astBatch);
    expect(diags).toHaveLength(0);
  });
});
