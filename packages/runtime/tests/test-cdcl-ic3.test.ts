// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CdclSatSolver, TseitinEncoder } from "../src/formal/cdcl_sat.js";
import { IC3Engine, type TransitionSystem } from "../src/formal/ic3_engine.js";

describe("Native In-Engine CDCL SAT & IC3/PDR Verification Suite", () => {
  it("should correctly identify unsatisfiable 2-SAT / 3-SAT formulas", () => {
    const solver = new CdclSatSolver();
    // (x1 | x2) & (~x1 | x2) & (x1 | ~x2) & (~x1 | ~x2)
    assert(solver.addClause([1, 2]));
    assert(solver.addClause([-1, 2]));
    assert(solver.addClause([1, -2]));
    assert(solver.addClause([-1, -2]));

    const res = solver.solve();
    assert.strictEqual(res.status, "UNSAT");
  });

  it("should solve satisfiable 3-SAT instances and return a valid model", () => {
    const solver = new CdclSatSolver();
    // (x1 | x2 | x3) & (~x1 | x2) & (~x2 | x3) & (x1 | ~x3)
    solver.addClause([1, 2, 3]);
    solver.addClause([-1, 2]);
    solver.addClause([-2, 3]);
    solver.addClause([1, -3]);

    const res = solver.solve();
    assert.strictEqual(res.status, "SAT");
    assert(res.model !== undefined);

    // Verify model satisfies all clauses
    const clauses = [
      [1, 2, 3],
      [-1, 2],
      [-2, 3],
      [1, -3],
    ];
    for (const c of clauses) {
      const satisfied = c.some((lit) => {
        const v = Math.abs(lit);
        const val = res.model!.get(v);
        return lit > 0 ? val === true : val === false;
      });
      assert(satisfied, `Clause [${c.join(", ")}] violated by model`);
    }
  });

  it("should encode complex propositional ASTs into equisatisfiable CNF via Tseitin", () => {
    const encoder = new TseitinEncoder();
    // Formula: (A -> B) & (B -> C) & (A) -> C should be a tautology
    // Its negation: (A -> B) & (B -> C) & A & ~C must be UNSAT
    const a = { op: "var" as const, name: "A" };
    const b = { op: "var" as const, name: "B" };
    const c = { op: "var" as const, name: "C" };

    const premise1 = { op: "implies" as const, left: a, right: b };
    const premise2 = { op: "implies" as const, left: b, right: c };
    const notC = { op: "not" as const, child: c };

    const negatedHypothesis = {
      op: "and" as const,
      children: [premise1, premise2, a, notC],
    };

    const rootLit = encoder.encode(negatedHypothesis);

    const solver = new CdclSatSolver();
    for (const cl of encoder.clauses) {
      solver.addClause(cl);
    }
    // Assert rootLit is true
    solver.addClause([rootLit]);

    const res = solver.solve();
    assert.strictEqual(res.status, "UNSAT", "Hypothesis negation should be UNSAT (Modus Ponens theorem)");
  });

  it("should support incremental solving with assumptions", () => {
    const solver = new CdclSatSolver();
    // (x1 | x2) & (~x1 | x3)
    solver.addClause([1, 2]);
    solver.addClause([-1, 3]);

    // Under assumption x1 = true and x3 = false:
    // x1 forces x3 = true, which conflicts with assumption x3 = false
    const resUnsat = solver.solve([1, -3]);
    assert.strictEqual(resUnsat.status, "UNSAT");

    // Under assumption x1 = false:
    // forces x2 = true, x3 can be anything -> SAT
    const resSat = solver.solve([-1]);
    assert.strictEqual(resSat.status, "SAT");
  });

  it("should formally prove safety invariants of transition systems via IC3/PDR", () => {
    // Model a 2-bit counter: s1, s0 -> s1', s0'
    // Starts at 00 (s1=0, s0=0).
    // Invariant to verify: ~(s1 & s0) is false if counter only counts 00 -> 01 -> 10 -> 00.
    // Let's model a modulo-3 counter:
    // 00 -> 01
    // 01 -> 10
    // 10 -> 00
    // State 11 is never reachable!
    // Variables:
    // 1: s1, 2: s0
    // 3: s1', 4: s0'
    const encoder = new TseitinEncoder();
    const s1 = encoder.getOrCreateVar("s1");
    const s0 = encoder.getOrCreateVar("s0");
    const s1_p = encoder.getOrCreateVar("s1_p");
    const s0_p = encoder.getOrCreateVar("s0_p");

    // Init: s1 = 0, s0 = 0
    const initClauses: number[][] = [[-s1], [-s0]];

    // Transition relation:
    // next_s1 = (~s1 & s0)
    // next_s0 = (~s1 & ~s0)
    // We encode:
    // (s1_p <-> (~s1 & s0))
    // (s0_p <-> (~s1 & ~s0))
    const notS1 = { op: "not" as const, child: { op: "var" as const, name: "s1", id: s1 } };
    const notS0 = { op: "not" as const, child: { op: "var" as const, name: "s0", id: s0 } };
    const s0Var = { op: "var" as const, name: "s0", id: s0 };

    const trans1 = {
      op: "iff" as const,
      left: { op: "var" as const, name: "s1_p", id: s1_p },
      right: { op: "and" as const, children: [notS1, s0Var] },
    };
    const trans0 = {
      op: "iff" as const,
      left: { op: "var" as const, name: "s0_p", id: s0_p },
      right: { op: "and" as const, children: [notS1, notS0] },
    };

    encoder.encode(trans1);
    encoder.encode(trans0);

    // Property P: ~(s1 & s0) => clause (~s1 | ~s0)
    const propClauses: number[][] = [[-s1, -s0]];

    const ts: TransitionSystem = {
      stateVars: [s1, s0],
      nextStateVars: [s1_p, s0_p],
      initClauses,
      transClauses: encoder.clauses,
      propClauses,
    };

    const ic3 = new IC3Engine(ts);
    const result = ic3.verify(10);

    assert(result.isProvenInvariant, `IC3 should prove property invariant: ${result.summary}`);
  });
});
