// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArenaDAEBuilder,
  BinOp,
  Causality,
  EqKind,
  ExprKind,
  UnaryOp,
  Variability,
  VarType,
} from "../src/runtime/wasm_dae.js";
import { evaluateConstantArenaExpression, foldArenaConstants } from "../src/runtime/wasm_fold.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertApprox(actual: number, expected: number, tol = 1e-4, message = ""): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`Assertion failed: ${message} - expected ${expected}, got ${actual}`);
  }
}

console.log("=== Testing WASM Constant Folding & Algebraic Reduction Suite ===");

// ── Test 1: Arithmetic Expression Constant Evaluation ──
console.log("Test 1: Arithmetic & built-in math constant folding...");
{
  const arena = new ArenaDAEBuilder();

  // (2.0 * 3.0) + 4.0 = 10.0
  const two = arena.addRealLiteral(2.0);
  const three = arena.addRealLiteral(3.0);
  const four = arena.addRealLiteral(4.0);
  const mul = arena.addBinaryExpr(BinOp.Mul, two, three);
  const expr1 = arena.addBinaryExpr(BinOp.Add, mul, four);

  const res1 = evaluateConstantArenaExpression(arena, expr1);
  assert(typeof res1 === "number", "res1 should evaluate to a number");
  assertApprox(res1 as number, 10.0, 1e-6, "(2 * 3) + 4 === 10");

  // -sqrt(16.0) = -4.0
  const sixteen = arena.addRealLiteral(16.0);
  const sqrtCall = arena.addCallExpr("sqrt", [sixteen]);
  const negExpr = arena.addUnaryExpr(UnaryOp.Negate, sqrtCall);

  const res2 = evaluateConstantArenaExpression(arena, negExpr);
  assert(typeof res2 === "number", "res2 should evaluate to a number");
  assertApprox(res2 as number, -4.0, 1e-6, "-sqrt(16) === -4");

  console.log("  ✓ Direct arithmetic and built-in math function evaluation passed");
}

// ── Test 2: Relational, Boolean Logic, and IfElse Pruning ──
console.log("Test 2: Relational logic and IfElse branch pruning...");
{
  const arena = new ArenaDAEBuilder();

  // (10.0 > 5.0) && (3.0 <= 4.0) === true
  const ten = arena.addRealLiteral(10.0);
  const five = arena.addRealLiteral(5.0);
  const three = arena.addRealLiteral(3.0);
  const four = arena.addRealLiteral(4.0);

  const cmp1 = arena.addBinaryExpr(BinOp.Gt, ten, five);
  const cmp2 = arena.addBinaryExpr(BinOp.Lte, three, four);
  const andExpr = arena.addBinaryExpr(BinOp.And, cmp1, cmp2);

  const resLogic = evaluateConstantArenaExpression(arena, andExpr);
  assert(resLogic === true, "(10 > 5) && (3 <= 4) === true");

  // if (10 > 5) then 100.0 else 200.0 -> 100.0
  const oneHundred = arena.addRealLiteral(100.0);
  const twoHundred = arena.addRealLiteral(200.0);
  const ifElseExpr = arena.addIfElseExpr(cmp1, oneHundred, twoHundred);

  const resIfElse = evaluateConstantArenaExpression(arena, ifElseExpr);
  assertApprox(resIfElse as number, 100.0, 1e-6, "if (10 > 5) then 100 else 200 === 100");

  console.log("  ✓ Relational comparisons, boolean logic, and branch pruning passed");
}

// ── Test 3: Cascading Multi-Pass DAE Parameter & Equation Folding ──
console.log("Test 3: Multi-pass cascading fixed-point parameter & equation folding...");
{
  const arena = new ArenaDAEBuilder();

  // Variables:
  // parameter Real a; (binding: 2.0)
  // parameter Real b; (binding: a + 3.0)
  // parameter Real c; (binding: b * 4.0)
  const aIdx = arena.addVariable("a", VarType.Real, Variability.Parameter, Causality.Local, 0.0);
  const bIdx = arena.addVariable("b", VarType.Real, Variability.Parameter, Causality.Local, 0.0);
  const cIdx = arena.addVariable("c", VarType.Real, Variability.Parameter, Causality.Local, 0.0);

  const two = arena.addRealLiteral(2.0);
  const three = arena.addRealLiteral(3.0);
  const four = arena.addRealLiteral(4.0);

  const aExpr = arena.addNameExpr("a");
  const bExpr = arena.addNameExpr("b");

  const bBinding = arena.addBinaryExpr(BinOp.Add, aExpr, three);
  const cBinding = arena.addBinaryExpr(BinOp.Mul, bExpr, four);

  arena.setVarExpression(aIdx, two);
  arena.setVarExpression(bIdx, bBinding);
  arena.setVarExpression(cIdx, cBinding);

  // Add equation: y = c + 10.0
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const yExpr = arena.addNameExpr("y");
  const cNameExpr = arena.addNameExpr("c");
  const ten = arena.addRealLiteral(10.0);
  const eqRhs = arena.addBinaryExpr(BinOp.Add, cNameExpr, ten);
  const eqIdx = arena.addEquation(EqKind.Simple, yExpr, eqRhs);

  const iterations = foldArenaConstants(arena);
  assert(iterations > 0, "iterations should be > 0");

  // Check folded start values:
  // a = 2.0
  // b = 2.0 + 3.0 = 5.0
  // c = 5.0 * 4.0 = 20.0
  assertApprox(arena.getVarStartValue(aIdx), 2.0, 1e-6, "a start value === 2.0");
  assertApprox(arena.getVarStartValue(bIdx), 5.0, 1e-6, "b start value === 5.0");
  assertApprox(arena.getVarStartValue(cIdx), 20.0, 1e-6, "c start value === 20.0");

  // Check folded equation RHS: y = 20.0 + 10.0 = 30.0
  const foldedRhsId = arena.getEqRhs(eqIdx);
  assert(arena.getExprKind(foldedRhsId) === ExprKind.RealLiteral, "equation RHS should fold to a RealLiteral");
  assertApprox(arena.getExprRealValue(foldedRhsId), 30.0, 1e-6, "equation RHS === 30.0");

  console.log("  ✓ Cascading fixed-point iteration resolved parameters a=2, b=5, c=20 and equation y=30");
}

console.log("=== All WASM Constant Folding Tests Passed Cleanly ===");
