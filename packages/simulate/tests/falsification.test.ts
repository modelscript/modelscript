// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { FalsificationRunner, type FalsificationProblem } from "../src/core/falsification-runner.js";
import { STL } from "../src/core/stl_monitor.js";

console.log("=== Testing Adjoint-Guided Requirement Falsification Engine ===");

// Benchmark: Nonlinear Vehicle Acceleration Model
// dx/dt = v
// dv/dt = (u - c * v^2) / m
// State: y[0] = x (position), y[1] = v (velocity)
// Parameters: m (mass in kg), u (traction force in N), c (drag coefficient)
const vehicleDynamics = (_t: number, y: number[], p: Record<string, number>) => {
  const v = y[1] ?? 0;
  const m = p["m"] ?? 1000.0;
  const u = p["u"] ?? 2000.0;
  const c = p["c"] ?? 0.3;
  const a = (u - c * v * v) / m;
  return [v, a];
};

const problem: FalsificationProblem = {
  f: vehicleDynamics,
  y0: [0.0, 0.0], // Starts at rest
  tSpan: [0.0, 10.0],
  parameters: [
    { name: "m", min: 800.0, max: 2000.0, nominal: 1800.0 }, // Heavy car nominal
    { name: "u", min: 1000.0, max: 8000.0, nominal: 2000.0 }, // Mild power nominal
    { name: "c", min: 0.2, max: 0.8, nominal: 0.5 },
  ],
  // Safety Requirement: Velocity must NEVER exceed 45 m/s within 10 seconds
  requirement: STL.globally(STL.predicate(1, "<=", 45.0, "v <= 45.0"), [0.0, 10.0]),
  requirementName: "Req_MaxSpeedLimit",
};

const runner = new FalsificationRunner(problem);

// 1. Verify nominal parameters do NOT violate the requirement
const nominalParams = { m: 1800.0, u: 2000.0, c: 0.5 };
const nominalEval = runner.evaluateTrajectory(nominalParams);
console.log(`Nominal trajectory min robustness: ${nominalEval.robustness.toFixed(4)}`);
assert(nominalEval.robustness > 0, "Nominal vehicle configuration must satisfy requirement");

// 2. Run active falsification search to discover violating parameters
console.log("Starting active adversarial search for counterexamples...");
const falsification = runner.falsify({
  maxIterations: 20,
  learningRate: 0.15,
});

console.log(`  ✓ Falsification completed in ${falsification.evaluations} trajectory evaluations`);
console.log(`  ✓ Is Falsified: ${falsification.isFalsified}`);
assert.strictEqual(falsification.isFalsified, true, "Adjoint-guided search must find a counterexample");
assert(falsification.minRobustness < 0, "Falsifying parameters must produce negative robustness");
assert(falsification.counterexampleParams !== undefined, "Counterexample parameters must be returned");

console.log(`  ✓ Worst-case robustness degree: ${falsification.minRobustness.toFixed(4)}`);
console.log(`  ✓ Violation timestamp: t = ${falsification.violationTime?.toFixed(4)}s`);
console.log("  ✓ Counterexample parameters found:");
for (const [k, v] of Object.entries(falsification.counterexampleParams)) {
  console.log(`      ${k} = ${v.toFixed(2)}`);
}

// Check that traction u increased and/or mass m decreased (physical consistency)
assert(falsification.counterexampleParams["u"]! > nominalParams.u, "Adversary should increase engine force u");

console.log("Adjoint-Guided Requirement Falsification Engine verified successfully!");
