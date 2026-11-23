// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateGaussianHillDem } from "../src/catalog/index.js";
import { renderUsgsDemMapSvg } from "../src/diagram/index.js";
import { usgsDemIndexing } from "../src/indexing.js";
import { getUsgsDemCompletions, getUsgsDemDocumentSymbols, getUsgsDemHover, validateUsgsDem } from "../src/lsp.js";
import { serializeUsgsDem } from "../src/parser/index.js";
import { UsgsDemPanel } from "../src/ui/UsgsDemPanel.js";

describe("@modelscript/usgs-dem LSP, indexing, SVG diagram, and React UI panel", () => {
  const model = generateGaussianHillDem({ numCols: 9, numRows: 9, dx: 30, dy: 30 });
  const demText = serializeUsgsDem(model, "free-format");

  it("validates DEM documents and returns hierarchical LSP document symbols", () => {
    const diags = validateUsgsDem(demText);
    assert.equal(diags.length, 0);

    const symbols = getUsgsDemDocumentSymbols(demText);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]!.name, "GAUSSIAN_HILL_BENCHMARK");
    assert.ok((symbols[0]!.children?.length ?? 0) >= 10);
  });

  it("provides hover docs and completions for DEM keywords and stdlib schemas", () => {
    const hover = getUsgsDemHover(demText, { line: 0, character: 2 });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("Type A"));

    const completions = getUsgsDemCompletions();
    assert.ok(completions.some((c) => c.label === "TYPE_A"));
    assert.ok(completions.some((c) => c.label === "TYPE_B"));
    assert.ok(completions.some((c) => c.label === "UTM_NAD83"));
  });

  it("detects indexable USGS DEM files via usgsDemIndexing", () => {
    assert.equal(usgsDemIndexing.canIndex("terrain.dem", ""), true);
    assert.equal(usgsDemIndexing.canIndex("unknown.txt", demText), true);
    assert.equal(usgsDemIndexing.canIndex("other.txt", "hello world"), false);
  });

  it("renders a pure SVG hypsometric elevation map with contour lines and cross-section profile", () => {
    const svg = renderUsgsDemMapSvg(model, { showContours: true, showCrossSection: true });
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes('id="hypsometric-cells"'));
    assert.ok(svg.includes('id="contour-lines"'));
    assert.ok(svg.includes("<polyline"));
    assert.ok(svg.trim().endsWith("</svg>"));
  });

  it("exports UsgsDemPanel as a React function component", () => {
    assert.equal(typeof UsgsDemPanel, "function");
  });
});
