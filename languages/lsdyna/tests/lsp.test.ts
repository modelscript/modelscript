// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lsdynaIndexing } from "../src/indexing.js";
import { getLsDynaCompletions, getLsDynaDocumentSymbols, getLsDynaHover, validateLsDyna } from "../src/lsp.js";

const SAMPLE_DECK = `*KEYWORD
*TITLE
LspDemoBar
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
*ELEMENT_BEAM
1, 1, 1, 2
*PART
DemoPart
1, 1, 1
*SECTION_BEAM
1, 3, 1.0
0.001
*MAT_ELASTIC
1, 7850.0, 2.1e11, 0.3
*BOUNDARY_SPC_NODE
1, 0, 1, 1, 1, 1, 1, 1
*CONTROL_TERMINATION
0.01
*END
`;

describe("@modelscript/lsdyna — Workspace Indexing & LSP Services", () => {
  it("recognizes .k/.key/.dyn files and *KEYWORD content in lsdynaIndexing.canIndex", () => {
    assert.equal(lsdynaIndexing.canIndex("file:///bar.k", ""), true);
    assert.equal(lsdynaIndexing.canIndex("file:///bar.key", ""), true);
    assert.equal(lsdynaIndexing.canIndex("file:///bar.dyn", ""), true);
    assert.equal(lsdynaIndexing.canIndex("file:///unknown.txt", "*KEYWORD\n*END\n"), true);
    assert.equal(lsdynaIndexing.canIndex("file:///other.txt", "hello world"), false);
  });

  it("validates decks via validateLsDyna and reports LSP diagnostics for errors", () => {
    const cleanDiags = validateLsDyna(SAMPLE_DECK);
    assert.equal(cleanDiags.length, 0);

    const brokenDiags = validateLsDyna(`*KEYWORD
*NODE
1, 0.0, 0.0, 0.0
*MAT_ELASTIC
1, -100.0, -5.0, 0.6
*END
`);
    assert.ok(brokenDiags.length >= 3);
    assert.ok(brokenDiags.some((d) => d.code === "LSD4001" && d.severity === 1));
    assert.ok(brokenDiags.some((d) => d.code === "LSD4002" && d.severity === 1));
    assert.ok(brokenDiags.some((d) => d.code === "LSD4003" && d.severity === 1));
  });

  it("returns hierarchical document symbols, hover docs, and keyword completions", () => {
    const symbols = getLsDynaDocumentSymbols(SAMPLE_DECK);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "LspDemoBar");
    assert.ok((symbols[0]!.children?.length ?? 0) >= 4);

    // Line 14 is "*MAT_ELASTIC"
    const lines = SAMPLE_DECK.split("\n");
    const matLine = lines.findIndex((l) => l.trim() === "*MAT_ELASTIC");
    const hover = getLsDynaHover(SAMPLE_DECK, { line: matLine, character: 2 });
    assert.ok(hover, "Expected hover for *MAT_ELASTIC");
    assert.ok(hover.contents.value.includes("MAT_001"));

    const completions = getLsDynaCompletions("*MAT");
    assert.ok(completions.length >= 3);
    assert.ok(completions.some((c) => c.label === "*MAT_ELASTIC"));
    assert.ok(completions.some((c) => c.label === "*MAT_PLASTIC_KINEMATIC"));
    assert.ok(completions.some((c) => c.label === "*MAT_RIGID"));
  });
});
