// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

describe("WebAssembly Zero-GC Formal Verification Kernels", () => {
  async function loadWasm() {
    const wasmPath = path.resolve(import.meta.dirname, "../build/release.wasm");
    const bytes = await fs.readFile(wasmPath);
    const module = await WebAssembly.compile(bytes);
    const instance = await WebAssembly.instantiate(module, {
      env: {
        abort: () => {},
      },
    });
    return instance.exports as Record<string, any>;
  }

  it("should evaluate Always and Eventually via in-WASM STL sliding window kernel", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.stl_eval_always === "function", "stl_eval_always must be exported");
    assert.ok(typeof wasm.stl_eval_eventually === "function", "stl_eval_eventually must be exported");
    assert.ok(typeof wasm.stl_eval_until === "function", "stl_eval_until must be exported");

    const N = 100;
    const memory = wasm.memory as WebAssembly.Memory;

    // Allocate memory in WASM heap
    const bytesF64 = N * 8;
    const timePtr = wasm.__new(bytesF64, 0);
    const valPtr = wasm.__new(bytesF64, 0);
    const outPtr = wasm.__new(bytesF64, 0);

    const timeView = new Float64Array(memory.buffer, timePtr, N);
    const valView = new Float64Array(memory.buffer, valPtr, N);
    const outView = new Float64Array(memory.buffer, outPtr, N);

    for (let i = 0; i < N; i++) {
      timeView[i] = i * 0.1;
      valView[i] = Math.sin(timeView[i]!) * 10;
    }

    // Always on [0, 1.0]
    wasm.stl_eval_always(timePtr, valPtr, N, 0.0, 1.0, outPtr);

    // Verify first 10 points
    for (let i = 0; i < 10; i++) {
      let expectedMin = Infinity;
      const t = timeView[i]!;
      for (let j = 0; j < N; j++) {
        if (timeView[j]! >= t && timeView[j]! <= t + 1.0) {
          if (valView[j]! < expectedMin) expectedMin = valView[j]!;
        }
      }
      assert.ok(Math.abs(outView[i]! - expectedMin) < 1e-6);
    }

    // Eventually on [0, 2.0]
    wasm.stl_eval_eventually(timePtr, valPtr, N, 0.0, 2.0, outPtr);
    for (let i = 0; i < 10; i++) {
      let expectedMax = -Infinity;
      const t = timeView[i]!;
      for (let j = 0; j < N; j++) {
        if (timeView[j]! >= t && timeView[j]! <= t + 2.0) {
          if (valView[j]! > expectedMax) expectedMax = valView[j]!;
        }
      }
      assert.ok(Math.abs(outView[i]! - expectedMax) < 1e-6);
    }
  });

  it("should compute transitive closure via in-WASM Octagon Floyd-Warshall kernel", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.octagon_close_i32 === "function", "octagon_close_i32 must be exported");

    const dim = 6;
    const INF = 1000000000;
    const size = dim * dim;
    const bytesI32 = size * 4;
    const matrixPtr = wasm.__new(bytesI32, 0);
    const memory = wasm.memory as WebAssembly.Memory;
    const matrixView = new Int32Array(memory.buffer, matrixPtr, size);

    // Initialize all to INF and diagonal to 0
    matrixView.fill(INF);
    for (let i = 0; i < dim; i++) {
      matrixView[i * dim + i] = 0;
    }

    // Add path: 0 -> 1 (weight 5), 1 -> 2 (weight 3)
    matrixView[0 * dim + 1] = 5;
    matrixView[1 * dim + 2] = 3;

    wasm.octagon_close_i32(matrixPtr, dim);

    // Derived bound: 0 -> 2 should be 8
    assert.strictEqual(matrixView[0 * dim + 2], 8);
  });

  it("should accelerate OctagonDBM.closeWithWasm via WASM bridge integration", async () => {
    const wasm = await loadWasm();
    const { OctagonDBM } = await import("../src/analysis/octagon_dbm.js");

    const dbm = new OctagonDBM(3); // 3 variables => dim = 6
    dbm.setBound(0, 1, 10);
    dbm.setBound(1, 2, 20);

    dbm.closeWithWasm(wasm);

    // Derived bound: 0 -> 2 should be 30
    assert.strictEqual(dbm.getBound(0, 2), 30);
  });

  it("should evaluate STL via StlMonitor.evaluateAlwaysWasm bridge", async () => {
    const wasm = await loadWasm();
    const { StlMonitor } = await import("../src/formal/stl_monitor.js");

    const N = 50;
    const bytesF64 = N * 8;
    const timePtr = wasm.__new(bytesF64, 0);
    const valPtr = wasm.__new(bytesF64, 0);
    const outPtr = wasm.__new(bytesF64, 0);

    const mem = wasm.memory as WebAssembly.Memory;
    const timeView = new Float64Array(mem.buffer, timePtr, N);
    const valView = new Float64Array(mem.buffer, valPtr, N);
    const outView = new Float64Array(mem.buffer, outPtr, N);

    for (let i = 0; i < N; i++) {
      timeView[i] = i * 0.1;
      valView[i] = i; // linearly increasing
    }

    StlMonitor.evaluateAlwaysWasm(wasm, timePtr, valPtr, N, 0.0, 0.5, outPtr);

    // On linearly increasing signal with [0, 0.5], min is always the current value val[i] = i
    for (let i = 0; i < N - 5; i++) {
      assert.strictEqual(outView[i], i);
    }
  });
});
