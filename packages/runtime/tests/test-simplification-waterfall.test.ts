// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DpllTSolver,
  Interval,
  SimplificationWaterfall,
  type ExprNode,
  type NonlinearConstraint,
} from "../src/index.js";

describe("SMT Term-Rewriting Simplification Waterfall (Imandra Parity)", () => {
  it("normalizes algebraic identity terms", () => {
    const x: ExprNode = { kind: "var", name: "x" };
    const zero: ExprNode = { kind: "const", value: 0 };
    const one: ExprNode = { kind: "const", value: 1 };

    // x + 0 -> x
    const addZero = SimplificationWaterfall.simplifyExpr({ kind: "add", left: x, right: zero });
    assert.deepStrictEqual(addZero, x);

    // 0 + x -> x
    const zeroAdd = SimplificationWaterfall.simplifyExpr({ kind: "add", left: zero, right: x });
    assert.deepStrictEqual(zeroAdd, x);

    // x * 1 -> x
    const mulOne = SimplificationWaterfall.simplifyExpr({ kind: "mul", left: x, right: one });
    assert.deepStrictEqual(mulOne, x);

    // x * 0 -> 0
    const mulZero = SimplificationWaterfall.simplifyExpr({ kind: "mul", left: x, right: zero });
    assert.deepStrictEqual(mulZero, zero);

    // x - x -> 0
    const subSelf = SimplificationWaterfall.simplifyExpr({ kind: "sub", left: x, right: x });
    assert.deepStrictEqual(subSelf, zero);
  });

  it("simplifies nested negations and constant arithmetic", () => {
    const x: ExprNode = { kind: "var", name: "x" };
    const y: ExprNode = { kind: "var", name: "y" };

    // -(-x) -> x
    const doubleNeg = SimplificationWaterfall.simplifyExpr({
      kind: "neg",
      child: { kind: "neg", child: x },
    });
    assert.deepStrictEqual(doubleNeg, x);

    // -(x - y) -> y - x
    const negSub = SimplificationWaterfall.simplifyExpr({
      kind: "neg",
      child: { kind: "sub", left: x, right: y },
    });
    assert.deepStrictEqual(negSub, { kind: "sub", left: y, right: x });

    // (3 + 5) -> 8
    const constAdd = SimplificationWaterfall.simplifyExpr({
      kind: "add",
      left: { kind: "const", value: 3 },
      right: { kind: "const", value: 5 },
    });
    assert.deepStrictEqual(constAdd, { kind: "const", value: 8 });
  });

  it("gathers linear subterms and cancels inverse operations", () => {
    const x: ExprNode = { kind: "var", name: "x" };
    const y: ExprNode = { kind: "var", name: "y" };

    // (2 * x) + (3 * x) -> 5 * x
    const gathered = SimplificationWaterfall.simplifyExpr({
      kind: "add",
      left: { kind: "mul", left: { kind: "const", value: 2 }, right: x },
      right: { kind: "mul", left: { kind: "const", value: 3 }, right: x },
    });
    assert.deepStrictEqual(gathered, {
      kind: "mul",
      left: { kind: "const", value: 5 },
      right: x,
    });

    // (x + y) - y -> x
    const cancelAddSub = SimplificationWaterfall.simplifyExpr({
      kind: "sub",
      left: { kind: "add", left: x, right: y },
      right: y,
    });
    assert.deepStrictEqual(cancelAddSub, x);
  });

  it("simplifies constraints and migrates constants to RHS", () => {
    const x: ExprNode = { kind: "var", name: "x" };

    // (x + 5) <= 10  ->  x <= 5
    const c1: NonlinearConstraint = {
      expr: { kind: "add", left: x, right: { kind: "const", value: 5 } },
      rel: "<=",
      rhs: 10,
    };
    const s1 = SimplificationWaterfall.simplifyConstraint(c1);
    assert.deepStrictEqual(s1.expr, x);
    assert.strictEqual(s1.rel, "<=");
    assert.strictEqual(s1.rhs, 5);

    // (2 * x) <= 8  ->  x <= 4
    const c2: NonlinearConstraint = {
      expr: { kind: "mul", left: { kind: "const", value: 2 }, right: x },
      rel: "<=",
      rhs: 8,
    };
    const s2 = SimplificationWaterfall.simplifyConstraint(c2);
    assert.deepStrictEqual(s2.expr, x);
    assert.strictEqual(s2.rel, "<=");
    assert.strictEqual(s2.rhs, 4);

    // (-x) <= 5  ->  x >= -5
    const c3: NonlinearConstraint = {
      expr: { kind: "neg", child: x },
      rel: "<=",
      rhs: 5,
    };
    const s3 = SimplificationWaterfall.simplifyConstraint(c3);
    assert.deepStrictEqual(s3.expr, x);
    assert.strictEqual(s3.rel, ">=");
    assert.strictEqual(s3.rhs, -5);
  });

  it("preserves SMT solver satisfiability while accelerating constraint resolution", () => {
    const x: ExprNode = { kind: "var", name: "x" };

    // Raw constraint: (x + 10) - 10 <= 50  (equivalent to x <= 50)
    const rawConstraint: NonlinearConstraint = {
      expr: {
        kind: "sub",
        left: { kind: "add", left: x, right: { kind: "const", value: 10 } },
        right: { kind: "const", value: 10 },
      },
      rel: "<=",
      rhs: 50,
    };

    const simplified = SimplificationWaterfall.simplifyConstraint(rawConstraint);
    assert.deepStrictEqual(simplified.expr, x);
    assert.strictEqual(simplified.rhs, 50);

    // Test with DPLL(T) SMT solver
    const initialBox = new Map([["x", new Interval(0, 100)]]);
    const solver = new DpllTSolver({
      clauses: [[1]],
      theoryLiterals: new Map([[1, simplified]]),
      initialBox,
      delta: 1e-4,
    });

    const res = solver.solve(initialBox);
    assert.strictEqual(res.status, "DELTA_SAT");
    assert.ok(res.solutionBox);
    const inv = res.solutionBox.get("x")!;
    assert.ok(inv.hi <= 50.001, `Upper bound ${inv.hi} must be <= 50`);
  });
});
