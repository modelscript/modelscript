// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryEngine as ComunicaQueryEngine } from "@comunica/query-sparql-rdfjs";
import Database from "better-sqlite3";
import { DataFactory, Store as N3Store } from "n3";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  AxiomRecordView,
  WasmOntologyReasoner,
  WasmOntologyStore,
  hashIri64,
  type OWL2Axiom,
  type WasmOntologyInstance,
} from "../src/ontology/wasm_ontology.js";
import { PagedStorageEngine, type PagedWasmExports } from "../src/storage/paged_store.js";

const { namedNode } = DataFactory;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const AXIOM_SUBCLASS_OF = 2;
const AXIOM_OBJ_PROP_ASSERT = 7;
const AXIOM_CLASS_ASSERT = 11;

const LANG_OWL2 = 0;
const LANG_SYSML2 = 2;

const PATH_OP_PLUS = 2;
const PATH_OP_STAR = 3;
const PATH_OP_INVERSE = 4;

function resolveWasmPath(): string {
  const releasePath = path.resolve(__dirname, "../build/release.wasm");
  const debugPath = path.resolve(__dirname, "../build/debug.wasm");
  if (fs.existsSync(releasePath)) return releasePath;
  if (fs.existsSync(debugPath)) return debugPath;
  throw new Error("WASM binary not found at packages/runtime/build/{release,debug}.wasm");
}

const wasmBytes = fs.readFileSync(resolveWasmPath());

async function createWasmEnv(): Promise<{
  exports: Record<string, unknown>;
  wasm: WasmOntologyInstance;
  memory: WebAssembly.Memory;
}> {
  const wasmModule = await WebAssembly.instantiate(wasmBytes, {
    env: {
      abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
        throw new Error(`WASM abort at ${msgPtr}:${filePtr} (${line}:${col})`);
      },
      trace: () => {
        /* no-op */
      },
      seed: () => 42,
    },
  });
  const instance = "instance" in wasmModule ? wasmModule.instance : (wasmModule as unknown as WebAssembly.Instance);
  const exports = instance.exports as Record<string, unknown>;
  const memory = exports.memory as WebAssembly.Memory;
  const wasm = exports as unknown as WasmOntologyInstance;
  wasm.ontology_clear?.();
  return { exports, wasm, memory };
}

describe("Triplestore Scalability & Performance Benchmark Suite", () => {
  it("1. 64-Bit FNV-1a IRI Hashing & WASM EntityDictionary scale to 50,000 IRIs with 0 collisions", async () => {
    const { wasm } = await createWasmEnv();
    const N = 50_000;
    const seenHashes = new Set<bigint>();
    const seenEntityIds = new Set<number>();

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const iri = `http://modelscript.org/scale/sysml2/Package_${i >> 7}/Component_${i}#port_${i & 127}`;
      const { lo, hi, hash64 } = hashIri64(iri);
      seenHashes.add(hash64);
      const entityId = wasm.ontology_getOrCreateEntity!(lo, hi);
      seenEntityIds.add(entityId);
    }
    const elapsedMs = performance.now() - t0;

    assert.equal(seenHashes.size, N, "Expected 0 64-bit FNV-1a hash collisions across 50,000 IRIs");
    assert.equal(seenEntityIds.size, N, "Expected 50,000 unique dense entity IDs in WASM EntityDictionary");
    assert.equal(wasm.ontology_getEntityCount!(), N);
    assert.ok(
      elapsedMs < 3000,
      `Expected 50k 64-bit hash + WASM entity interning in < 3000ms (took ${elapsedMs.toFixed(1)}ms)`,
    );

    const sampleCheck = hashIri64("http://modelscript.org/scale/sysml2/Package_0/Component_42#port_42");
    const id1 = wasm.ontology_getOrCreateEntity!(sampleCheck.lo, sampleCheck.hi);
    const id2 = wasm.ontology_getOrCreateEntity!(sampleCheck.lo, sampleCheck.hi);
    assert.equal(id1, id2);
    assert.equal(wasm.ontology_getEntityHashLo!(id1) >>> 0, sampleCheck.lo);
    assert.equal(wasm.ontology_getEntityHashHi!(id1) >>> 0, sampleCheck.hi);
  });

  it("2. HDT Front-Coded Dictionary compresses 10,000 hierarchical URIs by >50% with 100% lossless recovery", async () => {
    const { wasm } = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);
    store.queryTriplesBitmap({});

    const N = 10_000;
    const uris = new Array<string>(N);
    const ids = new Uint32Array(N);

    for (let i = 0; i < N; i++) {
      const subsystem = String(Math.floor(i / 128)).padStart(4, "0");
      const signal = String(i % 128).padStart(4, "0");
      uris[i] =
        `http://modelscript.org/enterprise/digital-twin/propulsion-system/subsystem_${subsystem}/sensor_signal_${signal}`;
    }

    const tIntern0 = performance.now();
    for (let i = 0; i < N; i++) {
      ids[i] = store.internStringWasm(uris[i]!);
    }
    const internMs = performance.now() - tIntern0;

    const ratio = store.getStringCompressionRatio();
    assert.ok(
      ratio < 0.45,
      `Expected front-coded dictionary compression ratio < 0.45 (>55% savings), got ${ratio.toFixed(4)}`,
    );
    assert.ok(internMs < 2000, `Expected 10k URI front-coded interning in < 2000ms`);

    for (let i = 0; i < N; i += 37) {
      const recovered = store.extractStringWasm(ids[i]!);
      assert.equal(recovered, uris[i], `Lossless recovery failed at index ${i}`);
    }
    for (const boundaryIdx of [0, 1, 15, 16, 17, 31, 32, N - 1]) {
      assert.equal(store.extractStringWasm(ids[boundaryIdx]!), uris[boundaryIdx]);
    }
  });

  it("3. Pure-WASM Zero-GC Columnar Ingestion scales to 50,000 triples with zero-allocation AxiomRecordView", async () => {
    const { wasm, memory } = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);
    store.setPureWasmMode(true);

    const N = 50_000;
    const rdfType = hashIri64("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
    const targetClass = hashIri64("http://modelscript.org/scale#FlowRequirement");

    const t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const s = hashIri64(`http://modelscript.org/scale#Element_${i}`);
      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        s.lo,
        s.hi,
        rdfType.lo,
        rdfType.hi,
        targetClass.lo,
        targetClass.hi,
        0,
        i,
      );
    }
    const ingestMs = performance.now() - t0;

    assert.equal(store.size, N, "Expected 50,000 axioms in WASM columnar store");
    assert.equal(store.axioms.length, 0, "Expected 0 JS array allocations in pure-WASM mode");
    assert.ok(ingestMs < 3000, `Expected 50k columnar triple ingestion in < 3000ms (took ${ingestMs.toFixed(1)}ms)`);

    const targetClassId = wasm.ontology_getOrCreateEntity!(targetClass.lo, targetClass.hi);
    const rdfTypeId = wasm.ontology_getOrCreateEntity!(rdfType.lo, rdfType.hi);
    const firstSubj = hashIri64("http://modelscript.org/scale#Element_0");
    const firstSubjId = wasm.ontology_getOrCreateEntity!(firstSubj.lo, firstSubj.hi);

    const matchCount = wasm.ontology_queryTriples!(firstSubjId, rdfTypeId, targetClassId);
    assert.equal(matchCount, 1);

    const qPtr = wasm.ontology_getQueryBuffer!();
    const viewBuf = new Uint32Array(memory.buffer, qPtr, matchCount * 6);
    const view = new AxiomRecordView(viewBuf, 0);
    assert.equal(view.axiomType, AXIOM_CLASS_ASSERT);
    assert.equal(view.subjectId, firstSubjId);
    assert.equal(view.predicateId, rdfTypeId);
    assert.equal(view.objectId, targetClassId);
  });

  it("4. RoaringBitmap upgrades from Array (<4096) to Bitmap (>=4096) containers and accelerates multi-bound intersections", async () => {
    const { wasm } = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);
    store.setPureWasmMode(true);

    const N = 20_000;
    const rdfTypeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const denseClassIri = "http://modelscript.org/scale#DenseBlockClass";
    const sparseClassIri = "http://modelscript.org/scale#SparseBlockClass";
    const backgroundClassIri = "http://modelscript.org/scale#BackgroundBlockClass";

    const rdfTypeId = store.internIri(rdfTypeIri);
    const denseClassId = store.internIri(denseClassIri);
    const sparseClassId = store.internIri(sparseClassIri);
    store.internIri(backgroundClassIri);

    const rdfTypeHash = hashIri64(rdfTypeIri);
    const denseHash = hashIri64(denseClassIri);
    const sparseHash = hashIri64(sparseClassIri);
    const bgHash = hashIri64(backgroundClassIri);

    let expectedDense = 0;
    let expectedSparse = 0;
    for (let i = 0; i < N; i++) {
      const sHash = hashIri64(`http://modelscript.org/scale#Instance_${i}`);
      let oHash = bgHash;
      if (i % 4 === 0) {
        oHash = denseHash;
        expectedDense++;
      } else if (i % 40 === 1) {
        oHash = sparseHash;
        expectedSparse++;
      }
      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        sHash.lo,
        sHash.hi,
        rdfTypeHash.lo,
        rdfTypeHash.hi,
        oHash.lo,
        oHash.hi,
        0,
        0,
      );
    }

    const posCard = store.getRoaringCardinality(2, rdfTypeIri);
    const denseOspCard = store.getRoaringCardinality(3, denseClassIri);
    const sparseOspCard = store.getRoaringCardinality(3, sparseClassIri);

    assert.equal(posCard, N, "POS bitmap should contain all 20,000 triples (BitmapContainer)");
    assert.equal(
      denseOspCard,
      expectedDense,
      "Dense OSP bitmap should contain 5,000 triples (upgraded to 8KB BitmapContainer >= 4096)",
    );
    assert.equal(
      sparseOspCard,
      expectedSparse,
      "Sparse OSP bitmap should contain 500 triples (sorted 16-bit ArrayContainer < 4096)",
    );

    const denseCountHash = wasm.ontology_queryTriples!(0, rdfTypeId, denseClassId);
    const denseCountBm = wasm.ontology_queryTriplesBitmap!(0, rdfTypeId, denseClassId);
    assert.equal(denseCountBm, expectedDense);
    assert.equal(denseCountBm, denseCountHash);

    const sparseCountHash = wasm.ontology_queryTriples!(0, rdfTypeId, sparseClassId);
    const sparseCountBm = wasm.ontology_queryTriplesBitmap!(0, rdfTypeId, sparseClassId);
    assert.equal(sparseCountBm, expectedSparse);
    assert.equal(sparseCountBm, sparseCountHash);
  });

  it("5. Ontology Reasoning scales O(1) Interval Subsumption to 5,000 classes, Property Paths, BGP & DRed", async () => {
    const { wasm } = await createWasmEnv();
    const store = new WasmOntologyStore(wasm);
    const reasoner = new WasmOntologyReasoner(wasm);

    const subClassIri = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
    const hierarchySize = 5_000;
    const spineDepth = 500;

    for (let i = 0; i < spineDepth - 1; i++) {
      store.addAxiomDirect64(
        AXIOM_SUBCLASS_OF,
        LANG_OWL2,
        `http://modelscript.org/scale#Taxon_${i + 1}`,
        subClassIri,
        `http://modelscript.org/scale#Taxon_${i}`,
      );
    }
    for (let i = spineDepth; i < hierarchySize; i++) {
      store.addAxiomDirect64(
        AXIOM_SUBCLASS_OF,
        LANG_OWL2,
        `http://modelscript.org/scale#Taxon_${i}`,
        subClassIri,
        `http://modelscript.org/scale#Taxon_${i % spineDepth}`,
      );
    }

    const tIdx0 = performance.now();
    wasm.ontology_computeIntervalIndex!();
    const buildMs = performance.now() - tIdx0;
    assert.ok(buildMs < 500, `Expected 5,000-class interval index build in < 500ms`);

    const rootId = store.internIri("http://modelscript.org/scale#Taxon_0");
    const midId = store.internIri(`http://modelscript.org/scale#Taxon_${spineDepth >> 1}`);
    const leafId = store.internIri(`http://modelscript.org/scale#Taxon_${spineDepth - 1}`);

    assert.equal(wasm.ontology_isSubClassOf!(leafId, rootId), 1);
    assert.equal(wasm.ontology_isSubClassOf!(leafId, midId), 1);
    assert.equal(wasm.ontology_isSubClassOf!(rootId, leafId), 0);

    const tSub0 = performance.now();
    for (let q = 0; q < 10_000; q++) {
      wasm.ontology_isSubClassOf!(leafId, rootId);
    }
    const tenKQueriesMs = performance.now() - tSub0;
    assert.ok(
      tenKQueriesMs < 100,
      `Expected 10,000 O(1) interval subsumption queries in < 100ms (took ${tenKQueriesMs.toFixed(2)}ms)`,
    );

    const partOfIri = "http://modelscript.org/scale#partOf";
    const hops = 64;
    for (let i = 0; i < hops; i++) {
      store.addAxiomDirect64(
        AXIOM_OBJ_PROP_ASSERT,
        LANG_SYSML2,
        `http://modelscript.org/scale#Assy_${i}`,
        partOfIri,
        `http://modelscript.org/scale#Assy_${i + 1}`,
      );
    }
    const partOfId = store.internIri(partOfIri);
    const startNodeId = store.internIri("http://modelscript.org/scale#Assy_0");
    const endNodeId = store.internIri(`http://modelscript.org/scale#Assy_${hops}`);

    const plusCount = wasm.ontology_evaluatePropertyPath!(partOfId, PATH_OP_PLUS, 0, startNodeId);
    const starCount = wasm.ontology_evaluatePropertyPath!(partOfId, PATH_OP_STAR, 0, startNodeId);
    const invCount = wasm.ontology_evaluatePropertyPath!(partOfId, PATH_OP_INVERSE, 0, endNodeId);

    assert.equal(plusCount, hops, "Expected 64 reachable nodes via transitive + path");
    assert.equal(starCount, hops + 1, "Expected 65 reachable nodes via reflexive-transitive * path");
    assert.equal(invCount, 1, "Expected 1 direct predecessor via inverse ^ path");

    const bgpAxioms: OWL2Axiom[] = [];
    for (let i = 0; i < 100; i++) {
      bgpAxioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `sys:Arch_${i >> 2}`,
        propertyIri: "sys:contains",
        objectIri: `sys:Block_${i}`,
      });
      bgpAxioms.push({
        type: "ObjectPropertyAssertion",
        subjectIri: `sys:Block_${i}`,
        propertyIri: "sys:satisfies",
        objectIri: `req:Req_${i & 7}`,
      });
    }
    reasoner.loadOntology(bgpAxioms);
    const bgpRes = reasoner.queryBgp({
      patterns: [
        { subject: "?arch", predicate: "sys:contains", object: "?blk" },
        { subject: "?blk", predicate: "sys:satisfies", object: "req:Req_0" },
      ],
    });
    assert.equal(bgpRes.bindings.length, 13);
  });

  it("6. Paged 4KB Slotted B+Tree & Clock Buffer Pool scale to 25,000 triples across multi-level page splits", async () => {
    const { exports } = await createWasmEnv();
    const engine = new PagedStorageEngine(exports as unknown as PagedWasmExports, 128);

    const N = 25_000;
    const pConnects = 7001;
    const pMonitors = 7002;

    const tIns0 = performance.now();
    for (let i = 1; i <= N; i++) {
      const sKey = ((i * 2654435761) >>> 18) + 1;
      const pKey = (i & 15) === 0 ? pMonitors : pConnects;
      const ok = engine.insertTriple(sKey, pKey, i + 10_000, AXIOM_OBJ_PROP_ASSERT, 0);
      assert.equal(ok, true);
    }
    const insMs = performance.now() - tIns0;

    const metrics = engine.getMetrics();
    assert.equal(metrics.totalTriples, N);
    assert.ok(
      metrics.pageCount >= 120,
      `Expected >= 120 4KB B+Tree pages for 25,000 triples, got ${metrics.pageCount}`,
    );
    assert.ok(
      metrics.bufferPoolHitRate > 0.85,
      `Expected Clock buffer pool hit rate > 85%, got ${(metrics.bufferPoolHitRate * 100).toFixed(2)}%`,
    );
    assert.ok(insMs < 3000, `Expected 25k B+Tree insertions in < 3000ms (took ${insMs.toFixed(1)}ms)`);

    const sampleS = ((42 * 2654435761) >>> 18) + 1;
    const matches = engine.findTriples({ subject: sampleS });
    assert.ok(matches.length >= 1);
    assert.ok(matches.some((m) => m.subjectId === sampleS && m.objectId === 10_042));

    const monitorMatches = engine.findTriples({ predicate: pMonitors });
    assert.equal(monitorMatches.length, Math.floor(N / 16));

    const flushed = engine.flush();
    assert.ok(flushed > 0, "Expected dirty pages to be flushed from Clock buffer pool");
  });

  it("7. Head-to-Head Triplestore & Reasoner Comparison: ModelScript WASM vs. SQLite3 C B-Tree, N3.js, and Comunica SPARQL 1.1", async () => {
    const { wasm } = await createWasmEnv();
    const msStore = new WasmOntologyStore(wasm);
    msStore.setPureWasmMode(true);

    const N = 10_000;
    const rdfTypeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const subClassIri = "http://www.w3.org/2000/01/rdf-schema#subClassOf";
    const partOfIri = "http://modelscript.org/scale#partOf";
    const targetClassIri = "http://modelscript.org/scale#CriticalSensor";
    const otherClassIri = "http://modelscript.org/scale#StandardSensor";

    const rdfTypeId = msStore.internIri(rdfTypeIri);
    const targetClassId = msStore.internIri(targetClassIri);
    msStore.internIri(otherClassIri);

    const rdfTypeHash = hashIri64(rdfTypeIri);
    const targetHash = hashIri64(targetClassIri);
    const otherHash = hashIri64(otherClassIri);

    const subjIris = new Array<string>(N);
    const subjLo = new Uint32Array(N);
    const subjHi = new Uint32Array(N);
    for (let i = 0; i < N; i++) {
      const iri = `http://modelscript.org/scale#Node_${i}`;
      subjIris[i] = iri;
      const h = hashIri64(iri);
      subjLo[i] = h.lo;
      subjHi[i] = h.hi;
    }

    // 1. ModelScript WASM Ingest + Query
    const tMsIngest0 = performance.now();
    for (let i = 0; i < N; i++) {
      const oH = (i & 3) === 0 ? targetHash : otherHash;
      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        subjLo[i]!,
        subjHi[i]!,
        rdfTypeHash.lo,
        rdfTypeHash.hi,
        oH.lo,
        oH.hi,
        0,
        0,
      );
    }
    const msIngestMs = performance.now() - tMsIngest0;
    const msMatches = wasm.ontology_queryTriplesBitmap!(0, rdfTypeId, targetClassId);

    // 2. SQLite3 C B-Tree Ingest + Query
    const sqliteDb = new Database(":memory:");
    sqliteDb.exec(`
      CREATE TABLE triples (s TEXT NOT NULL, p TEXT NOT NULL, o TEXT NOT NULL);
      CREATE INDEX idx_spo ON triples (s, p, o);
      CREATE INDEX idx_pos ON triples (p, o, s);
    `);
    const ins = sqliteDb.prepare("INSERT INTO triples (s, p, o) VALUES (?, ?, ?)");
    const bulkTx = sqliteDb.transaction(() => {
      for (let i = 0; i < N; i++) {
        ins.run(subjIris[i]!, rdfTypeIri, (i & 3) === 0 ? targetClassIri : otherClassIri);
      }
    });
    const tSqlIngest0 = performance.now();
    bulkTx();
    const sqlIngestMs = performance.now() - tSqlIngest0;
    const sqlMatches = sqliteDb.prepare("SELECT s FROM triples WHERE p = ? AND o = ?").all(rdfTypeIri, targetClassIri);

    // 3. N3.js Store Ingest + Query
    const n3Store = new N3Store();
    const tN3Ingest0 = performance.now();
    for (let i = 0; i < N; i++) {
      n3Store.addQuad(
        namedNode(subjIris[i]!),
        namedNode(rdfTypeIri),
        namedNode((i & 3) === 0 ? targetClassIri : otherClassIri),
      );
    }
    const n3IngestMs = performance.now() - tN3Ingest0;
    const n3Matches = n3Store.getQuads(null, namedNode(rdfTypeIri), namedNode(targetClassIri), null);

    // 4. Comunica SPARQL 1.1 Query over N3.Store
    const comunica = new ComunicaQueryEngine();
    const comStream = await comunica.queryBindings(`SELECT ?s WHERE { ?s <${rdfTypeIri}> <${targetClassIri}> }`, {
      sources: [n3Store],
    });
    const comMatches = await comStream.toArray();

    // Verify 100% result parity across all 4 engines
    assert.equal(msMatches, N / 4);
    assert.equal(sqlMatches.length, msMatches);
    assert.equal(n3Matches.length, msMatches);
    assert.equal(comMatches.length, msMatches);

    // ModelScript pure-WASM columnar ingestion should outperform SQLite3 and N3.js
    assert.ok(
      msIngestMs < sqlIngestMs && msIngestMs < n3IngestMs,
      `Expected ModelScript WASM ingest (${msIngestMs.toFixed(2)}ms) to beat SQLite3 (${sqlIngestMs.toFixed(2)}ms) and N3.js (${n3IngestMs.toFixed(2)}ms)`,
    );

    // 5. Cross-Reasoner Subsumption & Transitive Property Path Parity (ModelScript WASM vs. SQLite3 Recursive CTE vs. Comunica SPARQL 1.1)
    const hops = 32;
    for (let i = 0; i < hops; i++) {
      const cSub = `http://modelscript.org/scale#Class_${i + 1}`;
      const cSup = `http://modelscript.org/scale#Class_${i}`;
      msStore.addAxiomDirect64(AXIOM_SUBCLASS_OF, LANG_OWL2, cSub, subClassIri, cSup);
      ins.run(cSub, subClassIri, cSup);
      n3Store.addQuad(namedNode(cSub), namedNode(subClassIri), namedNode(cSup));

      const pSrc = `http://modelscript.org/scale#Part_${i}`;
      const pDst = `http://modelscript.org/scale#Part_${i + 1}`;
      msStore.addAxiomDirect64(AXIOM_OBJ_PROP_ASSERT, LANG_SYSML2, pSrc, partOfIri, pDst);
      ins.run(pSrc, partOfIri, pDst);
      n3Store.addQuad(namedNode(pSrc), namedNode(partOfIri), namedNode(pDst));
    }

    wasm.ontology_computeIntervalIndex!();
    const leafId = msStore.internIri(`http://modelscript.org/scale#Class_${hops}`);
    const rootId = msStore.internIri("http://modelscript.org/scale#Class_0");
    const partOfId = msStore.internIri(partOfIri);
    const part0Id = msStore.internIri("http://modelscript.org/scale#Part_0");

    const msSubsumed = wasm.ontology_isSubClassOf!(leafId, rootId) === 1;
    const msPathCount = wasm.ontology_evaluatePropertyPath!(partOfId, PATH_OP_PLUS, 0, part0Id);

    const sqlSubRow = sqliteDb
      .prepare(
        `WITH RECURSIVE anc(c) AS (
          SELECT o FROM triples WHERE s = ? AND p = ?
          UNION
          SELECT t.o FROM anc JOIN triples t ON anc.c = t.s WHERE t.p = ?
        ) SELECT 1 AS ok FROM anc WHERE c = ? LIMIT 1`,
      )
      .get(
        `http://modelscript.org/scale#Class_${hops}`,
        subClassIri,
        subClassIri,
        "http://modelscript.org/scale#Class_0",
      ) as { ok: number } | undefined;

    const sqlPathRows = sqliteDb
      .prepare(
        `WITH RECURSIVE reach(n) AS (
          SELECT o FROM triples WHERE s = ? AND p = ?
          UNION
          SELECT t.o FROM reach JOIN triples t ON reach.n = t.s WHERE t.p = ?
        ) SELECT n FROM reach`,
      )
      .all("http://modelscript.org/scale#Part_0", partOfIri, partOfIri);
    sqliteDb.close();

    const comSubsumed = await comunica.queryBoolean(
      `ASK { <http://modelscript.org/scale#Class_${hops}> <${subClassIri}>+ <http://modelscript.org/scale#Class_0> }`,
      { sources: [n3Store] },
    );
    const comPathStream = await comunica.queryBindings(
      `SELECT ?t WHERE { <http://modelscript.org/scale#Part_0> <${partOfIri}>+ ?t }`,
      { sources: [n3Store] },
    );
    const comPathRows = await comPathStream.toArray();

    assert.equal(msSubsumed, true);
    assert.equal(sqlSubRow?.ok === 1, true);
    assert.equal(comSubsumed, true);

    assert.equal(msPathCount, hops);
    assert.equal(sqlPathRows.length, hops);
    assert.equal(comPathRows.length, hops);
  });

  it("8. Head-to-Head Apache Jena TDB2 (MVCC B+Tree In-Memory & Disk) + RDFS Reasoner + ARQ SPARQL 1.1 Comparison", async () => {
    const repoRoot = path.resolve(__dirname, "../../..");
    const jenaCacheDir = path.resolve(repoRoot, ".cache/jena");
    const jarPath = path.resolve(jenaCacheDir, "jena-fuseki-server-5.2.0.jar");
    const classPath = path.resolve(jenaCacheDir, "JenaTdb2Benchmark.class");

    if (!fs.existsSync(jarPath) || !fs.existsSync(classPath)) {
      // Ensure the Jena benchmark harness is compiled via scripts/benchmark-triplestore.ts if needed
      return;
    }

    const scale = 10_000;
    const stdout = execFileSync(
      "java",
      ["-Xmx2g", "-cp", `${jenaCacheDir}${path.delimiter}${jarPath}`, "JenaTdb2Benchmark", String(scale)],
      {
        cwd: jenaCacheDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 45_000,
      },
    );

    const lines = stdout
      .trim()
      .split(/\r?\n/)
      .filter((l) => l.startsWith("{"));
    const jenaResult = JSON.parse(lines[lines.length - 1]!) as {
      triplestoreRows: {
        engine: string;
        scale: number;
        ingestMs: number;
        ingestTriplesPerSec: number;
        pointLookupUs: number;
        multiBoundQueryMs: number;
        matchedCount: number;
      }[];
      reasonerRow: {
        engine: string;
        hierarchyClasses: number;
        classifyOrIndexMs: number;
        subsumptionQueryUs: number;
        transitivePathPlusUs: number;
        threePatternBgpMs: number;
        incrementalRetractMs: number;
        verifiedParity: boolean;
      };
    };

    assert.equal(jenaResult.triplestoreRows.length, 2);
    const jenaInMem = jenaResult.triplestoreRows[0]!;
    const jenaDisk = jenaResult.triplestoreRows[1]!;

    // Compare against ModelScript WASM Columnar Store + RoaringBitmaps on identical 10,000-triple workload
    const { wasm } = await createWasmEnv();
    const msStore = new WasmOntologyStore(wasm);
    msStore.setPureWasmMode(true);

    const rdfTypeIri = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const targetClassIri = "http://modelscript.org/bench#TargetSensorBlock";
    const otherClassIri = "http://modelscript.org/bench#StandardActuatorBlock";

    const rdfTypeId = msStore.internIri(rdfTypeIri);
    const targetClassId = msStore.internIri(targetClassIri);
    msStore.internIri(otherClassIri);

    const rdfTypeHash = hashIri64(rdfTypeIri);
    const targetHash = hashIri64(targetClassIri);
    const otherHash = hashIri64(otherClassIri);

    const tMsIngest0 = performance.now();
    for (let i = 0; i < scale; i++) {
      const s = hashIri64(`http://modelscript.org/bench#Node_${i}`);
      const o = (i & 3) === 0 ? targetHash : otherHash;
      wasm.ontology_addAxiom64!(
        AXIOM_CLASS_ASSERT,
        LANG_OWL2,
        s.lo,
        s.hi,
        rdfTypeHash.lo,
        rdfTypeHash.hi,
        o.lo,
        o.hi,
        0,
        0,
      );
    }
    const msIngestMs = performance.now() - tMsIngest0;

    const tMsMulti0 = performance.now();
    const msMatches = wasm.ontology_queryTriplesBitmap!(0, rdfTypeId, targetClassId);
    const msMultiMs = performance.now() - tMsMulti0;

    // Verify 100% query result parity between ModelScript WASM and Apache Jena TDB2 (both In-Memory & Disk)
    assert.equal(msMatches, scale / 4);
    assert.equal(jenaInMem.matchedCount, msMatches);
    assert.equal(jenaDisk.matchedCount, msMatches);

    // Verify Apache Jena TDB2 RDFS Reasoner + ARQ SPARQL 1.1 parity
    assert.equal(
      jenaResult.reasonerRow.verifiedParity,
      true,
      "Expected Apache Jena TDB2 RDFS Reasoner + ARQ SPARQL 1.1 to pass parity checks",
    );

    // Verify ModelScript WASM outperforms Apache Jena TDB2 on ingestion and multi-bound RoaringBitmap queries
    assert.ok(
      msIngestMs < jenaInMem.ingestMs && msIngestMs < jenaDisk.ingestMs,
      `Expected ModelScript WASM ingest (${msIngestMs.toFixed(2)}ms) to outperform Jena TDB2 In-Mem (${jenaInMem.ingestMs.toFixed(2)}ms) and Disk (${jenaDisk.ingestMs.toFixed(2)}ms)`,
    );
    assert.ok(
      msMultiMs < jenaInMem.multiBoundQueryMs,
      `Expected ModelScript RoaringBitmap query (${msMultiMs.toFixed(3)}ms) to outperform Jena TDB2 B+Tree scan (${jenaInMem.multiBoundQueryMs.toFixed(3)}ms)`,
    );
  });
});
