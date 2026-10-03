// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, UnaryOp, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { simulateGrad } from "../src/core/adjoint-integrator.js";
import { simulateArena } from "../src/core/simulate-arena.js";

async function main() {
  console.log("=== Testing Continuous Adjoint Sensitivity & Differentiable Simulation ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Exponential Decay Sensitivity (dx/dt = -k * x)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("Test 1: Parameter sensitivity for exponential decay (dx/dt = -k * x)...");

  const arena1 = new DAEBuilder();
  const xIdx = arena1.addVariable("x", VarType.Real, Variability.Continuous, 0, 5.0);
  arena1.setVarStartValue(xIdx, 5.0);

  const kIdx = arena1.addVariable("k", VarType.Real, Variability.Parameter, 0, 2.0);
  const kLit = arena1.addRealLiteral(2.0);
  arena1.setVarExpression(kIdx, kLit);

  // der(x) = -k * x
  const xExpr = arena1.addNameExpr("x");
  const derX = arena1.addDerExpr(xExpr);
  const kExpr = arena1.addNameExpr("k");
  const rhs = arena1.addUnaryExpr(UnaryOp.Negate, arena1.addBinaryExpr(BinOp.Mul, kExpr, xExpr));
  arena1.addEquation(EqKind.Simple, derX, rhs);

  // Terminal loss: Phi(x(1)) = x(1)
  // Analytical: x(t) = 5 * exp(-k * t)
  // At t = 1: x(1) = 5 * exp(-k)
  // d x(1) / dk = -5 * exp(-k)
  // For k = 2.0: -5 * exp(-2) ≈ -0.676676
  const kNominal = 2.0;
  const expectedGradAnalytical = -5.0 * Math.exp(-kNominal);

  const gradResult = simulateGrad(arena1, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parametersToDifferentiate: ["k"],
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });

  const adjointGradK = gradResult.gradients.get("k") ?? 0;
  console.log(`  Adjoint dPhi/dk:    ${adjointGradK.toFixed(6)}`);
  console.log(`  Analytical dPhi/dk: ${expectedGradAnalytical.toFixed(6)}`);

  // Finite difference verification
  const eps = 1e-4;
  const simPlus = simulateArena(arena1, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parameterOverrides: new Map([["k", kNominal + eps]]),
  });
  const simMinus = simulateArena(arena1, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parameterOverrides: new Map([["k", kNominal - eps]]),
  });
  const xPlus = simPlus.y[simPlus.y.length - 1]?.[0] ?? 0;
  const xMinus = simMinus.y[simMinus.y.length - 1]?.[0] ?? 0;
  const fdGradK = (xPlus - xMinus) / (2 * eps);
  console.log(`  Finite Diff dPhi/dk: ${fdGradK.toFixed(6)}`);

  const relErrorAdjoint = Math.abs((adjointGradK - expectedGradAnalytical) / expectedGradAnalytical);
  assert.ok(
    relErrorAdjoint < 0.01,
    `Adjoint gradient relative error too large: ${(relErrorAdjoint * 100).toFixed(3)}%`,
  );
  console.log(`  ✔ Exponential decay adjoint gradient verified within ${(relErrorAdjoint * 100).toFixed(3)}% error`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Quadratic Loss Sensitivity (Phi = 0.5 * (x(1) - target)^2)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: Quadratic terminal loss sensitivity...");
  const targetX = 1.0;
  // Phi = 0.5 * (x(1) - 1.0)^2
  // dPhi/dk = (x(1) - 1.0) * (-5 * exp(-k))
  const expectedQuadGrad = (5.0 * Math.exp(-kNominal) - targetX) * (-5.0 * Math.exp(-kNominal));

  const quadResult = simulateGrad(arena1, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.005,
    parametersToDifferentiate: ["k"],
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      const diff = xT - targetX;
      return {
        loss: 0.5 * diff * diff,
        gradState: new Map([["x", diff]]),
      };
    },
  });

  const quadGradK = quadResult.gradients.get("k") ?? 0;
  console.log(`  Adjoint dPhi/dk:    ${quadGradK.toFixed(6)}`);
  console.log(`  Analytical dPhi/dk: ${expectedQuadGrad.toFixed(6)}`);

  const quadLossPlus = 0.5 * Math.pow(xPlus - targetX, 2);
  const quadLossMinus = 0.5 * Math.pow(xMinus - targetX, 2);
  const fdQuadGradK = (quadLossPlus - quadLossMinus) / (2 * eps);
  console.log(`  Finite Diff dPhi/dk: ${fdQuadGradK.toFixed(6)}`);

  const relErrorQuad = Math.abs((quadGradK - expectedQuadGrad) / expectedQuadGrad);
  assert.ok(
    relErrorQuad < 0.01,
    `Quadratic loss adjoint gradient error too large: ${(relErrorQuad * 100).toFixed(3)}%`,
  );
  console.log(`  ✔ Quadratic loss adjoint gradient verified within ${(relErrorQuad * 100).toFixed(3)}% error`);

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 3: Harmonic Oscillator Parameter Sensitivity (d^2 x / dt^2 = -w^2 * x)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 3: Harmonic oscillator frequency sensitivity (omega)...");

  const arena2 = new DAEBuilder();
  // x(0) = 1.0, v(0) = 0.0, w = 2.0
  const x2Idx = arena2.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arena2.setVarStartValue(x2Idx, 1.0);
  const v2Idx = arena2.addVariable("v", VarType.Real, Variability.Continuous, 0, 0.0);
  arena2.setVarStartValue(v2Idx, 0.0);

  const wIdx = arena2.addVariable("w", VarType.Real, Variability.Parameter, 0, 2.0);
  arena2.setVarExpression(wIdx, arena2.addRealLiteral(2.0));

  // der(x) = v
  const x2Expr = arena2.addNameExpr("x");
  const derX2 = arena2.addDerExpr(x2Expr);
  arena2.addEquation(EqKind.Simple, derX2, arena2.addNameExpr("v"));

  // der(v) = -w * w * x
  const v2Expr = arena2.addNameExpr("v");
  const derV2 = arena2.addDerExpr(v2Expr);
  const wExpr = arena2.addNameExpr("w");
  const wSq = arena2.addBinaryExpr(BinOp.Mul, wExpr, wExpr);
  const accel = arena2.addUnaryExpr(UnaryOp.Negate, arena2.addBinaryExpr(BinOp.Mul, wSq, x2Expr));
  arena2.addEquation(EqKind.Simple, derV2, accel);

  // Solution: x(t) = cos(w * t)
  // At t = 1.0: x(1) = cos(w)
  // dx(1)/dw = -t * sin(w * t) = -sin(2.0) ≈ -0.909297
  const wNominal = 2.0;
  const expectedGradOmega = -Math.sin(wNominal);

  const oscResult = simulateGrad(arena2, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.002,
    parametersToDifferentiate: ["w"],
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });

  const adjointGradW = oscResult.gradients.get("w") ?? 0;
  console.log(`  Adjoint dx(1)/dw:    ${adjointGradW.toFixed(6)}`);
  console.log(`  Analytical dx(1)/dw: ${expectedGradOmega.toFixed(6)}`);

  const simWPlus = simulateArena(arena2, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.002,
    parameterOverrides: new Map([["w", wNominal + eps]]),
  });
  const simWMinus = simulateArena(arena2, {
    startTime: 0.0,
    stopTime: 1.0,
    step: 0.002,
    parameterOverrides: new Map([["w", wNominal - eps]]),
  });
  const xWPlus = simWPlus.y[simWPlus.y.length - 1]?.[0] ?? 0;
  const xWMinus = simWMinus.y[simWMinus.y.length - 1]?.[0] ?? 0;
  const fdGradW = (xWPlus - xWMinus) / (2 * eps);
  console.log(`  Finite Diff dx(1)/dw: ${fdGradW.toFixed(6)}`);

  const relErrorW = Math.abs((adjointGradW - expectedGradOmega) / expectedGradOmega);
  assert.ok(relErrorW < 0.01, `Oscillator adjoint gradient error too large: ${(relErrorW * 100).toFixed(3)}%`);
  console.log(`  ✔ Harmonic oscillator adjoint sensitivity verified within ${(relErrorW * 100).toFixed(3)}% error`);

  console.log("\n=== All Continuous Adjoint Sensitivity Tests Passed Cleanly ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
