// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  PagedStorageEngine,
  SharedMemoryELReasoner,
  WasmOntologyReasoner,
  WasmOntologyStore,
  type OWL2Axiom,
  type PagedWasmExports,
} from "@modelscript/runtime";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createArrayTripleSource,
  createPagedStorageSource,
  evalColumnarNumericAggregates,
  executeSparqlAlgebra,
  planBgpJoinOrder,
} from "../src/engine.js";
import { rewriteSparqlQueryOwl2QL } from "../src/owl2ql-rewriter.js";
import { createReactiveSparqlView } from "../src/reactive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWasmPath = path.resolve(__dirname, "../../../packages/runtime/build/release.wasm");

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_INT = "http://www.w3.org/2001/XMLSchema#integer";

async function loadPagedWasm(): Promise<PagedWasmExports> {
  const bytes = fs.readFileSync(runtimeWasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: () => {
        throw new Error("WASM abort");
      },
      seed: () => Date.now(),
    },
  });
  return instance.exports as unknown as PagedWasmExports;
}

describe("SOTA Extensions: OWL 2 QL Rewriting, DBSP Bilinear Join IVM, GRAPH ?g & Incremental Prop Rules", () => {
  it("answers inferred SPARQL queries with zero materialization via OWL 2 QL PerfectRef rewriting over PagedStorageEngine", async () => {
    const wasm = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasm, 256);

    // Raw explicit ABox ONLY — zero materialized inferences!
    engine.insertTriple("http://ex.org/p1", RDF_TYPE, "http://ex.org/CentrifugalPump");
    engine.insertTriple("http://ex.org/m1", "http://ex.org/drives", "http://ex.org/p2");
    engine.insertTriple("http://ex.org/v1", "http://ex.org/fedBy", "http://ex.org/p1");

    const tbox: OWL2Axiom[] = [
      { type: "SubClassOf", subClassIri: "http://ex.org/CentrifugalPump", superClassIri: "http://ex.org/Pump" },
      { type: "SubClassOf", subClassIri: "http://ex.org/Pump", superClassIri: "http://ex.org/Equipment" },
      { type: "ObjectPropertyDomain", propertyIri: "http://ex.org/drives", domainIri: "http://ex.org/Equipment" },
      { type: "ObjectPropertyRange", propertyIri: "http://ex.org/drives", rangeIri: "http://ex.org/Pump" },
      {
        type: "InverseObjectProperty",
        propertyIri: "http://ex.org/feeds",
        inversePropertyIri: "http://ex.org/fedBy",
      },
      {
        type: "SubObjectPropertyOf",
        subPropertyIri: "http://ex.org/feeds",
        superPropertyIri: "http://ex.org/connectedTo",
      },
    ];

    const source = createPagedStorageSource(engine);

    // 1. Query for all Equipment (p1 via subclass, m1 via domain of drives, p2 via range of drives ⊑ Pump ⊑ Equipment!)
    const eqQuery = rewriteSparqlQueryOwl2QL(
      {
        queryType: "SELECT",
        prefixes: {},
        projections: [{ variable: "x" }],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "bgp",
          triples: [
            {
              subject: { termType: "Variable", value: "x" },
              predicate: { termType: "NamedNode", value: RDF_TYPE },
              object: { termType: "NamedNode", value: "http://ex.org/Equipment" },
            },
          ],
        },
      },
      tbox,
    );

    const eqRes = executeSparqlAlgebra(eqQuery, source);
    assert.equal(eqRes.queryType, "SELECT");
    const eqIris = eqRes.bindings.map((b) => b.x?.value).sort();
    assert.deepEqual(eqIris, ["http://ex.org/m1", "http://ex.org/p1", "http://ex.org/p2"]);

    // 2. Query for ?a :connectedTo ?b (p1 connectedTo v1 via inverse(fedBy) = feeds ⊑ connectedTo!)
    const connQuery = rewriteSparqlQueryOwl2QL(
      {
        queryType: "SELECT",
        prefixes: {},
        projections: [{ variable: "a" }, { variable: "b" }],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "bgp",
          triples: [
            {
              subject: { termType: "Variable", value: "a" },
              predicate: { termType: "NamedNode", value: "http://ex.org/connectedTo" },
              object: { termType: "Variable", value: "b" },
            },
          ],
        },
      },
      tbox,
    );

    const connRes = executeSparqlAlgebra(connQuery, source);
    assert.equal(connRes.queryType, "SELECT");
    assert.equal(connRes.bindings.length, 1);
    assert.equal(connRes.bindings[0]!.a?.value, "http://ex.org/p1");
    assert.equal(connRes.bindings[0]!.b?.value, "http://ex.org/v1");
  });

  it("maintains multi-pattern BGP joins incrementally via DBSP bilinear deltas without full recomputation", () => {
    const KNOWS = "http://ex.org/knows";
    const WORKS_AT = "http://ex.org/worksAt";
    const src = createArrayTripleSource([
      {
        subject: { termType: "NamedNode", value: "http://ex.org/alice" },
        predicate: { termType: "NamedNode", value: KNOWS },
        object: { termType: "NamedNode", value: "http://ex.org/bob" },
      },
      {
        subject: { termType: "NamedNode", value: "http://ex.org/bob" },
        predicate: { termType: "NamedNode", value: WORKS_AT },
        object: { termType: "NamedNode", value: "http://ex.org/acme" },
      },
    ]);

    const view = createReactiveSparqlView(
      {
        queryType: "SELECT",
        prefixes: {},
        projections: [{ variable: "x" }, { variable: "org" }],
        modifier: { groupBy: [], having: [], orderBy: [] },
        where: {
          kind: "bgp",
          triples: [
            {
              subject: { termType: "Variable", value: "x" },
              predicate: { termType: "NamedNode", value: KNOWS },
              object: { termType: "Variable", value: "y" },
            },
            {
              subject: { termType: "Variable", value: "y" },
              predicate: { termType: "NamedNode", value: WORKS_AT },
              object: { termType: "Variable", value: "org" },
            },
          ],
        },
      },
      src,
    );

    assert.equal(view.snapshot().length, 1);
    assert.equal(view.stats.fullRecomputes, 1);
    assert.equal(view.stats.incrementalUpdates, 0);

    // Insert carol knows bob -> incrementally joins with bob worksAt acme!
    const d1 = view.applyTripleDelta({
      insertions: [
        {
          subject: { termType: "NamedNode", value: "http://ex.org/carol" },
          predicate: { termType: "NamedNode", value: KNOWS },
          object: { termType: "NamedNode", value: "http://ex.org/bob" },
        },
      ],
    });
    assert.equal(d1.added.length, 1);
    assert.equal(d1.added[0]!.x?.value, "http://ex.org/carol");
    assert.equal(d1.added[0]!.org?.value, "http://ex.org/acme");
    assert.equal(view.snapshot().length, 2);
    assert.equal(view.stats.fullRecomputes, 1); // Zero full recomputes!
    assert.equal(view.stats.incrementalUpdates, 1);

    // Delete bob worksAt acme -> incrementally retracts BOTH (alice, acme) and (carol, acme)!
    const d2 = view.applyTripleDelta({
      deletions: [
        {
          subject: { termType: "NamedNode", value: "http://ex.org/bob" },
          predicate: { termType: "NamedNode", value: WORKS_AT },
          object: { termType: "NamedNode", value: "http://ex.org/acme" },
        },
      ],
    });
    assert.equal(d2.removed.length, 2);
    assert.equal(view.snapshot().length, 0);
    assert.equal(view.stats.fullRecomputes, 1);
    assert.equal(view.stats.incrementalUpdates, 2);
  });

  it("binds variable named graphs `GRAPH ?g { ... }` over PagedStorageEngine", async () => {
    const wasm = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasm, 256);

    const G1 = "http://ex.org/g1";
    const G2 = "http://ex.org/g2";
    const TEMP = "http://ex.org/temp";

    engine.insertQuad("http://ex.org/c1", TEMP, engine.encodeLiteral(320), G1);
    engine.insertQuad("http://ex.org/c2", TEMP, engine.encodeLiteral(410), G1);
    engine.insertQuad("http://ex.org/c3", TEMP, engine.encodeLiteral(390), G2);

    const source = createPagedStorageSource(engine);
    const res = executeSparqlAlgebra(
      {
        queryType: "SELECT",
        prefixes: {},
        projections: [{ variable: "g" }, { variable: "c" }],
        modifier: {
          groupBy: [],
          having: [],
          orderBy: [{ expr: { kind: "term", term: { termType: "Variable", value: "c" } }, direction: "ASC" }],
        },
        where: {
          kind: "graph",
          graph: { termType: "Variable", value: "g" },
          pattern: {
            kind: "group",
            patterns: [
              {
                kind: "bgp",
                triples: [
                  {
                    subject: { termType: "Variable", value: "c" },
                    predicate: { termType: "NamedNode", value: TEMP },
                    object: { termType: "Variable", value: "t" },
                  },
                ],
              },
              {
                kind: "filter",
                expr: {
                  kind: "binary",
                  op: ">",
                  left: { kind: "term", term: { termType: "Variable", value: "t" } },
                  right: { kind: "term", term: { termType: "Literal", value: "350", datatype: XSD_INT } },
                },
              },
            ],
          },
        },
      },
      source,
    );

    assert.equal(res.queryType, "SELECT");
    assert.equal(res.bindings.length, 2);
    assert.equal(res.bindings[0]!.c?.value, "http://ex.org/c2");
    assert.equal(res.bindings[0]!.g?.value, G1);
    assert.equal(res.bindings[1]!.c?.value, "http://ex.org/c3");
    assert.equal(res.bindings[1]!.g?.value, G2);
  });

  it("propagates SubObjectPropertyOf and ObjectPropertyDomain/Range incrementally in WasmOntologyReasoner.applyDelta()", async () => {
    const reasoner = new WasmOntologyReasoner();
    await reasoner.init();

    reasoner.loadOntology([
      { type: "SubClassOf", subClassIri: "http://ex.org/Source", superClassIri: "http://ex.org/Node" },
      { type: "SubClassOf", subClassIri: "http://ex.org/Sink", superClassIri: "http://ex.org/Node" },
      {
        type: "SubObjectPropertyOf",
        subPropertyIri: "http://ex.org/feeds",
        superPropertyIri: "http://ex.org/connectedTo",
      },
      { type: "ObjectPropertyDomain", propertyIri: "http://ex.org/connectedTo", domainIri: "http://ex.org/Source" },
      { type: "ObjectPropertyRange", propertyIri: "http://ex.org/connectedTo", rangeIri: "http://ex.org/Sink" },
    ]);
    reasoner.classify();

    // Additive delta: assert feeds(p1, v1) -> incrementally derives connectedTo(p1, v1), p1:Source/Node, v1:Sink/Node!
    reasoner.applyDelta({
      retractions: [],
      assertions: [
        {
          type: "ObjectPropertyAssertion",
          propertyIri: "http://ex.org/feeds",
          subjectIri: "http://ex.org/p1",
          objectIri: "http://ex.org/v1",
        },
      ],
    });

    assert.ok(reasoner.classifyIndividual("http://ex.org/p1").allTypes.includes("http://ex.org/Source"));
    assert.ok(reasoner.classifyIndividual("http://ex.org/p1").allTypes.includes("http://ex.org/Node"));
    assert.ok(reasoner.classifyIndividual("http://ex.org/v1").allTypes.includes("http://ex.org/Sink"));
    assert.ok(reasoner.classifyIndividual("http://ex.org/v1").allTypes.includes("http://ex.org/Node"));

    const bgp = reasoner.queryBgp({
      patterns: [{ subject: "http://ex.org/p1", predicate: "http://ex.org/connectedTo", object: "?dst" }],
    });
    assert.equal(bgp.bindings.length, 1);
    assert.equal(bgp.bindings[0]!["?dst"], "http://ex.org/v1");
  });

  it("orders BGP join variables by cost-based cardinality estimate via planBgpJoinOrder()", () => {
    const TYPE = RDF_TYPE;
    const HAS_ID = "http://ex.org/serialId";
    const CONNECTED = "http://ex.org/connectedTo";
    const quads = [];
    for (let i = 0; i < 500; i++) {
      quads.push(
        {
          subject: { termType: "NamedNode" as const, value: `http://ex.org/n${i}` },
          predicate: { termType: "NamedNode" as const, value: TYPE },
          object: { termType: "NamedNode" as const, value: "http://ex.org/Sensor" },
        },
        {
          subject: { termType: "NamedNode" as const, value: `http://ex.org/n${i}` },
          predicate: { termType: "NamedNode" as const, value: CONNECTED },
          object: { termType: "NamedNode" as const, value: `http://ex.org/n${(i + 1) % 500}` },
        },
      );
    }
    // Unique selective serialId on n42
    quads.push({
      subject: { termType: "NamedNode" as const, value: "http://ex.org/n42" },
      predicate: { termType: "NamedNode" as const, value: HAS_ID },
      object: { termType: "Literal" as const, value: "SN-0042", datatype: "http://www.w3.org/2001/XMLSchema#string" },
    });

    const src = createArrayTripleSource(quads);
    const plan = planBgpJoinOrder(
      [
        {
          subject: { termType: "Variable", value: "hub" },
          predicate: { termType: "NamedNode", value: TYPE },
          object: { termType: "NamedNode", value: "http://ex.org/Sensor" },
        },
        {
          subject: { termType: "Variable", value: "hub" },
          predicate: { termType: "NamedNode", value: CONNECTED },
          object: { termType: "Variable", value: "target" },
        },
        {
          subject: { termType: "Variable", value: "target" },
          predicate: { termType: "NamedNode", value: HAS_ID },
          object: { termType: "Literal", value: "SN-0042", datatype: "http://www.w3.org/2001/XMLSchema#string" },
        },
      ],
      src,
    );

    // `target` has minEstCardinality=1 (SN-0042), whereas `hub` has minEstCardinality=500 -> `target` MUST be bound first!
    assert.equal(plan[0]!.variable, "target");
    assert.equal(plan[0]!.minEstCardinality, 1);
    assert.equal(plan[1]!.variable, "hub");
  });

  it("mirrors WasmOntologyStore axioms into an attached unified PagedStorageEngine", async () => {
    const wasm = await loadPagedWasm();
    const paged = new PagedStorageEngine(wasm, 256);
    const store = new WasmOntologyStore();
    store.attachPagedStorage(paged);

    store.addAxioms("owl2", [
      { type: "ClassAssertion", classIri: "http://ex.org/Turbine", individualIri: "http://ex.org/t1" },
      {
        type: "DataPropertyAssertion",
        propertyIri: "http://ex.org/rpm",
        subjectIri: "http://ex.org/t1",
        value: "3600",
      },
    ]);

    const rows = paged.findTriplesNumericRange("http://ex.org/rpm", 3000, 4000);
    assert.equal(rows.length, 1);
    assert.equal(paged.decodeTerm(rows[0]!.subjectId), "http://ex.org/t1");
    assert.equal(paged.decodeTerm(rows[0]!.objectId), 3600);
  });

  it("saturates a 256-class hierarchy via lock-free SharedArrayBuffer atomic work-stealing across worker threads", async () => {
    const axioms: OWL2Axiom[] = [];
    // 8 chains of 32 classes each (256 classes)
    for (let chain = 0; chain < 8; chain++) {
      for (let i = 0; i < 32; i++) {
        axioms.push({ type: "ClassDeclaration", iri: `http://ex.org/C_${chain}_${i}` });
        if (i > 0) {
          axioms.push({
            type: "SubClassOf",
            subClassIri: `http://ex.org/C_${chain}_${i}`,
            superClassIri: `http://ex.org/C_${chain}_${i - 1}`,
          });
        }
      }
    }

    const reasoner = new SharedMemoryELReasoner({ workerCount: 4 });
    const res = await reasoner.saturateParallel(axioms);

    assert.equal(res.classCount, 256);
    assert.equal(res.usedSharedMemory, true);
    assert.ok(res.workerCount >= 2, `Expected multi-worker SAB execution, got workerCount=${res.workerCount}`);
    assert.equal(res.isSubClassOf("http://ex.org/C_0_31", "http://ex.org/C_0_0"), true);
    assert.equal(res.isSubClassOf("http://ex.org/C_7_31", "http://ex.org/C_7_0"), true);
    assert.equal(res.isSubClassOf("http://ex.org/C_0_31", "http://ex.org/C_1_0"), false);
    assert.equal(res.getSuperClasses("http://ex.org/C_3_31").length, 31);
  });

  it("computes vectorized columnar numeric aggregates and O(1)-graph GSPO/GPOS/GOSP quad scans", async () => {
    const batch = new Float64Array(10_000);
    for (let i = 0; i < batch.length; i++) batch[i] = i + 1;
    const agg = evalColumnarNumericAggregates(batch);
    assert.equal(agg.count, 10_000);
    assert.equal(agg.sum, 50_005_000);
    assert.equal(agg.avg, 5000.5);
    assert.equal(agg.min, 1);
    assert.equal(agg.max, 10_000);

    const wasm = await loadPagedWasm();
    const paged = new PagedStorageEngine(wasm, 256);
    for (let g = 0; g < 100; g++) {
      paged.insertQuad(`http://ex.org/s_${g}`, "http://ex.org/p", `http://ex.org/o_${g}`, `http://ex.org/graph_${g}`);
    }
    assert.equal(paged.listGraphs().length, 100);
    const g42 = paged.findQuads({ graph: "http://ex.org/graph_42", predicate: "http://ex.org/p" });
    assert.equal(g42.length, 1);
    assert.equal(paged.decodeTerm(g42[0]!.subjectId), "http://ex.org/s_42");
  });
});
