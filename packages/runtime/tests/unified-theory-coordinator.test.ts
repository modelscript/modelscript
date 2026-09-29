// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import { OntologyTheoryOracle } from "../src/formal/oracles/index.js";
import { DigitalThreadHypergraph, SemanticTheoryCoordinator, UnifiedVerifier } from "../src/index.js";

const expect = (val: any) => ({
  toBe: (expected: any) => assert.strictEqual(val, expected),
  toEqual: (expected: any) => assert.deepStrictEqual(val, expected),
  toBeDefined: () => assert.notStrictEqual(val, undefined),
  toHaveLength: (n: number) => assert.strictEqual(val?.length, n),
  toContain: (str: string) => assert.ok(String(val).includes(str)),
});

describe("UnifiedVerifier with Stage 0 Semantic Theory Coordinator", () => {
  it("should run Stage 0 Theory Coordination when all: true", async () => {
    const report = await UnifiedVerifier.verify(
      {
        sourceText: `model Test
  parameter Real x = 1.0;
end Test;`,
      },
      { all: true },
    );

    expect(report.stages.theory_coordination).toBeDefined();
    expect(report.stages.theory_coordination.passed).toBe(true);
    expect(report.stages.theory_coordination.certified).toBe(true);
    expect(report.stages.theory_coordination.summary).toContain("All theory oracles mutually satisfiable");
  });

  it("should detect theory contradiction and flag conflict in report and hypergraph", async () => {
    const coordinator = new SemanticTheoryCoordinator();
    const ontology = new OntologyTheoryOracle();
    coordinator.registerOracle(ontology);

    // Assert disjoint concept contradiction: c1 :> ConceptA, c1 :> ConceptB where ConceptA disjoint ConceptB
    coordinator.assertLiteral({
      predicate: "disjoint",
      args: ["ConceptA", "ConceptB"],
      domain: "ontology",
    });
    coordinator.assertLiteral({
      predicate: "isa",
      args: ["c1", "ConceptA"],
      domain: "ontology",
    });
    coordinator.assertLiteral({
      predicate: "isa",
      args: ["c1", "ConceptB"],
      domain: "ontology",
    });

    const hypergraph = new DigitalThreadHypergraph();

    const report = await UnifiedVerifier.verify(
      {
        sourceText: "model Contradiction end Contradiction;",
        coordinator,
        hypergraph,
      },
      { theoryCoordinator: true, updateHypergraph: true },
    );

    expect(report.stages.theory_coordination).toBeDefined();
    expect(report.stages.theory_coordination.passed).toBe(false);
    expect(report.stages.theory_coordination.violations?.length).toBe(1);
    expect(report.stages.theory_coordination.violations?.[0].id).toBe("MSC-THEORY-CONFLICT");
    expect(report.stages.theory_coordination.summary).toContain("Ontological Conflict");

    // Hypergraph should be synchronized with conflict
    expect(hypergraph.isConflicted(0)).toBe(true);
    const recordedConflict = hypergraph.getConflict(0);
    expect(recordedConflict).toBeDefined();
    expect(recordedConflict?.explanation).toContain("Ontological Conflict");
  });
});
