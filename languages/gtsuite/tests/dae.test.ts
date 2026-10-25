// SPDX-License-Identifier: AGPL-3.0-or-later

import { DAEBuilder } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowerGtSuiteToDae, parseGtmModel, simulateGtSuiteTransient } from "../src/index.js";

describe("@modelscript/gtsuite DAE & Simulation Suite", () => {
  const modelText = `MODEL: Test_Turbo_4Cyl
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.0, EFF = 0.76, MASS_FLOW = 0.14)
  PLENUM_IN = plenum (VOL = 0.0035, P = 180000, T = 315)
  RUNNER1 = intake_runner (D = 0.045, L = 0.35)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 1.9, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> PLENUM_IN.in
  PLENUM_IN.port1 -> RUNNER1.in
  RUNNER1.out -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

  it("lowers Mean-Value Engine Model directly into DAEBuilder linear memory", () => {
    const model = parseGtmModel(modelText);
    const builder = new DAEBuilder();
    const result = lowerGtSuiteToDae(builder, model);

    assert.ok(
      result.stateVarIndices.length >= 2,
      "Expected state variables (intake & exhaust manifold pressure, turbo speed)",
    );
    assert.ok(result.equationCount >= 5, "Expected continuous differential & algebraic equations");
    assert.ok(result.variableMap.has("P_INTAKE_MANIFOLD"));
    assert.ok(result.variableMap.has("P_EXHAUST_MANIFOLD"));
    assert.ok(result.variableMap.has("ENGINE_BRAKE_TORQUE_NM"));
  });

  it("runs in-WASM transient cylinder and thermodynamic simulation", () => {
    const model = parseGtmModel(modelText);
    const simResult = simulateGtSuiteTransient(model, {
      durationSeconds: 0.1,
      timeStepSeconds: 0.0002,
      engineSpeedRpm: 3200.0,
    });

    assert.strictEqual(simResult.modelName, "Test_Turbo_4Cyl");
    assert.ok(simResult.trajectories.length > 100);

    const firstPoint = simResult.trajectories[0]!;
    assert.ok(firstPoint.cylinderPressurePa[0]! > 0);
    assert.ok(firstPoint.cylinderTemperatureK[0]! > 0);

    // Summary metrics validation
    assert.ok(simResult.summary.meanTorqueNm > 100.0, "Expected positive mean engine brake torque");
    assert.ok(simResult.summary.meanPowerKw > 30.0, "Expected positive engine power");
    assert.ok(simResult.summary.maxCylinderPressureBar > 30.0, "Expected peak firing pressure > 30 bar");
    assert.ok(simResult.summary.meanBsfcGPerKwh > 150.0 && simResult.summary.meanBsfcGPerKwh < 500.0);
  });
});
