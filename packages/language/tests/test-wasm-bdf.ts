// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import { bdf, WasmBdf, type BdfRhsFunction } from "../src/runtime/wasm_bdf.js";

console.log("Testing WASM BDF Solver Runtime & Bridge...");

// Test 1: Stiff Decay ODE: dy/dt = -100 * (y - sin(t))
{
  const f: BdfRhsFunction = (t, y) => {
    return [-100.0 * (y[0]! - Math.sin(t))];
  };

  const t0 = 0.0;
  const y0 = [1.0];
  const tEnd = 0.1;
  const outputTimes = [0.0, 0.02, 0.04, 0.06, 0.08, 0.1];
  const result = bdf(f, t0, y0, tEnd, outputTimes, { atol: 1e-6, rtol: 1e-6, maxOrder: 5 });

  assert.ok(result.times.length >= outputTimes.length, "Should contain output times");
  assert.ok(result.acceptedSteps > 0, "Should have accepted steps");
  assert.strictEqual(result.rejectedSteps >= 0, true);

  // Check that the solution decayed smoothly towards sin(t)
  const finalY = result.states[result.states.length - 1]![0]!;
  assert.ok(Math.abs(finalY - Math.sin(0.1)) < 0.05, `Expected decay towards sin(0.1), got ${finalY}`);
  console.log("  ✔ Stiff decay ODE integration with variable-order BDF passed");
}

// Test 2: Analytical Jacobian Support
{
  // 2D linear system:
  // dy0/dt = -1000 * y0 + y1
  // dy1/dt = -y1
  const f: BdfRhsFunction = (_t, y) => {
    return [-1000.0 * y[0]! + y[1]!, -y[1]!];
  };

  const jacobian = (_t: number, _y: number[]) => [
    [-1000.0, 1.0],
    [0.0, -1.0],
  ];

  const t0 = 0.0;
  const y0 = [1.0, 2.0];
  const tEnd = 0.01;
  const outputTimes = [0.0, 0.005, 0.01];

  const result = bdf(f, t0, y0, tEnd, outputTimes, {
    atol: 1e-8,
    rtol: 1e-8,
    jacobian,
  });

  assert.ok(result.times.length >= outputTimes.length);
  assert.ok(result.jEvals > 0, "Should have evaluated Jacobian");
  console.log("  ✔ Analytical Jacobian support in BDF passed");
}

// Test 3: Zero-crossing event detection & bisection
{
  // Bouncing particle / zero crossing: dy/dt = -1.0, event when y = 0
  const f: BdfRhsFunction = (_t, _y) => [-1.0];
  const t0 = 0.0;
  const y0 = [1.0]; // Reaches 0 at t = 1.0
  const tEnd = 2.0;
  const outputTimes = [0.0, 0.5, 1.0, 1.5, 2.0];

  let eventFired = false;
  let eventTime = 0;

  const eventFunctions = [(_t: number, y: number[]) => y[0]!];
  const eventCallback = (t: number, y: number[], eventIdx: number, _dir: 1 | -1) => {
    assert.strictEqual(eventIdx, 0);
    eventFired = true;
    eventTime = t;
    // Bounce: invert direction
    return [0.0];
  };

  const result = bdf(f, t0, y0, tEnd, outputTimes, { atol: 1e-6, rtol: 1e-6 }, eventFunctions, eventCallback);

  assert.ok(eventFired, "Zero crossing event should fire");
  assert.ok(Math.abs(eventTime - 1.0) < 1e-4, `Event time should be ~1.0, got ${eventTime}`);
  console.log("  ✔ Zero-crossing event detection & bisection passed");
}

// Test 4: WasmBdf wrapper class
{
  const mockWasm = {
    exports: {
      dae_createBdfSolver: (_daePtr: number, nStates: number) => 42 + nStates,
      dae_setBdfStateMapping: (_solverPtr: number, _idx: number, _s: number, _d: number) => {},
      dae_stepBdfSolver: (_solverPtr: number, _varValsPtr: number, t: number, dt: number) => t + dt,
    },
  };

  const wasmBdf = new WasmBdf(mockWasm);
  const solverPtr = wasmBdf.createSolver(10, 4, 1e-6, 1e-6, 5);
  assert.strictEqual(solverPtr, 46);

  wasmBdf.setStateMapping(solverPtr, 0, 1, 2);
  const nextT = wasmBdf.step(solverPtr, 1024, 0.0, 0.01);
  assert.strictEqual(nextT, 0.01);
  console.log("  ✔ WasmBdf wrapper class passed");
}

console.log("=== All WASM BDF Solver Tests Passed Cleanly ===");
