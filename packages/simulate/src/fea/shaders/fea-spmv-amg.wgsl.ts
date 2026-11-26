// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — WebGPU WGSL Compute Shaders for Local GPU PCG + SA-AMG FEA.
 *
 * Provides ready-to-dispatch WGSL compute shaders for:
 *   1. Sparse CSR Matrix-Vector Product (`FEA_CSR_SPMV_WGSL`): y = A * x
 *   2. Race-Free Damped-Jacobi AMG Smoother (`FEA_DAMPED_JACOBI_WGSL`):
 *      x_out = x_in + omega * D^{-1} * (rhs - A * x_in)
 */

export const FEA_CSR_SPMV_WGSL = /* wgsl */ `
struct SpMvParams {
  n: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
};

@group(0) @binding(0) var<uniform> params: SpMvParams;
@group(0) @binding(1) var<storage, read> rowOffsets: array<u32>;
@group(0) @binding(2) var<storage, read> colIndices: array<u32>;
@group(0) @binding(3) var<storage, read> values: array<f32>;
@group(0) @binding(4) var<storage, read> x: array<f32>;
@group(0) @binding(5) var<storage, read_write> y: array<f32>;

@compute @workgroup_size(64)
fn csr_spmv(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  if (row >= params.n) {
    return;
  }

  let start = rowOffsets[row];
  let end = rowOffsets[row + 1u];
  var sum: f32 = 0.0;
  for (var k: u32 = start; k < end; k = k + 1u) {
    sum = sum + values[k] * x[colIndices[k]];
  }
  y[row] = sum;
}
`;

export const FEA_DAMPED_JACOBI_WGSL = /* wgsl */ `
struct JacobiParams {
  n: u32,
  omega: f32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> params: JacobiParams;
@group(0) @binding(1) var<storage, read> rowOffsets: array<u32>;
@group(0) @binding(2) var<storage, read> colIndices: array<u32>;
@group(0) @binding(3) var<storage, read> values: array<f32>;
@group(0) @binding(4) var<storage, read> invDiag: array<f32>;
@group(0) @binding(5) var<storage, read> rhs: array<f32>;
@group(0) @binding(6) var<storage, read> xIn: array<f32>;
@group(0) @binding(7) var<storage, read_write> xOut: array<f32>;

@compute @workgroup_size(64)
fn damped_jacobi_smooth(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  if (row >= params.n) {
    return;
  }

  let start = rowOffsets[row];
  let end = rowOffsets[row + 1u];
  var ax: f32 = 0.0;
  for (var k: u32 = start; k < end; k = k + 1u) {
    ax = ax + values[k] * xIn[colIndices[k]];
  }

  let residual = rhs[row] - ax;
  xOut[row] = xIn[row] + params.omega * invDiag[row] * residual;
}
`;
