// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { BinOp, DAEBuilder, EqKind, Variability, VarType } from "../src/dae/wasm_dae.js";
import { solveInitialEquationsArena } from "../src/dae/wasm_init.js";

console.log("Testing Strengthened Steady-State Initialization Ladder...");

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: Variable Nominal Scaling on Multi-Scale Physical Loop
// Equation 1: P * 1e-5 - 2.5 = 0  (P ≈ 250,000 Pa)
// Equation 2: m_flow * 1e3 - 5.0 = 0 (m_flow ≈ 0.005 kg/s)
// Coupled: P * 1e-5 + m_flow * 1e3 = 7.5
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const pIdx = arena.addVariable("P", VarType.Real, Variability.Continuous);
  arena.setVarAttr(pIdx, "nominal", 100000.0);
  arena.setVarAttr(pIdx, "min", 0.0);
  arena.setVarAttr(pIdx, "max", 1000000.0);

  const mIdx = arena.addVariable("m_flow", VarType.Real, Variability.Continuous);
  arena.setVarAttr(mIdx, "nominal", 0.001);
  arena.setVarAttr(mIdx, "min", 0.0);
  arena.setVarAttr(mIdx, "max", 1.0);

  const eP = arena.addName(arena.interner.intern("P"));
  const eM = arena.addName(arena.interner.intern("m_flow"));

  const scaleP = arena.addRealLiteral(1e-5);
  const scaleM = arena.addRealLiteral(1e3);

  // Eq 1: P * 1e-5 - 2.5 = 0 => P = 250000
  const termP = arena.addBinaryExpr(BinOp.Mul, eP, scaleP);
  const targetP = arena.addRealLiteral(2.5);
  arena.addEquation(EqKind.InitialSimple, termP, targetP);

  // Eq 2: m_flow * 1e3 - 5.0 = 0 => m_flow = 0.005
  const termM = arena.addBinaryExpr(BinOp.Mul, eM, scaleM);
  const targetM = arena.addRealLiteral(5.0);
  arena.addEquation(EqKind.InitialSimple, termM, targetM);

  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("P")] = 10000.0;
  initValues[arena.interner.intern("m_flow")] = 0.1;

  const res = solveInitialEquationsArena(arena, initValues);
  assert.ok(res.converged, "Nominal-scaled Newton must converge across 8 orders of magnitude");

  const pSolved = res.valuesByStringId[arena.interner.intern("P")]!;
  const mSolved = res.valuesByStringId[arena.interner.intern("m_flow")]!;

  assert.ok(Math.abs(pSolved - 250000.0) < 1.0, `Expected P ≈ 250000, got ${pSolved}`);
  assert.ok(Math.abs(mSolved - 0.005) < 1e-5, `Expected m_flow ≈ 0.005, got ${mSolved}`);
  console.log("  ✔ Test 1: Variable Nominal Scaling on Multi-Scale Loop passed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: Box-Constrained Armijo Search (Preventing Domain Violations)
// Equation: x^2 - 9.0 = 0 with min = 0.5 (must not land on x = -3.0)
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  arena.setVarAttr(xIdx, "min", 0.5);
  arena.setVarAttr(xIdx, "max", 100.0);
  arena.setVarAttr(xIdx, "nominal", 3.0);

  const eX = arena.addName(arena.interner.intern("x"));
  const two = arena.addRealLiteral(2.0);
  const nine = arena.addRealLiteral(9.0);
  const xSq = arena.addBinaryExpr(BinOp.Pow, eX, two);
  arena.addEquation(EqKind.InitialSimple, xSq, nine);

  // Start with guess close to boundary
  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("x")] = 0.6;

  const res = solveInitialEquationsArena(arena, initValues);
  assert.ok(res.converged, "Box-constrained Newton should converge to positive root");
  const xSolved = res.valuesByStringId[arena.interner.intern("x")]!;
  assert.ok(Math.abs(xSolved - 3.0) < 1e-5, `Expected x ≈ 3.0, got ${xSolved}`);
  assert.ok(xSolved >= 0.5, `x must be >= min bound 0.5, got ${xSolved}`);
  console.log("  ✔ Test 2: Box-Constrained Line Search passed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: Keller's Pseudo-Arc-Length Homotopy Continuation
// System with turning point: x^3 - 3*x = lambda_target
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
  arena.setVarAttr(xIdx, "nominal", 1.0);

  const eX = arena.addName(arena.interner.intern("x"));
  const three = arena.addRealLiteral(3.0);
  const xCubed = arena.addBinaryExpr(BinOp.Pow, eX, three);
  const threeX = arena.addBinaryExpr(BinOp.Mul, three, eX);
  const lhs = arena.addBinaryExpr(BinOp.Sub, xCubed, threeX);

  // Equation: x^3 - 3x - 18.0 = 0 (Real root is 3.0, since 27 - 9 - 18 = 0)
  const eighteen = arena.addRealLiteral(18.0);
  arena.addEquation(EqKind.InitialSimple, lhs, eighteen);

  // Start far away from root
  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("x")] = 0.5;

  const res = solveInitialEquationsArena(arena, initValues);
  assert.ok(res.converged, "Pseudo-arc-length homotopy should traverse through turning points");
  const xSolved = res.valuesByStringId[arena.interner.intern("x")]!;
  assert.ok(Math.abs(xSolved - 3.0) < 1e-3, `Expected x ≈ 3.0, got ${xSolved}`);
  console.log("  ✔ Test 3: Keller's Pseudo-Arc-Length Continuation passed");
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: Switched Evolution Pseudo-Transient Relaxation
// Highly stiff non-linear algebraic system with quadratic coupling
// Eq 1: x1^2 + x2 - 5 = 0
// Eq 2: x1 * x2 - 2 = 0
// Solution: x1 = 2, x2 = 1 (or other roots)
// ─────────────────────────────────────────────────────────────────────────────
{
  const arena = new DAEBuilder();
  const x1Idx = arena.addVariable("x1", VarType.Real, Variability.Continuous);
  arena.setVarAttr(x1Idx, "nominal", 2.0);
  arena.setVarAttr(x1Idx, "min", 0.1);

  const x2Idx = arena.addVariable("x2", VarType.Real, Variability.Continuous);
  arena.setVarAttr(x2Idx, "nominal", 1.0);
  arena.setVarAttr(x2Idx, "min", 0.1);

  const eX1 = arena.addName(arena.interner.intern("x1"));
  const eX2 = arena.addName(arena.interner.intern("x2"));

  const two = arena.addRealLiteral(2.0);
  const five = arena.addRealLiteral(5.0);

  // x1^2 + x2 = 5
  const x1Sq = arena.addBinaryExpr(BinOp.Pow, eX1, two);
  const eq1Lhs = arena.addBinaryExpr(BinOp.Add, x1Sq, eX2);
  arena.addEquation(EqKind.InitialSimple, eq1Lhs, five);

  // x1 * x2 = 2
  const eq2Lhs = arena.addBinaryExpr(BinOp.Mul, eX1, eX2);
  arena.addEquation(EqKind.InitialSimple, eq2Lhs, two);

  const initValues = new Float64Array(arena.interner.size + 16);
  initValues[arena.interner.intern("x1")] = 0.5;
  initValues[arena.interner.intern("x2")] = 4.0;

  const res = solveInitialEquationsArena(arena, initValues);
  assert.ok(res.converged, "Coupled non-linear system must converge cleanly");
  const x1Solved = res.valuesByStringId[arena.interner.intern("x1")]!;
  const x2Solved = res.valuesByStringId[arena.interner.intern("x2")]!;

  // Verify residual: x1^2 + x2 = 5, x1 * x2 = 2
  const r1 = Math.abs(x1Solved * x1Solved + x2Solved - 5.0);
  const r2 = Math.abs(x1Solved * x2Solved - 2.0);

  assert.ok(r1 < 1e-4, `Expected residual 1 < 1e-4, got ${r1}`);
  assert.ok(r2 < 1e-4, `Expected residual 2 < 1e-4, got ${r2}`);
  console.log("  ✔ Test 4: Switched Evolution Pseudo-Transient Relaxation passed");
}

console.log("=== All Strengthened Initialization Ladder Tests Passed Successfully ===");
