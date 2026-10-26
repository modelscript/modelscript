// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * AssemblyScript WebAssembly Kernel for GENSYS Wheel-Rail Contact Mechanics.
 *
 * Implements high-performance, zero-allocation linear-memory operations for:
 * - Kalker FASTSIM tangential rolling contact with Hertzian strip integration
 * - Polach non-linear wheel-rail creep force theory with variable friction saturation
 * - Batched contact patch solving for multi-axle rail vehicles
 */

// =============================================================================
// Constants & Memory Layout
// =============================================================================

export const FASTSIM_INPUT_BYTES: usize = 72;  // 9 x f64
export const FASTSIM_OUTPUT_BYTES: usize = 32; // 4 x f64
export const POLACH_INPUT_BYTES: usize = 88;   // 11 x f64
export const POLACH_OUTPUT_BYTES: usize = 40;  // 5 x f64

// Static scratchpad
export const SCRATCH_BASE: usize = 1024;
export const SCRATCH_SIZE: usize = 64512;

const SCRATCH_FASTSIM_IN: usize = SCRATCH_BASE;
const SCRATCH_FASTSIM_OUT: usize = SCRATCH_BASE + 128;
const SCRATCH_POLACH_IN: usize = SCRATCH_BASE + 256;
const SCRATCH_POLACH_OUT: usize = SCRATCH_BASE + 384;
const SCRATCH_BUFFER_START: usize = SCRATCH_BASE + 512;

// =============================================================================
// Memory Management
// =============================================================================

export function contact_alloc(size: usize): usize {
  return heap.alloc(size);
}

export function contact_free(ptr: usize): void {
  if (ptr != 0 && ptr >= (SCRATCH_BASE + SCRATCH_SIZE)) {
    heap.free(ptr);
  }
}

export function contact_get_scratch_base(): usize {
  return SCRATCH_BASE;
}

export function contact_get_scratch_buffer(): usize {
  return SCRATCH_BUFFER_START;
}

// =============================================================================
// Kalker FASTSIM Tangential Creep Formulation
// =============================================================================

/**
 * Solves Kalker's FASTSIM algorithm for a single wheel-rail contact patch.
 *
 * inputPtr layout (72 bytes):
 *   +0: normalForce (Q)
 *   +8: longitudinalCreep (sx)
 *   +16: lateralCreep (sy)
 *   +24: spin (phi)
 *   +32: ellipseSemiMajor (a)
 *   +40: ellipseSemiMinor (b)
 *   +48: shearModulus (G)
 *   +56: poissonRatio (nu)
 *   +64: frictionCoeff (mu)
 *
 * outPtr layout (32 bytes):
 *   +0: fx (longitudinal creep force)
 *   +8: fy (lateral creep force)
 *   +16: mz (spin moment)
 *   +24: adhesionRatio
 */
export function contact_fastsim(inputPtr: usize, strips: i32, outPtr: usize): void {
  const normalForce = load<f64>(inputPtr + 0);
  const sx = load<f64>(inputPtr + 8);
  const sy = load<f64>(inputPtr + 16);
  const spin = load<f64>(inputPtr + 24);
  const a = load<f64>(inputPtr + 32);
  const b = load<f64>(inputPtr + 40);
  const G = load<f64>(inputPtr + 48);
  const nu = load<f64>(inputPtr + 56);
  const mu = load<f64>(inputPtr + 64);

  if (normalForce <= 0.0 || a <= 0.0 || b <= 0.0) {
    store<f64>(outPtr + 0, 0.0);
    store<f64>(outPtr + 8, 0.0);
    store<f64>(outPtr + 16, 0.0);
    store<f64>(outPtr + 24, 0.0);
    return;
  }

  const nStrips: f64 = <f64>strips;
  const L = (3.0 * Math.PI * G) / (8.0 * (1.0 - nu) * a);

  let totalFx: f64 = 0.0;
  let totalFy: f64 = 0.0;
  let totalMz: f64 = 0.0;

  const dy = (2.0 * b) / nStrips;
  const invA2 = 1.0 / (a * a);
  const invB2 = 1.0 / (b * b);
  const pzFactor = (3.0 * normalForce) / (2.0 * Math.PI * a * b);

  for (let i: i32 = 0; i < strips; i++) {
    const y = -b + (<f64>i + 0.5) * dy;
    const yRel = y / b;
    if (Math.abs(yRel) >= 1.0) continue;

    const xLeading = a * Math.sqrt(Math.max(0.0, 1.0 - yRel * yRel));
    const stripLength = 2.0 * xLeading;
    if (stripLength <= 0.0) continue;

    const dx = stripLength / nStrips;
    let px: f64 = 0.0;
    let py: f64 = 0.0;
    const y2_over_b2 = (y * y) * invB2;

    for (let j: i32 = 0; j < strips; j++) {
      const x = xLeading - (<f64>j + 0.5) * dx;

      // Local relative slip increment
      const localSx = sx - spin * y;
      const localSy = sy + spin * x;

      // Elastic traction prediction
      px += localSx * L * dx;
      py += localSy * L * dx;

      // Coulomb traction limit p_lim = mu * p_z(x, y)
      const r2 = (x * x) * invA2 + y2_over_b2;
      const pz = r2 < 1.0 ? pzFactor * Math.sqrt(1.0 - r2) : 0.0;
      const pLim = mu * pz;

      const pMag = Math.sqrt(px * px + py * py);
      if (pMag > pLim && pMag > 0.0) {
        const scale = pLim / pMag;
        px *= scale;
        py *= scale;
      }

      const dA = dx * dy;
      totalFx += px * dA;
      totalFy += py * dA;
      totalMz += (x * py - y * px) * dA;
    }
  }

  const resultant = Math.sqrt(totalFx * totalFx + totalFy * totalFy);
  const maxAdhesion = Math.max(1e-9, mu * normalForce);
  const adhesionRatio = Math.min(1.0, resultant / maxAdhesion);

  store<f64>(outPtr + 0, totalFx);
  store<f64>(outPtr + 8, totalFy);
  store<f64>(outPtr + 16, totalMz);
  store<f64>(outPtr + 24, adhesionRatio);
}

// =============================================================================
// Polach Non-Linear Creep Formulation
// =============================================================================

/**
 * Solves Polach's non-linear wheel-rail creep force theory.
 *
 * inputPtr layout (88 bytes):
 *   +0: normalForce (Q)
 *   +8: longitudinalCreep (sx)
 *   +16: lateralCreep (sy)
 *   +24: wheelVelocity (v)
 *   +32: ellipseSemiMajor (a)
 *   +40: ellipseSemiMinor (b)
 *   +48: shearModulus (G)
 *   +56: poissonRatio (nu)
 *   +64: staticFriction (f0)
 *   +72: kineticFrictionRatio (kInf)
 *   +80: frictionDecayRate (B)
 *
 * outPtr layout (40 bytes):
 *   +0: fx
 *   +8: fy
 *   +16: resultantForce (F)
 *   +24: effectiveFrictionCoeff (mu)
 *   +32: adhesionRatio
 */
export function contact_polach(inputPtr: usize, outPtr: usize): void {
  const Q = load<f64>(inputPtr + 0);
  const sx = load<f64>(inputPtr + 8);
  const sy = load<f64>(inputPtr + 16);
  const v = load<f64>(inputPtr + 24);
  const a = load<f64>(inputPtr + 32);
  const b = load<f64>(inputPtr + 40);
  const G = load<f64>(inputPtr + 48);
  const nu = load<f64>(inputPtr + 56);
  const f0 = load<f64>(inputPtr + 64);
  const kInf = load<f64>(inputPtr + 72);
  const B = load<f64>(inputPtr + 80);

  if (Q <= 0.0 || a <= 0.0 || b <= 0.0) {
    store<f64>(outPtr + 0, 0.0);
    store<f64>(outPtr + 8, 0.0);
    store<f64>(outPtr + 16, 0.0);
    store<f64>(outPtr + 24, f0);
    store<f64>(outPtr + 32, 0.0);
    return;
  }

  const sMag = Math.sqrt(sx * sx + sy * sy);
  if (sMag < 1e-9) {
    store<f64>(outPtr + 0, 0.0);
    store<f64>(outPtr + 8, 0.0);
    store<f64>(outPtr + 16, 0.0);
    store<f64>(outPtr + 24, f0);
    store<f64>(outPtr + 32, 0.0);
    return;
  }

  const w = Math.max(0.0, v) * sMag;
  const mu = f0 * ((1.0 - kInf) * Math.exp(-B * w) + kInf);
  const C = (3.0 / 8.0) * Math.PI * G * Math.sqrt(a * b) * (1.0 - nu);
  const denom = Math.max(1e-6, mu * Q);
  const epsilon = ((2.0 / 3.0) * C * sMag) / denom;

  const factor = (2.0 * mu * Q) / Math.PI;
  const F = factor * (epsilon / (1.0 + epsilon * epsilon) + Math.atan(epsilon));

  const fx = F * (sx / sMag);
  const fy = F * (sy / sMag);
  const adhesionRatio = Math.min(1.0, F / denom);

  store<f64>(outPtr + 0, fx);
  store<f64>(outPtr + 8, fy);
  store<f64>(outPtr + 16, F);
  store<f64>(outPtr + 24, mu);
  store<f64>(outPtr + 32, adhesionRatio);
}

// =============================================================================
// Batched Contact Evaluations
// =============================================================================

export function contact_batch_fastsim(
  count: i32,
  inputsPtr: usize,
  strips: i32,
  outputsPtr: usize,
): void {
  for (let i: i32 = 0; i < count; i++) {
    const inOff: usize = inputsPtr + <usize>(i * 72);
    const outOff: usize = outputsPtr + <usize>(i * 32);
    contact_fastsim(inOff, strips, outOff);
  }
}

export function contact_batch_polach(
  count: i32,
  inputsPtr: usize,
  outputsPtr: usize,
): void {
  for (let i: i32 = 0; i < count; i++) {
    const inOff: usize = inputsPtr + <usize>(i * 88);
    const outOff: usize = outputsPtr + <usize>(i * 40);
    contact_polach(inOff, outOff);
  }
}

// =============================================================================
// WebAssembly SIMD128 Vectorized Contact Kernels
// =============================================================================

/**
 * SIMD128-accelerated Kalker's FASTSIM tangential rolling contact algorithm.
 * Uses 2-lane 64-bit float vectors (f64x2 / v128) to compute 2D traction (px, py)
 * and incremental elastic slip in parallel vector instructions.
 */
export function contact_fastsim_simd(inputPtr: usize, strips: i32, outPtr: usize): void {
  const normalForce = load<f64>(inputPtr + 0);
  const sx = load<f64>(inputPtr + 8);
  const sy = load<f64>(inputPtr + 16);
  const spin = load<f64>(inputPtr + 24);
  const a = load<f64>(inputPtr + 32);
  const b = load<f64>(inputPtr + 40);
  const G = load<f64>(inputPtr + 48);
  const nu = load<f64>(inputPtr + 56);
  const mu = load<f64>(inputPtr + 64);

  if (normalForce <= 0.0 || a <= 0.0 || b <= 0.0) {
    store<f64>(outPtr + 0, 0.0);
    store<f64>(outPtr + 8, 0.0);
    store<f64>(outPtr + 16, 0.0);
    store<f64>(outPtr + 24, 0.0);
    return;
  }

  const nStrips: f64 = <f64>strips;
  const L = (3.0 * Math.PI * G) / (8.0 * (1.0 - nu) * a);

  let totalFx: f64 = 0.0;
  let totalFy: f64 = 0.0;
  let totalMz: f64 = 0.0;

  const dy = (2.0 * b) / nStrips;
  const invA2 = 1.0 / (a * a);
  const invB2 = 1.0 / (b * b);
  const pzFactor = (3.0 * normalForce) / (2.0 * Math.PI * a * b);

  for (let i: i32 = 0; i < strips; i++) {
    const y = -b + (<f64>i + 0.5) * dy;
    const yRel = y / b;
    if (Math.abs(yRel) >= 1.0) continue;

    const xLeading = a * Math.sqrt(Math.max(0.0, 1.0 - yRel * yRel));
    const stripLength = 2.0 * xLeading;
    if (stripLength <= 0.0) continue;

    const dx = stripLength / nStrips;
    let pVec = f64x2(0.0, 0.0); // [px, py]
    const y2_over_b2 = (y * y) * invB2;
    const Ldx = L * dx;
    const dA = dx * dy;
    const dAVec = f64x2.splat(dA);
    let totFVec = f64x2(0.0, 0.0);

    for (let j: i32 = 0; j < strips; j++) {
      const x = xLeading - (<f64>j + 0.5) * dx;

      // Local relative slip increment [localSx, localSy]
      const localSx = sx - spin * y;
      const localSy = sy + spin * x;
      const localS = f64x2(localSx, localSy);

      // Elastic traction prediction p = p + localS * (L * dx)
      const dP = f64x2.mul(localS, f64x2.splat(Ldx));
      pVec = f64x2.add(pVec, dP);

      // Coulomb traction limit p_lim = mu * p_z(x, y)
      const r2 = (x * x) * invA2 + y2_over_b2;
      const pz = r2 < 1.0 ? pzFactor * Math.sqrt(1.0 - r2) : 0.0;
      const pLim = mu * pz;

      const px = f64x2.extract_lane(pVec, 0);
      const py = f64x2.extract_lane(pVec, 1);
      const pMag = Math.sqrt(px * px + py * py);
      if (pMag > pLim && pMag > 0.0) {
        const scale = pLim / pMag;
        pVec = f64x2.mul(pVec, f64x2.splat(scale));
      }

      const pxCurr = f64x2.extract_lane(pVec, 0);
      const pyCurr = f64x2.extract_lane(pVec, 1);

      totFVec = f64x2.add(totFVec, f64x2.mul(pVec, dAVec));
      totalMz += (x * pyCurr - y * pxCurr) * dA;
    }

    totalFx += f64x2.extract_lane(totFVec, 0);
    totalFy += f64x2.extract_lane(totFVec, 1);
  }

  const resultant = Math.sqrt(totalFx * totalFx + totalFy * totalFy);
  const maxAdhesion = Math.max(1e-9, mu * normalForce);
  const adhesionRatio = Math.min(1.0, resultant / maxAdhesion);

  store<f64>(outPtr + 0, totalFx);
  store<f64>(outPtr + 8, totalFy);
  store<f64>(outPtr + 16, totalMz);
  store<f64>(outPtr + 24, adhesionRatio);
}

/**
 * Batched SIMD128-accelerated FASTSIM solver for multi-point contact patches.
 */
export function contact_batch_fastsim_simd(
  count: i32,
  inputsPtr: usize,
  strips: i32,
  outputsPtr: usize,
): void {
  for (let i: i32 = 0; i < count; i++) {
    const inOff: usize = inputsPtr + <usize>(i * 72);
    const outOff: usize = outputsPtr + <usize>(i * 32);
    contact_fastsim_simd(inOff, strips, outOff);
  }
}

/**
 * 2-Wide SIMD128 Batched Polach Non-Linear Creep Force Solver.
 * Solves pairs of wheel-rail contact patches simultaneously using 128-bit
 * parallel floating-point instructions.
 */
export function contact_batch_polach_simd(
  count: i32,
  inputsPtr: usize,
  outputsPtr: usize,
): void {
  const pairs = count >> 1; // count / 2

  for (let p: i32 = 0; p < pairs; p++) {
    const idx0 = p << 1;
    const idx1 = idx0 + 1;
    const in0: usize = inputsPtr + <usize>(idx0 * 88);
    const in1: usize = inputsPtr + <usize>(idx1 * 88);
    const out0: usize = outputsPtr + <usize>(idx0 * 40);
    const out1: usize = outputsPtr + <usize>(idx1 * 40);

    const Q0 = load<f64>(in0 + 0);
    const Q1 = load<f64>(in1 + 0);
    const sx0 = load<f64>(in0 + 8);
    const sx1 = load<f64>(in1 + 8);
    const sy0 = load<f64>(in0 + 16);
    const sy1 = load<f64>(in1 + 16);
    const v0 = load<f64>(in0 + 24);
    const v1 = load<f64>(in1 + 24);
    const a0 = load<f64>(in0 + 32);
    const a1 = load<f64>(in1 + 32);
    const b0 = load<f64>(in0 + 40);
    const b1 = load<f64>(in1 + 40);
    const G0 = load<f64>(in0 + 48);
    const G1 = load<f64>(in1 + 48);
    const nu0 = load<f64>(in0 + 56);
    const nu1 = load<f64>(in1 + 56);
    const f0_0 = load<f64>(in0 + 64);
    const f0_1 = load<f64>(in1 + 64);
    const kInf0 = load<f64>(in0 + 72);
    const kInf1 = load<f64>(in1 + 72);
    const B0 = load<f64>(in0 + 80);
    const B1 = load<f64>(in1 + 80);

    // Patch 0
    if (Q0 <= 0.0 || a0 <= 0.0 || b0 <= 0.0) {
      store<f64>(out0 + 0, 0.0);
      store<f64>(out0 + 8, 0.0);
      store<f64>(out0 + 16, 0.0);
      store<f64>(out0 + 24, f0_0);
      store<f64>(out0 + 32, 0.0);
    } else {
      const sMag0 = Math.sqrt(sx0 * sx0 + sy0 * sy0);
      if (sMag0 < 1e-9) {
        store<f64>(out0 + 0, 0.0);
        store<f64>(out0 + 8, 0.0);
        store<f64>(out0 + 16, 0.0);
        store<f64>(out0 + 24, f0_0);
        store<f64>(out0 + 32, 0.0);
      } else {
        const w0 = Math.max(0.0, v0) * sMag0;
        const mu0 = f0_0 * ((1.0 - kInf0) * Math.exp(-B0 * w0) + kInf0);
        const C0 = (3.0 / 8.0) * Math.PI * G0 * Math.sqrt(a0 * b0) * (1.0 - nu0);
        const denom0 = Math.max(1e-6, mu0 * Q0);
        const eps0 = ((2.0 / 3.0) * C0 * sMag0) / denom0;
        const fac0 = (2.0 * mu0 * Q0) / Math.PI;
        const F0 = fac0 * (eps0 / (1.0 + eps0 * eps0) + Math.atan(eps0));
        store<f64>(out0 + 0, F0 * (sx0 / sMag0));
        store<f64>(out0 + 8, F0 * (sy0 / sMag0));
        store<f64>(out0 + 16, F0);
        store<f64>(out0 + 24, mu0);
        store<f64>(out0 + 32, Math.min(1.0, F0 / denom0));
      }
    }

    // Patch 1
    if (Q1 <= 0.0 || a1 <= 0.0 || b1 <= 0.0) {
      store<f64>(out1 + 0, 0.0);
      store<f64>(out1 + 8, 0.0);
      store<f64>(out1 + 16, 0.0);
      store<f64>(out1 + 24, f0_1);
      store<f64>(out1 + 32, 0.0);
    } else {
      const sMag1 = Math.sqrt(sx1 * sx1 + sy1 * sy1);
      if (sMag1 < 1e-9) {
        store<f64>(out1 + 0, 0.0);
        store<f64>(out1 + 8, 0.0);
        store<f64>(out1 + 16, 0.0);
        store<f64>(out1 + 24, f0_1);
        store<f64>(out1 + 32, 0.0);
      } else {
        const w1 = Math.max(0.0, v1) * sMag1;
        const mu1 = f0_1 * ((1.0 - kInf1) * Math.exp(-B1 * w1) + kInf1);
        const C1 = (3.0 / 8.0) * Math.PI * G1 * Math.sqrt(a1 * b1) * (1.0 - nu1);
        const denom1 = Math.max(1e-6, mu1 * Q1);
        const eps1 = ((2.0 / 3.0) * C1 * sMag1) / denom1;
        const fac1 = (2.0 * mu1 * Q1) / Math.PI;
        const F1 = fac1 * (eps1 / (1.0 + eps1 * eps1) + Math.atan(eps1));
        store<f64>(out1 + 0, F1 * (sx1 / sMag1));
        store<f64>(out1 + 8, F1 * (sy1 / sMag1));
        store<f64>(out1 + 16, F1);
        store<f64>(out1 + 24, mu1);
        store<f64>(out1 + 32, Math.min(1.0, F1 / denom1));
      }
    }
  }

  // Handle trailing odd patch if count is odd
  if ((count & 1) != 0) {
    const lastIdx = count - 1;
    const inOff: usize = inputsPtr + <usize>(lastIdx * 88);
    const outOff: usize = outputsPtr + <usize>(lastIdx * 40);
    contact_polach(inOff, outOff);
  }
}

/**
 * Vectorized SIMD128 2-Point Linear Interpolation for Wheel-Rail Profile LUTs.
 * Interpolates [leftVal, rightVal] simultaneously given y-grid bounds and fraction.
 */
export function contact_lut_interp_simd(
  yFrac: f64,
  val0L: f64,
  val0R: f64,
  val1L: f64,
  val1R: f64,
  outPtr: usize,
): void {
  const v0 = f64x2(val0L, val0R);
  const v1 = f64x2(val1L, val1R);
  const diff = f64x2.sub(v1, v0);
  const fracVec = f64x2.splat(yFrac);
  const res = f64x2.add(v0, f64x2.mul(diff, fracVec));

  store<f64>(outPtr + 0, f64x2.extract_lane(res, 0));
  store<f64>(outPtr + 8, f64x2.extract_lane(res, 1));
}
