// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWasmParser } from "@modelscript/dsl/bindings";
import { TableauReasoner, UnifiedWorkspace } from "@modelscript/runtime";
import {
  createOWL2QueryEngine,
  createOWL2WorkspaceIndex,
  lowerCstToAxioms,
  type GenericSyntaxNode,
} from "../src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log("=================================================");
  console.log("Running OWL2 Pipeline & Integration Tests");
  console.log("=================================================");

  // ---------------------------------------------------------------------------
  // Test 1: CST Lowering from Structured CST Nodes
  // ---------------------------------------------------------------------------
  console.log("\n[Test 1] Testing lowerCstToAxioms with comprehensive AST nodes...");

  const mockCst: GenericSyntaxNode = {
    type: "OntologyDocument",
    children: [
      {
        type: "PrefixDeclaration",
        children: [
          { type: "PrefixName", text: ":" },
          { type: "FullIRI", text: "<http://example.org/test#>" },
        ],
      },
      {
        type: "Ontology",
        children: [
          {
            type: "Declaration",
            children: [{ type: "ClassEntity", children: [{ type: "AbbreviatedIRI", text: ":Vehicle" }] }],
          },
          {
            type: "Declaration",
            children: [{ type: "ClassEntity", children: [{ type: "AbbreviatedIRI", text: ":Car" }] }],
          },
          {
            type: "Declaration",
            children: [{ type: "ClassEntity", children: [{ type: "AbbreviatedIRI", text: ":Bicycle" }] }],
          },
          {
            type: "Declaration",
            children: [{ type: "ObjectPropertyEntity", children: [{ type: "AbbreviatedIRI", text: ":hasEngine" }] }],
          },
          {
            type: "Declaration",
            children: [{ type: "NamedIndividualEntity", children: [{ type: "AbbreviatedIRI", text: ":myCar" }] }],
          },
          {
            type: "SubClassOfAxiom",
            children: [
              { type: "AbbreviatedIRI", text: ":Car" },
              { type: "AbbreviatedIRI", text: ":Vehicle" },
            ],
          },
          {
            type: "DisjointClassesAxiom",
            children: [
              { type: "AbbreviatedIRI", text: ":Car" },
              { type: "AbbreviatedIRI", text: ":Bicycle" },
            ],
          },
          {
            type: "FunctionalObjectPropertyAxiom",
            children: [{ type: "AbbreviatedIRI", text: ":hasEngine" }],
          },
          {
            type: "SymmetricObjectPropertyAxiom",
            children: [{ type: "AbbreviatedIRI", text: ":connectedTo" }],
          },
          {
            type: "ClassAssertionAxiom",
            children: [
              { type: "AbbreviatedIRI", text: ":Car" },
              { type: "AbbreviatedIRI", text: ":myCar" },
            ],
          },
          {
            type: "ObjectPropertyAssertionAxiom",
            children: [
              { type: "AbbreviatedIRI", text: ":hasEngine" },
              { type: "AbbreviatedIRI", text: ":myCar" },
              { type: "AbbreviatedIRI", text: ":v8Engine" },
            ],
          },
          {
            type: "SubClassOfAxiom",
            children: [
              { type: "AbbreviatedIRI", text: ":Car" },
              {
                type: "ObjectSomeValuesFrom",
                children: [
                  { type: "AbbreviatedIRI", text: ":hasEngine" },
                  { type: "AbbreviatedIRI", text: ":Engine" },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const lowered = lowerCstToAxioms(mockCst);
  assert.ok(lowered.length >= 10, `Expected at least 10 axioms, got ${lowered.length}`);

  const classDecls = lowered.filter((a) => a.type === "ClassDeclaration");
  assert.strictEqual(classDecls.length, 3, "Expected 3 ClassDeclarations (:Vehicle, :Car, :Bicycle)");

  const subClasses = lowered.filter((a) => a.type === "SubClassOf");
  assert.ok(
    subClasses.some((a: any) => a.subClassIri === ":Car" && a.superClassIri === ":Vehicle"),
    "SubClassOf(:Car :Vehicle) not found",
  );

  const disjoints = lowered.filter((a) => a.type === "DisjointClasses");
  assert.strictEqual(disjoints.length, 1, "Expected 1 DisjointClasses axiom");

  const funcProps = lowered.filter((a) => a.type === "FunctionalObjectProperty");
  assert.strictEqual(funcProps.length, 1, "Expected 1 FunctionalObjectProperty axiom");

  const symProps = lowered.filter((a) => a.type === "SymmetricObjectProperty");
  assert.strictEqual(symProps.length, 1, "Expected 1 SymmetricObjectProperty axiom");

  const existentials = lowered.filter((a) => a.type === "ObjectSomeValuesFrom");
  assert.strictEqual(existentials.length, 1, "Expected 1 ObjectSomeValuesFrom restriction");

  console.log("✔ lowerCstToAxioms correctly lowered all axiom kinds.");

  // ---------------------------------------------------------------------------
  // Test 2: Reasoning over Lowered Axioms
  // ---------------------------------------------------------------------------
  console.log("\n[Test 2] Reasoning over lowered axioms via TableauReasoner...");

  const reasoner = new TableauReasoner();
  await reasoner.init();
  reasoner.loadOntology(lowered);
  reasoner.classify();

  const subCheck = reasoner.isSubClassOf(":Car", ":Vehicle");
  assert.strictEqual(subCheck.holds, true, ":Car should be a subClass of :Vehicle");

  const consistency1 = reasoner.checkConsistency();
  assert.strictEqual(consistency1.isConsistent, true, "Ontology should be consistent");
  console.log("✔ Taxonomy classified and verified consistent.");

  // Introduce contradiction: :myCar is also asserted to be a :Bicycle (disjoint with :Car)
  console.log("Introducing contradiction (:myCar :Bicycle)...");
  reasoner.applyDelta({
    retractions: [],
    assertions: [{ type: "ClassAssertion", individualIri: ":myCar", classIri: ":Bicycle", sourceLang: "owl2" }],
  });
  reasoner.classify();

  const consistency2 = reasoner.checkConsistency();
  assert.strictEqual(consistency2.isConsistent, false, "Ontology must detect disjoint class conflict");
  assert.ok(
    consistency2.minimalConflictCore && consistency2.minimalConflictCore.length > 0,
    "Conflict core must be extracted",
  );
  console.log("✔ Inconsistency detected and Minimal Conflict Core extracted.");

  // ---------------------------------------------------------------------------
  // Test 3: WorkspaceIndex & Factory Initialization
  // ---------------------------------------------------------------------------
  console.log("\n[Test 3] Testing createOWL2WorkspaceIndex and query engine...");

  const wIndex = createOWL2WorkspaceIndex();
  assert.ok(wIndex, "WorkspaceIndex should be created");
  assert.strictEqual(typeof wIndex.register, "function", "WorkspaceIndex must have register method");

  const queryEngine = createOWL2QueryEngine(wIndex.toUnifiedPartial());
  assert.ok(queryEngine, "QueryEngine should be created");
  console.log("✔ OWL2 WorkspaceIndex and QueryEngine created successfully.");

  // ---------------------------------------------------------------------------
  // Test 4: Polyglot Workspace Integration & Store Projection
  // ---------------------------------------------------------------------------
  console.log("\n[Test 4] Testing polyglot projection into WasmOntologyStore...");

  const unifiedWs = new UnifiedWorkspace();
  const store = unifiedWs.owl2Store;
  assert.ok(store, "UnifiedWorkspace must have owl2Store");
  assert.strictEqual(store.workspace, unifiedWs, "owl2Store must reference the workspace");

  store.registerSourceLanguage("modelica");
  store.registerSourceLanguage("sysml2");

  // Ingest manual axioms for a test source
  store.setAxioms("modelica", [
    { type: "ClassDeclaration", iri: "mo:Resistor", sourceLang: "modelica" },
    { type: "ClassDeclaration", iri: "mo:TwoPin", sourceLang: "modelica" },
    { type: "SubClassOf", subClassIri: "mo:Resistor", superClassIri: "mo:TwoPin", sourceLang: "modelica" },
  ]);

  assert.strictEqual(store.getSuperClasses("mo:Resistor").length, 1);
  assert.strictEqual(store.getSuperClasses("mo:Resistor")[0]?.superClassIri, "mo:TwoPin");
  console.log("✔ Polyglot store axioms verified.");

  // ---------------------------------------------------------------------------
  // Test 5: WASM Parser End-to-End
  // ---------------------------------------------------------------------------
  const wasmPath = path.resolve(__dirname, "../dist/parser.wasm");
  if (fs.existsSync(wasmPath)) {
    console.log("\n[Test 5] Testing WASM parser end-to-end on Functional-Style Syntax...");
    const { parser } = await createWasmParser(wasmPath);

    const fssSource = `
Prefix(: = <http://example.org/electrical#>)
Ontology(
  Declaration(Class(:ElectricalDevice))
  Declaration(Class(:Battery))
  Declaration(ObjectProperty(:suppliesPowerTo))
  Declaration(NamedIndividual(:bat1))
  SubClassOf(:Battery :ElectricalDevice)
  FunctionalObjectProperty(:suppliesPowerTo)
  ClassAssertion(:Battery :bat1)
)
`.trim();

    const tree = parser.parse(fssSource);
    assert.ok(tree, "Parser should produce a tree");
    assert.ok(tree.rootNode, "Tree should have rootNode");

    const parsedAxioms = lowerCstToAxioms(tree.rootNode, fssSource);
    assert.ok(parsedAxioms.length >= 5, `Expected at least 5 axioms, got ${parsedAxioms.length}`);

    const batterySub = parsedAxioms.find((a) => a.type === "SubClassOf" && (a as any).subClassIri === ":Battery");
    assert.ok(batterySub, "SubClassOf(:Battery :ElectricalDevice) should be parsed and lowered");
    console.log("✔ WASM parser end-to-end parsing and lowering verified.");
  } else {
    console.log("\n[Test 5] parser.wasm not found, skipping direct wasm test.");
  }

  console.log("\n=================================================");
  console.log("ALL OWL2 TESTS PASSED SUCCESSFULLY!");
  console.log("=================================================");
}

runTests().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
