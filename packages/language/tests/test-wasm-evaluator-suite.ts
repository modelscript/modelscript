// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, Causality, EqKind, UnaryOp, VarType, Variability } from "../src/compiler/index.js";
import {
  Dual,
  buildSparseAdJacobian,
  evaluateArenaDualExpression,
  evaluateArenaRuntime,
  executeArenaStatements,
  executeArenaStatementsAsync,
  sparseJacobianToDense,
} from "../src/index.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function assertApprox(actual: number, expected: number, tol = 1e-6, msg = "") {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`Assertion failed: ${msg} - expected ${expected}, got ${actual}`);
  }
}

console.log("=== Testing WASM Evaluator Suite ===");

// ── Test 1: Expression Evaluator Parity ──
console.log("Test 1: Expression Evaluator parity across operators & built-ins...");
{
  const arena = new ArenaDAEBuilder();
  const xId = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 3.0);
  const yId = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 4.0);

  const env = new Float64Array(arena.interner.size);
  env[arena.getVarNameId(xId)] = 3.0;
  env[arena.getVarNameId(yId)] = 4.0;

  // x^2 + y^2
  const xExpr = arena.addNameExpr("x");
  const yExpr = arena.addNameExpr("y");
  const twoExpr = arena.addRealLiteral(2.0);
  const x2 = arena.addBinaryExpr(BinOp.Pow, xExpr, twoExpr);
  const y2 = arena.addBinaryExpr(BinOp.Pow, yExpr, twoExpr);
  const sumExpr = arena.addBinaryExpr(BinOp.Add, x2, y2);
  const sqrtExpr = arena.addCallExpr("sqrt", [sumExpr]);

  const result = evaluateArenaRuntime(arena, sqrtExpr, env);
  assertApprox(result, 5.0, 1e-9, "sqrt(3^2 + 4^2) === 5");

  // sin(x) + exp(y)
  const sinX = arena.addCallExpr("sin", [xExpr]);
  const expY = arena.addCallExpr("exp", [yExpr]);
  const sinExp = arena.addBinaryExpr(BinOp.Add, sinX, expY);
  const expectedSinExp = Math.sin(3.0) + Math.exp(4.0);
  assertApprox(evaluateArenaRuntime(arena, sinExp, env), expectedSinExp, 1e-9, "sin(x) + exp(y)");

  // IfElse
  const cond = arena.addBinaryExpr(BinOp.Gt, xExpr, yExpr);
  const ifElse = arena.addIfElseExpr(cond, xExpr, yExpr);
  assertApprox(evaluateArenaRuntime(arena, ifElse, env), 4.0, 1e-9, "if 3 > 4 then 3 else 4 === 4");

  console.log("  ✓ Expression evaluator passed for literals, power, transcendentals, and conditionals");
}

// ── Test 2: Dual Numbers & Forward Automatic Differentiation ──
console.log("Test 2: Dual Numbers and forward AD...");
{
  const arena = new ArenaDAEBuilder();
  const xId = arena.addVariable("x", VarType.Real, Variability.Continuous, Causality.Local, 2.0);
  const yId = arena.addVariable("y", VarType.Real, Variability.Continuous, Causality.Local, 3.0);
  const xNameId = arena.getVarNameId(xId);
  const yNameId = arena.getVarNameId(yId);

  // f(x, y) = x^3 - 4*x*y + y^2
  // df/dx = 3x^2 - 4y
  // df/dy = -4x + 2y
  const xExpr = arena.addNameExpr("x");
  const yExpr = arena.addNameExpr("y");
  const threeExpr = arena.addRealLiteral(3.0);
  const fourExpr = arena.addRealLiteral(4.0);
  const twoExpr = arena.addRealLiteral(2.0);

  const x3 = arena.addBinaryExpr(BinOp.Pow, xExpr, threeExpr);
  const fourX = arena.addBinaryExpr(BinOp.Mul, fourExpr, xExpr);
  const fourXY = arena.addBinaryExpr(BinOp.Mul, fourX, yExpr);
  const y2 = arena.addBinaryExpr(BinOp.Pow, yExpr, twoExpr);
  const diff1 = arena.addBinaryExpr(BinOp.Sub, x3, fourXY);
  const fExpr = arena.addBinaryExpr(BinOp.Add, diff1, y2);

  // Evaluate wrt x at (x=2, y=3)
  // f(2,3) = 8 - 24 + 9 = -7
  // df/dx(2,3) = 3(4) - 4(3) = 12 - 12 = 0
  const dualVarsX: (Dual | undefined)[] = new Array(arena.interner.size);
  dualVarsX[xNameId] = Dual.variable(2.0); // seed dx/dx = 1
  dualVarsX[yNameId] = Dual.constant(3.0);

  const resX = evaluateArenaDualExpression(arena, fExpr, dualVarsX);
  assert(resX !== null, "resX should not be null");
  assertApprox(resX.val, -7.0, 1e-9, "f(2,3) === -7");
  assertApprox(resX.dot, 0.0, 1e-9, "df/dx(2,3) === 0");

  // Evaluate wrt y at (x=2, y=3)
  // df/dy(2,3) = -4(2) + 2(3) = -8 + 6 = -2
  const dualVarsY: (Dual | undefined)[] = new Array(arena.interner.size);
  dualVarsY[xNameId] = Dual.constant(2.0);
  dualVarsY[yNameId] = Dual.variable(3.0); // seed dy/dy = 1

  const resY = evaluateArenaDualExpression(arena, fExpr, dualVarsY);
  assert(resY !== null, "resY should not be null");
  assertApprox(resY.val, -7.0, 1e-9, "f(2,3) === -7");
  assertApprox(resY.dot, -2.0, 1e-9, "df/dy(2,3) === -2");

  console.log("  ✓ Forward-mode dual AD passed exact partial derivative checks");
}

// ── Test 3: Statement Executor ──
console.log("Test 3: Procedural Algorithm Statement Execution...");
{
  const arena = new ArenaDAEBuilder();
  const aId = arena.addVariable("a", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const sId = arena.addVariable("sum", VarType.Real, Variability.Continuous, Causality.Local, 0.0);
  const aNameId = arena.getVarNameId(aId);
  const sNameId = arena.getVarNameId(sId);

  const aExpr = arena.addNameExpr("a");
  const sExpr = arena.addNameExpr("sum");
  const addExpr = arena.addBinaryExpr(BinOp.Add, sExpr, aExpr);

  // Algorithm:
  // sum = 0
  // for a in 1:10 loop
  //   sum = sum + a
  // end for
  const zeroExpr = arena.addRealLiteral(0.0);
  const tenExpr = arena.addRealLiteral(10.0);
  const oneExpr = arena.addRealLiteral(1.0);
  const rangeExpr = arena.addRangeExpr(oneExpr, -1, tenExpr);

  const startStmt = arena.stmtCount;
  arena.addAssignmentStmt(sExpr, zeroExpr);
  arena.addForStmt(aNameId, rangeExpr, 1);
  arena.addAssignmentStmt(sExpr, addExpr);
  const stmtCount = arena.stmtCount - startStmt;

  const values = new Float64Array(arena.interner.size);
  executeArenaStatements(arena, startStmt, stmtCount, values);

  assertApprox(values[sNameId], 55.0, 1e-9, "sum(1..10) === 55");

  // Also test async executor
  values.fill(0);
  await executeArenaStatementsAsync(arena, startStmt, stmtCount, values);
  assertApprox(values[sNameId], 55.0, 1e-9, "async sum(1..10) === 55");

  console.log("  ✓ Algorithm statement executor passed synchronous and async for-loops");
}

// ── Test 4: Sparse AD Jacobian Computation ──
console.log("Test 4: Sparse AD Jacobian Construction & Graph Coloring...");
{
  const arena = new ArenaDAEBuilder();
  const xName = "x";
  const yName = "y";
  arena.addVariable(xName, VarType.Real, Variability.Continuous, Causality.Local, 1.0);
  arena.addVariable(yName, VarType.Real, Variability.Continuous, Causality.Local, 2.0);

  // Dynamic equations:
  // der(x) = -2*x + 3*y
  // der(y) = 4*x - 5*y
  const derX = arena.addDerExpr(arena.addNameExpr("x"));
  const derY = arena.addDerExpr(arena.addNameExpr("y"));

  const two = arena.addRealLiteral(2.0);
  const three = arena.addRealLiteral(3.0);
  const four = arena.addRealLiteral(4.0);
  const five = arena.addRealLiteral(5.0);

  const term1 = arena.addUnaryExpr(UnaryOp.Negate, arena.addBinaryExpr(BinOp.Mul, two, arena.addNameExpr("x")));
  const term2 = arena.addBinaryExpr(BinOp.Mul, three, arena.addNameExpr("y"));
  const rhs1 = arena.addBinaryExpr(BinOp.Add, term1, term2);

  const term3 = arena.addBinaryExpr(BinOp.Mul, four, arena.addNameExpr("x"));
  const term4 = arena.addBinaryExpr(BinOp.Mul, five, arena.addNameExpr("y"));
  const rhs2 = arena.addBinaryExpr(BinOp.Sub, term3, term4);

  arena.addEquation(EqKind.Simple, derX, rhs1);
  arena.addEquation(EqKind.Simple, derY, rhs2);

  const sparseBuilder = buildSparseAdJacobian(arena, [xName, yName]);
  assert(sparseBuilder !== null, "Sparse Jacobian builder returned null");

  const jac = sparseBuilder.evaluator(0, [1.0, 2.0]);
  const dense = sparseJacobianToDense(jac);

  // Analytic Jacobian:
  // [ -2,  3 ]
  // [  4, -5 ]
  assertApprox(dense[0][0], -2.0, 1e-9, "J[0][0] === -2");
  assertApprox(dense[0][1], 3.0, 1e-9, "J[0][1] === 3");
  assertApprox(dense[1][0], 4.0, 1e-9, "J[1][0] === 4");
  assertApprox(dense[1][1], -5.0, 1e-9, "J[1][1] === -5");

  console.log("  ✓ Sparse AD Jacobian correctly colored columns and matched analytic Jacobian");
}

console.log("=== All WASM Evaluator Suite Tests Passed Cleanly ===");
