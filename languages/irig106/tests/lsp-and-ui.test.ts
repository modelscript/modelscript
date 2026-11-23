// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderIrig106CommutatorSvg } from "../src/diagram/index.js";
import { irig106Indexing } from "../src/indexing.js";
import { getIrig106Completions, getIrig106DocumentSymbols, getIrig106Hover, validateIrig106 } from "../src/lsp.js";
import { Irig106Panel } from "../src/ui/Irig106Panel.js";

const SAMPLE_LSP_TMATS = `G\\PN:LSP_DEMO;
P-1\\DLN:PCM_A;
P-1\\D1:128000;
P-1\\F1:16;
P-1\\MF\\N:2;
P-1\\MF1:6;
P-1\\MF2:128;
P-1\\MF4:FE6B2840;
D-1\\DLN:PCM_A;
D-1\\MN-1-1:PITCH_RATE;
D-1\\WP-1-1:1;
D-1\\WI-1-1:3;
C-1\\DCN:PITCH_RATE;
C-1\\MN3:DEG/S;
C-1\\DCT:COE;
C-1\\CO-0:0.0;
C-1\\CO-1:0.01;
`;

describe("@modelscript/irig106 LSP, Indexing, SVG Diagram & React Panel", () => {
  it("validates TMATS documents via validateIrig106", () => {
    const diags = validateIrig106(SAMPLE_LSP_TMATS);
    assert.strictEqual(diags.length, 0);
  });

  it("extracts hierarchical document symbols via getIrig106DocumentSymbols", () => {
    const symbols = getIrig106DocumentSymbols(SAMPLE_LSP_TMATS);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]!.name, "LSP_DEMO");
    assert.ok((symbols[0]!.children?.length ?? 0) >= 3);
  });

  it("provides contextual hover information for attributes and measurements", () => {
    const hoverBitRate = getIrig106Hover(SAMPLE_LSP_TMATS, 2, 2);
    assert.ok(hoverBitRate);
    assert.ok(hoverBitRate.contents.includes("P-1\\D1"));
    assert.ok(hoverBitRate.contents.includes("Bit Rate"));

    const hoverMeas = getIrig106Hover(SAMPLE_LSP_TMATS, 9, 2);
    assert.ok(hoverMeas);
    assert.ok(hoverMeas.contents.includes("PITCH_RATE"));
    assert.ok(hoverMeas.contents.includes("2000.00 Hz"));
  });

  it("returns TMATS Chapter 9 attribute completions", () => {
    const items = getIrig106Completions(SAMPLE_LSP_TMATS);
    assert.ok(items.length >= 10);
    assert.ok(items.some((i) => i.label === "P-1\\MF4"));
  });

  it("recognizes TMATS files via irig106Indexing.canIndex", () => {
    assert.strictEqual(irig106Indexing.canIndex("flight.tmats", ""), true);
    assert.strictEqual(irig106Indexing.canIndex("flight.tmt", ""), true);
    assert.strictEqual(irig106Indexing.canIndex("unknown.txt", "P-1\\D1:128000;"), true);
    assert.strictEqual(irig106Indexing.canIndex("unknown.txt", "hello world"), false);
  });

  it("renders deterministic pure SVG PCM commutator grid with sync words and channels", () => {
    const svg = renderIrig106CommutatorSvg(SAMPLE_LSP_TMATS);
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(svg.includes("IRIG 106 PCM Commutator"));
    assert.ok(svg.includes("FE6B2840"));
    assert.ok(svg.includes("PITCH_RATE"));
    assert.ok(svg.includes("SYNC"));
  });

  it("exports Irig106Panel React component", () => {
    assert.strictEqual(typeof Irig106Panel, "function");
  });
});
