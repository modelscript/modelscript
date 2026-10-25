// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGtSuiteDiagramData,
  gtsuiteToModelica,
  gtsuiteToSsp,
  gtsuiteToSysml2,
  parseGtmModel,
  renderGtSuiteSchematicSvg,
} from "../src/index.js";

describe("@modelscript/gtsuite Projections & Diagram Suite", () => {
  const modelSource = `MODEL: BenchmarkEngine
SPEED: 3200.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.2, EFF = 0.76, MASS_FLOW = 0.15)
  IC = intercooler (VOL = 0.005, DP = 0.04, EFF = 0.85)
  PLENUM = plenum (VOL = 0.0035, P = 190000, T = 315)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 2.0, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> IC.in
  IC.out -> PLENUM.in
  PLENUM.port1 -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

  it("projects GT-SUITE engine model to SysML v2 syntax", () => {
    const model = parseGtmModel(modelSource);
    const sysml = gtsuiteToSysml2(model);

    assert.ok(sysml.includes("package BenchmarkEnginePowertrainSystem"));
    assert.ok(sysml.includes("port def AirIntakePort"));
    assert.ok(sysml.includes("port def ExhaustGasPort"));
    assert.ok(sysml.includes("part def BenchmarkEngineSystem"));
    assert.ok(sysml.includes("requirement def BrakeSpecificFuelConsumptionRequirement"));
    assert.ok(sysml.includes("requirement def MaxManifoldBoostPressureRequirement"));
    assert.ok(sysml.includes("requirement def Euro7TailpipeNoxCeilingRequirement"));
  });

  it("projects GT-SUITE engine model to Modelica 3.x continuous model", () => {
    const model = parseGtmModel(modelSource);
    const mo = gtsuiteToModelica(model);

    assert.ok(mo.includes("model BenchmarkEngine"));
    assert.ok(mo.includes("parameter Real engineSpeedRpm = 3200;"));
    assert.ok(mo.includes("Real P_intake_manifold"));
    assert.ok(mo.includes("Real P_exhaust_manifold"));
    assert.ok(mo.includes("der(P_intake_manifold)"));
    assert.ok(mo.includes("end BenchmarkEngine;"));
  });

  it("projects GT-SUITE engine model to FMI SystemStructure and Parameterization (SSP) XML", () => {
    const model = parseGtmModel(modelSource);
    const ssp = gtsuiteToSsp(model);

    assert.ok(ssp.includes("<ssd:SystemStructureDescription"));
    assert.ok(ssp.includes('name="BenchmarkEngine"'));
    assert.ok(ssp.includes('<ssd:Component name="CYL1"'));
    assert.ok(ssp.includes('<ssd:Connection startElement="INLET"'));
  });

  it("generates AntV X6 graph models and vector SVG schematic drawings", () => {
    const model = parseGtmModel(modelSource);
    const graphData = buildGtSuiteDiagramData(model);

    assert.strictEqual(graphData.nodes.length, 8);
    assert.strictEqual(graphData.edges.length, 7);

    const svgSchematic = renderGtSuiteSchematicSvg(model, { view: "schematic" });
    assert.ok(svgSchematic.includes("<svg"));
    assert.ok(svgSchematic.includes("Air Inlet"));
    assert.ok(svgSchematic.includes("COMP"));
    assert.ok(svgSchematic.includes("Intercooler"));
    assert.ok(svgSchematic.includes("Intake Manifold Plenum"));
    assert.ok(svgSchematic.includes("TURB"));
    assert.ok(svgSchematic.includes("</svg>"));

    const svgPv = renderGtSuiteSchematicSvg(model, { view: "pv" });
    assert.ok(svgPv.includes("P-V Indicator Diagram"));
  });
});
