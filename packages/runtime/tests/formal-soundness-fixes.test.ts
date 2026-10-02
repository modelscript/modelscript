// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { CdclSatSolver } from "../src/formal/cdcl_sat.js";
import { DpllTSolver } from "../src/formal/dpll_t_solver.js";
import { IC3Engine, type TransitionSystem } from "../src/formal/ic3_engine.js";
import { MultiPoly, NlsatSolver } from "../src/formal/nlsat_solver.js";

describe("Formal Verification Soundness & Robustness Regression Suite", () => {
  it("should extract minimal UNSAT core under assumptions in CDCL", () => {
    const sat = new CdclSatSolver();
    // Clauses:
    // a1 -> x1   (~a1 | x1)
    // a2 -> ~x1  (~a2 | ~x1)
    // a3 -> y1   (~a3 | y1)
    // a4 -> y2   (~a4 | y2)
    // Here, {a1, a2} are mutually conflicting. {a3, a4} are completely independent.
    const a1 = 1;
    const a2 = 2;
    const a3 = 3;
    const a4 = 4;
    const x1 = 5;
    const y1 = 6;
    const y2 = 7;

    sat.addClause([-a1, x1]);
    sat.addClause([-a2, -x1]);
    sat.addClause([-a3, y1]);
    sat.addClause([-a4, y2]);

    const res = sat.solve([a1, a2, a3, a4]);
    assert.strictEqual(res.status, "UNSAT");
    assert.ok(res.unsatCore, "Must return unsatCore");
    assert.strictEqual(res.unsatCore.length, 2, "Core should contain only conflicting assumptions");
    assert.ok(res.unsatCore.includes(a1));
    assert.ok(res.unsatCore.includes(a2));
    assert.ok(!res.unsatCore.includes(a3));
    assert.ok(!res.unsatCore.includes(a4));
  });

  it("should rescale VSIDS activities and avoid overflow to Infinity", () => {
    const sat = new CdclSatSolver();
    sat.ensureVar(1);
    sat.ensureVar(2);

    // Bump activity more than 20,000 times (which would exceed 1e308 without rescaling)
    for (let i = 0; i < 25000; i++) {
      (sat as any).bumpVarActivity(1);
      (sat as any).decayVarActivity();
    }

    const act1 = (sat as any).activity.get(1);
    assert.ok(Number.isFinite(act1), `Activity must be finite: ${act1}`);
    assert.ok(act1 > 0, `Activity must be positive: ${act1}`);
  });

  it("should report isProvenInvariant: false when IC3 reaches maxDepth without convergence", () => {
    const v1 = 1;
    const v2 = 2;
    const v1Prime = 3;
    const v2Prime = 4;

    const ts: TransitionSystem = {
      stateVars: [v1, v2],
      nextStateVars: [v1Prime, v2Prime],
      initClauses: [[-v1], [-v2]],
      transClauses: [[v1Prime, -v1Prime]],
      propClauses: [[v1, -v1]],
    };

    const ic3 = new IC3Engine(ts);
    const res = ic3.verify(3);
    assert.strictEqual(res.isProvenInvariant, false, "Must not claim invariant when induction did not converge");
    assert.strictEqual(res.depthReached, 3);
  });

  it("should correctly negate non-linear equality constraints in DPLL(T)", () => {
    // Problem: Boolean lit 1 represents (x == 5).
    // Clause: [-1] asserting NOT (x == 5).
    // Domain: x in [4.0, 6.0].
    const problem = {
      clauses: [[-1]],
      theoryLiterals: new Map([
        [
          1,
          {
            expr: { kind: "var" as const, name: "x" },
            rel: "==" as const,
            rhs: 5,
          },
        ],
      ]),
      initialBox: new Map([["x", new Interval(4.0, 6.0)]]),
      delta: 0.1,
    };

    const solver = new DpllTSolver(problem);
    const res = solver.solve();
    assert.strictEqual(res.status, "DELTA_SAT");
    assert.ok(res.solutionBox);
    const xInv = res.solutionBox.get("x")!;
    assert.ok(xInv.lo < 4.9 || xInv.hi > 5.1, `Solution should not be locked at 5: [${xInv.lo}, ${xInv.hi}]`);
  });

  it("should solve coupled bivariate concentric circles via CAD projection in NlsatSolver", () => {
    // Circle 1: (x - 1)^2 + y^2 < 4  => x^2 - 2x + 1 + y^2 - 4 = x^2 - 2x + y^2 - 3 < 0
    // Circle 2: (x - 1)^2 + y^2 < 1  => x^2 - 2x + 1 + y^2 - 1 = x^2 - 2x + y^2 < 0
    // (1, 0) is a valid solution.
    const p1 = new MultiPoly([
      { deg: new Map([["x", 2]]), coeff: 1 },
      { deg: new Map([["x", 1]]), coeff: -2 },
      { deg: new Map([["y", 2]]), coeff: 1 },
      { deg: new Map(), coeff: -3 },
    ]);
    const p2 = new MultiPoly([
      { deg: new Map([["x", 2]]), coeff: 1 },
      { deg: new Map([["x", 1]]), coeff: -2 },
      { deg: new Map([["y", 2]]), coeff: 1 },
    ]);

    const solver = new NlsatSolver([
      { id: 1, poly: p1, op: "<", vars: ["x", "y"] },
      { id: 2, poly: p2, op: "<", vars: ["x", "y"] },
    ]);

    const res = solver.solve();
    assert.strictEqual(res.status, "SAT", "Must find SAT solution inside (1, 0)");
    assert.ok(res.model);
    const x = res.model.get("x")!;
    const y = res.model.get("y")!;
    assert.ok((x - 1) * (x - 1) + y * y < 1.0, `Model (${x}, ${y}) must satisfy circle 2`);
  });
});
