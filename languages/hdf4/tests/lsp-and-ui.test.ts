// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderHdf4DiagramSvg } from "../src/diagram/index.js";
import { hdf4Indexing } from "../src/indexing.js";
import { getHdf4Completions, getHdf4DocumentSymbols, getHdf4Hover, validateHdf4 } from "../src/lsp.js";
import { parseHdf4Ddl } from "../src/parser/ddl-parser.js";
import { Hdf4Panel } from "../src/ui/Hdf4Panel.js";

const SAMPLE_DDL = `HDF4 AquaSwath VERSION="4.2"
  SDS BrightnessTemp TYPE=FLOAT32 REF=10 UNIT="K"
    DIM scan = 2
    DIM track = 3
    DATA [240.0, 250.0, 260.0, 270.0, 280.0, 290.0]
  END
  VGROUP Geolocation CLASS="SWATH" REF=20
    MEMBER SDS BrightnessTemp
  END
END
`;

describe("HDF4 LSP, indexing, SVG diagram, and React panel", () => {
  it("provides LSP diagnostics, document symbols, hover, and completions", () => {
    const diags = validateHdf4(SAMPLE_DDL);
    assert.equal(diags.filter((d) => d.severity === 1).length, 0);

    const symbols = getHdf4DocumentSymbols(SAMPLE_DDL);
    assert.equal(symbols.length, 1);
    assert.equal(symbols[0]?.name, "AquaSwath");
    assert.ok((symbols[0]?.children?.length ?? 0) >= 2);

    const hoverKw = getHdf4Hover(SAMPLE_DDL, { line: 1, character: 3 });
    assert.ok(hoverKw?.contents.value.includes("SDS"));

    const hoverSds = getHdf4Hover(SAMPLE_DDL, { line: 1, character: 10 });
    assert.ok(hoverSds?.contents.value.includes("BrightnessTemp"));
    assert.ok(hoverSds?.contents.value.includes("265.0000"));

    const completions = getHdf4Completions(SAMPLE_DDL);
    assert.ok(completions.some((c) => c.label === "VGROUP"));
    assert.ok(completions.some((c) => c.label === "FLOAT32"));
    assert.ok(completions.some((c) => c.label === "BrightnessTemp"));
  });

  it("supports UnifiedWorkspace indexing detection", () => {
    assert.equal(hdf4Indexing.canIndex("granule.hdf", ""), true);
    assert.equal(hdf4Indexing.canIndex("granule.h4", ""), true);
    assert.equal(hdf4Indexing.canIndex("granule.txt", SAMPLE_DDL), true);
    assert.equal(hdf4Indexing.canIndex("notes.txt", "hello world"), false);
  });

  it("renders pure SVG hierarchy + 2D SDS heatmap and exports React Hdf4Panel", () => {
    const doc = parseHdf4Ddl(SAMPLE_DDL);
    const svg = renderHdf4DiagramSvg(doc, { sdsName: "BrightnessTemp", colorMode: "dark" });
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.includes("AquaSwath"));
    assert.ok(svg.includes('data-hdf4-heatmap="BrightnessTemp"'));
    assert.ok(svg.includes('data-hdf4-node="Geolocation"'));
    assert.equal(typeof Hdf4Panel, "function");
  });
});
