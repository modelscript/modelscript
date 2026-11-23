// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseGerber } from "../src/parser/index.js";
import { gerberToDxf, gerberToSvg } from "../src/projections/index.js";

describe("@modelscript/gerber — SVG & DXF Projections", () => {
  const sampleGerber = [
    "%FSLAX34Y34*%",
    "%MOMM*%",
    "%ADD10C,0.254*%",
    "%ADD11C,1.200X0.600*%",
    "%ADD12R,2.000X1.000*%",
    "%ADD13P,1.600X6X0*%",
    "%LPD*%",
    "G75*",
    "G01*",
    "D10*",
    "X0Y0D02*",
    "X100000Y0D01*",
    "G03X100000Y40000I0J20000D01*",
    "D11*",
    "X0Y0D03*",
    "D12*",
    "X50000Y20000D03*",
    "D13*",
    "X80000Y20000D03*",
    "G36*",
    "G01*",
    "X20000Y50000D02*",
    "X60000Y50000D01*",
    "X60000Y70000D01*",
    "X20000Y70000D01*",
    "X20000Y50000D01*",
    "G37*",
    "M02*",
  ].join("\n");

  it("projects Gerber strokes, arcs, flashes (C/R/P + holes), and regions to valid SVG", () => {
    const doc = parseGerber(sampleGerber, "board.gtl");
    const svg = gerberToSvg(doc, { title: "Top Copper" });

    assert.ok(svg.startsWith("<svg "));
    assert.ok(svg.includes("viewBox="));
    assert.ok(svg.includes("<title>Top Copper</title>"));
    assert.ok(svg.includes("<line "), "Expected linear stroke <line>");
    assert.ok(svg.includes('<path d="M '), "Expected arc or region <path>");
    assert.ok(svg.includes("<circle "), "Expected circular flash & hole <circle>");
    assert.ok(svg.includes("<rect "), "Expected rectangular flash <rect>");
    assert.ok(svg.includes("<polygon "), "Expected hexagonal flash <polygon>");
    assert.ok(svg.trimEnd().endsWith("</svg>"));
  });

  it("projects Gerber layer to valid ASCII AutoCAD DXF with HEADER, TABLES, ENTITIES, and EOF", () => {
    const doc = parseGerber(sampleGerber, "board.gtl");
    const dxf = gerberToDxf(doc, { layerName: "TOP_COPPER" });

    assert.ok(dxf.includes("HEADER"));
    assert.ok(dxf.includes("$INSUNITS\n70\n4"));
    assert.ok(dxf.includes("TABLES"));
    assert.ok(dxf.includes("TOP_COPPER"));
    assert.ok(dxf.includes("ENTITIES"));
    assert.ok(dxf.includes("\nLINE\n"), "Expected DXF LINE entity");
    assert.ok(dxf.includes("\nARC\n"), "Expected DXF ARC entity");
    assert.ok(dxf.includes("\nCIRCLE\n"), "Expected DXF CIRCLE entity");
    assert.ok(dxf.includes("\nLWPOLYLINE\n"), "Expected DXF LWPOLYLINE entity");
    assert.ok(dxf.trimEnd().endsWith("EOF"));
  });
});
