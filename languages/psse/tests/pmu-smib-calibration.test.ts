// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyCalibrationToDyrCase,
  buildSmibConfig,
  calibrateDyrParameters,
  computeGoodnessOfFit,
  generateNercMod026VerificationReport,
  parseDyr,
  parseRaw,
  PmuSmibHarness,
  serializeDyrCase,
  type PmuPlaybackTelemetry,
} from "../src/index.js";

const TEST_RAW = `0, 100.0, 33, 0, 0, 60.0 / IEEE 9-Bus Generator Test Case
1, 'BUS 1', 16.5, 3, 1, 1, 1, 1.0400, 0.0000, 1.100, 0.900, 1.100, 0.900 /
0 / END OF BUS DATA, BEGIN LOAD DATA
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1', 100.0, 30.0, 300.0, -300.0, 1.040, 0, 100.0, 0.0, 0.04, 0.0, 0.0, 1.0, 1, 100.0, 250.0, 10.0 /
0 / END OF GENERATOR DATA
Q
`;

const TEST_DYR = `1 'GENROU' '1' 8.96 0.05 0.60 0.05 5.0 0.0 1.56 1.06 0.296 0.296 0.177 0.13 0.10 0.30 /
1 'EXST1' '1' 0.0 5.0 -5.0 0.0 0.0 100.0 0.05 4.0 -4.0 0.0 0.0 0.0 /
1 'TGOV1' '1' 0.04 0.1 1.05 0.0 0.0 0.0 0.0 /
`;

describe("PMU SMIB Playback & Dynamic Parameter Calibration (MOD-026 / MOD-027)", () => {
  it("initializes SMIB config from PSS/E .raw and .dyr cases", () => {
    const psseCase = parseRaw(TEST_RAW);
    const dyrCase = parseDyr(TEST_DYR);
    const gen = psseCase.generators[0]!;
    const dyrGen = dyrCase.generatorsByBusId.get("1_1");
    const dyrExc = dyrCase.excitersByBusId.get("1_1");
    const dyrGov = dyrCase.governorsByBusId.get("1_1");

    const config = buildSmibConfig(gen, dyrGen, dyrExc, dyrGov);
    assert.equal(config.busNumber, 1);
    assert.equal(config.genId, "1");
    assert.equal(config.generatorModel, "GENROU");
    assert.equal(config.H, 5.0);
    assert.equal(config.Ka, 100.0);
    assert.equal(config.droopR, 0.04);
  });

  it("maintains flat steady-state under undisturbed nominal conditions", () => {
    const psseCase = parseRaw(TEST_RAW);
    const dyrCase = parseDyr(TEST_DYR);
    const gen = psseCase.generators[0]!;
    const config = buildSmibConfig(
      gen,
      dyrCase.generatorsByBusId.get("1_1"),
      dyrCase.excitersByBusId.get("1_1"),
      dyrCase.governorsByBusId.get("1_1"),
    );

    const harness = new PmuSmibHarness(config);
    const dt = 0.01;
    const steps = 100;
    const time = new Float64Array(steps);
    const vt = new Float64Array(steps);
    const freq = new Float64Array(steps);
    const pMeas = new Float64Array(steps);
    const qMeas = new Float64Array(steps);

    for (let i = 0; i < steps; i++) {
      time[i] = i * dt;
      vt[i] = 1.04;
      freq[i] = 60.0;
      pMeas[i] = 100.0;
      qMeas[i] = 30.0;
    }

    const telemetry: PmuPlaybackTelemetry = {
      timeSec: time,
      vTerminalPu: vt,
      frequencyHz: freq,
      pActiveMw: pMeas,
      qReactiveMvar: qMeas,
    };

    const res = harness.simulate(telemetry);
    assert.equal(res.timeSec.length, steps);

    // After 1 second of steady state, P and Q should stay within 1% of initial values
    const finalP = res.pSimMw[steps - 1]!;
    const finalQ = res.qSimMvar[steps - 1]!;
    assert.ok(Math.abs(finalP - 100.0) < 1.0, `Expected P ~100 MW, got ${finalP}`);
    assert.ok(Math.abs(finalQ - 30.0) < 1.0, `Expected Q ~30 Mvar, got ${finalQ}`);
    assert.ok(res.pMetrics.rSquared > 0.95);
  });

  it("responds dynamically to voltage sag and frequency drop disturbances", () => {
    const psseCase = parseRaw(TEST_RAW);
    const dyrCase = parseDyr(TEST_DYR);
    const gen = psseCase.generators[0]!;
    const config = buildSmibConfig(
      gen,
      dyrCase.generatorsByBusId.get("1_1"),
      dyrCase.excitersByBusId.get("1_1"),
      dyrCase.governorsByBusId.get("1_1"),
    );

    const harness = new PmuSmibHarness(config);
    const dt = 0.01;
    const steps = 200;
    const time = new Float64Array(steps);
    const vt = new Float64Array(steps);
    const freq = new Float64Array(steps);
    const pMeas = new Float64Array(steps);
    const qMeas = new Float64Array(steps);

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      time[i] = t;
      // Voltage sag of -0.05 pu between t=0.5s and t=1.0s
      vt[i] = t >= 0.5 && t <= 1.0 ? 0.99 : 1.04;
      // Frequency drop of -0.2 Hz starting at t=1.2s
      freq[i] = t >= 1.2 ? 59.8 : 60.0;
      pMeas[i] = 100.0;
      qMeas[i] = 30.0;
    }

    const telemetry: PmuPlaybackTelemetry = {
      timeSec: time,
      vTerminalPu: vt,
      frequencyHz: freq,
      pActiveMw: pMeas,
      qReactiveMvar: qMeas,
    };

    const res = harness.simulate(telemetry);

    // During voltage sag (t=0.6s), exciter should increase field voltage Efd and inject reactive power Q
    const idxSag = 60; // t = 0.60s
    assert.ok(res.efdSimPu[idxSag]! > res.efdSimPu[10]!, "Exciter should boost Efd during voltage sag");
    assert.ok(res.qSimMvar[idxSag]! > 30.0, "Reactive power should increase during voltage sag");

    // During frequency drop (t=1.5s), governor droop should boost mechanical/active power P
    const idxFreq = 150; // t = 1.50s
    assert.ok(res.pSimMw[idxFreq]! > 100.0, "Governor should increase active power during frequency drop");
  });

  it("calibrates perturbed dynamic parameters to match telemetry", () => {
    const psseCase = parseRaw(TEST_RAW);
    const dyrCase = parseDyr(TEST_DYR);
    const gen = psseCase.generators[0]!;

    // 1. Generate synthetic ground-truth telemetry with true parameters: Ka=150.0, droopR=0.035
    const trueConfig = buildSmibConfig(
      gen,
      dyrCase.generatorsByBusId.get("1_1"),
      dyrCase.excitersByBusId.get("1_1"),
      dyrCase.governorsByBusId.get("1_1"),
    );
    trueConfig.Ka = 150.0;
    trueConfig.droopR = 0.035;

    const trueHarness = new PmuSmibHarness(trueConfig);
    const dt = 0.01;
    const steps = 150;
    const time = new Float64Array(steps);
    const vt = new Float64Array(steps);
    const freq = new Float64Array(steps);
    const dummyP = new Float64Array(steps);
    const dummyQ = new Float64Array(steps);

    for (let i = 0; i < steps; i++) {
      const t = i * dt;
      time[i] = t;
      vt[i] = t >= 0.4 && t <= 0.8 ? 1.01 : 1.04;
      freq[i] = t >= 0.9 ? 59.85 : 60.0;
      dummyP[i] = 100.0;
      dummyQ[i] = 30.0;
    }

    const groundTruthSim = trueHarness.simulate({
      timeSec: time,
      vTerminalPu: vt,
      frequencyHz: freq,
      pActiveMw: dummyP,
      qReactiveMvar: dummyQ,
    });

    // Telemetry from ground truth run
    const telemetry: PmuPlaybackTelemetry = {
      timeSec: time,
      vTerminalPu: vt,
      frequencyHz: freq,
      pActiveMw: groundTruthSim.pSimMw,
      qReactiveMvar: groundTruthSim.qSimMvar,
    };

    // 2. Intentionally start with detuned/inaccurate parameters in the case
    // Initial guess has Ka=50.0 and droopR=0.06
    const report = calibrateDyrParameters(gen, dyrCase, telemetry, {
      maxIterations: 40,
      parametersToTune: [
        {
          name: "Ka",
          targetModel: "exciter",
          initialValue: 60.0,
          minValue: 20.0,
          maxValue: 300.0,
          unit: "p.u.",
          description: "AVR Gain Ka",
        },
        {
          name: "droopR",
          targetModel: "governor",
          initialValue: 0.06,
          minValue: 0.02,
          maxValue: 0.08,
          unit: "p.u.",
          description: "Speed Droop R",
        },
      ],
    });

    // Verify significant error reduction
    assert.ok(report.improvementPercent > 20.0, `Expected >20% improvement, got ${report.improvementPercent}%`);
    assert.ok(report.calibratedSimulation.pMetrics.rSquared > 0.90, "Active power R² should exceed 0.90");

    // 3. Verify updating .dyr case and serialization
    const updatedDyr = applyCalibrationToDyrCase(dyrCase, report);
    const serializedText = serializeDyrCase(updatedDyr, { includeComments: true });

    assert.ok(serializedText.includes("EXST1"));
    assert.ok(serializedText.includes("TGOV1"));

    // Re-parse and verify updated values
    const reParsed = parseDyr(serializedText);
    const updatedExc = reParsed.excitersByBusId.get("1_1");
    assert.ok(updatedExc);
    assert.ok(updatedExc.namedParams["KA"]! > 80.0, "Calibrated Ka should be significantly adjusted toward 150");

    // 4. Verify NERC MOD-026 verification report markdown output
    const mdReport = generateNercMod026VerificationReport(report);
    assert.ok(mdReport.includes("NERC MOD-026-1 / MOD-027-1 Dynamic Model Verification Report"));
    assert.ok(mdReport.includes("Goodness-of-Fit Comparison"));
    assert.ok(mdReport.includes("Dynamic Model Parameter Transition Table"));
  });
});
