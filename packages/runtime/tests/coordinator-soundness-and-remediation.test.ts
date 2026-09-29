// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConstraintTheoryOracle, OntologyTheoryOracle, SemanticTheoryCoordinator } from "../src/index.js";

describe("Semantic Theory Coordinator — Remediation & Upgrades Verification", () => {
  it("should track literal justifications across theories and generate sound conflict clauses", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const constraints = new ConstraintTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(constraints);

    // 1. Assert cross-theory equality: moduleX === moduleY
    const eqLitId = coordinator.assertLiteral({
      predicate: "sameIndividual",
      args: ["moduleX", "moduleY"],
      domain: "ontology",
    });

    // 2. Assert lower bound on moduleX: moduleX >= 50
    const boundALitId = coordinator.assertLiteral({
      predicate: "bound",
      args: ["moduleX", ">=", 50],
      domain: "constraint",
    });

    // 3. Assert conflicting upper bound on moduleY: moduleY <= 40
    const boundBLitId = coordinator.assertLiteral({
      predicate: "bound",
      args: ["moduleY", "<=", 40],
      domain: "constraint",
    });

    const res = coordinator.checkSat();
    assert.equal(res.status, "UNSAT", "Status should be formally UNSAT");
    assert.equal(res.isSat, false);
    assert.ok(res.conflict, "Conflict clause must be present");

    // The conflict literals MUST include eqLitId (cross-theory justification) AND constraint literals!
    const conflictLitIds = res.conflict!.literals.map((l) => l.id);
    assert.ok(
      conflictLitIds.includes(eqLitId),
      `Conflict clause must contain the cross-theory equality premise (${eqLitId}), got: [${conflictLitIds}]`,
    );
    assert.ok(
      conflictLitIds.includes(boundALitId) || conflictLitIds.includes(boundBLitId),
      "Conflict clause must contain the conflicting bound premises",
    );
  });

  it("should return status: 'UNKNOWN' and isSat: false when maxIterations is exhausted without reaching fixpoint", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Enqueue an event
    coordinator.enqueueEvent({
      kind: "bound",
      varName: "pressure",
      bounds: [100, 200],
      sourceOracle: "sensor",
    });

    // Run checkSat with maxIterations = 0 so it cannot drain the worklist
    const res = coordinator.checkSat(0);
    assert.equal(res.status, "UNKNOWN", "Should return UNKNOWN when iteration limit is reached before fixpoint");
    assert.equal(res.isSat, false, "isSat must be false when status is UNKNOWN");
    assert.ok(res.reason?.includes("Contraction iteration limit"), "Reason should mention iteration limit");
  });

  it("should support 4 nested decision levels with clean popLevel without wiping levelStack", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const constraints = new ConstraintTheoryOracle();
    coordinator.registerOracle(constraints);

    // Level 0: base bound x in [0, 100]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["x", 0, 100],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true);

    // Level 1: x in [10, 90]
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["x", 10, 90],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 10);
    assert.equal(constraints.getInterval("x")?.hi, 90);

    // Level 2: x in [20, 80]
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["x", 20, 80],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 20);

    // Level 3: x in [30, 70]
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["x", 30, 70],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 30);

    // Level 4: Contradiction x >= 150
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["x", ">=", 150],
      domain: "constraint",
    });
    assert.equal(coordinator.checkSat().isSat, false);

    // Pop Level 4 -> back to Level 3 [30, 70]
    coordinator.popLevel();
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 30);
    assert.equal(constraints.getInterval("x")?.hi, 70);

    // Pop Level 3 -> back to Level 2 [20, 80]
    coordinator.popLevel();
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 20);
    assert.equal(constraints.getInterval("x")?.hi, 80);

    // Pop Level 2 -> back to Level 1 [10, 90]
    coordinator.popLevel();
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 10);
    assert.equal(constraints.getInterval("x")?.hi, 90);

    // Pop Level 1 -> back to Level 0 [0, 100]
    coordinator.popLevel();
    assert.equal(coordinator.checkSat().isSat, true);
    assert.equal(constraints.getInterval("x")?.lo, 0);
    assert.equal(constraints.getInterval("x")?.hi, 100);
  });
});
