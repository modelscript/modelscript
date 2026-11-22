// SPDX-License-Identifier: AGPL-3.0-or-later

import { SparseCsrGraph, WasmOntologyReasoner, WebGPUOntologyReasoner } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createOntologyReasonerSource, executeSparqlAlgebra } from "../src/engine.js";
import { createReactiveSparqlView, type ReactiveSparqlDelta } from "../src/reactive.js";
import {
  createCompositeTripleSource,
  createDaeArenaTripleSource,
  createSymbolIndexTripleSource,
  MS_VOCAB,
} from "../src/virtual-arena.js";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

describe("P2: Reactive Z-Set Live SPARQL Views, Virtual Compiler-Arena Triples & Sparse CSR WebGPU", () => {
  it("maintains a live Z-Set reactive SPARQL view over WasmOntologyReasoner and emits exact +/- deltas", async () => {
    const reasoner = new WasmOntologyReasoner();
    await reasoner.init();

    reasoner.loadOntology([
      { type: "ClassDeclaration", iri: "http://ex.org/Component" },
      { type: "ClassDeclaration", iri: "http://ex.org/Pump" },
      { type: "SubClassOf", subClassIri: "http://ex.org/Pump", superClassIri: "http://ex.org/Component" },
      { type: "ClassAssertion", classIri: "http://ex.org/Pump", individualIri: "http://ex.org/p1" },
    ]);
    reasoner.classify();

    const view = createReactiveSparqlView(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["x"],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "bgp",
          triples: [
            {
              subject: { termType: "Variable", value: "x" },
              predicate: { termType: "NamedNode", value: RDF_TYPE },
              object: { termType: "NamedNode", value: "http://ex.org/Component" },
            },
          ],
        },
      },
      reasoner,
    );

    assert.equal(view.snapshot().length, 1);
    assert.equal(view.snapshot()[0]!.x?.value, "http://ex.org/p1");

    const received: ReactiveSparqlDelta[] = [];
    const unsubscribe = view.subscribe((d) => received.push(d));

    // 1. Add a new subclass + instance -> should emit exactly 1 added row (inferred Component!)
    const d1 = view.applyOntologyDelta({
      retractions: [],
      assertions: [
        { type: "ClassDeclaration", iri: "http://ex.org/CentrifugalPump" },
        { type: "SubClassOf", subClassIri: "http://ex.org/CentrifugalPump", superClassIri: "http://ex.org/Pump" },
        { type: "ClassAssertion", classIri: "http://ex.org/CentrifugalPump", individualIri: "http://ex.org/p2" },
      ],
    });
    assert.equal(d1.added.length, 1);
    assert.equal(d1.removed.length, 0);
    assert.equal(d1.added[0]!.x?.value, "http://ex.org/p2");
    assert.equal(received.length, 1);

    // 2. Unrelated mutation -> zero noise (listeners NOT called, revision unchanged)
    const revBefore = view.revision;
    const d2 = view.applyOntologyDelta({
      retractions: [],
      assertions: [{ type: "ClassDeclaration", iri: "http://ex.org/UnrelatedClass" }],
    });
    assert.equal(d2.added.length, 0);
    assert.equal(d2.removed.length, 0);
    assert.equal(view.revision, revBefore);
    assert.equal(received.length, 1);

    // 3. Retract Pump ⊑ Component -> both p1 and p2 lose Component type and emit as `removed`
    const d3 = view.applyOntologyDelta({
      retractions: [
        { type: "SubClassOf", subClassIri: "http://ex.org/Pump", superClassIri: "http://ex.org/Component" },
      ],
      assertions: [],
    });
    assert.equal(d3.added.length, 0);
    assert.equal(d3.removed.length, 2);
    assert.equal(view.snapshot().length, 0);
    assert.equal(received.length, 2);

    unsubscribe();
  });

  it("joins virtual compiler SymbolIndex + DAEBuilder + WasmOntologyReasoner in a single zero-ETL SPARQL query", async () => {
    // 1. Virtual Modelica SymbolIndex
    const symbols = new Map<number, any>([
      [1, { id: 1, name: "HydraulicLoop", kind: "model", qualifiedName: "HydraulicLoop", uri: "file:///loop.mo" }],
      [2, { id: 2, name: "pump1", kind: "component", parentId: 1, typeName: "Pump", uri: "file:///loop.mo" }],
      [3, { id: 3, name: "valve1", kind: "component", parentId: 1, typeName: "Valve", uri: "file:///loop.mo" }],
    ]);
    const symSource = createSymbolIndexTripleSource({
      symbols,
      byName: new Map([
        ["HydraulicLoop", [1]],
        ["pump1", [2]],
        ["valve1", [3]],
      ]),
      childrenOf: new Map([[1, [2, 3]]]),
    });

    // 2. Virtual DAE Arena
    const daeSource = createDaeArenaTripleSource({
      variables: [
        { name: "pump1.flow", typeName: "Real", variability: "continuous", causality: "output" },
        { name: "pump1.R", typeName: "Real", variability: "parameter", causality: "local" },
      ],
    });

    // 3. Live OWL 2 Reasoner classifying symbol IRI `https://modelscript.org/symbol/2`
    const reasoner = new WasmOntologyReasoner();
    await reasoner.init();
    reasoner.loadOntology([
      {
        type: "SubClassOf",
        subClassIri: "http://ex.org/RotatingEquipment",
        superClassIri: "http://ex.org/SafetyCritical",
      },
      {
        type: "ClassAssertion",
        classIri: "http://ex.org/RotatingEquipment",
        individualIri: "https://modelscript.org/symbol/2",
      },
    ]);
    reasoner.classify();

    const composite = createCompositeTripleSource(symSource, daeSource, createOntologyReasonerSource(reasoner));

    // Single federated SPARQL query joining OWL 2 inferred class + Modelica SymbolIndex component + parent model!
    const res = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["compName", "modelName"],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "bgp",
          triples: [
            {
              subject: { termType: "Variable", value: "sym" },
              predicate: { termType: "NamedNode", value: RDF_TYPE },
              object: { termType: "NamedNode", value: "http://ex.org/SafetyCritical" },
            },
            {
              subject: { termType: "Variable", value: "sym" },
              predicate: { termType: "NamedNode", value: MS_VOCAB.name },
              object: { termType: "Variable", value: "compName" },
            },
            {
              subject: { termType: "Variable", value: "sym" },
              predicate: { termType: "NamedNode", value: MS_VOCAB.parent },
              object: { termType: "Variable", value: "parentSym" },
            },
            {
              subject: { termType: "Variable", value: "parentSym" },
              predicate: { termType: "NamedNode", value: MS_VOCAB.name },
              object: { termType: "Variable", value: "modelName" },
            },
          ],
        },
      },
      composite,
    );

    assert.equal(res.queryType, "SELECT");
    assert.equal(res.bindings.length, 1);
    assert.equal(res.bindings[0]!.compName?.value, "pump1");
    assert.equal(res.bindings[0]!.modelName?.value, "HydraulicLoop");

    // Also query continuous DAE variables directly without ETL
    const daeRes = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        variables: ["vName"],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "bgp",
          triples: [
            {
              subject: { termType: "Variable", value: "v" },
              predicate: { termType: "NamedNode", value: MS_VOCAB.variability },
              object: { termType: "Literal", value: "continuous", datatype: "http://www.w3.org/2001/XMLSchema#string" },
            },
            {
              subject: { termType: "Variable", value: "v" },
              predicate: { termType: "NamedNode", value: MS_VOCAB.name },
              object: { termType: "Variable", value: "vName" },
            },
          ],
        },
      },
      composite,
    );
    assert.equal(daeRes.queryType, "SELECT");
    assert.equal(daeRes.bindings.length, 1);
    assert.equal(daeRes.bindings[0]!.vName?.value, "pump1.flow");
  });

  it("computes sparse CSR property-path reachability over 100,000 nodes in O(N + E) memory", async () => {
    // 100,000 nodes would take 1.25 GB in a dense N x N bitset — CSR takes ~1.2 MB!
    const N = 100_000;
    const edges: [number, number][] = [];
    // Create a 500-hop chain starting at 0, plus 100k random-ish background edges
    for (let i = 0; i < 500; i++) {
      edges.push([i, i + 1]);
    }
    for (let i = 1000; i < N - 1; i++) {
      edges.push([i, i + 1]);
    }

    const csr = SparseCsrGraph.fromEdges(N, edges);
    assert.equal(csr.nodeCount, N);
    assert.equal(csr.edgeCount, edges.length);

    const gpuReasoner = new WebGPUOntologyReasoner();
    await gpuReasoner.init();

    // Non-reflexive (`p+`): 0 reaches 1..500 (500 nodes)
    const rPlus = await gpuReasoner.computeSparseReachability(csr, [0], { reflexive: false });
    assert.equal(rPlus.reachable.length, 500);
    assert.equal(rPlus.distances[0], -1);
    assert.equal(rPlus.distances[500], 500);
    assert.equal(rPlus.distances[1000], -1);

    // Bounded hop (`maxHops: 10`, reflexive `p*`): 0 reaches 0..10 (11 nodes)
    const rBounded = await gpuReasoner.computeSparseReachability(csr, [0], { reflexive: true, maxHops: 10 });
    assert.equal(rBounded.reachable.length, 11);
    assert.equal(rBounded.distances[0], 0);
    assert.equal(rBounded.distances[10], 10);
    assert.equal(rBounded.distances[11], -1);
  });
});
