// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import {
  dopri5,
  dopri5Async,
  WasmDopri5,
  type RhsFunction,
  type RhsFunctionAsync,
} from "../src/runtime/wasm_dopri5.js";

console.log("Testing WASM DOPRI5 Solver Runtime & Bridge...");

// Test 1: Harmonic Oscillator (dy0/dt = y1, dy1/dt = -y0)
{
  const f: RhsFunction = (_t, y) => [y[1]!, -y[0]!];
  const t0 = 0.0;
  const y0 = [1.0, 0.0]; // cos(t), -sin(t)
  const tEnd = 2 * Math.PI;
  const outputTimes = [0.0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, 2 * Math.PI];

  const result = dopri5(f, t0, y0, tEnd, outputTimes, { atol: 1e-8, rtol: 1e-8 });

  assert.ok(result.times.length >= outputTimes.length, "Should contain output times");
  assert.ok(result.acceptedSteps > 0, "Should have accepted steps");
  assert.strictEqual(result.rejectedSteps >= 0, true);

  // At t = 2*pi, y0 should be close to 1.0, y1 close to 0.0
  const finalState = result.states[result.states.length - 1]!;
  assert.ok(Math.abs(finalState[0]! - 1.0) < 1e-4, `Expected y0(2pi) ≈ 1.0, got ${finalState[0]}`);
  assert.ok(Math.abs(finalState[1]! - 0.0) < 1e-4, `Expected y1(2pi) ≈ 0.0, got ${finalState[1]}`);
  console.log("  ✔ Harmonic oscillator adaptive DOPRI5 integration passed");
}

// Test 2: Asynchronous DOPRI5 (dopri5Async)
{
  const fAsync: RhsFunctionAsync = async (_t, y) => {
    return [-y[0]!]; // dy/dt = -y => y(t) = exp(-t)
  };

  const t0 = 0.0;
  const y0 = [1.0];
  const tEnd = 1.0;
  const outputTimes = [0.0, 0.5, 1.0];

  const result = await dopri5Async(fAsync, t0, y0, tEnd, outputTimes, { atol: 1e-6, rtol: 1e-6 });

  assert.ok(result.times.length >= outputTimes.length);
  const finalY = result.states[result.states.length - 1]![0]!;
  assert.ok(Math.abs(finalY - Math.exp(-1.0)) < 1e-4, `Expected exp(-1), got ${finalY}`);
  console.log("  ✔ Asynchronous dopri5Async simulation passed");
}

// Test 3: Zero-crossing event detection and bisection
{
  // Falling body: y = position, v = velocity
  // dy/dt = v, dv/dt = -9.81
  // Event: y reaches 0 (ground)
  const f: RhsFunction = (_t, y) => [y[1]!, -9.81];
  const t0 = 0.0;
  const y0 = [10.0, 0.0]; // start at height 10
  const tEnd = 2.0; // hits ground at sqrt(20 / 9.81) ≈ 1.42784s
  const outputTimes = [0.0, 0.5, 1.0, 1.5, 2.0];

  let eventFired = false;
  let eventTime = 0;

  const eventFunctions = [(_t: number, y: number[]) => y[0]!];
  const eventCallback = (t: number, y: number[], eventIdx: number, _dir: 1 | -1) => {
    assert.strictEqual(eventIdx, 0);
    eventFired = true;
    eventTime = t;
    // Bounce: position = 0, invert velocity with restitution 0.8
    return [0.0, -0.8 * y[1]!];
  };

  const expectedHitTime = Math.sqrt(20.0 / 9.81);
  const result = dopri5(
    f,
    t0,
    y0,
    tEnd,
    outputTimes,
    { atol: 1e-7, rtol: 1e-7 },
    eventFunctions,
    eventCallback,
    [-1], // only falling (positive to negative)
  );

  assert.ok(eventFired, "Ground hit event should fire");
  assert.ok(Math.abs(eventTime - expectedHitTime) < 1e-4, `Expected hit at ${expectedHitTime}, got ${eventTime}`);
  console.log("  ✔ Zero-crossing event detection & directional bisection passed");
}

// Test 4: WasmDopri5 wrapper class
{
  const mockWasm = {
    exports: {
      stepDopri5: (_dae: number, _v: number, _k: number, _temp: number, _yNew: number, _dt: number) => 1,
      hermiteInterpolate: (
        _y0: number,
        _y1: number,
        _k1: number,
        _k7: number,
        _dt: number,
        _th: number,
        _n: number,
        _out: number,
      ) => {},
    },
  };

  const wasmDopri5 = new WasmDopri5(mockWasm);
  const accepted = wasmDopri5.step(1, 100, 200, 300, 400, 0.01, 1e-6, 1e-6);
  assert.strictEqual(accepted, true);
  console.log("  ✔ WasmDopri5 wrapper class passed");
}

console.log("=== All WASM DOPRI5 Solver Tests Passed Cleanly ===");
