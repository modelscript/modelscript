// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { DpllTSolver, type SmtProblem } from "../src/formal/dpll_t_solver.js";
import { Hc4Contractor, type NonlinearConstraint } from "../src/formal/hc4_contractor.js";

describe("Native In-Process delta-Complete SMT (DPLL(T)) Solver Suite", () => {
  it("should contract interval boxes accurately using HC4-Revise", () => {
    // Constraint: x^2 + y^2 <= 4 on x, y in [-10, 10]
    // Expect x, y contracted to [-2, 2]
    const xSqr = { kind: "sqr" as const, child: { kind: "var" as const, name: "x" } };
    const ySqr = { kind: "sqr" as const, child: { kind: "var" as const, name: "y" } };
    const expr = { kind: "add" as const, left: xSqr, right: ySqr };

    const constraint: NonlinearConstraint = {
      expr,
      rel: "<=",
      rhs: 4.0,
    };

    const box = new Map<string, Interval>([
      ["x", new Interval(-10, 10)],
      ["y", new Interval(-10, 10)],
    ]);

    const valid = Hc4Contractor.revise(constraint, box);
    assert(valid, "Contraction should be satisfiable");

    const xInv = box.get("x")!;
    const yInv = box.get("y")!;

    assert(xInv.lo >= -2.0001 && xInv.hi <= 2.0001, `x was not contracted to [-2, 2]: [${xInv.lo}, ${xInv.hi}]`);
    assert(yInv.lo >= -2.0001 && yInv.hi <= 2.0001, `y was not contracted to [-2, 2]: [${yInv.lo}, ${yInv.hi}]`);
  });

  it("should detect geometric contradictions as UNSAT in HC4-Revise", () => {
    // x in [5, 10], constraint: x <= 3
    const constraint: NonlinearConstraint = {
      expr: { kind: "var" as const, name: "x" },
      rel: "<=",
      rhs: 3.0,
    };
    const box = new Map<string, Interval>([["x", new Interval(5, 10)]]);
    const valid = Hc4Contractor.revise(constraint, box);
    assert.strictEqual(valid, false, "Contradictory bounds should return false");
  });

  it("should solve non-linear SMT problem with Boolean logic via DPLL(T)", () => {
    // Variables: x, y in [-5, 5]
    // Theory literal 1: x^2 + y^2 <= 1 (inside circle of radius 1)
    // Theory literal 2: x >= 2 (must be to the right of x=2)
    // Boolean formula: (L1 & L2) should be UNSAT because circle is bounded by x <= 1
    const xSqr = { kind: "sqr" as const, child: { kind: "var" as const, name: "x" } };
    const ySqr = { kind: "sqr" as const, child: { kind: "var" as const, name: "y" } };
    const circle = { kind: "add" as const, left: xSqr, right: ySqr };

    const c1: NonlinearConstraint = { expr: circle, rel: "<=", rhs: 1.0 };
    const c2: NonlinearConstraint = { expr: { kind: "var" as const, name: "x" }, rel: ">=", rhs: 2.0 };

    const problem: SmtProblem = {
      clauses: [[1], [2]], // Assert L1 AND L2
      theoryLiterals: new Map([
        [1, c1],
        [2, c2],
      ]),
      initialBox: new Map([
        ["x", new Interval(-5, 5)],
        ["y", new Interval(-5, 5)],
      ]),
      delta: 0.01,
    };

    const solver = new DpllTSolver(problem);
    const result = solver.solve(problem.initialBox);

    assert.strictEqual(result.status, "UNSAT", "Circle and disjoint halfspace should be UNSAT");
    assert(result.conflictsEncountered > 0, "Should have encountered theory conflict lemma");
  });

  it("should find certified delta-SAT solution box for feasible nonlinear SMT problems", () => {
    // Theory literal 1: x^2 + y^2 <= 4
    // Theory literal 2: x >= 1
    // Clauses: [1], [2] (both must hold)
    const xSqr = { kind: "sqr" as const, child: { kind: "var" as const, name: "x" } };
    const ySqr = { kind: "sqr" as const, child: { kind: "var" as const, name: "y" } };
    const circle = { kind: "add" as const, left: xSqr, right: ySqr };

    const c1: NonlinearConstraint = { expr: circle, rel: "<=", rhs: 4.0 };
    const c2: NonlinearConstraint = { expr: { kind: "var" as const, name: "x" }, rel: ">=", rhs: 1.0 };

    const initialBox = new Map([
      ["x", new Interval(-5, 5)],
      ["y", new Interval(-5, 5)],
    ]);

    const problem: SmtProblem = {
      clauses: [[1], [2]],
      theoryLiterals: new Map([
        [1, c1],
        [2, c2],
      ]),
      initialBox,
      delta: 0.1,
    };

    const solver = new DpllTSolver(problem);
    const result = solver.solve(initialBox);

    assert.strictEqual(result.status, "DELTA_SAT");
    assert(result.solutionBox !== undefined);

    const xSol = result.solutionBox!.get("x")!;
    assert(xSol.lo >= 0.99, `x solution [${xSol.lo}, ${xSol.hi}] should be >= 1`);
  });

  it("should contract interval boxes accurately using HC4 backward div contractor", () => {
    // x in [10, 20], y in [1, 10]
    // Constraint: x / y <= 2.0  => y >= x / 2 >= 5
    const constraint: NonlinearConstraint = {
      expr: {
        kind: "div",
        left: { kind: "var", name: "x" },
        right: { kind: "var", name: "y" },
      },
      rel: "<=",
      rhs: 2.0,
    };

    const box = new Map<string, Interval>([
      ["x", new Interval(10, 20)],
      ["y", new Interval(1, 10)],
    ]);

    const valid = Hc4Contractor.revise(constraint, box);
    assert(valid, "Division contraction should be satisfiable");

    const yInv = box.get("y")!;
    assert(yInv.lo >= 4.999, `y should be contracted to >= 5, got [${yInv.lo}, ${yInv.hi}]`);
  });

  it("should contract interval boxes accurately using HC4 backward sqrt contractor", () => {
    // x in [0, 25], sqrt(x) <= 3 => x in [0, 9]
    const constraint: NonlinearConstraint = {
      expr: {
        kind: "sqrt",
        child: { kind: "var", name: "x" },
      },
      rel: "<=",
      rhs: 3.0,
    };

    const box = new Map<string, Interval>([["x", new Interval(0, 25)]]);
    const valid = Hc4Contractor.revise(constraint, box);
    assert(valid, "Sqrt contraction should be satisfiable");

    const xInv = box.get("x")!;
    assert(xInv.lo >= 0 && xInv.hi <= 9.001, `x should be contracted to [0, 9], got [${xInv.lo}, ${xInv.hi}]`);
  });

  it("should contract interval boxes accurately using HC4 backward sin and cos contractors", () => {
    // x in [0, pi], sin(x) >= 0.5 => x in [pi/6, 5*pi/6] ~ [0.523, 2.618]
    const sinConstraint: NonlinearConstraint = {
      expr: {
        kind: "sin",
        child: { kind: "var", name: "x" },
      },
      rel: ">=",
      rhs: 0.5,
    };

    const sinBox = new Map<string, Interval>([["x", new Interval(0, Math.PI)]]);
    const sinValid = Hc4Contractor.revise(sinConstraint, sinBox);
    assert(sinValid, "Sin contraction should be satisfiable");

    const sinX = sinBox.get("x")!;
    assert(
      sinX.lo >= 0.52 && sinX.hi <= 2.62,
      `sin(x) >= 0.5 should contract to ~[0.523, 2.618], got [${sinX.lo}, ${sinX.hi}]`,
    );

    // y in [0, pi], cos(y) >= 0.5 => y in [0, pi/3] ~ [0, 1.047]
    const cosConstraint: NonlinearConstraint = {
      expr: {
        kind: "cos",
        child: { kind: "var", name: "y" },
      },
      rel: ">=",
      rhs: 0.5,
    };

    const cosBox = new Map<string, Interval>([["y", new Interval(0, Math.PI)]]);
    const cosValid = Hc4Contractor.revise(cosConstraint, cosBox);
    assert(cosValid, "Cos contraction should be satisfiable");

    const cosY = cosBox.get("y")!;
    assert(cosY.lo >= 0 && cosY.hi <= 1.05, `cos(y) >= 0.5 should contract to [0, pi/3], got [${cosY.lo}, ${cosY.hi}]`);
  });

  it("should certify algebraic contradictions via Gröbner basis preprocessing as UNSAT", () => {
    // System:
    // x^2 + y^2 == 25 (circle of radius 5)
    // x^2 + y^2 == 50 (circle of radius sqrt(50) ~ 7.07)
    // Contradiction: 25 == 50, which Groebner basis immediately reduces to 1 = 0
    const lit1 = 1;
    const lit2 = 2;

    const c1: NonlinearConstraint = {
      expr: {
        kind: "add",
        left: { kind: "sqr", child: { kind: "var", name: "x" } },
        right: { kind: "sqr", child: { kind: "var", name: "y" } },
      },
      rel: "==",
      rhs: 25.0,
    };

    const c2: NonlinearConstraint = {
      expr: {
        kind: "add",
        left: { kind: "sqr", child: { kind: "var", name: "x" } },
        right: { kind: "sqr", child: { kind: "var", name: "y" } },
      },
      rel: "==",
      rhs: 50.0,
    };

    const problem: SmtProblem = {
      clauses: [[lit1], [lit2]], // Both must hold
      theoryLiterals: new Map([
        [lit1, c1],
        [lit2, c2],
      ]),
      initialBox: new Map([
        ["x", new Interval(-10, 10)],
        ["y", new Interval(-10, 10)],
      ]),
      delta: 0.05,
    };

    const solver = new DpllTSolver(problem);
    const result = solver.solve(problem.initialBox);

    assert.strictEqual(result.status, "UNSAT", "Contradictory polynomial circle equations must be certified UNSAT");
  });
});
