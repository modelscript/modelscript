// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ActivationKind,
  ArenaNeuralBlock,
  BinOp,
  DAEBuilder,
  EqKind,
  UnaryOp,
  VarType,
  Variability,
} from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { solveDaeAdjoint } from "../src/core/dae-adjoint-solver.js";
import { simulateArena } from "../src/core/simulate-arena.js";

async function runTests() {
  console.log("=== Testing Universal Differential Equations (UDEs) & In-Arena Neural Blocks ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Vectorized Forward GEMV and VJP Kernels
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: Vectorized Forward GEMV and VJP backward kernels...");
  const nnBlock = new ArenaNeuralBlock({
    name: "drag_net",
    layers: [2, 4, 1],
    activation: ActivationKind.Tanh,
    outputActivation: ActivationKind.Linear,
    seed: 42,
  });

  assert.strictEqual(nnBlock.layers.length, 3);
  // Layer 0: W is 4x2 = 8, b is 4 -> 12
  // Layer 1: W is 1x4 = 4, b is 1 -> 5
  // Total weights = 17
  assert.strictEqual(nnBlock.weightCount, 17);

  const testWeights = new Float64Array(nnBlock.weightCount);
  for (let i = 0; i < testWeights.length; i++) {
    testWeights[i] = Math.sin(i * 1.3) * 0.5;
  }

  const testInput = new Float64Array([0.7, -0.4]);
  const fwdResult = nnBlock.forwardVectorized(testInput, testWeights);
  assert.strictEqual(fwdResult.length, 1);
  assert.ok(!isNaN(fwdResult[0]!));

  // Compute VJP with gradOutput = [1.0]
  const gradOutput = new Float64Array([1.0]);
  const vjpResult = nnBlock.vjpVectorized(gradOutput, testInput, testWeights);
  assert.strictEqual(vjpResult.gradInputs.length, 2);
  assert.strictEqual(vjpResult.gradWeights.length, 17);

  // Verify VJP w.r.t weights using central finite differences
  const eps = 1e-6;
  for (let wIdx = 0; wIdx < testWeights.length; wIdx++) {
    const wPlus = new Float64Array(testWeights);
    wPlus[wIdx]! += eps;
    const outPlus = nnBlock.forwardVectorized(testInput, wPlus)[0]!;

    const wMinus = new Float64Array(testWeights);
    wMinus[wIdx]! -= eps;
    const outMinus = nnBlock.forwardVectorized(testInput, wMinus)[0]!;

    const fdGradW = (outPlus - outMinus) / (2 * eps);
    const analyticalGradW = vjpResult.gradWeights[wIdx]!;

    const err = Math.abs(fdGradW - analyticalGradW);
    assert.ok(
      err < 1e-5,
      `VJP weight gradient mismatch at idx ${wIdx}: FD=${fdGradW}, VJP=${analyticalGradW}, diff=${err}`,
    );
  }
  console.log("  Vectorized GEMV and VJP kernels matched finite differences (< 1e-5 error)!");

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: In-Arena Embedding of Neural Surrogate into DAEBuilder System
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: Embedding ArenaNeuralBlock into DAEBuilder & simulating...");
  const arena = new DAEBuilder();

  // Nonlinear oscillator:
  // der(x1) = x2
  // der(x2) = -x1 - nn_out
  // nn_out = NN(x2; W, b)
  const x1Idx = arena.addVariable("x1", VarType.Real, Variability.Continuous, 0, 1.0);
  arena.setVarStartValue(x1Idx, 1.0);

  const x2Idx = arena.addVariable("x2", VarType.Real, Variability.Continuous, 0, 0.0);
  arena.setVarStartValue(x2Idx, 0.0);

  // Output variable of neural network
  arena.addVariable("nn_out", VarType.Real, Variability.Continuous, 0, 0.0);

  // Neural surrogate: input is x2, output is nn_out
  const udeNet = new ArenaNeuralBlock({
    name: "friction",
    layers: [1, 3, 1],
    activation: ActivationKind.Tanh,
    outputActivation: ActivationKind.Linear,
    seed: 123,
  });

  udeNet.build(arena, ["x2"], ["nn_out"]);

  // der(x1) = x2
  const x1Expr = arena.addNameExpr("x1");
  const derX1 = arena.addDerExpr(x1Expr);
  const x2Expr = arena.addNameExpr("x2");
  arena.addEquation(EqKind.Simple, derX1, x2Expr);

  // der(x2) = -x1 - nn_out
  const derX2 = arena.addDerExpr(x2Expr);
  const negX1 = arena.addUnaryExpr(UnaryOp.Negate, x1Expr);
  const nnOutExpr = arena.addNameExpr("nn_out");
  const derX2Rhs = arena.addBinaryExpr(BinOp.Sub, negX1, nnOutExpr);
  arena.addEquation(EqKind.Simple, derX2, derX2Rhs);

  const simResult = simulateArena(arena, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.01,
  });

  function getStateValue(res: { states: string[]; y: number[][] }, varName: string): number {
    const col = res.states.indexOf(varName);
    if (col === -1) return 0;
    return res.y[res.y.length - 1]?.[col] ?? 0;
  }

  assert.ok(simResult.t.length > 50);
  const finalX1 = getStateValue(simResult, "x1");
  const finalX2 = getStateValue(simResult, "x2");
  const finalNn = getStateValue(simResult, "nn_out");
  console.log(
    `  Simulation successful: final x1=${finalX1.toFixed(4)}, x2=${finalX2.toFixed(4)}, nn_out=${finalNn.toFixed(4)}`,
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Adjoint Sensitivity w.r.t Neural Weights
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 3: Adjoint Sensitivity w.r.t Neural Weights vs Finite Differences...");
  const paramNames = udeNet.getParameterNames();
  assert.ok(paramNames.length > 0);

  // Loss function: 0.5 * (x1(T)^2 + x2(T)^2)
  const T = 0.5;
  const adjointRes = solveDaeAdjoint(arena, {
    startTime: 0.0,
    stopTime: T,
    step: 0.005,
    parametersToDifferentiate: paramNames,
    terminalLoss: (states, _alg) => {
      const x1 = states.get("x1") ?? 0;
      const x2 = states.get("x2") ?? 0;
      return {
        loss: 0.5 * (x1 * x1 + x2 * x2),
        gradState: new Map([
          ["x1", x1],
          ["x2", x2],
        ]),
      };
    },
  });

  // Verify first 4 neural parameters against central finite differences
  const testParamSubset = paramNames.slice(0, 4);
  const h = 1e-4;

  for (const pName of testParamSubset) {
    const adjointGrad = adjointRes.gradients.get(pName) ?? 0;

    // Perturb +h
    const pIdx = arena.getVarIdxByName(pName);
    const origExprId = arena.getVarExpression(pIdx);
    const origVal = arena.getExprRealValue(origExprId);

    const simP = simulateArena(arena, {
      startTime: 0.0,
      stopTime: T,
      step: 0.005,
      parameterOverrides: new Map([[pName, origVal + h]]),
    });
    const x1P = getStateValue(simP, "x1");
    const x2P = getStateValue(simP, "x2");
    const lossP = 0.5 * (x1P * x1P + x2P * x2P);

    // Perturb -h
    const simM = simulateArena(arena, {
      startTime: 0.0,
      stopTime: T,
      step: 0.005,
      parameterOverrides: new Map([[pName, origVal - h]]),
    });
    const x1M = getStateValue(simM, "x1");
    const x2M = getStateValue(simM, "x2");
    const lossM = 0.5 * (x1M * x1M + x2M * x2M);

    const fdGrad = (lossP - lossM) / (2 * h);

    const relErr = Math.abs(adjointGrad - fdGrad) / (Math.abs(fdGrad) + 1e-4);
    console.log(
      `  Weight ${pName}: Adjoint=${adjointGrad.toFixed(6)}, FD=${fdGrad.toFixed(6)}, relErr=${(relErr * 100).toFixed(3)}%`,
    );
    assert.ok(relErr < 0.05, `Relative error too high for neural weight ${pName}: ${relErr}`);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 4: Neural Surrogate Calibration via Adjoint Gradient Descent
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 4: Training Neural Surrogate via Adjoint Gradient Descent (15 steps)...");

  // Ground truth target: we want oscillator to reach x1(T) = 0.2, x2(T) = -0.5
  const targetX1 = 0.2;
  const targetX2 = -0.5;

  let currentWeights = udeNet.getWeights(arena);
  let initialLoss = 0;
  let finalLoss = 0;

  const lr = 0.2;
  const numSteps = 25;
  const m = new Float64Array(paramNames.length);
  const v = new Float64Array(paramNames.length);
  const beta1 = 0.9;
  const beta2 = 0.999;
  const adamEps = 1e-8;

  for (let iter = 0; iter < numSteps; iter++) {
    udeNet.setWeights(arena, currentWeights);

    const res = solveDaeAdjoint(arena, {
      startTime: 0.0,
      stopTime: T,
      step: 0.01,
      parametersToDifferentiate: paramNames,
      terminalLoss: (states, _alg) => {
        const x1 = states.get("x1") ?? 0;
        const x2 = states.get("x2") ?? 0;
        const e1 = x1 - targetX1;
        const e2 = x2 - targetX2;
        return {
          loss: 0.5 * (e1 * e1 + e2 * e2),
          gradState: new Map([
            ["x1", e1],
            ["x2", e2],
          ]),
        };
      },
    });

    if (iter === 0) initialLoss = res.loss;
    finalLoss = res.loss;

    // Adam optimizer update
    for (let p = 0; p < paramNames.length; p++) {
      const g = res.gradients.get(paramNames[p]!) ?? 0;
      m[p] = beta1 * m[p]! + (1 - beta1) * g;
      v[p] = beta2 * v[p]! + (1 - beta2) * g * g;
      const mHat = m[p]! / (1 - Math.pow(beta1, iter + 1));
      const vHat = v[p]! / (1 - Math.pow(beta2, iter + 1));
      currentWeights[p] -= (lr * mHat) / (Math.sqrt(vHat) + adamEps);
    }

    if (iter % 5 === 0 || iter === numSteps - 1) {
      console.log(`    Iter ${iter.toString().padStart(2, " ")}: Loss = ${res.loss.toFixed(6)}`);
    }
  }

  console.log(`  Initial Loss: ${initialLoss.toFixed(6)} -> Final Loss: ${finalLoss.toFixed(6)}`);
  assert.ok(finalLoss < initialLoss, "Neural block loss failed to decrease during training!");
  const reduction = ((initialLoss - finalLoss) / initialLoss) * 100;
  console.log(`  Optimization achieved ${reduction.toFixed(1)}% loss reduction via in-arena adjoint training!`);
  assert.ok(reduction > 30, "Expected at least 30% loss reduction.");

  console.log("\nAll UDE Neural Block and In-Arena Adjoint tests PASSED successfully!");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
