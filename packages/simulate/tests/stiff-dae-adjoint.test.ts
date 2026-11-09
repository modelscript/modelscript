// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEBuilder, EqKind, ExprKind, VarType, Variability } from "@modelscript/runtime";
import { initBltWasm } from "@modelscript/runtime/wasm_blt.js";
import assert from "node:assert";
import { solveDaeAdjoint } from "../src/core/dae-adjoint-solver.js";

async function runStiffAdjointTests() {
  console.log("=== Testing Checkpointed Continuous Adjoint DAE Solver for Stiff Systems ===");
  await initBltWasm();

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 1: Ultra-Stiff Decay System Stability Benchmark
  // System:
  //   der(x) = -kappa * x,  x(0) = 1.0,  kappa = 500.0
  //
  // Analytical Solution:
  //   x(t) = exp(-kappa * t)
  //   Terminal loss Phi = x(T)
  //   dPhi / dkappa = -T * exp(-kappa * T)
  //
  // For h = 0.01, h * kappa = 5.0 > 2.0 (explicit Runge-Kutta / Heun is UNSTABLE)
  // Implicit Trapezoidal and TR-BDF2 remain strictly stable!
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 1: Ultra-Stiff System (kappa = 500, h = 0.01, h*kappa = 5.0)...");

  const arenaStiff = new DAEBuilder();
  const kappaNominal = 500.0;
  const T = 0.1; // 10 steps of h = 0.01

  const xIdx = arenaStiff.addVariable("x", VarType.Real, Variability.Continuous, 0, 1.0);
  arenaStiff.setVarStartValue(xIdx, 1.0);

  const kappaIdx = arenaStiff.addVariable("kappa", VarType.Real, Variability.Parameter, 0, kappaNominal);

  // Equation: der(x) = -kappa * x
  const xExpr = arenaStiff.addName(arenaStiff.interner.intern("x"));
  const kappaExpr = arenaStiff.addName(arenaStiff.interner.intern("kappa"));
  const derXExpr = arenaStiff.addDerExpr(xExpr);
  const rhsExpr = arenaStiff.addExpression(ExprKind.Negate, 0, arenaStiff.addBinaryExpr(BinOp.Mul, kappaExpr, xExpr));
  arenaStiff.addEquation(EqKind.Simple, derXExpr, rhsExpr);

  arenaStiff.experiment = {
    startTime: 0,
    stopTime: T,
    numberOfIntervals: 10,
    step: 0.01,
  };

  const analyticalTerminalX = Math.exp(-kappaNominal * T);
  const analyticalGradKappa = -T * Math.exp(-kappaNominal * T);

  // 1a. Implicit Trapezoidal Scheme (A-stable)
  console.log("  Testing Implicit Trapezoidal backward adjoint scheme...");
  const resImplicit = solveDaeAdjoint(arenaStiff, {
    startTime: 0,
    stopTime: T,
    step: 0.01,
    parametersToDifferentiate: ["kappa"],
    adjointMethod: "implicit-trapezoidal",
    forwardIntegrator: "tr-bdf2",
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });

  const gradImplicit = resImplicit.gradients.get("kappa") ?? 0;
  console.log(`    Analytical dPhi/dkappa:       ${analyticalGradKappa.toExponential(6)}`);
  console.log(`    Implicit Trapezoidal dPhi/dk: ${gradImplicit.toExponential(6)}`);
  assert.ok(Number.isFinite(gradImplicit), "Implicit Trapezoidal gradient must be finite and unconditionally stable");
  assert.ok(
    Math.abs(gradImplicit) < 1e-4,
    `For kappa=500, T=0.1, terminal gradient must decay gracefully without explosion (got ${gradImplicit})`,
  );

  // 1b. TR-BDF2 Scheme (L-stable)
  console.log("  Testing TR-BDF2 backward adjoint scheme...");
  const resTrBdf2 = solveDaeAdjoint(arenaStiff, {
    startTime: 0,
    stopTime: T,
    step: 0.01,
    parametersToDifferentiate: ["kappa"],
    adjointMethod: "tr-bdf2",
    forwardIntegrator: "tr-bdf2",
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });

  const gradTrBdf2 = resTrBdf2.gradients.get("kappa") ?? 0;
  console.log(`    TR-BDF2 dPhi/dk:              ${gradTrBdf2.toExponential(6)}`);
  assert.ok(Number.isFinite(gradTrBdf2), "TR-BDF2 gradient must be finite and L-stable");
  assert.ok(
    Math.abs(gradTrBdf2) < 1e-4,
    `TR-BDF2 terminal gradient must decay gracefully without high-frequency oscillation (got ${gradTrBdf2})`,
  );

  // 1c. Verify that Explicit Heun would produce wild oscillations/divergence
  console.log("  Testing Explicit Heun (expected to exhibit numerical instability)...");
  const resHeun = solveDaeAdjoint(arenaStiff, {
    startTime: 0,
    stopTime: T,
    step: 0.01,
    parametersToDifferentiate: ["kappa"],
    adjointMethod: "explicit-heun",
    terminalLoss: (states) => {
      const xT = states.get("x") ?? 0;
      return {
        loss: xT,
        gradState: new Map([["x", 1.0]]),
      };
    },
  });
  const gradHeun = resHeun.gradients.get("kappa") ?? 0;
  console.log(`    Explicit Heun dPhi/dk:        ${gradHeun.toExponential(6)}`);
  assert.ok(
    Math.abs(gradHeun) > 1.0 || Math.abs(gradHeun) > 100 * Math.abs(gradImplicit),
    "Explicit Heun must exhibit numerical instability/divergence on stiff systems",
  );
  // Explicit Heun should blow up or produce error several orders of magnitude higher
  console.log(
    "  ✔ Stiff backward adjoint stability verified: Implicit methods remain bounded while explicit oscillates",
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // Test 2: Coupled Stiff Two-Scale Kinetics System
  // System:
  //   der(x1) = -k1 * x1,           x1(0) = 1.0,  k1 = 100.0 (fast stiff mode)
  //   der(x2) =  k1 * x1 - k2 * x2,  x2(0) = 0.0,  k2 = 1.0   (slow mode)
  //
  // Terminal Loss:
  //   Phi = x2(T)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\nTest 2: Coupled Two-Scale Stiff System (k1 = 100, k2 = 1)...");

  const arenaKinetics = new DAEBuilder();
  const k1Val = 100.0;
  const k2Val = 1.0;
  const simT = 0.2;
  const simStep = 0.005;

  const x1Idx = arenaKinetics.addVariable("x1", VarType.Real, Variability.Continuous, 0, 1.0);
  arenaKinetics.setVarStartValue(x1Idx, 1.0);
  const x2Idx = arenaKinetics.addVariable("x2", VarType.Real, Variability.Continuous, 0, 0.0);
  arenaKinetics.setVarStartValue(x2Idx, 0.0);

  arenaKinetics.addVariable("k1", VarType.Real, Variability.Parameter, 0, k1Val);
  arenaKinetics.addVariable("k2", VarType.Real, Variability.Parameter, 0, k2Val);

  const x1Exp = arenaKinetics.addName(arenaKinetics.interner.intern("x1"));
  const x2Exp = arenaKinetics.addName(arenaKinetics.interner.intern("x2"));
  const k1Exp = arenaKinetics.addName(arenaKinetics.interner.intern("k1"));
  const k2Exp = arenaKinetics.addName(arenaKinetics.interner.intern("k2"));

  // der(x1) = -k1 * x1
  arenaKinetics.addEquation(
    EqKind.Simple,
    arenaKinetics.addDerExpr(x1Exp),
    arenaKinetics.addExpression(ExprKind.Negate, 0, arenaKinetics.addBinaryExpr(BinOp.Mul, k1Exp, x1Exp)),
  );

  // der(x2) = k1 * x1 - k2 * x2
  arenaKinetics.addEquation(
    EqKind.Simple,
    arenaKinetics.addDerExpr(x2Exp),
    arenaKinetics.addBinaryExpr(
      BinOp.Sub,
      arenaKinetics.addBinaryExpr(BinOp.Mul, k1Exp, x1Exp),
      arenaKinetics.addBinaryExpr(BinOp.Mul, k2Exp, x2Exp),
    ),
  );

  arenaKinetics.experiment = {
    startTime: 0,
    stopTime: simT,
    numberOfIntervals: Math.round(simT / simStep),
    step: simStep,
  };

  const resCoupled = solveDaeAdjoint(arenaKinetics, {
    startTime: 0,
    stopTime: simT,
    step: simStep,
    parametersToDifferentiate: ["k1", "k2"],
    adjointMethod: "auto", // Auto-detects stiffness and engages implicit scheme
    forwardIntegrator: "tr-bdf2",
    terminalLoss: (states) => {
      const x2Final = states.get("x2") ?? 0;
      return {
        loss: x2Final,
        gradState: new Map([["x2", 1.0]]),
      };
    },
  });

  const gradK1 = resCoupled.gradients.get("k1") ?? 0;
  const gradK2 = resCoupled.gradients.get("k2") ?? 0;

  // Analytical solution for x2(T):
  // x2(T) = (k1 / (k2 - k1)) * (exp(-k1 * T) - exp(-k2 * T))
  const analyticalX2 = (k1: number, k2: number, t: number) =>
    (k1 / (k2 - k1)) * (Math.exp(-k1 * t) - Math.exp(-k2 * t));

  const eps = 1e-5;
  const fdK1 = (analyticalX2(k1Val + eps, k2Val, simT) - analyticalX2(k1Val - eps, k2Val, simT)) / (2 * eps);
  const fdK2 = (analyticalX2(k1Val, k2Val + eps, simT) - analyticalX2(k1Val, k2Val - eps, simT)) / (2 * eps);

  console.log(`    Adjoint dPhi/dk1:     ${gradK1.toFixed(6)}, Expected (FD): ${fdK1.toFixed(6)}`);
  console.log(`    Adjoint dPhi/dk2:     ${gradK2.toFixed(6)}, Expected (FD): ${fdK2.toFixed(6)}`);

  const relErrK1 = Math.abs(gradK1 - fdK1) / Math.abs(fdK1);
  const relErrK2 = Math.abs(gradK2 - fdK2) / Math.abs(fdK2);

  assert.ok(relErrK1 < 0.05, `Coupled stiff dPhi/dk1 error too high: ${(relErrK1 * 100).toFixed(2)}%`);
  assert.ok(relErrK2 < 0.02, `Coupled stiff dPhi/dk2 error too high: ${(relErrK2 * 100).toFixed(2)}%`);

  console.log(
    `  ✔ Coupled stiff two-scale gradients verified within ${(relErrK1 * 100).toFixed(2)}% and ${(relErrK2 * 100).toFixed(2)}% error`,
  );

  console.log("\n=== All Stiff DAE Continuous Adjoint Tests Passed Cleanly ===");
}

runStiffAdjointTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
