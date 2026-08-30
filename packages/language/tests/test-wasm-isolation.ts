// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { ArenaDAEBuilder, BinOp, EqKind, ExprKind, VarType, Variability } from "../src/compiler/index.js";
import {
  WasmIsolationEngine,
  isExplicitlySolvableArena,
  isolateSymbolicallyArena,
  tryOptimizeLoopWithGroebner,
} from "../src/runtime/wasm_isolation.js";

console.log("=== Testing WASM Symbolic Equation Isolation & Loop Optimization ===");

// 1. Test Explicit Solvability
{
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);

  const xExpr = arena.addNameExpr("x");
  const yExpr = arena.addNameExpr("y");
  const twoExpr = arena.addRealLiteral(2.0);
  const rhsExpr = arena.addBinaryExpr(BinOp.Add, yExpr, twoExpr); // y + 2.0

  // x = y + 2.0
  const eqIdx = arena.addEquation(EqKind.Simple, xExpr, rhsExpr);

  const isolatedRhs = isExplicitlySolvableArena(arena, eqIdx, xIdx);
  assert.strictEqual(isolatedRhs, rhsExpr, "Explicit form 'x = y + 2' should isolate to 'y + 2'");

  // y + 2.0 = x
  const eqIdx2 = arena.addEquation(EqKind.Simple, rhsExpr, xExpr);
  const isolatedLhs = isExplicitlySolvableArena(arena, eqIdx2, xIdx);
  assert.strictEqual(isolatedLhs, rhsExpr, "Explicit form 'y + 2 = x' should isolate to 'y + 2'");

  console.log("✓ Explicit form isolation passed");
}

// 2. Test Linear Equation Isolation (A*x + B = 0 -> x = -B/A)
{
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const xExpr = arena.addNameExpr("x");
  const three = arena.addRealLiteral(3.0);
  const six = arena.addRealLiteral(6.0);

  // 3.0 * x - 6.0 = 0.0
  const lhs = arena.addBinaryExpr(BinOp.Sub, arena.addBinaryExpr(BinOp.Mul, three, xExpr), six);
  const zero = arena.addRealLiteral(0.0);
  const eqIdx = arena.addEquation(EqKind.Simple, lhs, zero);

  const isolatedExpr = isolateSymbolicallyArena(arena, eqIdx, xIdx);
  assert.ok(isolatedExpr !== -1, "Linear equation 3*x - 6 = 0 should be symbolically isolatable");

  console.log("✓ Linear isolation (A*x + B = 0) passed");
}

// 3. Test Nonlinear Single-Occurrence Inversion: exp(2*x) = 10 -> 2*x = log(10) -> x = log(10)/2
{
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const xExpr = arena.addNameExpr("x");
  const two = arena.addRealLiteral(2.0);
  const ten = arena.addRealLiteral(10.0);

  // exp(2.0 * x) = 10.0
  const twoX = arena.addBinaryExpr(BinOp.Mul, two, xExpr);
  const expTwoX = arena.addCallExpr("exp", [twoX]);
  const eqIdx = arena.addEquation(EqKind.Simple, expTwoX, ten);

  const isolatedExpr = isolateSymbolicallyArena(arena, eqIdx, xIdx);
  assert.ok(isolatedExpr !== -1, "exp(2*x) = 10 should be isolated to x = log(10)/2");

  console.log("✓ Elementary function peeling (exp/log) passed");
}

// 4. Test Trigonometric Inversion: sin(x) = y -> x = asin(y)
{
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const xExpr = arena.addNameExpr("x");
  const yExpr = arena.addNameExpr("y");

  const sinX = arena.addCallExpr("sin", [xExpr]);
  const eqIdx = arena.addEquation(EqKind.Simple, sinX, yExpr);

  const isolatedExpr = isolateSymbolicallyArena(arena, eqIdx, xIdx);
  assert.ok(isolatedExpr !== -1, "sin(x) = y should be isolated to x = asin(y)");
  assert.strictEqual(arena.getExprKind(isolatedExpr), ExprKind.Call);
  const funcName = arena.interner.resolve(arena.getExprData1(isolatedExpr));
  assert.strictEqual(funcName, "asin", "Isolated function should be asin");

  console.log("✓ Trigonometric peeling (sin/asin) passed");
}

// 5. Test Algebraic Loop Optimization with Gröbner Basis
{
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);

  const xExpr = arena.addNameExpr("x");
  const yExpr = arena.addNameExpr("y");
  const one = arena.addRealLiteral(1.0);
  const two = arena.addRealLiteral(2.0);

  // Eq 1: x + y = 2
  const eq1 = arena.addEquation(EqKind.Simple, arena.addBinaryExpr(BinOp.Add, xExpr, yExpr), two);

  // Eq 2: x - y = 0
  const eq2 = arena.addEquation(EqKind.Simple, arena.addBinaryExpr(BinOp.Sub, xExpr, yExpr), arena.addRealLiteral(0.0));

  const blocks = tryOptimizeLoopWithGroebner(arena, [eq1, eq2], [xIdx, yIdx]);
  assert.ok(blocks && blocks.length > 0, "Gröbner basis should triangularize linear algebraic loop");
  console.log(`✓ Gröbner triangularization produced ${blocks.length} execution block(s)`);
}

// 6. Test WasmIsolationEngine wrapper instance
{
  const engine = new WasmIsolationEngine();
  const arena = new ArenaDAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const xExpr = arena.addNameExpr("x");
  const five = arena.addRealLiteral(5.0);
  const eqIdx = arena.addEquation(EqKind.Simple, xExpr, five);

  const res = engine.isolate(arena, eqIdx, xIdx);
  assert.strictEqual(res, five, "WasmIsolationEngine wrapper isolate should succeed");
  console.log("✓ WasmIsolationEngine wrapper passed");
}

console.log("=== All WASM Symbolic Isolation & Optimization Tests Passed Cleanly ===");
