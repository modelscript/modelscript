// SPDX-License-Identifier: AGPL-3.0-or-later

import { UnifiedWorkspace } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderGribMapSvg } from "../src/diagram/grib-map.js";
import { canIndexGrib, getGribDocument, indexGribDocument } from "../src/indexing.js";
import { getGribCompletions, getGribDocumentSymbols, getGribHover, validateGrib } from "../src/lsp.js";
import { parseGribDescriptor } from "../src/parser/text-parser.js";
import { GribPanel } from "../src/ui/GribPanel.js";

const SAMPLE_MULTI_GRIB = `
GRIB edition=1
  PDS {
    center = 7
    parameter = HGT
    levelType = ISBL
    level = 500
    date = "2026-01-15T12:00"
  }
  GDS {
    ni = 3
    nj = 3
    la1 = 60.0
    lo1 = -100.0
    la2 = 40.0
    lo2 = -60.0
    di = 20.0
    dj = 10.0
  }
  BDS {
    bitsPerValue = 16
    values = [5200, 5240, 5280, 5400, 5440, 5480, 5600, 5640, 5680]
  }
7777
`;

describe("GRIB1 Indexing, LSP, SVG Map & React Panel", () => {
  it("indexes GRIB1 documents in UnifiedWorkspace", () => {
    assert.equal(canIndexGrib("forecast.grib"), true);
    assert.equal(canIndexGrib("analysis.grb"), true);
    assert.equal(canIndexGrib("model.mo"), false);

    const ws = new UnifiedWorkspace();
    const uri = "file:///forecast.grib";
    const addedSymbols: Array<{ name: string; kind: string }> = [];
    indexGribDocument({
      uri,
      text: SAMPLE_MULTI_GRIB,
      workspace: ws,
      addSymbol: (name, kind) => {
        addedSymbols.push({ name, kind });
        return addedSymbols.length;
      },
      setParsedModel: (m) => ws.setParsedModel(uri, m),
    });

    const stored = getGribDocument(ws, uri);
    assert.ok(stored);
    assert.equal(stored.messages.length, 1);
    assert.ok(addedSymbols.some((s) => s.kind === "grib_parameter" && s.name === "HGT"));
    assert.ok(addedSymbols.some((s) => s.kind === "grib_grid" && s.name === "GDS_3x3"));
  });

  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const validDiags = validateGrib(SAMPLE_MULTI_GRIB, "file:///forecast.grib");
    assert.equal(validDiags.length, 0);

    const invalidDiags = validateGrib("GRIB edition=2\nPDS { parameter = 999 }\n");
    assert.ok(invalidDiags.some((d) => d.code === "GRIB1003"));
    assert.ok(invalidDiags.some((d) => d.code === "GRIB1002"));

    const symbols = getGribDocumentSymbols(SAMPLE_MULTI_GRIB);
    assert.equal(symbols.length, 1);
    assert.ok(symbols[0]!.children!.some((c) => c.name === "PDS"));
    assert.ok(symbols[0]!.children!.some((c) => c.name === "GDS"));
    assert.ok(symbols[0]!.children!.some((c) => c.name === "BDS"));

    // Hover on "HGT" (line 4 in SAMPLE_MULTI_GRIB)
    const lines = SAMPLE_MULTI_GRIB.split("\n");
    const hgtLine = lines.findIndex((l) => l.includes("HGT"));
    const hgtCol = lines[hgtLine]!.indexOf("HGT") + 1;
    const hover = getGribHover(SAMPLE_MULTI_GRIB, { line: hgtLine, character: hgtCol });
    assert.ok(hover);
    assert.ok(hover.contents.value.includes("Geopotential Height"));

    const completions = getGribCompletions("PR");
    assert.ok(completions.some((c) => c.label === "PRES"));
    assert.ok(completions.some((c) => c.label === "PRMSL"));
  });

  it("renders a pure SVG geographic heatmap with isobars, wind barbs, and colorbar", () => {
    const doc = parseGribDescriptor(SAMPLE_MULTI_GRIB);
    const svg = renderGribMapSvg(doc, { showIsobars: true, showWindBarbs: true });

    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(svg.includes('class="grib-heatmap"'));
    assert.ok(svg.includes('class="grib-isobars"'));
    assert.ok(svg.includes('class="grib-wind-barbs"'));
    assert.ok(svg.includes('class="grib-colorbar"'));
    assert.ok(svg.includes("HGT (gpm)"));
  });

  it("exports GribPanel React component", () => {
    assert.equal(typeof GribPanel, "function");
  });
});
