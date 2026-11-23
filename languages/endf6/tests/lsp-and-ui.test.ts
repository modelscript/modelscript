// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateReferenceEndf6Tape } from "../src/catalog/reference-tapes.js";
import { renderEndf6CrossSectionSvg } from "../src/diagram/cross-section-svg.js";
import { endf6Indexing } from "../src/indexing.js";
import { getEndf6Completions, getEndf6DocumentSymbols, getEndf6Hover, validateEndf6 } from "../src/lsp.js";
import { parseEndf6Tape } from "../src/parser/tape-parser.js";
import { Endf6Panel } from "../src/ui/Endf6Panel.js";

describe("ENDF-6 Indexing, LSP, SVG Cross-Section Plotter & React UI", () => {
  const u235Tape = generateReferenceEndf6Tape("U-235");

  it("indexes ENDF-6 tapes via endf6Indexing", () => {
    assert.equal(endf6Indexing.canIndex("u235.endf", ""), true);
    assert.equal(endf6Indexing.canIndex("u235.endf6", ""), true);
    assert.equal(endf6Indexing.canIndex("notes.txt", "hello world"), false);
  });

  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const diags = validateEndf6(u235Tape, "u235.endf");
    assert.equal(diags.length, 0);

    const symbols = getEndf6DocumentSymbols(u235Tape);
    assert.equal(symbols.length, 1);
    assert.ok(symbols[0]!.name.includes("U-235"));
    assert.ok((symbols[0]!.children?.length ?? 0) >= 5);

    // Hover over MAT column (col 67) on line 1 (MF=1 MT=451 header)
    const hoverMat = getEndf6Hover(u235Tape, { line: 1, character: 67 });
    assert.ok(hoverMat?.contents.value.includes("MAT = 9228"));

    // Hover over MT column (col 73) on line 1 (MT=451)
    const hoverMt = getEndf6Hover(u235Tape, { line: 1, character: 73 });
    assert.ok(hoverMt?.contents.value.includes("MT = 451"));

    const completions = getEndf6Completions(u235Tape, { line: 0, character: 0 });
    assert.ok(completions.some((c) => c.label.includes("MT=18")));
    assert.ok(completions.some((c) => c.label === "SEND"));
    assert.ok(completions.some((c) => c.label.includes("U-235")));
  });

  it("renders a pure SVG log-log cross-section plot with MT curves and SLBW overlay", () => {
    const tape = parseEndf6Tape(u235Tape);
    const svg = renderEndf6CrossSectionSvg(tape, { colorMode: "dark", showResonances: true });

    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("U-235 Neutron Cross-Sections"));
    assert.ok(svg.includes('data-mt="1"'));
    assert.ok(svg.includes('data-mt="2"'));
    assert.ok(svg.includes('data-mt="18"'));
    assert.ok(svg.includes('data-mt="102"'));
    assert.ok(svg.includes("MF=2 SLBW Total"));
    assert.ok(svg.includes("</svg>"));
  });

  it("exports the interactive Endf6Panel React component", () => {
    assert.equal(typeof Endf6Panel, "function");
  });
});
