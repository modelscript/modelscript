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
