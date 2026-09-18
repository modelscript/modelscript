// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/wasm_dae.js";
import { evaluateArenaRuntime } from "../src/wasm_evaluator.js";
import { buildInitBLT, solveInitialEquationsArena } from "../src/wasm_init.js";

console.log("Testing DAE Initialization: Multi-Tier BLT, Homotopy & sBB...");

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Explicit Block Solving via BLT Decomposition
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);
  const zIdx = arena.addVariable("z", VarType.Real, Variability.Continuous);

  const eX = arena.addName(arena.interner.intern("x"));
  const eY = arena.addName(arena.interner.intern("y"));
  const eZ = arena.addName(arena.interner.intern("z"));

  const ten = arena.addRealLiteral(10.0);
  const five = arena.addRealLiteral(5.0);
  const two = arena.addRealLiteral(2.0);

  // x = 10.0
  arena.addEquation(EqKind.InitialSimple, eX, ten);
  // y = x + 5.0
  arena.addEquation(EqKind.InitialSimple, eY, arena.addBinaryExpr(BinOp.Add, eX, five));
  // z = y * 2.0
  arena.addEquation(EqKind.InitialSimple, eZ, arena.addBinaryExpr(BinOp.Mul, eY, two));

  const blt = buildInitBLT(arena);
  assert.strictEqual(blt.blocks.length, 3, "Should have 3 blocks");
  assert.strictEqual(blt.blocks[0]!.type, "explicit");
  assert.strictEqual(blt.blocks[1]!.type, "explicit");
  assert.strictEqual(blt.blocks[2]!.type, "explicit");

  const values = new Float64Array(arena.interner.size + 16);
  const res = solveInitialEquationsArena(arena, values);

  assert.ok(res.converged, "Solver should converge");
  const xVal = res.valuesByStringId[arena.interner.intern("x")]!;
  const yVal = res.valuesByStringId[arena.interner.intern("y")]!;
  const zVal = res.valuesByStringId[arena.interner.intern("z")]!;

  assert.ok(Math.abs(xVal - 10.0) < 1e-6, `Expected x=10, got ${xVal}`);
  assert.ok(Math.abs(yVal - 15.0) < 1e-6, `Expected y=15, got ${yVal}`);
  assert.ok(Math.abs(zVal - 30.0) < 1e-6, `Expected z=30, got ${zVal}`);
  console.log("  ✔ Explicit Block Solving via BLT Decomposition passed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Modelica Operator Homotopy: homotopy(actual, simplified)
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const pIdx = arena.addVariable("p", VarType.Real, Variability.Continuous);
  const eP = arena.addName(arena.interner.intern("p"));

  // actual: p^2 - 9.0 (root at 3.0)
  // simplified: p - 3.0
  const three = arena.addRealLiteral(3.0);
  const nine = arena.addRealLiteral(9.0);
  const two = arena.addRealLiteral(2.0);
  const pSquared = arena.addBinaryExpr(BinOp.Pow, eP, two);
  const actual = arena.addBinaryExpr(BinOp.Sub, pSquared, nine);
  const simplified = arena.addBinaryExpr(BinOp.Sub, eP, three);

  // equation: homotopy(actual, simplified) = 0
  const zero = arena.addRealLiteral(0.0);
  const hCall = arena.addCallExpr("homotopy", [actual, simplified]);
  arena.addEquation(EqKind.InitialSimple, hCall, zero);

  // Test evaluator interpolation:
  // at lambda = 0: homotopy evaluates to simplified
  const testValues = new Float64Array(arena.interner.size + 16);
  testValues[arena.interner.intern("p")] = 5.0; // simplified is 5 - 3 = 2, actual is 25 - 9 = 16

  arena.homotopyLambda = 0.0;
  const valAtZero = evaluateArenaRuntime(arena, hCall, testValues);
  assert.ok(Math.abs((valAtZero as number) - 2.0) < 1e-6, `Expected 2.0 at lambda=0, got ${valAtZero}`);

  arena.homotopyLambda = 1.0;
  const valAtOne = evaluateArenaRuntime(arena, hCall, testValues);
  assert.ok(Math.abs((valAtOne as number) - 16.0) < 1e-6, `Expected 16.0 at lambda=1, got ${valAtOne}`);

  arena.homotopyLambda = 0.5;
  const valAtHalf = evaluateArenaRuntime(arena, hCall, testValues);
  assert.ok(Math.abs((valAtHalf as number) - 9.0) < 1e-6, `Expected 9.0 at lambda=0.5, got ${valAtHalf}`);
  arena.homotopyLambda = undefined;

  // Now solve initial equations with homotopy
  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("p")] = 1.0; // starting guess far from 3.0
  const res = solveInitialEquationsArena(arena, initValues);

  assert.ok(res.converged, "Operator Homotopy solver should converge");
  const pSolved = res.valuesByStringId[arena.interner.intern("p")]!;
  assert.ok(Math.abs(pSolved - 3.0) < 1e-4, `Expected p ≈ 3.0, got ${pSolved}`);
  console.log("  ✔ Modelica Operator Homotopy continuation passed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Armijo Line Search on Steep Nonlinear Equation
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  const eX = arena.addName(arena.interner.intern("x"));

  // Equation: x^5 - 32.0 = 0 (Root is 2.0)
  const five = arena.addRealLiteral(5.0);
  const thirtyTwo = arena.addRealLiteral(32.0);
  const xFifth = arena.addBinaryExpr(BinOp.Pow, eX, five);
  arena.addEquation(EqKind.InitialSimple, xFifth, thirtyTwo);

  // Start with a large initial guess x = 10.0 (where x^5 = 100,000; steep gradient would cause pure Newton to overshoot drastically)
  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("x")] = 8.0;

  const res = solveInitialEquationsArena(arena, initValues);
  assert.ok(res.converged, "Armijo damped Newton should converge without blowing up");
  const xSolved = res.valuesByStringId[arena.interner.intern("x")]!;
  assert.ok(Math.abs(xSolved - 2.0) < 1e-4, `Expected x ≈ 2.0, got ${xSolved}`);
  console.log("  ✔ Armijo Backtracking Line Search globalization passed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: sBB Global Fallback on Bounded Nonlinear System
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  arena.setVarAttr(xIdx, "min", 0.5);
  arena.setVarAttr(xIdx, "max", 5.0);

  const eX = arena.addName(arena.interner.intern("x"));

  // Equation: (x - 2.5)^2 = 0
  const twoPtFive = arena.addRealLiteral(2.5);
  const diff = arena.addBinaryExpr(BinOp.Sub, eX, twoPtFive);
  const two = arena.addRealLiteral(2.0);
  const sq = arena.addBinaryExpr(BinOp.Pow, diff, two);
  const zero = arena.addRealLiteral(0.0);
  arena.addEquation(EqKind.InitialSimple, sq, zero);

  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("x")] = 1.0;

  const res = solveInitialEquationsArena(arena, initValues);
  assert.ok(res.converged, "Solver with sBB fallback should converge");
  const xSolved = res.valuesByStringId[arena.interner.intern("x")]!;
  assert.ok(Math.abs(xSolved - 2.5) < 1e-2, `Expected x ≈ 2.5, got ${xSolved}`);
  console.log("  ✔ sBB Global Fallback on bounded nonlinear system passed");
}

console.log("=== All DAE Initialization Tests Passed Cleanly ===");
