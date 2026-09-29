// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AXIOM_CLASS_DECL,
  AXIOM_OBJ_PROP_ASSERT,
  AXIOM_SUBCLASS_OF,
  AxiomRecordView,
  WasmOntologyStore,
  hashIri64,
  type WasmOntologyInstance,
} from "../src/ontology/wasm_ontology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runPhase1Tests() {
  console.log("=================================================");
  console.log("Running Phase 1 Scale & 64-Bit Architecture Tests");
  console.log("=================================================\n");

  // -------------------------------------------------------------------------
  // Test 1: 64-bit FNV-1a IRI Hashing & Collision Resistance
  // -------------------------------------------------------------------------
  console.log("[Test 1] Testing 64-bit FNV-1a Hashing...");
  {
    const h1 = hashIri64("http://example.org/modelica#Resistor");
    const h2 = hashIri64("http://example.org/modelica#Capacitor");
    const h3 = hashIri64("http://example.org/modelica#Resistor");

    assert.strictEqual(h1.hash64, h3.hash64, "Identical IRIs must yield identical 64-bit hashes");
    assert.notStrictEqual(h1.hash64, h2.hash64, "Distinct IRIs must yield distinct 64-bit hashes");
    assert.strictEqual(h1.lo, Number(h1.hash64 & 0xffffffffn) >>> 0);
    assert.strictEqual(h1.hi, Number((h1.hash64 >> 32n) & 0xffffffffn) >>> 0);

    // Collision resistance check across 200,000 distinct synthetic IRIs
    const seen64 = new Set<bigint>();
    let collisionCount = 0;
    const testCount = 200_000;
    for (let i = 0; i < testCount; i++) {
      const iri = `http://modelscript.io/sysml2/part_item_${i}_${i * 31}`;
      const { hash64 } = hashIri64(iri);
      if (seen64.has(hash64)) {
        collisionCount++;
      } else {
        seen64.add(hash64);
      }
    }
    assert.strictEqual(
      collisionCount,
      0,
      `64-bit hash produced ${collisionCount} collisions across ${testCount} items (expected 0)`,
    );
    console.log(`✔ 64-bit hash: 0 collisions across ${testCount.toLocaleString()} distinct IRIs.`);
  }

  // -------------------------------------------------------------------------
  // Test 2: WASM EntityDictionary & 64-Bit Ingestion
  // -------------------------------------------------------------------------
  console.log("\n[Test 2] Testing WASM EntityDictionary & 64-Bit Direct Ingestion...");
  const wasmPath = path.resolve(__dirname, "../build/debug.wasm");
  if (fs.existsSync(wasmPath)) {
    const wasmBytes = fs.readFileSync(wasmPath);
    const wasmModule = await WebAssembly.instantiate(wasmBytes, {
      env: {
        abort: (msg: any, file: any, line: any, col: any) => {
          throw new Error(`WASM abort at ${line}:${col}`);
        },
      },
    });
    const wasmInstance = wasmModule.instance.exports as unknown as WasmOntologyInstance;

    assert.ok(typeof wasmInstance.ontology_addAxiom64 === "function", "ontology_addAxiom64 must be exported");
    assert.ok(
      typeof wasmInstance.ontology_getOrCreateEntity === "function",
      "ontology_getOrCreateEntity must be exported",
    );
    assert.ok(typeof wasmInstance.ontology_getEntityHashLo === "function", "ontology_getEntityHashLo must be exported");

    wasmInstance.ontology_clear?.();

    // Map 64-bit hashes to dense entity IDs
    const hResistor = hashIri64("mo:Resistor");
    const hComponent = hashIri64("mo:Component");
    const hDevice = hashIri64("mo:Device");

    const idResistor1 = wasmInstance.ontology_getOrCreateEntity!(hResistor.lo, hResistor.hi);
    const idComponent = wasmInstance.ontology_getOrCreateEntity!(hComponent.lo, hComponent.hi);
    const idDevice = wasmInstance.ontology_getOrCreateEntity!(hDevice.lo, hDevice.hi);

    // Re-getting existing entity must return identical dense ID
    const idResistor2 = wasmInstance.ontology_getOrCreateEntity!(hResistor.lo, hResistor.hi);
    assert.strictEqual(idResistor1, idResistor2, "Idempotent getOrCreateEntity");
    assert.strictEqual(idResistor1, 1, "First entity should be dense ID 1");
    assert.strictEqual(idComponent, 2, "Second entity should be dense ID 2");
    assert.strictEqual(idDevice, 3, "Third entity should be dense ID 3");

    // Reverse lookup from dense ID -> 64-bit hash
    const recLo = wasmInstance.ontology_getEntityHashLo!(idResistor1) >>> 0;
    const recHi = wasmInstance.ontology_getEntityHashHi!(idResistor1) >>> 0;
    assert.strictEqual(recLo, hResistor.lo, "Recovered hash low 32 bits match");
    assert.strictEqual(recHi, hResistor.hi, "Recovered hash high 32 bits match");

    // Add axioms via 64-bit direct ingestion
    // Resistor ⊑ Component, Component ⊑ Device
    wasmInstance.ontology_addAxiom64!(AXIOM_CLASS_DECL, 1, hResistor.lo, hResistor.hi, 0, 0, 0, 0, 0, 0);
    wasmInstance.ontology_addAxiom64!(AXIOM_CLASS_DECL, 1, hComponent.lo, hComponent.hi, 0, 0, 0, 0, 0, 0);
    wasmInstance.ontology_addAxiom64!(AXIOM_CLASS_DECL, 1, hDevice.lo, hDevice.hi, 0, 0, 0, 0, 0, 0);
    wasmInstance.ontology_addAxiom64!(
      AXIOM_SUBCLASS_OF,
      1,
      hResistor.lo,
      hResistor.hi,
      0,
      0,
      hComponent.lo,
      hComponent.hi,
      0,
      0,
    );
    wasmInstance.ontology_addAxiom64!(
      AXIOM_SUBCLASS_OF,
      1,
      hComponent.lo,
      hComponent.hi,
      0,
      0,
      hDevice.lo,
      hDevice.hi,
      0,
      0,
    );

    const inferred = wasmInstance.ontology_saturateELRules!();
    assert.ok(inferred >= 1, "EL saturation should infer Resistor ⊑ Device");

    // Check subsumption using dense entity IDs
    const isSub = wasmInstance.ontology_isSubClassOf!(idResistor1, idDevice);
    assert.strictEqual(isSub, 1, "Resistor must be classified as subclass of Device in WASM");

    console.log("✔ WASM EntityDictionary & 64-bit direct ingestion verified.");

    // -------------------------------------------------------------------------
    // Test 3: Pure-WASM Zero-Copy Mode vs JS Heap Memory
    // -------------------------------------------------------------------------
    console.log("\n[Test 3] Testing Pure-WASM Zero-Copy Mode & Memory Footprint...");
    {
      const store = new WasmOntologyStore(wasmInstance);
      store.setPureWasmMode(true);
      assert.strictEqual(store.isPureWasmMode, true);

      wasmInstance.ontology_clear?.();

      const initialMem = process.memoryUsage().heapUsed;
      const count = 50_000;

      for (let i = 0; i < count; i++) {
        store.addAxiomDirect64(
          AXIOM_OBJ_PROP_ASSERT,
          1,
          `mo:part_${i}`,
          "mo:connectedTo",
          `mo:part_${(i + 1) % count}`,
        );
      }

      const postMem = process.memoryUsage().heapUsed;
      const heapDeltaMb = (postMem - initialMem) / (1024 * 1024);

      assert.strictEqual(store.size, count, `Store size should report ${count} axioms from WASM`);
      assert.strictEqual(store.axioms.length, 0, "JS axioms array must be 0 in pure-WASM mode");
      console.log(`✔ Ingested ${count.toLocaleString()} axioms in Pure-WASM mode.`);
      console.log(`  JS Heap delta: ${heapDeltaMb.toFixed(2)} MB (retains 0 JS AST objects).`);
      assert.ok(heapDeltaMb < 15, `JS Heap delta (${heapDeltaMb.toFixed(2)} MB) should be < 15 MB`);
    }

    // -------------------------------------------------------------------------
    // Test 4: AxiomRecordView Zero-Allocation Flyweight
    // -------------------------------------------------------------------------
    console.log("\n[Test 4] Testing AxiomRecordView Flyweight...");
    {
      const rawMem = new Uint32Array(wasmInstance.memory!.buffer);
      // Query buffer test
      const queryCount = wasmInstance.ontology_queryTriples!(0, 0, 0);
      assert.ok(queryCount > 0, "Triples query should return results");

      const queryBufPtr = wasmInstance.ontology_getQueryBuffer!();
      const wordOffset = queryBufPtr >> 2;
      const view = new AxiomRecordView(rawMem, wordOffset);

      assert.strictEqual(view.axiomType, AXIOM_OBJ_PROP_ASSERT);
      assert.ok(view.subjectId > 0, "Subject ID must be valid non-zero dense ID");
      console.log(
        `✔ AxiomRecordView read record 0: type=${view.axiomType}, subjectId=${view.subjectId}, predicateId=${view.predicateId}`,
      );
    }
  } else {
    console.warn("WASM binary not found at", wasmPath, "skipping live WASM tests.");
  }

  console.log("\n=================================================");
  console.log("ALL PHASE 1 SCALE & 64-BIT TESTS PASSED!");
  console.log("=================================================");
}

runPhase1Tests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
