// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getPlot3dSchemasFromLibraries, lookupPlot3dModelSchema } from "../src/catalog/index.js";
import { plot3dIndexing } from "../src/indexing.js";
import { getPlot3dDocumentSymbols, getPlot3dHover, getPlot3dLspCompletions, validatePlot3d } from "../src/lsp.js";
import { serializePlot3dGridAscii, serializePlot3dSolutionAscii } from "../src/parser/ascii-parser.js";
import { generateIsentropicNozzlePlot3d } from "../src/solver/nozzle.js";

describe("PLOT3D LSP, Indexing & Cleanroom Standard Library", () => {
  it("validates valid and invalid ASCII PLOT3D files via LSP diagnostics", () => {
    const { grid, solution } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 2, nk: 2, numBlocks: 1 });
    const gridText = serializePlot3dGridAscii(grid);
    const solText = serializePlot3dSolutionAscii(solution);

    assert.strictEqual(validatePlot3d(gridText, "nozzle.xyz").length, 0);
    assert.strictEqual(validatePlot3d(solText, "nozzle.q").length, 0);

    const errDiags = validatePlot3d("2 2 2\nnot_a_number\n", "broken.xyz");
    assert.ok(errDiags.length > 0);
    assert.strictEqual(errDiags[0]!.code, "P3D1001");
  });

  it("extracts document symbols, hover summaries, and completions", () => {
    const { grid } = generateIsentropicNozzlePlot3d({ ni: 5, nj: 3, nk: 3, numBlocks: 2 });
    const gridText = serializePlot3dGridAscii(grid);

    const symbols = getPlot3dDocumentSymbols(gridText, "nozzle.xyz");
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.children?.length, 2);

    const hover = getPlot3dHover(gridText, { line: 0, character: 0 }, "nozzle.xyz");
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("NASA PLOT3D Structured Grid"));
    assert.ok(hover.contents.value.includes("Total Volume"));

    const completions = getPlot3dLspCompletions("FS");
    assert.ok(completions.some((c) => c.label === "FSMACH"));
  });

  it("supports UnifiedWorkspace indexing predicate canIndex", () => {
    assert.strictEqual(plot3dIndexing.canIndex("file:///wing.xyz", ""), true);
    assert.strictEqual(plot3dIndexing.canIndex("file:///wing.q", ""), true);
    assert.strictEqual(plot3dIndexing.canIndex("file:///fields.nam", ""), true);
    assert.strictEqual(plot3dIndexing.canIndex("file:///other.txt", "hello world"), false);
  });

  it("registers all 5 cleanroom standard library schemas in globalLibraryRegistry", () => {
    const schemas = getPlot3dSchemasFromLibraries();
    const names = schemas.map((s) => s.name);
    for (const required of ["Grid3D", "SolutionQ", "FunctionF", "IsentropicNozzle", "FlatPlateMesh"]) {
      assert.ok(names.includes(required), `Missing required schema: ${required}`);
      const looked = lookupPlot3dModelSchema(required);
      assert.ok(looked, `Should look up ${required}`);
      assert.ok(looked.svg && looked.svg.includes("<svg"), `${required} should have cleanroom SVG icon`);
    }
  });
});
