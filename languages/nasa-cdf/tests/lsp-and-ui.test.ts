// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderNasaCdfStripChartSvg } from "../src/diagram/index.js";
import { canIndexNasaCdf } from "../src/indexing.js";
import { getNasaCdfCompletions, getNasaCdfDocumentSymbols, getNasaCdfHover, validateNasaCdf } from "../src/lsp.js";
import { parseCdfSkeleton } from "../src/parser/skt-parser.js";
import { NasaCdfPanel } from "../src/ui/NasaCdfPanel.js";

const SAMPLE_SKT = `#header
  CDF NAME: cluster_fgm_2025.cdf
  DATA ENCODING: NETWORK
  MAJORITY: ROW_MAJOR
  FORMAT: SINGLE
  VERSION: 3.8.0
#GLOBALattributes
  "Project" 0: CDF_CHAR { "Cluster" }
  "Source_name" 0: CDF_CHAR { "C1" }
  "Discipline" 0: CDF_CHAR { "Space Physics" }
  "Data_type" 0: CDF_CHAR { "L2" }
  "Descriptor" 0: CDF_CHAR { "FGM" }
#VARIABLEattributes
  "DEPEND_0"
  "UNITS"
  "VALIDMIN"
  "VALIDMAX"
#variables
  "EPOCH" CDF_EPOCH 1 0:[] T
    [0] = "2025-03-15T12:00:00.000Z"
    [1] = "2025-03-15T12:00:01.000Z"
    [2] = "2025-03-15T12:00:02.000Z"
  .
  "B_GSE" CDF_REAL4 1 1:[3] T T
    "DEPEND_0" CDF_CHAR { "EPOCH" }
    "UNITS" CDF_CHAR { "nT" }
    "VALIDMIN" CDF_REAL4 { -1000.0, -1000.0, -1000.0 }
    "VALIDMAX" CDF_REAL4 { 1000.0, 1000.0, 1000.0 }
    [0] = { 3.0, 4.0, 0.0 }
    [1] = { 4.0, 3.0, 2.0 }
    [2] = { 2.0, 5.0, 1.0 }
  .
#end
`;

describe("NASA CDF Indexing, LSP, Strip-Chart SVG & React Panel", () => {
  it("identifies .skt and .cdf files in workspace indexer", () => {
    assert.equal(canIndexNasaCdf("file:///mission/tha_fgm.skt"), true);
    assert.equal(canIndexNasaCdf("file:///mission/tha_fgm.cdf"), true);
    assert.equal(canIndexNasaCdf("file:///mission/notes.txt", SAMPLE_SKT), true);
    assert.equal(canIndexNasaCdf("file:///mission/notes.txt", "hello world"), false);
  });

  it("provides LSP diagnostics, document symbols, hover docs, and completions", () => {
    const diags = validateNasaCdf(SAMPLE_SKT);
    assert.equal(diags.length, 0);

    const symbols = getNasaCdfDocumentSymbols(SAMPLE_SKT);
    assert.equal(symbols.length, 3);
    assert.equal(symbols[2]?.name, "#variables");
    assert.equal(symbols[2]?.children?.length, 2);

    const hoverHeader = getNasaCdfHover(SAMPLE_SKT, { line: 0, character: 2 });
    assert.ok(hoverHeader?.contents.value.includes("#header"));

    const dependLine = SAMPLE_SKT.split("\n").findIndex((l) => l.includes('"DEPEND_0"'));
    const dependChar = SAMPLE_SKT.split("\n")[dependLine]!.indexOf("DEPEND_0") + 2;
    const hoverDepend0 = getNasaCdfHover(SAMPLE_SKT, { line: dependLine, character: dependChar });
    assert.ok(hoverDepend0?.contents.value.includes("DEPEND_0"));

    const completions = getNasaCdfCompletions();
    assert.ok(completions.some((c) => c.label === "CDF_EPOCH"));
    assert.ok(completions.some((c) => c.label === "DEPEND_0"));
    assert.ok(completions.some((c) => c.label === "ROW_MAJOR"));
  });

  it("renders a multi-channel SVG strip chart and exports NasaCdfPanel React component", () => {
    const doc = parseCdfSkeleton(SAMPLE_SKT);
    const svg = renderNasaCdfStripChartSvg(doc);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("B_GSE_x (nT)"));
    assert.ok(svg.includes("|B_GSE| (nT)"));
    assert.ok(svg.includes("<polyline"));
    assert.equal(typeof NasaCdfPanel, "function");
  });
});
