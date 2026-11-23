// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript GNSS/RINEX runtime for `@modelscript/rinex-std-lib`.
 *
 * Implements ICD-GPS-200 WGS-84 constants, Kepler's equation solver,
 * relativistic clock correction, and geometric pseudorange evaluation
 * in zero-GC WebAssembly linear memory.
 */

export const WGS84_MU: f64 = 3.986005e14;
export const WGS84_OMEGA_E_DOT: f64 = 7.2921151467e-5;
export const SPEED_OF_LIGHT: f64 = 299792458.0;
export const GPS_F_REL: f64 = -4.442807633e-10;

export const L1_FREQ_HZ: f64 = 1575.42e6;
export const L2_FREQ_HZ: f64 = 1227.60e6;

/**
 * Solves Kepler's equation E - e * sin(E) = M via Newton-Raphson iteration.
 */
export function solveKepler(meanAnomalyRad: f64, eccentricity: f64): f64 {
  let E: f64 = meanAnomalyRad;
  for (let i = 0; i < 20; i++) {
    const f = E - eccentricity * Math.sin(E) - meanAnomalyRad;
    const fp = 1.0 - eccentricity * Math.cos(E);
    const dE = -f / fp;
    E += dE;
    if (Math.abs(dE) < 1e-14) break;
  }
  return E;
}

/**
 * Computes GPS relativistic clock correction delta_t_r = F_rel * e * sqrtA * sin(E_k).
 */
export function relativisticClockCorrection(eccentricity: f64, sqrtA: f64, eccentricAnomalyRad: f64): f64 {
  return GPS_F_REL * eccentricity * sqrtA * Math.sin(eccentricAnomalyRad);
}

/**
 * Computes geometric range between satellite and receiver ECEF positions (meters).
 */
export function geometricRange(
  sx: f64,
  sy: f64,
  sz: f64,
  rx: f64,
  ry: f64,
  rz: f64,
): f64 {
  const dx = sx - rx;
  const dy = sy - ry;
  const dz = sz - rz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Evaluates a RINEX standard-library constant or observable wavelength by archetype ID.
 */
export function rinexModelEval(archetypeId: i32): f64 {
  if (archetypeId == 1 || archetypeId == 2 || archetypeId == 4) {
    return SPEED_OF_LIGHT / L1_FREQ_HZ;
  }
  if (archetypeId == 3 || archetypeId == 5) {
    return SPEED_OF_LIGHT / L2_FREQ_HZ;
  }
  if (archetypeId == 6) return L1_FREQ_HZ;
  if (archetypeId == 7) return 45.0;
  if (archetypeId == 20) return WGS84_MU;
  if (archetypeId == 21) return WGS84_OMEGA_E_DOT;
  if (archetypeId == 22) return SPEED_OF_LIGHT;
  if (archetypeId == 23) return GPS_F_REL;
  return 0.0;
}
