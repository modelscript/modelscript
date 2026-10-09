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

// ─────────────────────────────────────────────────────────────────────
// Batched ODE GPU Ensemble Simulation (DiffEqGPU Paradigm)
// ─────────────────────────────────────────────────────────────────────

import { BinOp, DAEBuilder, EqKind, ExprKind, UnaryOp, Variability } from "@modelscript/runtime";

export interface BatchedOdeEnsembleConfig {
  /** Kernel name identifier */
  name?: string;
  /** Number of continuous state variables */
  numStates: number;
  /** Number of parameter overrides per trajectory */
  numParams: number;
  /** State variable names in index order */
  stateNames?: string[];
  /** Parameter names in index order */
  paramNames?: string[];
  /**
   * Derivative expressions dy[s]/dt = f_s(t, y, p).
   * Expressions should use normalized variables:
   *   y_0, y_1, ... for states
   *   p_0, p_1, ... for parameters
   *   t for simulation time
   */
  rhsExpressions: string[];
  /** Numerical integration method */
  integrator?: "euler" | "rk4";
  /** GPU thread block / workgroup size (default: 256) */
  workgroupSize?: number;
}

export interface BatchedOdeKernels {
  cuda: GpuKernel;
  wgsl: GpuKernel;
  memoryLayout: {
    coalesced: boolean;
    stateStride: string;
    indexingFormula: string;
    explanation: string;
  };
}

function replaceStatePrefix(expr: string, oldPrefix: string, newPrefix: string, numStates: number): string {
  let res = expr;
  for (let s = 0; s < numStates; s++) {
    const pattern = new RegExp(`\\b${oldPrefix}${s}\\b`, "g");
    res = res.replace(pattern, `${newPrefix}${s}`);
  }
  return res;
}

function replaceTimeVariable(expr: string, newTimeExpr: string): string {
  return expr.replace(/\bt\b/g, `(${newTimeExpr})`);
}

/**
 * Generate a CUDA device kernel and host launcher for batched ODE ensemble simulation.
 * Each GPU thread evaluates one complete ODE trajectory in registers, reading and
 * writing global memory with 100% coalesced transactions.
 */
export function generateBatchedOdeCudaKernel(config: BatchedOdeEnsembleConfig): GpuKernel {
  const name = config.name ?? "batched_ode";
  const S = config.numStates;
  const P = config.numParams;
  const wgSize = config.workgroupSize ?? 256;
  const integrator = config.integrator ?? "rk4";
  const lines: string[] = [];

  lines.push(`/* Auto-generated Batched ODE Ensemble CUDA Kernel — DiffEqGPU Architecture */`);
  lines.push(`#include <math.h>`);
  lines.push(`#include <cuda_runtime.h>`);
  lines.push(``);

  lines.push(`__global__ void ${name}_ensemble(`);
  lines.push(`    const double* __restrict__ y0,     // [numStates * batch_size] coalesced`);
  lines.push(`    const double* __restrict__ params, // [numParams * batch_size] coalesced`);
  lines.push(`    double* __restrict__ y_out,        // [numStates * batch_size] coalesced`);
  lines.push(`    double t0,`);
  lines.push(`    double t_end,`);
  lines.push(`    double dt,`);
  lines.push(`    int batch_size`);
  lines.push(`) {`);
  lines.push(`  int traj = blockIdx.x * blockDim.x + threadIdx.x;`);
  lines.push(`  if (traj >= batch_size) return;`);
  lines.push(``);
  lines.push(`  // 1. Coalesced load of initial states and parameters into GPU registers`);
  for (let s = 0; s < S; s++) {
    lines.push(`  double y_${s} = y0[${s} * batch_size + traj];`);
  }
  for (let p = 0; p < P; p++) {
    lines.push(`  double p_${p} = params[${p} * batch_size + traj];`);
  }
  lines.push(``);

  lines.push(`  // 2. Pure in-register time-stepping loop without global memory overhead`);
  lines.push(`  double t = t0;`);
  lines.push(`  while (t < t_end - 1e-12) {`);
  lines.push(`    double h = (t + dt > t_end) ? (t_end - t) : dt;`);
  lines.push(``);

  if (integrator === "euler") {
    // 1-stage Euler
    for (let s = 0; s < S; s++) {
      const rhs = config.rhsExpressions[s] ?? "0.0";
      lines.push(`    double dy_${s} = ${rhs};`);
    }
    for (let s = 0; s < S; s++) {
      lines.push(`    y_${s} += h * dy_${s};`);
    }
  } else {
    // 4-stage classical Runge-Kutta (RK4)
    lines.push(`    // Stage 1 (k1)`);
    for (let s = 0; s < S; s++) {
      const rhs = config.rhsExpressions[s] ?? "0.0";
      lines.push(`    double k1_${s} = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Stage 2 (k2)`);
    for (let s = 0; s < S; s++) {
      lines.push(`    double y_tmp_${s} = y_${s} + 0.5 * h * k1_${s};`);
    }
    for (let s = 0; s < S; s++) {
      let rhs = config.rhsExpressions[s] ?? "0.0";
      rhs = replaceStatePrefix(rhs, "y_", "y_tmp_", S);
      rhs = replaceTimeVariable(rhs, "t + 0.5 * h");
      lines.push(`    double k2_${s} = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Stage 3 (k3)`);
    for (let s = 0; s < S; s++) {
      lines.push(`    y_tmp_${s} = y_${s} + 0.5 * h * k2_${s};`);
    }
    for (let s = 0; s < S; s++) {
      let rhs = config.rhsExpressions[s] ?? "0.0";
      rhs = replaceStatePrefix(rhs, "y_", "y_tmp_", S);
      rhs = replaceTimeVariable(rhs, "t + 0.5 * h");
      lines.push(`    double k3_${s} = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Stage 4 (k4)`);
    for (let s = 0; s < S; s++) {
      lines.push(`    y_tmp_${s} = y_${s} + h * k3_${s};`);
    }
    for (let s = 0; s < S; s++) {
      let rhs = config.rhsExpressions[s] ?? "0.0";
      rhs = replaceStatePrefix(rhs, "y_", "y_tmp_", S);
      rhs = replaceTimeVariable(rhs, "t + h");
      lines.push(`    double k4_${s} = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // State update`);
    for (let s = 0; s < S; s++) {
      lines.push(`    y_${s} += (h / 6.0) * (k1_${s} + 2.0 * k2_${s} + 2.0 * k3_${s} + k4_${s});`);
    }
  }

  lines.push(`    t += h;`);
  lines.push(`  }`);
  lines.push(``);

  lines.push(`  // 3. Coalesced store to global output buffer`);
  for (let s = 0; s < S; s++) {
    lines.push(`  y_out[${s} * batch_size + traj] = y_${s};`);
  }
  lines.push(`}`);
  lines.push(``);

  // Host launcher
  lines.push(`extern "C" void ${name}_ensemble_launch(`);
  lines.push(`    const double* y0,`);
  lines.push(`    const double* params,`);
  lines.push(`    double* y_out,`);
  lines.push(`    double t0,`);
  lines.push(`    double t_end,`);
  lines.push(`    double dt,`);
  lines.push(`    int batch_size,`);
  lines.push(`    cudaStream_t stream`);
  lines.push(`) {`);
  lines.push(`  int threads = ${wgSize};`);
  lines.push(`  int blocks = (batch_size + threads - 1) / threads;`);
  lines.push(`  ${name}_ensemble<<<blocks, threads, 0, stream>>>(y0, params, y_out, t0, t_end, dt, batch_size);`);
  lines.push(`}`);

  return {
    name: `${name}_ensemble`,
    target: "cuda",
    source: lines.join("\n"),
    workgroupSize: wgSize,
  };
}

/**
 * Generate a WebGPU compute shader (WGSL) for batched ODE ensemble simulation.
 */
export function generateBatchedOdeWgslKernel(config: BatchedOdeEnsembleConfig): GpuKernel {
  const name = config.name ?? "batched_ode";
  const S = config.numStates;
  const P = config.numParams;
  const wgSize = config.workgroupSize ?? 256;
  const integrator = config.integrator ?? "rk4";
  const lines: string[] = [];

  lines.push(`// Auto-generated Batched ODE Ensemble WGSL Shader — DiffEqGPU Architecture`);
  lines.push(`struct SimUniforms {`);
  lines.push(`  t0: f32,`);
  lines.push(`  t_end: f32,`);
  lines.push(`  dt: f32,`);
  lines.push(`  batch_size: u32,`);
  lines.push(`};`);
  lines.push(``);
  lines.push(`@group(0) @binding(0) var<storage, read> y0: array<f32>;`);
  lines.push(`@group(0) @binding(1) var<storage, read> params: array<f32>;`);
  lines.push(`@group(0) @binding(2) var<storage, read_write> y_out: array<f32>;`);
  lines.push(`@group(0) @binding(3) var<uniform> uniforms: SimUniforms;`);
  lines.push(``);
  lines.push(`@compute @workgroup_size(${wgSize})`);
  lines.push(`fn ${name}_ensemble(@builtin(global_invocation_id) gid: vec3<u32>) {`);
  lines.push(`  let traj = gid.x;`);
  lines.push(`  if (traj >= uniforms.batch_size) { return; }`);
  lines.push(``);
  lines.push(`  let bsz = uniforms.batch_size;`);
  lines.push(`  // 1. Coalesced read of initial states and parameters into registers`);
  for (let s = 0; s < S; s++) {
    lines.push(`  var y_${s}: f32 = y0[${s}u * bsz + traj];`);
  }
  for (let p = 0; p < P; p++) {
    lines.push(`  let p_${p}: f32 = params[${p}u * bsz + traj];`);
  }
  lines.push(``);

  lines.push(`  // 2. In-register time-stepping`);
  lines.push(`  var t: f32 = uniforms.t0;`);
  lines.push(`  let dt: f32 = uniforms.dt;`);
  lines.push(`  let t_end: f32 = uniforms.t_end;`);
  lines.push(``);
  lines.push(`  while (t < t_end - 1e-6) {`);
  lines.push(`    var h: f32 = dt;`);
  lines.push(`    if (t + dt > t_end) {`);
  lines.push(`      h = t_end - t;`);
  lines.push(`    }`);
  lines.push(``);

  if (integrator === "euler") {
    for (let s = 0; s < S; s++) {
      const rhs = config.rhsExpressions[s] ?? "0.0";
      lines.push(`    let dy_${s}: f32 = ${rhs};`);
    }
    for (let s = 0; s < S; s++) {
      lines.push(`    y_${s} = y_${s} + h * dy_${s};`);
    }
  } else {
    // RK4
    lines.push(`    // Stage 1 (k1)`);
    for (let s = 0; s < S; s++) {
      const rhs = config.rhsExpressions[s] ?? "0.0";
      lines.push(`    let k1_${s}: f32 = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Stage 2 (k2)`);
    for (let s = 0; s < S; s++) {
      lines.push(`    var y_tmp_${s}: f32 = y_${s} + 0.5 * h * k1_${s};`);
    }
    for (let s = 0; s < S; s++) {
      let rhs = config.rhsExpressions[s] ?? "0.0";
      rhs = replaceStatePrefix(rhs, "y_", "y_tmp_", S);
      rhs = replaceTimeVariable(rhs, "t + 0.5 * h");
      lines.push(`    let k2_${s}: f32 = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Stage 3 (k3)`);
    for (let s = 0; s < S; s++) {
      lines.push(`    y_tmp_${s} = y_${s} + 0.5 * h * k2_${s};`);
    }
    for (let s = 0; s < S; s++) {
      let rhs = config.rhsExpressions[s] ?? "0.0";
      rhs = replaceStatePrefix(rhs, "y_", "y_tmp_", S);
      rhs = replaceTimeVariable(rhs, "t + 0.5 * h");
      lines.push(`    let k3_${s}: f32 = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Stage 4 (k4)`);
    for (let s = 0; s < S; s++) {
      lines.push(`    y_tmp_${s} = y_${s} + h * k3_${s};`);
    }
    for (let s = 0; s < S; s++) {
      let rhs = config.rhsExpressions[s] ?? "0.0";
      rhs = replaceStatePrefix(rhs, "y_", "y_tmp_", S);
      rhs = replaceTimeVariable(rhs, "t + h");
      lines.push(`    let k4_${s}: f32 = ${rhs};`);
    }
    lines.push(``);

    lines.push(`    // Update`);
    for (let s = 0; s < S; s++) {
      lines.push(`    y_${s} = y_${s} + (h / 6.0) * (k1_${s} + 2.0 * k2_${s} + 2.0 * k3_${s} + k4_${s});`);
    }
  }

  lines.push(`    t = t + h;`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  // 3. Coalesced store to global memory`);
  for (let s = 0; s < S; s++) {
    lines.push(`  y_out[${s}u * bsz + traj] = y_${s};`);
  }
  lines.push(`}`);

  return {
    name: `${name}_ensemble`,
    target: "webgpu",
    source: lines.join("\n"),
    workgroupSize: wgSize,
  };
}

/**
 * Generate both CUDA and WebGPU compute kernels for batched ODE ensemble execution.
 */
export function generateBatchedOdeEnsemble(config: BatchedOdeEnsembleConfig): BatchedOdeKernels {
  const cuda = generateBatchedOdeCudaKernel(config);
  const wgsl = generateBatchedOdeWgslKernel(config);

  return {
    cuda,
    wgsl,
    memoryLayout: {
      coalesced: true,
      stateStride: "batch_size",
      indexingFormula: "state_idx * batch_size + trajectory_idx",
      explanation:
        "Memory is stored with trajectory index in the innermost dimension so consecutive threads in a GPU warp/workgroup access contiguous memory addresses, achieving 100% memory coalescence.",
    },
  };
}

/**
 * Extract an ensemble ODE configuration directly from a linear memory DAEBuilder arena.
 */
export function createBatchedOdeConfigFromArena(
  arena: DAEBuilder,
  options?: { integrator?: "euler" | "rk4"; name?: string; workgroupSize?: number },
): BatchedOdeEnsembleConfig {
  const stateIndices: number[] = [];
  const stateNames: string[] = [];
  const stateIndexMap = new Map<string, number>();

  const paramIndices: number[] = [];
  const paramNames: string[] = [];
  const paramIndexMap = new Map<string, number>();

  // 1. Identify continuous state variables and parameters
  for (let v = 0; v < arena.varCount; v++) {
    const variability = arena.getVarVariability(v);
    const name = arena.getVarName(v);
    if (name.startsWith("der(") || name.startsWith("pre(")) continue;

    if (variability === Variability.Parameter || variability === Variability.Constant) {
      paramIndexMap.set(name, paramIndices.length);
      paramIndices.push(v);
      paramNames.push(name);
    } else {
      // Continuous / discrete state
      stateIndexMap.set(name, stateIndices.length);
      stateIndices.push(v);
      stateNames.push(name);
    }
  }

  // 2. Match derivative equations
  const rhsExpressions: string[] = new Array(stateIndices.length).fill("0.0");

  for (let eqIdx = 0; eqIdx < arena.eqCount; eqIdx++) {
    const kind = arena.getEqKind(eqIdx);
    if (kind !== EqKind.Simple && kind !== EqKind.InitialSimple) continue;

    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);

    let stateName: string | null = null;
    const lhsKind = arena.getExprKind(lhs);
    if (lhsKind === ExprKind.Der) {
      const arg = arena.getExprData1(lhs);
      if (arena.getExprKind(arg) === ExprKind.Name) {
        stateName = arena.interner.resolve(arena.getExprData1(arg));
      }
    } else if (lhsKind === ExprKind.Name) {
      const n = arena.interner.resolve(arena.getExprData1(lhs));
      const m = n.match(/^der\((.+)\)$/);
      if (m) stateName = m[1] ?? null;
    }

    if (stateName && stateIndexMap.has(stateName)) {
      const sIdx = stateIndexMap.get(stateName)!;
      rhsExpressions[sIdx] = serializeExprToNormalizedGpu(arena, rhs, stateIndexMap, paramIndexMap);
    }
  }

  return {
    name: options?.name ?? "model_batched",
    numStates: stateIndices.length,
    numParams: paramIndices.length,
    stateNames,
    paramNames,
    rhsExpressions,
    integrator: options?.integrator ?? "rk4",
    workgroupSize: options?.workgroupSize ?? 256,
  };
}

function serializeExprToNormalizedGpu(
  dae: DAEBuilder,
  id: number,
  stateMap: Map<string, number>,
  paramMap: Map<string, number>,
): string {
  if (id < 0) return "0.0";
  const kind = dae.getExprKind(id);

  switch (kind) {
    case ExprKind.RealLiteral: {
      const v = dae.getExprRealValue(id);
      return Number.isInteger(v) ? `${v}.0` : `${v}`;
    }
    case ExprKind.IntLiteral:
      return `${dae.getExprData1(id)}.0`;
    case ExprKind.BoolLiteral:
      return dae.getExprData1(id) !== 0 ? "1.0" : "0.0";
    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(id));
      if (name === "time") return "t";
      if (stateMap.has(name)) return `y_${stateMap.get(name)}`;
      if (paramMap.has(name)) return `p_${paramMap.get(name)}`;
      return "0.0";
    }
    case ExprKind.Unary: {
      const uop = dae.getExprData1(id) as UnaryOp;
      const op = uop === UnaryOp.Not ? "!" : "-";
      return `(${op}${serializeExprToNormalizedGpu(dae, dae.getExprLeft(id), stateMap, paramMap)})`;
    }
    case ExprKind.Negate:
      return `(-${serializeExprToNormalizedGpu(dae, dae.getExprLeft(id), stateMap, paramMap)})`;
    case ExprKind.Binary: {
      const op = dae.getExprData1(id) as BinOp;
      const lhs = serializeExprToNormalizedGpu(dae, dae.getExprLeft(id), stateMap, paramMap);
      const rhs = serializeExprToNormalizedGpu(dae, dae.getExprRight(id), stateMap, paramMap);
      let opStr = "+";
      if (op === BinOp.Sub) opStr = "-";
      else if (op === BinOp.Mul) opStr = "*";
      else if (op === BinOp.Div) opStr = "/";
      else if (op === BinOp.Pow) return `pow(${lhs}, ${rhs})`;
      return `(${lhs} ${opStr} ${rhs})`;
    }
    case ExprKind.Call: {
      const fname = dae.interner.resolve(dae.getExprData1(id));
      const count = dae.getExprRight(id);
      const args: string[] = [];
      for (let i = 0; i < count; i++) {
        args.push(serializeExprToNormalizedGpu(dae, dae.getExprLeft(id + i), stateMap, paramMap));
      }
      return `${fname}(${args.join(", ")})`;
    }
    case ExprKind.IfElse: {
      const c = serializeExprToNormalizedGpu(dae, dae.getExprData1(id), stateMap, paramMap);
      const t = serializeExprToNormalizedGpu(dae, dae.getExprLeft(id), stateMap, paramMap);
      const e = serializeExprToNormalizedGpu(dae, dae.getExprRight(id), stateMap, paramMap);
      return `(${c} ? ${t} : ${e})`;
    }
    default:
      return "0.0";
  }
}
