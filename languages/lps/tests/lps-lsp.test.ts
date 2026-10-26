// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerLpsToDae } from "../src/dae/index.js";
import { executeLpsAction, getLpsDocumentSymbols, getLpsHover, validateLps } from "../src/lsp.js";
import { parseLps } from "../src/parser/index.js";
import { lpsToModelica } from "../src/projections/lps-to-modelica.js";

const SAMPLE_XML = `<?xml version="1.0" encoding="utf-8"?>
<PipelineStudio id="study_texas_trunk" title="Texas Gulf Coast Gas Trunkline" simulationType="TGNET">
  <Nodes>
    <Node name="Hub_Supply" type="SUPPLY" elevation="10m" pressure="75.0bar" flow="120.0" />
    <Node name="Mid_Compressor_Suction" type="JUNCTION" elevation="25m" />
    <Node name="Mid_Compressor_Discharge" type="JUNCTION" elevation="25m" />
    <Node name="City_Gate_Delivery" type="DELIVERY" elevation="5m" minDeliveryPressure="35.0bar" flow="120.0" />
  </Nodes>
  <Pipes>
    <Pipe name="Line_101" from="Hub_Supply" to="Mid_Compressor_Suction" length="80.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
    <Pipe name="Line_102" from="Mid_Compressor_Discharge" to="City_Gate_Delivery" length="110.0km" diameter="30inch" roughness="0.000045m" maop="95.0bar" />
  </Pipes>
  <Compressors>
    <Compressor name="Station_A" from="Mid_Compressor_Suction" to="Mid_Compressor_Discharge" type="CENTRIFUGAL" power="22000000" maxRatio="1.8" efficiency="0.84" mode="DISCHARGE_PRESSURE" setpoint="85.0bar" status="RUNNING" />
  </Compressors>
  <GasComposition ch4="0.91" c2h6="0.05" c3h8="0.018" co2="0.008" n2="0.014" h2="0.05" ghv="39.2" />
  <SimulationControls startTime="0" endTime="86400" timeStep="60" eos="AGA8" steadyStateFirst="true" />
</PipelineStudio>`;

describe("PipelineStudio LSP Services & DAE Lowering (@modelscript/lps)", () => {
  it("validates LPS network and returns 0 error diagnostics for valid model", () => {
    const diags = validateLps(SAMPLE_XML);
    assert.ok(Array.isArray(diags));
    const errors = diags.filter((d) => d.severity === 1);
    assert.equal(errors.length, 0);
  });

  it("extracts document symbols hierarchy for nodes, pipes, and compressors", () => {
    const symbols = getLpsDocumentSymbols(SAMPLE_XML);
    assert.ok(symbols.length > 0);
    assert.equal(symbols[0]?.name, "Texas Gulf Coast Gas Trunkline");
    assert.ok(symbols[0]?.children?.some((c) => c.name === "Hub_Supply"));
    assert.ok(symbols[0]?.children?.some((c) => c.name === "Line_101"));
    assert.ok(symbols[0]?.children?.some((c) => c.name === "Station_A"));
  });

  it("provides contextual hover information for pipeline elements", () => {
    const lines = SAMPLE_XML.split(/\r?\n/);
    const pipeLineIdx = lines.findIndex((l) => l.includes("Line_101"));
    const hover = getLpsHover(SAMPLE_XML, { line: pipeLineIdx, character: 15 });
    assert.ok(hover);
    assert.ok(hover?.contents.value.includes("Line_101"));
  });

  it("lowers pipeline network into linear-memory DAE arena", () => {
    const model = parseLps(SAMPLE_XML);
    const dae = lowerLpsToDae(model);
    assert.ok(dae.varCount >= 10);
    assert.ok(dae.eqCount >= 5);
  });

  it("projects network into Modelica 3.x Fluid components", () => {
    const model = parseLps(SAMPLE_XML);
    const mo = lpsToModelica(model);
    assert.ok(mo.includes("model Texas_Gulf_Coast_Gas_Trunkline"));
    assert.ok(mo.includes("Modelica.Fluid.Pipes.DynamicPipe"));
    assert.ok(mo.includes("Modelica.Fluid.Machines.PrescribedPump"));
    assert.ok(mo.includes("connect(Hub_Supply.ports[1], Line_101.port_a)"));
  });

  it("executes domain actions: lint, to_sysml, to_modelica, to_dae, solve_steady", async () => {
    const lintRes = await executeLpsAction("lint", { content: SAMPLE_XML });
    assert.ok(Array.isArray(lintRes));

    const daeRes = await executeLpsAction("to_dae", { content: SAMPLE_XML });
    assert.ok(daeRes.varCount > 0);
    assert.ok(daeRes.eqCount > 0);

    const moRes = await executeLpsAction("to_modelica", { content: SAMPLE_XML });
    assert.ok(typeof moRes === "string" && moRes.includes("model"));

    const steadyRes = await executeLpsAction("solve_steady", { content: SAMPLE_XML });
    assert.ok(steadyRes);
  });
});
