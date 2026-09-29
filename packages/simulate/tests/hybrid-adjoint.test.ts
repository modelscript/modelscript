// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { solveHybridAdjoint } from "../src/core/hybrid-adjoint.js";
import { simulateArena } from "../src/core/simulate-arena.js";

async function runTests() {
  console.log("=== Testing Hybrid Event & Switch Differentiable Adjoint Simulation ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Discontinuous If-Else Switch with Sigmoidal Relaxation
  // System:
  //   der(x) = if (x > th) then (-k1 * x) else (-k2 * x)
  //
  // Without relaxation, gradients w.r.t threshold th cannot propagate through
  // the discontinuous indicator. With sigmoidal relaxation:
  //   der(x) = sigma_k(x - th) * (-k1 * x) + (1 - sigma_k(x - th)) * (-k2 * x)
  // Non-zero gradient flows through th, enabling threshold parameter identification!
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: Discontinuous If-Else switch with sigmoidal relaxation...");

  const arena = new DAEBuilder();
  const x0Val = 4.0;
  const thNominal = 2.0;
  const k1Nominal = 1.0;
  const k2Nominal = 0.5;

  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous, 0, x0Val);
  arena.setVarStartValue(xIdx, x0Val);

  const thIdx = arena.addVariable("th", VarType.Real, Variability.Parameter, 0, thNominal);
  arena.setVarExpression(thIdx, arena.addRealLiteral(thNominal));

  const k1Idx = arena.addVariable("k1", VarType.Real, Variability.Parameter, 0, k1Nominal);
  arena.setVarExpression(k1Idx, arena.addRealLiteral(k1Nominal));

  const k2Idx = arena.addVariable("k2", VarType.Real, Variability.Parameter, 0, k2Nominal);
  arena.setVarExpression(k2Idx, arena.addRealLiteral(k2Nominal));

  // Condition: x > th
  const xExpr = arena.addNameExpr("x");
  const thExpr = arena.addNameExpr("th");
  const condExpr = arena.addBinaryExpr(BinOp.Gt, xExpr, thExpr);

  // Then branch: -k1 * x
  const k1Expr = arena.addNameExpr("k1");
  const thenExpr = arena.addBinaryExpr(
    BinOp.Mul,
    arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), k1Expr),
    xExpr,
  );

  // Else branch: -k2 * x
  const k2Expr = arena.addNameExpr("k2");
  const elseExpr = arena.addBinaryExpr(
    BinOp.Mul,
    arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(-1), k2Expr),
    xExpr,
  );

  // der(x) = if (x > th) then thenExpr else elseExpr
  const ifElseExpr = arena.addIfElseExpr(condExpr, thenExpr, elseExpr);
  const derX = arena.addDerExpr(xExpr);
  arena.addEquation(EqKind.Simple, derX, ifElseExpr);

  // Solve hybrid adjoint with sigmoidal relaxation enabled
  const hybridResult = solveHybridAdjoint(arena, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parametersToDifferentiate: ["k1", "k2", "th"],
    relaxation: {
      smoothness: 20.0,
      relaxIfElse: true,
    },
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });

  const gradK1 = hybridResult.gradients.get("k1") ?? 0;
  const gradK2 = hybridResult.gradients.get("k2") ?? 0;
  const gradTh = hybridResult.gradients.get("th") ?? 0;

  console.log(`  Adjoint dPhi/dk1: ${gradK1.toFixed(6)}`);
  console.log(`  Adjoint dPhi/dk2: ${gradK2.toFixed(6)}`);
  console.log(`  Adjoint dPhi/dth: ${gradTh.toFixed(6)}`);

  // Verify that gradients are well-defined, non-zero, and non-NaN
  assert.ok(!isNaN(gradK1) && gradK1 !== 0, "Gradient w.r.t k1 must be non-zero");
  assert.ok(!isNaN(gradK2) && gradK2 !== 0, "Gradient w.r.t k2 must be non-zero");
  assert.ok(!isNaN(gradTh) && gradTh !== 0, "Gradient w.r.t threshold th must flow and be non-zero");

  // Finite difference comparison on the relaxed DAE
  const eps = 1e-4;
  const simPlusTh = simulateArena(arena, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parameterOverrides: new Map([["th", thNominal + eps]]),
  });
  const simMinusTh = simulateArena(arena, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parameterOverrides: new Map([["th", thNominal - eps]]),
  });
  const xPlusTh = simPlusTh.y[simPlusTh.y.length - 1]?.[0] ?? 0;
  const xMinusTh = simMinusTh.y[simMinusTh.y.length - 1]?.[0] ?? 0;
  const fdGradTh = (xPlusTh - xMinusTh) / (2 * eps);
  console.log(`  Finite Diff dPhi/dth: ${fdGradTh.toFixed(6)}`);

  const relDiffTh = Math.abs((gradTh - fdGradTh) / fdGradTh);
  assert.ok(relDiffTh < 0.02, `Threshold gradient mismatch with finite diff: ${(relDiffTh * 100).toFixed(2)}%`);
  console.log(`  ✔ Differentiable switch threshold gradient verified within ${(relDiffTh * 100).toFixed(2)}% error`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Discrete Reset Map with Hybrid Adjoint Jump Condition
  // System:
  //   der(x) = -x,  x(0) = 1.0
  //   At t = 0.5:  x^+ = c * x^-  (discrete multiplier reset)
  //
  // Analytical Solution:
  //   For t < 0.5: x(t) = exp(-t)
  //   At t = 0.5^-: x(0.5^-) = exp(-0.5)
  //   At t = 0.5^+: x(0.5^+) = c * exp(-0.5)
  //   For t > 0.5: x(t) = c * exp(-0.5) * exp(-(t - 0.5)) = c * exp(-t)
  //
  // Terminal Loss at T = 1.0:
  //   Phi(x(1)) = x(1) = c * exp(-1.0)
  //   dPhi / dc = exp(-1.0) ≈ 0.367879
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: Discrete reset event with exact hybrid adjoint jump condition...");

  const arena2 = new DAEBuilder();
  const cNominal = 2.0;

  const x2Idx = arena2.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena2.setVarStartValue(x2Idx, 1.0);

  const cIdx = arena2.addVariable("c", VarType.Real, Variability.Parameter, 0, cNominal);
  arena2.setVarExpression(cIdx, arena2.addRealLiteral(cNominal));

  // der(x) = -x
  const x2Expr = arena2.addNameExpr("x");
  const derX2 = arena2.addDerExpr(x2Expr);
  const negX = arena2.addBinaryExpr(BinOp.Mul, arena2.addRealLiteral(-1), x2Expr);
  arena2.addEquation(EqKind.Simple, derX2, negX);

  const expected_dPhi_dc = Math.exp(-1.0);

  const hybridJumpResult = solveHybridAdjoint(arena2, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parametersToDifferentiate: ["c"],
    parameterOverrides: new Map([["c", cNominal]]),
    events: [
      {
        name: "time_reset",
        indicator: (t) => t - 0.5,
        gradIndicatorState: () => new Map([["x", 0.0]]),
        gradIndicatorParam: () => new Map(),
        resetMap: (_t, xMinus, p) => {
          const c = p.get("c") ?? 1.0;
          return new Map([["x", c * (xMinus.get("x") ?? 0)]]);
        },
        jacobianResetState: (_t, _xMinus, p) => {
          const c = p.get("c") ?? 1.0;
          return new Map([["x", new Map([["x", c]])]]);
        },
        jacobianResetParam: (_t, xMinus) => {
          const xVal = xMinus.get("x") ?? 0;
          return new Map([["x", new Map([["c", xVal]])]]);
        },
      },
    ],
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });

  const adjoint_dPhi_dc = hybridJumpResult.gradients.get("c") ?? 0;
  console.log(`  Adjoint dPhi/dc:    ${adjoint_dPhi_dc.toFixed(6)}`);
  console.log(`  Analytical dPhi/dc: ${expected_dPhi_dc.toFixed(6)}`);

  const relDiffC = Math.abs((adjoint_dPhi_dc - expected_dPhi_dc) / expected_dPhi_dc);
  assert.ok(relDiffC < 0.02, `Discrete reset adjoint gradient error too large: ${(relDiffC * 100).toFixed(2)}%`);
  console.log(`  ✔ Discrete event jump adjoint sensitivity verified within ${(relDiffC * 100).toFixed(2)}% error`);

  console.log("\n=== All Hybrid Event Adjoint Tests Passed Cleanly ===");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
