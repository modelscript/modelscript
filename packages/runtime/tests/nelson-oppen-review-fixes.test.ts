// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Interval } from "../src/analysis/wasm_interval.js";
import { DpllTSolver } from "../src/formal/dpll_t_solver.js";
import { ExactLraSimplexSolver, LraSimplexSolver, Rational } from "../src/formal/lra_simplex.js";
import {
  ArrayTheoryOracle,
  BitVectorTheoryOracle,
  ConstraintTheoryOracle,
  OntologyTheoryOracle,
  StringTheoryOracle,
} from "../src/formal/oracles/index.js";
import {
  SemanticTheoryCoordinator,
  type EqualityDisjunction,
  type SharedEquality,
  type TheoryLiteral,
  type TheoryOracle,
} from "../src/formal/theory_coordinator.js";

describe("Nelson-Oppen & DPLL(T) Review Fixes", () => {
  it("attaches complete proof-forest justifications to congruence closure conflicts", () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());

    const f1 = coordinator.assertLiteral({ predicate: "funcApply", args: ["r1", "f", ["a"]], domain: "constraint" });
    const f2 = coordinator.assertLiteral({ predicate: "funcApply", args: ["r2", "f", ["b"]], domain: "constraint" });
    const eqAB = coordinator.assertLiteral({ predicate: "equal", args: ["a", "b"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "interval", args: ["r1", 0, 1], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "interval", args: ["r2", 5, 6], domain: "constraint" });

    const res = coordinator.checkSat();
    assert.equal(res.isSat, false);
    assert.ok(res.conflict);
    const conflictIds = res.conflict.literals.map((l) => l.id);
    assert.ok(conflictIds.includes(f1), "conflict must include first funcApply literal");
    assert.ok(conflictIds.includes(f2), "conflict must include second funcApply literal");
    assert.ok(conflictIds.includes(eqAB), "conflict must include argument equality literal a == b");
  });

  it("produces sound CDCL conflict clauses for congruence closure in DpllTSolver", () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());

    // Persistent facts: r1 = f(a), r2 = f(b), r1 in [0, 1], r2 in [5, 6]
    coordinator.assertLiteral({ predicate: "funcApply", args: ["r1", "f", ["a"]], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "funcApply", args: ["r2", "f", ["b"]], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "interval", args: ["r1", 0, 1], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "interval", args: ["r2", 5, 6], domain: "constraint" });

    // SAT formula: (lit1: a == b) \/ (lit2: c == d)
    // Branch lit1=true triggers congruence conflict; solver must learn [-lit1] and find SAT on lit2=true!
    const multiLits = new Map<number, TheoryLiteral>([
      [1, { id: 1, predicate: "equal", args: ["a", "b"], domain: "constraint" }],
      [2, { id: 2, predicate: "equal", args: ["c", "d"], domain: "constraint" }],
    ]);

    const solver = new DpllTSolver({
      clauses: [[1, 2]],
      coordinator,
      multiTheoryLiterals: multiLits,
    });

    const res = solver.solve();
    assert.equal(res.status, "DELTA_SAT", "DPLL(T) must backtrack from congruence conflict and find SAT branch");
  });

  it("enforces strict inequalities (<, >) and disequalities (!=) soundly", () => {
    // 1. x < 5 and x >= 5 => UNSAT
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.assertLiteral({ predicate: "bound", args: ["x", "<", 5], domain: "constraint" });
    c1.assertLiteral({ predicate: "bound", args: ["x", ">=", 5], domain: "constraint" });
    assert.equal(c1.checkSat().isSat, false, "x < 5 && x >= 5 must be UNSAT");

    // 2. x < 5 and x > 5 => UNSAT
    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.assertLiteral({ predicate: "bound", args: ["x", "<", 5], domain: "constraint" });
    c2.assertLiteral({ predicate: "bound", args: ["x", ">", 5], domain: "constraint" });
    assert.equal(c2.checkSat().isSat, false, "x < 5 && x > 5 must be UNSAT");

    // 3. x == 5 and x != 5 => UNSAT
    const c3 = new SemanticTheoryCoordinator();
    c3.registerOracle(new ConstraintTheoryOracle());
    c3.assertLiteral({ predicate: "bound", args: ["x", "==", 5], domain: "constraint" });
    c3.assertLiteral({ predicate: "bound", args: ["x", "!=", 5], domain: "constraint" });
    assert.equal(c3.checkSat().isSat, false, "x == 5 && x != 5 must be UNSAT");

    // 4. DpllTSolver negation of (x <= 5) combined with (x == 5) => UNSAT
    const c4 = new SemanticTheoryCoordinator();
    c4.registerOracle(new ConstraintTheoryOracle());
    const solver = new DpllTSolver({
      clauses: [[-1], [2]],
      coordinator: c4,
      multiTheoryLiterals: new Map<number, TheoryLiteral>([
        [1, { id: 1, predicate: "bound", args: ["x", "<=", 5], domain: "constraint" }],
        [2, { id: 2, predicate: "bound", args: ["x", "==", 5], domain: "constraint" }],
      ]),
    });
    assert.equal(solver.solve().status, "UNSAT", "not(x <= 5) && (x == 5) must be UNSAT");
  });

  it("handles nano-scale intervals with scale-aware relative tolerances", () => {
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.assertLiteral({ predicate: "interval", args: ["cap_f", 5e-10, 1e-10], domain: "constraint" });
    assert.equal(c1.checkSat().isSat, false, "Nano-scale inverted interval [5e-10, 1e-10] must be UNSAT");

    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.assertLiteral({ predicate: "interval", args: ["cap_f", 0, 1e-9], domain: "constraint" });
    assert.equal(c2.checkSat().isSat, true);
    c2.assertLiteral({ predicate: "interval", args: ["cap_f", 0, 1e-12], domain: "constraint" });
    assert.equal(c2.checkSat().isSat, true);
    const bounds = c2.getAllCanonicalBounds().get("cap_f");
    assert.ok(bounds);
    assert.equal(bounds[1], 1e-12, "Nano-scale bound tightening must not be dropped as micro-contraction");
  });

  it("preserves domainSubscribers across reset()", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const received: SharedEquality[] = [];
    const customConstraintOracle: TheoryOracle = {
      name: "CustomBoundListener",
      domain: "constraint",
      assertLiteral: () => true,
      retractLiteral: () => {},
      checkSat: () => ({ isSat: true }),
      propagateEqualities: () => [],
      onSharedEquality: (eq) => received.push(eq),
      reset: () => {},
    };
    coordinator.registerOracle(customConstraintOracle);
    coordinator.reset();

    coordinator.enqueueEvent({
      kind: "bound",
      varName: "pressure",
      bounds: [10, 20],
      theoryDomain: "constraint",
      sourceOracle: "external",
    });
    coordinator.checkSat();
    assert.equal(received.length, 1, "Registered oracle must still receive domain events after reset()");
    assert.deepEqual(received[0]!.bounds, [10, 20]);
  });

  it("restores modified pre-existing equalities on popLevel() and preserves levelStack across retractLiteral()", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Level 0: assert base literal and equality
    const baseLit = coordinator.assertLiteral({ predicate: "interval", args: ["x", 0, 100], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "equal", args: ["x", "y"], domain: "constraint" });
    assert.equal(coordinator.checkSat().isSat, true);

    // Push level 1
    coordinator.pushLevel();
    const tempLit = coordinator.assertLiteral({ predicate: "interval", args: ["x", 10, 20], domain: "constraint" });
    assert.equal(coordinator.checkSat().isSat, true);
    // Retract tempLit while inside level 1 — must NOT corrupt levelStack!
    coordinator.retractLiteral(tempLit);
    assert.equal(coordinator.checkSat().isSat, true);

    // Pop level 1 — baseLit from level 0 must still be active!
    coordinator.popLevel();
    coordinator.assertLiteral({ predicate: "interval", args: ["x", 200, 300], domain: "constraint" });
    const res = coordinator.checkSat();
    assert.equal(
      res.isSat,
      false,
      `Base literal ${baseLit} from level 0 must still enforce x in [0, 100] after popLevel()`,
    );
  });

  it("propagates opposite-sign bounds after unionVars, deduces transitivity and self-negation", () => {
    // 1. Opposite-sign after unionVars: b == -c, then b == a, then a in [10, 20] => c in [-20, -10]
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.assertLiteral({ predicate: "equal", args: ["b", "-c"], domain: "constraint" });
    c1.assertLiteral({ predicate: "equal", args: ["b", "a"], domain: "constraint" });
    c1.assertLiteral({ predicate: "interval", args: ["a", 10, 20], domain: "constraint" });
    c1.assertLiteral({ predicate: "interval", args: ["c", 0, 5], domain: "constraint" });
    assert.equal(c1.checkSat().isSat, false, "Merged equivalence class must mirror bounds to opposite-sign partner c");

    // 2. Transitive opposite-sign: a == -b and b == -c => a == c
    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.assertLiteral({ predicate: "equal", args: ["a", "-b"], domain: "constraint" });
    c2.assertLiteral({ predicate: "equal", args: ["b", "-c"], domain: "constraint" });
    assert.equal(c2.checkSat().isSat, true);
    assert.equal(c2.getCanonicalVar("a"), c2.getCanonicalVar("c"), "a == -b && b == -c must deduce a == c");

    // 3. Self-negation: a == -a => a == 0
    const c3 = new SemanticTheoryCoordinator();
    c3.registerOracle(new ConstraintTheoryOracle());
    c3.assertLiteral({ predicate: "equal", args: ["a", "-a"], domain: "constraint" });
    c3.assertLiteral({ predicate: "bound", args: ["a", ">=", 1], domain: "constraint" });
    assert.equal(c3.checkSat().isSat, false, "a == -a implies a == 0, conflicting with a >= 1");
  });

  it("propagates arithmetic real equalities into OntologyTheoryOracle and contracted bounds out of ConstraintTheoryOracle", () => {
    // 1. Point-interval equality x == y (domain: "real") caught by OntologyTheoryOracle differentIndividuals(x, y)
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.registerOracle(new OntologyTheoryOracle());

    c1.assertLiteral({ predicate: "bound", args: ["x", "==", 5], domain: "constraint" });
    c1.assertLiteral({ predicate: "bound", args: ["y", "==", 5], domain: "constraint" });
    c1.assertLiteral({ predicate: "differentIndividuals", args: ["x", "y"], domain: "ontology" });
    const res1 = c1.checkSat();
    assert.equal(res1.isSat, false, "OntologyTheoryOracle must accept real equality x == y and flag Identity Conflict");

    // 2. ConstraintTheoryOracle propagates non-point interval contracted by hyperplane back to coordinator
    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.assertLiteral({ predicate: "interval", args: ["x", 2, 3], domain: "constraint" });
    c2.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: 1 }, op: "==", rhs: 10 }],
      domain: "constraint",
    });
    const res2 = c2.checkSat();
    assert.equal(res2.isSat, true);
    const yBounds = c2.getAllCanonicalBounds().get("y");
    assert.ok(yBounds, "Contracted non-point bound on y must be propagated into coordinator");
    assert.ok(
      Math.abs(yBounds[0] - 7) < 1e-6 && Math.abs(yBounds[1] - 8) < 1e-6,
      `Expected y in [7, 8], got ${yBounds}`,
    );
  });

  it("transfers coordinator equalities to NLSAT and verifies nonlinear models bidirectionally", () => {
    // 1. Coordinator equality x == y transferred to NLSAT: x + y == 10 && x <= 4 => UNSAT
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.assertLiteral({ predicate: "equal", args: ["x", "y"], domain: "constraint" });

    const solver1 = new DpllTSolver({
      clauses: [[1], [2]],
      coordinator: c1,
      theoryLiterals: new Map([
        [
          1,
          {
            expr: { kind: "add", left: { kind: "var", name: "x" }, right: { kind: "var", name: "y" } },
            rel: "==",
            rhs: 10,
          },
        ],
        [
          2,
          {
            expr: { kind: "var", name: "x" },
            rel: "<=",
            rhs: 4,
          },
        ],
      ]),
      initialBox: new Map([
        ["x", new Interval(-10, 10)],
        ["y", new Interval(-10, 10)],
      ]),
    });
    assert.equal(
      solver1.solve().status,
      "UNSAT",
      "Coordinator x == y must constrain NLSAT so x+y==10 && x<=4 is UNSAT",
    );

    // 2. Bidirectional feedback: NLSAT forces x == 3, y == 3; OntologyTheoryOracle has differentIndividuals(x, y) => UNSAT
    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.registerOracle(new OntologyTheoryOracle());
    c2.assertLiteral({ predicate: "differentIndividuals", args: ["x", "y"], domain: "ontology" });

    const solver2 = new DpllTSolver({
      clauses: [[1], [2]],
      coordinator: c2,
      theoryLiterals: new Map([
        [1, { expr: { kind: "var", name: "x" }, rel: "==", rhs: 3 }],
        [2, { expr: { kind: "var", name: "y" }, rel: "==", rhs: 3 }],
      ]),
      initialBox: new Map([
        ["x", new Interval(0, 10)],
        ["y", new Interval(0, 10)],
      ]),
    });
    assert.equal(
      solver2.solve().status,
      "UNSAT",
      "Bidirectional model verification must detect Ontology conflict when NLSAT forces x == y == 3",
    );
  });

  it("supports non-convex equality disjunction splitting in DpllTSolver", () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());

    // Non-convex oracle: asserts (x == y) \/ (x == z)
    const nonConvexOracle: TheoryOracle = {
      name: "NonConvexArrayOracle",
      domain: "custom",
      assertLiteral: () => true,
      retractLiteral: () => {},
      checkSat: () => ({ isSat: true }),
      propagateEqualities: () => [],
      propagateEqualityDisjunctions: (): EqualityDisjunction[] => [
        {
          disjuncts: [
            ["x", "y"],
            ["x", "z"],
          ],
          explanation: "Non-convex disjunction: x == y or x == z",
        },
      ],
      onSharedEquality: () => {},
      reset: () => {},
    };
    coordinator.registerOracle(nonConvexOracle);

    // x in [5, 10], y in [0, 2] (incompatible with x), z in [7, 7] (compatible with x)
    const solver = new DpllTSolver({
      clauses: [[1], [2], [3]],
      coordinator,
      multiTheoryLiterals: new Map<number, TheoryLiteral>([
        [1, { id: 1, predicate: "interval", args: ["x", 5, 10], domain: "constraint" }],
        [2, { id: 2, predicate: "interval", args: ["y", 0, 2], domain: "constraint" }],
        [3, { id: 3, predicate: "interval", args: ["z", 7, 7], domain: "constraint" }],
      ]),
    });

    const res = solver.solve();
    assert.equal(res.status, "DELTA_SAT", "DPLL(T) must split on (x==y)\\/(x==z), reject x==y, and satisfy x==z");
    const xBox = res.solutionBox?.get("x");
    assert.ok(xBox);
    assert.equal(xBox.lo, 7);
    assert.equal(xBox.hi, 7);
  });

  it("reaches fixpoint in 1 iteration without wasted no-op pass", () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());
    coordinator.assertLiteral({ predicate: "interval", args: ["x", 1, 5], domain: "constraint" });
    const res = coordinator.checkSat(1);
    assert.equal(res.status, "SAT", "Single-pass fixpoint must succeed with maxIterations=1");
    assert.equal(res.iterations, 1);
  });

  it("detects unbounded LRA infeasibility and deduces implied equalities via Dutertre-de Moura Simplex", () => {
    // 1. Unbounded linear infeasibility: x - y >= 1 and y - x >= 1 (no box bounds)
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: -1 }, op: ">=", rhs: 1 }],
      domain: "constraint",
    });
    c1.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { y: 1, x: -1 }, op: ">=", rhs: 1 }],
      domain: "constraint",
    });
    const res1 = c1.checkSat();
    assert.equal(res1.isSat, false, "Unbounded x - y >= 1 && y - x >= 1 must be UNSAT via Simplex");
    assert.match(res1.conflict?.explanation ?? "", /Simplex/);

    // 2. Implied equality deduction: x - y <= 0 && y - x <= 0 ==> x == y, caught by Ontology differentIndividuals(x, y)
    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.registerOracle(new OntologyTheoryOracle());
    c2.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: -1 }, op: "<=", rhs: 0 }],
      domain: "constraint",
    });
    c2.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { y: 1, x: -1 }, op: "<=", rhs: 0 }],
      domain: "constraint",
    });
    c2.assertLiteral({
      predicate: "differentIndividuals",
      args: ["x", "y"],
      domain: "ontology",
    });
    const res2 = c2.checkSat();
    assert.equal(res2.isSat, false, "Simplex must deduce x == y from x <= y && y <= x and trigger Ontology conflict");
    assert.equal(c2.getCanonicalVar("x"), c2.getCanonicalVar("y"));
  });

  it("automatically purifies mixed arithmetic + uninterpreted-function terms and tracks shared interface variables", () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());
    coordinator.registerOracle(new OntologyTheoryOracle());

    // Mixed terms: f(x) == 10 and f(y) == 20, plus x == y => UNSAT via automatic purification + congruence closure!
    coordinator.assertLiteral({
      predicate: "expr",
      args: [
        {
          expr: { kind: "call", fn: "f", args: [{ kind: "var", name: "x" }] },
          rel: "==",
          rhs: 10,
        },
      ],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "expr",
      args: [
        {
          expr: { kind: "call", fn: "f", args: [{ kind: "var", name: "y" }] },
          rel: "==",
          rhs: 20,
        },
      ],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "sameIndividual",
      args: ["x", "y"],
      domain: "ontology",
    });

    // Shared interface variable check: x and y appear in both 'constraint' and 'ontology'
    const shared = coordinator.getSharedInterfaceVariables();
    assert.ok(shared.has("x") && shared.has("y"), "x and y must be identified as shared interface variables");

    const res = coordinator.checkSat();
    assert.equal(res.isSat, false, "Purified f(x)==10 && f(y)==20 && x==y must be UNSAT via congruence closure");
  });

  it("propagates cross-oracle disequalities (x != y) and enforces Polite/Shiny finite-domain cardinality", () => {
    // 1. Disjoint intervals propagate x != y and trigger Finite-Domain Cardinality Conflict (3 distinct vars in size-2 domain)
    const c1 = new SemanticTheoryCoordinator();
    c1.registerOracle(new ConstraintTheoryOracle());
    c1.registerOracle(new OntologyTheoryOracle());

    c1.assertLiteral({ predicate: "interval", args: ["a", 0, 1], domain: "constraint" });
    c1.assertLiteral({ predicate: "interval", args: ["b", 2, 3], domain: "constraint" });
    c1.assertLiteral({ predicate: "interval", args: ["c", 4, 5], domain: "constraint" });
    c1.assertLiteral({ predicate: "finiteDomain", args: [["a", "b", "c"], 2], domain: "ontology" });

    const res1 = c1.checkSat();
    assert.equal(res1.isSat, false, "3 pairwise disjoint variables in a cardinality-2 domain must be UNSAT");
    assert.match(res1.conflict?.explanation ?? "", /Finite-Domain Cardinality Conflict/);
    assert.equal(c1.areKnownDisequal("a", "b"), true);

    // 2. Pigeonhole disjunction splitting in DpllTSolver when 2 vars are disjoint and 3rd can merge with one
    const c2 = new SemanticTheoryCoordinator();
    c2.registerOracle(new ConstraintTheoryOracle());
    c2.registerOracle(new OntologyTheoryOracle());
    c2.assertLiteral({ predicate: "finiteDomain", args: [["a", "b", "c"], 2], domain: "ontology" });

    const solver = new DpllTSolver({
      clauses: [[1], [2], [3]],
      coordinator: c2,
      multiTheoryLiterals: new Map<number, TheoryLiteral>([
        [1, { id: 1, predicate: "interval", args: ["a", 0, 1], domain: "constraint" }],
        [2, { id: 2, predicate: "interval", args: ["b", 5, 10], domain: "constraint" }],
        [3, { id: 3, predicate: "interval", args: ["c", 7, 7], domain: "constraint" }],
      ]),
    });

    const res2 = solver.solve();
    assert.equal(res2.status, "DELTA_SAT", "DPLL(T) must satisfy Pigeonhole finite-domain split via b == c == 7");
    const bBox = res2.solutionBox?.get("b");
    assert.ok(bBox);
    assert.equal(bBox.lo, 7);
    assert.equal(bBox.hi, 7);
  });

  it("unwinds undo trail cleanly on popLevel(), reclaims varToId, and retracts only affected oracles", () => {
    const coordinator = new SemanticTheoryCoordinator();
    coordinator.registerOracle(new ConstraintTheoryOracle());
    let unrelatedRetracts = 0;
    const unrelatedOracle: TheoryOracle = {
      name: "UnrelatedObserver",
      domain: "custom",
      assertLiteral: () => true,
      retractLiteral: () => {
        unrelatedRetracts++;
      },
      checkSat: () => ({ isSat: true }),
      propagateEqualities: () => [],
      onSharedEquality: () => {},
      reset: () => {},
    };
    coordinator.registerOracle(unrelatedOracle);

    const litId = coordinator.assertLiteral({ predicate: "interval", args: ["localVar", 1, 2], domain: "constraint" });
    assert.equal(coordinator.checkSat().isSat, true);
    coordinator.retractLiteral(litId);
    assert.equal(unrelatedRetracts, 0, "Incremental retractLiteral must not invoke unrelated clean oracles");

    // Verify O(1) undo trail + varToId reclamation on popLevel()
    const coordInternal = coordinator as unknown as { idToVar: unknown[] };
    const baseVarCount = coordInternal.idToVar.length;
    coordinator.pushLevel();
    coordinator.assertLiteral({ predicate: "equal", args: ["tempA", "tempB"], domain: "constraint" });
    coordinator.assertLiteral({ predicate: "notEqual", args: ["tempC", "tempD"], domain: "constraint" });
    assert.equal(coordinator.checkSat().isSat, true);
    assert.ok(coordInternal.idToVar.length > baseVarCount);

    coordinator.popLevel();
    assert.equal(coordInternal.idToVar.length, baseVarCount, "popLevel must reclaim transient varToId entries");
    assert.equal(coordinator.getCanonicalVar("tempA"), "tempA", "popLevel must unwind unionVars via undo trail");
    assert.equal(coordinator.areKnownDisequal("tempC", "tempD"), false, "popLevel must unwind knownDisequalities");
  });

  it("supports per-oracle UndoTrail nested push/pop in ConstraintTheoryOracle and OntologyTheoryOracle", () => {
    const constraint = new ConstraintTheoryOracle();
    constraint.assertLiteral({ id: 1, predicate: "interval", args: ["x", 0, 100], domain: "constraint" });
    assert.equal(constraint.checkSat().isSat, true);

    constraint.pushLevel();
    constraint.assertLiteral({ id: 2, predicate: "interval", args: ["x", 50, 60], domain: "constraint" });
    constraint.pushLevel();
    constraint.assertLiteral({ id: 3, predicate: "interval", args: ["x", 70, 80], domain: "constraint" });
    assert.equal(constraint.checkSat().isSat, false, "Inner conflicting bound must be UNSAT");

    constraint.popLevel();
    assert.equal(constraint.checkSat().isSat, true, "After first popLevel, x in [50, 60] must be SAT");
    const int1 = constraint.getInterval("x");
    assert.ok(int1);
    assert.deepEqual([int1.lo, int1.hi], [50, 60]);

    constraint.popLevel();
    assert.equal(constraint.checkSat().isSat, true, "After second popLevel, x in [0, 100] must be SAT");
    const int2 = constraint.getInterval("x");
    assert.ok(int2);
    assert.deepEqual([int2.lo, int2.hi], [0, 100]);

    const ontology = new OntologyTheoryOracle();
    ontology.assertLiteral({ id: 10, predicate: "disjoint", args: ["Pump", "Valve"], domain: "ontology" });
    ontology.assertLiteral({ id: 11, predicate: "type", args: ["comp1", "Pump"], domain: "ontology" });
    assert.equal(ontology.checkSat().isSat, true);

    ontology.pushLevel();
    ontology.assertLiteral({ id: 12, predicate: "type", args: ["comp1", "Valve"], domain: "ontology" });
    assert.equal(ontology.checkSat().isSat, false, "Disjoint class assertion inside pushed level must be UNSAT");

    ontology.popLevel();
    assert.equal(ontology.checkSat().isSat, true, "Popping UndoTrail in OntologyTheoryOracle must restore SAT");
  });

  it("supports incremental single-entity retractLiteral() fast path in Constraint and Ontology oracles", () => {
    const constraint = new ConstraintTheoryOracle();
    constraint.assertLiteral({ id: 1, predicate: "interval", args: ["x", 0, 10], domain: "constraint" });
    constraint.assertLiteral({ id: 2, predicate: "interval", args: ["x", 5, 15], domain: "constraint" });
    constraint.assertLiteral({ id: 3, predicate: "interval", args: ["y", 20, 30], domain: "constraint" });
    assert.deepEqual([constraint.getInterval("x")!.lo, constraint.getInterval("x")!.hi], [5, 10]);

    // Retracting only lit 2 should incrementally recompute x's bounds to [0, 10] without touching y
    constraint.retractLiteral(2);
    assert.deepEqual([constraint.getInterval("x")!.lo, constraint.getInterval("x")!.hi], [0, 10]);
    assert.deepEqual([constraint.getInterval("y")!.lo, constraint.getInterval("y")!.hi], [20, 30]);
    assert.equal(constraint.checkSat().isSat, true);

    const ontology = new OntologyTheoryOracle();
    ontology.assertLiteral({ id: 1, predicate: "disjoint", args: ["A", "B"], domain: "ontology" });
    ontology.assertLiteral({ id: 2, predicate: "type", args: ["ind1", "A"], domain: "ontology" });
    ontology.assertLiteral({ id: 3, predicate: "type", args: ["ind1", "B"], domain: "ontology" });
    assert.equal(ontology.checkSat().isSat, false);

    // Retracting lit 3 incrementally removes type B from ind1
    ontology.retractLiteral(3);
    assert.equal(ontology.checkSat().isSat, true);

    ontology.assertLiteral({ id: 4, predicate: "sameIndividual", args: ["ind1", "ind2"], domain: "ontology" });
    ontology.assertLiteral({ id: 5, predicate: "differentIndividuals", args: ["ind1", "ind2"], domain: "ontology" });
    assert.equal(ontology.checkSat().isSat, false);
    ontology.retractLiteral(5);
    assert.equal(ontology.checkSat().isSat, true);
  });

  it("suppresses purely local equalities when opt-in interfaceOnlyPropagation is enabled", () => {
    const coordinator = new SemanticTheoryCoordinator({ interfaceOnlyPropagation: true });
    const constraint = new ConstraintTheoryOracle();
    const ontology = new OntologyTheoryOracle();
    coordinator.registerOracle(constraint);
    coordinator.registerOracle(ontology);

    // Purely local constraint variables: localA <= localB && localB <= localA => Simplex deduces localA == localB
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { localA: 1, localB: -1 }, op: "<=", rhs: 0 }],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { localB: 1, localA: -1 }, op: "<=", rhs: 0 }],
      domain: "constraint",
    });

    // Shared interface variables: sharedX and sharedY appear in both constraint and ontology domains
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { sharedX: 1, sharedY: -1 }, op: "<=", rhs: 0 }],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ coeffs: { sharedY: 1, sharedX: -1 }, op: "<=", rhs: 0 }],
      domain: "constraint",
    });
    coordinator.assertLiteral({ predicate: "type", args: ["sharedX", "Node"], domain: "ontology" });
    coordinator.assertLiteral({ predicate: "type", args: ["sharedY", "Node"], domain: "ontology" });

    const res = coordinator.checkSat();
    assert.equal(res.isSat, true);
    assert.equal(
      coordinator.getCanonicalVar("sharedX"),
      coordinator.getCanonicalVar("sharedY"),
      "Shared interface equality sharedX == sharedY must still be propagated",
    );
    assert.notEqual(
      coordinator.getCanonicalVar("localA"),
      coordinator.getCanonicalVar("localB"),
      "Purely local equality localA == localB must be suppressed under interfaceOnlyPropagation",
    );
  });

  it("solves Linear Integer Arithmetic (LIA) via Simplex branch-and-bound in ConstraintTheoryOracle", () => {
    // 1. Fractional-only integer interval: x in [1.2, 1.8], integer(x) => UNSAT
    const c1 = new ConstraintTheoryOracle();
    c1.assertLiteral({ id: 1, predicate: "integer", args: ["x"], domain: "constraint" });
    c1.assertLiteral({ id: 2, predicate: "interval", args: ["x", 1.2, 1.8], domain: "constraint" });
    assert.equal(c1.checkSat().isSat, false, "Integer x in [1.2, 1.8] must be UNSAT");

    // 2. Linear Diophantine infeasibility: 2*x == 3, integer(x) => UNSAT (LRA is SAT at x=1.5)
    const c2 = new ConstraintTheoryOracle();
    c2.assertLiteral({ id: 1, predicate: "integer", args: ["x"], domain: "constraint" });
    c2.assertLiteral({
      id: 2,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 2 }, op: "==", rhs: 3 }],
      domain: "constraint",
    });
    assert.equal(c2.checkSat().isSat, false, "2*x == 3 with integer(x) must be UNSAT via LIA branch-and-bound");

    // 3. Multi-variable LIA infeasibility: x + y == 1, x - y == 0, integer(x, y) => UNSAT (LRA is SAT at x=y=0.5)
    const c3 = new ConstraintTheoryOracle();
    c3.assertLiteral({ id: 1, predicate: "integer", args: [["x", "y"]], domain: "constraint" });
    c3.assertLiteral({
      id: 2,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: 1 }, op: "==", rhs: 1 }],
      domain: "constraint",
    });
    c3.assertLiteral({
      id: 3,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: -1 }, op: "==", rhs: 0 }],
      domain: "constraint",
    });
    assert.equal(c3.checkSat().isSat, false, "x+y==1 && x-y==0 with integer(x,y) must be UNSAT");

    // 4. Feasible LIA: 2*x + y == 5, x in [1, 3], y in [0, 2], integer(x, y) => SAT (e.g. x=2, y=1)
    const c4 = new ConstraintTheoryOracle();
    c4.assertLiteral({ id: 1, predicate: "integer", args: [["x", "y"]], domain: "constraint" });
    c4.assertLiteral({ id: 2, predicate: "interval", args: ["x", 1, 3], domain: "constraint" });
    c4.assertLiteral({ id: 3, predicate: "interval", args: ["y", 0, 2], domain: "constraint" });
    c4.assertLiteral({
      id: 4,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 2, y: 1 }, op: "==", rhs: 5 }],
      domain: "constraint",
    });
    assert.equal(c4.checkSat().isSat, true, "Feasible LIA system 2*x + y == 5 must be SAT");
  });

  it("solves ill-conditioned LRA & Chvatal-Gomory LIA via ExactLraSimplexSolver (BigInt Rational) and GMI cuts", () => {
    // 1. Ill-conditioned system where IEEE-754 double loses precision:
    //    10^16 * x + y == 10^16  AND  10^16 * x + y == 10^16 + 1 => UNSAT!
    const exact = new ExactLraSimplexSolver();
    const big = new Rational(10n ** 16n);
    const bigPlusOne = new Rational(10n ** 16n + 1n);
    exact.assertConstraint({ coeffs: { x: big, y: 1 }, op: "==", rhs: big, litId: 1 });
    exact.assertConstraint({ coeffs: { x: big, y: 1 }, op: "==", rhs: bigPlusOne, litId: 2 });
    const resIll = exact.checkSat();
    assert.equal(
      resIll.isSat,
      false,
      "ExactLraSimplexSolver must detect 10^16 vs 10^16+1 infeasibility without float drift",
    );

    // 2. Exact GMI cut on 2x + 2y == 1, x >= 0, y >= 0, integer(x, y) => UNSAT in 1 cut (maxNodes = 1)!
    const exactGmi = new ExactLraSimplexSolver();
    exactGmi.markIntegerVar("x");
    exactGmi.markIntegerVar("y");
    exactGmi.assertVarBound("x", 0, null);
    exactGmi.assertVarBound("y", 0, null);
    exactGmi.assertConstraint({ coeffs: { x: 2, y: 2 }, op: "==", rhs: 1, litId: 1 });
    const resGmi = exactGmi.checkSatLia(1, 4);
    assert.equal(resGmi.isSat, false, "Exact GMI cut must prove 2x + 2y == 1 UNSAT at root node (maxNodes=1)");

    // 3. Double-precision LraSimplexSolver with GMI cut on 2x + 2y == 1, x >= 0, y >= 0 => UNSAT at root node
    const fastGmi = new LraSimplexSolver();
    fastGmi.markIntegerVar("x");
    fastGmi.markIntegerVar("y");
    fastGmi.assertVarBound("x", 0, Infinity);
    fastGmi.assertVarBound("y", 0, Infinity);
    fastGmi.assertConstraint({ coeffs: { x: 2, y: 2 }, op: "==", rhs: 1, litId: 1 });
    assert.equal(fastGmi.checkSatLia(1, 4).isSat, false, "LraSimplexSolver GMI cut must prove 2x+2y==1 UNSAT at root");
  });

  it("persists warm-started Simplex tableau across pushLevel()/popLevel() in ConstraintTheoryOracle", () => {
    const oracle = new ConstraintTheoryOracle();
    // Base system: x + y <= 10, x >= 4, y >= 4 (SAT: x=4, y=4..6)
    oracle.assertLiteral({
      id: 1,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: 1 }, op: "<=", rhs: 10 }],
      domain: "constraint",
    });
    oracle.assertLiteral({ id: 2, predicate: "interval", args: ["x", 4, 10], domain: "constraint" });
    oracle.assertLiteral({ id: 3, predicate: "interval", args: ["y", 4, 10], domain: "constraint" });
    assert.equal(oracle.checkSat().isSat, true);

    // Push conflicting hyperplane: x + y >= 12 => UNSAT
    oracle.pushLevel();
    oracle.assertLiteral({
      id: 4,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: 1 }, op: ">=", rhs: 12 }],
      domain: "constraint",
    });
    assert.equal(oracle.checkSat().isSat, false, "Pushed conflicting hyperplane must be UNSAT");

    // Pop back to base => SAT again without losing base hyperplanes
    oracle.popLevel();
    assert.equal(oracle.checkSat().isSat, true, "After popLevel, base hyperplane system must be SAT");

    // Push tighter feasible hyperplane: x + y == 9 => SAT
    oracle.pushLevel();
    oracle.assertLiteral({
      id: 5,
      predicate: "hyperplane",
      args: [{ coeffs: { x: 1, y: 1 }, op: "==", rhs: 9 }],
      domain: "constraint",
    });
    assert.equal(oracle.checkSat().isSat, true, "After popLevel + new pushLevel, x+y==9 must be SAT");

    // Pop and verify base still enforces x + y <= 10 (by pushing x >= 7, y >= 7 => UNSAT)
    oracle.popLevel();
    oracle.pushLevel();
    oracle.assertLiteral({ id: 6, predicate: "interval", args: ["x", 7, 10], domain: "constraint" });
    oracle.assertLiteral({ id: 7, predicate: "interval", args: ["y", 7, 10], domain: "constraint" });
    assert.equal(oracle.checkSat().isSat, false, "Base hyperplane x + y <= 10 must remain enforced after popLevel");
    oracle.popLevel();
    assert.equal(oracle.checkSat().isSat, true);
  });

  it("integrates ArrayTheoryOracle (T_A), BitVectorTheoryOracle (T_BV), and StringTheoryOracle (T_S) in Nelson-Oppen", () => {
    // 1. ArrayTheoryOracle + ConstraintTheoryOracle via SemanticTheoryCoordinator:
    //    a2 = store(a1, i, v), r = select(a2, j), i == j, v in [10, 10], r in [20, 20] => UNSAT via ROW1!
    const cArr = new SemanticTheoryCoordinator();
    cArr.registerOracle(new ArrayTheoryOracle());
    cArr.registerOracle(new ConstraintTheoryOracle());
    cArr.assertLiteral({ predicate: "arrayStore", args: ["a2", "a1", "i", "v"], domain: "custom" });
    cArr.assertLiteral({ predicate: "arraySelect", args: ["r", "a2", "j"], domain: "custom" });
    cArr.assertLiteral({ predicate: "equal", args: ["i", "j"], domain: "custom" });
    cArr.assertLiteral({ predicate: "interval", args: ["v", 10, 10], domain: "constraint" });
    cArr.assertLiteral({ predicate: "interval", args: ["r", 20, 20], domain: "constraint" });
    assert.equal(cArr.checkSat().isSat, false, "ROW1 must propagate r == v and clash with v=10, r=20");

    // 2. BitVectorTheoryOracle: 8-bit modular wraparound (250 + 10 == 4 mod 256) + push/pop
    const bv = new BitVectorTheoryOracle();
    bv.assertLiteral({ id: 1, predicate: "bvConst", args: ["x", 250, 8], domain: "custom" });
    bv.assertLiteral({ id: 2, predicate: "bvConst", args: ["y", 10, 8], domain: "custom" });
    bv.assertLiteral({ id: 3, predicate: "bvAdd", args: ["z", "x", "y", 8], domain: "custom" });
    assert.equal(bv.checkSat().isSat, true);
    assert.equal(bv.getModel()["z"], 4n, "8-bit bvAdd(250, 10) must wrap around to 4n");

    bv.pushLevel();
    bv.assertLiteral({ id: 4, predicate: "bvConst", args: ["z", 5, 8], domain: "custom" });
    assert.equal(bv.checkSat().isSat, false, "z == 5 must conflict with 8-bit wraparound z == 4");
    bv.popLevel();
    assert.equal(bv.checkSat().isSat, true, "UndoTrail popLevel must restore SAT in BitVectorTheoryOracle");

    // 3. StringTheoryOracle + ConstraintTheoryOracle: strConcat + strLen length propagation
    //    s1 = "hello" (len 5), s2 = "world" (len 5), s3 = concat(s1, s2), len(s3) = L, L <= 8 => UNSAT!
    const cStr = new SemanticTheoryCoordinator();
    cStr.registerOracle(new StringTheoryOracle());
    cStr.registerOracle(new ConstraintTheoryOracle());
    cStr.assertLiteral({ predicate: "strConst", args: ["s1", "hello"], domain: "custom" });
    cStr.assertLiteral({ predicate: "strConst", args: ["s2", "world"], domain: "custom" });
    cStr.assertLiteral({ predicate: "strConcat", args: ["s3", "s1", "s2"], domain: "custom" });
    cStr.assertLiteral({ predicate: "strLen", args: ["s3", "L"], domain: "custom" });
    cStr.assertLiteral({ predicate: "bound", args: ["L", "<=", 8], domain: "constraint" });
    assert.equal(cStr.checkSat().isSat, false, "String length L == 10 must conflict with arithmetic bound L <= 8");
  });
});
