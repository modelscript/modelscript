// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript crystallography & Bragg diffraction runtime for `@modelscript/iucr-cif-std-lib`.
 *
 * Implements unit-cell metric tensor determinant, volume V = sqrt(det(G)),
 * cubic/general Bragg interplanar spacing d_hkl, and Cu-Kα diffraction angle 2θ
 * in zero-GC linear memory.
 */

const DEG2RAD: f64 = 0.017453292519943295;
const RAD2DEG: f64 = 57.29577951308232;

/**
 * Computes unit-cell metric tensor determinant det(G) in Å^6.
 */
export function metricDeterminant(
  a: f64,
  b: f64,
  c: f64,
  alphaDeg: f64,
  betaDeg: f64,
  gammaDeg: f64,
): f64 {
  const ca = Math.cos(alphaDeg * DEG2RAD);
  const cb = Math.cos(betaDeg * DEG2RAD);
  const cg = Math.cos(gammaDeg * DEG2RAD);
  const volFactor = 1.0 - ca * ca - cb * cb - cg * cg + 2.0 * ca * cb * cg;
  return a * a * b * b * c * c * volFactor;
}

/**
 * Computes unit-cell volume V = sqrt(det(G)) in Å^3.
 */
export function unitCellVolume(
  a: f64,
  b: f64,
  c: f64,
  alphaDeg: f64,
  betaDeg: f64,
  gammaDeg: f64,
): f64 {
  const detG = metricDeterminant(a, b, c, alphaDeg, betaDeg, gammaDeg);
  if (detG <= 0.0) return 0.0;
  return Math.sqrt(detG);
}

/**
 * Computes Bragg diffraction angle 2θ (degrees) from d_hkl (Å) and wavelength λ (Å).
 * Returns -1.0 if λ / (2d) >= 1.
 */
export function braggTwoTheta(dSpacing: f64, wavelength: f64): f64 {
  if (dSpacing <= 0.0 || wavelength <= 0.0) return -1.0;
  const sinTheta = wavelength / (2.0 * dSpacing);
  if (sinTheta <= 0.0 || sinTheta >= 1.0) return -1.0;
  return 2.0 * Math.asin(sinTheta) * RAD2DEG;
}

/**
 * Computes cubic interplanar spacing d_hkl = a / sqrt(h^2 + k^2 + l^2).
 */
export function cubicDSpacing(a: f64, h: i32, k: i32, l: i32): f64 {
  const s2 = <f64>(h * h + k * k + l * l);
  if (s2 <= 0.0 || a <= 0.0) return 0.0;
  return a / Math.sqrt(s2);
}
