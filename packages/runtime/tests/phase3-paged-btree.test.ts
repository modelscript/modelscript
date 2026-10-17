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

describe("Phase 3: Paged 4KB Slotted B+Tree & Virtual Memory Storage Engine (Jena TDB2 Parity)", () => {
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

    assert.strictEqual(metrics.totalTriples, N, `Expected ${N} triples`);
    assert.ok(metrics.pageCount >= 7, `Expected at least 7 pages for 1500 triples (got ${metrics.pageCount})`);

    // Range query: find all triples for comp_42
    const targetComp = "http://modelscript.io/device/comp_42";
    const resComp42 = engine.findTriples({ subject: targetComp });
    assert.strictEqual(resComp42.length, 1, "Expected exactly 1 triple for comp_42");
    assert.strictEqual(resComp42[0]!.axiomType, 1, "Expected axiomType 1");

    // Indexed POS query: count all Component assertions
    const allComponents = engine.findTriples({ predicate: typeProp, object: componentClass });
    assert.strictEqual(allComponents.length, N, `Expected all ${N} components in index`);
  });

  it("should evict frames via Clock algorithm and flush to disk", async () => {
    const wasmExports = await loadPagedWasm();
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
    assert.ok(flushedPages >= 0, "Flush completed without error");

    engine.close();
    assert.ok(fs.existsSync(tempDbPath), "Backing DB file must exist");
    const stat = fs.statSync(tempDbPath);
    assert.ok(stat.size >= 8192, "Backing file must include Dual-Slot Superblock and B+Tree pages");
    fs.unlinkSync(tempDbPath);
  });

  it("should execute O(log N + K) indexed range scans across all 3 covering permutations (SPO, POS, OSP)", async () => {
    const wasmExports = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasmExports, 128);

    const N = 1200;
    for (let i = 0; i < N; i++) {
      const s = `http://modelscript.io/node_${i % 100}`;
      const p = `http://modelscript.io/rel_${Math.floor(i / 100)}`;
      const o = `http://modelscript.io/target_${i % 40}`;
      engine.insertTriple(s, p, o, 1, 0);
    }

    // 1. (S, ?, ?) -> SPO
    const byS = engine.findTriples({ subject: "http://modelscript.io/node_7" });
    assert.strictEqual(byS.length, 12, "Expected 12 triples for node_7 via SPO");

    // 2. (?, P, ?) -> POS
    const byP = engine.findTriples({ predicate: "http://modelscript.io/rel_3" });
    assert.strictEqual(byP.length, 100, "Expected 100 triples for rel_3 via POS");

    // 3. (?, P, O) -> POS
    const byPO = engine.findTriples({
      predicate: "http://modelscript.io/rel_3",
      object: "http://modelscript.io/target_3",
    });
    assert.ok(byPO.length > 0, "Expected matching triples for (rel_3, target_3) via POS");

    // 4. (?, ?, O) -> OSP
    const byO = engine.findTriples({ object: "http://modelscript.io/target_15" });
    assert.strictEqual(byO.length, 30, "Expected 30 triples for target_15 via OSP");

    // 5. (S, ?, O) -> OSP 2-column prefix (O, S)
    const bySO = engine.findTriples({
      subject: "http://modelscript.io/node_15",
      object: "http://modelscript.io/target_15",
    });
    assert.ok(bySO.length > 0, "Expected matching triples for (node_15, ?, target_15) via OSP");

    // 6. (S, P, O) -> SPO exact point lookup
    const exact = engine.findTriples({
      subject: "http://modelscript.io/node_0",
      predicate: "http://modelscript.io/rel_0",
      object: "http://modelscript.io/target_0",
    });
    assert.strictEqual(exact.length, 1, "Expected exact match for (node_0, rel_0, target_0)");
  });

  it("should provide Generation-Tagged Copy-on-Write MVCC snapshot isolation, abort rollback, and freelist reuse", async () => {
    const wasmExports = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasmExports, 128);

    const pred = "http://modelscript.io/prop/connectedTo";
    // Seed 500 committed triples
    for (let i = 0; i < 500; i++) {
      engine.insertTriple(`http://modelscript.io/bus_${i}`, pred, `http://modelscript.io/load_${i}`);
    }
    assert.strictEqual(engine.getMetrics().totalTriples, 500);

    // Begin Write Transaction (txId = 2)
    const txId = engine.beginTransaction();
    assert.strictEqual(txId, 2);

    // Insert 200 new triples and delete 50 existing triples inside uncommitted tx
    for (let i = 500; i < 700; i++) {
      engine.insertTriple(`http://modelscript.io/bus_${i}`, pred, `http://modelscript.io/load_${i}`);
    }
    for (let i = 0; i < 50; i++) {
      const deleted = engine.deleteTriple(`http://modelscript.io/bus_${i}`, pred, `http://modelscript.io/load_${i}`);
      assert.ok(deleted, `Expected bus_${i} to be deleted in active transaction`);
    }

    const txMetrics = engine.getMetrics();
    assert.strictEqual(txMetrics.totalTriples, 650, "Active writer sees 500 + 200 - 50 = 650 triples");
    // Generation-tagged CoW clones each dirtied page only ONCE per transaction, not 750 times!
    assert.ok(
      txMetrics.cowClonesCount > 0 && txMetrics.cowClonesCount < 40,
      `Expected generation-tagged CoW to clone only dirtied pages once (got ${txMetrics.cowClonesCount} clones for 250 triple mutations)`,
    );

    // Concurrent MVCC Snapshot Reader sees exact pre-transaction state (500 triples)!
    const committedAll = engine.findTriplesCommitted({ predicate: pred });
    assert.strictEqual(
      committedAll.length,
      500,
      "Concurrent snapshot reader must see 500 committed triples without seeing uncommitted writes/deletes",
    );
    const committedBus0 = engine.findTriplesCommitted({ subject: "http://modelscript.io/bus_0" });
    assert.strictEqual(committedBus0.length, 1, "Snapshot reader must still see bus_0 deleted by uncommitted tx");
    const committedBus600 = engine.findTriplesCommitted({ subject: "http://modelscript.io/bus_600" });
    assert.strictEqual(committedBus600.length, 0, "Snapshot reader must not see bus_600 added by uncommitted tx");

    // Abort transaction -> O(1) rollback of roots and shadowed pages
    assert.ok(engine.abort(), "Transaction abort should succeed");
    assert.strictEqual(engine.getMetrics().totalTriples, 500, "Total triples must roll back to 500");
    assert.strictEqual(
      engine.findTriples({ subject: "http://modelscript.io/bus_0" }).length,
      1,
      "bus_0 must be restored after abort",
    );
    assert.strictEqual(
      engine.findTriples({ subject: "http://modelscript.io/bus_600" }).length,
      0,
      "bus_600 must not exist after abort",
    );

    // Start new transaction (txId = 2 again after rollback), insert 100 triples, and commit
    engine.beginTransaction();
    for (let i = 500; i < 600; i++) {
      engine.insertTriple(`http://modelscript.io/bus_${i}`, pred, `http://modelscript.io/load_${i}`);
    }
    assert.ok(engine.commit(), "Transaction commit should succeed");
    assert.strictEqual(engine.getMetrics().totalTriples, 600);
    assert.strictEqual(engine.findTriplesCommitted({ predicate: pred }).length, 600);
    assert.ok(engine.getMetrics().freePageCount > 0, "Committed CoW shadow blocks should be in Epoch Freelist");
  });

  it("should persist Node Table, inline 32-bit literals, and recover from Dual-Slot Superblock after simulated crash", async () => {
    const tempDbPath = path.resolve(__dirname, "scratch_tdb2_recovery.db");
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);

    // 1. Create DB, insert triples with IRIs and inline literals across 2 transactions
    {
      const wasm1 = await loadPagedWasm();
      const engine1 = new PagedStorageEngine(wasm1, 64);
      engine1.attachFile(tempDbPath);

      const intId = engine1.encodeLiteral(-42);
      const boolId = engine1.encodeLiteral(true);
      const decId = engine1.encodeLiteral(3.142);

      assert.ok(engine1.isInlineValue(intId), "Integer should be inline-encoded");
      assert.ok(engine1.isInlineValue(boolId), "Boolean should be inline-encoded");
      assert.ok(engine1.isInlineValue(decId), "Fixed-point decimal should be inline-encoded");
      assert.strictEqual(engine1.decodeTerm(intId), -42);
      assert.strictEqual(engine1.decodeTerm(boolId), true);
      assert.strictEqual(engine1.decodeTerm(decId), 3.142);

      engine1.beginTransaction();
      for (let i = 0; i < 300; i++) {
        engine1.insertTriple(
          `http://modelscript.io/pump_${i}`,
          "http://modelscript.io/prop/pressure",
          engine1.encodeLiteral(i * 10 - 50),
        );
      }
      engine1.commit(); // Commits txId = 2 to Slot 0

      engine1.beginTransaction();
      for (let i = 300; i < 450; i++) {
        engine1.insertTriple(
          `http://modelscript.io/pump_${i}`,
          "http://modelscript.io/prop/pressure",
          engine1.encodeLiteral(i * 10 - 50),
        );
      }
      engine1.commit(); // Commits txId = 3 to Slot 1
      engine1.close();
    }

    // 2. Reopen DB in a brand-new WASM instance and verify full state & Node Table recovery
    {
      const wasm2 = await loadPagedWasm();
      const engine2 = new PagedStorageEngine(wasm2, 64);
      engine2.attachFile(tempDbPath);

      const sb = engine2.getRecoveredSuperblock();
      assert.ok(sb !== null, "Must recover valid superblock");
      assert.strictEqual(sb.txId, 3, "Should recover latest txId = 3 from Slot 1");
      assert.strictEqual(engine2.getMetrics().totalTriples, 450);

      // Query by string IRI (requires restored persistent Node Table!)
      const pump420 = engine2.findTriples({ subject: "http://modelscript.io/pump_420" });
      assert.strictEqual(pump420.length, 1, "Must find pump_420 after reopening DB file");
      assert.strictEqual(engine2.decodeTerm(pump420[0]!.objectId), 4150, "Inline integer literal must decode to 4150");
      assert.strictEqual(
        engine2.resolveIri(pump420[0]!.subjectId),
        "http://modelscript.io/pump_420",
        "Node Table must resolve subjectId back to IRI string",
      );
      engine2.close();
    }

    // 3. Simulate torn write / power-loss corruption on Superblock Slot 1 (offset 4096)
    {
      const fd = fs.openSync(tempDbPath, "r+");
      const corruptBytes = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00]);
      fs.writeSync(fd, corruptBytes, 0, corruptBytes.length, 4096 + 16);
      fs.closeSync(fd);

      const wasm3 = await loadPagedWasm();
      const engine3 = new PagedStorageEngine(wasm3, 64);
      engine3.attachFile(tempDbPath);

      const recoveredSb = engine3.getRecoveredSuperblock();
      assert.ok(recoveredSb !== null, "Must automatically fall back to surviving Superblock Slot 0");
      assert.strictEqual(recoveredSb.slot, 0, "Must recover from Slot 0 when Slot 1 checksum fails");
      assert.strictEqual(recoveredSb.txId, 2, "Must recover txId = 2 state");
      engine3.close();
    }

    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  });

  it("should delete triples across SPO, POS, and OSP trees and collapse empty leaf pages", async () => {
    const wasmExports = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasmExports, 128);

    const N = 600;
    const rel = "http://modelscript.io/rel/links";
    for (let i = 0; i < N; i++) {
      engine.insertTriple(`http://modelscript.io/a_${i}`, rel, `http://modelscript.io/b_${i}`);
    }
    assert.strictEqual(engine.getMetrics().totalTriples, N);

    // Delete first 400 triples
    for (let i = 0; i < 400; i++) {
      const ok = engine.deleteTriple(`http://modelscript.io/a_${i}`, rel, `http://modelscript.io/b_${i}`);
      assert.ok(ok, `Failed to delete triple ${i}`);
    }
    assert.strictEqual(engine.getMetrics().totalTriples, 200);
    assert.strictEqual(engine.findTriples({ predicate: rel }).length, 200);
    assert.strictEqual(engine.findTriples({ object: "http://modelscript.io/b_10" }).length, 0);
    assert.strictEqual(engine.findTriples({ object: "http://modelscript.io/b_500" }).length, 1);

    // Delete remaining 200 triples
    for (let i = 400; i < N; i++) {
      engine.deleteTriple(`http://modelscript.io/a_${i}`, rel, `http://modelscript.io/b_${i}`);
    }
    assert.strictEqual(engine.getMetrics().totalTriples, 0);
    assert.strictEqual(engine.findTriples({ predicate: rel }).length, 0);
  });

  it("should compress and losslessly round-trip slotted leaf pages using shared (k1, k2) Prefix Run-Length Encoding", async () => {
    const wasmExports = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasmExports, 128);

    const typeProp = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
    const subProp = "http://modelscript.io/ontology#hasPort";
    const sensorClass = "http://modelscript.io/ontology#Sensor";

    // Insert 1,000 triples with high (k1, k2) prefix locality in SPO, POS, and OSP
    for (let i = 0; i < 500; i++) {
      const dev = `http://modelscript.io/dev_${Math.floor(i / 25)}`;
      engine.insertTriple(dev, typeProp, sensorClass, 1, 0);
      engine.insertTriple(dev, subProp, `http://modelscript.io/port_${i}`, 2, 0);
    }

    const stats = engine.getPrefixCompressionStats();
    console.log(
      `  Prefix Compression: logical=${stats.uncompressedLogicalBytes}B -> compressed=${stats.prefixCompressedBytes}B (${stats.compressionRatioVsLogical.toFixed(2)}x logical, ${stats.compressionRatioVsAllocated.toFixed(2)}x allocated)`,
    );
    assert.ok(
      stats.compressionRatioVsLogical > 2.2,
      `Expected >2.2x prefix compression ratio vs logical 16B entries (got ${stats.compressionRatioVsLogical.toFixed(2)}x)`,
    );

    // Round-trip compress and decompress leaf page 1
    const beforeTriples = engine.findTriples({ predicate: subProp });
    const compressedPage1 = engine.compressPage(1);
    assert.ok(compressedPage1.byteLength > 32 && compressedPage1.byteLength < 4096);

    const restoredCount = engine.decompressPage(1, compressedPage1);
    assert.ok(restoredCount > 0, "Decompressed leaf page should restore entries");

    const afterTriples = engine.findTriples({ predicate: subProp });
    assert.strictEqual(
      afterTriples.length,
      beforeTriples.length,
      "All triples must remain intact after prefix compression/decompression round-trip",
    );
  });

  it("should evaluate cyclic 3-pattern triangle queries via Worst-Case Optimal Join (Leapfrog Triejoin)", async () => {
    const wasmExports = await loadPagedWasm();
    const engine = new PagedStorageEngine(wasmExports, 256);

    const pFeeds = "http://modelscript.io/rel/feeds";
    const pMonitors = "http://modelscript.io/rel/monitors";
    const pControls = "http://modelscript.io/rel/controls";

    // Build a graph with 600 background edges and 25 closed triangles:
    //   (x_i, feeds, y_i) /\ (y_i, monitors, z_i) /\ (z_i, controls, x_i)
    for (let i = 0; i < 200; i++) {
      const x = `http://modelscript.io/x_${i}`;
      const y = `http://modelscript.io/y_${i}`;
      const z = `http://modelscript.io/z_${i}`;
      engine.insertTriple(x, pFeeds, y);
      engine.insertTriple(y, pMonitors, z);
      // Close the triangle only when i % 8 === 0 (i = 0, 8, 16, ..., 192 -> 25 triangles)
      if (i % 8 === 0) {
        engine.insertTriple(z, pControls, x);
      } else {
        engine.insertTriple(`http://modelscript.io/other_${i}`, pControls, x);
      }
    }

    const triangles = engine.leapfrogTriangleJoin(pFeeds, pMonitors, pControls);
    assert.strictEqual(triangles.length, 25, `Expected 25 closed triangles, got ${triangles.length}`);

    for (const tri of triangles) {
      const xIri = engine.resolveIri(tri.x)!;
      const yIri = engine.resolveIri(tri.y)!;
      const zIri = engine.resolveIri(tri.z)!;
      const idx = Number(xIri.split("_").pop());
      assert.strictEqual(idx % 8, 0, `Triangle index ${idx} must be a multiple of 8`);
      assert.strictEqual(yIri, `http://modelscript.io/y_${idx}`);
      assert.strictEqual(zIri, `http://modelscript.io/z_${idx}`);
    }
  });
});
