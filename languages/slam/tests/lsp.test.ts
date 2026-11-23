// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slamIndexing } from "../src/indexing.js";
import { getSlamCompletions, getSlamDocumentSymbols, getSlamHover, validateSlam } from "../src/lsp.js";

const SAMPLE_DECK = `GEN, PRITSKER, LSP_DEMO, 1/1/1979, 1;
CONTINUOUS, 1, 0, 0.01, 0.1, 0.1;
INTLC, SS(1)=0.0, XX(1)=1.0;
DD(1) = 100.0 * XX(1);
NETWORK;
  RESOURCE/BERTH(1), 1;
  CREATE, EXPON(2.0), 0.0, 1;
  AWAIT(1), BERTH/1;
  ACTIVITY/1, 1.0, 1.0, REL;
REL FREE, BERTH/1;
  DETECT, SS(1), XP, 50.0, 0.01;
  TERMINATE;
ENDNETWORK;
FIN;
`;

describe("@modelscript/slam — LSP & Indexing", () => {
  it("returns zero diagnostics for a valid deck and reports errors for invalid decks", () => {
    const validDiags = validateSlam(SAMPLE_DECK);
    assert.equal(validDiags.length, 0);

    const invalidDiags = validateSlam("NETWORK;\nAWAIT(1), MISSING_RES/1;\n");
    assert.ok(invalidDiags.some((d) => d.code === "SLAM2001"));
    assert.ok(invalidDiags.some((d) => d.code === "SLAM3001"));
    assert.ok(invalidDiags.some((d) => d.code === "SLAM3002"));
  });

  it("extracts hierarchical documentSymbols for states, resources, nodes, and detectors", () => {
    const symbols = getSlamDocumentSymbols(SAMPLE_DECK);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "LSP_DEMO");
    const childNames = (symbols[0]?.children ?? []).map((c) => c.name);
    assert.ok(childNames.includes("DD(1)"));
    assert.ok(childNames.includes("BERTH [RESOURCE]"));
    assert.ok(childNames.some((n) => n.includes("[DETECT]")));
  });

  it("provides contextual hover documentation for control keywords, nodes, and declared resources", () => {
    const hoverDetect = getSlamHover(SAMPLE_DECK, { line: 10, character: 4 });
    assert.ok(hoverDetect?.contents.value.includes("DETECT"));

    const hoverRes = getSlamHover(SAMPLE_DECK, { line: 7, character: 14 });
    assert.ok(hoverRes?.contents.value.includes("BERTH"));

    const hoverCont = getSlamHover(SAMPLE_DECK, { line: 1, character: 2 });
    assert.ok(hoverCont?.contents.value.includes("CONTINUOUS"));
  });

  it("provides completion items for control statements, blocks, distributions, and deck symbols", () => {
    const items = getSlamCompletions(SAMPLE_DECK, { line: 5, character: 0 });
    const labels = new Set(items.map((i) => i.label));
    assert.ok(labels.has("CONTINUOUS"));
    assert.ok(labels.has("DETECT"));
    assert.ok(labels.has("EXPON(mean)"));
    assert.ok(labels.has("BERTH"));
    assert.ok(labels.has("REL"));
  });

  it("detects SLAM II files via slamIndexing.canIndex", () => {
    assert.equal(slamIndexing.canIndex("tanker.slam", ""), true);
    assert.equal(slamIndexing.canIndex("model.slm", ""), true);
    assert.equal(slamIndexing.canIndex("deck.inp", SAMPLE_DECK), true);
    assert.equal(slamIndexing.canIndex("readme.txt", "hello world"), false);
  });
});
