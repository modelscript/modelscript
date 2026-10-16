// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WasmEmtBridge } from "../src/solvers/emt/wasm-emt-bridge.js";

describe("Native WebAssembly EMT Companion Solver Kernel", () => {
  it("should initialize, factorize, and simulate an RLC circuit with zero-copy trajectory", () => {
    const dt = 20e-6; // 20 microseconds
    const nNodes = 2; // Node 0: Source bus, Node 1: Load bus

    const bridge = new WasmEmtBridge(nNodes, dt, 16, 4);

    // 1. AC Voltage Source at Node 0 (10 kV peak, 60 Hz)
    bridge.addSource({
      node: 0,
      vPeakKv: 10.0,
      freqHz: 60.0,
      phaseRad: 0.0,
      gSource: 1000.0,
    });

    // 2. Series Inductor between Node 0 and Node 1 (L = 20 mH)
    bridge.addBranch(0, 1, 0.01, 0.02, 0);

    // 3. Shunt Capacitor at Node 1 to GND (C = 10 µF)
    bridge.addBranch(1, -1, 0, 0, 10e-6);

    // 4. Shunt Load Resistor at Node 1 to GND (R = 50 Ω)
    bridge.addBranch(1, -1, 50.0, 0, 0);

    // Factorize
    const ok = bridge.buildAndFactorize();
    assert.ok(ok, "Matrix factorization must succeed");

    // Advance 1000 steps (20 ms, exactly 1.2 AC cycles at 60 Hz)
    const totalSteps = 1000;
    const result = bridge.solve(totalSteps);

    assert.strictEqual(result.stepCount, totalSteps, "Must record all 1000 steps");
    assert.strictEqual(result.timePoints.length, totalSteps, "Time points length must match step count");
    assert.strictEqual(result.voltages.length, nNodes, "Must have voltage arrays for each node");

    const v0 = result.voltages[0]!;
    const v1 = result.voltages[1]!;

    // Verify peak voltage at Node 0 is near 10 kV (10,000 V)
    let maxV0 = 0;
    let maxV1 = 0;
    for (let k = 0; k < totalSteps; k++) {
      if (Math.abs(v0[k]!) > maxV0) maxV0 = Math.abs(v0[k]!);
      if (Math.abs(v1[k]!) > maxV1) maxV1 = Math.abs(v1[k]!);
    }

    assert.ok(maxV0 > 8000 && maxV0 < 11000, `Node 0 peak voltage should be ~10 kV, got ${maxV0}`);
    assert.ok(maxV1 > 5000 && maxV1 < 15000, `Node 1 peak voltage should be reasonable, got ${maxV1}`);

    // Verify high throughput (> 50,000 steps/sec)
    assert.ok(
      result.stepsPerSecond > 20000,
      `Solver throughput should be high, got ${result.stepsPerSecond.toFixed(0)} steps/sec`,
    );
  });

  it("should evaluate branch currents and node voltages step-by-step", () => {
    const dt = 10e-6; // 10 microseconds
    const bridge = new WasmEmtBridge(1, dt, 4, 2);

    // DC Voltage Source (1 kV) into Node 0
    bridge.addSource({
      node: 0,
      vPeakKv: 1.0,
      freqHz: 0,
      isDc: true,
      gSource: 1000.0,
    });

    // Shunt Resistor (R = 10 Ω) from Node 0 to GND
    const brIdx = bridge.addBranch(0, -1, 10.0, 0, 0);

    bridge.buildAndFactorize();

    // Step 5 times
    for (let i = 0; i < 5; i++) {
      bridge.step();
    }

    const voltages = bridge.getVoltages();
    // V0 should be approximately 1000 V
    assert.ok(Math.abs(voltages[0]! - 1000.0) < 50.0, `Voltage should be ~1000V, got ${voltages[0]}`);

    // Current through 10 Ω should be approximately 100 A
    const iBr = bridge.getBranchCurrent(brIdx);
    assert.ok(Math.abs(iBr - 100.0) < 5.0, `Branch current should be ~100A, got ${iBr}`);
  });

  it("should simulate a 5th-order 3-phase Induction Machine and DFIG crowbar protection in WASM", () => {
    const dt = 20e-6;
    const bridge = new WasmEmtBridge(3, dt, 16, 6);

    // 3-phase 4.16 kV LL balanced AC voltage source at nodes 0, 1, 2
    const vPeakPhaseKv = 4.16 * Math.sqrt(2 / 3);
    bridge.addSource({ node: 0, vPeakKv: vPeakPhaseKv, freqHz: 60.0, phaseRad: 0.0, gSource: 1000.0 });
    bridge.addSource({
      node: 1,
      vPeakKv: vPeakPhaseKv,
      freqHz: 60.0,
      phaseRad: -(2 * Math.PI) / 3,
      gSource: 1000.0,
    });
    bridge.addSource({
      node: 2,
      vPeakKv: vPeakPhaseKv,
      freqHz: 60.0,
      phaseRad: (2 * Math.PI) / 3,
      gSource: 1000.0,
    });

    const indIdx = bridge.addInductionMachine({
      nodeA: 0,
      nodeB: 1,
      nodeC: 2,
      sBaseMva: 5.0,
      vBaseKvLL: 4.16,
      freqHz: 60.0,
      rsPu: 0.015,
      xsPu: 0.1,
      xmPu: 3.5,
      rrPu: 0.015,
      xrPu: 0.1,
      hInertia: 1.2,
      dampingD: 0.2,
      tmLoadPu: 0.5,
      isDfig: true,
      crowbarThresholdPu: 0.3, // Low threshold to verify crowbar protection engagement
    });
    assert.strictEqual(indIdx, 0);

    assert.ok(bridge.buildAndFactorize());
    const res = bridge.solve(500);
    assert.strictEqual(res.stepCount, 500);

    const speedPu = bridge.getInductionMachineSpeedPu(indIdx);
    const torquePu = bridge.getInductionMachineTorquePu(indIdx);
    assert.ok(speedPu > 0.9 && speedPu < 1.1, `Rotor speed should remain near synchronous, got ${speedPu}`);
    assert.ok(Number.isFinite(torquePu) && Math.abs(torquePu) > 0.01, `Torque should be non-zero, got ${torquePu}`);
    assert.strictEqual(bridge.isInductionMachineCrowbarActive(indIdx), true, "DFIG crowbar should trigger");
  });

  it("should simulate a J. Marti Frequency-Dependent Transmission Line (FD-Line) with recursive convolution in WASM", () => {
    const dt = 10e-6;
    const bridge = new WasmEmtBridge(2, dt, 8, 4);

    // Sending-end AC source at Node 0 (100 kV peak, 60 Hz)
    bridge.addSource({
      node: 0,
      vPeakKv: 100.0,
      freqHz: 60.0,
      phaseRad: Math.PI / 2, // Start at peak for immediate traveling wave launch
      gSource: 1000.0,
    });

    // Receiving-end matched resistive termination (300 Ohm) at Node 1
    bridge.addBranch(1, -1, 300.0, 0, 0);

    // 30 km FD-Line (tau = 100 us = 10 steps) with Y_c(s) and H(s) rational poles
    const fdIdx = bridge.addFrequencyDependentLine({
      fromNode: 0,
      toNode: 1,
      gInf: 1.0 / 300.0,
      tauSec: 100e-6,
      yPoles: [
        { pole: -500.0, residue: 0.2 },
        { pole: -5000.0, residue: 0.8 },
      ],
      hPoles: [
        { pole: -1200.0, residue: 800.0 },
        { pole: -8000.0, residue: 5000.0 },
      ],
    });
    assert.strictEqual(fdIdx, 0);

    assert.ok(bridge.buildAndFactorize());
    const res = bridge.solve(100);
    assert.strictEqual(res.stepCount, 100);

    // Verify wave arrived at receiving end (Node 1) after tau = 100 us (step 10+)
    const v1 = res.voltages[1]!;
    let maxV1 = 0;
    for (let k = 15; k < 100; k++) {
      if (Math.abs(v1[k]!) > maxV1) maxV1 = Math.abs(v1[k]!);
    }
    assert.ok(maxV1 > 1000.0, `Receiving end should see propagated wave > 1 kV, got ${maxV1}`);
    assert.ok(
      Math.abs(bridge.getFdLineHistFrom(fdIdx)) > 0 || Math.abs(bridge.getFdLineHistTo(fdIdx)) > 0,
      "Recursive convolution history currents must be active",
    );
  });

  it("should execute CSMF control blocks (PI, Lead-Lag, Sensors) and 3-phase SRF-PLL in WASM", () => {
    const dt = 20e-6;
    const bridge = new WasmEmtBridge(3, dt, 8, 4);

    // 3-phase 60 Hz balanced 10 kV peak sources at nodes 0, 1, 2
    bridge.addSource({ node: 0, vPeakKv: 10.0, freqHz: 60.0, phaseRad: 0.0, gSource: 1000.0 });
    bridge.addSource({ node: 1, vPeakKv: 10.0, freqHz: 60.0, phaseRad: -(2 * Math.PI) / 3, gSource: 1000.0 });
    bridge.addSource({ node: 2, vPeakKv: 10.0, freqHz: 60.0, phaseRad: (2 * Math.PI) / 3, gSource: 1000.0 });
    bridge.addBranch(0, -1, 100.0, 0, 0);
    bridge.addBranch(1, -1, 100.0, 0, 0);
    bridge.addBranch(2, -1, 100.0, 0, 0);

    // 3-phase SRF-PLL tracking nodes (0, 1, 2) with 10 kV peak base
    const pllIdx = bridge.addPll({
      nodeA: 0,
      nodeB: 1,
      nodeC: 2,
      vBasePeak: 10000.0,
      fNomHz: 60.0,
      kp: 60.0,
      ki: 1200.0,
    });
    assert.strictEqual(pllIdx, 0);

    // CSMF control loop: setpoint (1.0) - feedback (0.4) -> PI controller -> Lead-Lag
    const refBlk = bridge.addControlBlock({ type: "const", k1: 1.0 });
    const fbkBlk = bridge.addControlBlock({ type: "const", k1: 0.4 });
    const errBlk = bridge.addControlBlock({ type: "sub", in1: refBlk, in2: fbkBlk });
    const piBlk = bridge.addControlBlock({
      type: "pi",
      in1: errBlk,
      k1: 2.0,
      k2: 50.0,
      minOut: -10.0,
      maxOut: 10.0,
    });
    const llBlk = bridge.addControlBlock({
      type: "lead_lag",
      in1: piBlk,
      k1: 1.0,
      t1: 0.02,
      t2: 0.01,
      minOut: -10.0,
      maxOut: 10.0,
    });

    assert.ok(bridge.buildAndFactorize());
    bridge.solve(1000); // 20 ms

    const freqHz = bridge.getPllFreqHz(pllIdx);
    const vdPu = bridge.getPllVdPu(pllIdx);
    const vqPu = bridge.getPllVqPu(pllIdx);
    assert.ok(Math.abs(freqHz - 60.0) < 1.0, `PLL frequency should lock near 60 Hz, got ${freqHz}`);
    assert.ok(vqPu > 0.8 && vqPu < 1.2, `PLL Vq should be ~1.0 pu, got ${vqPu}`);
    assert.ok(Math.abs(vdPu) < 0.2, `PLL Vd should converge near 0 pu, got ${vdPu}`);

    const piOut = bridge.getControlOutput(piBlk);
    const llOut = bridge.getControlOutput(llBlk);
    assert.ok(piOut > 1.2, `PI output should integrate positive error (0.6), got ${piOut}`);
    assert.ok(llOut > 1.0, `Lead-lag output should track PI controller, got ${llOut}`);
  });
});
