// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParser } from "@modelscript/dsl/bindings";
import { WasmOntologyReasoner, WasmOntologyStore, type WasmOntologyInstance } from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createArrayTripleSource,
  createOntologyReasonerSource,
  createOntologyStoreSource,
  executeSparqlQuery,
  type SparqlQuad,
} from "../src/engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sparqlWasmPath = path.resolve(__dirname, "../dist/parser.wasm");
const runtimeWasmPath = path.resolve(__dirname, "../../../packages/runtime/build/release.wasm");

async function loadRuntimeWasm(): Promise<WasmOntologyInstance> {
  const bytes = fs.readFileSync(runtimeWasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: () => {
        throw new Error("WASM abort");
      },
      seed: () => Date.now(),
    },
  });
  return instance.exports as unknown as WasmOntologyInstance;
}

describe("P0: WASM Integer-ID Leapfrog Triejoin, Live Reasoner Cursor & Incremental DRed", () => {
  it("executes multi-pattern triangle & star BGPs directly in WASM linear memory with exact parity", async () => {
    const { parser } = await createWasmParser(sparqlWasmPath);
    const wasm = await loadRuntimeWasm();
    wasm.ontology_clear?.();

    const store = new WasmOntologyStore(wasm);
    const KNOWS = "http://ex.org/knows";
    const LIKES = "http://ex.org/likes";
    const SELF = "http://ex.org/self";

    const axioms: Array<{
      type: "ObjectPropertyAssertion";
      propertyIri: string;
      subjectIri: string;
      objectIri: string;
    }> = [];
    const jsQuads: SparqlQuad[] = [];

    const addEdge = (s: string, p: string, o: string) => {
      axioms.push({ type: "ObjectPropertyAssertion", propertyIri: p, subjectIri: s, objectIri: o });
      jsQuads.push({
        subject: { termType: "NamedNode", value: s },
        predicate: { termType: "NamedNode", value: p },
        object: { termType: "NamedNode", value: o },
      });
    };

    // Build 15 disjoint triangles + noise edges (1,500+ triples)
    for (let t = 0; t < 15; t++) {
      const a = `http://ex.org/n_${t}_a`;
      const b = `http://ex.org/n_${t}_b`;
      const c = `http://ex.org/n_${t}_c`;
      addEdge(a, KNOWS, b);
      addEdge(b, KNOWS, c);
      addEdge(c, KNOWS, a);
      addEdge(a, LIKES, c);
    }
    for (let i = 0; i < 1000; i++) {
      addEdge(`http://ex.org/noise_${i}`, KNOWS, `http://ex.org/noise_${i + 1}`);
    }
    addEdge("http://ex.org/loop1", SELF, "http://ex.org/loop1");
    addEdge("http://ex.org/loop1", SELF, "http://ex.org/other");

    store.addAxioms("owl2", axioms);

    const wasmSource = createOntologyStoreSource(store);
    const jsSource = createArrayTripleSource(jsQuads);

    // 1. Triangle join (WCOJ sweet spot)
    const triQuery = `
      PREFIX ex: <http://ex.org/>
      SELECT ?a ?b ?c WHERE {
        ?a ex:knows ?b .
        ?b ex:knows ?c .
        ?c ex:knows ?a .
        ?a ex:likes ?c .
      }
      ORDER BY ?a
    `;
    const wasmTri = executeSparqlQuery(parser, triQuery, wasmSource);
    const jsTri = executeSparqlQuery(parser, triQuery, jsSource);
    assert.equal(wasmTri.queryType, "SELECT");
    assert.equal(jsTri.queryType, "SELECT");
    assert.equal(wasmTri.bindings.length, 15);
    assert.deepEqual(wasmTri.bindings, jsTri.bindings);

    // 2. Self-join + multi-pattern
    const selfQuery = `
      PREFIX ex: <http://ex.org/>
      SELECT ?x ?y WHERE {
        ?x ex:self ?x .
        ?x ex:self ?y .
      }
      ORDER BY ?y
    `;
    const wasmSelf = executeSparqlQuery(parser, selfQuery, wasmSource);
    const jsSelf = executeSparqlQuery(parser, selfQuery, jsSource);
    assert.equal(wasmSelf.queryType, "SELECT");
    assert.equal(jsSelf.queryType, "SELECT");
    assert.equal(wasmSelf.bindings.length, 2);
    assert.deepEqual(wasmSelf.bindings, jsSelf.bindings);

    // 3. Constant not in store -> immediate 0 results
    const emptyQuery = `
      PREFIX ex: <http://ex.org/>
      SELECT ?x WHERE {
        ex:does_not_exist ex:knows ?x .
        ?x ex:likes ?y .
      }
    `;
    const wasmEmpty = executeSparqlQuery(parser, emptyQuery, wasmSource);
    assert.equal(wasmEmpty.queryType, "SELECT");
    assert.equal(wasmEmpty.bindings.length, 0);
  });

  it("createOntologyReasonerSource streams live explicit + inferred triples across incremental applyDelta()", async () => {
    const { parser } = await createWasmParser(sparqlWasmPath);
    const reasoner = new WasmOntologyReasoner();
    await reasoner.init();

    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "http://ex.org/Entity" },
      { type: "ClassDeclaration", iri: "http://ex.org/Vehicle" },
      { type: "ClassDeclaration", iri: "http://ex.org/Car" },
      { type: "SubClassOf", subClassIri: "http://ex.org/Vehicle", superClassIri: "http://ex.org/Entity" },
      { type: "SubClassOf", subClassIri: "http://ex.org/Car", superClassIri: "http://ex.org/Vehicle" },
      { type: "ClassAssertion", classIri: "http://ex.org/Car", individualIri: "http://ex.org/sedan1" },
      {
        type: "ObjectPropertyAssertion",
        propertyIri: "http://ex.org/hasPart",
        subjectIri: "http://ex.org/sedan1",
        objectIri: "http://ex.org/engine1",
      },
    ]);
    reasoner.classify();

    // Create the live cursor ONCE — never recreate it across deltas!
    const liveSource = createOntologyReasonerSource(reasoner);

    const typeQuery = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX ex: <http://ex.org/>
      SELECT ?ind ?cls WHERE {
        ?ind rdf:type ?cls .
        ?ind ex:hasPart ex:engine1 .
      }
      ORDER BY ?cls
    `;

    const r1 = executeSparqlQuery(parser, typeQuery, liveSource);
    assert.equal(r1.queryType, "SELECT");
    assert.deepEqual(
      r1.bindings.map((b) => b.cls?.value),
      ["http://ex.org/Car", "http://ex.org/Entity", "http://ex.org/Vehicle"],
    );

    // Incremental additive delta: add ElectricCar ⊑ Car and ev1 : ElectricCar + hasPart engine1
    reasoner.applyDelta({
      retractions: [],
      assertions: [
        { type: "ClassDeclaration", iri: "http://ex.org/ElectricCar" },
        { type: "SubClassOf", subClassIri: "http://ex.org/ElectricCar", superClassIri: "http://ex.org/Car" },
        { type: "ClassAssertion", classIri: "http://ex.org/ElectricCar", individualIri: "http://ex.org/ev1" },
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "http://ex.org/hasPart",
          subjectIri: "http://ex.org/ev1",
          objectIri: "http://ex.org/engine1",
        },
      ],
    });

    const r2 = executeSparqlQuery(
      parser,
      `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX ex: <http://ex.org/>
      SELECT ?cls WHERE {
        ex:ev1 rdf:type ?cls .
      }
      ORDER BY ?cls
      `,
      liveSource,
    );
    assert.equal(r2.queryType, "SELECT");
    assert.deepEqual(
      r2.bindings.map((b) => b.cls?.value),
      ["http://ex.org/Car", "http://ex.org/ElectricCar", "http://ex.org/Entity", "http://ex.org/Vehicle"],
    );

    // Incremental retraction delta (local DRed): retract Vehicle ⊑ Entity
    reasoner.applyDelta({
      retractions: [
        { type: "SubClassOf", subClassIri: "http://ex.org/Vehicle", superClassIri: "http://ex.org/Entity" },
      ],
      assertions: [],
    });

    const r3 = executeSparqlQuery(
      parser,
      `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX ex: <http://ex.org/>
      SELECT ?cls WHERE {
        ex:ev1 rdf:type ?cls .
      }
      ORDER BY ?cls
      `,
      liveSource,
    );
    assert.equal(r3.queryType, "SELECT");
    assert.deepEqual(
      r3.bindings.map((b) => b.cls?.value),
      ["http://ex.org/Car", "http://ex.org/ElectricCar", "http://ex.org/Vehicle"],
    );
    assert.equal(reasoner.isSubClassOf("http://ex.org/ElectricCar", "http://ex.org/Entity").holds, false);
  });

  it("preserves alternative diamond paths during incremental DRed retraction and syncs WASM ontology_applyDelta", async () => {
    const wasm = await loadRuntimeWasm();
    wasm.ontology_clear?.();

    const reasoner = new WasmOntologyReasoner(wasm);
    await reasoner.init();

    // Diamond: A ⊑ B ⊑ D and A ⊑ C ⊑ D
    reasoner.loadOntology([
      { type: "SubClassOf", subClassIri: "ex:A", superClassIri: "ex:B" },
      { type: "SubClassOf", subClassIri: "ex:B", superClassIri: "ex:D" },
      { type: "SubClassOf", subClassIri: "ex:A", superClassIri: "ex:C" },
      { type: "SubClassOf", subClassIri: "ex:C", superClassIri: "ex:D" },
      { type: "ClassAssertion", classIri: "ex:A", individualIri: "ex:ind1" },
    ]);
    reasoner.classify();
    wasm.ontology_saturateELRules?.();

    assert.equal(reasoner.isSubClassOf("ex:A", "ex:D").holds, true);
    assert.ok(reasoner.classifyIndividual("ex:ind1").allTypes.includes("ex:D"));

    // Retract B ⊑ D: A ⊑ D MUST still hold via A ⊑ C ⊑ D!
    reasoner.applyDelta({
      retractions: [{ type: "SubClassOf", subClassIri: "ex:B", superClassIri: "ex:D" }],
      assertions: [],
    });

    assert.equal(reasoner.isSubClassOf("ex:B", "ex:D").holds, false);
    assert.equal(reasoner.isSubClassOf("ex:A", "ex:D").holds, true);
    assert.ok(reasoner.classifyIndividual("ex:ind1").allTypes.includes("ex:D"));

    // Now retract C ⊑ D as well: A ⊑ D must no longer hold!
    reasoner.applyDelta({
      retractions: [{ type: "SubClassOf", subClassIri: "ex:C", superClassIri: "ex:D" }],
      assertions: [],
    });

    assert.equal(reasoner.isSubClassOf("ex:A", "ex:D").holds, false);
    assert.equal(reasoner.classifyIndividual("ex:ind1").allTypes.includes("ex:D"), false);
  });
});
