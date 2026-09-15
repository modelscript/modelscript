// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, UnaryOp, VarType, Variability, initBltWasm } from "@modelscript/runtime";
import assert from "node:assert";
import { simulateVmap } from "../src/core/index.js";

async function main() {
  console.log("=== Testing JAX-Grade First-Class vmap (Vectorized Batched Simulation) ===");
  await initBltWasm();

  // Model: Newton's Law of Cooling
  //   der(T) = -k * (T - Tamb)
  //   T(0) = 100.0, Tamb = 20.0
  const dae = new DAEBuilder();

  dae.addVariable("T", VarType.Real, Variability.Continuous, Causality.Local, 100.0);
  dae.addVariable("k", VarType.Real, Variability.Parameter, Causality.Local, 1.0);
  dae.addVariable("Tamb", VarType.Real, Variability.Parameter, Causality.Local, 20.0);

  const tExpr = dae.addNameExpr("T");
  const derT = dae.addDerExpr(tExpr);
  const diff = dae.addBinaryExpr(BinOp.Sub, tExpr, dae.addNameExpr("Tamb"));
  const kMulDiff = dae.addBinaryExpr(BinOp.Mul, dae.addNameExpr("k"), diff);
  const rhs = dae.addUnaryExpr(UnaryOp.Negate, kMulDiff);

  dae.addEquation(EqKind.Simple, derT, rhs);

  // 1. Prepare M = 50 Parallel Parameter Instances
  const batchSize = 50;
  const kValues: number[] = [];
  const parameters: Map<string, number>[] = [];

  for (let i = 0; i < batchSize; i++) {
    const kVal = 0.2 + (i * 3.8) / (batchSize - 1); // k in [0.2, 4.0]
    kValues.push(kVal);
    parameters.push(
      new Map([
        ["k", kVal],
        ["Tamb", 20.0],
      ]),
    );
  }

  // 2. Execute simulateVmap
  console.log(`Executing vmap across ${batchSize} parallel trajectories...`);
  const result = simulateVmap(dae, {
    parameters,
    startTime: 0.0,
    stopTime: 2.0,
    step: 0.01,
  });

  console.log(
    `  ✔ Batched execution finished in ${result.elapsedMs.toFixed(2)} ms (${(result.elapsedMs / batchSize).toFixed(3)} ms/trajectory)`,
  );
  console.log(`  Batch Size: ${result.batchSize}, Time Steps: ${result.numSteps}`);
  assert.strictEqual(result.batchSize, batchSize);
  assert.strictEqual(result.numSteps, 201);

  // 3. Verify Analytical Parity Across All 50 Instances
  // Analytical formula: T(t) = Tamb + (T0 - Tamb) * exp(-k * t)
  const T0 = 100.0;
  const Tamb = 20.0;

  let maxRelErr = 0;
  for (let b = 0; b < batchSize; b++) {
    const k = kValues[b]!;
    const traj = result.getTrajectory(b, "T");
    assert.strictEqual(traj.length, result.numSteps);

    // Check terminal temperature at t = 2.0
    const terminalT = traj[traj.length - 1]!;
    const expectedT = Tamb + (T0 - Tamb) * Math.exp(-k * 2.0);
    const err = Math.abs(terminalT - expectedT) / (T0 - Tamb);
    if (err > maxRelErr) maxRelErr = err;
  }

  console.log(`  Max Relative Error across all ${batchSize} trajectories: ${(maxRelErr * 100).toFixed(4)}%`);
  assert(maxRelErr < 0.001, `vmap accuracy error too high: ${maxRelErr}`);
  console.log("  ✔ All 50 batched trajectories verified within 0.1% of analytical ground truth!");

  console.log("\nFirst-Class vmap tests PASSED successfully!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
