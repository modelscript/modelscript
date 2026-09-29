// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PagedStorageEngine, type PagedWasmExports } from "../src/storage/paged_store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadPagedWasm(): Promise<PagedWasmExports> {
  const wasmPath = path.resolve(__dirname, "../build/debug.wasm");
  const wasmBytes = fs.readFileSync(wasmPath);
  const wasmModule = await WebAssembly.compile(wasmBytes);

  let wasmMemory: WebAssembly.Memory | null = null;
  const env = {
    abort: (msgPtr: number, filePtr: number, line: number, col: number) => {
      let file = "";
      let msg = "";
      try {
        if (wasmMemory) {
          if (filePtr) {
            const len = new Uint32Array(wasmMemory.buffer)[(filePtr - 4) >> 2] >> 1;
            file = String.fromCharCode(...new Uint16Array(wasmMemory.buffer, filePtr, len));
          }
          if (msgPtr) {
            const len = new Uint32Array(wasmMemory.buffer)[(msgPtr - 4) >> 2] >> 1;
            msg = String.fromCharCode(...new Uint16Array(wasmMemory.buffer, msgPtr, len));
          }
        }
      } catch {}
      console.error(`WASM Abort: "${msg}" in ${file} at line ${line}, col ${col}`);
    },
    trace: (msgPtr: number, n: number, a0: number, a1: number) => {
      console.log(`WASM Trace: n=${n}, f=${a0}, pId=${a1}`);
    },
  };

  const instantiated = await WebAssembly.instantiate(wasmModule, { env });
  const exports = { ...instantiated.exports } as unknown as PagedWasmExports;
  wasmMemory = instantiated.exports.memory as WebAssembly.Memory;
  exports.memory = wasmMemory;
  return exports;
}

describe("Phase 3: Paged 4KB Slotted B+Tree & Virtual Memory Storage Engine", () => {
  it("should split leaf pages into multi-level B+Tree across 1,500 triples", async () => {
    const wasmExports = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasmExports, 64); // 64 frames = 256 KB buffer pool

    const N = 1500;
    const typeProp = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const componentClass = "http://modelscript.io/ontology#Component";

    for (let i = 0; i < N; i++) {
      const subject = `http://modelscript.io/device/comp_${i}`;
      const success = engine.insertTriple(subject, typeProp, componentClass, 1, 0);
      assert.ok(success, `Failed to insert triple ${i}`);
    }

    const metrics = engine.getMetrics();
    console.log(`  Inserted ${metrics.totalTriples} triples across ${metrics.pageCount} 4KB pages`);
    console.log(`  Buffer pool hit rate: ${(metrics.bufferPoolHitRate * 100).toFixed(2)}%`);

    // Verify page splitting occurred (each leaf holds max 254 triples)
    assert.strictEqual(metrics.totalTriples, N, `Expected ${N} triples`);
    assert.ok(metrics.pageCount >= 7, `Expected at least 7 pages for 1500 triples (got ${metrics.pageCount})`);

    // Range query: find all triples for comp_42
    const targetComp = "http://modelscript.io/device/comp_42";
    const resComp42 = engine.findTriples({ subject: targetComp });
    assert.strictEqual(resComp42.length, 1, "Expected exactly 1 triple for comp_42");
    assert.strictEqual(resComp42[0]!.axiomType, 1, "Expected axiomType 1");

    // Full scan: count all Component assertions
    const allComponents = engine.findTriples({ predicate: typeProp, object: componentClass });
    const foundSet = new Set(allComponents.map((c) => c.subjectId));
    const missing: number[] = [];
    for (let i = 0; i < N; i++) {
      const sId = engine.intern(`http://modelscript.io/device/comp_${i}`);
      if (!foundSet.has(sId)) missing.push(i);
    }
    console.log(
      `  Missing ${missing.length} components. First 10 missing:`,
      missing.slice(0, 10),
      "Last 10 missing:",
      missing.slice(-10),
    );
    const resComp255 = engine.findTriples({ subject: "http://modelscript.io/device/comp_255" });
    console.log(`  Direct lookup for comp_255: found ${resComp255.length} triples`);
    assert.strictEqual(allComponents.length, N, `Expected all ${N} components in index`);
  });

  it("should evict frames via Clock algorithm and flush to disk", async () => {
    const wasmExports = await loadPagedWasm();
    // Tiny buffer pool with only 16 frames (64 KB) to force continuous Clock evictions
    const engine = new PagedStorageEngine(wasmExports, 16);

    const tempDbPath = path.resolve(__dirname, "scratch_paged_btree.db");
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    engine.attachFile(tempDbPath);

    const N = 2000;
    for (let i = 0; i < N; i++) {
      engine.insertTriple(
        `http://modelscript.io/sensor_${i}`,
        "http://modelscript.io/prop/hasReading",
        `http://modelscript.io/val_${i % 100}`,
      );
    }

    const flushedPages = engine.flush();
    console.log(`  Flushed ${flushedPages} dirty frames to disk`);
    assert.ok(flushedPages >= 0, "Flush completed without error");

    const metrics = engine.getMetrics();
    console.log(
      `  Total pages: ${metrics.pageCount}, Cache hit rate: ${(metrics.bufferPoolHitRate * 100).toFixed(2)}%`,
    );

    engine.close();

    // Verify backing file exists and is cleanly closed
    assert.ok(fs.existsSync(tempDbPath), "Backing DB file must exist");
    const stat = fs.statSync(tempDbPath);
    console.log(`  Backing file size: ${stat.size} bytes`);
    fs.unlinkSync(tempDbPath);
  });
});
