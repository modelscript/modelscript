// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { Zonotope } from "../src/analysis/wasm_zonotope.js";
import { getZonotopeExtremeSupportPoint } from "../src/analysis/wasm_zonotope_reach.js";

describe("WebAssembly Linear-Memory Continuous Zonotope Formal Kernel", () => {
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

  it("should compute exact axis-aligned bounds in WASM matching TypeScript Zonotope", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.zonotope_bounds === "function", "zonotope_bounds must be exported");

    const dim = 3;
    const numGens = 4;
    const center = [2.0, -1.0, 0.5];
    const gens = [
      [1.0, 0.5, -0.2, 0.1], // row 0
      [0.0, 1.2, 0.3, -0.4], // row 1
      [-0.5, 0.0, 0.8, 0.2], // row 2
    ];

    const mem = wasm.memory as WebAssembly.Memory;
    const centerPtr = wasm.__new(dim * 8, 0);
    const gensPtr = wasm.__new(dim * numGens * 8, 0);
    const outLoPtr = wasm.__new(dim * 8, 0);
    const outHiPtr = wasm.__new(dim * 8, 0);

    const centerView = new Float64Array(mem.buffer, centerPtr, dim);
    const gensView = new Float64Array(mem.buffer, gensPtr, dim * numGens);
    const outLoView = new Float64Array(mem.buffer, outLoPtr, dim);
    const outHiView = new Float64Array(mem.buffer, outHiPtr, dim);

    for (let i = 0; i < dim; i++) centerView[i] = center[i]!;
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < numGens; j++) {
        gensView[i * numGens + j] = gens[i]![j]!;
      }
    }

    wasm.zonotope_bounds(dim, numGens, centerPtr, gensPtr, outLoPtr, outHiPtr);

    // Compare against TS Zonotope
    // In TS Zonotope: generators is an array of columns (p vectors of length dim)
    const genCols: number[][] = [];
    for (let j = 0; j < numGens; j++) {
      const col: number[] = [];
      for (let i = 0; i < dim; i++) col.push(gens[i]![j]!);
      genCols.push(col);
    }
    const tsZ = new Zonotope(center, genCols);
    const tsBox = tsZ.toIntervals();

    for (let i = 0; i < dim; i++) {
      assert.ok(Math.abs(outLoView[i]! - tsBox[i]!.lo) < 1e-12, `dim ${i} lo mismatch`);
      assert.ok(Math.abs(outHiView[i]! - tsBox[i]!.hi) < 1e-12, `dim ${i} hi mismatch`);
    }
  });

  it("should compute linear transformation A*Z in WASM matching TypeScript", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.zonotope_linear_transform === "function", "zonotope_linear_transform must be exported");

    const dim = 2;
    const numGens = 2;
    const A = [
      [0.0, 1.0],
      [-2.0, -0.5],
    ];
    const center = [1.5, -2.0];
    const gens = [
      [0.5, -0.1],
      [0.2, 0.4],
    ];

    const mem = wasm.memory as WebAssembly.Memory;
    const matPtr = wasm.__new(dim * dim * 8, 0);
    const centerPtr = wasm.__new(dim * 8, 0);
    const gensPtr = wasm.__new(dim * numGens * 8, 0);
    const outCPtr = wasm.__new(dim * 8, 0);
    const outGPtr = wasm.__new(dim * numGens * 8, 0);

    const matView = new Float64Array(mem.buffer, matPtr, dim * dim);
    const cView = new Float64Array(mem.buffer, centerPtr, dim);
    const gView = new Float64Array(mem.buffer, gensPtr, dim * numGens);
    const outCView = new Float64Array(mem.buffer, outCPtr, dim);
    const outGView = new Float64Array(mem.buffer, outGPtr, dim * numGens);

    for (let i = 0; i < dim; i++) {
      cView[i] = center[i]!;
      for (let j = 0; j < dim; j++) matView[i * dim + j] = A[i]![j]!;
      for (let j = 0; j < numGens; j++) gView[i * numGens + j] = gens[i]![j]!;
    }

    wasm.zonotope_linear_transform(dim, numGens, matPtr, centerPtr, gensPtr, outCPtr, outGPtr);

    // Compare with TS Zonotope linearTransform
    const genCols = [
      [gens[0]![0]!, gens[1]![0]!],
      [gens[0]![1]!, gens[1]![1]!],
    ];
    const tsZ = new Zonotope(center, genCols);
    const tsTransformed = tsZ.linearMap(A);

    for (let i = 0; i < dim; i++) {
      assert.ok(Math.abs(outCView[i]! - tsTransformed.center[i]!) < 1e-12, `transformed center mismatch at ${i}`);
    }
    for (let j = 0; j < numGens; j++) {
      for (let i = 0; i < dim; i++) {
        const wasmG = outGView[i * numGens + j]!;
        const tsG = tsTransformed.generators[j]![i]!;
        assert.ok(Math.abs(wasmG - tsG) < 1e-12, `transformed generator [${i}, ${j}] mismatch`);
      }
    }
  });

  it("should compute Minkowski sum of two zonotopes in WASM", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.zonotope_minkowski_sum === "function", "zonotope_minkowski_sum must be exported");

    const dim = 2;
    const p1 = 2;
    const p2 = 1;

    const c1 = [1.0, 2.0];
    const g1 = [
      [0.5, 0.2],
      [-0.1, 0.4],
    ];

    const c2 = [-0.5, 1.0];
    const g2 = [[0.3], [-0.2]];

    const mem = wasm.memory as WebAssembly.Memory;
    const c1Ptr = wasm.__new(dim * 8, 0);
    const g1Ptr = wasm.__new(dim * p1 * 8, 0);
    const c2Ptr = wasm.__new(dim * 8, 0);
    const g2Ptr = wasm.__new(dim * p2 * 8, 0);
    const outCPtr = wasm.__new(dim * 8, 0);
    const outGPtr = wasm.__new(dim * (p1 + p2) * 8, 0);

    const c1View = new Float64Array(mem.buffer, c1Ptr, dim);
    const g1View = new Float64Array(mem.buffer, g1Ptr, dim * p1);
    const c2View = new Float64Array(mem.buffer, c2Ptr, dim);
    const g2View = new Float64Array(mem.buffer, g2Ptr, dim * p2);
    const outCView = new Float64Array(mem.buffer, outCPtr, dim);
    const outGView = new Float64Array(mem.buffer, outGPtr, dim * (p1 + p2));

    for (let i = 0; i < dim; i++) {
      c1View[i] = c1[i]!;
      c2View[i] = c2[i]!;
      for (let j = 0; j < p1; j++) g1View[i * p1 + j] = g1[i]![j]!;
      for (let j = 0; j < p2; j++) g2View[i * p2 + j] = g2[i]![j]!;
    }

    wasm.zonotope_minkowski_sum(dim, p1, p2, c1Ptr, g1Ptr, c2Ptr, g2Ptr, outCPtr, outGPtr);

    assert.strictEqual(outCView[0], 0.5);
    assert.strictEqual(outCView[1], 3.0);

    // Row 0 generators: [0.5, 0.2, 0.3]
    assert.strictEqual(outGView[0 * 3 + 0], 0.5);
    assert.strictEqual(outGView[0 * 3 + 1], 0.2);
    assert.strictEqual(outGView[0 * 3 + 2], 0.3);

    // Row 1 generators: [-0.1, 0.4, -0.2]
    assert.strictEqual(outGView[1 * 3 + 0], -0.1);
    assert.strictEqual(outGView[1 * 3 + 1], 0.4);
    assert.strictEqual(outGView[1 * 3 + 2], -0.2);
  });

  it("should compute extreme support point in WASM matching getZonotopeExtremeSupportPoint", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.zonotope_extreme_point === "function", "zonotope_extreme_point must be exported");

    const dim = 2;
    const numGens = 3;
    const center = [3.0, 4.0];
    const gens = [
      [1.0, -0.5, 0.2],
      [0.5, 1.0, -0.3],
    ];

    const mem = wasm.memory as WebAssembly.Memory;
    const cPtr = wasm.__new(dim * 8, 0);
    const gPtr = wasm.__new(dim * numGens * 8, 0);
    const dirPtr = wasm.__new(dim * 8, 0);
    const outPtr = wasm.__new(dim * 8, 0);

    const cView = new Float64Array(mem.buffer, cPtr, dim);
    const gView = new Float64Array(mem.buffer, gPtr, dim * numGens);
    const dirView = new Float64Array(mem.buffer, dirPtr, dim);
    const outView = new Float64Array(mem.buffer, outPtr, dim);

    for (let i = 0; i < dim; i++) {
      cView[i] = center[i]!;
      for (let j = 0; j < numGens; j++) gView[i * numGens + j] = gens[i]![j]!;
    }
    const genCols = [
      [gens[0]![0]!, gens[1]![0]!],
      [gens[0]![1]!, gens[1]![1]!],
      [gens[0]![2]!, gens[1]![2]!],
    ];
    const tsZ = new Zonotope(center, genCols);

    // Coordinate directions test against getZonotopeExtremeSupportPoint
    const coordTests = [
      { dir: [1.0, 0.0], stateIdx: 0, max: true },
      { dir: [-1.0, 0.0], stateIdx: 0, max: false },
      { dir: [0.0, 1.0], stateIdx: 1, max: true },
      { dir: [0.0, -1.0], stateIdx: 1, max: false },
    ];

    for (const test of coordTests) {
      dirView[0] = test.dir[0]!;
      dirView[1] = test.dir[1]!;

      wasm.zonotope_extreme_point(dim, numGens, cPtr, gPtr, dirPtr, outPtr);
      const tsExtreme = getZonotopeExtremeSupportPoint(tsZ, test.stateIdx, test.max, dim);

      assert.ok(Math.abs(outView[0]! - tsExtreme[0]!) < 1e-12, `Extreme X mismatch for dir [${test.dir}]`);
      assert.ok(Math.abs(outView[1]! - tsExtreme[1]!) < 1e-12, `Extreme Y mismatch for dir [${test.dir}]`);
    }

    // Arbitrary direction [1.0, 1.0] verified against mathematical support function definition
    dirView[0] = 1.0;
    dirView[1] = 1.0;
    wasm.zonotope_extreme_point(dim, numGens, cPtr, gPtr, dirPtr, outPtr);

    // Support point: x = c + sum(g_j * sign(g_j · dir))
    let expectedX = center[0]!;
    let expectedY = center[1]!;
    for (let j = 0; j < numGens; j++) {
      const dot = gens[0]![j]! * dirView[0]! + gens[1]![j]! * dirView[1]!;
      const sign = dot >= 0 ? 1 : -1;
      expectedX += gens[0]![j]! * sign;
      expectedY += gens[1]![j]! * sign;
    }

    assert.ok(Math.abs(outView[0]! - expectedX) < 1e-12);
    assert.ok(Math.abs(outView[1]! - expectedY) < 1e-12);
  });

  it("should perform Girard order reduction in WASM and preserve enclosure", async () => {
    const wasm = await loadWasm();
    assert.ok(typeof wasm.zonotope_reduce_girard === "function", "zonotope_reduce_girard must be exported");

    const dim = 2;
    const numGens = 6;
    const maxGens = 3; // Must reduce to 3 generators (1 preserved largest + 2 box generators)

    const center = [0.0, 0.0];
    const gens = [
      [5.0, 0.1, 0.05, 0.02, 0.01, 0.01],
      [0.2, 4.0, 0.04, 0.03, 0.02, 0.01],
    ];

    const mem = wasm.memory as WebAssembly.Memory;
    const gPtr = wasm.__new(dim * numGens * 8, 0);
    const outGPtr = wasm.__new(dim * maxGens * 8, 0);
    const scratchPtr = wasm.__new(numGens * 16, 0);

    const gView = new Float64Array(mem.buffer, gPtr, dim * numGens);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < numGens; j++) gView[i * numGens + j] = gens[i]![j]!;
    }

    const finalCount = wasm.zonotope_reduce_girard(dim, numGens, maxGens, gPtr, outGPtr, scratchPtr);
    assert.strictEqual(finalCount, maxGens);

    // Compute bounds of original zonotope vs reduced zonotope
    const cPtr = wasm.__new(dim * 8, 0);
    const origLoPtr = wasm.__new(dim * 8, 0);
    const origHiPtr = wasm.__new(dim * 8, 0);
    const redLoPtr = wasm.__new(dim * 8, 0);
    const redHiPtr = wasm.__new(dim * 8, 0);

    wasm.zonotope_bounds(dim, numGens, cPtr, gPtr, origLoPtr, origHiPtr);
    wasm.zonotope_bounds(dim, maxGens, cPtr, outGPtr, redLoPtr, redHiPtr);

    const origLo = new Float64Array(mem.buffer, origLoPtr, dim);
    const origHi = new Float64Array(mem.buffer, origHiPtr, dim);
    const redLo = new Float64Array(mem.buffer, redLoPtr, dim);
    const redHi = new Float64Array(mem.buffer, redHiPtr, dim);

    // The reduced zonotope must soundly contain the original zonotope
    for (let i = 0; i < dim; i++) {
      assert.ok(redLo[i]! <= origLo[i]! + 1e-12, `Reduced lo ${redLo[i]} must be <= orig lo ${origLo[i]}`);
      assert.ok(redHi[i]! >= origHi[i]! - 1e-12, `Reduced hi ${redHi[i]} must be >= orig hi ${origHi[i]}`);
    }
  });
});
