// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AbstractDomainOracle,
  ConstraintTheoryOracle,
  DimensionalTheoryOracle,
  OntologyTheoryOracle,
  SemanticTheoryCoordinator,
} from "../src/index.js";

describe("Semantic Theory Coordinator — Incremental Retraction & Trail-Based Backtracking", () => {
  it("should support multi-level pushLevel and popLevel across heterogeneous oracles without loss of shared state", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const constraints = new ConstraintTheoryOracle();
    const octagon = new AbstractDomainOracle();
    const dimensional = new DimensionalTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(constraints);
    coordinator.registerOracle(octagon);
    coordinator.registerOracle(dimensional);

    // Level 0 (Base level):
    // Individual declarations & types
    coordinator.assertLiteral({
      predicate: "type",
      args: ["engine1", "CombustionEngine"],
      domain: "ontology",
    });

    coordinator.assertLiteral({
      predicate: "sameIndividual",
      args: ["engine1", "powertrainMotor"],
      domain: "ontology",
    });

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["engine1", 50, 150],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "dimension",
      args: ["engine1", "kg"],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "time_succession",
      args: ["Ignition", "Injection", 1, 5],
      domain: "abstract_domain",
    });

    const baseRes = coordinator.checkSat();
    assert.equal(baseRes.isSat, true, "Base level should be SAT");

    // Level 1: Push decision level and assert non-conflicting hypothesis
    coordinator.pushLevel();
    const hypLit = coordinator.assertLiteral({
      predicate: "interval",
      args: ["powertrainMotor", 80, 120],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "time_succession",
      args: ["Injection", "Exhaust", 2, 4],
      domain: "abstract_domain",
    });

    const level1Res = coordinator.checkSat();
    assert.equal(level1Res.isSat, true, "Level 1 should be SAT");
    assert.equal(constraints.getInterval("engine1")?.lo, 80);
    assert.equal(constraints.getInterval("engine1")?.hi, 120);

    // Level 2: Push conflicting decision (dimensional contradiction)
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "dimension",
      args: ["powertrainMotor", "N"],
      domain: "constraint",
    });
    coordinator.assertLiteral({
      predicate: "equal",
      args: ["engine1", "powertrainMotor"],
      domain: "constraint",
    });

    const level2Res = coordinator.checkSat();
    assert.equal(level2Res.isSat, false, "Level 2 must be UNSAT due to dimensional conflict (kg vs N)");

    // Pop Level 2: Dimensional conflict must be cleanly rolled back
    coordinator.popLevel();
    const restoredL1 = coordinator.checkSat();
    assert.equal(restoredL1.isSat, true, "Level 1 should be restored to SAT after popLevel()");

    // Level 2 alternative: Push negative cycle into Octagon DBM
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "time_succession",
      args: ["Exhaust", "Ignition", 10, 20], // Causes loop: Ignition -> Injection (>=1) -> Exhaust (>=2) -> Ignition (>=10) => loop >= 13
      domain: "abstract_domain",
    });

    const dcmConflict = coordinator.checkSat();
    assert.equal(dcmConflict.isSat, false, "Negative cycle in Octagon must be detected");

    // Pop Level 2 alternative: Octagon DBM negative cycle must be cleanly rolled back
    coordinator.popLevel();
    const restoredL1Again = coordinator.checkSat();
    assert.equal(restoredL1Again.isSat, true, "Level 1 should be SAT again");

    // Pop Level 1: Restores base level [50, 150]
    coordinator.popLevel();
    const restoredBase = coordinator.checkSat();
    assert.equal(restoredBase.isSat, true, "Base level should be restored to SAT");
    assert.equal(constraints.getInterval("engine1")?.lo, 50);
    assert.equal(constraints.getInterval("engine1")?.hi, 150);
  });
});
