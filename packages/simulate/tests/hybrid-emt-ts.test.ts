// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { HybridEmtTsCoordinator, WasmEmtBridge } from "../src/solvers/emt/index.js";

console.log("=== Testing Phase 1: Automated EMT-TS Dynamic Hybrid Coordinator ===");

// Test 1: WASM Sliding-Window Fundamental DFT & Fortescue Sequence Extraction
{
  console.log("Test 1: WASM Sliding-Window DFT + Fortescue Positive/Negative/Zero Sequence Extraction");
  const dt = 50e-6; // 50 us -> 400 samples per 20 ms (50 Hz) cycle
  const f0 = 50.0;

  const bridge = new WasmEmtBridge(3, dt, 16, 8);

  // Load resistors of 10 Ohm at nodes 0, 1, 2
  const rLoad = 10.0;
  bridge.addBranch(0, -1, rLoad, 0, 0);
  bridge.addBranch(1, -1, rLoad, 0, 0);
  bridge.addBranch(2, -1, rLoad, 0, 0);

  // Register hybrid boundary with gThev = 0.1 S (10 Ohm Thevenin resistance)
  // Parallel combination at each node: G_total = 0.1 + 0.1 = 0.2 S (5 Ohm)
  const gThev = 0.1;
  const bndId = bridge.registerHybridBoundary(0, 1, 2, gThev, f0);
  assert.strictEqual(bndId, 0);
  assert.strictEqual(bridge.buildAndFactorize(), true);

  // Inject balanced positive-sequence Norton current of 200 A peak:
  // Expected terminal peak voltage: V_peak = I_norton / (gLoad + gThev) = 200 / 0.2 = 1000 V
  const iPeak = 200.0;
  bridge.updateBoundaryNorton(bndId, iPeak, 0.0, iPeak, (-2.0 * Math.PI) / 3.0, iPeak, (2.0 * Math.PI) / 3.0, 0);

  // Step for 2 full 50 Hz cycles (800 steps)
  bridge.runSteps(800);

  const seq = bridge.getBoundarySequencePhasors(bndId);
  const v1Mag = seq.v1PeakVolts;
  const v2Mag = seq.v2PeakVolts;
  const v0Mag = seq.v0PeakVolts;
  const i1Mag = seq.i1PeakAmp;

  console.log(
    `   Balanced 3-ph DFT: |V1|=${v1Mag.toFixed(2)} V, |V2|=${v2Mag.toFixed(4)} V, |V0|=${v0Mag.toFixed(4)} V, |I1|=${i1Mag.toFixed(2)} A`,
  );

  assert.ok(Math.abs(v1Mag - 1000.0) < 5.0, `Expected |V1| ~ 1000 V, got ${v1Mag}`);
  assert.ok(v2Mag < 1.0, `Expected near-zero negative sequence |V2|, got ${v2Mag}`);
  assert.ok(v0Mag < 1.0, `Expected near-zero zero sequence |V0|, got ${v0Mag}`);
  // Current into EMT network = I_norton - gThev * V = 200 - 0.1 * 1000 = 100 A
  assert.ok(Math.abs(i1Mag - 100.0) < 2.0, `Expected |I1| ~ 100 A, got ${i1Mag}`);
}

// Test 2: Full Hybrid EMT-TS Co-Simulation with Fault-Triggered Norton Mode Switching
{
  console.log("Test 2: HybridEmtTsCoordinator Steady-State Convergence & Asymmetrical Fault Mode Switch");
  const dtEmtSec = 50e-6;
  const dtTsSec = 5e-3; // 5 ms TS macro-step (100x EMT micro-step)

  const emtBridge = new WasmEmtBridge(3, dtEmtSec, 16, 8);

  // Detailed EMT load: 3-phase star R-L load on nodes 0 (A), 1 (B), 2 (C)
  emtBridge.addBranch(0, -1, 15.0, 0.02, 0);
  emtBridge.addBranch(1, -1, 15.0, 0.02, 0);
  emtBridge.addBranch(2, -1, 15.0, 0.02, 0);
  // Apply an asymmetrical single-line-to-ground (SLG) fault on Phase A starting at t = 0.04 s
  emtBridge.addFault(0, -1, 0.04, 0.1, 0.05);

  const coordinator = new HybridEmtTsCoordinator(
    {
      buses: [
        { busNumber: 1, name: "SlackGenBus", baseKv: 10.0, vMagPu: 1.02, vAngleDeg: 0.0 },
        {
          busNumber: 2,
          name: "IntermediateBus",
          baseKv: 10.0,
          vMagPu: 1.0,
          vAngleDeg: -1.0,
          pLoadMw: 20.0,
          qLoadMvar: 5.0,
        },
        { busNumber: 3, name: "EmtBoundaryPCC", baseKv: 10.0, vMagPu: 1.0, vAngleDeg: -2.0 },
      ],
      branches: [
        { fromBus: 1, toBus: 2, rPu: 0.005, xPu: 0.05, bTotalPu: 0.01 },
        { fromBus: 2, toBus: 3, rPu: 0.008, xPu: 0.08, bTotalPu: 0.01 },
      ],
      generators: [
        {
          id: "GEN_1",
          busNumber: 1,
          sBaseMva: 100.0,
          pGenMw: 50.0,
          qGenMvar: 10.0,
          hInertiaSec: 5.0,
          dampingPu: 2.0,
          xdPrimePu: 0.15,
        },
      ],
      boundaries: [
        {
          id: "PCC_3",
          tsBusNumber: 3,
          emtNodeA: 0,
          emtNodeB: 1,
          emtNodeC: 2,
          baseKvLL: 10.0,
        },
      ],
    },
    emtBridge,
    {
      dtEmtSec,
      dtTsSec,
      durationSec: 0.06, // 60 ms total (12 macro-steps: 0..40ms steady state, 40..60ms SLG fault)
      nominalFrequencyHz: 50.0,
      sBaseMva: 100.0,
      faultVoltageThresholdPu: 0.08,
    },
  );

  const res = coordinator.run();
  assert.strictEqual(res.totalMacroSteps, 12);
  assert.strictEqual(res.totalEmtSubSteps, 1200);

  const preFaultRec = res.macroHistory[7]!; // t = 40 ms (just before fault)
  const faultRec = res.macroHistory[11]!; // t = 60 ms (during SLG fault)

  console.log(
    `   Pre-Fault PCC (t=40ms): |V1_EMT|=${preFaultRec.v1EmtPu.toFixed(4)} pu, |V2_EMT|=${preFaultRec.v2EmtPu.toFixed(4)} pu`,
  );
  console.log(
    `   SLG Fault PCC (t=60ms): |V1_EMT|=${faultRec.v1EmtPu.toFixed(4)} pu, |V2_EMT|=${faultRec.v2EmtPu.toFixed(4)} pu, |V0_EMT|=${faultRec.v0EmtPu.toFixed(4)} pu, faultMode=${faultRec.faultModeActive}`,
  );

  assert.ok(
    preFaultRec.v1EmtPu > 0.4 && preFaultRec.v1EmtPu < 1.5,
    "Pre-fault positive sequence voltage within physical bounds",
  );
  assert.ok(preFaultRec.v2EmtPu < 0.01, "Pre-fault negative sequence voltage near zero");
  assert.ok(
    faultRec.v2EmtPu > 0.05,
    `Expected significant negative sequence voltage |V2| during SLG fault, got ${faultRec.v2EmtPu}`,
  );
  assert.ok(
    faultRec.v0EmtPu > 0.05,
    `Expected significant zero sequence voltage |V0| during SLG fault, got ${faultRec.v0EmtPu}`,
  );
  assert.ok(
    res.faultModeStepCount > 0 || faultRec.v1EmtPu < preFaultRec.v1EmtPu,
    "Positive-sequence voltage sags during SLG fault",
  );
}

console.log("=== All Phase 1 Hybrid EMT-TS Tests Passed! ===");
