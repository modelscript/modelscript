// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import {
  extractFundamentalPhasor,
  MultiPlantTsEmtCoSimOrchestrator,
  runMultiPlantTsEmtCoSimulation,
  runTsEmtCoSimulation,
  toPositiveSequencePhasor,
  type EmtPlantConfig,
} from "../src/cosim/ts-emt-orchestrator.js";

test("TS-EMT DFT and symmetrical component positive sequence extraction", () => {
  const f0 = 60.0;
  const dt = 50e-6;
  const omega = 2 * Math.PI * f0;
  const N = Math.round(1.0 / (f0 * dt)); // 1 cycle of samples

  const peak = 100.0;
  const phaseA = Math.PI / 6; // 30 deg

  const samplesA = new Float64Array(N);
  const samplesB = new Float64Array(N);
  const samplesC = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const t = i * dt;
    samplesA[i] = peak * Math.sin(omega * t + phaseA);
    samplesB[i] = peak * Math.sin(omega * t + phaseA - (2 * Math.PI) / 3);
    samplesC[i] = peak * Math.sin(omega * t + phaseA + (2 * Math.PI) / 3);
  }

  const fa = extractFundamentalPhasor(samplesA, dt, f0);
  const fb = extractFundamentalPhasor(samplesB, dt, f0);
  const fc = extractFundamentalPhasor(samplesC, dt, f0);

  // Peak to RMS fundamental phasor: DFT extracts peak magnitude
  assert.ok(Math.abs(fa.mag - peak) < 1.0, `Expected fa.mag ~ ${peak}, got ${fa.mag}`);

  const f1 = toPositiveSequencePhasor(fa, fb, fc);
  assert.ok(Math.abs(f1.mag - peak) < 1.5, `Expected f1.mag ~ ${peak}, got ${f1.mag}`);
});

test("MultiPlantTsEmtCoSimOrchestrator plant lifecycle", () => {
  const orch = new MultiPlantTsEmtCoSimOrchestrator({
    durationSec: 0.5,
    dtTsSec: 0.005,
    dtEmtSec: 50e-6,
    extrapolation: "quadratic",
  });

  const plant1: EmtPlantConfig = {
    id: "WindFarm_Bus7",
    runner: () => ({ status: "ok" }),
    boundaryPorts: [
      {
        psseBusNumber: 7,
        pscadBusId: "PCC_Wind",
        baseKvLL: 230.0,
        baseMva: 100.0,
      },
    ],
  };

  orch.addPlant(plant1);
  assert.strictEqual(orch.getPlants().length, 1);
  assert.strictEqual(orch.getPlant("WindFarm_Bus7")?.id, "WindFarm_Bus7");

  const plant2: EmtPlantConfig = {
    id: "SolarBess_Bus9",
    runner: () => ({ status: "ok" }),
    boundaryPorts: [
      {
        psseBusNumber: 9,
        pscadBusId: "PCC_Solar",
        baseKvLL: 115.0,
        baseMva: 50.0,
      },
    ],
  };

  orch.addPlant(plant2);
  assert.strictEqual(orch.getPlants().length, 2);

  const removed = orch.removePlant("WindFarm_Bus7");
  assert.strictEqual(removed, true);
  assert.strictEqual(orch.getPlants().length, 1);
  assert.strictEqual(orch.getPlant("WindFarm_Bus7"), undefined);
});

test("Concurrent Multi-Plant TS-EMT Co-Simulation with 3 simultaneous EMT plants", async () => {
  // Mock TS Transmission Grid Solver (e.g. IEEE 14-bus)
  const mockPsseRunner = (opts: {
    stopTime: number;
    timeStep: number;
    boundaryInjections: Array<{ busNumber: number; inject: (t: number) => { irPu: number; iiPu: number } }>;
    onStep?: (t: number, busVoltages: Map<number, { vmPu: number; vaRad: number }>) => void;
  }) => {
    const busMap = new Map<number, { vmPu: number; vaRad: number }>();
    // Pre-initialize voltages
    busMap.set(7, { vmPu: 1.02, vaRad: -0.05 });
    busMap.set(9, { vmPu: 0.99, vaRad: -0.08 });
    busMap.set(14, { vmPu: 1.01, vaRad: -0.12 });

    const nSteps = Math.round(opts.stopTime / opts.timeStep);
    for (let step = 0; step <= nSteps; step++) {
      const t = step * opts.timeStep;

      // Inquire boundary injections
      for (const binj of opts.boundaryInjections) {
        binj.inject(t);
      }

      // Dynamic response: slight voltage dip and recovery
      const dip = t >= 0.1 && t <= 0.2 ? 0.05 : 0.0;
      busMap.set(7, { vmPu: 1.02 - dip, vaRad: -0.05 - 0.02 * Math.sin(10 * t) });
      busMap.set(9, { vmPu: 0.99 - dip, vaRad: -0.08 - 0.02 * Math.sin(10 * t) });
      busMap.set(14, { vmPu: 1.01 - dip, vaRad: -0.12 - 0.02 * Math.sin(10 * t) });

      if (opts.onStep) {
        opts.onStep(t, busMap);
      }
    }

    return {
      t: [0, opts.stopTime],
      states: ["delta_gen1", "omega_gen1"],
      y: [
        [0, 0],
        [0, 0],
      ],
      summary: {
        convergedPowerFlow: true,
        stable: true,
        maxRotorAngleSpreadDeg: 18.5,
      },
    };
  };

  // Mock EMT Plant Runners with sub-step loop
  const createMockEmtRunner = (plantName: string, pccBus: string, targetCurrentAmp: number) => {
    return async (opts: {
      durationSec: number;
      timeStepSec: number;
      boundaryFeeds: Array<{
        busId: string;
        thevenin?: (t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined;
      }>;
      onStep?: (t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void;
    }) => {
      const nSteps = Math.round(opts.durationSec / opts.timeStepSec);
      const voltMap = new Map<string, { a: number; b: number; c: number }>();
      const f0 = 60.0;
      const omega = 2 * Math.PI * f0;

      for (let s = 0; s <= nSteps; s++) {
        const t = s * opts.timeStepSec;
        const feed = opts.boundaryFeeds.find((f) => f.busId === pccBus);
        const th = feed?.thevenin ? feed.thevenin(t) : { vPeak: 187000, phaseRad: 0, gSrc: 20 };
        const vPeak = th?.vPeak ?? 187000;
        const ph = th?.phaseRad ?? 0;

        // Terminal voltage slightly perturbed by injected current: v_term = v_th - I / g
        const va = vPeak * Math.sin(omega * t + ph) - targetCurrentAmp * 0.05 * Math.sin(omega * t + ph);
        const vb =
          vPeak * Math.sin(omega * t + ph - (2 * Math.PI) / 3) -
          targetCurrentAmp * 0.05 * Math.sin(omega * t + ph - (2 * Math.PI) / 3);
        const vc =
          vPeak * Math.sin(omega * t + ph + (2 * Math.PI) / 3) -
          targetCurrentAmp * 0.05 * Math.sin(omega * t + ph + (2 * Math.PI) / 3);

        voltMap.set(pccBus, { a: va, b: vb, c: vc });

        if (opts.onStep) {
          opts.onStep(t, s, voltMap);
        }
      }

      return {
        plantName,
        completedSubSteps: nSteps,
      };
    };
  };

  const orch = new MultiPlantTsEmtCoSimOrchestrator({
    durationSec: 0.1,
    dtTsSec: 0.005,
    dtEmtSec: 50e-6,
    extrapolation: "quadratic",
  });

  orch.addPlant({
    id: "WindFarm_Bus7",
    boundaryPorts: [{ psseBusNumber: 7, pscadBusId: "PCC_Wind", baseKvLL: 230.0, baseMva: 100.0 }],
    runner: createMockEmtRunner("WindFarm_Bus7", "PCC_Wind", 250.0),
  });

  orch.addPlant({
    id: "SolarBess_Bus9",
    boundaryPorts: [{ psseBusNumber: 9, pscadBusId: "PCC_Solar", baseKvLL: 230.0, baseMva: 50.0 }],
    runner: createMockEmtRunner("SolarBess_Bus9", "PCC_Solar", 125.0),
  });

  orch.addPlant({
    id: "Statcom_Bus14",
    boundaryPorts: [{ psseBusNumber: 14, pscadBusId: "PCC_Statcom", baseKvLL: 230.0, baseMva: 40.0 }],
    runner: createMockEmtRunner("Statcom_Bus14", "PCC_Statcom", 100.0),
  });

  const result = await orch.run(mockPsseRunner);

  assert.strictEqual(result.plantCount, 3);
  assert.strictEqual(result.totalMacroSteps, 20); // 0.1s / 0.005s = 20
  assert.strictEqual(result.totalEmtSubSteps, 2000); // 0.1s / 50us = 2000
  assert.strictEqual(result.ratioM, 100);

  // Check that records exist for all 3 plants
  const plantIds = new Set(result.macroRecords.map((r) => r.plantId));
  assert.ok(plantIds.has("WindFarm_Bus7"));
  assert.ok(plantIds.has("SolarBess_Bus9"));
  assert.ok(plantIds.has("Statcom_Bus14"));

  // Check plant trajectories
  assert.strictEqual(result.plantTrajectories.size, 3);
  assert.strictEqual(result.plantTrajectories.get("WindFarm_Bus7")?.completedSubSteps, 2000);
  assert.strictEqual(result.plantTrajectories.get("SolarBess_Bus9")?.completedSubSteps, 2000);
  assert.strictEqual(result.plantTrajectories.get("Statcom_Bus14")?.completedSubSteps, 2000);
});

test("Multi-feeder boundary current aggregation on the same PSS/E bus", async () => {
  let aggregatedInjectionsCalled = 0;
  let lastInjectedIr = 0;

  const mockPsseRunner = (opts: {
    stopTime: number;
    timeStep: number;
    boundaryInjections: Array<{ busNumber: number; inject: (t: number) => { irPu: number; iiPu: number } }>;
    onStep?: (t: number, busVoltages: Map<number, { vmPu: number; vaRad: number }>) => void;
  }) => {
    // Both plants are on Bus 3!
    assert.strictEqual(opts.boundaryInjections.length, 1);
    assert.strictEqual(opts.boundaryInjections[0]?.busNumber, 3);

    const busMap = new Map<number, { vmPu: number; vaRad: number }>();
    busMap.set(3, { vmPu: 1.0, vaRad: 0.0 });

    const nSteps = Math.round(opts.stopTime / opts.timeStep);
    for (let s = 0; s <= nSteps; s++) {
      const t = s * opts.timeStep;
      const inj = opts.boundaryInjections[0]!.inject(t);
      lastInjectedIr = inj.irPu;
      aggregatedInjectionsCalled++;
      if (opts.onStep) {
        opts.onStep(t, busMap);
      }
    }

    return {
      t: [0, opts.stopTime],
      states: [],
      y: [],
      summary: { convergedPowerFlow: true, stable: true, maxRotorAngleSpreadDeg: 0 },
    };
  };

  const createFeederRunner = (busId: string, iVal: number) => {
    return async (opts: {
      durationSec: number;
      timeStepSec: number;
      onStep?: (t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void;
    }) => {
      const nSteps = Math.round(opts.durationSec / opts.timeStepSec);
      const voltMap = new Map<string, { a: number; b: number; c: number }>();
      for (let s = 0; s <= nSteps; s++) {
        const t = s * opts.timeStepSec;
        // Constant voltage with Norton drop
        voltMap.set(busId, { a: 187000 - iVal * 0.05, b: 0, c: 0 });
        if (opts.onStep) {
          opts.onStep(t, s, voltMap);
        }
      }
      return { ok: true };
    };
  };

  const result = await runMultiPlantTsEmtCoSimulation(mockPsseRunner, {
    durationSec: 0.05,
    dtTsSec: 0.005,
    dtEmtSec: 50e-6,
    plants: [
      {
        id: "Feeder_1",
        boundaryPorts: [{ psseBusNumber: 3, pscadBusId: "Bus3_F1", baseKvLL: 230.0, baseMva: 100.0 }],
        runner: createFeederRunner("Bus3_F1", 50.0),
      },
      {
        id: "Feeder_2",
        boundaryPorts: [{ psseBusNumber: 3, pscadBusId: "Bus3_F2", baseKvLL: 230.0, baseMva: 100.0 }],
        runner: createFeederRunner("Bus3_F2", 75.0),
      },
    ],
  });

  assert.strictEqual(result.plantCount, 2);
  assert.ok(aggregatedInjectionsCalled > 0);
});

test("runTsEmtCoSimulation single-plant backward compatibility", async () => {
  const mockPsseRunner = (opts: any) => {
    const busMap = new Map<number, { vmPu: number; vaRad: number }>();
    busMap.set(1, { vmPu: 1.0, vaRad: 0.0 });
    opts.boundaryInjections[0].inject(0.01);
    if (opts.onStep) opts.onStep(0.01, busMap);
    return {
      t: [0, 0.02],
      states: [],
      y: [],
      summary: { convergedPowerFlow: true, stable: true, maxRotorAngleSpreadDeg: 0 },
    };
  };

  const mockPscadRunner = (opts: any) => {
    const voltMap = new Map<string, { a: number; b: number; c: number }>();
    voltMap.set("PCC", { a: 100, b: 0, c: 0 });
    if (opts.onStep) opts.onStep(0.0001, 1, voltMap);
    return {
      time: new Float64Array([0, 0.0001]),
      busPhaseVoltages: new Map(),
    };
  };

  const res = await runTsEmtCoSimulation(mockPsseRunner, mockPscadRunner, {
    durationSec: 0.02,
    dtTsSec: 0.005,
    dtEmtSec: 50e-6,
    boundaryPorts: [{ psseBusNumber: 1, pscadBusId: "PCC" }],
  });

  assert.strictEqual(res.totalMacroSteps, 4);
  assert.strictEqual(res.ratioM, 100);
  assert.ok(res.tsTrajectory.summary.convergedPowerFlow);
});
