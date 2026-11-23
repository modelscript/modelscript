// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderArinc429PfdSvg, renderArinc429Svg, renderArinc429WordSvg } from "../src/diagram/index.js";
import { arinc429Indexing } from "../src/indexing.js";
import { getArinc429Completions, getArinc429DocumentSymbols, getArinc429Hover, validateArinc429 } from "../src/lsp.js";
import { encodeArinc429Word, formatArinc429Hex, parseArinc429 } from "../src/parser/index.js";
import { decodeFlightState } from "../src/solver/index.js";
import { Arinc429Panel } from "../src/ui/Arinc429Panel.js";

describe("ARINC 429 LSP, Indexing, SVG Diagram & React UI Panel", () => {
  const altHex = formatArinc429Hex(encodeArinc429Word({ label: "203", value: 32000 }));
  const pitchHex = formatArinc429Hex(encodeArinc429Word({ label: "324", value: 4.0 }));
  const rollHex = formatArinc429Hex(encodeArinc429Word({ label: "325", value: 12.0 }));
  const sampleSource = [
    "BUS AVIONICS_MAIN",
    "RATE HIGH",
    "LABEL 203 ALTITUDE ENCODING BNR SDI 0 RANGE 131072 RESOLUTION 0.5 UNITS ft RATE 20",
    "LABEL 324 PITCH ENCODING BNR SDI 0 RANGE 180 UNITS deg RATE 50",
    "LABEL 325 ROLL ENCODING BNR SDI 0 RANGE 180 UNITS deg RATE 50",
    `FRAME 0.000 WORD ${altHex}`,
    `FRAME 0.020 WORD ${pitchHex}`,
    `FRAME 0.040 WORD ${rollHex}`,
  ].join("\n");

  it("provides LSP validation, document symbols, hex/label hover, and completions", () => {
    const diags = validateArinc429(sampleSource);
    assert.strictEqual(diags.length, 0);

    const symbols = getArinc429DocumentSymbols(sampleSource);
    assert.strictEqual(symbols.length, 1);
    assert.strictEqual(symbols[0]?.name, "AVIONICS_MAIN");
    assert.strictEqual(symbols[0]?.children?.length, 6); // 3 labels + 3 frames

    // Hover over 32-bit hex word on line 5
    const hexCol = sampleSource.split("\n")[5]!.indexOf("0x") + 2;
    const hexHover = getArinc429Hover(sampleSource, { line: 5, character: hexCol });
    assert.ok(hexHover);
    assert.ok(hexHover.contents.value.includes("203"));
    assert.ok(hexHover.contents.value.includes("32000"));

    // Hover over octal label 203 on line 2
    const labelHover = getArinc429Hover(sampleSource, { line: 2, character: 7 });
    assert.ok(labelHover);
    assert.ok(labelHover.contents.value.includes("ALTITUDE"));

    const completions = getArinc429Completions();
    assert.ok(completions.some((c) => c.label === "BUS"));
    assert.ok(completions.some((c) => c.label.includes("LABEL 203")));
  });

  it("supports UnifiedWorkspace indexing via arinc429Indexing", () => {
    assert.strictEqual(arinc429Indexing.canIndex("flight.a429", ""), true);
    assert.strictEqual(arinc429Indexing.canIndex("unknown.txt", sampleSource), true);
    assert.strictEqual(arinc429Indexing.canIndex("other.txt", "hello world"), false);
  });

  it("renders valid pure SVG for 32-bit word bit-field, PFD artificial horizon, and combined dashboard", () => {
    const doc = parseArinc429(sampleSource);
    const flight = decodeFlightState(doc);

    const wordSvg = renderArinc429WordSvg(doc.frames[0]!.rawWord);
    assert.ok(wordSvg.startsWith("<svg") && wordSvg.endsWith("</svg>"));
    assert.ok(wordSvg.includes("PARITY: ODD OK"));
    assert.ok(wordSvg.includes("203"));

    const pfdSvg = renderArinc429PfdSvg(flight);
    assert.ok(pfdSvg.startsWith("<svg") && pfdSvg.endsWith("</svg>"));
    assert.ok(pfdSvg.includes("32000"));
    assert.ok(pfdSvg.includes("PITCH 4.0°"));
    assert.ok(pfdSvg.includes("ROLL 12.0°"));

    const combinedSvg = renderArinc429Svg(doc);
    assert.ok(combinedSvg.startsWith("<svg") && combinedSvg.endsWith("</svg>"));
    assert.ok(combinedSvg.includes("AVIONICS_MAIN"));
  });

  it("exports interactive React Arinc429Panel component", () => {
    assert.strictEqual(typeof Arinc429Panel, "function");
  });
});
