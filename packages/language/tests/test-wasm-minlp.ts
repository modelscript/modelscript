// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

import assert from "node:assert";
import type { ImplicitInitBlock } from "../src/compiler/arena-init.js";
import { ArenaDAEBuilder, BinOp, ExprKind, VarType } from "../src/runtime/wasm_dae.js";
import { freezeAndSolve } from "../src/runtime/wasm_minlp.js";

console.log("Testing WASM MINLP Heuristics (Freeze-and-Solve)...");

// Test 1: Mixed-Integer Initialization Block with If-Else Discrete Mode Selection
{
  const arena = new ArenaDAEBuilder();
  // Continuous variable: x (Real)
  // Discrete variable: mode (Integer)
  // Equations:
  //   1) x == 10.0 - 2.0 * mode
  //   2) mode == if x > 5.0 then 2 else 1
  // Equilibrium: mode = 2, x = 6.0

  arena.addVariable("x", VarType.Real);
  arena.addVariable("mode", VarType.Integer);

  const xExpr = arena.addNameExpr("x");
  const modeExpr = arena.addNameExpr("mode");

  // Eq 1: x == 10.0 - 2.0 * mode
  const tenExpr = arena.addRealLiteral(10.0);
  const twoExpr = arena.addRealLiteral(2.0);
  const twoMode = arena.addExpression(ExprKind.Binary, BinOp.Mul, twoExpr, modeExpr);
  const rhs1 = arena.addExpression(ExprKind.Binary, BinOp.Sub, tenExpr, twoMode);

  // Eq 2: mode == if x > 5.0 then 2 else 1
  const fiveExpr = arena.addRealLiteral(5.0);
  const condExpr = arena.addExpression(ExprKind.Binary, BinOp.Gt, xExpr, fiveExpr);
  const twoInt = arena.addIntLiteral(2);
  const oneInt = arena.addIntLiteral(1);
  const ifElseExpr = arena.addExpression(ExprKind.IfElse, condExpr, twoInt, oneInt);

  const block: ImplicitInitBlock = {
    equations: [
      { lhs: xExpr, rhs: rhs1 },
      { lhs: modeExpr, rhs: ifElseExpr },
    ],
    unknowns: ["x", "mode"],
    hasDiscreteVars: true,
  };

  const env = new Map<string, number>([
    ["x", 0.0],
    ["mode", 1], // Initial guess: mode = 1
  ]);
  const discreteSet = new Set<string>(["mode"]);

  const res = freezeAndSolve(block, env, discreteSet, arena, 10, 30, 1e-8);
  assert.ok(res.converged, "MINLP solver should converge");
  const finalX = res.values.get("x")!;
  const finalMode = res.values.get("mode")!;

  assert.ok(Math.abs(finalX - 6.0) < 1e-4, `Expected x ≈ 6.0, got ${finalX}`);
  assert.strictEqual(finalMode, 2, `Expected mode = 2, got ${finalMode}`);
  console.log("  ✔ Mixed-integer freezeAndSolve converged to global equilibrium (x=6, mode=2)");
}

console.log("=== All WASM MINLP Tests Passed Cleanly ===");
