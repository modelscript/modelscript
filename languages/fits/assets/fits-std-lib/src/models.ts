// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime kernel for `@modelscript/fits-std-lib`.
 *
 * Provides zero-GC WebAssembly numerical primitives for:
 * - FITS physical pixel scaling (`BZERO + BSCALE * raw`)
 * - WCS TAN / SIN / ARC native latitude projection math
 * - Astronomical flux <-> magnitude conversion
 */

const DEG2RAD: f64 = 0.017453292519943295;
const RAD2DEG: f64 = 57.29577951308232;
const HALF_PI: f64 = 1.5707963267948966;

/**
 * Applies FITS physical pixel scaling: `physical = bzero + bscale * raw`.
 */
export function fitsPhysicalScale(raw: f64, bscale: f64, bzero: f64): f64 {
  return bzero + bscale * raw;
}

/**
 * Inverse FITS physical scaling: `raw = (physical - bzero) / bscale`.
 */
export function fitsPhysicalUnscale(physical: f64, bscale: f64, bzero: f64): f64 {
  if (bscale == 0.0) return physical - bzero;
  return (physical - bzero) / bscale;
}

/**
 * Computes native latitude `theta` (radians) from projection plane radius `rDeg` (degrees):
 * - projCode = 0: TAN (gnomonic)
 * - projCode = 1: SIN (orthographic)
 * - projCode = 2: ARC (zenithal equidistant)
 */
export function fitsWcsNativeTheta(projCode: i32, rDeg: f64): f64 {
  if (rDeg <= 0.0) return HALF_PI;
  if (projCode == 0) {
    return Math.atan2(RAD2DEG, rDeg);
  }
  if (projCode == 1) {
    let ratio = rDeg * DEG2RAD;
    if (ratio > 1.0) ratio = 1.0;
    return Math.acos(ratio);
  }
  return HALF_PI - rDeg * DEG2RAD;
}

/**
 * Computes instrumental magnitude `m = zeroPoint - 2.5 * log10(flux)`.
 */
export function fitsFluxToMag(flux: f64, zeroPoint: f64): f64 {
  if (flux <= 0.0) return 99.0;
  return zeroPoint - 2.5 * Math.log10(flux);
}

/**
 * Generic archetype evaluation hook (`fitsEval`).
 */
export function fitsEval(archetypeId: i32, x: f64, p0: f64, p1: f64): f64 {
  if (archetypeId == 4 || archetypeId == 5) {
    return fitsPhysicalScale(x, p0, p1);
  }
  if (archetypeId == 10 || archetypeId == 11) {
    return fitsWcsNativeTheta(0, x);
  }
  if (archetypeId == 12) {
    return fitsWcsNativeTheta(1, x);
  }
  if (archetypeId == 13) {
    return fitsWcsNativeTheta(2, x);
  }
  return fitsFluxToMag(x, p0);
}
