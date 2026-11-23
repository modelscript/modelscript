// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript runtime kernel for `@modelscript/netcdf-std-lib`.
 *
 * Provides zero-GC WebAssembly numerical primitives for:
 * - CF-1.x linear packing / unpacking (`raw * scale_factor + add_offset`)
 * - 2D rectilinear bilinear interpolation
 * - Atmospheric potential temperature (`theta = T * (P0 / P)^(R/cp)`)
 * - Wind vector magnitude (`hypot(u, v)`)
 */

const R_OVER_CP: f64 = 0.2857142857142857; // 2/7 for dry diatomic air
const P0_REF: f64 = 100000.0; // 1000 hPa in Pa

/**
 * Unpacks a packed NetCDF numeric value: `physical = raw * scaleFactor + addOffset`.
 */
export function ncUnpackValue(raw: f64, scaleFactor: f64, addOffset: f64): f64 {
  return raw * scaleFactor + addOffset;
}

/**
 * Packs a physical value into storage units: `raw = (physical - addOffset) / scaleFactor`.
 */
export function ncPackValue(physical: f64, scaleFactor: f64, addOffset: f64): f64 {
  if (scaleFactor == 0.0) return physical - addOffset;
  return (physical - addOffset) / scaleFactor;
}

/**
 * Evaluates 2D bilinear interpolation on the unit square `[0,1] x [0,1]`.
 */
export function ncBilinear2D(q00: f64, q10: f64, q01: f64, q11: f64, tx: f64, ty: f64): f64 {
  const omx = 1.0 - tx;
  const omy = 1.0 - ty;
  return omx * omy * q00 + tx * omy * q10 + omx * ty * q01 + tx * ty * q11;
}

/**
 * Computes atmospheric potential temperature `theta = T * (P0 / P)^(R/cp)`.
 */
export function ncPotentialTemp(tempK: f64, pressurePa: f64): f64 {
  if (pressurePa <= 0.0) return tempK;
  return tempK * Math.pow(P0_REF / pressurePa, R_OVER_CP);
}

/**
 * Computes horizontal wind speed magnitude `sqrt(u^2 + v^2)`.
 */
export function ncWindSpeed(u: f64, v: f64): f64 {
  return Math.sqrt(u * u + v * v);
}

/**
 * Generic archetype evaluation hook (`ncEval`).
 */
export function ncEval(archetypeId: i32, x: f64, p0: f64, p1: f64): f64 {
  if (archetypeId == 1) {
    return ncPotentialTemp(x, p0 > 0.0 ? p0 : P0_REF);
  }
  if (archetypeId == 3 || archetypeId == 4) {
    return ncWindSpeed(x, p0);
  }
  return ncUnpackValue(x, p0 != 0.0 ? p0 : 1.0, p1);
}
