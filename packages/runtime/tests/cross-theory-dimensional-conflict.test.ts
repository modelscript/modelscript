// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DimensionalTheoryOracle } from "../src/formal/oracles/dimensional_oracle.js";
import { OntologyTheoryOracle } from "../src/formal/oracles/ontology_oracle.js";
import { SemanticTheoryCoordinator } from "../src/formal/theory_coordinator.js";

describe("Semantic Theory Coordinator — Cross-Theory Dimensional Provenance", () => {
  it("should incorporate cross-theory ontology premise in dimensional conflict clause", () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    const dimensional = new DimensionalTheoryOracle();

    coordinator.registerOracle(ontology);
    coordinator.registerOracle(dimensional);

    // 1. Assert dimensional definitions for sensorA (kg) and sensorB (N)
    coordinator.assertLiteral({
      id: 201,
      predicate: "dimension",
      args: ["sensorA", "kg"],
      domain: "constraint",
      isNegated: false,
    });

    coordinator.assertLiteral({
      id: 202,
      predicate: "dimension",
      args: ["sensorB", "N"],
      domain: "constraint",
      isNegated: false,
    });

    // Verify initial SAT before ontology unification
    const initialSat = coordinator.checkSat();
    assert.strictEqual(initialSat.isSat, true);

    // 2. Assert ontology sameIndividual linking sensorA and sensorB with specific literal ID 101
    coordinator.assertLiteral({
      id: 101,
      predicate: "sameIndividual",
      args: ["sensorA", "sensorB"],
      domain: "concept",
      isNegated: false,
    });

    // 3. Coordinator checkSat should detect the cross-theory dimensional conflict
    const conflictResult = coordinator.checkSat();
    assert.strictEqual(conflictResult.isSat, false, "Should detect dimensional inconsistency across theories");
    assert.ok(conflictResult.conflict, "Should produce a conflict clause");

    // 4. Verify conflict literals contain the cross-theory premise (101) as well as the dimensional definitions
    const conflictLitIds = conflictResult.conflict.literals.map((l) => l.id);
    assert.ok(
      conflictLitIds.includes(101),
      `Conflict clause must contain ontology sameIndividual premise ID 101. Found: [${conflictLitIds.join(", ")}]`,
    );
    assert.ok(
      conflictLitIds.includes(201) || conflictLitIds.includes(202),
      `Conflict clause must include dimensional definition premises. Found: [${conflictLitIds.join(", ")}]`,
    );
    assert.ok(
      conflictResult.conflict.explanation.includes("Dimensional Inconsistency"),
      "Explanation should detail dimensional inconsistency",
    );
  });
});
