// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Cleanroom AssemblyScript molecular mechanics runtime for `@modelscript/molfile-std-lib`.
 *
 * Implements UFF / harmonic bond-stretch force-field kernels in zero-GC WebAssembly:
 *   - `bondLength3D(x1, y1, z1, x2, y2, z2)` -> Euclidean distance r (Angstrom)
 *   - `uffEquilibriumLength(r1, r2, bondOrder)` -> r0 = r1 + r2 - 0.1332 * (r1 + r2) * ln(n)
 *   - `uffForceConstant(z1, z2, r0)` -> kb = 664.12 * z1 * z2 / r0^3 [kcal/(mol*A^2)]
 *   - `harmonicBondEnergy(r, r0, kb)` -> E = 0.5 * kb * (r - r0)^2 [kcal/mol]
 */

/**
 * Computes 3D Euclidean distance between two atomic positions.
 */
export function bondLength3D(x1: f64, y1: f64, z1: f64, x2: f64, y2: f64, z2: f64): f64 {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes Pauling/UFF bond-order-corrected equilibrium bond length r0 (Angstrom).
 */
export function uffEquilibriumLength(r1: f64, r2: f64, bondOrder: f64): f64 {
  const rSum = r1 + r2;
  const rBo = bondOrder > 1.0 ? -0.1332 * rSum * Math.log(bondOrder) : 0.0;
  const r0 = rSum + rBo;
  return r0 > 0.5 ? r0 : 0.5;
}

/**
 * Computes UFF harmonic bond-stretch force constant kb (kcal/(mol*A^2)).
 */
export function uffForceConstant(z1: f64, z2: f64, r0: f64): f64 {
  const safeR0 = r0 > 0.1 ? r0 : 0.1;
  return (664.12 * z1 * z2) / (safeR0 * safeR0 * safeR0);
}

/**
 * Computes harmonic bond-stretch potential energy E = 0.5 * kb * (r - r0)^2 (kcal/mol).
 */
export function harmonicBondEnergy(r: f64, r0: f64, kb: f64): f64 {
  const dr = r - r0;
  return 0.5 * kb * dr * dr;
}

/**
 * Returns the number of canonical molecule templates in the standard library.
 */
export function getCanonicalMoleculeCount(): i32 {
  return 5;
}
