// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CompressibleFieldArena } from "../src/cfd/compressible-arena.js";
import { WebGPUCompressibleRunner } from "../src/cfd/webgpu-compressible-runner.js";
import { type CsrMatrix, spmvCsr } from "../src/fea/amg-preconditioner.js";
import { WebGPUAmgFeaRunner } from "../src/fea/webgpu-amg-runner.js";

/**
 * Lightweight mock GPUDevice recording WebGPU lifecycle & compute dispatch calls.
 */
interface MockGpuRecorder {
  shaderModules: Array<{ label?: string; code: string }>;
  computePipelines: Array<{ label?: string; entryPoint: string }>;
  buffers: Array<{ label?: string; size: number; usage: number; destroyed: boolean }>;
  bindGroups: number;
  dispatches: Array<{ entryPoint: string; x: number; y: number; z: number }>;
  writes: number;
  submits: number;
  device: GPUDevice;
}

function createMockGpuDevice(): MockGpuRecorder {
  const recorder: Omit<MockGpuRecorder, "device"> = {
    shaderModules: [],
    computePipelines: [],
    buffers: [],
    bindGroups: 0,
    dispatches: [],
    writes: 0,
    submits: 0,
  };

  const device = {
    createShaderModule(desc: GPUShaderModuleDescriptor) {
      recorder.shaderModules.push({ label: desc.label, code: desc.code });
      return { label: desc.label } as unknown as GPUShaderModule;
    },
    createComputePipeline(desc: GPUComputePipelineDescriptor) {
      const entryPoint = desc.compute.entryPoint ?? "main";
      recorder.computePipelines.push({ label: desc.label, entryPoint });
      return {
        label: desc.label,
        __entryPoint: entryPoint,
        getBindGroupLayout(_index: number) {
          return { __layoutFor: entryPoint } as unknown as GPUBindGroupLayout;
        },
      } as unknown as GPUComputePipeline;
    },
    createBuffer(desc: GPUBufferDescriptor) {
      const rec = { label: desc.label, size: desc.size, usage: desc.usage, destroyed: false };
      recorder.buffers.push(rec);
      const backing = new ArrayBuffer(Math.max(desc.size, 4));
      return {
        label: desc.label,
        size: desc.size,
        usage: desc.usage,
        __backing: backing,
        async mapAsync(_mode: number) {
          // no-op
        },
        getMappedRange() {
          return backing;
        },
        unmap() {
          // no-op
        },
        destroy() {
          rec.destroyed = true;
        },
      } as unknown as GPUBuffer;
    },
    createBindGroup(_desc: GPUBindGroupDescriptor) {
      recorder.bindGroups++;
      return {} as unknown as GPUBindGroup;
    },
    createCommandEncoder() {
      let currentEntryPoint = "unknown";
      return {
        beginComputePass() {
          return {
            setPipeline(pipeline: GPUComputePipeline & { __entryPoint?: string }) {
              currentEntryPoint = pipeline.__entryPoint ?? "unknown";
            },
            setBindGroup(_index: number, _bg: GPUBindGroup) {
              // no-op
            },
            dispatchWorkgroups(x: number, y = 1, z = 1) {
              recorder.dispatches.push({ entryPoint: currentEntryPoint, x, y, z });
            },
            end() {
              // no-op
            },
          };
        },
        copyBufferToBuffer(
          src: GPUBuffer & { __backing?: ArrayBuffer },
          srcOffset: number,
          dst: GPUBuffer & { __backing?: ArrayBuffer },
          dstOffset: number,
          size: number,
        ) {
          if (src.__backing && dst.__backing) {
            const copyLen = Math.min(size, src.__backing.byteLength - srcOffset, dst.__backing.byteLength - dstOffset);
            if (copyLen > 0) {
              new Uint8Array(dst.__backing, dstOffset, copyLen).set(new Uint8Array(src.__backing, srcOffset, copyLen));
            }
          }
        },
        finish() {
          return {} as unknown as GPUCommandBuffer;
        },
      } as unknown as GPUCommandEncoder;
    },
    queue: {
      writeBuffer(
        buffer: GPUBuffer & { __backing?: ArrayBuffer },
        bufferOffset: number,
        data: BufferSource,
        dataOffset = 0,
        size?: number,
      ) {
        recorder.writes++;
        if (!buffer.__backing) return;
        const srcBytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data, dataOffset, size ?? data.byteLength - dataOffset)
            : new Uint8Array(data.buffer, data.byteOffset + dataOffset, size ?? data.byteLength - dataOffset);
        const copyLen = Math.min(srcBytes.byteLength, buffer.__backing.byteLength - bufferOffset);
        if (copyLen > 0) {
          new Uint8Array(buffer.__backing, bufferOffset, copyLen).set(srcBytes.subarray(0, copyLen));
        }
      },
      submit(_commandBuffers: Iterable<GPUCommandBuffer>) {
        recorder.submits++;
      },
    },
  } as unknown as GPUDevice;

  return { ...recorder, device };
}

/**
 * Exact analytical 1D Riemann solver for the Sod shock tube problem.
 */
function exactSodSolution(
  x: number,
  t: number,
  x0 = 0.5,
  rhoL = 1.0,
  uL = 0.0,
  pL = 1.0,
  rhoR = 0.125,
  uR = 0.0,
  pR = 0.1,
  gamma = 1.4,
): { rho: number; u: number; p: number } {
  const gm1 = gamma - 1.0;
  const gp1 = gamma + 1.0;
  const cL = Math.sqrt((gamma * pL) / rhoL);
  const cR = Math.sqrt((gamma * pR) / rhoR);

  const AL = 2.0 / (gp1 * rhoL);
  const BL = (gm1 / gp1) * pL;
  const AR = 2.0 / (gp1 * rhoR);
  const BR = (gm1 / gp1) * pR;

  const fAndDf = (p: number, pk: number, ck: number, Ak: number, Bk: number): [number, number] => {
    if (p > pk) {
      const q = Math.sqrt(Ak / (p + Bk));
      return [(p - pk) * q, q * (1.0 - (0.5 * (p - pk)) / (p + Bk))];
    }
    const pr = p / pk;
    const exp1 = gm1 / (2.0 * gamma);
    const rhoK = (gamma * pk) / (ck * ck);
    return [((2.0 * ck) / gm1) * (Math.pow(pr, exp1) - 1.0), (1.0 / (rhoK * ck)) * Math.pow(pr, -gp1 / (2.0 * gamma))];
  };

  let pStar = 0.5 * (pL + pR);
  for (let iter = 0; iter < 50; iter++) {
    const [fL, dfL] = fAndDf(pStar, pL, cL, AL, BL);
    const [fR, dfR] = fAndDf(pStar, pR, cR, AR, BR);
    const pNext = Math.max(pStar - (fL + fR + (uR - uL)) / (dfL + dfR), 1e-12);
    if (Math.abs(pNext - pStar) < 1e-13 * (1.0 + pStar)) {
      pStar = pNext;
      break;
    }
    pStar = pNext;
  }

  const [fL] = fAndDf(pStar, pL, cL, AL, BL);
  const [fR] = fAndDf(pStar, pR, cR, AR, BR);
  const uStar = 0.5 * (uL + uR) + 0.5 * (fR - fL);

  const s = (x - x0) / t;
  if (s <= uStar) {
    const sHead = uL - cL;
    const cStarL = cL * Math.pow(pStar / pL, gm1 / (2.0 * gamma));
    const sTail = uStar - cStarL;
    if (s <= sHead) return { rho: rhoL, u: uL, p: pL };
    if (s >= sTail) return { rho: rhoL * Math.pow(pStar / pL, 1.0 / gamma), u: uStar, p: pStar };
    const uFan = (2.0 / gp1) * (cL + 0.5 * gm1 * uL + s);
    const cFan = (2.0 / gp1) * (cL + 0.5 * gm1 * (uL - s));
    return {
      rho: rhoL * Math.pow(cFan / cL, 2.0 / gm1),
      u: uFan,
      p: pL * Math.pow(cFan / cL, (2.0 * gamma) / gm1),
    };
  }
  const prR = pStar / pR;
  const sShock = uR + cR * Math.sqrt((gp1 / (2.0 * gamma)) * prR + gm1 / (2.0 * gamma));
  if (s >= sShock) return { rho: rhoR, u: uR, p: pR };
  const rhoStarR = rhoR * ((prR + gm1 / gp1) / ((gm1 / gp1) * prR + 1.0));
  return { rho: rhoStarR, u: uStar, p: pStar };
}

/**
 * 3D anisotropic 7-point SPD finite-difference Poisson CSR matrix.
 */
function build3DAnisotropicPoissonCsr(
  nx: number,
  ny: number,
  nz: number,
  kx: number,
  ky: number,
  kz: number,
): CsrMatrix {
  const n = nx * ny * nz;
  const rowOffsets = new Int32Array(n + 1);
  const colList: number[] = [];
  const valList: number[] = [];

  const idx = (ix: number, iy: number, iz: number) => (ix * ny + iy) * nz + iz;
  const diagVal = 2.0 * (kx + ky + kz);

  for (let ix = 0; ix < nx; ix++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let iz = 0; iz < nz; iz++) {
        const row = idx(ix, iy, iz);
        const entries: Array<[number, number]> = [[row, diagVal]];
        if (ix > 0) entries.push([idx(ix - 1, iy, iz), -kx]);
        if (ix + 1 < nx) entries.push([idx(ix + 1, iy, iz), -kx]);
        if (iy > 0) entries.push([idx(ix, iy - 1, iz), -ky]);
        if (iy + 1 < ny) entries.push([idx(ix, iy + 1, iz), -ky]);
        if (iz > 0) entries.push([idx(ix, iy, iz - 1), -kz]);
        if (iz + 1 < nz) entries.push([idx(ix, iy, iz + 1), -kz]);

        entries.sort((a, b) => a[0] - b[0]);
        for (const [col, val] of entries) {
          colList.push(col);
          valList.push(val);
        }
        rowOffsets[row + 1] = colList.length;
      }
    }
  }

  return {
    n,
    rowOffsets,
    colIndices: Int32Array.from(colList),
    values: Float64Array.from(valList),
  };
}

describe("Live WebGPU Compute Pipeline Runners (Compressible FVM + Flow Features + SA-AMG FEA)", () => {
  it("WebGPUCompressibleRunner CPU fallback accurately solves Sod shock tube and extracts flow features", async () => {
    const nx = 100;
    const dx = 1.0 / nx;
    const arena = new CompressibleFieldArena({ nx, dx, gamma: 1.4 });
    arena.initRiemann1D(0.5, { rho: 1.0, u: 0.0, p: 1.0 }, { rho: 0.125, u: 0.0, p: 0.1 });

    const runner = new WebGPUCompressibleRunner(arena, {
      flux: "hllc",
      limiter: "minmod",
      reconstructionOrder: 2,
      bcX: "extrapolation",
      cfl: 0.45,
    });

    const initInfo = await runner.initWebGPU(null);
    assert.equal(initInfo.backend, "cpu");
    assert.deepEqual(initInfo.pipelines, []);
    assert.equal(runner.isGpuInitialized, false);

    // Advance Sod shock tube to t ~ 0.2 via stepGpu (CPU fallback) + step()
    const targetTime = 0.2;
    let totalTime = 0.0;
    let totalSteps = 0;

    // First 10 steps via stepGpu() verifying clean CPU fallback
    const firstBatch = await runner.stepGpu(10, 0.45);
    assert.equal(firstBatch.backend, "cpu");
    assert.equal(firstBatch.steps, 10);
    totalTime += firstBatch.elapsedTime;
    totalSteps += firstBatch.steps;

    // Advance remaining time via step() until t >= targetTime
    while (totalTime < targetTime && totalSteps < 500) {
      const dt = runner.solver.computeCflTimestep();
      if (totalTime + dt >= targetTime) {
        const rem = targetTime - totalTime;
        runner.solver.stepSspRk3(rem);
        totalTime += rem;
        totalSteps++;
        break;
      }
      const res = runner.step(1, 0.45);
      totalTime += res.elapsedTime;
      totalSteps += res.steps;
    }

    assert.ok(Math.abs(totalTime - targetTime) < 1e-10, `Expected t=${targetTime}, got ${totalTime}`);
    const pos = arena.checkPositivity();
    assert.equal(pos.valid, true, "Positivity must hold throughout Sod shock tube");

    let l1Rho = 0.0;
    let l1P = 0.0;
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * dx;
      const exact = exactSodSolution(x, targetTime);
      const prim = arena.getPrimitive(i);
      l1Rho += Math.abs(prim.rho - exact.rho) * dx;
      l1P += Math.abs(prim.p - exact.p) * dx;
    }
    assert.ok(l1Rho < 0.04, `Sod density L1 error ${l1Rho.toFixed(5)} must be < 0.04`);
    assert.ok(l1P < 0.04, `Sod pressure L1 error ${l1P.toFixed(5)} must be < 0.04`);

    // Verify flow feature extraction CPU + GPU-fallback
    const featuresCpu = runner.extractFeatures();
    const featuresGpuFallback = await runner.extractFeaturesGpu();
    assert.equal(featuresGpuFallback.backend, "cpu");
    assert.equal(featuresCpu.ducrosSensor.length, nx);
    assert.equal(featuresGpuFallback.qCriterion.length, nx);

    // Shock region should trigger elevated Ducros sensor (~1 near compression)
    let maxDucros = 0;
    for (let i = 0; i < nx; i++) {
      if (featuresCpu.ducrosSensor[i]! > maxDucros) maxDucros = featuresCpu.ducrosSensor[i]!;
    }
    assert.ok(maxDucros > 0.9, `Expected strong Ducros shock sensor > 0.9 at shock, got ${maxDucros}`);

    runner.destroy();
    console.log(
      `[WebGPUCompressibleRunner CPU] Sod t=${totalTime.toFixed(3)} (${totalSteps} steps): ` +
        `L1(rho)=${l1Rho.toFixed(5)}, L1(p)=${l1P.toFixed(5)}, maxDucros=${maxDucros.toFixed(3)}`,
    );
  });

  it("WebGPUCompressibleRunner with mock GPUDevice invokes shader/pipeline creation, 3-stage SSP-RK3 dispatch, flow features dispatch, and buffer destroy", async () => {
    const arena = new CompressibleFieldArena({ nx: 8, ny: 4, nz: 4, dx: 0.1, gamma: 1.4 });
    arena.initRiemann1D(0.4, { rho: 1.0, u: 0.0, p: 1.0 }, { rho: 0.125, u: 0.0, p: 0.1 });

    const runner = new WebGPUCompressibleRunner(arena, {
      flux: "hllc",
      bcX: "extrapolation",
      bcY: "periodic",
      bcZ: "reflective",
      cfl: 0.4,
    });

    const mock = createMockGpuDevice();
    const initRes = await runner.initWebGPU(mock.device);
    assert.equal(initRes.backend, "webgpu");
    assert.deepEqual(initRes.pipelines, ["compute_hllc_rhs", "ssp_rk3_update", "extract_flow_features"]);
    assert.equal(runner.isGpuInitialized, true);

    assert.equal(mock.shaderModules.length, 2, "Expected 2 shader modules (FVM + FlowFeatures)");
    assert.equal(mock.computePipelines.length, 3, "Expected 3 compute pipelines");
    assert.ok(mock.buffers.length >= 16, `Expected >= 16 allocated GPU buffers, got ${mock.buffers.length}`);

    // Dispatch 2 steps = 2 * 3 stages * (compute_hllc_rhs + ssp_rk3_update) = 12 dispatches
    const stepRes = await runner.stepGpu(2, 0.4);
    assert.equal(stepRes.backend, "webgpu");
    assert.equal(stepRes.steps, 2);

    const rhsDispatches = mock.dispatches.filter((d) => d.entryPoint === "compute_hllc_rhs");
    const rk3Dispatches = mock.dispatches.filter((d) => d.entryPoint === "ssp_rk3_update");
    assert.equal(rhsDispatches.length, 6, "Expected 6 compute_hllc_rhs dispatches for 2 SSP-RK3 steps");
    assert.equal(rk3Dispatches.length, 6, "Expected 6 ssp_rk3_update dispatches for 2 SSP-RK3 steps");
    assert.equal(rhsDispatches[0]!.x, Math.ceil(arena.totalCells / 64));

    // Dispatch extract_flow_features
    const featRes = await runner.extractFeaturesGpu();
    assert.equal(featRes.backend, "webgpu");
    const featDispatches = mock.dispatches.filter((d) => d.entryPoint === "extract_flow_features");
    assert.equal(featDispatches.length, 1, "Expected 1 extract_flow_features dispatch");
    assert.equal(featDispatches[0]!.x, Math.ceil(8 / 4));
    assert.equal(featDispatches[0]!.y, Math.ceil(4 / 4));
    assert.equal(featDispatches[0]!.z, Math.ceil(4 / 4));

    // Destroy must release every allocated buffer
    runner.destroy();
    assert.equal(runner.isGpuInitialized, false);
    assert.ok(
      mock.buffers.every((b) => b.destroyed),
      "All allocated GPU buffers must be destroyed on runner.destroy()",
    );
  });

  it("WebGPUAmgFeaRunner CPU fallback achieves 6-iteration SA-AMG convergence on 1024-DOF 100:1 anisotropic SPD system", async () => {
    const A = build3DAnisotropicPoissonCsr(16, 8, 8, 100.0, 1.0, 1.0);
    assert.equal(A.n, 1024);

    const b = new Float64Array(A.n);
    for (let i = 0; i < A.n; i++) {
      b[i] = 1.0 + 0.5 * Math.sin(0.13 * i) + 0.25 * Math.cos(0.37 * i);
    }

    const runner = new WebGPUAmgFeaRunner();
    const initRes = await runner.initWebGPU(null);
    assert.equal(initRes.backend, "cpu");
    assert.deepEqual(initRes.pipelines, []);

    // Verify spmvGpu CPU fallback matches spmvCsr bit-for-bit
    const yGpuFallback = await runner.spmvGpu(A, b);
    const yRef = new Float64Array(A.n);
    spmvCsr(A, b, yRef);
    for (let i = 0; i < A.n; i++) {
      assert.equal(yGpuFallback[i], yRef[i]);
    }

    // Verify SA-AMG PCG 6-iteration convergence
    const sol = runner.solvePcgAmg(A, b, { tolerance: 1e-8, maxIterations: 200 });
    assert.equal(sol.backend, "cpu");
    assert.equal(sol.converged, true);
    assert.ok(sol.residualNorm < 1e-8, `Expected residual < 1e-8, got ${sol.residualNorm}`);
    assert.ok(sol.iterations <= 6, `Expected SA-AMG convergence in <= 6 iterations, got ${sol.iterations}`);

    runner.destroy();
    console.log(
      `[WebGPUAmgFeaRunner CPU] 1024-DOF 100:1 anisotropic: converged=${sol.converged}, ` +
        `iters=${sol.iterations}, res=${sol.residualNorm.toExponential(2)}`,
    );
  });

  it("WebGPUAmgFeaRunner with mock GPUDevice invokes shader/pipeline creation, csr_spmv & damped_jacobi_smooth dispatches, and buffer destroy", async () => {
    const A = build3DAnisotropicPoissonCsr(4, 4, 4, 10.0, 1.0, 1.0);
    const x = new Float64Array(A.n).fill(1.0);
    const rhs = new Float64Array(A.n).fill(2.0);
    const invDiag = new Float64Array(A.n).fill(1.0 / 24.0);

    const runner = new WebGPUAmgFeaRunner();
    const mock = createMockGpuDevice();

    const initRes = await runner.initWebGPU(mock.device);
    assert.equal(initRes.backend, "webgpu");
    assert.deepEqual(initRes.pipelines, ["csr_spmv", "damped_jacobi_smooth"]);
    assert.equal(runner.isGpuInitialized, true);

    assert.equal(mock.shaderModules.length, 2, "Expected 2 shader modules (SpMV + Damped-Jacobi)");
    assert.equal(mock.computePipelines.length, 2, "Expected 2 compute pipelines");

    // Dispatch csr_spmv
    const y = await runner.spmvGpu(A, x);
    assert.equal(y.length, A.n);
    const spmvDispatches = mock.dispatches.filter((d) => d.entryPoint === "csr_spmv");
    assert.equal(spmvDispatches.length, 1);
    assert.equal(spmvDispatches[0]!.x, Math.ceil(A.n / 64));

    // Dispatch damped_jacobi_smooth
    const smoothed = await runner.dampedJacobiSmoothGpu(A, invDiag, rhs, x, 2.0 / 3.0);
    assert.equal(smoothed.length, A.n);
    const jacobiDispatches = mock.dispatches.filter((d) => d.entryPoint === "damped_jacobi_smooth");
    assert.equal(jacobiDispatches.length, 1);
    assert.equal(jacobiDispatches[0]!.x, Math.ceil(A.n / 64));

    // solvePcgAmg returns webgpu backend metadata
    const sol = runner.solvePcgAmg(A, rhs, { tolerance: 1e-8 });
    assert.equal(sol.backend, "webgpu");
    assert.deepEqual(sol.pipelines, ["csr_spmv", "damped_jacobi_smooth"]);
    assert.equal(sol.converged, true);

    assert.ok(mock.buffers.length > 0, "Expected GPU buffers to be allocated");
    runner.destroy();
    assert.equal(runner.isGpuInitialized, false);
    assert.ok(
      mock.buffers.every((b) => b.destroyed),
      "All allocated GPU buffers must be destroyed on runner.destroy()",
    );
  });
});
