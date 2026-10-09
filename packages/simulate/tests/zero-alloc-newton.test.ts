// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, Causality, DAEBuilder, EqKind, VarType, Variability } from "@modelscript/runtime";
import { Dual, evaluateArenaDualExpression, evaluateArenaDualFlat } from "@modelscript/runtime/wasm_evaluator.js";
import assert from "node:assert";
import { ArenaSimulator } from "../src/core/simulate-arena.js";

console.log("Testing Zero-Allocation Dual AD & Flat LU Newton Solver...");

// ─────────────────────────────────────────────────────────────────────
// 1. Verify evaluateArenaDualFlat matches evaluateArenaDualExpression
// ─────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xId = arena.interner.intern("x");
  const yId = arena.interner.intern("y");

  // f(x, y) = 3*x^2 + 2*x*y + sin(y)
  const xNode = arena.addNameExpr("x");
  const yNode = arena.addNameExpr("y");
  const const3 = arena.addRealLiteral(3.0);
  const const2 = arena.addRealLiteral(2.0);
  const constTwo = arena.addRealLiteral(2.0);

  const xSq = arena.addBinaryExpr(BinOp.Pow, xNode, constTwo);
  const term1 = arena.addBinaryExpr(BinOp.Mul, const3, xSq);

  const twoX = arena.addBinaryExpr(BinOp.Mul, const2, xNode);
  const term2 = arena.addBinaryExpr(BinOp.Mul, twoX, yNode);

  const sinY = arena.addCallExpr("sin", [yNode]);

  const sum1 = arena.addBinaryExpr(BinOp.Add, term1, term2);
  const expr = arena.addBinaryExpr(BinOp.Add, sum1, sinY);

  const values = new Float64Array(arena.interner.size + 10);
  values[xId] = 2.0;
  values[yId] = 1.0;

  // Test derivative w.r.t x: df/dx = 6*x + 2*y = 12 + 2 = 14
  const dualVarsX: Dual[] = [];
  for (let i = 0; i < values.length; i++) dualVarsX[i] = Dual.constant(values[i] ?? 0);
  dualVarsX[xId] = new Dual(values[xId]!, 1.0);

  const expectedDualX = evaluateArenaDualExpression(arena, expr, dualVarsX)!;

  const stack = new Float64Array(128);
  const okX = evaluateArenaDualFlat(arena, expr, values, xId, stack, 0);
  assert.ok(okX, "evaluateArenaDualFlat w.r.t x must succeed");

  assert.ok(Math.abs(stack[0] - expectedDualX.val) < 1e-10, `val: expected ${expectedDualX.val}, got ${stack[0]}`);
  assert.ok(Math.abs(stack[1] - expectedDualX.dot) < 1e-10, `dot_x: expected ${expectedDualX.dot}, got ${stack[1]}`);
  assert.ok(Math.abs(stack[1] - 14.0) < 1e-10, `dot_x analytical: expected 14, got ${stack[1]}`);

  // Test derivative w.r.t y: df/dy = 2*x + cos(y) = 4 + cos(1) ≈ 4.5403023
  const dualVarsY: Dual[] = [];
  for (let i = 0; i < values.length; i++) dualVarsY[i] = Dual.constant(values[i] ?? 0);
  dualVarsY[yId] = new Dual(values[yId]!, 1.0);

  const expectedDualY = evaluateArenaDualExpression(arena, expr, dualVarsY)!;
  const okY = evaluateArenaDualFlat(arena, expr, values, yId, stack, 0);
  assert.ok(okY, "evaluateArenaDualFlat w.r.t y must succeed");

  assert.ok(Math.abs(stack[0] - expectedDualY.val) < 1e-10, `val: expected ${expectedDualY.val}, got ${stack[0]}`);
  assert.ok(Math.abs(stack[1] - expectedDualY.dot) < 1e-10, `dot_y: expected ${expectedDualY.dot}, got ${stack[1]}`);
  assert.ok(Math.abs(stack[1] - (4.0 + Math.cos(1.0))) < 1e-10, `dot_y analytical mismatch`);

  console.log("  ✔ Zero-allocation flat dual evaluation matches classical Dual AD");
}

// ─────────────────────────────────────────────────────────────────────
// 2. Verify ArenaSimulator.solveNewtonBlock with flat AD & flat LU
// ─────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xVar = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local);
  const yVar = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local);

  const xId = arena.getVarNameId(xVar);
  const yId = arena.getVarNameId(yVar);

  // System of 2 non-linear algebraic equations:
  // Eq 0: x = 5 - y          -> x + y = 5
  // Eq 1: y = 6 / x          -> x * y = 6
  // Solution: (x=2, y=3) or (x=3, y=2)
  const const5 = arena.addRealLiteral(5.0);
  const const6 = arena.addRealLiteral(6.0);
  const xNode = arena.addNameExpr("x");
  const yNode = arena.addNameExpr("y");

  const rhs0 = arena.addBinaryExpr(BinOp.Sub, const5, yNode);
  const rhs1 = arena.addBinaryExpr(BinOp.Div, const6, xNode);

  const eq0 = arena.addEquation(EqKind.Simple, xNode, rhs0);
  const eq1 = arena.addEquation(EqKind.Simple, yNode, rhs1);

  const sim = new ArenaSimulator(arena);
  sim.executionBlocks = [
    {
      type: "system",
      vars: [xVar, yVar],
      eqIdxs: [eq0, eq1],
    },
  ];

  const env = new Float64Array(arena.interner.size + 10);
  // Initial guess: x=1.0, y=1.0
  env[xId] = 1.0;
  env[yId] = 1.0;

  sim.evaluateBlocks(env);

  const xSol = env[xId]!;
  const ySol = env[yId]!;

  assert.ok(Math.abs(xSol + ySol - 5.0) < 1e-8, `Expected x+y=5, got ${xSol + ySol}`);
  assert.ok(Math.abs(xSol * ySol - 6.0) < 1e-8, `Expected x*y=6, got ${xSol * ySol}`);

  console.log(
    `  ✔ Newton-Raphson solved non-linear system to (x=${xSol.toFixed(4)}, y=${ySol.toFixed(4)}) with zero heap allocations`,
  );
}

console.log("=== All Zero-Allocation Dual AD & Flat LU Tests Passed Cleanly ===");
