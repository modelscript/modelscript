// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import {
  LemireMinMaxQueue,
  OnlineSTLMonitor,
  STL,
  evaluateFormulaSignal,
  sampleSignalPiecewise,
} from "../src/core/stl_monitor.js";

console.log("=== Testing SOTA Online STL Monitor Upgrades ===");

// 1. Test Lemire Monotonic Min/Max Queue
{
  console.log("Test 1: Lemire Monotonic Queue Sliding Window");
  const minQueue = new LemireMinMaxQueue(true); // Min queue
  const maxQueue = new LemireMinMaxQueue(false); // Max queue

  const samples = [
    { t: 0.0, v: 5.0 },
    { t: 1.0, v: 2.0 },
    { t: 2.0, v: 8.0 },
    { t: 3.0, v: 1.0 },
    { t: 4.0, v: 4.0 },
    { t: 5.0, v: 6.0 },
  ];

  for (const s of samples) {
    minQueue.push(s.t, s.v);
    maxQueue.push(s.t, s.v);
  }

  assert.strictEqual(minQueue.peek(), 1.0, "Global min should be 1.0");
  assert.strictEqual(maxQueue.peek(), 8.0, "Global max should be 8.0");

  // Drop samples before t = 3.5 (window [3.5, 5.0])
  minQueue.dropBefore(3.5);
  maxQueue.dropBefore(3.5);
  assert.strictEqual(minQueue.peek(), 4.0, "Min in [3.5, 5.0] should be 4.0");
  assert.strictEqual(maxQueue.peek(), 6.0, "Max in [3.5, 5.0] should be 6.0");
  console.log("  ✓ Lemire Monotonic Queue correctly maintained sliding min/max");
}

// 2. Test Continuous Piecewise Linear Signal Interpolation
{
  console.log("Test 2: Piecewise Linear Signal Interpolation");
  const signal = [
    { t: 0.0, v: 0.0 },
    { t: 2.0, v: 10.0 },
    { t: 4.0, v: 2.0 },
  ];

  assert.strictEqual(sampleSignalPiecewise(signal, 0.0), 0.0);
  assert.strictEqual(sampleSignalPiecewise(signal, 1.0), 5.0);
  assert.strictEqual(sampleSignalPiecewise(signal, 2.0), 10.0);
  assert.strictEqual(sampleSignalPiecewise(signal, 3.0), 6.0);
  assert.strictEqual(sampleSignalPiecewise(signal, 4.0), 2.0);
  console.log("  ✓ Exact boundary interpolation verified");
}

// 3. Test Nested Temporal Operators: Globally [0, 5] (Eventually [0, 1] (x > 0.5))
{
  console.log("Test 3: Nested Temporal Operators (Globally Eventually)");
  // Sequence of samples where x pulses above 0.5 every 0.8s (period < 1.0s)
  const samples: { t: number; y: number[] }[] = [];
  for (let t = 0; t <= 6.0; t += 0.2) {
    // Pulse: high at t = 0.6, 1.4, 2.2, 3.0, 3.8, 4.6, 5.4
    const x = Math.sin((2 * Math.PI * t) / 0.8);
    samples.push({ t, y: [x] });
  }

  // Formula: Globally_[0, 4] Eventually_[0, 1] (x >= 0.5)
  // Since period is 0.8s, within any [t, t+1.0] window, x >= 0.5 will always occur!
  const formulaNested = STL.globally(STL.eventually(STL.predicate(0, ">=", 0.5, "x >= 0.5"), [0.0, 1.0]), [0.0, 4.0]);

  const sig = evaluateFormulaSignal(formulaNested, samples);
  const monitor = new OnlineSTLMonitor(formulaNested, { requirementName: "Req_PeriodicPulse" });
  for (const s of samples) monitor.step(s.t, s.y);
  const result = monitor.finalize();

  assert.strictEqual(result.isSatisfied, true, "Nested globally-eventually formula should be satisfied");
  console.log(`  ✓ Nested formula satisfied: min robustness = ${result.minRobustness.toFixed(4)}`);
}

// 4. Test Bounded Until Operator: phi1 U_[1, 3] phi2
{
  console.log("Test 4: Bounded Until Operator");
  // y[0] is mode/stage (1.0 until t=2.0, then becomes 2.0)
  // y[1] is target response (becomes > 10.0 at t=2.0)
  // Formula: (y[0] == 1.0) Until_[1, 3] (y[1] >= 10.0)
  const samples: { t: number; y: number[] }[] = [];
  for (let t = 0; t <= 4.0; t += 0.25) {
    const y0 = t < 2.0 ? 1.0 : 2.0;
    const y1 = t < 2.0 ? 0.0 : 12.0;
    samples.push({ t, y: [y0, y1] });
  }

  const formulaUntil = STL.until(
    STL.predicate(0, ">=", 1.0, "y0 >= 1.0"),
    STL.predicate(1, ">=", 10.0, "y1 >= 10.0"),
    [1.0, 3.0],
  );

  const monitorUntil = new OnlineSTLMonitor(formulaUntil, { requirementName: "Req_ModeUntilTarget" });
  for (const s of samples) monitorUntil.step(s.t, s.y);
  const resultUntil = monitorUntil.finalize();

  assert.strictEqual(resultUntil.isSatisfied, true, "Until formula should be satisfied at t=2.0");
  assert(resultUntil.minRobustness >= 0, "Until robustness should be positive");
  console.log(`  ✓ Until operator verified with robustness = ${resultUntil.minRobustness.toFixed(4)}`);
}

console.log("All SOTA Online STL Monitor tests completed successfully!");
