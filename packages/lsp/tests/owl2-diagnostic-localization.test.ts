// SPDX-License-Identifier: AGPL-3.0-or-later

import { TableauReasoner, type OWL2Axiom } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { ValidationService } from "../src/services/validation-service.js";

describe("OWL2 Diagnostic Localization and Reasoner Explanations", () => {
  const ontologyAxioms: OWL2Axiom[] = [
    {
      type: "ClassDeclaration",
      iri: "mo:ElectricalDevice",
    },
    {
      type: "ClassDeclaration",
      iri: "mo:MechanicalDevice",
    },
    {
      type: "DisjointClasses",
      classIris: ["mo:ElectricalDevice", "mo:MechanicalDevice"],
    },
    {
      type: "ClassDeclaration",
      iri: "mo:ElectroMechanicalDevice",
    },
    {
      type: "SubClassOf",
      subClassIri: "mo:ElectroMechanicalDevice",
      superClassIri: "mo:ElectricalDevice",
    },
    {
      type: "SubClassOf",
      subClassIri: "mo:ElectroMechanicalDevice",
      superClassIri: "mo:MechanicalDevice",
    },
  ];

  it("should explain disjoint class inheritance contradiction with class names", async () => {
    const reasoner = new TableauReasoner();
    await reasoner.init();
    reasoner.loadOntology(ontologyAxioms);
    const result = reasoner.checkConsistency();

    assert.strictEqual(result.isConsistent, false, "Ontology must be inconsistent");
    assert.ok(result.explanation, "Explanation must be present");
    assert.strictEqual(
      result.explanation,
      "Class 'mo:ElectroMechanicalDevice' cannot inherit from both 'mo:ElectricalDevice' and 'mo:MechanicalDevice' because they are declared disjoint.",
    );

    assert.ok(result.conflictingAxioms && result.conflictingAxioms.length > 0);
    const disjointConflict = result.conflictingAxioms.find((a) => a.type === "DisjointClasses");
    assert.ok(disjointConflict, "DisjointClasses conflict axiom must be present");
    assert.strictEqual(
      (disjointConflict as any).subClassIri,
      "mo:ElectroMechanicalDevice",
      "subClassIri must be tracked in conflict",
    );

    assert.ok(result.minimalConflictCore && result.minimalConflictCore.length > 0);
  });

  it("should localize diagnostic to the conflicting class in the document rather than line 0 Prefix", async () => {
    const mockDocText = [
      "Prefix(mo: = <http://modelscript.org/modelica#>)",
      "Ontology(<http://modelscript.org/examples/contradiction>",
      "  Import(<http://modelscript.org/modelica#>)",
      "  Declaration(Class(mo:ElectricalDevice))",
      "  Declaration(Class(mo:MechanicalDevice))",
      "  DisjointClasses(mo:ElectricalDevice mo:MechanicalDevice)",
      "  Declaration(Class(mo:ElectroMechanicalDevice))",
      "  SubClassOf(mo:ElectroMechanicalDevice mo:ElectricalDevice)",
      "  SubClassOf(mo:ElectroMechanicalDevice mo:MechanicalDevice)",
      ")",
    ].join("\n");

    const testUri = "memfs:owl2-contradiction/constraints.owl";

    const mockDoc = {
      uri: testUri,
      languageId: "owl2",
      version: 1,
      getText: () => mockDocText,
      positionAt: (offset: number) => {
        const lines = mockDocText.substring(0, offset).split("\n");
        return {
          line: lines.length - 1,
          character: lines[lines.length - 1]!.length,
        };
      },
    };

    const mockDocManager = {
      documents: new Map([[testUri, mockDoc]]),
      documentTrees: new Map(),
    };

    const mockWorkspaceManager = {
      unifiedWorkspace: {
        toUnifiedPartial: () => ({
          symbols: new Map(),
          byName: new Map(),
          childrenOf: new Map(),
        }),
        owl2Store: {
          axioms: ontologyAxioms,
          setAxioms: () => {},
        },
      },
    };

    const mockConnection = {
      console: { info: () => {}, error: () => {}, log: () => {}, warn: () => {} },
      sendNotification: () => {},
    };

    const validationService = new (ValidationService as any)(
      mockConnection as any,
      mockDocManager,
      mockWorkspaceManager,
      {} as any, // parserService
    );

    const range = validationService.findRangeForIri("mo:ElectroMechanicalDevice", testUri);
    assert.ok(range, "findRangeForIri must find a range for mo:ElectroMechanicalDevice");
    // Declaration(Class(mo:ElectroMechanicalDevice)) is on line 6 (0-indexed)
    assert.strictEqual(range.start.line, 6, "Must pinpoint line 6 where class is declared");
    assert.ok(range.start.character > 0, "Character offset must be non-zero");

    // Test full postValidateOwl2 flow
    const diagnostics: any[] = [];
    const mockTree = { rootNode: {} };
    await (validationService as any).postValidateOwl2(testUri, mockTree, mockDocText, diagnostics);
    assert.ok(diagnostics.length > 0, "Diagnostics must be produced for contradiction");
    assert.ok(
      diagnostics.some((d: any) =>
        d.message.includes(
          "Class 'mo:ElectroMechanicalDevice' cannot inherit from both 'mo:ElectricalDevice' and 'mo:MechanicalDevice' because they are declared disjoint.",
        ),
      ),
      "Diagnostic message must include detailed inconsistency explanation",
    );
    assert.ok(
      diagnostics.every((d: any) => !(d.range.start.line === 0 && d.range.end.character === 10)),
      "Diagnostic must not fall back to line 0 Prefix (0:0-0:10)",
    );
  });

  it("should index both prefixed and unqualified names in LanguageWorkspaceIndex", async () => {
    const { LanguageWorkspaceIndex } = await import("@modelscript/runtime");
    const hooks = [
      {
        ruleName: "ClassDeclaration",
        kind: "Class",
        namePath: "name",
      },
    ];
    const index = new LanguageWorkspaceIndex(hooks);
    const mockTree = {
      type: "ClassDeclaration",
      children: [{ type: "name", text: "mo:ElectricalDevice" }],
      startByte: 10,
      endByte: 35,
    };

    index.indexDocument("memfs:test.owl", () => mockTree);
    const partial = index.toUnifiedPartial();

    assert.ok(partial.byName.has("mo:ElectricalDevice"), "Must have prefixed name");
    assert.ok(partial.byName.has("ElectricalDevice"), "Must have unqualified name");
    const prefixedIds = partial.byName.get("mo:ElectricalDevice");
    const unqualifiedIds = partial.byName.get("ElectricalDevice");
    assert.ok(prefixedIds && prefixedIds.length > 0);
    assert.ok(unqualifiedIds && unqualifiedIds.length > 0);
    assert.strictEqual(prefixedIds[0], unqualifiedIds[0]);
  });
});
