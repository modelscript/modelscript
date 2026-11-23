// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getSindaCompletions,
  getSindaDocumentSymbols,
  getSindaHover,
  sindaIndexing,
  validateSinda,
} from "../src/index.js";

describe("@modelscript/sinda — Indexing & LSP Services", () => {
  const sampleDeck = `
HEADER OPTIONS DATA
  TITLE = "LSP Thermal Test"
HEADER NODE DATA
  1, 310.0, 200.0
  -2, 290.0, 0.0
HEADER CONDUCTOR DATA
  10, 1, 2, 4.0
HEADER EXECUTION
  CALL STDSTL
END OF DATA
`;

  it("identifies SINDA files via sindaIndexing.canIndex", () => {
    assert.equal(sindaIndexing.canIndex("spacecraft.sin", ""), true);
    assert.equal(sindaIndexing.canIndex("panel.sinda", ""), true);
    assert.equal(sindaIndexing.canIndex("deck.inp", sampleDeck), true);
    assert.equal(sindaIndexing.canIndex("random.txt", "hello world"), false);
  });

  it("validates decks via validateSinda and reports LSP diagnostics for errors", () => {
    const clean = validateSinda(sampleDeck);
    assert.equal(clean.length, 0);

    const broken = `
HEADER NODE DATA
  1, 300.0, -5.0
HEADER CONDUCTOR DATA
  10, 1, 1, 2.0
`;
    const diags = validateSinda(broken);
    const codes = new Set(diags.map((d) => d.code));
    assert.ok(codes.has("SIN1002"));
    assert.ok(codes.has("SIN3001"));
    assert.ok(codes.has("SIN3002"));
    assert.ok(codes.has("SIN4001"));
  });

  it("extracts hierarchical document symbols, hover docs, and completions", () => {
    const symbols = getSindaDocumentSymbols(sampleDeck);
    assert.ok(symbols.length >= 4, `Expected >= 4 HEADER block symbols, got ${symbols.length}`);
    const nodeBlock = symbols.find((s) => s.name === "HEADER NODE DATA");
    assert.ok(nodeBlock?.children && nodeBlock.children.length === 2);

    // Hover on STDSTL solver routine
    const lines = sampleDeck.split("\n");
    const execLineIdx = lines.findIndex((l) => l.includes("STDSTL"));
    const hoverSolver = getSindaHover(sampleDeck, {
      line: execLineIdx,
      character: lines[execLineIdx]!.indexOf("STDSTL") + 2,
    });
    assert.ok(hoverSolver?.contents.value.includes("Steady-State Newton-Raphson"));

    // Hover on node 1
    const nodeLineIdx = lines.findIndex((l) => l.trim().startsWith("1,"));
    const hoverNode = getSindaHover(sampleDeck, { line: nodeLineIdx, character: lines[nodeLineIdx]!.indexOf("1") });
    assert.ok(hoverNode?.contents.value.includes("Thermal Node 1"));

    // Completions
    const completions = getSindaCompletions("HEADER");
    assert.ok(completions.length >= 8);
  });
});
