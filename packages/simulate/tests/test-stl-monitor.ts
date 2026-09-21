// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { OnlineSTLMonitor, STL } from "../src/core/stl_monitor.js";
import { solveODE } from "../src/solvers/tsit5.js";

console.log("=== Testing Online Signal Temporal Logic (STL) Robustness Monitor ===");

{
  // Test 1: Harmonic Oscillator: x(t) = sin(t), v(t) = cos(t)
  // dx/dt = v
  // dv/dt = -x
  // State: y[0] = x, y[1] = v
  const f = (t: number, y: number[]) => [y[1], -y[0]];
  const y0 = [0.0, 1.0]; // x(0)=0, v(0)=1
  const tSpan: [number, number] = [0.0, 10.0];

  // Formula 1: Globally (x <= 1.2) - MUST PASS (since sin(t) in [-1, 1])
  const formulaPass = STL.globally(STL.predicate(0, "<=", 1.2, "x <= 1.2"), [0.0, 10.0]);
  const monitorPass = new OnlineSTLMonitor(formulaPass, { requirementName: "Req_MaxDisplacement_Safe" });

  // Formula 2: Globally (x <= 0.8) - MUST FAIL when sin(t) reaches ~1.0
  const formulaFail = STL.globally(STL.predicate(0, "<=", 0.8, "x <= 0.8"), [0.0, 10.0]);
  const monitorFail = new OnlineSTLMonitor(formulaFail, { requirementName: "Req_MaxDisplacement_Strict" });

  // Run Tsit5 solver and step monitors on each accepted step
  const res = solveODE({ f, y0, tSpan });

  for (let i = 0; i < res.times.length; i++) {
    const t = res.times[i];
    const y = res.states[i];
    monitorPass.step(t, y);
    monitorFail.step(t, y);
  }

  const resultPass = monitorPass.finalize();
  assert.strictEqual(resultPass.isSatisfied, true, "Formula 'x <= 1.2' must be satisfied");
  assert(resultPass.minRobustness > 0.15, `Robustness must be positive (~0.2), got ${resultPass.minRobustness}`);
  assert.strictEqual(resultPass.violationTime, undefined);
  console.log(
    `  ✓ Passed requirement: ${resultPass.requirementName} (min robustness: ${resultPass.minRobustness.toFixed(4)})`,
  );

  const resultFail = monitorFail.finalize();
  assert.strictEqual(resultFail.isSatisfied, false, "Formula 'x <= 0.8' must fail");
  assert(resultFail.minRobustness < 0, `Robustness must be negative, got ${resultFail.minRobustness}`);
  assert(resultFail.violationTime !== undefined && resultFail.violationTime > 0, "Violation time must be recorded");
  console.log(
    `  ✓ Correctly failed requirement: ${resultFail.requirementName} at t = ${resultFail.violationTime?.toFixed(4)}s (robustness: ${resultFail.minRobustness.toFixed(4)}, peak: ${resultFail.peakValue?.toFixed(4)})`,
  );

  // Test 3: Eventually (v < -0.9) - MUST PASS because cos(pi) = -1
  const formulaEventually = STL.eventually(STL.predicate(1, "<", -0.9, "v < -0.9"), [0.0, 5.0]);
  const monitorEventually = new OnlineSTLMonitor(formulaEventually, { requirementName: "Req_EventualVelocity" });

  for (let i = 0; i < res.times.length; i++) {
    monitorEventually.step(res.times[i], res.states[i]);
  }
  const resultEventually = monitorEventually.finalize();
  assert.strictEqual(resultEventually.isSatisfied, true, "Eventually formula must pass");
  assert(resultEventually.minRobustness > 0, "Eventual satisfaction must yield positive robustness");
  console.log(
    `  ✓ Eventual requirement satisfied: ${resultEventually.requirementName} (robustness: ${resultEventually.minRobustness.toFixed(4)})`,
  );
}

console.log("All Online STL Robustness Monitor tests passed successfully!");
