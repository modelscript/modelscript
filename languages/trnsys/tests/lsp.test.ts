// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getTrnsysCompletions,
  getTrnsysDocumentSymbols,
  getTrnsysHover,
  trnsysIndexing,
  validateTrnsys,
} from "../src/index.js";

const SAMPLE_DECK = `VERSION 18
CONSTANTS 1
  A_COL = 4.0
SIMULATION 0 24 0.5
UNIT 1 TYPE 15 Weather
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0
UNIT 2 TYPE 1 Collector
PARAMETERS 5
  A_COL 4.19 0.75 15.0 0.0
INPUTS 4
  0,0 0,0 1,1 1,2
  20.0 200.0 20.0 0.0
END
`;

describe("@modelscript/trnsys — Indexing & LSP Services", () => {
  it("detects TRNSYS files in trnsysIndexing.canIndex", () => {
    assert.equal(trnsysIndexing.canIndex("solar.dck", ""), true);
    assert.equal(trnsysIndexing.canIndex("unknown.txt", SAMPLE_DECK), true);
    assert.equal(trnsysIndexing.canIndex("model.mo", "model Foo end Foo;"), false);
  });

  it("validates decks and returns LSP diagnostics with ranges", () => {
    assert.equal(validateTrnsys(SAMPLE_DECK).length, 0);

    const bad = validateTrnsys("UNIT 1 TYPE 1\nINPUTS 2\n  99,1\n  0.0\n");
    assert.ok(bad.some((d) => d.code === "TRN4001"));
    assert.ok(bad.some((d) => d.code === "TRN2002"));
    assert.ok(bad.some((d) => d.code === "TRN3002"));
    assert.equal(bad[0]?.source, "modelscript-trnsys");
  });

  it("extracts document symbols, hover docs, and completions", () => {
    const syms = getTrnsysDocumentSymbols(SAMPLE_DECK);
    assert.ok(syms.some((s) => s.name === "A_COL"));
    assert.ok(syms.some((s) => s.name === "UNIT 1 TYPE 15"));
    assert.ok(syms.some((s) => s.name === "UNIT 2 TYPE 1"));

    const hoverUnit = getTrnsysHover(SAMPLE_DECK, { line: 7, character: 5 });
    assert.ok(hoverUnit?.contents.value.includes("Flat-Plate Solar Collector"));

    const hoverSim = getTrnsysHover(SAMPLE_DECK, { line: 3, character: 2 });
    assert.ok(hoverSim?.contents.value.includes("SIMULATION"));

    const completions = getTrnsysCompletions("TYPE");
    assert.ok(completions.some((c) => c.label === "TYPE 1"));
    assert.ok(completions.some((c) => c.label === "TYPE 56"));
  });
});
