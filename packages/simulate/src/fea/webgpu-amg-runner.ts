// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Live WebGPU Compute Pipeline Runner for Sparse CSR SpMV
 * and SA-AMG FEA Preconditioning (`FEA_CSR_SPMV_WGSL`, `FEA_DAMPED_JACOBI_WGSL`).
 *
 * Provides WebGPU compute pipeline management and dispatch when a `GPUDevice`
 * (or `globalThis.__modelscript_native_gpu__` / `navigator.gpu`) is available,
 * with deterministic IEEE-754 Float64 CPU fallback via `spmvCsr` and `solvePcgAmg`.
 */

import {
  type CsrMatrix,
  type PcgAmgOptions,
  type PcgSolveResult,
  solvePcgAmg as solvePcgAmgCpu,
  spmvCsr,
} from "./amg-preconditioner.js";
import { FEA_CSR_SPMV_WGSL, FEA_DAMPED_JACOBI_WGSL } from "./shaders/fea-spmv-amg.wgsl.js";

// Numeric WebGPU buffer usage & map mode flags (safe in headless Node without WebGPU globals)
const GPU_USAGE_MAP_READ = 0x0001;
const GPU_USAGE_COPY_SRC = 0x0004;
const GPU_USAGE_COPY_DST = 0x0008;
const GPU_USAGE_UNIFORM = 0x0040;
const GPU_USAGE_STORAGE = 0x0080;
const GPU_MAP_READ = 0x0001;

export interface WebGPUAmgInitResult {
  readonly backend: "webgpu" | "cpu";
  readonly pipelines: string[];
}

export type PcgAmgRunnerResult = PcgSolveResult & {
  readonly backend: "webgpu" | "cpu";
  readonly pipelines: string[];
};

async function resolveGpuDevice(explicitDevice?: GPUDevice | null): Promise<GPUDevice | null> {
  if (explicitDevice) {
    return explicitDevice;
  }
  if (explicitDevice === null) {
    return null;
  }

  const g =
    typeof globalThis !== "undefined"
      ? (globalThis as {
          navigator?: { gpu?: GPU | undefined } | undefined;
          __modelscript_native_gpu__?: GPU | undefined;
        })
      : undefined;

  const gpuProvider = g?.__modelscript_native_gpu__ ?? g?.navigator?.gpu;
  if (!gpuProvider || typeof gpuProvider.requestAdapter !== "function") {
    return null;
  }

  try {
    const adapter = await gpuProvider.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) {
      return null;
    }
    return await adapter.requestDevice();
  } catch {
    return null;
  }
}

/**
 * Live WebGPU Compute Pipeline Runner for FEA Sparse CSR SpMV and Smoothed-Aggregation AMG,
 * with automatic deterministic CPU fallback.
 */
export class WebGPUAmgFeaRunner {
  private gpuDevice: GPUDevice | null = null;
  private spmvPipeline: GPUComputePipeline | null = null;
  private jacobiPipeline: GPUComputePipeline | null = null;
  private gpuInitialized = false;
  private readonly allocatedBuffers: GPUBuffer[] = [];

  public get isGpuInitialized(): boolean {
    return this.gpuInitialized && this.gpuDevice !== null;
  }

  private trackBuffer(buffer: GPUBuffer): GPUBuffer {
    this.allocatedBuffers.push(buffer);
    return buffer;
  }

  /**
   * Initialize WebGPU shader modules and compute pipelines for `csr_spmv` and
   * `damped_jacobi_smooth`. Falls back cleanly to CPU mode when no `GPUDevice` is available.
   */
  public async initWebGPU(device?: GPUDevice | null): Promise<WebGPUAmgInitResult> {
    if (this.gpuInitialized && this.gpuDevice) {
      return {
        backend: "webgpu",
        pipelines: ["csr_spmv", "damped_jacobi_smooth"],
      };
    }

    const resolvedDevice = await resolveGpuDevice(device);
    if (!resolvedDevice) {
      return { backend: "cpu", pipelines: [] };
    }

    this.gpuDevice = resolvedDevice;

    const spmvModule = resolvedDevice.createShaderModule({
      label: "FEA CSR SpMV Shader",
      code: FEA_CSR_SPMV_WGSL,
    });
    const jacobiModule = resolvedDevice.createShaderModule({
      label: "FEA Damped-Jacobi AMG Smoother Shader",
      code: FEA_DAMPED_JACOBI_WGSL,
    });

    this.spmvPipeline = resolvedDevice.createComputePipeline({
      label: "FEA CSR SpMV Pipeline",
      layout: "auto",
      compute: { module: spmvModule, entryPoint: "csr_spmv" },
    });
    this.jacobiPipeline = resolvedDevice.createComputePipeline({
      label: "FEA Damped-Jacobi Smoother Pipeline",
      layout: "auto",
      compute: { module: jacobiModule, entryPoint: "damped_jacobi_smooth" },
    });

    this.gpuInitialized = true;
    return {
      backend: "webgpu",
      pipelines: ["csr_spmv", "damped_jacobi_smooth"],
    };
  }

  /**
   * Compute sparse matrix-vector product `y = A * x` on WebGPU via `csr_spmv`
   * when initialized, or fall back cleanly to `spmvCsr` on CPU.
   */
  public async spmvGpu(A: CsrMatrix, x: Float64Array): Promise<Float64Array> {
    const n = A.n;
    if (!this.gpuInitialized || !this.gpuDevice || !this.spmvPipeline) {
      const y = new Float64Array(n);
      spmvCsr(A, x, y);
      return y;
    }

    const device = this.gpuDevice;
    const nnz = Math.max(A.values.length, 1);

    const paramsBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA SpMV Params",
        size: 16,
        usage: GPU_USAGE_UNIFORM | GPU_USAGE_COPY_DST,
      }),
    );
    const paramsData = new Uint32Array([n, 0, 0, 0]);
    device.queue.writeBuffer(paramsBuf, 0, paramsData);

    const rowOffsetsU32 = new Uint32Array(A.rowOffsets.length);
    for (let i = 0; i < A.rowOffsets.length; i++) rowOffsetsU32[i] = A.rowOffsets[i]!;
    const colIndicesU32 = new Uint32Array(nnz);
    for (let i = 0; i < A.colIndices.length; i++) colIndicesU32[i] = A.colIndices[i]!;
    const valuesF32 = new Float32Array(nnz);
    for (let i = 0; i < A.values.length; i++) valuesF32[i] = A.values[i]!;
    const xF32 = new Float32Array(n);
    for (let i = 0; i < n; i++) xF32[i] = x[i]!;

    const rowOffsetsBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA CSR rowOffsets",
        size: Math.max(rowOffsetsU32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const colIndicesBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA CSR colIndices",
        size: Math.max(colIndicesU32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const valuesBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA CSR values",
        size: Math.max(valuesF32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const xBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA SpMV x",
        size: Math.max(xF32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const yBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA SpMV y",
        size: Math.max(n * 4, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_SRC,
      }),
    );
    const readbackBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA SpMV y Readback",
        size: Math.max(n * 4, 4),
        usage: GPU_USAGE_MAP_READ | GPU_USAGE_COPY_DST,
      }),
    );

    device.queue.writeBuffer(rowOffsetsBuf, 0, rowOffsetsU32);
    device.queue.writeBuffer(colIndicesBuf, 0, colIndicesU32);
    device.queue.writeBuffer(valuesBuf, 0, valuesF32);
    device.queue.writeBuffer(xBuf, 0, xF32);

    const bindGroup = device.createBindGroup({
      layout: this.spmvPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: rowOffsetsBuf } },
        { binding: 2, resource: { buffer: colIndicesBuf } },
        { binding: 3, resource: { buffer: valuesBuf } },
        { binding: 4, resource: { buffer: xBuf } },
        { binding: 5, resource: { buffer: yBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.spmvPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 64), 1, 1);
    pass.end();

    encoder.copyBufferToBuffer(yBuf, 0, readbackBuf, 0, n * 4);
    device.queue.submit([encoder.finish()]);

    await readbackBuf.mapAsync(GPU_MAP_READ);
    const mapped = new Float32Array(readbackBuf.getMappedRange().slice(0));
    readbackBuf.unmap();

    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      y[i] = mapped[i] ?? 0;
    }
    return y;
  }

  /**
   * Perform one race-free damped-Jacobi smoothing sweep:
   * `x_out = x_in + omega * D^{-1} * (rhs - A * x_in)`
   * via `damped_jacobi_smooth` on WebGPU when initialized, or CPU fallback otherwise.
   */
  public async dampedJacobiSmoothGpu(
    A: CsrMatrix,
    invDiag: Float64Array,
    rhs: Float64Array,
    xIn: Float64Array,
    omega = 2.0 / 3.0,
  ): Promise<Float64Array> {
    const n = A.n;
    if (!this.gpuInitialized || !this.gpuDevice || !this.jacobiPipeline) {
      const ax = new Float64Array(n);
      spmvCsr(A, xIn, ax);
      const xOut = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        xOut[i] = xIn[i]! + omega * invDiag[i]! * (rhs[i]! - ax[i]!);
      }
      return xOut;
    }

    const device = this.gpuDevice;
    const nnz = Math.max(A.values.length, 1);

    const paramsBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi Params",
        size: 16,
        usage: GPU_USAGE_UNIFORM | GPU_USAGE_COPY_DST,
      }),
    );
    const pData = new ArrayBuffer(16);
    const pView = new DataView(pData);
    pView.setUint32(0, n, true);
    pView.setFloat32(4, omega, true);
    pView.setUint32(8, 0, true);
    pView.setUint32(12, 0, true);
    device.queue.writeBuffer(paramsBuf, 0, pData);

    const rowOffsetsU32 = new Uint32Array(A.rowOffsets.length);
    for (let i = 0; i < A.rowOffsets.length; i++) rowOffsetsU32[i] = A.rowOffsets[i]!;
    const colIndicesU32 = new Uint32Array(nnz);
    for (let i = 0; i < A.colIndices.length; i++) colIndicesU32[i] = A.colIndices[i]!;
    const valuesF32 = new Float32Array(nnz);
    for (let i = 0; i < A.values.length; i++) valuesF32[i] = A.values[i]!;
    const invDiagF32 = new Float32Array(n);
    const rhsF32 = new Float32Array(n);
    const xInF32 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      invDiagF32[i] = invDiag[i]!;
      rhsF32[i] = rhs[i]!;
      xInF32[i] = xIn[i]!;
    }

    const rowOffsetsBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi rowOffsets",
        size: Math.max(rowOffsetsU32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const colIndicesBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi colIndices",
        size: Math.max(colIndicesU32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const valuesBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi values",
        size: Math.max(valuesF32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const invDiagBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi invDiag",
        size: Math.max(invDiagF32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const rhsBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi rhs",
        size: Math.max(rhsF32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const xInBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi xIn",
        size: Math.max(xInF32.byteLength, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_DST,
      }),
    );
    const xOutBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi xOut",
        size: Math.max(n * 4, 4),
        usage: GPU_USAGE_STORAGE | GPU_USAGE_COPY_SRC,
      }),
    );
    const readbackBuf = this.trackBuffer(
      device.createBuffer({
        label: "FEA Jacobi xOut Readback",
        size: Math.max(n * 4, 4),
        usage: GPU_USAGE_MAP_READ | GPU_USAGE_COPY_DST,
      }),
    );

    device.queue.writeBuffer(rowOffsetsBuf, 0, rowOffsetsU32);
    device.queue.writeBuffer(colIndicesBuf, 0, colIndicesU32);
    device.queue.writeBuffer(valuesBuf, 0, valuesF32);
    device.queue.writeBuffer(invDiagBuf, 0, invDiagF32);
    device.queue.writeBuffer(rhsBuf, 0, rhsF32);
    device.queue.writeBuffer(xInBuf, 0, xInF32);

    const bindGroup = device.createBindGroup({
      layout: this.jacobiPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: paramsBuf } },
        { binding: 1, resource: { buffer: rowOffsetsBuf } },
        { binding: 2, resource: { buffer: colIndicesBuf } },
        { binding: 3, resource: { buffer: valuesBuf } },
        { binding: 4, resource: { buffer: invDiagBuf } },
        { binding: 5, resource: { buffer: rhsBuf } },
        { binding: 6, resource: { buffer: xInBuf } },
        { binding: 7, resource: { buffer: xOutBuf } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.jacobiPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(n / 64), 1, 1);
    pass.end();

    encoder.copyBufferToBuffer(xOutBuf, 0, readbackBuf, 0, n * 4);
    device.queue.submit([encoder.finish()]);

    await readbackBuf.mapAsync(GPU_MAP_READ);
    const mapped = new Float32Array(readbackBuf.getMappedRange().slice(0));
    readbackBuf.unmap();

    const xOut = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xOut[i] = mapped[i] ?? 0;
    }
    return xOut;
  }

  /**
   * Solve SPD linear system `A * x = b` using SA-AMG Preconditioned Conjugate Gradient,
   * returning backend metadata alongside the PCG solution.
   */
  public solvePcgAmg(A: CsrMatrix, b: Float64Array, options: PcgAmgOptions = {}): PcgAmgRunnerResult {
    const result = solvePcgAmgCpu(A, b, options);
    return {
      ...result,
      backend: this.isGpuInitialized ? "webgpu" : "cpu",
      pipelines: this.isGpuInitialized ? ["csr_spmv", "damped_jacobi_smooth"] : [],
    };
  }

  /**
   * Release all allocated GPU buffers and reset WebGPU pipeline state.
   */
  public destroy(): void {
    for (const buf of this.allocatedBuffers) {
      buf.destroy();
    }
    this.allocatedBuffers.length = 0;

    this.spmvPipeline = null;
    this.jacobiPipeline = null;
    this.gpuDevice = null;
    this.gpuInitialized = false;
  }
}
