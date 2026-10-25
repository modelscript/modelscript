// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { interpolateMap1D, parseGdxTrajectory, parseGtmModel, parseGtTableMap } from "../src/index.js";

describe("@modelscript/gtsuite Parser Suite", () => {
  it("parses ASCII GT-SUITE engine model decks", () => {
    const deckSource = `MODEL: Turbo_I4_2L
SPEED: 3500.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.1, EFF = 0.77, MASS_FLOW = 0.16)
  INTERCOOLER = intercooler (VOL = 0.005, DP = 0.04, EFF = 0.85)
  PLENUM_IN = plenum (VOL = 0.004, P = 195000, T = 315)
  RUNNER1 = intake_runner (D = 0.045, L = 0.32)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 9.8, ANCHOR = 15, DURATION = 45)
  RUNNER_EXH1 = exhaust_runner (D = 0.038, L = 0.38)
  PLENUM_EXH = plenum (VOL = 0.0028, P = 240000, T = 1050)
  TURB = turbo_turbine (ER = 1.95, EFF = 0.73)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> INTERCOOLER.in
  INTERCOOLER.out -> PLENUM_IN.in
  PLENUM_IN.port1 -> RUNNER1.in
  RUNNER1.out -> CYL1.intake
  CYL1.exhaust -> RUNNER_EXH1.in
  RUNNER_EXH1.out -> PLENUM_EXH.port1
  PLENUM_EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

    const model = parseGtmModel(deckSource);
    assert.strictEqual(model.name, "Turbo_I4_2L");
    assert.strictEqual(model.simulationSettings.engineSpeedRpm, 3500.0);
    assert.strictEqual(model.components.length, 10);
    assert.strictEqual(model.connections.length, 9);

    const cyl1 = model.components.find((c) => c.id === "CYL1");
    assert.ok(cyl1);
    assert.strictEqual(cyl1.kind, "cylinder");
    if (cyl1.kind === "cylinder") {
      assert.strictEqual(cyl1.boreM, 0.0825);
      assert.strictEqual(cyl1.strokeM, 0.0928);
      assert.strictEqual(cyl1.compressionRatio, 9.8);
      assert.strictEqual(cyl1.combustionModel.anchorAngleDeg, 15.0);
    }
  });

  it("parses XML GT-SUITE model exports", () => {
    const xmlSource = `<?xml version="1.0" encoding="UTF-8"?>
<GTModel name="Modern_GDI_Engine">
  <SimulationSettings duration="6.0" timeStep="0.00005" engineSpeed="4000" />
  <Components>
    <Component id="CYL1" kind="cylinder" bore="0.085" stroke="0.088" rodLength="0.142" compressionRatio="10.5">
      <Combustion type="wiebe" anchorAngle="12.0" duration="42.0" exponent="2.1" />
      <HeatTransfer type="woschni" wallTemperature="460.0" />
    </Component>
    <Component id="INTAKE_PIPE" kind="pipe" diameter="0.048" length="0.28" />
  </Components>
  <Connections>
    <Connection from="INTAKE_PIPE" fromPort="out" to="CYL1" toPort="intake" />
  </Connections>
</GTModel>`;

    const model = parseGtmModel(xmlSource);
    assert.strictEqual(model.name, "Modern_GDI_Engine");
    assert.strictEqual(model.simulationSettings.engineSpeedRpm, 4000.0);
    assert.strictEqual(model.components.length, 2);
    assert.strictEqual(model.connections.length, 1);

    const cyl = model.components[0]!;
    assert.strictEqual(cyl.id, "CYL1");
    if (cyl.kind === "cylinder") {
      assert.strictEqual(cyl.boreM, 0.085);
      assert.strictEqual(cyl.strokeM, 0.088);
      assert.strictEqual(cyl.compressionRatio, 10.5);
    }
  });

  it("parses tabular performance maps and evaluates 1D interpolation", () => {
    const mapSource = `NAME: CompressorMap
TYPE: compressor
HEADERS: PR FLOW EFF
1.0 0.01 0.65
1.5 0.08 0.74
2.0 0.15 0.78
2.5 0.22 0.72`;

    const map = parseGtTableMap(mapSource);
    assert.strictEqual(map.id, "CompressorMap");
    assert.strictEqual(map.type, "compressor");
    assert.strictEqual(map.data.length, 4);

    const effAt1_75 = interpolateMap1D(map.data, 1.75, 0, 2);
    assert.ok(effAt1_75 > 0.74 && effAt1_75 < 0.78);
  });

  it("parses GT-POST trajectory output files", () => {
    const csvSource = `Time_s,CrankAngle_deg,P_cyl_Pa,T_cyl_K,Torque_Nm,Power_kW,AirFlow_kg_s,BSFC_g_kWh,NOx_ppm
0.000,0.0,7500000,2400,285.0,89.5,0.082,235.0,48.0
0.001,18.0,6200000,2100,290.0,91.0,0.082,232.0,46.0
0.002,36.0,4100000,1750,280.0,88.0,0.082,238.0,42.0`;

    const res = parseGdxTrajectory(csvSource, "BenchmarkRun");
    assert.strictEqual(res.modelName, "BenchmarkRun");
    assert.strictEqual(res.trajectories.length, 3);
    assert.ok(res.summary.meanTorqueNm > 280.0);
    assert.strictEqual(res.summary.maxCylinderPressureBar, 75.0);
  });
});
