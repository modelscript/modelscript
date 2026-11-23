// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bufrIndexing,
  getBufrCompletions,
  getBufrDocumentSymbols,
  getBufrHover,
  parseBufrText,
  renderBufrSoundingSvg,
  validateBufr,
} from "../src/index.js";
import { BufrPanel } from "../src/ui/BufrPanel.js";

const SOUNDING_SAMPLE = `
BUFR EDITION 4 NAME SONDE_TEST
SECTION 1
  CENTRE = 7
  YEAR = 2026
  MONTH = 6
  DAY = 15
  HOUR = 12
SECTION 3
  SUBSETS = 1
  3-09-052
SECTION 4
  SUBSET 1:
    0-01-001 = 72
    0-01-002 = 493
    0-05-001 = 37.75
    0-06-001 = -122.22
    0-07-001 = 3
    0-31-002 = 2
    0-07-004 = 100000
    0-10-009 = 110
    0-12-101 = 290.15
    0-12-103 = 284.15
    0-11-001 = 270
    0-11-002 = 7.5
    0-07-004 = 50000
    0-10-009 = 5570
    0-12-101 = 252.15
    0-12-103 = 240.15
    0-11-001 = 290
    0-11-002 = 22.0
7777
`;

describe("@modelscript/bufr LSP, Indexing, Diagram & UI", () => {
  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const diags = validateBufr(SOUNDING_SAMPLE);
    assert.equal(diags.length, 0);

    const symbols = getBufrDocumentSymbols(SOUNDING_SAMPLE);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "SONDE_TEST");
    assert.ok((symbols[0]?.children?.length ?? 0) >= 3);

    // Hover on 3-09-052 (line 11)
    const hoverSeq = getBufrHover(SOUNDING_SAMPLE, 11, 5);
    assert.ok(hoverSeq);
    assert.ok(hoverSeq.contents.includes("3-09-052"));

    // Hover on 0-12-101 (line 22)
    const hoverTemp = getBufrHover(SOUNDING_SAMPLE, 22, 6);
    assert.ok(hoverTemp);
    assert.ok(hoverTemp.contents.includes("Temperature"));

    const completions = getBufrCompletions("3-09");
    assert.ok(completions.some((c) => c.label === "3-09-052"));
  });

  it("supports UnifiedWorkspace indexing via bufrIndexing", () => {
    assert.equal(bufrIndexing.canIndex("obs.bufr", ""), true);
    assert.equal(bufrIndexing.canIndex("obs.bfr", ""), true);
    assert.equal(bufrIndexing.canIndex("notes.txt", SOUNDING_SAMPLE), true);
    assert.equal(bufrIndexing.canIndex("notes.txt", "hello world"), false);
  });

  it("renders pure SVG upper-air sounding & WMO station-plot and exports BufrPanel", () => {
    const msg = parseBufrText(SOUNDING_SAMPLE);
    const svg = renderBufrSoundingSvg(msg);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("WMO Station Model"));
    assert.ok(svg.includes("polyline"));
    assert.ok(svg.includes("72493"));
    assert.equal(typeof BufrPanel, "function");
  });
});
