// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConstraintTheoryOracle, OntologyTheoryOracle, SemanticTheoryCoordinator } from "../src/index.js";

describe("Semantic Theory Coordinator — Bound Tightening & Equivalence Upgrades", () => {
  it("should propagate subsequent bound contractions to all aliased variables even after equality is registered", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const constraints = new ConstraintTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(constraints);

    // 1. Initial wide bounds on varA and varB
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["varA", 0, 100],
      domain: "constraint",
    });

    coordinator.assertLiteral({
      predicate: "interval",
      args: ["varB", 0, 100],
      domain: "constraint",
    });

    // 2. Ontology unifies varA and varB
    coordinator.assertLiteral({
      predicate: "sameIndividual",
      args: ["varA", "varB"],
      domain: "ontology",
    });

    const initialRes = coordinator.checkSat();
    assert.equal(initialRes.isSat, true);

    // Initial bounds should be [0, 100]
    let intA = constraints.getInterval("varA");
    let intB = constraints.getInterval("varB");
    assert.equal(intA?.lo, 0);
    assert.equal(intA?.hi, 100);
    assert.equal(intB?.lo, 0);
    assert.equal(intB?.hi, 100);

    // 3. Later, an oracle or user asserts tighter bound on varA: [20, 50]
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["varA", 20, 50],
      domain: "constraint",
    });

    const tightenedRes = coordinator.checkSat();
    assert.equal(tightenedRes.isSat, true);

    // BOTH varA and varB must be contracted to [20, 50] through equality sharing
    intA = constraints.getInterval("varA");
    intB = constraints.getInterval("varB");
    assert.ok(intA);
    assert.ok(intB);
    assert.equal(intA!.lo, 20, "varA lower bound should be 20");
    assert.equal(intA!.hi, 50, "varA upper bound should be 50");
    assert.equal(intB!.lo, 20, "varB lower bound should be tightened to 20");
    assert.equal(intB!.hi, 50, "varB upper bound should be tightened to 50");

    // 4. Tightening varB to [30, 40] must also propagate back to varA
    coordinator.assertLiteral({
      predicate: "interval",
      args: ["varB", 30, 40],
      domain: "constraint",
    });

    const furtherTightened = coordinator.checkSat();
    assert.equal(furtherTightened.isSat, true);

    intA = constraints.getInterval("varA");
    intB = constraints.getInterval("varB");
    assert.equal(intA!.lo, 30);
    assert.equal(intA!.hi, 40);
    assert.equal(intB!.lo, 30);
    assert.equal(intB!.hi, 40);

    // 5. Contradiction: assert varB >= 60 triggers UNSAT across the shared equivalence class
    coordinator.pushLevel();
    coordinator.assertLiteral({
      predicate: "bound",
      args: ["varB", ">=", 60],
      domain: "constraint",
    });

    const unsatRes = coordinator.checkSat();
    assert.equal(unsatRes.isSat, false);

    // 6. Pop level restores valid state [30, 40]
    coordinator.popLevel();
    const restoredRes = coordinator.checkSat();
    assert.equal(restoredRes.isSat, true);
    intA = constraints.getInterval("varA");
    assert.equal(intA!.lo, 30);
    assert.equal(intA!.hi, 40);
  });
});
