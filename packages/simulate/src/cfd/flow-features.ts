// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 3D CFD Flow Feature Extraction (CPU + WebGPU WGSL f32 + CUDA/HIP FP64 kernels).
 *
 * Computes per-cell vortex-identification and shock-capturing diagnostics on 3D structured grids:
 * - Full 3D velocity gradient tensor grad(u) (9 components per cell)
 * - Q-criterion: Q = 0.5 * (||Omega||_F^2 - ||S||_F^2) (Hunt, Wray & Moin, 1988)
 * - lambda_2 vortex-core criterion: middle eigenvalue of S^2 + Omega^2 (Jeong & Hussain, 1995)
 * - Vorticity magnitude ||curl(u)||_2 and divergence div(u)
 * - Ducros shock sensor: (div u)^2 / ((div u)^2 + ||curl u||^2 + eps) (Ducros et al., 1999)
 * - Optional density gradient magnitude ||grad(rho)||_2 (numerical Schlieren) when rho is supplied.
 */

export type ScalarFieldArray = Float32Array | Float64Array;

export interface FlowFeaturesResult {
  /** Grid dimensions. */
  nx: number;
  ny: number;
  nz: number;
  /** Uniform grid spacing. */
  dx: number;
  /** Per-cell 3x3 velocity gradient tensor stored row-major [du/dx, du/dy, du/dz, dv/dx, ...], length 9 * N. */
  velocityGradient: Float64Array;
  /** Per-cell Q-criterion: Q = 0.5 * (||Omega||_F^2 - ||S||_F^2). Positive inside vortex cores. */
  qCriterion: Float64Array;
  /** Per-cell lambda_2 criterion (middle eigenvalue of S^2 + Omega^2). Negative inside vortex cores. */
  lambda2: Float64Array;
  /** Per-cell vorticity magnitude ||nabla x u||_2. */
  vorticityMagnitude: Float64Array;
  /** Per-cell velocity divergence nabla . u. */
  divergence: Float64Array;
  /** Per-cell Ducros shock sensor in [0, 1] (~1 at shocks, ~0 in pure shear/vortices). */
  ducrosSensor: Float64Array;
  /** Optional per-cell density gradient magnitude ||nabla rho||_2 when rho is provided. */
  densityGradientMagnitude?: Float64Array;
}

/**
 * Compute the middle eigenvalue (lambda_1 >= lambda_2 >= lambda_3) of a 3x3 real symmetric matrix
 * using Smith's (1961) closed-form trigonometric Cardano algorithm.
 */
export function symmetric3x3MiddleEigenvalue(
  a00: number,
  a11: number,
  a22: number,
  a01: number,
  a02: number,
  a12: number,
): number {
  const p1 = a01 * a01 + a02 * a02 + a12 * a12;
  if (p1 <= 1e-30) {
    // Matrix is diagonal: return median of (a00, a11, a22)
    if (a00 >= a11) {
      if (a11 >= a22) return a11;
      return a00 >= a22 ? a22 : a00;
    } else {
      if (a00 >= a22) return a00;
      return a11 >= a22 ? a22 : a11;
    }
  }

  const q = (a00 + a11 + a22) / 3;
  const d0 = a00 - q;
  const d1 = a11 - q;
  const d2 = a22 - q;
  const p2 = d0 * d0 + d1 * d1 + d2 * d2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const invP = 1 / p;

  const b00 = d0 * invP;
  const b11 = d1 * invP;
  const b22 = d2 * invP;
  const b01 = a01 * invP;
  const b02 = a02 * invP;
  const b12 = a12 * invP;

  const detB = b00 * (b11 * b22 - b12 * b12) - b01 * (b01 * b22 - b12 * b02) + b02 * (b01 * b12 - b11 * b02);
  let r = 0.5 * detB;
  if (r <= -1) r = -1;
  else if (r >= 1) r = 1;

  const phi = Math.acos(r) / 3;
  const eig1 = q + 2 * p * Math.cos(phi);
  const eig3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  return 3 * q - eig1 - eig3;
}

/**
 * Extract 3D flow features (velocity gradient tensor, Q-criterion, lambda_2, vorticity magnitude,
 * divergence, Ducros shock sensor, and optional density gradient magnitude) on a uniform 3D grid
 * with flat indexing `idx = (z * ny + y) * nx + x`.
 */
export function extractFlowFeatures(
  nx: number,
  ny: number,
  nz: number,
  dx: number,
  vx: ScalarFieldArray,
  vy: ScalarFieldArray,
  vz: ScalarFieldArray,
  rho?: ScalarFieldArray,
  ducrosEps = 1e-20,
): FlowFeaturesResult {
  const n = nx * ny * nz;
  if (vx.length < n || vy.length < n || vz.length < n) {
    throw new Error(
      `extractFlowFeatures: velocity arrays must have length >= ${n} (got ${vx.length}, ${vy.length}, ${vz.length})`,
    );
  }
  if (rho && rho.length < n) {
    throw new Error(`extractFlowFeatures: rho array must have length >= ${n} (got ${rho.length})`);
  }
  if (dx <= 0) {
    throw new Error(`extractFlowFeatures: dx must be positive (got ${dx})`);
  }

  const velocityGradient = new Float64Array(n * 9);
  const qCriterion = new Float64Array(n);
  const lambda2 = new Float64Array(n);
  const vorticityMagnitude = new Float64Array(n);
  const divergence = new Float64Array(n);
  const ducrosSensor = new Float64Array(n);
  const densityGradientMagnitude = rho ? new Float64Array(n) : undefined;

  const invDx = 1 / dx;
  const inv2Dx = 0.5 / dx;
  const strideY = nx;
  const strideZ = nx * ny;

  for (let z = 0; z < nz; z++) {
    const zBase = z * strideZ;
    for (let y = 0; y < ny; y++) {
      const yzBase = zBase + y * strideY;
      for (let x = 0; x < nx; x++) {
        const idx = yzBase + x;

        // X-derivatives
        let ux = 0;
        let vxDx = 0;
        let wx = 0;
        let drhoDx = 0;
        if (nx > 1) {
          if (x === 0) {
            const p = idx + 1;
            ux = (vx[p]! - vx[idx]!) * invDx;
            vxDx = (vy[p]! - vy[idx]!) * invDx;
            wx = (vz[p]! - vz[idx]!) * invDx;
            if (rho) drhoDx = (rho[p]! - rho[idx]!) * invDx;
          } else if (x === nx - 1) {
            const m = idx - 1;
            ux = (vx[idx]! - vx[m]!) * invDx;
            vxDx = (vy[idx]! - vy[m]!) * invDx;
            wx = (vz[idx]! - vz[m]!) * invDx;
            if (rho) drhoDx = (rho[idx]! - rho[m]!) * invDx;
          } else {
            const p = idx + 1;
            const m = idx - 1;
            ux = (vx[p]! - vx[m]!) * inv2Dx;
            vxDx = (vy[p]! - vy[m]!) * inv2Dx;
            wx = (vz[p]! - vz[m]!) * inv2Dx;
            if (rho) drhoDx = (rho[p]! - rho[m]!) * inv2Dx;
          }
        }

        // Y-derivatives
        let uy = 0;
        let vyDy = 0;
        let wy = 0;
        let drhoDy = 0;
        if (ny > 1) {
          if (y === 0) {
            const p = idx + strideY;
            uy = (vx[p]! - vx[idx]!) * invDx;
            vyDy = (vy[p]! - vy[idx]!) * invDx;
            wy = (vz[p]! - vz[idx]!) * invDx;
            if (rho) drhoDy = (rho[p]! - rho[idx]!) * invDx;
          } else if (y === ny - 1) {
            const m = idx - strideY;
            uy = (vx[idx]! - vx[m]!) * invDx;
            vyDy = (vy[idx]! - vy[m]!) * invDx;
            wy = (vz[idx]! - vz[m]!) * invDx;
            if (rho) drhoDy = (rho[idx]! - rho[m]!) * invDx;
          } else {
            const p = idx + strideY;
            const m = idx - strideY;
            uy = (vx[p]! - vx[m]!) * inv2Dx;
            vyDy = (vy[p]! - vy[m]!) * inv2Dx;
            wy = (vz[p]! - vz[m]!) * inv2Dx;
            if (rho) drhoDy = (rho[p]! - rho[m]!) * inv2Dx;
          }
        }

        // Z-derivatives
        let uz = 0;
        let vzDz = 0;
        let wz = 0;
        let drhoDz = 0;
        if (nz > 1) {
          if (z === 0) {
            const p = idx + strideZ;
            uz = (vx[p]! - vx[idx]!) * invDx;
            vzDz = (vy[p]! - vy[idx]!) * invDx;
            wz = (vz[p]! - vz[idx]!) * invDx;
            if (rho) drhoDz = (rho[p]! - rho[idx]!) * invDx;
          } else if (z === nz - 1) {
            const m = idx - strideZ;
            uz = (vx[idx]! - vx[m]!) * invDx;
            vzDz = (vy[idx]! - vy[m]!) * invDx;
            wz = (vz[idx]! - vz[m]!) * invDx;
            if (rho) drhoDz = (rho[idx]! - rho[m]!) * invDx;
          } else {
            const p = idx + strideZ;
            const m = idx - strideZ;
            uz = (vx[p]! - vx[m]!) * inv2Dx;
            vzDz = (vy[p]! - vy[m]!) * inv2Dx;
            wz = (vz[p]! - vz[m]!) * inv2Dx;
            if (rho) drhoDz = (rho[p]! - rho[m]!) * inv2Dx;
          }
        }

        // Store 3x3 velocity gradient tensor row-major
        const gBase = idx * 9;
        velocityGradient[gBase] = ux;
        velocityGradient[gBase + 1] = uy;
        velocityGradient[gBase + 2] = uz;
        velocityGradient[gBase + 3] = vxDx;
        velocityGradient[gBase + 4] = vyDy;
        velocityGradient[gBase + 5] = vzDz;
        velocityGradient[gBase + 6] = wx;
        velocityGradient[gBase + 7] = wy;
        velocityGradient[gBase + 8] = wz;

        // Symmetric strain-rate tensor S = 0.5 * (G + G^T)
        const s00 = ux;
        const s11 = vyDy;
        const s22 = wz;
        const s01 = 0.5 * (uy + vxDx);
        const s02 = 0.5 * (uz + wx);
        const s12 = 0.5 * (vzDz + wy);

        // Skew-symmetric rotation tensor Omega = 0.5 * (G - G^T)
        const o01 = 0.5 * (uy - vxDx);
        const o02 = 0.5 * (uz - wx);
        const o12 = 0.5 * (vzDz - wy);

        // Frobenius norms squared
        const sNormSq = s00 * s00 + s11 * s11 + s22 * s22 + 2 * (s01 * s01 + s02 * s02 + s12 * s12);
        const oNormSq = 2 * (o01 * o01 + o02 * o02 + o12 * o12);

        // Q-criterion: Q = 0.5 * (||Omega||_F^2 - ||S||_F^2)
        qCriterion[idx] = 0.5 * (oNormSq - sNormSq);

        // Symmetric M = S^2 + Omega^2 for lambda_2 criterion
        const m00 = s00 * s00 + s01 * s01 + s02 * s02 - o01 * o01 - o02 * o02;
        const m11 = s01 * s01 + s11 * s11 + s12 * s12 - o01 * o01 - o12 * o12;
        const m22 = s02 * s02 + s12 * s12 + s22 * s22 - o02 * o02 - o12 * o12;
        const m01 = s00 * s01 + s01 * s11 + s02 * s12 - o02 * o12;
        const m02 = s00 * s02 + s01 * s12 + s02 * s22 + o01 * o12;
        const m12 = s01 * s02 + s11 * s12 + s12 * s22 - o01 * o02;
        lambda2[idx] = symmetric3x3MiddleEigenvalue(m00, m11, m22, m01, m02, m12);

        // Vorticity curl(u) and magnitude
        const omegaX = wy - vzDz;
        const omegaY = uz - wx;
        const omegaZ = vxDx - uy;
        const vortSq = omegaX * omegaX + omegaY * omegaY + omegaZ * omegaZ;
        vorticityMagnitude[idx] = Math.sqrt(vortSq);

        // Divergence and Ducros shock sensor
        const div = ux + vyDy + wz;
        divergence[idx] = div;
        const divSq = div * div;
        ducrosSensor[idx] = divSq / (divSq + vortSq + ducrosEps);

        if (densityGradientMagnitude) {
          densityGradientMagnitude[idx] = Math.sqrt(drhoDx * drhoDx + drhoDy * drhoDy + drhoDz * drhoDz);
        }
      }
    }
  }

  return {
    nx,
    ny,
    nz,
    dx,
    velocityGradient,
    qCriterion,
    lambda2,
    vorticityMagnitude,
    divergence,
    ducrosSensor,
    ...(densityGradientMagnitude ? { densityGradientMagnitude } : {}),
  };
}

// ============================================================================
// GPU Kernels: WebGPU WGSL (f32) and CUDA/HIP (f64)
// ============================================================================

/**
 * WebGPU WGSL f32 compute shader for per-cell Q-criterion, vorticity magnitude,
 * and Ducros shock sensor on a 3D structured grid.
 */
export const FLOW_FEATURES_WGSL = /* wgsl */ `
struct FlowFeatureParams {
  nx: u32,
  ny: u32,
  nz: u32,
  _pad: u32,
  dx: f32,
  ducros_eps: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0) var<uniform> params: FlowFeatureParams;
@group(0) @binding(1) var<storage, read> vx: array<f32>;
@group(0) @binding(2) var<storage, read> vy: array<f32>;
@group(0) @binding(3) var<storage, read> vz: array<f32>;
@group(0) @binding(4) var<storage, read_write> q_criterion: array<f32>;
@group(0) @binding(5) var<storage, read_write> ducros_sensor: array<f32>;
@group(0) @binding(6) var<storage, read_write> vorticity_mag: array<f32>;

fn cell_idx(x: u32, y: u32, z: u32) -> u32 {
  return (z * params.ny + y) * params.nx + x;
}

fn deriv_x(field_ptr: u32, x: u32, y: u32, z: u32) -> f32 {
  if (params.nx <= 1u) { return 0.0; }
  let i0 = cell_idx(select(x - 1u, 0u, x == 0u), y, z);
  let i1 = cell_idx(select(x + 1u, params.nx - 1u, x == params.nx - 1u), y, z);
  let denom = select(2.0 * params.dx, params.dx, x == 0u || x == params.nx - 1u);
  if (field_ptr == 0u) { return (vx[i1] - vx[i0]) / denom; }
  if (field_ptr == 1u) { return (vy[i1] - vy[i0]) / denom; }
  return (vz[i1] - vz[i0]) / denom;
}

fn deriv_y(field_ptr: u32, x: u32, y: u32, z: u32) -> f32 {
  if (params.ny <= 1u) { return 0.0; }
  let i0 = cell_idx(x, select(y - 1u, 0u, y == 0u), z);
  let i1 = cell_idx(x, select(y + 1u, params.ny - 1u, y == params.ny - 1u), z);
  let denom = select(2.0 * params.dx, params.dx, y == 0u || y == params.ny - 1u);
  if (field_ptr == 0u) { return (vx[i1] - vx[i0]) / denom; }
  if (field_ptr == 1u) { return (vy[i1] - vy[i0]) / denom; }
  return (vz[i1] - vz[i0]) / denom;
}

fn deriv_z(field_ptr: u32, x: u32, y: u32, z: u32) -> f32 {
  if (params.nz <= 1u) { return 0.0; }
  let i0 = cell_idx(x, y, select(z - 1u, 0u, z == 0u));
  let i1 = cell_idx(x, y, select(z + 1u, params.nz - 1u, z == params.nz - 1u));
  let denom = select(2.0 * params.dx, params.dx, z == 0u || z == params.nz - 1u);
  if (field_ptr == 0u) { return (vx[i1] - vx[i0]) / denom; }
  if (field_ptr == 1u) { return (vy[i1] - vy[i0]) / denom; }
  return (vz[i1] - vz[i0]) / denom;
}

@compute @workgroup_size(4, 4, 4)
fn extract_flow_features(@builtin(global_invocation_id) gid: vec3<u32>) {
  let x = gid.x;
  let y = gid.y;
  let z = gid.z;
  if (x >= params.nx || y >= params.ny || z >= params.nz) {
    return;
  }

  let ux = deriv_x(0u, x, y, z);
  let uy = deriv_y(0u, x, y, z);
  let uz = deriv_z(0u, x, y, z);
  let vx_dx = deriv_x(1u, x, y, z);
  let vy_dy = deriv_y(1u, x, y, z);
  let vz_dz = deriv_z(1u, x, y, z);
  let wx = deriv_x(2u, x, y, z);
  let wy = deriv_y(2u, x, y, z);
  let wz = deriv_z(2u, x, y, z);

  // Strain-rate tensor S = 0.5 * (grad u + grad u^T)
  let s01 = 0.5 * (uy + vx_dx);
  let s02 = 0.5 * (uz + wx);
  let s12 = 0.5 * (vz_dz + wy);
  let s_norm_sq = ux * ux + vy_dy * vy_dy + wz * wz + 2.0 * (s01 * s01 + s02 * s02 + s12 * s12);

  // Rotation tensor Omega = 0.5 * (grad u - grad u^T)
  let o01 = 0.5 * (uy - vx_dx);
  let o02 = 0.5 * (uz - wx);
  let o12 = 0.5 * (vz_dz - wy);
  let o_norm_sq = 2.0 * (o01 * o01 + o02 * o02 + o12 * o12);

  let idx = cell_idx(x, y, z);
  q_criterion[idx] = 0.5 * (o_norm_sq - s_norm_sq);

  // Vorticity curl(u) and Ducros shock sensor
  let ox = wy - vz_dz;
  let oy = uz - wx;
  let oz = vx_dx - uy;
  let vort_sq = ox * ox + oy * oy + oz * oz;
  let div = ux + vy_dy + wz;
  let div_sq = div * div;

  vorticity_mag[idx] = sqrt(vort_sq);
  ducros_sensor[idx] = div_sq / (div_sq + vort_sq + params.ducros_eps);
}
`;

/**
 * CUDA / HIP IEEE-754 double-precision (f64) kernel source for per-cell Q-criterion,
 * lambda_2 vortex-core criterion, vorticity magnitude, and Ducros shock sensor.
 */
export const FLOW_FEATURES_CUDA_FP64 = /* cuda */ `
#include <math.h>

__device__ __forceinline__ double sym3x3_lambda2_fp64(
    double a00, double a11, double a22,
    double a01, double a02, double a12) {
  const double p1 = a01 * a01 + a02 * a02 + a12 * a12;
  if (p1 <= 1e-30) {
    if (a00 >= a11) {
      if (a11 >= a22) return a11;
      return (a00 >= a22) ? a22 : a00;
    } else {
      if (a00 >= a22) return a00;
      return (a11 >= a22) ? a22 : a11;
    }
  }
  const double q = (a00 + a11 + a22) / 3.0;
  const double d0 = a00 - q;
  const double d1 = a11 - q;
  const double d2 = a22 - q;
  const double p2 = d0 * d0 + d1 * d1 + d2 * d2 + 2.0 * p1;
  const double p = sqrt(p2 / 6.0);
  const double invP = 1.0 / p;
  const double b00 = d0 * invP;
  const double b11 = d1 * invP;
  const double b22 = d2 * invP;
  const double b01 = a01 * invP;
  const double b02 = a02 * invP;
  const double b12 = a12 * invP;
  const double detB =
      b00 * (b11 * b22 - b12 * b12) -
      b01 * (b01 * b22 - b12 * b02) +
      b02 * (b01 * b12 - b11 * b02);
  double r = 0.5 * detB;
  if (r < -1.0) r = -1.0;
  if (r >  1.0) r =  1.0;
  const double phi = acos(r) / 3.0;
  const double eig1 = q + 2.0 * p * cos(phi);
  const double eig3 = q + 2.0 * p * cos(phi + 2.0943951023931954923084);
  return 3.0 * q - eig1 - eig3;
}

extern "C" __global__ void extract_flow_features_fp64(
    int nx, int ny, int nz,
    double dx, double ducros_eps,
    const double* __restrict__ vx,
    const double* __restrict__ vy,
    const double* __restrict__ vz,
    double* __restrict__ q_criterion,
    double* __restrict__ lambda2_out,
    double* __restrict__ vorticity_mag,
    double* __restrict__ ducros_sensor) {
  const int x = blockIdx.x * blockDim.x + threadIdx.x;
  const int y = blockIdx.y * blockDim.y + threadIdx.y;
  const int z = blockIdx.z * blockDim.z + threadIdx.z;
  if (x >= nx || y >= ny || z >= nz) return;

  const int strideY = nx;
  const int strideZ = nx * ny;
  const int idx = z * strideZ + y * strideY + x;

  const int xm = (x > 0) ? idx - 1 : idx;
  const int xp = (x + 1 < nx) ? idx + 1 : idx;
  const double invX = (nx <= 1) ? 0.0 : ((x == 0 || x == nx - 1) ? (1.0 / dx) : (0.5 / dx));

  const int ym = (y > 0) ? idx - strideY : idx;
  const int yp = (y + 1 < ny) ? idx + strideY : idx;
  const double invY = (ny <= 1) ? 0.0 : ((y == 0 || y == ny - 1) ? (1.0 / dx) : (0.5 / dx));

  const int zm = (z > 0) ? idx - strideZ : idx;
  const int zp = (z + 1 < nz) ? idx + strideZ : idx;
  const double invZ = (nz <= 1) ? 0.0 : ((z == 0 || z == nz - 1) ? (1.0 / dx) : (0.5 / dx));

  const double ux = (vx[xp] - vx[xm]) * invX;
  const double uy = (vx[yp] - vx[ym]) * invY;
  const double uz = (vx[zp] - vx[zm]) * invZ;
  const double vx_dx = (vy[xp] - vy[xm]) * invX;
  const double vy_dy = (vy[yp] - vy[ym]) * invY;
  const double vz_dz = (vy[zp] - vy[zm]) * invZ;
  const double wx = (vz[xp] - vz[xm]) * invX;
  const double wy = (vz[yp] - vz[ym]) * invY;
  const double wz = (vz[zp] - vz[zm]) * invZ;

  const double s00 = ux, s11 = vy_dy, s22 = wz;
  const double s01 = 0.5 * (uy + vx_dx);
  const double s02 = 0.5 * (uz + wx);
  const double s12 = 0.5 * (vz_dz + wy);

  const double o01 = 0.5 * (uy - vx_dx);
  const double o02 = 0.5 * (uz - wx);
  const double o12 = 0.5 * (vz_dz - wy);

  const double sNormSq = s00 * s00 + s11 * s11 + s22 * s22 + 2.0 * (s01 * s01 + s02 * s02 + s12 * s12);
  const double oNormSq = 2.0 * (o01 * o01 + o02 * o02 + o12 * o12);
  q_criterion[idx] = 0.5 * (oNormSq - sNormSq);

  const double m00 = s00 * s00 + s01 * s01 + s02 * s02 - o01 * o01 - o02 * o02;
  const double m11 = s01 * s01 + s11 * s11 + s12 * s12 - o01 * o01 - o12 * o12;
  const double m22 = s02 * s02 + s12 * s12 + s22 * s22 - o02 * o02 - o12 * o12;
  const double m01 = s00 * s01 + s01 * s11 + s02 * s12 - o02 * o12;
  const double m02 = s00 * s02 + s01 * s12 + s02 * s22 + o01 * o12;
  const double m12 = s01 * s02 + s11 * s12 + s12 * s22 - o01 * o02;
  lambda2_out[idx] = sym3x3_lambda2_fp64(m00, m11, m22, m01, m02, m12);

  const double ox = wy - vz_dz;
  const double oy = uz - wx;
  const double oz = vx_dx - uy;
  const double vortSq = ox * ox + oy * oy + oz * oz;
  const double div = ux + vy_dy + wz;
  const double divSq = div * div;

  vorticity_mag[idx] = sqrt(vortSq);
  ducros_sensor[idx] = divSq / (divSq + vortSq + ducros_eps);
}
`;
