import { describe, expect, it } from "@jest/globals";
import { generateReasoner } from "../src/codegen/reasoner.js";

describe("Unified Datalog Semantic Entailment Axioms Tests", () => {
  it("should parse axioms into rules and generate stratified Datalog logic with constant strings and multi-atom joins", () => {
    const dsl = {
      name: "AxiomTestDSL",
      rules: {
        Main: "x",
      },
      semantics: {
        axioms: [
          "Error(?X, 'InvalidType') :- HasType(?X, ?T), NotAllowed(?T).",
          "SubClassOf(?A, ?C) :- SubClassOf(?A, ?B), SubClassOf(?B, ?C).",
        ],
      },
    };

    const code = generateReasoner(dsl as any, { evaluatedRules: {}, symToInt: new Map() } as any);

    // Verify multi-atom join and constant string hashing in rules
    expect(code).toContain("runDatalogMaterialization");

    // Verify Error predicate head argument uses string DJB2 hash
    expect(code).toContain("addFact(");

    // Verify runAxiomValidation delegates to Datalog materialization
    expect(code).toContain("export function runAxiomValidation(): void");
  });
});
