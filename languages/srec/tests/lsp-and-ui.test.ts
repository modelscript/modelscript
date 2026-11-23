// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSrecDiagramData, renderSrecMemoryMapSvg } from "../src/diagram/index.js";
import { srecIndexing } from "../src/indexing.js";
import { srecLanguage } from "../src/language.js";
import { getSrecCompletions, getSrecDocumentSymbols, getSrecHover, validateSrec } from "../src/lsp.js";
import { encodeSrec, parseSrec } from "../src/parser/index.js";
import { SrecPanel } from "../src/ui/SrecPanel.js";

describe("SREC LSP, Indexing, SVG Memory Map & React Panel", () => {
  const sampleSrec = encodeSrec(
    [
      { startAddress: 0x00000400, data: new Uint8Array([0x4e, 0x71, 0x4e, 0x75, 0x00, 0x01, 0x02, 0x03]) },
      { startAddress: 0x00000800, data: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]) },
    ],
    { header: "M68K_BOOT", dataRecordType: "S2", startAddress: 0x00000400 },
  );

  it("validates SREC via LSP and returns document symbols, hover, and completions", () => {
    const cleanDiags = validateSrec(sampleSrec, "boot.s28");
    assert.strictEqual(cleanDiags.length, 0);

    const errDiags = validateSrec("S1050000010200\n", "broken.s19");
    assert.ok(errDiags.length >= 2, "Should report checksum mismatch, missing termination, and missing header");

    const symbols = getSrecDocumentSymbols(sampleSrec, "boot.s28");
    assert.strictEqual(symbols.length, 1);
    assert.ok((symbols[0]!.children?.length ?? 0) >= 4, "Should have S0 header, 2 regions, and S8 entry point");

    const hover = getSrecHover(sampleSrec, { line: 0, character: 2 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("S0 — Header Record"));
    assert.ok(hover.contents.value.includes("M68K_BOOT"));

    const completions = getSrecCompletions();
    assert.ok(completions.some((c) => c.label === "S1"));
    assert.ok(completions.some((c) => c.label === "S3"));
    assert.ok(completions.some((c) => c.label === "S7"));
  });

  it("recognizes SREC files in srecIndexing.canIndex", () => {
    assert.strictEqual(srecIndexing.canIndex("firmware.srec", ""), true);
    assert.strictEqual(srecIndexing.canIndex("rom.s19", ""), true);
    assert.strictEqual(srecIndexing.canIndex("boot.s37", ""), true);
    assert.strictEqual(srecIndexing.canIndex("unknown.txt", sampleSrec), true);
    assert.strictEqual(srecIndexing.canIndex("notes.txt", "hello world"), false);
  });

  it("renders pure SVG memory-region layout bar with entry-point marker and exports SrecPanel", () => {
    const file = parseSrec(sampleSrec);
    const data = buildSrecDiagramData(file);
    assert.strictEqual(data.boxes.length, 2);
    assert.ok(data.entryMarkerX !== undefined);

    const svg = renderSrecMemoryMapSvg(file);
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("M68K_BOOT"));
    assert.ok(svg.includes("Entry 0x0400"));
    assert.ok(svg.includes("Region 0:"));
    assert.ok(svg.includes("Region 1:"));

    assert.strictEqual(typeof SrecPanel, "function");
    assert.strictEqual(srecLanguage.ui?.panels?.[0]?.id, "srecViewer");
    assert.strictEqual(srecLanguage.ui?.panels?.[0]?.entry, "./src/ui/SrecPanel.tsx");
  });
});
