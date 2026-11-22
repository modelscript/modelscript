// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AXIOM_CLASS_ASSERT,
  AXIOM_DISJOINT_CLASSES,
  AXIOM_OBJ_PROP_ASSERT,
  AXIOM_OBJECT_SOME_VALUES_FROM,
  AXIOM_SUBCLASS_OF,
  AXIOM_UNIVERSAL_RESTRICTION,
  hashIri64,
  parsePropertyPathExpression,
  WasmOntologyReasoner,
  WasmOntologyStore,
  type WasmOntologyInstance,
} from "../src/ontology/wasm_ontology.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveWasmPath(): string {
  const releasePath = path.resolve(__dirname, "../build/release.wasm");
  const debugPath = path.resolve(__dirname, "../build/debug.wasm");
  if (fs.existsSync(releasePath)) return releasePath;
  if (fs.existsSync(debugPath)) return debugPath;
  throw new Error("WASM binary not found at packages/runtime/build/{release,debug}.wasm");
}

const wasmBytes = fs.readFileSync(resolveWasmPath());

async function createWasmEnv(): Promise<WasmOntologyInstance> {
  const wasmModule = await WebAssembly.instantiate(wasmBytes, {
    env: {
      abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
        throw new Error(`WASM abort at ${msgPtr}:${filePtr} (${line}:${col})`);
      },
      trace: () => {},
      seed: () => 42,
    },
  });
  const instance = "instance" in wasmModule ? wasmModule.instance : (wasmModule as unknown as WebAssembly.Instance);
  const wasm = instance.exports as unknown as WasmOntologyInstance;
  wasm.ontology_clear?.();
  return wasm;
}

describe("Ontology, Reasoner & Triple Store Review Fixes", () => {
  it("parsePropertyPathExpression preserves full <http://...> IRIs without splitting on slashes", () => {
    assert.deepEqual(parsePropertyPathExpression("<http://example.org/p>+"), {
      iri: "<http://example.org/p>",
      pathOp: "plus",
    });
    assert.deepEqual(parsePropertyPathExpression("<http://example.org/p1> / <http://example.org/p2>"), {
      iri: "<http://example.org/p1>",
      pathOp: "sequence",
      stepPropertyIri2: "<http://example.org/p2>",
    });
    assert.deepEqual(parsePropertyPathExpression("<http://example.org/p1> | <http://example.org/p2>"), {
      iri: "<http://example.org/p1>",
      pathOp: "alternation",
      stepPropertyIri2: "<http://example.org/p2>",
    });
  });

  it("WasmOntologyReasoner.unifyIndividuals transitively merges disjoint SameIndividual groups", () => {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: ":A" },
      { type: "ClassDeclaration", iri: ":B" },
      { type: "DisjointClasses", classIris: [":A", ":B"] },
      { type: "ClassAssertion", classIri: ":A", individualIri: ":x1" },
      { type: "ClassAssertion", classIri: ":B", individualIri: ":x4" },
      { type: "SameIndividual", individualIris: [":x1", ":x2"] },
      { type: "SameIndividual", individualIris: [":x3", ":x4"] },
      { type: "SameIndividual", individualIris: [":x2", ":x3"] },
    ]);
    reasoner.classify();

    // x1 and x4 are now transitively unified, so :x1 has both :A and :B -> inconsistent
    assert.ok(reasoner.classifyIndividual(":x1").allTypes.includes(":B"));
    assert.ok(reasoner.classifyIndividual(":x4").allTypes.includes(":A"));
    assert.equal(reasoner.checkConsistency().isConsistent, false);
  });

  it("WasmOntologyReasoner.classify interleaves SWRL, InverseObjectProperty, and ObjectPropertyDomain/Range", () => {
    const reasoner = new WasmOntologyReasoner();
    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: ":Source" },
      { type: "ClassDeclaration", iri: ":Target" },
      { type: "ClassDeclaration", iri: ":Powered" },
      { type: "InverseObjectProperty", propertyIri: ":feeds", inversePropertyIri: ":fedBy" },
      { type: "ObjectPropertyDomain", propertyIri: ":fedBy", domainIri: ":Powered" },
      { type: "ClassAssertion", classIri: ":Source", individualIri: ":gen1" },
      { type: "ObjectPropertyAssertion", propertyIri: ":wiredTo", subjectIri: ":gen1", objectIri: ":motor1" },
      {
        type: "SwrlRule",
        body: [
          { type: "ClassAtom", classIri: ":Source", argument: "?x" },
          { type: "IndividualPropertyAtom", propertyIri: ":wiredTo", argument1: "?x", argument2: "?y" },
        ],
        head: [{ type: "IndividualPropertyAtom", propertyIri: ":feeds", argument1: "?x", argument2: "?y" }],
      },
    ]);
    reasoner.classify();

    // SWRL derives :feeds(:gen1, :motor1) -> outer fixpoint derives :fedBy(:motor1, :gen1) -> domain derives :motor1 : :Powered
    const types = reasoner.classifyIndividual(":motor1").allTypes;
    assert.ok(types.includes(":Powered"), `Expected :motor1 to be inferred as :Powered, got [${types.join(", ")}]`);
  });

  it("WasmOntologyStore.setAxioms and clearAxioms stay synchronized with attached WASM store", async () => {
    const wasm = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);

    store.setAxioms("owl2", [
      { type: "ClassDeclaration", iri: ":A" },
      { type: "SubClassOf", subClassIri: ":A", superClassIri: ":B" },
    ]);
    assert.equal(wasm.ontology_getAxiomCount!(), 2);

    store.setAxioms("owl2", [{ type: "ClassDeclaration", iri: ":C" }]);
    assert.equal(wasm.ontology_getAxiomCount!(), 1);

    store.clearAxioms();
    assert.equal(wasm.ontology_getAxiomCount!(), 0);
  });

  it("WASM OntologyStore DRed retraction cascades transitively and inactive axioms are hidden from read paths", async () => {
    const wasm = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);

    const subIri = "rdfs:subClassOf";
    // Chain: A ⊑ B ⊑ C ⊑ D
    store.addAxiomDirect64(AXIOM_SUBCLASS_OF, 0, ":A", subIri, ":B");
    const bcId = store.addAxiomDirect64(AXIOM_SUBCLASS_OF, 0, ":B", subIri, ":C");
    store.addAxiomDirect64(AXIOM_SUBCLASS_OF, 0, ":C", subIri, ":D");
    const indAssertId = store.addAxiomDirect64(AXIOM_CLASS_ASSERT, 0, ":ind1", "rdf:type", ":A");
    const edgeId = store.addAxiomDirect64(AXIOM_OBJ_PROP_ASSERT, 0, ":ind1", ":rel", ":ind2");
    const disjId = store.addAxiomDirect64(AXIOM_DISJOINT_CLASSES, 0, ":A", "", ":X");

    wasm.ontology_saturateELRules!();
    wasm.ontology_computeIntervalIndex!();

    const idA = store.internIri(":A");
    const idD = store.internIri(":D");
    const idX = store.internIri(":X");
    const idInd1 = store.internIri(":ind1");
    const idRel = store.internIri(":rel");

    assert.equal(wasm.ontology_isSubClassOf!(idA, idD), 1);
    assert.equal(wasm.ontology_isInstanceOf!(idInd1, idD), 1);
    assert.equal(wasm.ontology_areDisjoint!(idA, idX), 1);
    assert.equal(wasm.ontology_evaluatePropertyPath!(idRel, 1, 0, idInd1), 1);

    // Retract middle link B ⊑ C -> transitive inferred A ⊑ D must also be retracted!
    wasm.ontology_retractAxiom!(bcId);
    assert.equal(
      wasm.ontology_isSubClassOf!(idA, idD),
      0,
      "Transitive A ⊑ D should be over-deleted when B ⊑ C is retracted",
    );
    assert.equal(wasm.ontology_isInstanceOf!(idInd1, idD), 0);

    // Retract ClassAssertion, ObjectPropertyAssertion, and DisjointClasses -> read paths must ignore inactive axioms
    wasm.ontology_retractAxiom!(indAssertId);
    wasm.ontology_retractAxiom!(edgeId);
    wasm.ontology_retractAxiom!(disjId);

    assert.equal(wasm.ontology_isInstanceOf!(idInd1, idA), 0);
    assert.equal(wasm.ontology_areDisjoint!(idA, idX), 0);
    assert.equal(wasm.ontology_evaluatePropertyPath!(idRel, 1, 0, idInd1), 0);
    assert.equal(wasm.ontology_getTransitiveClosure!(idRel, idInd1), 0);
  });

  it("WASM saturateELRules CR4 scopes UniversalRestriction to its subject class", async () => {
    const wasm = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);

    // EV ⊑ ∀hasMotor.ElectricMotor, DieselCar ⊑ ∃hasMotor.DieselEngine, EVSub ⊑ ∃hasMotor.PMSM, EVSub ⊑ EV
    store.addAxiomDirect64(AXIOM_UNIVERSAL_RESTRICTION, 0, ":EV", ":hasMotor", ":ElectricMotor");
    store.addAxiomDirect64(AXIOM_OBJECT_SOME_VALUES_FROM, 0, ":DieselCar", ":hasMotor", ":DieselEngine");
    store.addAxiomDirect64(AXIOM_SUBCLASS_OF, 0, ":EVSub", "rdfs:subClassOf", ":EV");
    store.addAxiomDirect64(AXIOM_OBJECT_SOME_VALUES_FROM, 0, ":EVSub", ":hasMotor", ":PMSM");

    wasm.ontology_saturateELRules!();

    const idDieselEngine = store.internIri(":DieselEngine");
    const idPMSM = store.internIri(":PMSM");
    const idElectricMotor = store.internIri(":ElectricMotor");

    assert.equal(wasm.ontology_isSubClassOf!(idPMSM, idElectricMotor), 1, "PMSM should be inferred as ElectricMotor");
    assert.equal(
      wasm.ontology_isSubClassOf!(idDieselEngine, idElectricMotor),
      0,
      "DieselEngine must NOT be inferred as ElectricMotor from EV-scoped UniversalRestriction",
    );
    void hashIri64;
  });
});
