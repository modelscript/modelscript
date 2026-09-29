// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ConstraintTheoryOracle,
  DpllTSolver,
  OntologyTheoryOracle,
  SemanticTheoryCoordinator,
  SmtProblem,
  UnifiedVerifier,
  VerificationInputContext,
  type TheoryLiteral,
} from "../src/index.js";

describe("Semantic Theory Coordinator — Phase 3: Algorithm Unification & Pipeline Integration", () => {
  it("should solve non-convex multi-theory disjunctions via CDCL(T) and 1-UIP conflict clause learning", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const constraints = new ConstraintTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(constraints);

    // Background theory axiom: Taxiing and Flying are disjoint flight modes
    coordinator.assertLiteral({
      predicate: "disjoint",
      args: ["Taxiing", "Flying"],
      domain: "ontology",
    });

    // Multi-theory literals for Boolean skeleton:
    // 1: craft1 is Taxiing
    // 2: craft1 is Flying
    // 3: speed <= 60
    // 4: speed >= 120
    // 5: speed >= 150
    const multiTheoryLiterals = new Map<number, TheoryLiteral>([
      [
        1,
        {
          id: 1,
          predicate: "type",
          args: ["craft1", "Taxiing"],
          domain: "ontology",
        },
      ],
      [
        2,
        {
          id: 2,
          predicate: "type",
          args: ["craft1", "Flying"],
          domain: "ontology",
        },
      ],
      [
        3,
        {
          id: 3,
          predicate: "bound",
          args: ["speed", "<=", 60],
          domain: "constraint",
        },
      ],
      [
        4,
        {
          id: 4,
          predicate: "bound",
          args: ["speed", ">=", 120],
          domain: "constraint",
        },
      ],
      [
        5,
        {
          id: 5,
          predicate: "bound",
          args: ["speed", ">=", 150],
          domain: "constraint",
        },
      ],
    ]);

    // Boolean clauses representing system requirements:
    // C1: (Taxiing \/ Flying)                -> [1, 2]
    // C2: (Taxiing -> speed <= 60)           -> [-1, 3]
    // C3: (Flying -> speed >= 120)           -> [-2, 4]
    // C4: Current radar reports speed >= 150 -> [5]
    const problem: SmtProblem = {
      clauses: [[1, 2], [-1, 3], [-2, 4], [5]],
      coordinator,
      multiTheoryLiterals,
    };

    const solver = new DpllTSolver(problem);
    const result = solver.solve();

    // Solver must rule out Taxiing via conflict learning and certify SAT on Flying
    assert.equal(result.status, "DELTA_SAT", "System should be SAT on the Flying branch");
    assert.ok(result.conflictsEncountered > 0, "Conflict clause must be learned when Taxiing is attempted");

    // Now introduce an impossible requirement: radar also reports speed <= 50
    // Literal 6: speed <= 50
    multiTheoryLiterals.set(6, {
      id: 6,
      predicate: "bound",
      args: ["speed", "<=", 50],
      domain: "constraint",
    });
    const unsatProblem: SmtProblem = {
      clauses: [
        [1, 2],
        [-1, 3],
        [-2, 4],
        [5],
        [6], // Speed cannot be simultaneously >= 150 and <= 50
      ],
      coordinator,
      multiTheoryLiterals,
    };

    const unsatSolver = new DpllTSolver(unsatProblem);
    const unsatResult = unsatSolver.solve();
    assert.equal(unsatResult.status, "UNSAT", "Contradictory non-convex problem must be certified UNSAT");
  });

  it("should normalize asserted AST expressions and constraints via SimplificationWaterfall", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Assert a non-linear constraint with identity additions and constant offset:
    // ((p + 0) * 1) + 5 <= 25
    coordinator.assertLiteral({
      predicate: "nonlinear",
      args: [
        {
          expr: {
            kind: "add",
            left: {
              kind: "mul",
              left: {
                kind: "add",
                left: { kind: "var", name: "p" },
                right: { kind: "const", value: 0 },
              },
              right: { kind: "const", value: 1 },
            },
            right: { kind: "const", value: 5 },
          },
          rel: "<=",
          rhs: 25,
        },
      ],
      domain: "constraint",
    });

    const activeLits = Array.from((coordinator as any).activeLiterals.values()) as TheoryLiteral[];
    const nonlinLit = activeLits.find((l) => l.predicate === "nonlinear");
    assert.ok(nonlinLit, "Nonlinear literal should be recorded");

    const simplifiedConstraint = nonlinLit!.args[0];
    // Constant 5 should be migrated to RHS: 25 - 5 = 20
    assert.equal(simplifiedConstraint.rhs, 20, "Constant offset should migrate to RHS: 25 - 5 = 20");
    // (p + 0) * 1 should simplify to variable p
    assert.equal(simplifiedConstraint.expr.kind, "var", "Expression should simplify directly to var 'p'");
    assert.equal(simplifiedConstraint.expr.name, "p");

    // Assert hyperplane with a zero coefficient: 2*x + 0*y + 3*z >= 10
    coordinator.assertLiteral({
      predicate: "hyperplane",
      args: [{ x: 2, y: 0, z: 3 }, ">=", 10],
      domain: "constraint",
    });

    const updatedActiveLits = Array.from((coordinator as any).activeLiterals.values()) as TheoryLiteral[];
    const hpLit = updatedActiveLits.find((l) => l.predicate === "hyperplane");
    assert.ok(hpLit);
    assert.deepEqual(hpLit!.args[0], { x: 2, z: 3 }, "Zero coefficient 'y: 0' should be pruned from hyperplane");
  });

  it("should forward Stage 0 contracted state space to downstream stages in UnifiedVerifier", async () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Initial bound: position in [10, 20]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["pos_x", 10, 20],
      domain: "constraint",
    });

    const ctx: VerificationInputContext = {
      uri: "file:///model/system.mo",
      coordinator,
    };

    const report = await UnifiedVerifier.verify(ctx, {
      theoryCoordinator: true,
      all: false,
    });

    assert.equal(report.summary.overallPassed, true);
    assert.ok(report.stages.theory_coordination, "Theory coordination stage should be present");
    assert.equal(report.stages.theory_coordination.passed, true);

    // Verify ctx.contractedStateSpace was forwarded from Stage 0
    assert.ok(ctx.contractedStateSpace, "Contracted state space should be forwarded into context");
    assert.ok(ctx.contractedStateSpace!.has("pos_x"), "pos_x should be in contracted state space");
    const bounds = ctx.contractedStateSpace!.get("pos_x");
    assert.equal(bounds?.[0], 10);
    assert.equal(bounds?.[1], 20);
  });
});
