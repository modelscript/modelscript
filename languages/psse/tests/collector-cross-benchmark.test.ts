// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  benchmarkIbrModels,
  buildCollectorEquivalent,
  evaluateIbrBenchmarkTest,
  solvePowerFlow,
  type CollectorEquivalencingInput,
  type IbrBenchmarkTrajectoryPair,
} from "../src/index.js";

describe("Renewable Collector Equivalencer & FERC 901 EMT-to-RMS Benchmarking", () => {
  it("reduces branched 34.5 kV solar collector network into WECC single-machine equivalent", () => {
    // 100 MW Solar PV Plant: 50 inverters (2.0 MVA each) with 34.5 kV / 0.69 kV pad-mount transformers
    const units = [];
    for (let i = 1; i <= 50; i++) {
      units.push({
        unitId: `INV_${i}`,
        terminalBus: 3000 + i,
        mvaRating: 2.0,
        ratedKv: 0.69,
        pNominalMw: 2.0,
        qMaxMvar: 0.87,
        qMinMvar: -0.87,
        padMountTransformer: {
          rPu: 0.01,
          xPu: 0.06,
          mvaBase: 2.0,
          primaryKv: 34.5,
          secondaryKv: 0.69,
        },
      });
    }

    // 4 collector cable trunk segments
    const segments = [
      {
        id: "FEEDER_1",
        fromBus: 100,
        toBus: 101,
        rOhm: 0.15,
        xOhm: 0.25,
        bMicroSiemens: 18.0,
        downstreamMva: 30.0,
      },
      {
        id: "FEEDER_2",
        fromBus: 101,
        toBus: 102,
        rOhm: 0.20,
        xOhm: 0.35,
        bMicroSiemens: 24.0,
        downstreamMva: 20.0,
      },
      {
        id: "FEEDER_3",
        fromBus: 100,
        toBus: 103,
        rOhm: 0.12,
        xOhm: 0.20,
        bMicroSiemens: 15.0,
        downstreamMva: 30.0,
      },
      {
        id: "FEEDER_4",
        fromBus: 103,
        toBus: 104,
        rOhm: 0.18,
        xOhm: 0.30,
        bMicroSiemens: 22.0,
        downstreamMva: 20.0,
      },
    ];

    const input: CollectorEquivalencingInput = {
      plantName: "SOLAR_DESERT_100MW",
      nominalCollectorKv: 34.5,
      poiBusNumber: 10,
      collectorBusNumber: 100,
      generatorBusNumber: 200,
      sbaseMva: 100.0,
      gsuTransformer: {
        name: "GSU_1",
        mvaRating: 110.0,
        primaryKv: 230.0,
        secondaryKv: 34.5,
        rPu: 0.005,
        xPu: 0.09,
      },
      segments,
      units,
    };

    const res = buildCollectorEquivalent(input);

    assert.equal(res.plantName, "SOLAR_DESERT_100MW");
    assert.equal(res.totalCapacityMva, 100.0);
    assert.equal(res.totalActiveMw, 100.0);
    assert.equal(res.unitCount, 50);

    // Verify impedance calculation formulas:
    // Zeq = sum_k (S_flow,k / S_total)^2 * Z_k
    // S_total = 100 MVA
    // Seg 1: (30/100)^2 = 0.09 * 0.15 = 0.0135
    // Seg 2: (20/100)^2 = 0.04 * 0.20 = 0.0080
    // Seg 3: (30/100)^2 = 0.09 * 0.12 = 0.0108
    // Seg 4: (20/100)^2 = 0.04 * 0.18 = 0.0072
    // Total Req = 0.0135 + 0.0080 + 0.0108 + 0.0072 = 0.0395 Ohm
    assert.ok(Math.abs(res.reqOhm - 0.0395) < 1e-4, `Expected Req ~0.0395 Ohm, got ${res.reqOhm}`);

    // Total Beq = 18 + 24 + 15 + 22 = 79.0 uS
    assert.ok(Math.abs(res.beqMicroSiemens - 79.0) < 1e-4, `Expected Beq ~79.0 uS, got ${res.beqMicroSiemens}`);

    // Verify generated 4-bus PSS/E model
    const pCase = res.equivalentPsseCase;
    assert.equal(pCase.buses.size, 4);
    assert.equal(pCase.generators.length, 1);
    assert.equal(pCase.branches.length, 1);
    assert.equal(pCase.transformers.length, 2);

    // Verify AC power flow solves cleanly on equivalent model
    const pf = solvePowerFlow(pCase);
    assert.ok(pf.converged, "AC power flow should converge on equivalent collector case");
    assert.ok(pf.iterations <= 5, "Should converge within 5 iterations");

    // Calculation derivation report verification
    assert.ok(res.calculationReport.includes("WECC Renewable Collector System Equivalencing"));
    assert.ok(res.calculationReport.includes("Equivalent Resistance (Req)"));
    assert.ok(res.calculationReport.includes("SOLAR_DESERT_100MW"));
  });

  it("benchmarks EMT vs. RMS model trajectories across grid disturbance events", () => {
    const steps = 100;
    const time = new Float64Array(steps);
    for (let i = 0; i < steps; i++) time[i] = i * 0.02; // 2 seconds

    // Test 1: High-fidelity alignment test (small voltage step)
    const pRms1 = new Float64Array(steps);
    const pEmt1 = new Float64Array(steps);
    const qRms1 = new Float64Array(steps);
    const qEmt1 = new Float64Array(steps);
    const vRms1 = new Float64Array(steps);
    const vEmt1 = new Float64Array(steps);

    for (let i = 0; i < steps; i++) {
      const t = time[i]!;
      vRms1[i] = t >= 0.5 ? 1.03 : 1.0;
      vEmt1[i] = t >= 0.5 ? 1.03 + 0.005 * Math.sin(100 * t) * Math.exp(-10 * (t - 0.5)) : 1.0;

      pRms1[i] = 100.0;
      pEmt1[i] = 100.0 + 0.5 * Math.sin(60 * t) * Math.exp(-8 * t);

      qRms1[i] = t >= 0.5 ? -15.0 : 0.0;
      qEmt1[i] = t >= 0.5 ? -15.0 + 1.0 * Math.sin(50 * t) * Math.exp(-5 * (t - 0.5)) : 0.0;
    }

    const test1: IbrBenchmarkTrajectoryPair = {
      testKind: "voltage-step",
      testTitle: "3% Voltage Step Response",
      timeSec: time,
      pRmsMw: pRms1,
      qRmsMvar: qRms1,
      vRmsPu: vRms1,
      pEmtMw: pEmt1,
      qEmtMvar: qEmt1,
      vEmtPu: vEmt1,
    };

    const res1 = evaluateIbrBenchmarkTest(test1);
    assert.equal(res1.status, "PASS");
    assert.ok(res1.pMetrics.nrmse < 0.05);

    // Test 2: Severe LVRT sag (0.05 pu residual, 150 ms)
    const pRms2 = new Float64Array(steps);
    const pEmt2 = new Float64Array(steps);
    const qRms2 = new Float64Array(steps);
    const qEmt2 = new Float64Array(steps);
    const vRms2 = new Float64Array(steps);
    const vEmt2 = new Float64Array(steps);

    for (let i = 0; i < steps; i++) {
      const t = time[i]!;
      const isFault = t >= 0.4 && t <= 0.55;
      vRms2[i] = isFault ? 0.05 : 1.0;
      vEmt2[i] = isFault ? 0.05 + 0.02 * Math.sin(120 * t) : 1.0;

      pRms2[i] = isFault ? 10.0 : t > 0.55 && t < 0.9 ? 10.0 + 90.0 * ((t - 0.55) / 0.35) : 100.0;
      pEmt2[i] = isFault ? 10.0 : t > 0.55 && t < 0.9 ? 10.0 + 90.0 * ((t - 0.55) / 0.35) : 100.0;

      qRms2[i] = isFault ? 80.0 : 0.0;
      qEmt2[i] = isFault ? 80.0 + 2.0 * Math.sin(80 * t) : 0.0;
    }

    const test2: IbrBenchmarkTrajectoryPair = {
      testKind: "lvrt-sag",
      testTitle: "Severe Symmetrical LVRT Sag (0.05 pu, 150 ms)",
      timeSec: time,
      pRmsMw: pRms2,
      qRmsMvar: qRms2,
      vRmsPu: vRms2,
      pEmtMw: pEmt2,
      qEmtMvar: qEmt2,
      vEmtPu: vEmt2,
    };

    const res2 = evaluateIbrBenchmarkTest(test2);
    assert.equal(res2.status, "PASS");
    assert.ok(res2.settlingDiffMs < 50.0);

    // Full dossier generation
    const dossier = benchmarkIbrModels("SOLAR_DESERT_100MW", [test1, test2]);
    assert.equal(dossier.overallStatus, "COMPLIANT");
    assert.equal(dossier.summary.passedTests, 2);
    assert.ok(dossier.markdownReport.includes("FERC Order 901 / IEEE 2800"));
    assert.ok(dossier.markdownReport.includes("Disturbance Test Suite Verification Matrix"));
  });
});
