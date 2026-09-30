// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { ArenaSimulator, simulateArena } from "../src/core/simulate-arena.js";
import { ModelicaCalibrator } from "../src/optimizer/core/calibrator.js";
import { lbfgsbSolve } from "../src/optimizer/solvers/lbfgsb.js";

async function runTests() {
  console.log("=== Testing Adjoint Calibration & L-BFGS-B Optimizer ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: L-BFGS-B on 2D Rosenbrock function with box constraints
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: L-BFGS-B convergence on bounded 2D Rosenbrock benchmark...");
  // f(x, y) = (1 - x)^2 + 100 * (y - x^2)^2
  // Global minimum at (1, 1), f(1, 1) = 0
  const evalRosenbrock = (v: Float64Array) => {
    const x = v[0]!;
    const y = v[1]!;
    const t1 = 1 - x;
    const t2 = y - x * x;
    const cost = t1 * t1 + 100 * t2 * t2;

    const grad = new Float64Array(2);
    grad[0] = -2 * t1 - 400 * x * t2;
    grad[1] = 200 * t2;
    return { cost, grad };
  };

  const x0 = new Float64Array([0.5, 0.5]);
  const lb = new Float64Array([-2.0, -2.0]);
  const ub = new Float64Array([2.0, 2.0]);

  const lbfgsRes = lbfgsbSolve(x0, evalRosenbrock, lb, ub, {
    maxIterations: 250,
    tolerance: 1e-5,
  });

  console.log(
    `  Initial Cost: ${evalRosenbrock(x0).cost.toFixed(4)} -> Final Cost: ${lbfgsRes.cost.toExponential(4)} in ${lbfgsRes.iterations} iters`,
  );
  console.log(`  Optimal point: x=${lbfgsRes.x[0]!.toFixed(6)}, y=${lbfgsRes.x[1]!.toFixed(6)}`);
  assert.ok(lbfgsRes.cost < 1e-6, "L-BFGS-B failed to converge to Rosenbrock minimum!");
  assert.ok(Math.abs(lbfgsRes.x[0]! - 1.0) < 1e-3);
  assert.ok(Math.abs(lbfgsRes.x[1]! - 1.0) < 1e-3);
  console.log("  ✔ L-BFGS-B verified successfully on Rosenbrock benchmark!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: ModelicaCalibrator with Exact DAE Adjoint Sensitivities
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: ModelicaCalibrator with adjoint gradients on Mass-Spring-Damper system...");
  // Physical system:
  // der(x) = v
  // der(v) = -(k/m)*x - (c/m)*v
  // Ground truth parameters:
  const true_k = 15.0;
  const true_c = 2.5;

  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(xIdx, 1.0);

  const vIdx = arena.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.setVarStartValue(vIdx, 0.0);

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, true_k);
  arena.setVarExpression(kIdx, arena.addRealLiteral(true_k));

  const cIdx = arena.addVariable("c", VarType.Real, Variability.Parameter, 0, true_c);
  arena.setVarExpression(cIdx, arena.addRealLiteral(true_c));

  // Equations:
  // der(x) = v
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const vExpr = arena.addNameExpr("v");
  arena.addEquation(EqKind.Simple, derX, vExpr);

  // der(v) = -k*x - c*v
  const derV = arena.addDerExpr(vExpr);
  const kExpr = arena.addNameExpr("k");
  const cExpr = arena.addNameExpr("c");
  const kx = arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr);
  const cv = arena.addBinaryExpr(BinOp.Mul, cExpr, vExpr);
  const sumTerms = arena.addBinaryExpr(BinOp.Add, kx, cv);
  const negSum = arena.addUnaryExpr(UnaryOp.Negate, sumTerms);
  arena.addEquation(EqKind.Simple, derV, negSum);

  // Generate synthetic ground truth measurements over [0, 1.5]
  const simGroundTruth = simulateArena(arena, {
    startTime: 0.0,
    stopTime: 1.5,
    step: 0.05,
    parameterOverrides: new Map([
      ["k", true_k],
      ["c", true_c],
    ]),
  });

  const xCol = simGroundTruth.states.indexOf("x");
  assert.ok(xCol !== -1);
  const measT = simGroundTruth.t;
  const measX = simGroundTruth.y.map((row) => row[xCol]!);

  // Perturb initial guesses significantly: k=8 (true=15), c=1.0 (true=2.5)
  const initialGuess = new Map<string, number>([
    ["k", 8.0],
    ["c", 1.0],
  ]);

  const sim = new ArenaSimulator(arena);
  sim.prepare();

  const calibrator = new ModelicaCalibrator(arena, sim, {
    parameters: ["k", "c"],
    parameterBounds: new Map([
      ["k", { min: 1.0, max: 30.0 }],
      ["c", { min: 0.1, max: 10.0 }],
    ]),
    initialGuess,
    measurements: new Map([["x", { t: measT, y: measX }]]),
    startTime: 0.0,
    stopTime: 1.5,
    method: "lbfgsb",
    gradient: "adjoint",
    tolerance: 1e-6,
    maxIterations: 40,
  });

  const calibResult = calibrator.calibrate();
  const estimatedK = calibResult.parameters.get("k") ?? 0;
  const estimatedC = calibResult.parameters.get("c") ?? 0;

  console.log(`  Calibration Result:`);
  console.log(`    True k:      ${true_k.toFixed(4)}, Estimated k:      ${estimatedK.toFixed(4)}`);
  console.log(`    True c:      ${true_c.toFixed(4)}, Estimated c:      ${estimatedC.toFixed(4)}`);
  console.log(`    Final cost:  ${calibResult.residual.toExponential(4)} in ${calibResult.iterations} iters`);

  assert.ok(Math.abs(estimatedK - true_k) < 0.05, `Estimated k (${estimatedK}) differs from true k (${true_k})`);
  assert.ok(Math.abs(estimatedC - true_c) < 0.05, `Estimated c (${estimatedC}) differs from true c (${true_c})`);
  assert.ok(calibResult.residual < 1e-4, `Residual ${calibResult.residual} too high!`);

  console.log("  ✔ Adjoint ModelicaCalibrator successfully recovered physical parameters (< 0.1% error)!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: ModelicaCalibrator with Hybrid CMA-ES + Levenberg-Marquardt
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 3: ModelicaCalibrator with Hybrid CMA-ES + LM on Mass-Spring-Damper system...");
  const hybridCalibrator = new ModelicaCalibrator(arena, sim, {
    parameters: ["k", "c"],
    parameterBounds: new Map([
      ["k", { min: 1.0, max: 30.0 }],
      ["c", { min: 0.1, max: 10.0 }],
    ]),
    initialGuess,
    measurements: new Map([["x", { t: measT, y: measX }]]),
    startTime: 0.0,
    stopTime: 1.5,
    method: "hybrid-cmaes-lm",
    tolerance: 1e-6,
    maxIterations: 40,
  });

  const hybridResult = hybridCalibrator.calibrate();
  const hybridK = hybridResult.parameters.get("k") ?? 0;
  const hybridC = hybridResult.parameters.get("c") ?? 0;

  console.log(`  Hybrid CMA-ES/LM Calibration Result:`);
  console.log(`    Estimated k: ${hybridK.toFixed(4)}, True k: ${true_k.toFixed(4)}`);
  console.log(`    Estimated c: ${hybridC.toFixed(4)}, True c: ${true_c.toFixed(4)}`);
  console.log(`    Final cost:  ${hybridResult.residual.toExponential(4)} in ${hybridResult.iterations} iters`);
  console.log(`    Message:     ${hybridResult.message}`);

  assert.ok(Math.abs(hybridK - true_k) < 0.1, `Hybrid estimated k (${hybridK}) differs from true k (${true_k})`);
  assert.ok(Math.abs(hybridC - true_c) < 0.1, `Hybrid estimated c (${hybridC}) differs from true c (${true_c})`);
  assert.ok(hybridResult.residual < 1e-4, `Residual ${hybridResult.residual} too high!`);
  console.log("  ✔ Hybrid CMA-ES/LM calibrator successfully recovered physical parameters!");

  console.log("\nAll Adjoint Calibration & L-BFGS-B tests PASSED successfully!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
