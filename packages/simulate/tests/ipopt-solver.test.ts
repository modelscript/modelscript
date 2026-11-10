// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import test from "node:test";
import { CoinorWasmSolver, loadCoinorWasm } from "../src/optimizer/solvers/coinor-wasm.js";

test("COIN-OR IPOPT WASM Solver: mock interface invocation", () => {
  const memory = new ArrayBuffer(65536);
  const heapF64 = new Float64Array(memory);
  const heap32 = new Int32Array(memory);

  let nextPtr = 64;
  let mallocCalls = 0;
  let ccallCalls = 0;

  const mockModule = {
    _malloc: (size: number) => {
      mallocCalls++;
      const p = nextPtr;
      nextPtr += Math.ceil(size / 8) * 8;
      return p;
    },
    _free: () => {},
    HEAPF64: heapF64,
    HEAP32: heap32,
    addFunction: (_fn: any, _sig: string) => 1,
    removeFunction: () => {},
    ccall: (_name: string) => {
      ccallCalls++;
      return 0; // Success
    },
  };

  const solver = new CoinorWasmSolver(mockModule as any);
  const result = solver.ipopt(
    2,
    1,
    [0.5, 1.5],
    [0, 0],
    [10, 10],
    [1, 1],
    [5, 5],
    (x) => (x[0] ?? 0) ** 2 + (x[1] ?? 0) ** 2,
    (x) => [2 * (x[0] ?? 0), 2 * (x[1] ?? 0)],
    (x) => [(x[0] ?? 0) + (x[1] ?? 0)],
    (_x) => [1, 1],
    2,
  );

  assert.strictEqual(result.status, 0);
  assert(mallocCalls > 0, "malloc should be called");
  assert(ccallCalls > 0, "ccall should be called");
});

test("COIN-OR IPOPT WASM Solver: real WebAssembly module loading and solve", async () => {
  const solver = await loadCoinorWasm();
  assert.ok(solver, "CoinorWasmSolver must initialize");

  const result = solver.ipopt(
    2,
    0,
    [2.0, 3.0],
    [-10.0, -10.0],
    [10.0, 10.0],
    [],
    [],
    (x) => (x[0]! - 1.0) ** 2 + (x[1]! - 2.0) ** 2,
    (x) => [2 * (x[0]! - 1.0), 2 * (x[1]! - 2.0)],
    () => [],
    () => [],
    0,
    { tolerance: 1e-4 },
  );

  assert.strictEqual(result.status, 0, "Solver must report success (status 0)");
  assert(Math.abs(result.solution[0]! - 1.0) < 1e-3, "x0 should approach 1.0");
  assert(Math.abs(result.solution[1]! - 2.0) < 1e-3, "x1 should approach 2.0");
  assert(result.objectiveValue < 1e-5, "Objective should approach 0");
});
