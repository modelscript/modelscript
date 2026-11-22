// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Micro-benchmark comparing pure TypeScript vs AssemblyScript/WASM kernels
 * across @modelscript/simulate (`simulate.wasm`) and @modelscript/runtime (`release.wasm`).
 */

import { initBltWasm, SBGInterval, wasmSbgIntervalIntersect } from "@modelscript/runtime";
import { performance } from "node:perf_hooks";
import {
  getSimulateWasmSync,
  wasmComputePtdfLodf,
  wasmJacobiSvd,
  wasmStlsq,
  wasmVoxelizeSurface,
} from "../src/wasm/simulate-wasm.js";

await initBltWasm();
const simWasm = getSimulateWasmSync();
if (!simWasm) {
  console.error("simulate.wasm not loaded");
  process.exit(1);
}

console.log("=== ModelScript AssemblyScript/WASM Kernel Benchmarks ===\n");

// 1. Surface Voxelization (32x32x32 grid, 12-triangle cube)
{
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    wasmVoxelizeSurface(vertices, indices, 32, 32, 32, 0, 0, 0, 1 / 32);
  }
  const ms = (performance.now() - t0) / 20;
  console.log(`1. Surface Voxelization (32³ = 32,768 voxels): ${ms.toFixed(3)} ms / call`);
}

// 2. One-sided Jacobi SVD (200 x 20 tall-skinny POD matrix)
{
  const m = 200;
  const n = 20;
  const A = new Float64Array(m * n);
  for (let i = 0; i < m * n; i++) A[i] = Math.sin(i * 0.17) + 0.5 * Math.cos(i * 0.03);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) {
    wasmJacobiSvd(A, m, n, 30);
  }
  const ms = (performance.now() - t0) / 5;
  console.log(`2. Jacobi SVD (${m}x${n} POD snapshot matrix):      ${ms.toFixed(3)} ms / call`);
}

// 3. SINDy STLSQ Sparse Regression (500 samples x 15 library terms)
{
  const nSamples = 500;
  const nFeatures = 15;
  const theta = new Float64Array(nSamples * nFeatures);
  const target = new Float64Array(nSamples);
  for (let s = 0; s < nSamples; s++) {
    for (let f = 0; f < nFeatures; f++) theta[s * nFeatures + f] = Math.sin((s + 1) * (f + 1) * 0.01);
    target[s] = 2.0 * theta[s * nFeatures + 1]! - 1.5 * theta[s * nFeatures + 4]!;
  }
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    wasmStlsq(theta, target, nSamples, nFeatures, 0.1, 1e-6, 15);
  }
  const ms = (performance.now() - t0) / 20;
  console.log(`3. SINDy STLSQ (${nSamples}x${nFeatures}):                  ${ms.toFixed(3)} ms / call`);
}

// 4. Power Grid PTDF + LODF (30-bus, 41-branch network)
{
  const nBus = 30;
  const nBranch = 41;
  const from = new Int32Array(nBranch);
  const to = new Int32Array(nBranch);
  const x = new Float64Array(nBranch);
  for (let i = 0; i < nBus - 1; i++) {
    from[i] = i;
    to[i] = i + 1;
    x[i] = 0.05 + (i % 5) * 0.01;
  }
  for (let i = nBus - 1; i < nBranch; i++) {
    from[i] = (i * 3) % nBus;
    to[i] = (i * 7 + 2) % nBus;
    if (from[i] === to[i]) to[i] = (to[i]! + 1) % nBus;
    x[i] = 0.08;
  }
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) {
    wasmComputePtdfLodf(nBus, 0, from, to, x);
  }
  const ms = (performance.now() - t0) / 20;
  console.log(`4. Power Grid PTDF+LODF (30-bus, 41-branch):   ${ms.toFixed(3)} ms / call`);
}

// 5. Batched SDE Ensemble (10,000 paths x 100 steps = 1,000,000 Euler-Maruyama updates)
{
  const meanPtr = simWasm.alloc(101 * 8);
  const varPtr = simWasm.alloc(101 * 8);
  const t0 = performance.now();
  simWasm.sde_gbmEnsemble(10000, 100, 0.01, 1.0, 0.05, 0.2, 12345n, meanPtr, varPtr);
  const ms = performance.now() - t0;
  simWasm.free(meanPtr);
  simWasm.free(varPtr);
  console.log(`5. SDE Ensemble (10k paths x 100 steps = 1M):  ${ms.toFixed(3)} ms`);
}

// 6. SBG Strided Interval Intersection (10,000 extended-GCD intersections)
{
  const a = new SBGInterval(1, 97, 1000000);
  const b = new SBGInterval(2, 101, 1000000);
  const t0 = performance.now();
  for (let i = 0; i < 10000; i++) {
    wasmSbgIntervalIntersect(a.lo, a.step, a.hi, b.lo, b.step, b.hi);
  }
  const ms = performance.now() - t0;
  console.log(`6. SBG Extended-GCD Intersect (10,000 calls):  ${ms.toFixed(3)} ms`);
}
