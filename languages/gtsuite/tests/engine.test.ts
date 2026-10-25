// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGtSuiteEngineAvailable, parseGtmModel, runGtSuiteSimulation, verifyEngineGates } from "../src/index.js";

describe("@modelscript/gtsuite Engine & Verification Suite", () => {
  const modelText = `MODEL: GateValidationEngine
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  COMP = turbo_compressor (PR = 2.0, EFF = 0.76, MASS_FLOW = 0.14)
  PLENUM = plenum (VOL = 0.0035, P = 175000, T = 315)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40)
  TURB = turbo_turbine (ER = 1.9, EFF = 0.72)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> COMP.in
  COMP.out -> PLENUM.in
  PLENUM.port1 -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> TURB.in
  TURB.out -> OUTLET.in
`;

  it("checks GT-SUITE native engine availability without throwing", async () => {
    const available = await isGtSuiteEngineAvailable("non_existent_gtise_binary");
    assert.strictEqual(available, false);
  });

  it("runs simulation with automatic WASM fallback when native binary is absent", async () => {
    const model = parseGtmModel(modelText);
    const result = await runGtSuiteSimulation(model, modelText, {
      forceWasmFallback: true,
      durationSeconds: 0.05,
    });

    assert.strictEqual(result.modelName, "GateValidationEngine");
    assert.ok(result.trajectories.length > 50);
    assert.ok(result.summary.meanTorqueNm > 0);
  });

  it("evaluates formal engine verification gates", async () => {
    const model = parseGtmModel(modelText);
    const result = await runGtSuiteSimulation(model, modelText, {
      forceWasmFallback: true,
      durationSeconds: 0.05,
    });

    const report = verifyEngineGates(result, {
      maxBsfcGPerKwh: 350.0,
      maxBoostBar: 3.0,
      maxNoxPpm: 120.0,
      minKnockMargin: 0.05,
    });

    assert.strictEqual(report.checks.length, 4);
    assert.ok(report.markdownSummary.includes("GT-SUITE Engine Verification Gate Report"));
    assert.ok(report.markdownSummary.includes("Brake Specific Fuel Consumption"));
    assert.ok(report.markdownSummary.includes("Peak Intake Manifold Boost Pressure"));
  });
});
