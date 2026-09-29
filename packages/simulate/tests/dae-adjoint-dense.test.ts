// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { solveDaeAdjoint } from "../src/core/dae-adjoint-solver.js";
import { DenseHermiteCheckpointTape } from "../src/core/dense-checkpoint-tape.js";
import { simulateArena } from "../src/core/simulate-arena.js";

async function runTests() {
  console.log("=== Testing DAE Continuous Adjoint Sensitivity & Dense Hermite Checkpoints ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Dense Hermite Checkpoint Tape Continuous Interpolation Accuracy
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: Dense Hermite Checkpoint Tape continuous interpolation accuracy...");
  const tape = new DenseHermiteCheckpointTape(["x"], ["y"]);

  // Feed checkpoints of a known function: x(t) = t^3 - 2*t^2 + t, dx/dt = 3*t^2 - 4*t + 1
  const f = (t: number) => t * t * t - 2 * t * t + t;
  const df = (t: number) => 3 * t * t - 4 * t + 1;
  const alg = (t: number) => 2 * t + 1;

  const tPoints = [0.0, 0.25, 0.5, 0.8, 1.0]; // variable step sizes
  for (let i = 0; i < tPoints.length - 1; i++) {
    const t0 = tPoints[i]!;
    const t1 = tPoints[i + 1]!;
    tape.pushSegment(
      t0,
      t1,
      new Float64Array([f(t0)]),
      new Float64Array([f(t1)]),
      new Float64Array([df(t0)]),
      new Float64Array([df(t1)]),
      new Float64Array([alg(t0)]),
      new Float64Array([alg(t1)]),
    );
  }

  assert.strictEqual(tape.length, 4);
  const stats = tape.getStats();
  assert.strictEqual(stats.segmentCount, 4);
  assert.ok(stats.memoryBytes > 0);

  // Cubic polynomial must be exact (machine precision) for cubic Hermite splines!
  const queryTimes = [0.1, 0.2, 0.33, 0.6, 0.75, 0.95];
  for (const t of queryTimes) {
    const interpolatedX = tape.evaluateState(t)[0]!;
    const expectedX = f(t);
    const diff = Math.abs(interpolatedX - expectedX);
    assert.ok(diff < 1e-12, `Hermite interpolation error at t=${t} is too high: ${diff}`);

    const interpolatedDx = tape.evaluateDerivative(t)[0]!;
    const expectedDx = df(t);
    const diffDx = Math.abs(interpolatedDx - expectedDx);
    assert.ok(diffDx < 1e-11, `Hermite derivative error at t=${t} is too high: ${diffDx}`);

    const interpolatedY = tape.evaluateAlgebraic(t)[0]!;
    const expectedY = alg(t);
    const diffY = Math.abs(interpolatedY - expectedY);
    assert.ok(diffY < 1e-12, `Algebraic linear interpolation error at t=${t} is too high: ${diffY}`);
  }
  console.log("  ✔ Dense Hermite polynomial interpolation exact within 1e-11 error");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Semi-Explicit DAE Adjoint with Algebraic Variable Loss
  // System:
  //   der(x) = -k * x + y
  //   y = a * x
  //   => der(x) = (a - k) * x
  //
  // Analytical Solution:
  //   x(t) = x0 * exp((a - k) * t)
  //   y(t) = a * x(t) = a * x0 * exp((a - k) * t)
  //
  // Terminal Loss:
  //   Phi = y(T) = a * x0 * exp((a - k) * T)
  //
  // Analytical Gradients:
  //   dPhi / dk = -a * T * x0 * exp((a - k) * T)
  //   dPhi / da = x0 * exp((a - k) * T) + a * T * x0 * exp((a - k) * T)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: Semi-Explicit DAE adjoint with algebraic variable loss Phi = y(T)...");

  const arena = new DAEBuilder();
  const x0Val = 2.0;
  const aNominal = 0.5;
  const kNominal = 1.5;
  const T = 1.0;

  // Differential state x
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, x0Val);
  arena.setVarStartValue(xIdx, x0Val);

  // Algebraic variable y
  arena.addVariable("y", VarType.Real, Variability.Continuous, 0, 0.0);

  // Parameters a and k
  const aIdx = arena.addVariable("a", VarType.Real, Variability.Parameter, 0, aNominal);
  arena.setVarExpression(aIdx, arena.addRealLiteral(aNominal));

  const kIdx = arena.addVariable("k", VarType.Real, Variability.Parameter, 0, kNominal);
  arena.setVarExpression(kIdx, arena.addRealLiteral(kNominal));

  // Equation 1: der(x) = -k * x + y
  const xExpr = arena.addNameExpr("x");
  const derX = arena.addDerExpr(xExpr);
  const kExpr = arena.addNameExpr("k");
  const yExpr = arena.addNameExpr("y");
  const negKx = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  const derXRhs = arena.addBinaryExpr(BinOp.Add, negKx, yExpr);
  arena.addEquation(EqKind.Simple, derX, derXRhs);

  // Equation 2: y = a * x
  const aExpr = arena.addNameExpr("a");
  const axExpr = arena.addBinaryExpr(BinOp.Mul, aExpr, xExpr);
  arena.addEquation(EqKind.Simple, yExpr, axExpr);

  // Analytical gradient computation
  const expTerm = Math.exp((aNominal - kNominal) * T);
  const analytical_dPhi_dk = -aNominal * T * x0Val * expTerm;
  const analytical_dPhi_da = x0Val * expTerm + aNominal * T * x0Val * expTerm;

  // Run DAE adjoint solver with terminal loss on the ALGEBRAIC variable y: Phi(y(T)) = y(T)
  const daeResult = solveDaeAdjoint(arena, {
    startTime: 0.0,
    stopTime: T,
    step: 0.005,
    parametersToDifferentiate: ["k", "a"],
    terminalLoss: (_states, algebraic) => {
      const yT = algebraic.get("y") ?? 0;
      return {
        loss: yT,
        gradAlgebraic: new Map([["y", 1.0]]),
      };
    },
  });

  const adjoint_dPhi_dk = daeResult.gradients.get("k") ?? 0;
  const adjoint_dPhi_da = daeResult.gradients.get("a") ?? 0;

  console.log(`  Adjoint dPhi/dk:    ${adjoint_dPhi_dk.toFixed(6)}`);
  console.log(`  Analytical dPhi/dk: ${analytical_dPhi_dk.toFixed(6)}`);
  console.log(`  Adjoint dPhi/da:    ${adjoint_dPhi_da.toFixed(6)}`);
  console.log(`  Analytical dPhi/da: ${analytical_dPhi_da.toFixed(6)}`);

  // Finite difference verification
  const eps = 1e-4;
  const simPlusK = simulateArena(arena, {
    startTime: 0.0,
    stopTime: T,
    step: 0.005,
    parameterOverrides: new Map([
      ["k", kNominal + eps],
      ["a", aNominal],
    ]),
  });
  const simMinusK = simulateArena(arena, {
    startTime: 0.0,
    stopTime: T,
    step: 0.005,
    parameterOverrides: new Map([
      ["k", kNominal - eps],
      ["a", aNominal],
    ]),
  });
  const xPlusK = simPlusK.y[simPlusK.y.length - 1]?.[0] ?? 0;
  const xMinusK = simMinusK.y[simMinusK.y.length - 1]?.[0] ?? 0;
  const fd_dPhi_dk = (aNominal * xPlusK - aNominal * xMinusK) / (2 * eps);
  console.log(`  Finite Diff dPhi/dk: ${fd_dPhi_dk.toFixed(6)}`);

  const relErrorK = Math.abs((adjoint_dPhi_dk - analytical_dPhi_dk) / analytical_dPhi_dk);
  const relErrorA = Math.abs((adjoint_dPhi_da - analytical_dPhi_da) / analytical_dPhi_da);

  assert.ok(relErrorK < 0.01, `DAE Adjoint dPhi/dk error too large: ${(relErrorK * 100).toFixed(3)}%`);
  assert.ok(relErrorA < 0.01, `DAE Adjoint dPhi/da error too large: ${(relErrorA * 100).toFixed(3)}%`);

  console.log(`  ✔ DAE algebraic adjoint dPhi/dk verified within ${(relErrorK * 100).toFixed(3)}% error`);
  console.log(`  ✔ DAE algebraic adjoint dPhi/da verified within ${(relErrorA * 100).toFixed(3)}% error`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Continuous Stage Loss with Dense Tape Checkpoints
  // Loss: L = integral_0^T (x(t) - target)^2 dt
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 3: Continuous stage loss with Dense Hermite Checkpoint Tape...");
  const targetVal = 1.0;
  const stageResult = solveDaeAdjoint(arena, {
    startTime: 0.0,
    stopTime: T,
    step: 0.005,
    parametersToDifferentiate: ["k"],
    stageLoss: (_t, states) => {
      const xVal = states.get("x") ?? 0;
      const diff = xVal - targetVal;
      return {
        loss: 0.5 * diff * diff,
        gradState: new Map([["x", diff]]),
      };
    },
  });

  const stageGradK = stageResult.gradients.get("k") ?? 0;
  assert.ok(!isNaN(stageGradK) && stageGradK !== 0);
  console.log(`  Stage loss total L: ${stageResult.loss.toFixed(6)}`);
  console.log(`  Adjoint dL/dk:      ${stageGradK.toFixed(6)}`);
  console.log(`  Tape segments used: ${stageResult.tape.length}`);
  console.log("  ✔ Continuous stage loss adjoint integration completed successfully");

  console.log("\n=== All DAE Continuous Adjoint & Dense Checkpoint Tests Passed Cleanly ===");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
