// SPDX-License-Identifier: AGPL-3.0-or-later

import { Polynomial, Term } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SysML2NRASolver } from "../src/nra-solver.js";

describe("SysML v2 Non-linear Real Arithmetic (QF_NRA) SMT Solver", () => {
  it("should prove UNSAT algebraically via Gröbner basis for contradictory non-linear equalities", () => {
    // Equation 1: x^2 + y^2 - 1 = 0
    const p1 = new Polynomial(
      [new Term(1, new Map([["x", 2]])), new Term(1, new Map([["y", 2]])), new Term(-1, new Map())],
      ["x", "y"],
    );

    // Equation 2: x^2 + y^2 - 4 = 0
    const p2 = new Polynomial(
      [new Term(1, new Map([["x", 2]])), new Term(1, new Map([["y", 2]])), new Term(-4, new Map())],
      ["x", "y"],
    );

    const res = SysML2NRASolver.solve({
      variables: {
        x: [-5, 5],
        y: [-5, 5],
      },
      constraints: [
        { polynomial: p1, op: "==" },
        { polynomial: p2, op: "==" },
      ],
    });

    assert.strictEqual(res.status, "unsat");
    assert.ok(res.explanation.includes("Gröbner basis"));
  });

  it("should find real satisfying witness for non-linear polynomial equations", () => {
    // Equation: x^2 - 4 = 0, searching in x \in [1, 3]
    const p = new Polynomial([new Term(1, new Map([["x", 2]])), new Term(-4, new Map())], ["x"]);

    const res = SysML2NRASolver.solve({
      variables: {
        x: [1, 3],
      },
      constraints: [{ polynomial: p, op: "==" }],
      tolerance: 1e-4,
    });

    assert.strictEqual(res.status, "sat");
    assert.ok(res.model !== undefined);
    assert.ok(Math.abs(res.model!.x! - 2) < 0.05);
  });

  it("should solve non-linear inequality systems", () => {
    // Constraint: x^2 + y^2 <= 1, with bounds x in [0.5, 0.8], y in [0.5, 0.8]
    // Point (0.5, 0.5) has 0.25 + 0.25 = 0.5 <= 1 -> SAT!
    const p = new Polynomial(
      [new Term(1, new Map([["x", 2]])), new Term(1, new Map([["y", 2]])), new Term(-1, new Map())],
      ["x", "y"],
    );

    const res = SysML2NRASolver.solve({
      variables: {
        x: [0.5, 0.8],
        y: [0.5, 0.8],
      },
      constraints: [{ polynomial: p, op: "<=" }],
    });

    assert.strictEqual(res.status, "sat");
    assert.ok(res.model !== undefined);
    assert.ok(res.model!.x! * res.model!.x! + res.model!.y! * res.model!.y! <= 1.0001);
  });

  it("should prove UNSAT when non-linear inequalities violate domain bounds", () => {
    // Constraint: x^2 + y^2 <= 1, but bounds are x in [2, 5], y in [2, 5]
    // Minimum possible x^2 + y^2 is 4 + 4 = 8 > 1 -> UNSAT!
    const p = new Polynomial(
      [new Term(1, new Map([["x", 2]])), new Term(1, new Map([["y", 2]])), new Term(-1, new Map())],
      ["x", "y"],
    );

    const res = SysML2NRASolver.solve({
      variables: {
        x: [2, 5],
        y: [2, 5],
      },
      constraints: [{ polynomial: p, op: "<=" }],
    });

    assert.strictEqual(res.status, "unsat");
    assert.ok(res.explanation.includes("Unsatisfiable"));
  });
});
