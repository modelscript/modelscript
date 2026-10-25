// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintGtModel, parseGtmModel } from "../src/index.js";

describe("@modelscript/gtsuite Linter Suite", () => {
  it("passes clean engine models without errors", () => {
    const cleanSource = `MODEL: CleanEngine
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  INLET = environment_inlet (P = 101325, T = 298.15)
  RUNNER = intake_runner (D = 0.045, L = 0.35, CELLS = 15)
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 10.0, ANCHOR = 15, DURATION = 45)
  EXH = exhaust_runner (D = 0.040, L = 0.40, CELLS = 15)
  OUTLET = environment_outlet (P = 101325, T = 298.15)

CONNECTIONS:
  INLET.out -> RUNNER.in
  RUNNER.out -> CYL1.intake
  CYL1.exhaust -> EXH.in
  EXH.out -> OUTLET.in
`;

    const model = parseGtmModel(cleanSource);
    // Use appropriate time step so CFL is satisfied
    model.simulationSettings.timeStepSeconds = 0.00002;
    const diags = lintGtModel(model);
    assert.strictEqual(diags.length, 0);
  });

  it("detects M9005 (invalid compression ratio) and M9012 (out-of-bounds lambda)", () => {
    const faultySource = `MODEL: BadEngine
SPEED: 3000.0
LAMBDA: 3.5

COMPONENTS:
  CYL1 = cylinder (BORE = 0.0825, STROKE = 0.0928, ROD = 0.144, CR = 35.0, ANCHOR = 15, DURATION = 45)
`;

    const model = parseGtmModel(faultySource);
    const diags = lintGtModel(model);

    const m9005 = diags.find((d) => d.code === 9005);
    assert.ok(m9005, "Expected M9005 for CR = 35.0");

    const m9012 = diags.find((d) => d.code === 9012);
    assert.ok(m9012, "Expected M9012 for lambda = 3.5");
  });

  it("detects M9002 (compressor surge) and M9006 (unconnected plenum)", () => {
    const surgeSource = `MODEL: SurgeEngine
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  COMP1 = turbo_compressor (PR = 3.2, MASS_FLOW = 0.015, SPEED = 140000, EFF = 0.65)
  ISOLATED_PLENUM = plenum (VOL = 0.005, P = 101325, T = 300)
`;

    const model = parseGtmModel(surgeSource);
    const diags = lintGtModel(model);

    const m9002 = diags.find((d) => d.code === 9002);
    assert.ok(m9002, "Expected M9002 for compressor in surge");

    const m9006 = diags.find((d) => d.code === 9006);
    assert.ok(m9006, "Expected M9006 for unconnected plenum");
  });

  it("detects M9001 (CFL acoustic limit violation on long time steps)", () => {
    const cflSource = `MODEL: ShortRunner
SPEED: 3000.0
LAMBDA: 1.0

COMPONENTS:
  SHORT_RUNNER = intake_runner (D = 0.040, L = 0.05, CELLS = 10)
`;

    const model = parseGtmModel(cflSource);
    // dx = 0.05 / 10 = 0.005 m. maxDt = 0.005 / 360 ~= 13.8 µs.
    // If dt = 0.001 s (1000 µs), CFL should trigger M9001.
    model.simulationSettings.timeStepSeconds = 0.001;
    const diags = lintGtModel(model);

    const m9001 = diags.find((d) => d.code === 9001);
    assert.ok(m9001, "Expected M9001 for CFL violation");
  });
});
