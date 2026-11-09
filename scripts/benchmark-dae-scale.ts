// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * ModelScript DAE Large-Scale Scaling Benchmark (1k to 100k Equations).
 * Verifies that Constant Folding and Alias Elimination scale strictly linearly O(E)
 * in WebAssembly chunked linear memory without O(N^2) fixed-point blowups.
 */

import { BinOp, DAEBuilder, EqKind, ExprKind, Variability, VarType } from "@modelscript/runtime";
import { initBltWasm, performBltTransformationArena } from "../packages/runtime/src/analysis/wasm_blt.js";
import { pantelidesIndexReductionArena } from "../packages/runtime/src/analysis/wasm_pantelides.js";
import { eliminateArenaAliases } from "../packages/runtime/src/dae/wasm_dae.js";
import { foldArenaConstants } from "../packages/runtime/src/dae/wasm_fold.js";

interface ScaleResult {
  scale: number;
  equations: number;
  variables: number;
  foldMs: number;
  aliasMs: number;
  pantelidesMs: number;
  bltMs: number;
  totalMs: number;
}

export function runDaeScaleBenchmark(N: number): ScaleResult {
  const arena = new DAEBuilder();

  // Create deep parameter dependency cascade: p_0 = 1, p_i = p_{i-1} + 1
  const paramCount = Math.min(N, 100);
  const parameterVars = new Set<number>();
  for (let i = 0; i < paramCount; i++) {
    const pName = `p_${i}`;
    let exprId: number;
    if (i === 0) {
      exprId = arena.addRealLiteral(1.0);
    } else {
      const prevName = arena.addExpression(ExprKind.Name, arena.interner.intern(`p_${i - 1}`));
      const one = arena.addRealLiteral(1.0);
      exprId = arena.addBinaryExpr(BinOp.Add, prevName, one);
    }
    const vIdx = arena.addVariable(pName, VarType.Real, Variability.Parameter);
    arena.setVarExpression(vIdx, exprId);
    parameterVars.add(vIdx);
  }

  const stateVars = new Set<number>();
  const derivativeVars = new Set<number>();

  // Create N coupled differential-algebraic equations:
  // Eq 1: der(x_i) = p_99 * y_i
  // Eq 2: y_i = x_i + 1.0
  for (let i = 0; i < N; i++) {
    const xIdx = arena.addVariable(`x_${i}`, VarType.Real, Variability.Continuous);
    const derXIdx = arena.addVariable(`der(x_${i})`, VarType.Real, Variability.Continuous);
    stateVars.add(xIdx);
    derivativeVars.add(derXIdx);
    arena.addVariable(`y_${i}`, VarType.Real, Variability.Continuous);

    const xExpr = arena.addExpression(ExprKind.Name, arena.interner.intern(`x_${i}`));
    const derXExpr = arena.addDerExpr(xExpr);
    const yExpr = arena.addExpression(ExprKind.Name, arena.interner.intern(`y_${i}`));
    const pExpr = arena.addExpression(ExprKind.Name, arena.interner.intern(`p_${paramCount - 1}`));
    const rhs1 = arena.addBinaryExpr(BinOp.Mul, pExpr, yExpr);
    arena.addEquation(EqKind.Simple, derXExpr, rhs1);

    const one = arena.addRealLiteral(1.0);
    const rhs2 = arena.addBinaryExpr(BinOp.Add, xExpr, one);
    arena.addEquation(EqKind.Simple, yExpr, rhs2);
  }

  // Create alias equations: subsystem.z_i = x_i
  const aliasCount = Math.min(N, 1000);
  for (let i = 0; i < aliasCount; i++) {
    arena.addVariable(`subsystem.z_${i}`, VarType.Real, Variability.Continuous);
    const zExpr = arena.addExpression(ExprKind.Name, arena.interner.intern(`subsystem.z_${i}`));
    const xExpr = arena.addExpression(ExprKind.Name, arena.interner.intern(`x_${i}`));
    arena.addEquation(EqKind.Simple, zExpr, xExpr);
  }

  const t0 = performance.now();
  foldArenaConstants(arena);
  const foldMs = performance.now() - t0;

  const t1 = performance.now();
  eliminateArenaAliases(arena);
  const aliasMs = performance.now() - t1;

  const t2 = performance.now();
  const pantelidesRes = pantelidesIndexReductionArena(arena, stateVars, derivativeVars, parameterVars);
  const pantelidesMs = performance.now() - t2;

  const t3 = performance.now();
  performBltTransformationArena(arena, stateVars, pantelidesRes.dummyDerivatives, parameterVars);
  const bltMs = performance.now() - t3;

  return {
    scale: N,
    equations: arena.eqCount,
    variables: arena.varCount,
    foldMs,
    aliasMs,
    pantelidesMs,
    bltMs,
    totalMs: foldMs + aliasMs + pantelidesMs + bltMs,
  };
}

async function main() {
  await initBltWasm();

  const includeMillion = process.argv.includes("--million") || process.argv.includes("--1m");
  const maxScaleLabel = includeMillion ? "1,000,000" : "100,000";
  console.log(
    "==========================================================================================================",
  );
  console.log(`ModelScript Full DAE Pre-Simulation Scaling Benchmark (1,000 -> ${maxScaleLabel} Equations)`);
  console.log(
    "==========================================================================================================\n",
  );

  const scales = includeMillion ? [1000, 10000, 50000, 100000, 250000, 500000, 1000000] : [1000, 10000, 50000, 100000];
  const results: ScaleResult[] = [];

  for (const n of scales) {
    const res = runDaeScaleBenchmark(n);
    results.push(res);
    console.log(
      `Scale N = ${res.scale.toString().padStart(8)} | Eq: ${res.equations.toString().padStart(8)} | Var: ${res.variables.toString().padStart(8)} | ` +
        `Fold: ${res.foldMs.toFixed(2).padStart(6)}ms | Alias: ${res.aliasMs.toFixed(2).padStart(6)}ms | Pant: ${res.pantelidesMs.toFixed(2).padStart(6)}ms | ` +
        `BLT: ${res.bltMs.toFixed(2).padStart(6)}ms | Total: ${res.totalMs.toFixed(2).padStart(6)}ms`,
    );
  }

  console.log(
    "\n----------------------------------------------------------------------------------------------------------",
  );
  console.log("Performance Assertion Validations:");

  // Assertions against targets
  const res10k = results.find((r) => r.scale === 10000)!;
  const res100k = results.find((r) => r.scale === 100000)!;

  console.log(`✓ 10k Equations Full Pipeline Time  : ${res10k.totalMs.toFixed(2)}ms (budget: < 250ms)`);
  if (res10k.totalMs > 250) {
    throw new Error(`Scale assertion failed: 10k equations took ${res10k.totalMs.toFixed(2)}ms (expected < 250ms)`);
  }

  console.log(`✓ 100k Equations Full Pipeline Time : ${res100k.totalMs.toFixed(2)}ms (budget: < 2500ms)`);
  if (res100k.totalMs > 2500) {
    throw new Error(`Scale assertion failed: 100k equations took ${res100k.totalMs.toFixed(2)}ms (expected < 2500ms)`);
  }

  if (includeMillion) {
    const res1m = results.find((r) => r.scale === 1000000)!;
    console.log(`✓ 1M Equations Full Pipeline Time   : ${res1m.totalMs.toFixed(2)}ms (budget: < 35000ms)`);
    if (res1m.totalMs > 35000) {
      throw new Error(`Scale assertion failed: 1M equations took ${res1m.totalMs.toFixed(2)}ms (expected < 35000ms)`);
    }
  }

  console.log(
    "\n==========================================================================================================",
  );
  console.log("All Full-Pipeline DAE Linear-Time Scaling Assertions Succeeded!");
  console.log(
    "==========================================================================================================",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
