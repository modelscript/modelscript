// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRocetsDiagramData,
  parseRocetsDeck,
  renderRocetsPidSvg,
  rocetsToModelica,
  rocetsToSsp,
  RocetsWorkspaceIndex,
} from "../src/index.js";

describe("@modelscript/rocets Projections & Diagrams Suite", () => {
  const sampleDeck = `DECK: J2X_Engine
TITLE: "J-2X Upper Stage Engine Gas Generator Cycle"
COMPONENTS:
  CHAMBER TYPE=CHAMBER
    PARAMS: PC=9.5E6, AT=0.035, CSTAR=1790.0, VC=0.02
  PUMP_OX TYPE=PUMP
    PARAMS: DELTA_P=14.0E6, ETA=0.77
  FPUMP TYPE=PUMP
    PARAMS: DELTA_P=18.0E6, ETA=0.75
  TURB01 TYPE=TURBINE
    PARAMS: PR=1.55, ETA=0.73, T_IN=920.0
CONNECTIONS:
  PUMP_OX.OUT_P -> CHAMBER.IN_OX
  FPUMP.OUT_P -> CHAMBER.IN_FUEL
  TURB01.OUT_P -> CHAMBER.IN_GAS
`;

  it("projects to clean Modelica 3.x physical models", () => {
    const model = parseRocetsDeck(sampleDeck);
    const mo = rocetsToModelica(model);

    assert.ok(mo.includes("model J2X_Engine"), "Expected model J2X_Engine declaration");
    assert.ok(mo.includes("CHAMBER_Pc"), "Expected chamber pressure state");
    assert.ok(mo.includes("PUMP_OX_power"), "Expected oxidizer pump power");
    assert.ok(mo.includes("CHAMBER_IN_OX = PUMP_OX_OUT_P;"), "Expected connection equality");
    assert.ok(mo.includes("end J2X_Engine;"), "Expected end statement");
  });

  it("projects to FMI System Structure and Parameterization (SSP) XML", () => {
    const model = parseRocetsDeck(sampleDeck);
    const ssp = rocetsToSsp(model);

    assert.ok(ssp.includes('name="J2X_Engine"'), "Expected SSP system name");
    assert.ok(ssp.includes('name="CHAMBER"'), "Expected chamber component");
    assert.ok(ssp.includes('startElement="PUMP_OX"'), "Expected connection start");
    assert.ok(ssp.includes('endElement="CHAMBER"'), "Expected connection end");
  });

  it("builds AntV X6 graph model and SVG P&ID flow diagram", () => {
    const model = parseRocetsDeck(sampleDeck);
    const graphData = buildRocetsDiagramData(model);

    assert.strictEqual(graphData.nodes.length, 4);
    assert.strictEqual(graphData.edges.length, 3);

    const svg = renderRocetsPidSvg(model);
    assert.ok(svg.includes("<svg"), "Expected SVG opening tag");
    assert.ok(svg.includes("CHAMBER"), "Expected CHAMBER node in SVG");
    assert.ok(svg.includes("P&amp;ID Schematic"), "Expected P&ID diagram title");
    assert.ok(svg.includes("</svg>"), "Expected SVG closing tag");
  });

  it("indexes symbols across workspace files", () => {
    const index = new RocetsWorkspaceIndex();
    const uri = "file:///models/j2x.roc";
    const symIdx = index.indexFile(uri, sampleDeck);

    assert.ok(symIdx);
    assert.strictEqual(index.fileCount, 1);
    assert.ok(index.has(uri));

    const modelSyms = symIdx.byName.get("J2X_Engine");
    assert.ok(modelSyms && modelSyms.length > 0, "Expected J2X_Engine root symbol");

    const partial = index.toUnifiedPartial();
    assert.ok(partial.symbols.size >= 5, "Expected unified symbols");
  });
});
