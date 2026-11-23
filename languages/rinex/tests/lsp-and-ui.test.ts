// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderRinexSkyplotSvg } from "../src/diagram/index.js";
import { rinexIndexing } from "../src/indexing.js";
import { getRinexCompletions, getRinexDocumentSymbols, getRinexHover, validateRinex } from "../src/lsp.js";
import { RinexPanel } from "../src/ui/RinexPanel.js";

function headerLine(data: string, label: string): string {
  return data.padEnd(60, " ") + label;
}

const SAMPLE_OBS = [
  headerLine("     2.11           OBSERVATION DATA    G (GPS)", "RINEX VERSION / TYPE"),
  headerLine("WTZR", "MARKER NAME"),
  headerLine("  4075580.4890   931853.8610  4801568.1760", "APPROX POSITION XYZ"),
  headerLine("     2    C1    L1", "# / TYPES OF OBSERV"),
  headerLine("", "END OF HEADER"),
  " 24  5  1  0  0  0.0000000  0  4G01G05G12G24",
  "  21456789.123 7 112756123.45607",
  "  22891234.567 8 120293456.78908",
  "  23123456.789 6 121512345.67806",
  "  20567890.321 9 108084321.12309",
].join("\n");

describe("RINEX v2 Indexing, LSP, SVG Skyplot & React UI Panel", () => {
  it("validates RINEX documents and extracts LSP document symbols", () => {
    const diags = validateRinex(SAMPLE_OBS, "station.obs");
    assert.strictEqual(diags.length, 0);

    const symbols = getRinexDocumentSymbols(SAMPLE_OBS);
    assert.ok(symbols.length >= 2);
    assert.ok(symbols[0]!.name.includes("WTZR"));
    assert.strictEqual(symbols[1]!.children?.length, 4);
  });

  it("provides hover documentation for header labels, observation types, and PRNs", () => {
    const headerHover = getRinexHover(SAMPLE_OBS, { line: 0, character: 65 });
    assert.ok(headerHover?.contents.value.includes("RINEX VERSION / TYPE"));

    const obsHover = getRinexHover(SAMPLE_OBS, { line: 3, character: 10 });
    assert.ok(obsHover?.contents.value.includes("C1"));

    const prnHover = getRinexHover(SAMPLE_OBS, { line: 5, character: 33 });
    assert.ok(prnHover?.contents.value.includes("G01"));
  });

  it("provides completions for RINEX observation codes and header labels", () => {
    const obsItems = getRinexCompletions(SAMPLE_OBS, { line: 3, character: 10 });
    assert.ok(obsItems.some((c) => c.label === "C1"));
    assert.ok(obsItems.some((c) => c.label === "WGS84_MU"));

    const headerItems = getRinexCompletions(SAMPLE_OBS, { line: 0, character: 62 });
    assert.ok(headerItems.some((c) => c.label === "END OF HEADER"));
  });

  it("detects indexable RINEX files via rinexIndexing.canIndex", () => {
    assert.strictEqual(rinexIndexing.canIndex("wetz0010.24o", ""), true);
    assert.strictEqual(rinexIndexing.canIndex("brdc0010.nav", ""), true);
    assert.strictEqual(rinexIndexing.canIndex("data.txt", SAMPLE_OBS), true);
    assert.strictEqual(rinexIndexing.canIndex("notes.md", "hello"), false);
  });

  it("renders a pure SVG polar skyplot + residual bar chart and exports RinexPanel", () => {
    const svg = renderRinexSkyplotSvg([
      {
        prn: "G01",
        azimuthDeg: 45,
        elevationDeg: 62,
        pseudorangeM: 21e6,
        computedRangeM: 21e6,
        residualM: 0.15,
        satPos: { x: 0, y: 0, z: 0 },
      },
      {
        prn: "G05",
        azimuthDeg: 135,
        elevationDeg: 38,
        pseudorangeM: 22e6,
        computedRangeM: 22e6,
        residualM: -0.22,
        satPos: { x: 0, y: 0, z: 0 },
      },
      {
        prn: "G12",
        azimuthDeg: 225,
        elevationDeg: 25,
        pseudorangeM: 23e6,
        computedRangeM: 23e6,
        residualM: 0.08,
        satPos: { x: 0, y: 0, z: 0 },
      },
      {
        prn: "G24",
        azimuthDeg: 315,
        elevationDeg: 74,
        pseudorangeM: 20.5e6,
        computedRangeM: 20.5e6,
        residualM: -0.04,
        satPos: { x: 0, y: 0, z: 0 },
      },
    ]);

    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(svg.includes("G01"));
    assert.ok(svg.includes("G24"));
    assert.ok(svg.includes("Pseudorange Post-Fit Residuals"));
    assert.strictEqual(typeof RinexPanel, "function");
  });
});
