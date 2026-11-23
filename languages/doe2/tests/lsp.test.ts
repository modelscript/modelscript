// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canIndexDoe2 } from "../src/indexing.js";
import { executeDoe2Action, getDoe2DocumentSymbols, getDoe2Hover, validateDoe2 } from "../src/lsp.js";

const LSP_DECK = `
INPUT LOADS ..
TITLE LINE-1 = "LspDemo" ..
"MAT-1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.5 CONDUCTIVITY = 0.8 DENSITY = 120 SPECIFIC-HEAT = 0.2 ..
"LAY-1" = LAYERS MATERIAL = ("MAT-1") ..
"CON-1" = CONSTRUCTION TYPE = LAYERS LAYERS = "LAY-1" ..
"SP-1" = SPACE AREA = 600 HEIGHT = 10 AIR-CHANGES/HR = 0.5 ..
"W-1" = EXTERIOR-WALL CONSTRUCTION = "CON-1" AREA = 200 ..
INPUT SYSTEMS ..
"SYS-1" = SYSTEM TYPE = PSZ ..
"Z-1" = ZONE SPACE = "SP-1" ..
STOP ..
`;

describe("@modelscript/doe2 — Workspace Indexing & LSP Services", () => {
  it("recognizes DOE-2 file extensions and BDL headers in canIndexDoe2", () => {
    assert.equal(canIndexDoe2("file:///project/office.inp"), true);
    assert.equal(canIndexDoe2("file:///project/office.bdl"), true);
    assert.equal(canIndexDoe2("file:///project/model.txt", "INPUT LOADS .."), true);
    assert.equal(canIndexDoe2("file:///project/model.mo", "model Foo end Foo;"), false);
  });

  it("returns diagnostics, hierarchical document symbols, and markdown hover info", () => {
    const cleanDiags = validateDoe2(LSP_DECK);
    assert.equal(cleanDiags.length, 0);

    const badDiags = validateDoe2(`INPUT LOADS .. "W1" = EXTERIOR-WALL CONSTRUCTION = "MISSING" AREA = -5 ..`);
    assert.ok(badDiags.some((d) => d.code === "DOE2003"));
    assert.ok(badDiags.some((d) => d.code === "DOE3003"));
    assert.ok(badDiags.some((d) => d.code === "DOE5001"));

    const symbols = getDoe2DocumentSymbols(LSP_DECK);
    assert.ok(symbols.some((s) => s.name === "MATERIAL: MAT-1"));
    assert.ok(symbols.some((s) => s.name === "CONSTRUCTION: CON-1"));
    const spaceSym = symbols.find((s) => s.name === "SPACE: SP-1");
    assert.ok(spaceSym && spaceSym.children?.length === 1);
    assert.equal(spaceSym.children[0]?.name, "EXTERIOR-WALL: W-1");

    const conOffset = LSP_DECK.indexOf('"CON-1"');
    const hover = getDoe2Hover(LSP_DECK, conOffset + 2);
    assert.ok(hover, "Expected hover tooltip over CONSTRUCTION");
    assert.ok(hover.contents.value.includes("U-value (SI)"));
  });

  it("executes doe2.toEnergyPlus, doe2.toModelica, doe2.toDae, and doe2.summary actions", () => {
    const ep = executeDoe2Action("doe2.toEnergyPlus", LSP_DECK);
    assert.ok(ep.idf.includes("Building,"));

    const mo = executeDoe2Action("doe2.toModelica", LSP_DECK);
    assert.ok(mo.modelica.includes("model LspDemo"));

    const dae = executeDoe2Action("doe2.toDae", LSP_DECK);
    assert.ok(dae.variables > 0 && dae.equations > 0);

    const sum = executeDoe2Action("doe2.summary", LSP_DECK);
    assert.equal(sum.title, "LspDemo");
    assert.equal(sum.spaces, 1);
    assert.equal(sum.surfaces, 1);
    assert.equal(sum.zones, 1);
  });
});
