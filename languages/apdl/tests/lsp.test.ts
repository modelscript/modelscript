// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexApdl } from "../src/indexing.js";
import { getApdlCompletions, getApdlDocumentSymbols, getApdlHover, validateApdl } from "../src/lsp.js";

const SAMPLE_APDL = `/TITLE, LSP Cantilever
/PREP7
L = 2.0
ET, 1, BEAM188
MP, EX, 1, 210e9
SECTYPE, 1, BEAM, RECT
SECDATA, 0.05, 0.10
N, 1, 0, 0, 0
N, 2, L, 0, 0
E, 1, 2
FINISH
/SOLU
ANTYPE, STATIC
D, 1, ALL, 0
F, 2, FY, -1000
SOLVE
FINISH
`;

describe("APDL Indexing & LSP Services", () => {
  it("recognizes APDL file extensions and content heuristics in canIndexApdl", () => {
    assert.strictEqual(canIndexApdl("beam.apdl"), true);
    assert.strictEqual(canIndexApdl("macro.mac"), true);
    assert.strictEqual(canIndexApdl("mesh.cdb"), true);
    assert.strictEqual(canIndexApdl("script.txt", "/PREP7\nET, 1, BEAM188\n"), true);
    assert.strictEqual(canIndexApdl("notes.txt", "just plain text"), false);
  });

  it("returns LSP diagnostics via validateApdl", () => {
    assert.strictEqual(validateApdl(SAMPLE_APDL).length, 0);

    const invalid = `/PREP7\nMP, EX, 1, -5\nSOLVE\n`;
    const diags = validateApdl(invalid);
    assert.ok(diags.some((d) => d.code === "APDL3001"));
    assert.ok(diags.some((d) => d.code === "APDL4001"));
    assert.ok(diags.some((d) => d.code === "APDL5002"));
  });

  it("extracts document symbols for processors, parameters, ET, MP, and SECTYPE", () => {
    const syms = getApdlDocumentSymbols(SAMPLE_APDL);
    const names = syms.map((s) => s.name);
    assert.ok(names.includes("/PREP7"));
    assert.ok(names.includes("L"));
    assert.ok(names.includes("ET 1"));
    assert.ok(names.includes("MP EX (MAT 1)"));
    assert.ok(names.includes("SECTYPE 1"));
    assert.ok(names.includes("/SOLU"));
  });

  it("provides hover documentation for processors, commands, element types, and parameters", () => {
    const prepHover = getApdlHover(SAMPLE_APDL, { line: 1, character: 2 });
    assert.ok(prepHover?.contents.value.includes("/PREP7"));

    const beamHover = getApdlHover(SAMPLE_APDL, { line: 3, character: 10 });
    assert.ok(beamHover?.contents.value.includes("BEAM188"));

    const paramHover = getApdlHover(SAMPLE_APDL, { line: 8, character: 6 });
    assert.ok(paramHover?.contents.value.includes("2.0"));
  });

  it("provides command, macro, and element completions", () => {
    const all = getApdlCompletions();
    assert.ok(all.length > 20);

    const macroItems = getApdlCompletions("*");
    assert.ok(macroItems.some((i) => i.label === "*DO"));
    assert.ok(macroItems.some((i) => i.label === "*IF"));

    const elemItems = getApdlCompletions("BEAM");
    assert.ok(elemItems.some((i) => i.label === "BEAM188"));
  });
});
