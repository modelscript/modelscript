// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime kernel for `@modelscript/nasa-cdf-std-lib`.
 *
 * Provides zero-GC WebAssembly numerical primitives for:
 * - Magnetic-field vector magnitude `|B| = sqrt(Bx^2 + By^2 + Bz^2)`
 * - Magnetic pressure `P_mag = B^2 / (2 * mu_0)`
 * - Plasma beta `beta = (n * kB * T) / P_mag`
 * - `CDF_EPOCH` to J2000.0 UTC seconds conversion
 */

const MU_0: f64 = 1.2566370614359173e-6;
const K_BOLTZMANN: f64 = 1.380649e-23;
const CDF_EPOCH_J2000_MS: f64 = 63113947200000.0;

/**
 * Computes 3-axis magnetic field magnitude `|B| = sqrt(bx^2 + by^2 + bz^2)`.
 */
export function cdfMagneticFieldNorm(bx: f64, by: f64, bz: f64): f64 {
  return Math.sqrt(bx * bx + by * by + bz * bz);
}

/**
 * Computes magnetic pressure in Pascals for magnetic field magnitude in nT.
 */
export function cdfMagneticPressure(bMagNt: f64): f64 {
  const bTesla = bMagNt * 1e-9;
  return (bTesla * bTesla) / (2.0 * MU_0);
}

/**
 * Computes plasma beta `beta = (n * kB * T) / (B^2 / (2 * mu0))`.
 */
export function cdfPlasmaBeta(densityM3: f64, tempK: f64, bMagNt: f64): f64 {
  const pMag = cdfMagneticPressure(bMagNt);
  if (pMag <= 0.0) return 0.0;
  return (densityM3 * K_BOLTZMANN * tempK) / pMag;
}

/**
 * Converts `CDF_EPOCH` milliseconds to seconds since J2000.0 UTC.
 */
export function cdfEpochToJ2000Sec(cdfEpochMs: f64): f64 {
  return (cdfEpochMs - CDF_EPOCH_J2000_MS) / 1000.0;
}

/**
 * Generic archetype evaluation hook (`cdfEval`).
 */
export function cdfEval(archetypeId: i32, x: f64, p0: f64, p1: f64): f64 {
  if (archetypeId == 20) {
    return cdfEpochToJ2000Sec(x);
  }
  if (archetypeId == 21 || archetypeId == 22 || archetypeId == 23) {
    return cdfMagneticFieldNorm(x, p0, p1);
  }
  if (archetypeId == 24 || archetypeId == 26) {
    return cdfPlasmaBeta(x, p0, p1);
  }
  return x;
}
