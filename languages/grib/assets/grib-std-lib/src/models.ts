// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime kernel for `@modelscript/grib-std-lib`.
 *
 * Provides zero-GC WebAssembly numerical primitives for:
 * - WMO GRIB1 unpacking: Y = (R + X * 2^E) * 10^(-D)
 * - Hypsometric barometric thickness: DeltaZ = (R_d * T_mean / g_0) * ln(p1 / p2)
 * - Mid-latitude geostrophic wind magnitude: V_g = (g_0 / |f|) * |dZ/dn|
 */

const R_DRY_AIR: f64 = 287.058;
const G0: f64 = 9.80665;
const EARTH_OMEGA: f64 = 7.2921159e-5;
const DEG2RAD: f64 = 0.017453292519943295;

/**
 * Unpacks a single GRIB Edition 1 integer value X using reference value R,
 * binary scale factor E, and decimal scale factor D:
 * Y = (R + X * 2^E) * 10^(-D)
 */
export function gribUnpackValue(refVal: f64, packedX: f64, binaryScaleE: i32, decimalScaleD: i32): f64 {
  const scaled = refVal + packedX * Math.pow(2.0, <f64>binaryScaleE);
  return scaled * Math.pow(10.0, <f64>-decimalScaleD);
}

/**
 * Computes hypsometric geopotential layer thickness in meters between pressures pBottomPa and pTopPa.
 */
export function gribHypsometricThickness(meanTempK: f64, pBottomPa: f64, pTopPa: f64): f64 {
  if (pBottomPa <= 0.0 || pTopPa <= 0.0) return 0.0;
  return ((R_DRY_AIR * meanTempK) / G0) * Math.log(pBottomPa / pTopPa);
}

/**
 * Computes Coriolis parameter f = 2 * Omega * sin(latDeg).
 */
export function gribCoriolisF(latDeg: f64): f64 {
  return 2.0 * EARTH_OMEGA * Math.sin(latDeg * DEG2RAD);
}

/**
 * Computes geostrophic wind speed from geopotential height gradient dZ/dn (m/m) at latitude latDeg.
 */
export function gribGeostrophicWind(dZdn: f64, latDeg: f64): f64 {
  const f = Math.abs(gribCoriolisF(latDeg));
  if (f < 1e-9) return 0.0;
  return (G0 / f) * dZdn;
}

/**
 * Generic archetype evaluation hook (`gribEval`).
 */
export function gribEval(archetypeId: i32, x: f64, p0: f64, p1: f64): f64 {
  if (archetypeId == 7 || archetypeId == 100) {
    return gribHypsometricThickness(x, p0, p1);
  }
  if (archetypeId == 33 || archetypeId == 34) {
    return gribGeostrophicWind(x, p0);
  }
  return gribUnpackValue(p0, x, <i32>p1, 0);
}
