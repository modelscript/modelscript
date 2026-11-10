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

// 2. Gradient Verification: Compare Continuous Adjoint vs Central Finite Differences
console.log("\nVerifying Adjoint vs Finite-Difference Sensitivity Gradients:");
const gradFD = runner.computeRobustnessGradientFD(nominalParams, 1e-4);
const gradAdj = runner.computeRobustnessGradientAdjoint(nominalParams, 1e-4, nominalEval);

console.log(
  `  FD Gradient:      m: ${gradFD.m?.toExponential(4)}, u: ${gradFD.u?.toExponential(4)}, c: ${gradFD.c?.toExponential(4)}`,
);
console.log(
  `  Adjoint Gradient: m: ${gradAdj.m?.toExponential(4)}, u: ${gradAdj.u?.toExponential(4)}, c: ${gradAdj.c?.toExponential(4)}`,
);

// Physical sign consistency
assert(gradAdj.u! < 0, "Increasing engine force u must decrease margin to speed limit (negative gradient)");
assert(gradAdj.m! > 0, "Increasing mass m must increase margin to speed limit (positive gradient)");
assert(gradAdj.c! > 0, "Increasing drag c must increase margin to speed limit (positive gradient)");

// Directional cosine alignment between FD and Adjoint
let dot = 0;
let normFD = 0;
let normAdj = 0;
for (const p of ["m", "u", "c"]) {
  const g1 = gradFD[p]!;
  const g2 = gradAdj[p]!;
  dot += g1 * g2;
  normFD += g1 * g1;
  normAdj += g2 * g2;
}
const cosSim = dot / (Math.sqrt(normFD) * Math.sqrt(normAdj));
console.log(`  Cosine similarity between FD and Adjoint: ${cosSim.toFixed(5)}`);
assert(cosSim > 0.95, `Adjoint gradient must align closely with finite-difference gradient (got cosSim=${cosSim})`);

// 3. Run active falsification search to discover violating parameters using Adjoint mode
console.log("\nStarting active adversarial search using Continuous Adjoint Mode...");
const falsificationAdj = runner.falsify({
  maxIterations: 20,
  learningRate: 0.15,
  gradientMode: "adjoint",
});

console.log(`  ✓ Adjoint falsification completed in ${falsificationAdj.evaluations} evaluations`);
console.log(`  ✓ Is Falsified: ${falsificationAdj.isFalsified}`);
assert.strictEqual(falsificationAdj.isFalsified, true, "Adjoint-guided search must find a counterexample");
assert(falsificationAdj.minRobustness < 0, "Falsifying parameters must produce negative robustness");
assert(falsificationAdj.counterexampleParams !== undefined, "Counterexample parameters must be returned");

console.log(`  ✓ Worst-case robustness degree: ${falsificationAdj.minRobustness.toFixed(4)}`);
console.log(`  ✓ Violation timestamp: t = ${falsificationAdj.violationTime?.toFixed(4)}s`);
console.log("  ✓ Counterexample parameters found:");
for (const [k, v] of Object.entries(falsificationAdj.counterexampleParams)) {
  console.log(`      ${k} = ${v.toFixed(2)}`);
}

// 4. Compare with FD mode evaluation efficiency
console.log("\nStarting active adversarial search using Finite-Difference Mode...");
const falsificationFD = runner.falsify({
  maxIterations: 20,
  learningRate: 0.15,
  gradientMode: "fd",
});
console.log(`  ✓ FD falsification completed in ${falsificationFD.evaluations} evaluations`);
assert(
  falsificationAdj.evaluations < falsificationFD.evaluations,
  "Adjoint mode must require significantly fewer evaluations than FD mode",
);

// Check that traction u increased and/or mass m decreased (physical consistency)
assert(falsificationAdj.counterexampleParams["u"]! > nominalParams.u, "Adversary should increase engine force u");

console.log("Adjoint-Guided Requirement Falsification Engine verified successfully!");
