// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  encodeIhex,
  getIhexCompletions,
  getIhexDocumentSymbols,
  getIhexHover,
  ihexIndexing,
  parseIhex,
  renderIhexMemoryMapSvg,
  validateIhex,
} from "../src/index.js";
import { IhexPanel } from "../src/ui/IhexPanel.js";

describe("@modelscript/ihex LSP, Diagram SVG & React UI Suite", () => {
  const sampleHex = encodeIhex(
    [
      { address: 0x08000000, data: new Uint8Array([0x00, 0x50, 0x00, 0x20, 0xed, 0x00, 0x00, 0x08]) },
      { address: 0x08000200, data: new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x00]) },
    ],
    { format: "I32HEX", startLinearAddress: 0x08000000 },
  );

  it("validates Intel HEX documents and produces document symbols, hover, and completions", () => {
    assert.equal(validateIhex(sampleHex, "fw.hex").length, 0);

    const badDiags = validateIhex(":0000000100\n", "bad.hex");
    assert.ok(badDiags.some((d) => d.code === "IHEX2001"));

    const symbols = getIhexDocumentSymbols(sampleHex, "fw.hex");
    assert.equal(symbols.length, 1);
    assert.ok((symbols[0]?.children?.length ?? 0) >= 3);

    const hover = getIhexHover(sampleHex, { line: 1, character: 8 });
    assert.ok(hover, "Hover should return record documentation");
    assert.ok(hover.contents.value.includes("Record Type"));

    const completions = getIhexCompletions();
    assert.ok(completions.some((c) => c.label === ":00000001FF"));
  });

  it("recognizes .hex/.ihx files in ihexIndexing", () => {
    assert.equal(ihexIndexing.canIndex("firmware.hex", ""), true);
    assert.equal(ihexIndexing.canIndex("boot.ihx", ""), true);
    assert.equal(ihexIndexing.canIndex("unknown.txt", ":00000001FF\n"), true);
    assert.equal(ihexIndexing.canIndex("notes.txt", "hello world"), false);
  });

  it("renders pure SVG memory-map diagram and exports IhexPanel React component", () => {
    const model = parseIhex(sampleHex, "stm32.hex");
    const svg = renderIhexMemoryMapSvg(model);
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("ADDRESS SPACE MAP"));
    assert.ok(svg.includes("0x08000000"));
    assert.ok(svg.includes("ENTRY 0x08000000"));
    assert.ok(svg.includes("CRC32:"));
    assert.equal(typeof IhexPanel, "function");
  });
});
