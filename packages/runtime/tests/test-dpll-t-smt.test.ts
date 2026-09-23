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
});
