// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BinOp,
  Causality,
  DAEBuilder,
  EqKind,
  ExprKind,
  UnaryOp,
  VarType,
  Variability,
  saturateArenaEquations,
  simplifyArenaExpr,
} from "@modelscript/runtime";
import assert from "node:assert";

async function main() {
  console.log("=== Testing E-Graph-Style Algebraic Simplifier & Equality Saturation ===");

  const dae = new DAEBuilder();

  const xName = dae.addExpression(ExprKind.Name, dae.interner.intern("x"));
  const yName = dae.addExpression(ExprKind.Name, dae.interner.intern("y"));
  const zName = dae.addExpression(ExprKind.Name, dae.interner.intern("z"));
  const wName = dae.addExpression(ExprKind.Name, dae.interner.intern("w"));

  // 1. Direct Expression Simplification Tests
  console.log("1. Testing algebraic identities...");

  // (x + 0) * 1 => x
  const xPlusZero = dae.addBinaryExpr(BinOp.Add, xName, dae.addRealLiteral(0.0));
  const expr1 = dae.addBinaryExpr(BinOp.Mul, xPlusZero, dae.addRealLiteral(1.0));
  const simp1 = simplifyArenaExpr(dae, expr1);
  assert.strictEqual(simp1, xName, "(x + 0) * 1 should simplify directly to x");

  // -(-y) + (0 * z) => y
  const negNegY = dae.addUnaryExpr(UnaryOp.Negate, dae.addUnaryExpr(UnaryOp.Negate, yName));
  const zeroMulZ = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(0.0), zName);
  const expr2 = dae.addBinaryExpr(BinOp.Add, negNegY, zeroMulZ);
  const simp2 = simplifyArenaExpr(dae, expr2);
  assert.strictEqual(simp2, yName, "-(-y) + (0 * z) should simplify directly to y");

  // Constant folding: (2.0 * 3.0) + w => 6.0 + w
  const twoMulThree = dae.addBinaryExpr(BinOp.Mul, dae.addRealLiteral(2.0), dae.addRealLiteral(3.0));
  const expr3 = dae.addBinaryExpr(BinOp.Add, twoMulThree, wName);
  const simp3 = simplifyArenaExpr(dae, expr3);
  assert.strictEqual(dae.getExprKind(simp3), ExprKind.Binary);
  assert.strictEqual(dae.getExprData1(simp3), BinOp.Add);
  const leftChild = dae.getExprLeft(simp3);
  assert.strictEqual(dae.getExprKind(leftChild), ExprKind.RealLiteral);
  assert.strictEqual(dae.getExprRealValue(leftChild), 6.0, "2.0 * 3.0 should fold to 6.0");
  assert.strictEqual(dae.getExprRight(simp3), wName);

  // Cancellation: x - x => 0.0, x / x => 1.0
  const xSubX = dae.addBinaryExpr(BinOp.Sub, xName, xName);
  const simpSub = simplifyArenaExpr(dae, xSubX);
  assert.strictEqual(dae.getExprKind(simpSub), ExprKind.RealLiteral);
  assert.strictEqual(dae.getExprRealValue(simpSub), 0.0, "x - x should simplify to 0.0");

  const xDivX = dae.addBinaryExpr(BinOp.Div, xName, xName);
  const simpDiv = simplifyArenaExpr(dae, xDivX);
  assert.strictEqual(dae.getExprKind(simpDiv), ExprKind.RealLiteral);
  assert.strictEqual(dae.getExprRealValue(simpDiv), 1.0, "x / x should simplify to 1.0");

  console.log("   [PASSED] Expression identities, constant folding, and cancellations verified.");

  // 2. Full Arena Saturation Test
  console.log("2. Testing full DAE arena equality saturation...");

  const dae2 = new DAEBuilder();
  const xVar = dae2.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  const y1Var = dae2.addVariable("y1", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const y2Var = dae2.addVariable("y2", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const derXVar = dae2.addVariable("der(x)", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const aVar = dae2.addVariable("a", VarType.Real, Variability.Parameter, Causality.Local, 5.0);

  // Set variable binding: a = 2.5 * 4.0 (should fold to 10.0)
  const aBinding = dae2.addBinaryExpr(BinOp.Mul, dae2.addRealLiteral(2.5), dae2.addRealLiteral(4.0));
  dae2.setVarExpression(aVar, aBinding);

  const xExpr = dae2.addNameExpr("x");
  const y1Expr = dae2.addNameExpr("y1");
  const y2Expr = dae2.addNameExpr("y2");
  const derXExpr = dae2.addNameExpr("der(x)");
  const aExpr = dae2.addNameExpr("a");

  // Eq 0: y1 = (x + 0.0) * 1.0
  const eq0Rhs = dae2.addBinaryExpr(
    BinOp.Mul,
    dae2.addBinaryExpr(BinOp.Add, xExpr, dae2.addRealLiteral(0.0)),
    dae2.addRealLiteral(1.0),
  );
  dae2.addEquation(EqKind.Simple, y1Expr, eq0Rhs);

  // Eq 1: y2 = -(-y1) + (0.0 * a)
  const eq1Rhs = dae2.addBinaryExpr(
    BinOp.Add,
    dae2.addUnaryExpr(UnaryOp.Negate, dae2.addUnaryExpr(UnaryOp.Negate, y1Expr)),
    dae2.addBinaryExpr(BinOp.Mul, dae2.addRealLiteral(0.0), aExpr),
  );
  dae2.addEquation(EqKind.Simple, y2Expr, eq1Rhs);

  // Eq 2: der(x) = (2.0 * 3.0) + y2
  const eq2Rhs = dae2.addBinaryExpr(
    BinOp.Add,
    dae2.addBinaryExpr(BinOp.Mul, dae2.addRealLiteral(2.0), dae2.addRealLiteral(3.0)),
    y2Expr,
  );
  dae2.addEquation(EqKind.Simple, derXExpr, eq2Rhs);

  // Run saturation
  const stats = saturateArenaEquations(dae2);
  console.log("   Saturation Stats:", stats);

  assert(stats.identitiesFolded >= 4, `Expected at least 4 identities folded, got ${stats.identitiesFolded}`);
  assert(stats.constantsFolded >= 2, `Expected at least 2 constants folded, got ${stats.constantsFolded}`);
  assert.strictEqual(stats.equationsSimplified, 3, "All 3 equations should be simplified");

  // Verify simplified equation forms
  const resEq0Rhs = dae2.getEqRhs(0);
  assert.strictEqual(resEq0Rhs, xExpr, "Eq 0 RHS should be simplified to x");

  const resEq1Rhs = dae2.getEqRhs(1);
  assert.strictEqual(resEq1Rhs, y1Expr, "Eq 1 RHS should be simplified to y1");

  const resEq2Rhs = dae2.getEqRhs(2);
  assert.strictEqual(dae2.getExprKind(resEq2Rhs), ExprKind.Binary);
  const cChild = dae2.getExprLeft(resEq2Rhs);
  assert.strictEqual(dae2.getExprRealValue(cChild), 6.0, "Eq 2 constant subexpression should fold to 6.0");
  assert.strictEqual(dae2.getExprRight(resEq2Rhs), y2Expr, "Eq 2 right child should remain y2");

  // Verify binding expression
  const resABinding = dae2.getVarExpression(aVar);
  assert.strictEqual(dae2.getExprKind(resABinding), ExprKind.RealLiteral);
  assert.strictEqual(dae2.getExprRealValue(resABinding), 10.0, "Parameter 'a' binding should fold to 10.0");

  console.log("   [PASSED] DAE arena equality saturation successfully rewritten equations & bindings.");
  console.log("=== All E-Graph Equality Saturation tests passed! ===");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
