// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderJedecFuseMatrixSvg } from "../src/diagram/fuse-matrix-svg.js";
import { jedecIndexing } from "../src/indexing.js";
import { getJedecCompletions, getJedecDocumentSymbols, getJedecHover, validateJedec } from "../src/lsp.js";
import { formatHex16 } from "../src/parser/checksum.js";
import { parseJedec } from "../src/parser/jedec-parser.js";
import { JedecPanel } from "../src/ui/JedecPanel.js";

describe("@modelscript/jedec — Diagram SVG, Indexing, LSP & UI Panel", () => {
  const sampleBody = [
    "PAL16L8 Sample*",
    "QP20*",
    "QF2048*",
    "QV2*",
    "F0*",
    "N DEVICE PAL16L8*",
    "L0000 11111111111111111111111111111111*",
    "V0001 000000000N0XXXXXXXXN*",
  ].join("\n");
  const samplePre = parseJedec(sampleBody);
  const sampleSrc = `${sampleBody}\nC${formatHex16(samplePre.computedFuseChecksum)}*\n`;

  it("renders a valid pure SVG PAL/GAL fuse-matrix grid with intact and blown fuse cells", () => {
    const doc = parseJedec(sampleSrc, "sample.jed");
    const svg = renderJedecFuseMatrixSvg(doc);
    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("PAL16L8 Fuse Matrix"));
    assert.ok(svg.includes('data-state="0"'), "Should render intact (0) fuse cells");
    assert.ok(svg.includes('data-state="1"'), "Should render blown (1) fuse cells");
    assert.ok(svg.includes("O19"));
    assert.ok(svg.includes("Intact Fuse (0 = Connected)"));
    assert.ok(svg.includes("Blown Fuse (1 = Open)"));

    const lightSvg = renderJedecFuseMatrixSvg(doc, { theme: "light", maxRows: 16 });
    assert.ok(lightSvg.includes("#f8fafc"));
  });

  it("provides LSP diagnostics, document symbols, hover docs, and completions", () => {
    const validDiags = validateJedec(sampleSrc, "sample.jed");
    assert.equal(validDiags.length, 0);

    const invalidDiags = validateJedec("QP20*\nF0*\nCFFFF*", "bad.jed");
    assert.ok(invalidDiags.some((d) => d.code === "JED2001"));
    assert.ok(invalidDiags.some((d) => d.code === "JED3001"));

    const symbols = getJedecDocumentSymbols(sampleSrc, "sample.jed");
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "PAL16L8");
    assert.ok((symbols[0]?.children?.length ?? 0) >= 4);

    const hoverQp = getJedecHover(sampleSrc, { line: 1, character: 1 });
    assert.ok(hoverQp && hoverQp.contents.value.includes("pin count"));

    const hoverPal = getJedecHover(sampleSrc, { line: 5, character: 10 });
    assert.ok(hoverPal && hoverPal.contents.value.includes("PAL16L8"));

    const completions = getJedecCompletions();
    assert.ok(completions.some((c) => c.label === "QP20*"));
    assert.ok(completions.some((c) => c.label === "QF2048*"));
    assert.ok(completions.some((c) => c.label === "C0000*"));
  });

  it("recognizes .jed and .jedec files in jedecIndexing.canIndex", () => {
    assert.equal(jedecIndexing.canIndex("file:///design.jed", ""), true);
    assert.equal(jedecIndexing.canIndex("file:///design.jedec", ""), true);
    assert.equal(jedecIndexing.canIndex("file:///unknown.txt", "QP20*\nQF2048*\n"), true);
    assert.equal(jedecIndexing.canIndex("file:///other.mo", "model M end M;"), false);
  });

  it("exports JedecPanel React component", () => {
    assert.equal(typeof JedecPanel, "function");
  });
});
