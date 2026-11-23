// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCif } from "../src/parser/index.js";
import { cifToGdt, cifToSvg } from "../src/projections/index.js";

const SAMPLE_CIF = `
  DS 1 100/1;
    9 MINI_GATE;
    L CAA;
    B 10 4 5 2;
    L CPG;
    B 2 8 5 2;
    L CMF;
    B 10 3 5 7;
  DF;
  C 1;
  E
`;

describe("CIF 2.0 Projections (GDSII GDT & SVG)", () => {
  it("projects CIF layout to valid GDSII GDT text with MOSIS SCMOS layer numbers", () => {
    const doc = parseCif(SAMPLE_CIF);
    const gdt = cifToGdt(doc, { libraryName: "SCMOS_LIB", cellName: "MINI_GATE" });

    assert.ok(gdt.startsWith("gds2{600"));
    assert.ok(gdt.includes("lib 'SCMOS_LIB'"));
    assert.ok(gdt.includes("'MINI_GATE'"));
    // CAA = GDS layer 43, CPG = 46, CMF = 49
    assert.ok(gdt.includes("b{43 xy("));
    assert.ok(gdt.includes("b{46 xy("));
    assert.ok(gdt.includes("b{49 xy("));
  });

  it("projects CIF layout to color-coded MOSIS SCMOS SVG with layer groups and legend", () => {
    const doc = parseCif(SAMPLE_CIF);
    const svg = cifToSvg(doc, { title: "Mini Gate", showLegend: true });

    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("<title>Mini Gate</title>"));
    assert.ok(svg.includes('id="layer-CAA"'));
    assert.ok(svg.includes('id="layer-CPG"'));
    assert.ok(svg.includes('id="layer-CMF"'));
    assert.ok(svg.includes('id="legend"'));
    assert.ok(svg.endsWith("</svg>"));
  });
});
