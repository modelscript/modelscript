// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  BinOp,
  DAEBuilder,
  DaeIntervalEvaluator,
  EqKind,
  NumericalInterval,
  Variability,
  VarType,
} from "../src/index.js";

describe("Phase 1: DAE Interval & Affine Expression Evaluator (@modelscript/runtime)", () => {
  it("should evaluate basic linear operations and verify affine cancellation (x - x = 0)", () => {
    const arena = new DAEBuilder();
    const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
    const xNameId = arena.interner.intern("x");

    const xExpr1 = arena.addExpression(0 /* ExprKind.Name */, xNameId);
    const xExpr2 = arena.addExpression(0 /* ExprKind.Name */, xNameId);
    const subExpr = arena.addBinaryExpr(BinOp.Sub, xExpr1, xExpr2);

    const evaluator = new DaeIntervalEvaluator(arena);
    evaluator.setVarBound(xIdx, new NumericalInterval(10, 20));

    const res = evaluator.evaluateExpr(subExpr);
    // Interval subtraction without affine: [10, 20] - [10, 20] = [-10, 10]
    // Affine arithmetic with shared noise symbol: x - x = 0!
    assert.ok(res.affine !== undefined);
    assert.strictEqual(res.affine.c0, 0);
    assert.strictEqual(res.interval.low, 0);
    assert.strictEqual(res.interval.high, 0);
    assert.strictEqual(res.issues.length, 0);
  });

  it("should detect division by zero (possible and definite) in Ohm's Law (I = V / R)", () => {
    const arena = new DAEBuilder();
    const vIdx = arena.addVariable("V", VarType.Real, Variability.Continuous);
    const rIdx = arena.addVariable("R", VarType.Real, Variability.Continuous);
    const vNameId = arena.interner.intern("V");
    const rNameId = arena.interner.intern("R");

    const vExpr = arena.addExpression(0, vNameId);
    const rExpr = arena.addExpression(0, rNameId);
    const divExpr = arena.addBinaryExpr(BinOp.Div, vExpr, rExpr);

    const evaluator = new DaeIntervalEvaluator(arena);
    evaluator.setVarBound(vIdx, new NumericalInterval(5, 12));

    // Case 1: Safe positive resistance
    evaluator.setVarBound(rIdx, new NumericalInterval(2, 4));
    let res = evaluator.evaluateExpr(divExpr);
    assert.strictEqual(res.issues.length, 0);
    assert.strictEqual(res.interval.low, 5 / 4);
    assert.strictEqual(res.interval.high, 12 / 2);

    // Case 2: Possible zero (R in [-1, 5])
    evaluator.setVarBound(rIdx, new NumericalInterval(-1, 5));
    res = evaluator.evaluateExpr(divExpr);
    assert.strictEqual(res.issues.length, 1);
    assert.strictEqual(res.issues[0]?.kind, "div_by_zero");
    assert.strictEqual(res.issues[0]?.severity, "possible");

    // Case 3: Definite zero (R in [0, 0])
    evaluator.setVarBound(rIdx, NumericalInterval.ZERO);
    res = evaluator.evaluateExpr(divExpr);
    assert.strictEqual(res.issues.length, 1);
    assert.strictEqual(res.issues[0]?.kind, "div_by_zero");
    assert.strictEqual(res.issues[0]?.severity, "definite");
  });

  it("should detect domain violations in orifice flow: v = sqrt(2 * deltaP / rho)", () => {
    const arena = new DAEBuilder();
    const dpIdx = arena.addVariable("deltaP", VarType.Real, Variability.Continuous);
    const rhoIdx = arena.addVariable("rho", VarType.Real, Variability.Parameter);
    const dpNameId = arena.interner.intern("deltaP");
    const rhoNameId = arena.interner.intern("rho");

    const twoExpr = arena.addRealLiteral(2.0);
    const dpExpr = arena.addExpression(0, dpNameId);
    const numExpr = arena.addBinaryExpr(BinOp.Mul, twoExpr, dpExpr);
    const rhoExpr = arena.addExpression(0, rhoNameId);
    const divExpr = arena.addBinaryExpr(BinOp.Div, numExpr, rhoExpr);

    const sqrtFuncId = arena.interner.intern("sqrt");
    const vExpr = arena.addCallExpr(sqrtFuncId, [divExpr]);

    const evaluator = new DaeIntervalEvaluator(arena);
    evaluator.setVarBound(rhoIdx, NumericalInterval.const(1000.0));

    // Case 1: Safe positive pressure drop
    evaluator.setVarBound(dpIdx, new NumericalInterval(500, 2000));
    let res = evaluator.evaluateExpr(vExpr);
    assert.strictEqual(res.issues.length, 0);
    assert.ok(Math.abs(res.interval.low - 1.0) < 1e-4);
    assert.ok(Math.abs(res.interval.high - 2.0) < 1e-4);

    // Case 2: Pressure drop crosses zero (possible cavitation / domain breach)
    evaluator.setVarBound(dpIdx, new NumericalInterval(-100, 2000));
    res = evaluator.evaluateExpr(vExpr);
    const sqrtIssue = res.issues.find((i) => i.kind === "sqrt_negative");
    assert.ok(sqrtIssue !== undefined);
    assert.strictEqual(sqrtIssue.severity, "possible");

    // Case 3: Strictly negative pressure drop (definite domain error)
    evaluator.setVarBound(dpIdx, new NumericalInterval(-500, -100));
    res = evaluator.evaluateExpr(vExpr);
    const definiteSqrtIssue = res.issues.find((i) => i.kind === "sqrt_negative");
    assert.ok(definiteSqrtIssue !== undefined);
    assert.strictEqual(definiteSqrtIssue.severity, "definite");
  });

  it("should cross-reference variable bounds against Modelica min/max attributes", () => {
    const arena = new DAEBuilder();
    const tIdx = arena.addVariable("T", VarType.Real, Variability.Continuous);
    const tNameId = arena.interner.intern("T");

    // Declare min = 273.15 (Kelvin freezing threshold)
    const minExpr = arena.addRealLiteral(273.15);
    arena.setVarAttr(tIdx, "min", minExpr);

    // Declare max = 373.15 (boiling threshold)
    const maxExpr = arena.addRealLiteral(373.15);
    arena.setVarAttr(tIdx, "max", maxExpr);

    const tExpr = arena.addExpression(0, tNameId);
    const evaluator = new DaeIntervalEvaluator(arena, { checkAttributes: true });

    // Case 1: In range [280, 300]
    evaluator.setVarBound(tIdx, new NumericalInterval(280, 300));
    let res = evaluator.evaluateExpr(tExpr);
    assert.strictEqual(res.issues.length, 0);

    // Case 2: Sub-zero temperature (T in [260, 290]) -> possible violation
    evaluator.setVarBound(tIdx, new NumericalInterval(260, 290));
    res = evaluator.evaluateExpr(tExpr);
    let minIssue = res.issues.find((i) => i.kind === "min_bound_violation");
    assert.ok(minIssue !== undefined);
    assert.strictEqual(minIssue.severity, "possible");

    // Case 3: Definitely below absolute zero / threshold (T in [200, 250]) -> definite violation
    evaluator.setVarBound(tIdx, new NumericalInterval(200, 250));
    res = evaluator.evaluateExpr(tExpr);
    minIssue = res.issues.find((i) => i.kind === "min_bound_violation");
    assert.ok(minIssue !== undefined);
    assert.strictEqual(minIssue.severity, "definite");

    // Case 4: Overheating (T in [380, 420]) -> definite max violation
    evaluator.setVarBound(tIdx, new NumericalInterval(380, 420));
    res = evaluator.evaluateExpr(tExpr);
    const maxIssue = res.issues.find((i) => i.kind === "max_bound_violation");
    assert.ok(maxIssue !== undefined);
    assert.strictEqual(maxIssue.severity, "definite");
  });

  it("should evaluate equations and compute residuals across simple DAE models", () => {
    const arena = new DAEBuilder();
    const pIdx = arena.addVariable("P", VarType.Real, Variability.Continuous);
    const pNameId = arena.interner.intern("P");

    const pExpr = arena.addExpression(0, pNameId);
    const constExpr = arena.addRealLiteral(101325.0);

    const eqIdx = arena.addEquation(EqKind.Simple, pExpr, constExpr);

    const evaluator = new DaeIntervalEvaluator(arena);
    evaluator.setVarBound(pIdx, new NumericalInterval(100000.0, 105000.0));

    const eqRes = evaluator.evaluateEquation(eqIdx);
    assert.strictEqual(eqRes.issues.length, 0);
    assert.strictEqual(eqRes.residual.interval.low, 100000.0 - 101325.0);
    assert.strictEqual(eqRes.residual.interval.high, 105000.0 - 101325.0);
  });
});
