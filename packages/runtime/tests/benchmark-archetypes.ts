// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-Archetype DAE Scale Benchmark.
 *
 * Characterizes performance across different modeling archetypes:
 * 1. Array-Preserved Vector DAE (N = 100k, 1M, 10 Million elements)
 * 2. Fully Scalarized Decoupled DAE (N = 10k, 100k, 1M distinct scalar equations)
 * 3. Fully Scalarized 1D Banded Coupled PDE (Heat diffusion, N = 10k, 100k, 1M)
 * 4. Coupled Non-linear DAE with Algebraic Loops (N = 10k, 50k, 100k)
 */

import { performance } from "node:perf_hooks";
import { BinOp, Causality, DAEBuilder, EqKind, ExprKind, VarType, Variability } from "../src/index.js";

// ── Archetype 1: Array-Preserved Vector DAE ─────────────────────────────────
interface ArrayResult {
  dimension: number;
  totalEquationElements: number;
  buildTimeMs: number;
  wasmMb: number;
  throughputElementsSec: number;
}

function benchmarkArrayPreserved(n: number): ArrayResult {
  const dae = new DAEBuilder(undefined, "ArrayVectorODE");
  const xName = dae.interner.intern("x");

  const t0 = performance.now();

  // 1 vector variable with shape [N]
  const xVar = dae.addVariable(xName, VarType.Real, Variability.Continuous, Causality.Local, 1.0, 0);
  dae.setVarShape(xVar, [n]);

  // Expression: der(x) = -x (array equation with shape [N])
  const xExpr = dae.addExpression(ExprKind.Name, xVar);
  const derXExpr = dae.addExpression(ExprKind.Derivative, xExpr);
  const negOne = dae.addRealLiteral(-1.0);
  const rhsExpr = dae.addBinaryExpr(BinOp.Mul, negOne, xExpr);

  dae.addArrayEquation(derXExpr, rhsExpr, [n]);

  const buildTimeMs = performance.now() - t0;
  const wasmMb = (dae.exports?.memory?.buffer?.byteLength ?? 0) / (1024 * 1024);

  dae.free();

  return {
    dimension: n,
    totalEquationElements: n,
    buildTimeMs,
    wasmMb,
    throughputElementsSec: Math.round(n / (Math.max(buildTimeMs, 0.001) / 1000)),
  };
}

// ── Archetype 2: Fully Scalarized Decoupled DAE ─────────────────────────────
interface ScalarDecoupledResult {
  equationCount: number;
  buildTimeMs: number;
  wasmMb: number;
  throughputEqSec: number;
  bytesPerEquation: number;
}

function benchmarkScalarDecoupled(n: number): ScalarDecoupledResult {
  const dae = new DAEBuilder(undefined, "DecoupledScalarDAE");
  const xName = dae.interner.intern("x");
  const paramLit = dae.addRealLiteral(-1.0);

  const t0 = performance.now();

  for (let i = 0; i < n; i++) {
    const varIdx = dae.addVariable(xName, VarType.Real, Variability.Continuous, Causality.Local, 1.0, 0);
    const varExpr = dae.addExpression(ExprKind.Name, varIdx);
    const derExpr = dae.addExpression(ExprKind.Derivative, varExpr);
    const rhsExpr = dae.addBinaryExpr(BinOp.Mul, paramLit, varExpr);
    dae.addEquation(EqKind.Simple, derExpr, rhsExpr);
  }

  const buildTimeMs = performance.now() - t0;
  const wasmBytes = dae.exports?.memory?.buffer?.byteLength ?? 0;
  const wasmMb = wasmBytes / (1024 * 1024);

  dae.free();

  return {
    equationCount: n,
    buildTimeMs,
    wasmMb,
    throughputEqSec: Math.round(n / (buildTimeMs / 1000)),
    bytesPerEquation: wasmBytes / n,
  };
}

// ── Archetype 3: 1D Banded Coupled PDE (Heat Diffusion) ─────────────────────
interface BandedResult {
  nodeCount: number;
  couplingNnz: number;
  buildTimeMs: number;
  wasmMb: number;
  throughputNodesSec: number;
}

function benchmarkBandedPDE(n: number): BandedResult {
  const dae = new DAEBuilder(undefined, "Heat1DPDE");
  const tName = dae.interner.intern("T");
  const alphaLit = dae.addRealLiteral(0.25);
  const twoLit = dae.addRealLiteral(2.0);

  const t0 = performance.now();

  const varIds = new Int32Array(n);
  const exprIds = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    varIds[i] = dae.addVariable(tName, VarType.Real, Variability.Continuous, Causality.Local, 293.15, 0);
    exprIds[i] = dae.addExpression(ExprKind.Name, varIds[i]!);
  }

  // Banded tridiagonal equations:
  // der(T[i]) = alpha * (T[i+1] - 2*T[i] + T[i-1])
  for (let i = 0; i < n; i++) {
    const derExpr = dae.addExpression(ExprKind.Derivative, exprIds[i]!);
    const prevExpr = i > 0 ? exprIds[i - 1]! : exprIds[i]!;
    const nextExpr = i < n - 1 ? exprIds[i + 1]! : exprIds[i]!;

    const twoTi = dae.addBinaryExpr(BinOp.Mul, twoLit, exprIds[i]!);
    const diff1 = dae.addBinaryExpr(BinOp.Sub, nextExpr, twoTi);
    const laplacian = dae.addBinaryExpr(BinOp.Add, diff1, prevExpr);
    const rhs = dae.addBinaryExpr(BinOp.Mul, alphaLit, laplacian);

    dae.addEquation(EqKind.Simple, derExpr, rhs);
  }

  const buildTimeMs = performance.now() - t0;
  const wasmMb = (dae.exports?.memory?.buffer?.byteLength ?? 0) / (1024 * 1024);

  dae.free();

  return {
    nodeCount: n,
    couplingNnz: n * 3 - 2,
    buildTimeMs,
    wasmMb,
    throughputNodesSec: Math.round(n / (buildTimeMs / 1000)),
  };
}

// ── Archetype 4: Coupled DAE with Algebraic Loops ───────────────────────────
interface AlgebraicLoopResult {
  totalEquations: number;
  dynamicStates: number;
  algebraicVars: number;
  buildTimeMs: number;
  wasmMb: number;
  throughputEqSec: number;
}

function benchmarkAlgebraicLoops(loopCount: number): AlgebraicLoopResult {
  const dae = new DAEBuilder(undefined, "CoupledAlgebraicLoops");
  const xName = dae.interner.intern("x");
  const yName = dae.interner.intern("y");
  const oneLit = dae.addRealLiteral(1.0);
  const halfLit = dae.addRealLiteral(0.5);

  const t0 = performance.now();

  let prevYExpr = -1;

  for (let i = 0; i < loopCount; i++) {
    // Dynamic state x[i]
    const xVar = dae.addVariable(xName, VarType.Real, Variability.Continuous, Causality.Local, 1.0, 0);
    const xExpr = dae.addExpression(ExprKind.Name, xVar);
    const derX = dae.addExpression(ExprKind.Derivative, xExpr);

    // Algebraic variable y[i]
    const yVar = dae.addVariable(yName, VarType.Real, Variability.Continuous, Causality.Local, 0.0, 0);
    const yExpr = dae.addExpression(ExprKind.Name, yVar);

    // Dynamic eq: der(x[i]) = -x[i] + y[i]
    const negX = dae.addBinaryExpr(BinOp.Sub, dae.addRealLiteral(0.0), xExpr);
    const dynRhs = dae.addBinaryExpr(BinOp.Add, negX, yExpr);
    dae.addEquation(EqKind.Simple, derX, dynRhs);

    // Algebraic eq: y[i] - 0.5 * x[i] - 0.25 * y[i-1] = 0
    let algLhs = dae.addBinaryExpr(BinOp.Sub, yExpr, dae.addBinaryExpr(BinOp.Mul, halfLit, xExpr));
    if (prevYExpr >= 0) {
      algLhs = dae.addBinaryExpr(BinOp.Sub, algLhs, dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.25), prevYExpr));
    }
    dae.addEquation(EqKind.Simple, algLhs, dae.addRealLiteral(0.0));

    prevYExpr = yExpr;
  }

  const buildTimeMs = performance.now() - t0;
  const wasmMb = (dae.exports?.memory?.buffer?.byteLength ?? 0) / (1024 * 1024);

  dae.free();

  return {
    totalEquations: loopCount * 2,
    dynamicStates: loopCount,
    algebraicVars: loopCount,
    buildTimeMs,
    wasmMb,
    throughputEqSec: Math.round((loopCount * 2) / (buildTimeMs / 1000)),
  };
}

async function main() {
  console.log("=========================================================================================");
  console.log(" ModelScript Multi-Archetype Scale Benchmark (Arrays vs. Scalars vs. Coupling)");
  console.log("=========================================================================================\n");

  // 1. Array Preservation Benchmark
  console.log("── Archetype 1: Array-Preserved Vector DAE (Symbolic Tensor/Vector Representation) ──");
  console.log(
    "Dimension".padEnd(16) + "Elements".padEnd(16) + "Time".padEnd(12) + "WASM Mem".padEnd(14) + "Throughput (elem/s)",
  );
  console.log("-".repeat(78));
  for (const n of [100_000, 1_000_000, 10_000_000]) {
    const res = benchmarkArrayPreserved(n);
    console.log(
      `x[${n.toLocaleString()}]`.padEnd(16) +
        res.totalEquationElements.toLocaleString().padEnd(16) +
        `${res.buildTimeMs.toFixed(2)}ms`.padEnd(12) +
        `${res.wasmMb.toFixed(2)} MB`.padEnd(14) +
        `${res.throughputElementsSec.toLocaleString()} elem/s`,
    );
  }

  // 2. Fully Scalarized Decoupled DAE
  console.log("\n── Archetype 2: Fully Scalarized Decoupled DAE (Distinct Scalar Variables & Equations) ──");
  console.log(
    "Scalar Eqs".padEnd(16) + "Time".padEnd(12) + "WASM Mem".padEnd(14) + "Rate (eq/s)".padEnd(16) + "Bytes/Eq",
  );
  console.log("-".repeat(72));
  for (const n of [10_000, 100_000, 1_000_000]) {
    const res = benchmarkScalarDecoupled(n);
    console.log(
      n.toLocaleString().padEnd(16) +
        `${res.buildTimeMs.toFixed(1)}ms`.padEnd(12) +
        `${res.wasmMb.toFixed(2)} MB`.padEnd(14) +
        res.throughputEqSec.toLocaleString().padEnd(16) +
        `${res.bytesPerEquation.toFixed(1)} B`,
    );
  }

  // 3. 1D Banded Coupled PDE (Heat Diffusion)
  console.log("\n── Archetype 3: 1D Banded Coupled PDE (Tridiagonal Heat/Wave Spatial Discretization) ──");
  console.log(
    "Nodes".padEnd(16) + "Coupling NNZ".padEnd(16) + "Time".padEnd(12) + "WASM Mem".padEnd(14) + "Throughput",
  );
  console.log("-".repeat(76));
  for (const n of [10_000, 100_000, 1_000_000]) {
    const res = benchmarkBandedPDE(n);
    console.log(
      n.toLocaleString().padEnd(16) +
        res.couplingNnz.toLocaleString().padEnd(16) +
        `${res.buildTimeMs.toFixed(1)}ms`.padEnd(12) +
        `${res.wasmMb.toFixed(2)} MB`.padEnd(14) +
        `${res.throughputNodesSec.toLocaleString()} nodes/s`,
    );
  }

  // 4. Non-Linear Algebraic Loops
  console.log("\n── Archetype 4: Coupled DAE with Algebraic Loops (State + Algebraic Feedback) ──");
  console.log(
    "Total Eqs".padEnd(16) +
      "States".padEnd(12) +
      "Alg Vars".padEnd(12) +
      "Time".padEnd(12) +
      "WASM Mem".padEnd(14) +
      "Throughput",
  );
  console.log("-".repeat(82));
  for (const n of [10_000, 50_000, 100_000]) {
    const res = benchmarkAlgebraicLoops(n);
    console.log(
      res.totalEquations.toLocaleString().padEnd(16) +
        res.dynamicStates.toLocaleString().padEnd(12) +
        res.algebraicVars.toLocaleString().padEnd(12) +
        `${res.buildTimeMs.toFixed(1)}ms`.padEnd(12) +
        `${res.wasmMb.toFixed(2)} MB`.padEnd(14) +
        `${res.throughputEqSec.toLocaleString()} eq/s`,
    );
  }

  console.log("\n=========================================================================================");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
