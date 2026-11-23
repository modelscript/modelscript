// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript radiative thermal runtime for `@modelscript/trasys-std-lib`.
 *
 * Implements zero-GC kernels for:
 *   - Exact Hottel coaxial parallel disk view factor
 *   - Exact Hottel aligned parallel rectangle view factor
 *   - Spacecraft radiative equilibrium temperature (K)
 *   - Surface primitive area evaluation
 */

const STEFAN_BOLTZMANN: f64 = 5.670374419e-8;
const PI: f64 = 3.141592653589793;

/**
 * Computes exact Hottel view factor between coaxial parallel disks (r1, r2, h).
 */
export function viewFactorCoaxialDisksWasm(r1: f64, r2: f64, h: f64): f64 {
  if (r1 <= 0.0 || r2 <= 0.0 || h <= 0.0) return 0.0;
  const R1 = r1 / h;
  const R2 = r2 / h;
  const S = 1.0 + (1.0 + R2 * R2) / (R1 * R1);
  const ratio = R2 / R1;
  const disc = S * S - 4.0 * ratio * ratio;
  const root = disc > 0.0 ? Math.sqrt(disc) : 0.0;
  return 0.5 * (S - root);
}

/**
 * Computes exact Hottel view factor between aligned parallel rectangles (a x b separated by c).
 */
export function viewFactorParallelRectanglesWasm(a: f64, b: f64, c: f64): f64 {
  if (a <= 0.0 || b <= 0.0 || c <= 0.0) return 0.0;
  const X = a / c;
  const Y = b / c;
  const sX = Math.sqrt(1.0 + X * X);
  const sY = Math.sqrt(1.0 + Y * Y);
  const t1 = Math.log(Math.sqrt(((1.0 + X * X) * (1.0 + Y * Y)) / (1.0 + X * X + Y * Y)));
  const t2 = X * sY * Math.atan(X / sY);
  const t3 = Y * sX * Math.atan(Y / sX);
  const t4 = -X * Math.atan(X) - Y * Math.atan(Y);
  return (2.0 / (PI * X * Y)) * (t1 + t2 + t3 + t4);
}

/**
 * Computes steady-state radiative equilibrium temperature T_eq (K) for absorbed heat Q (W),
 * emitting area A (m^2), and IR emissivity epsilon.
 */
export function radiativeEquilibriumTempK(qAbsorbedW: f64, areaM2: f64, epsilon: f64): f64 {
  if (qAbsorbedW <= 0.0 || areaM2 <= 0.0 || epsilon <= 0.0) return 2.725;
  const t4 = qAbsorbedW / (epsilon * STEFAN_BOLTZMANN * areaM2);
  return Math.pow(t4, 0.25);
}

/**
 * Evaluates surface area (m^2) by archetype ID (1=RECT, 2=DISK, 3=CYL, 4=CONE, 5=SPHERE, 6=PARAB).
 */
export function trasysEvalKernel(archetypeId: i32, d1: f64, d2: f64, d3: f64): f64 {
  if (archetypeId == 1) {
    return d1 * d2;
  } else if (archetypeId == 2) {
    return PI * (d1 * d1 - d2 * d2);
  } else if (archetypeId == 3) {
    return 2.0 * PI * d1 * d2;
  } else if (archetypeId == 4) {
    const dr = d1 - d2;
    return PI * (d1 + d2) * Math.sqrt(dr * dr + d3 * d3);
  } else if (archetypeId == 5) {
    return 4.0 * PI * d1 * d1;
  } else if (archetypeId == 6) {
    const f = d2 > 1e-9 ? d2 : 1.0;
    return ((8.0 * PI * f * f) / 3.0) * (Math.pow(1.0 + (d1 * d1) / (4.0 * f * f), 1.5) - 1.0);
  }
  return 0.0;
}
