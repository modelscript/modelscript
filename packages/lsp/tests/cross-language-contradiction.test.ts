// SPDX-License-Identifier: AGPL-3.0-or-later

import { LanguageWorkspaceIndex, UnifiedWorkspace, type OWL2Axiom } from "@modelscript/runtime";
import assert from "node:assert";
import { describe, it } from "node:test";
import { ValidationService } from "../src/services/validation-service.js";

describe("Cross-Language Incremental Verification (Modelica + OWL2)", () => {
  it("should incrementally detect semantic contradiction across Modelica and OWL2 and route squiggles to both documents", async () => {
    const moUri = "memfs:owl2-contradiction/system.mo";
    const owlUri = "memfs:owl2-contradiction/constraints.owl";

    const moDocText = [
      "class ElectricalDevice",
      "end ElectricalDevice;",
      "",
      "class MechanicalDevice",
      "end MechanicalDevice;",
      "",
      "class Motor",
      "  extends ElectricalDevice;",
      "  extends MechanicalDevice;",
      "end Motor;",
    ].join("\n");

    const owlDocText = [
      "Prefix(mo: = <http://modelscript.org/modelica#>)",
      "Ontology(<http://modelscript.org/examples/contradiction>",
      "  Declaration(Class(mo:ElectricalDevice))",
      "  Declaration(Class(mo:MechanicalDevice))",
      "  DisjointClasses(mo:ElectricalDevice mo:MechanicalDevice)",
      ")",
    ].join("\n");

    const sentDiagnostics: { uri: string; diagnostics: any[] }[] = [];

    const mockConnection: any = {
      console: { log: () => {}, error: () => {}, warn: () => {}, info: () => {} },
      sendDiagnostics: (params: { uri: string; diagnostics: any[] }) => {
        sentDiagnostics.push(params);
      },
      sendNotification: () => {},
    };

    const mockDocManager: any = {
      documents: new Map([
        [
          moUri,
          {
            uri: moUri,
            languageId: "modelica",
            version: 1,
            getText: () => moDocText,
            positionAt: (offset: number) => {
              const lines = moDocText.substring(0, offset).split("\n");
              return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
            },
          },
        ],
        [
          owlUri,
          {
            uri: owlUri,
            languageId: "owl2",
            version: 1,
            getText: () => owlDocText,
            positionAt: (offset: number) => {
              const lines = owlDocText.substring(0, offset).split("\n");
              return { line: lines.length - 1, character: lines[lines.length - 1]!.length };
            },
          },
        ],
      ]),
      documentTrees: new Map(),
      lazyLibTrees: new Map(),
    };

    const unifiedWs = new UnifiedWorkspace();
    const moIndex = new LanguageWorkspaceIndex([
      { ruleName: "class_definition", kind: "Class", namePath: "name" },
      { ruleName: "extends_clause", kind: "Extends", namePath: "type_specifier" },
    ]);

    // Construct AST representation for system.mo
    const createMoAst = (includeMechanicalExtends: boolean) => ({
      type: "source_file",
      children: [
        {
          type: "class_definition",
          name: "ElectricalDevice",
          children: [{ type: "name", text: "ElectricalDevice" }],
          startByte: 0,
          endByte: 45,
        },
        {
          type: "class_definition",
          name: "MechanicalDevice",
          children: [{ type: "name", text: "MechanicalDevice" }],
          startByte: 47,
          endByte: 92,
        },
        {
          type: "class_definition",
          name: "Motor",
          children: [
            { type: "name", text: "Motor" },
            {
              type: "extends_clause",
              name: "ElectricalDevice",
              children: [{ type: "type_specifier", text: "ElectricalDevice" }],
              startByte: 110,
              endByte: 135,
            },
            ...(includeMechanicalExtends
              ? [
                  {
                    type: "extends_clause",
                    name: "MechanicalDevice",
                    children: [{ type: "type_specifier", text: "MechanicalDevice" }],
                    startByte: 138,
                    endByte: 163,
                  },
                ]
              : []),
          ],
          startByte: 94,
          endByte: includeMechanicalExtends ? 173 : 145,
        },
      ],
    });

    moIndex.indexDocument(moUri, () => createMoAst(true));
    unifiedWs.registerWorkspace("modelica", moIndex);

    // Seed OWL2 ontology constraints into unified workspace store
    const owlAxioms: OWL2Axiom[] = [
      { type: "ClassDeclaration", iri: "mo:ElectricalDevice", sourceLang: "owl2" },
      { type: "ClassDeclaration", iri: "mo:MechanicalDevice", sourceLang: "owl2" },
      {
        type: "DisjointClasses",
        classIris: ["mo:ElectricalDevice", "mo:MechanicalDevice"],
        sourceLang: "owl2",
      },
    ];
    unifiedWs.owl2Store.setAxioms(owlUri, owlAxioms);

    const mockWorkspaceManager: any = {
      unifiedWorkspace: unifiedWs,
      getWorkspaceIndex: (lang: string) => (lang === "modelica" ? moIndex : null),
    };

    const validationService = new (ValidationService as any)(mockConnection, mockDocManager, mockWorkspaceManager, {
      sharedContext: null,
      getParserForUri: () => null,
    } as any);

    // 1. Initial State: Run postValidateModelicaReasoner for system.mo
    const moDiagnostics: any[] = [];
    (validationService as any).postValidateModelicaReasoner(moUri, moDiagnostics);

    // Verify diagnostic produced on system.mo pointing to class Motor
    assert.ok(moDiagnostics.length > 0, "system.mo must receive a contradiction diagnostic");
    const motorDiag = moDiagnostics.find((d) => d.range.start.line === 6);
    assert.ok(motorDiag, "Diagnostic must explain disjoint inheritance for Motor");
    assert.strictEqual(motorDiag.source, "modelica-reasoner");
    assert.strictEqual(motorDiag.range.start.line, 6, "Must locate class Motor on line 6");
    assert.ok(
      motorDiag.message.includes("Class 'mo:Motor' cannot inherit from both"),
      "Message must describe disjoint inheritance",
    );

    // Verify diagnostic was also routed and pushed to constraints.owl in real-time
    const owlSent = sentDiagnostics.find((s) => s.uri === owlUri);
    assert.ok(owlSent && owlSent.diagnostics.length > 0, "constraints.owl must receive cross-domain diagnostic");
    assert.ok(
      owlSent.diagnostics.some((d) => d.message.includes("Class 'mo:Motor' cannot inherit from both")),
      "constraints.owl diagnostic must explain contradiction",
    );

    // Verify both files are tracked in reasonerDiagnosticsByUri
    assert.ok(validationService.reasonerDiagnosticsByUri.has(moUri));
    assert.ok(validationService.reasonerDiagnosticsByUri.has(owlUri));

    // 2. Incremental Mutation: Remove extends MechanicalDevice from Motor
    sentDiagnostics.length = 0;
    moIndex.indexDocument(moUri, () => createMoAst(false));

    const clearedMoDiagnostics: any[] = [];
    (validationService as any).postValidateModelicaReasoner(moUri, clearedMoDiagnostics);

    // Verify contradiction is resolved and squiggles cleared
    assert.strictEqual(clearedMoDiagnostics.length, 0, "system.mo diagnostics must be cleared");
    assert.strictEqual(
      validationService.reasonerDiagnosticsByUri.has(moUri),
      false,
      "system.mo reasoner tracking cleared",
    );
    assert.strictEqual(
      validationService.reasonerDiagnosticsByUri.has(owlUri),
      false,
      "constraints.owl reasoner tracking cleared",
    );

    // Verify clearing message sent to constraints.owl
    const owlClearedSent = sentDiagnostics.find((s) => s.uri === owlUri);
    assert.ok(owlClearedSent, "Notification sent to constraints.owl");
    assert.strictEqual(owlClearedSent.diagnostics.length, 0, "constraints.owl diagnostics cleared");
  });
});
