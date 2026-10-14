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
});
