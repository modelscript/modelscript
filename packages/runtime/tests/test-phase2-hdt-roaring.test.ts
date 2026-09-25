// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  AXIOM_CLASS_ASSERT,
  AXIOM_OBJ_PROP_ASSERT,
  WasmOntologyStore,
  hashIri64,
  type WasmOntologyInstance,
} from "../src/ontology/wasm_ontology.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadWasmInstance(): Promise<{ instance: WasmOntologyInstance; wasmModule: WebAssembly.Module }> {
  const wasmPath = path.resolve(__dirname, "../build/debug.wasm");
  const wasmBytes = fs.readFileSync(wasmPath);
  const wasmModule = await WebAssembly.compile(wasmBytes);

  const env = {
    abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
      console.error(`WASM Abort at line ${line}, col ${col}`);
    },
    trace: (msgPtr: number, n: number) => {
      console.log(`WASM Trace: ${msgPtr}, n=${n}`);
    },
  };

  const instantiated = await WebAssembly.instantiate(wasmModule, { env });
  const instance = { ...instantiated.exports } as unknown as WasmOntologyInstance;
  instance.memory = instantiated.exports.memory as WebAssembly.Memory;
  return { instance, wasmModule };
}

describe("Phase 2: HDT Compact Columnar Storage & Roaring Bitmap Indexing", () => {
  it("should compress ontology IRIs with FrontCodedDictionary by > 75%", async () => {
    const { instance } = await loadWasmInstance();
    const store = new WasmOntologyStore(instance);

    const basePrefix1 = "http://modelscript.io/ontology/sysml2/core#";
    const basePrefix2 = "http://modelscript.io/ontology/modelica/standard/electrical/analog/components#";
    const basePrefix3 = "http://www.w3.org/2002/07/owl#";

    const testIris: string[] = [];

    for (let i = 0; i < 300; i++) {
      testIris.push(`${basePrefix1}ComponentDeclaration_Variant_${i}_ExtendedDefinition`);
    }
    for (let i = 0; i < 300; i++) {
      testIris.push(`${basePrefix2}ResistorCircuitElement_Instance_${i}_OperationalModel`);
    }
    for (let i = 0; i < 200; i++) {
      testIris.push(`${basePrefix3}FunctionalPropertyAssertion_Constraint_${i}`);
    }

    const ids: number[] = [];
    for (const iri of testIris) {
      const id = store.internStringWasm(iri);
      assert.ok(id > 0, `Expected positive ID for ${iri}`);
      ids.push(id);
    }

    // Verify lossless reconstruction
    for (let i = 0; i < testIris.length; i++) {
      const reconstructed = store.extractStringWasm(ids[i]);
      assert.strictEqual(reconstructed, testIris[i], `Mismatch at index ${i}`);
    }

    // Verify deduplication
    const dupId = store.internStringWasm(testIris[0]);
    assert.strictEqual(dupId, ids[0], "Expected identical ID for re-interned IRI");

    // Check compression ratio
    const ratio = store.getStringCompressionRatio();
    const rawBytes = instance.ontology_getRawStringBytes?.() ?? 0;
    const compBytes = instance.ontology_getCompressedStringBytes?.() ?? 0;

    console.log(`  Raw IRI bytes: ${rawBytes} bytes`);
    console.log(`  Compressed bytes: ${compBytes} bytes`);
    console.log(
      `  Compression ratio: ${(ratio * 100).toFixed(2)}% of raw size (${((1 - ratio) * 100).toFixed(2)}% savings)`,
    );

    assert.ok(ratio < 0.35, `Expected compression ratio < 35%, got ${(ratio * 100).toFixed(2)}%`);
  });

  it("should maintain Inverted Roaring Bitmaps with fast bitwise multi-bound queries", async () => {
    const { instance } = await loadWasmInstance();
    const store = new WasmOntologyStore(instance);

    const typeProp = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const statusProp = "http://modelscript.io/ontology#status";
    const sensorClass = "http://modelscript.io/ontology#Sensor";
    const actuatorClass = "http://modelscript.io/ontology#Actuator";
    const activeStatus = "http://modelscript.io/ontology#Active";
    const standbyStatus = "http://modelscript.io/ontology#Standby";

    const N = 5000;
    // Ingest 5000 sensors and actuators
    for (let i = 0; i < N; i++) {
      const entityIri = `http://modelscript.io/device/dev_${i}`;
      const isSensor = i % 2 === 0;
      const isActive = i % 3 === 0;

      // Triple 1: (dev_i, rdf:type, Sensor | Actuator)
      store.addAxiomDirect64(AXIOM_CLASS_ASSERT, 1, entityIri, typeProp, isSensor ? sensorClass : actuatorClass);

      // Triple 2: (dev_i, status, Active | Standby)
      store.addAxiomDirect64(AXIOM_OBJ_PROP_ASSERT, 1, entityIri, statusProp, isActive ? activeStatus : standbyStatus);
    }

    // Check Roaring Bitmap cardinalities
    const sensorHash = hashIri64(sensorClass).lo;
    const actuatorHash = hashIri64(actuatorClass).lo;
    const typeHash = hashIri64(typeProp).lo;
    const statusHash = hashIri64(statusProp).lo;

    // indexType: 1 = S, 2 = P, 3 = O
    const sensorOspCount = store.getRoaringCardinality(3, sensorClass);
    const actuatorOspCount = store.getRoaringCardinality(3, actuatorClass);
    const typePosCount = store.getRoaringCardinality(2, typeProp);
    const statusPosCount = store.getRoaringCardinality(2, statusProp);

    assert.strictEqual(sensorOspCount, N / 2, `Expected ${N / 2} sensors in OSP bitmap`);
    assert.strictEqual(actuatorOspCount, N / 2, `Expected ${N / 2} actuators in OSP bitmap`);
    assert.strictEqual(typePosCount, N, `Expected ${N} type assertions in POS bitmap`);
    assert.strictEqual(statusPosCount, N, `Expected ${N} status assertions in POS bitmap`);

    // Multi-bound Query: Query (dev_0, rdf:type, ?)
    const t0 = performance.now();
    const resDev0 = store.queryTriplesBitmap({
      subject: "http://modelscript.io/device/dev_0",
      predicate: typeProp,
    });
    const t1 = performance.now();
    assert.strictEqual(resDev0.length, 1, "Expected exactly 1 match for (dev_0, rdf:type, ?)");

    // Multi-bound Query: Query (?, rdf:type, Sensor) -> returns 2500 matches
    const t2 = performance.now();
    const sensors = store.queryTriplesBitmap({
      predicate: typeProp,
      object: sensorClass,
    });
    const t3 = performance.now();
    assert.strictEqual(sensors.length, N / 2, `Expected ${N / 2} sensors`);

    console.log(`  Bitwise intersection query: ${sensors.length} results in ${(t3 - t2).toFixed(3)} ms`);
    assert.ok(t3 - t2 < 50, "Query time should be under 50ms for 2500 matches");
  });
});
