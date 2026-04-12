// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Multi-target code generation for GPU-accelerated tensor operations.
 *
 * Generates hardware-specific parallel kernels from the fused tensor AST:
 *   - WebGPU compute shaders (.wgsl)
 *   - WASM SIMD-optimized modules
 *   - CUDA/OpenCL device kernels
 *
 * The compilation target is selected via a CLI flag:
 *   modelscript optimize --target=<js|wasm|c|cuda|webgpu>
 */

// ─────────────────────────────────────────────────────────────────────
// Compilation Target
// ─────────────────────────────────────────────────────────────────────

export type CompilationTarget = "js" | "wasm" | "c" | "cuda" | "webgpu";

export interface GpuKernel {
  name: string;
  target: CompilationTarget;
  source: string;
  workgroupSize?: number;
  gridDim?: [number, number, number];
}

// ─────────────────────────────────────────────────────────────────────
// WebGPU (.wgsl) Code Generation
// ─────────────────────────────────────────────────────────────────────

export interface WgslKernelOpts {
  workgroupSize?: number;
}

/**
 * Generate a WebGPU compute shader for a fused elementwise tensor kernel.
 *
 * @param name       Kernel function name
 * @param nInputs    Number of input buffers
 * @param bodyGlsl   WGSL body computing `out[i]` from `in0[i]`, `in1[i]`, etc.
 * @param opts       Optional workgroup configuration
 */
export function generateWgslKernel(name: string, nInputs: number, bodyWgsl: string, opts?: WgslKernelOpts): GpuKernel {
  const wgSize = opts?.workgroupSize ?? 256;
  const lines: string[] = [];

  // Bindings: input buffers + output buffer + uniforms
  for (let i = 0; i < nInputs; i++) {
    lines.push(`@group(0) @binding(${i}) var<storage, read> in${i}: array<f32>;`);
  }
  lines.push(`@group(0) @binding(${nInputs}) var<storage, read_write> out: array<f32>;`);
  lines.push(`@group(0) @binding(${nInputs + 1}) var<uniform> n: u32;`);
  lines.push(``);
  lines.push(`@compute @workgroup_size(${wgSize})`);
  lines.push(`fn ${name}(@builtin(global_invocation_id) gid: vec3<u32>) {`);
  lines.push(`  let i = gid.x;`);
  lines.push(`  if (i >= n) { return; }`);
  lines.push(`  ${bodyWgsl}`);
  lines.push(`}`);

  return {
    name,
    target: "webgpu",
    source: lines.join("\n"),
    workgroupSize: wgSize,
  };
}

/**
 * Generate a WebGPU matrix multiplication compute shader.
 */
export function generateWgslMatmul(M: number, K: number, N: number): GpuKernel {
  const TILE = 16;
  const lines: string[] = [];

  lines.push(`@group(0) @binding(0) var<storage, read> A: array<f32>;`);
  lines.push(`@group(0) @binding(1) var<storage, read> B: array<f32>;`);
  lines.push(`@group(0) @binding(2) var<storage, read_write> C: array<f32>;`);
  lines.push(``);
  lines.push(`@compute @workgroup_size(${TILE}, ${TILE})`);
  lines.push(`fn matmul(@builtin(global_invocation_id) gid: vec3<u32>) {`);
  lines.push(`  let row = gid.y;`);
  lines.push(`  let col = gid.x;`);
  lines.push(`  if (row >= ${M}u || col >= ${N}u) { return; }`);
  lines.push(`  var sum: f32 = 0.0;`);
  lines.push(`  for (var k: u32 = 0u; k < ${K}u; k = k + 1u) {`);
  lines.push(`    sum = sum + A[row * ${K}u + k] * B[k * ${N}u + col];`);
  lines.push(`  }`);
  lines.push(`  C[row * ${N}u + col] = sum;`);
  lines.push(`}`);

  return {
    name: "matmul",
    target: "webgpu",
    source: lines.join("\n"),
    workgroupSize: TILE * TILE,
    gridDim: [Math.ceil(N / TILE), Math.ceil(M / TILE), 1],
  };
}

// ─────────────────────────────────────────────────────────────────────
// CUDA Code Generation
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate a CUDA kernel for a fused elementwise tensor operation.
 */
export function generateCudaKernel(name: string, nInputs: number, bodyCuda: string): GpuKernel {
  const lines: string[] = [];
  lines.push(`#include <math.h>`);
  lines.push(``);

  // Kernel signature
  const params: string[] = [];
  for (let i = 0; i < nInputs; i++) {
    params.push(`const double* __restrict__ in${i}`);
  }
  params.push(`double* __restrict__ out`);
  params.push(`int n`);

  lines.push(`__global__ void ${name}(${params.join(", ")}) {`);
  lines.push(`  int i = blockIdx.x * blockDim.x + threadIdx.x;`);
  lines.push(`  if (i >= n) return;`);
  lines.push(`  ${bodyCuda}`);
  lines.push(`}`);
  lines.push(``);

  // Host launcher
  lines.push(`void ${name}_launch(${params.join(", ")}) {`);
  lines.push(`  int threads = 256;`);
  lines.push(`  int blocks = (n + threads - 1) / threads;`);
  lines.push(`  ${name}<<<blocks, threads>>>(${[...Array(nInputs).keys()].map((i) => `in${i}`).join(", ")}, out, n);`);
  lines.push(`}`);

  return {
    name,
    target: "cuda",
    source: lines.join("\n"),
    gridDim: [1, 1, 1],
  };
}

/**
 * Generate a CUDA matrix multiplication kernel with tiling.
 */
export function generateCudaMatmul(M: number, K: number, N: number): GpuKernel {
  const TILE = 16;
  const lines: string[] = [];

  lines.push(`#define TILE_SIZE ${TILE}`);
  lines.push(``);
  lines.push(`__global__ void matmul_kernel(const double* A, const double* B, double* C, int M, int K, int N) {`);
  lines.push(`  __shared__ double As[TILE_SIZE][TILE_SIZE];`);
  lines.push(`  __shared__ double Bs[TILE_SIZE][TILE_SIZE];`);
  lines.push(`  int row = blockIdx.y * TILE_SIZE + threadIdx.y;`);
  lines.push(`  int col = blockIdx.x * TILE_SIZE + threadIdx.x;`);
  lines.push(`  double sum = 0.0;`);
  lines.push(`  for (int t = 0; t < (K + TILE_SIZE - 1) / TILE_SIZE; t++) {`);
  lines.push(`    int ak = t * TILE_SIZE + threadIdx.x;`);
  lines.push(`    int bk = t * TILE_SIZE + threadIdx.y;`);
  lines.push(`    As[threadIdx.y][threadIdx.x] = (row < M && ak < K) ? A[row * K + ak] : 0.0;`);
  lines.push(`    Bs[threadIdx.y][threadIdx.x] = (bk < K && col < N) ? B[bk * N + col] : 0.0;`);
  lines.push(`    __syncthreads();`);
  lines.push(`    for (int k = 0; k < TILE_SIZE; k++) sum += As[threadIdx.y][k] * Bs[k][threadIdx.x];`);
  lines.push(`    __syncthreads();`);
  lines.push(`  }`);
  lines.push(`  if (row < M && col < N) C[row * N + col] = sum;`);
  lines.push(`}`);

  return {
    name: "matmul_kernel",
    target: "cuda",
    source: lines.join("\n"),
    gridDim: [Math.ceil(N / TILE), Math.ceil(M / TILE), 1],
  };
}

// ─────────────────────────────────────────────────────────────────────
// OpenCL Code Generation
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an OpenCL kernel for a fused elementwise tensor operation.
 */
export function generateOpenCLKernel(name: string, nInputs: number, bodyCL: string): GpuKernel {
  const lines: string[] = [];

  const params: string[] = [];
  for (let i = 0; i < nInputs; i++) {
    params.push(`__global const double* in${i}`);
  }
  params.push(`__global double* out`);
  params.push(`int n`);

  lines.push(`__kernel void ${name}(${params.join(", ")}) {`);
  lines.push(`  int i = get_global_id(0);`);
  lines.push(`  if (i >= n) return;`);
  lines.push(`  ${bodyCL}`);
  lines.push(`}`);

  return {
    name,
    target: "c", // OpenCL is a C-target variant
    source: lines.join("\n"),
  };
}

// ─────────────────────────────────────────────────────────────────────
// FMU GPU Bundle
// ─────────────────────────────────────────────────────────────────────

export interface FmuGpuBundle {
  /** GPU kernel source files to include in the FMU archive. */
  kernelSources: { filename: string; content: string }[];
  /** Whether the FMU uses GPU acceleration. */
  gpuAccelerated: boolean;
  /** Target GPU API. */
  gpuApi: "cuda" | "opencl" | "webgpu";
}

/**
 * Create an FMU GPU bundle from generated kernels.
 */
export function createFmuGpuBundle(kernels: GpuKernel[], gpuApi: "cuda" | "opencl" | "webgpu"): FmuGpuBundle {
  const ext = gpuApi === "cuda" ? ".cu" : gpuApi === "opencl" ? ".cl" : ".wgsl";
  return {
    kernelSources: kernels.map((k) => ({
      filename: `${k.name}${ext}`,
      content: k.source,
    })),
    gpuAccelerated: kernels.length > 0,
    gpuApi,
  };
}
