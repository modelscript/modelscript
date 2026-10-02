// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import {
  ArenaBltResult,
  BinOp,
  DaeBltReachabilityEngine,
  DAEBuilder,
  EqKind,
  ExprKind,
  NumericalInterval,
  Variability,
  VarType,
} from "../src/index.js";

describe("Phase 2: BLT-Driven Incremental Reachability Engine (@modelscript/runtime)", () => {
  it("should propagate intervals along causal BLT blocks topologically", () => {
    const arena = new DAEBuilder();
    const uIdx = arena.addVariable("u", VarType.Real, Variability.Parameter);
    const y1Idx = arena.addVariable("y1", VarType.Real, Variability.Continuous);
    const y2Idx = arena.addVariable("y2", VarType.Real, Variability.Continuous);

    const uName = arena.interner.intern("u");
    const y1Name = arena.interner.intern("y1");
    const y2Name = arena.interner.intern("y2");

    // Eq 1: y1 = 2 * u + 1
    const two = arena.addRealLiteral(2.0);
    const one = arena.addRealLiteral(1.0);
    const uExpr = arena.addExpression(0, uName);
    const mulExpr = arena.addBinaryExpr(BinOp.Mul, two, uExpr);
    const rhs1 = arena.addBinaryExpr(BinOp.Add, mulExpr, one);
    const y1Expr = arena.addExpression(0, y1Name);
    const eq1 = arena.addEquation(EqKind.Simple, y1Expr, rhs1);

    // Eq 2: y2 = y1 * y1
    const y1Expr2 = arena.addExpression(0, y1Name);
    const y1Expr3 = arena.addExpression(0, y1Name);
    const rhs2 = arena.addBinaryExpr(BinOp.Mul, y1Expr2, y1Expr3);
    const y2Expr = arena.addExpression(0, y2Name);
    const eq2 = arena.addEquation(EqKind.Simple, y2Expr, rhs2);

    const bltResult: ArenaBltResult = {
      sortedEquations: [eq1, eq2],
      blocks: [
        { eqIdxs: [eq1], vars: [y1Idx] },
        { eqIdxs: [eq2], vars: [y2Idx] },
      ],
    };

    const engine = new DaeBltReachabilityEngine(arena, {
      initialBounds: new Map([[uIdx, new NumericalInterval(1.0, 2.0)]]),
    });

    const summary = engine.verify(bltResult);
    assert.strictEqual(summary.isFullyCertified, true);
    assert.strictEqual(summary.totalBlocks, 2);
    assert.strictEqual(summary.recomputedBlocks, 2);
    assert.strictEqual(summary.cachedBlocks, 0);

    // Verify computed bounds:
    // y1 \in 2 * [1, 2] + 1 = [3, 5]
    const y1Bound = summary.variableBounds.get(y1Idx);
    assert.ok(y1Bound !== undefined);
    assert.strictEqual(y1Bound.low, 3.0);
    assert.strictEqual(y1Bound.high, 5.0);

    // y2 \in [3, 5] * [3, 5] = [9, 25]
    const y2Bound = summary.variableBounds.get(y2Idx);
    assert.ok(y2Bound !== undefined);
    assert.strictEqual(y2Bound.low, 9.0);
    assert.strictEqual(y2Bound.high, 25.0);
  });

  it("should incrementally reuse cached blocks when upstream inputs are unchanged", () => {
    const arena = new DAEBuilder();
    const uIdx = arena.addVariable("u", VarType.Real, Variability.Parameter);
    const yIdx = arena.addVariable("y", VarType.Real, Variability.Continuous);

    const uName = arena.interner.intern("u");
    const yName = arena.interner.intern("y");

    // y = u + 10
    const ten = arena.addRealLiteral(10.0);
    const uExpr = arena.addExpression(0, uName);
    const rhs = arena.addBinaryExpr(BinOp.Add, uExpr, ten);
    const yExpr = arena.addExpression(0, yName);
    const eq = arena.addEquation(EqKind.Simple, yExpr, rhs);

    const bltResult: ArenaBltResult = {
      sortedEquations: [eq],
      blocks: [{ eqIdxs: [eq], vars: [yIdx] }],
    };

    const engine = new DaeBltReachabilityEngine(arena, {
      initialBounds: new Map([[uIdx, new NumericalInterval(5.0, 7.0)]]),
    });

    // Pass 1: Fresh computation
    const pass1 = engine.verify(bltResult);
    assert.strictEqual(pass1.recomputedBlocks, 1);
    assert.strictEqual(pass1.cachedBlocks, 0);

    // Pass 2: Identical inputs -> 100% cache hit
    const pass2 = engine.verify(bltResult);
    assert.strictEqual(pass2.recomputedBlocks, 0);
    assert.strictEqual(pass2.cachedBlocks, 1);
    assert.strictEqual(pass2.variableBounds.get(yIdx)?.low, 15.0);
    assert.strictEqual(pass2.variableBounds.get(yIdx)?.high, 17.0);

    // Pass 3: Modify input -> cache miss and recomputed
    engine.evaluator.setVarBound(uIdx, new NumericalInterval(20.0, 30.0));
    const pass3 = engine.verify(bltResult);
    assert.strictEqual(pass3.recomputedBlocks, 1);
    assert.strictEqual(pass3.cachedBlocks, 0);
    assert.strictEqual(pass3.variableBounds.get(yIdx)?.low, 30.0);
    assert.strictEqual(pass3.variableBounds.get(yIdx)?.high, 40.0);
  });

  it("should verify regular 2x2 algebraic loops and prove unique solution via Krawczyk", () => {
    const arena = new DAEBuilder();
    const y1Idx = arena.addVariable("y1", VarType.Real, Variability.Continuous);
    const y2Idx = arena.addVariable("y2", VarType.Real, Variability.Continuous);

    const y1Name = arena.interner.intern("y1");
    const y2Name = arena.interner.intern("y2");

    // Eq 1: y1 + 2 * y2 = 5
    const y1Expr1 = arena.addExpression(0, y1Name);
    const two = arena.addRealLiteral(2.0);
    const y2Expr1 = arena.addExpression(0, y2Name);
    const mul2_y2 = arena.addBinaryExpr(BinOp.Mul, two, y2Expr1);
    const lhs1 = arena.addBinaryExpr(BinOp.Add, y1Expr1, mul2_y2);
    const rhs1 = arena.addRealLiteral(5.0);
    const eq1 = arena.addEquation(EqKind.Simple, lhs1, rhs1);

    // Eq 2: 3 * y1 - y2 = 1
    const three = arena.addRealLiteral(3.0);
    const y1Expr2 = arena.addExpression(0, y1Name);
    const mul3_y1 = arena.addBinaryExpr(BinOp.Mul, three, y1Expr2);
    const y2Expr2 = arena.addExpression(0, y2Name);
    const lhs2 = arena.addBinaryExpr(BinOp.Sub, mul3_y1, y2Expr2);
    const rhs2 = arena.addRealLiteral(1.0);
    const eq2 = arena.addEquation(EqKind.Simple, lhs2, rhs2);

    const bltResult: ArenaBltResult = {
      sortedEquations: [eq1, eq2],
      blocks: [{ eqIdxs: [eq1, eq2], vars: [y1Idx, y2Idx] }],
    };

    const engine = new DaeBltReachabilityEngine(arena, {
      initialBounds: new Map([
        [y1Idx, new NumericalInterval(0.0, 2.0)],
        [y2Idx, new NumericalInterval(1.0, 3.0)],
      ]),
    });

    const summary = engine.verify(bltResult);
    assert.strictEqual(summary.algebraicLoopsCount, 1);
    assert.strictEqual(summary.singularLoopsCount, 0);
    assert.strictEqual(summary.isFullyCertified, true);

    const loopRes = summary.blockResults[0]!;
    assert.strictEqual(loopRes.isAlgebraicLoop, true);
    assert.strictEqual(loopRes.isRegular, true);
    // det(J) = 1 * (-1) - 2 * 3 = -7.0
    assert.ok(loopRes.jacobianDeterminant !== undefined);
    assert.strictEqual(loopRes.jacobianDeterminant.low, -7.0);
    assert.strictEqual(loopRes.jacobianDeterminant.high, -7.0);
    assert.strictEqual(loopRes.isUniqueSolutionProven, true);
  });

  it("should flag singular algebraic loops when det(J) contains zero", () => {
    const arena = new DAEBuilder();
    const y1Idx = arena.addVariable("y1", VarType.Real, Variability.Continuous);
    const y2Idx = arena.addVariable("y2", VarType.Real, Variability.Continuous);

    const y1Name = arena.interner.intern("y1");
    const y2Name = arena.interner.intern("y2");

    // Eq 1: y1 * y2 = 0
    const y1Expr1 = arena.addExpression(0, y1Name);
    const y2Expr1 = arena.addExpression(0, y2Name);
    const lhs1 = arena.addBinaryExpr(BinOp.Mul, y1Expr1, y2Expr1);
    const rhs1 = arena.addRealLiteral(0.0);
    const eq1 = arena.addEquation(EqKind.Simple, lhs1, rhs1);

    // Eq 2: y1 + y2 = 1
    const y1Expr2 = arena.addExpression(0, y1Name);
    const y2Expr2 = arena.addExpression(0, y2Name);
    const lhs2 = arena.addBinaryExpr(BinOp.Add, y1Expr2, y2Expr2);
    const rhs2 = arena.addRealLiteral(1.0);
    const eq2 = arena.addEquation(EqKind.Simple, lhs2, rhs2);

    const bltResult: ArenaBltResult = {
      sortedEquations: [eq1, eq2],
      blocks: [{ eqIdxs: [eq1, eq2], vars: [y1Idx, y2Idx] }],
    };

    // Jacobian: [ [y2, y1], [1, 1] ] -> det(J) = y2 - y1
    // Over [0, 1] x [0, 1], det(J) in [-1, 1], which contains zero!
    const engine = new DaeBltReachabilityEngine(arena, {
      initialBounds: new Map([
        [y1Idx, new NumericalInterval(0.0, 1.0)],
        [y2Idx, new NumericalInterval(0.0, 1.0)],
      ]),
    });

    const summary = engine.verify(bltResult);
    assert.strictEqual(summary.algebraicLoopsCount, 1);
    assert.strictEqual(summary.singularLoopsCount, 1);
    assert.strictEqual(summary.isFullyCertified, false);

    const singularIssue = summary.issues.find((i) => i.kind === "singular_algebraic_loop");
    assert.ok(singularIssue !== undefined);
  });

  it("should project continuous dynamic state reachability enclosures over time horizon", () => {
    const arena = new DAEBuilder();
    const xIdx = arena.addVariable("x", VarType.Real, Variability.Continuous);
    const xName = arena.interner.intern("x");

    // Equation: der(x) = -2.0
    const xExpr = arena.addExpression(0, xName);
    const derX = arena.addExpression(ExprKind.Der, xExpr);
    const rhs = arena.addRealLiteral(-2.0);
    const eq = arena.addEquation(EqKind.Simple, derX, rhs);

    const bltResult: ArenaBltResult = {
      sortedEquations: [eq],
      blocks: [{ eqIdxs: [eq], vars: [xIdx] }],
    };

    const engine = new DaeBltReachabilityEngine(arena, {
      timeHorizon: 2.0, // \Delta t = 2.0s
      initialBounds: new Map([[xIdx, new NumericalInterval(10.0, 12.0)]]),
    });

    const summary = engine.verify(bltResult);
    // \dot{x} = [-2, -2]
    // x(t) \in [10, 12] + [0, 2] * [-2, -2] = [10, 12] + [-4, 0] = [6, 12]
    const stateEnclosure = summary.stateEnclosures.get(xIdx);
    assert.ok(stateEnclosure !== undefined);
    assert.strictEqual(stateEnclosure.low, 6.0);
    assert.strictEqual(stateEnclosure.high, 12.0);
  });
});
