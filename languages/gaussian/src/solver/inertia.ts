// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Center of mass, inertia tensor, principal moments of inertia (I_A, I_B, I_C),
 * and rotational constants (GHz & cm^-1) for molecular geometries.
 */

import type { CartesianAtom, InertiaTensorResult, MolecularRotorType, Vec3 } from "../types.js";

/**
 * Conversion factor from 1 / (amu * Å^2) to GHz:
 * h / (8 * pi^2 * amu * A^2) = 505.3790094 GHz * amu * A^2.
 */
const ROT_CONST_GHZ = 505.3790094;

/**
 * Conversion factor from 1 / (amu * Å^2) to cm^-1:
 * h / (8 * pi^2 * c * amu * A^2) = 16.8576292 cm^-1 * amu * A^2.
 */
const ROT_CONST_CM1 = 16.8576292;

/**
 * Exact Jacobi eigenvalue decomposition for a symmetric 3x3 matrix.
 * Returns eigenvalues and corresponding unit eigenvectors sorted ascending.
 */
function jacobiSymmetric3x3(mat: [[number, number, number], [number, number, number], [number, number, number]]): {
  values: [number, number, number];
  vectors: [Vec3, Vec3, Vec3];
} {
  const a: number[][] = [
    [mat[0][0], mat[0][1], mat[0][2]],
    [mat[1][0], mat[1][1], mat[1][2]],
    [mat[2][0], mat[2][1], mat[2][2]],
  ];
  const v: number[][] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iter = 0; iter < 50; iter++) {
    // Find largest off-diagonal element
    let p = 0;
    let q = 1;
    let maxOff = Math.abs(a[0]![1]!);
    if (Math.abs(a[0]![2]!) > maxOff) {
      p = 0;
      q = 2;
      maxOff = Math.abs(a[0]![2]!);
    }
    if (Math.abs(a[1]![2]!) > maxOff) {
      p = 1;
      q = 2;
      maxOff = Math.abs(a[1]![2]!);
    }
    if (maxOff < 1e-14) break;

    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const apq = a[p]![q]!;
    const tau = (aqq - app) / (2.0 * apq);
    const t = tau >= 0 ? 1.0 / (tau + Math.hypot(1.0, tau)) : -1.0 / (-tau + Math.hypot(1.0, tau));
    const c = 1.0 / Math.hypot(1.0, t);
    const s = t * c;

    a[p]![p] = app - t * apq;
    a[q]![q] = aqq + t * apq;
    a[p]![q] = 0.0;
    a[q]![p] = 0.0;

    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue;
      const arp = a[r]![p]!;
      const arq = a[r]![q]!;
      a[r]![p] = c * arp - s * arq;
      a[p]![r] = a[r]![p]!;
      a[r]![q] = s * arp + c * arq;
      a[q]![r] = a[r]![q]!;
    }

    for (let r = 0; r < 3; r++) {
      const vrp = v[r]![p]!;
      const vrq = v[r]![q]!;
      v[r]![p] = c * vrp - s * vrq;
      v[r]![q] = s * vrp + c * vrq;
    }
  }

  const pairs: Array<{ val: number; vec: Vec3 }> = [0, 1, 2].map((i) => ({
    val: Math.max(0.0, a[i]![i]!),
    vec: { x: v[0]![i]!, y: v[1]![i]!, z: v[2]![i]! },
  }));
  pairs.sort((x, y) => x.val - y.val);

  return {
    values: [pairs[0]!.val, pairs[1]!.val, pairs[2]!.val],
    vectors: [pairs[0]!.vec, pairs[1]!.vec, pairs[2]!.vec],
  };
}

function classifyRotor(ia: number, ib: number, ic: number): MolecularRotorType {
  if (ic < 1e-6) return "atom";
  const tol = 1e-3 * ic;
  if (ia < tol) return "linear";
  if (Math.abs(ic - ia) < tol) return "spherical_top";
  if (Math.abs(ib - ic) < tol) return "prolate_symmetric_top";
  if (Math.abs(ia - ib) < tol) return "oblate_symmetric_top";
  return "asymmetric_top";
}

/**
 * Computes center of mass, inertia tensor, principal moments of inertia
 * `[I_A, I_B, I_C]` (amu * Å^2), and rotational constants (GHz and cm^-1).
 */
export function computeMomentsOfInertia(atoms: ReadonlyArray<CartesianAtom>): InertiaTensorResult {
  const realAtoms = atoms.filter((a) => !a.isDummy && a.mass > 0);
  let totalMass = 0.0;
  let cx = 0.0;
  let cy = 0.0;
  let cz = 0.0;

  for (const a of realAtoms) {
    totalMass += a.mass;
    cx += a.mass * a.x;
    cy += a.mass * a.y;
    cz += a.mass * a.z;
  }

  const centerOfMass: Vec3 =
    totalMass > 0 ? { x: cx / totalMass, y: cy / totalMass, z: cz / totalMass } : { x: 0, y: 0, z: 0 };

  let ixx = 0.0;
  let iyy = 0.0;
  let izz = 0.0;
  let ixy = 0.0;
  let ixz = 0.0;
  let iyz = 0.0;

  for (const a of realAtoms) {
    const dx = a.x - centerOfMass.x;
    const dy = a.y - centerOfMass.y;
    const dz = a.z - centerOfMass.z;
    const m = a.mass;
    ixx += m * (dy * dy + dz * dz);
    iyy += m * (dx * dx + dz * dz);
    izz += m * (dx * dx + dy * dy);
    ixy -= m * dx * dy;
    ixz -= m * dx * dz;
    iyz -= m * dy * dz;
  }

  const inertiaTensor: [[number, number, number], [number, number, number], [number, number, number]] = [
    [ixx, ixy, ixz],
    [ixy, iyy, iyz],
    [ixz, iyz, izz],
  ];

  const { values, vectors } = jacobiSymmetric3x3(inertiaTensor);
  const [ia, ib, ic] = values;

  const toGHz = (moment: number): number => (moment > 1e-8 ? ROT_CONST_GHZ / moment : 0.0);
  const toCm1 = (moment: number): number => (moment > 1e-8 ? ROT_CONST_CM1 / moment : 0.0);

  return {
    centerOfMass,
    totalMass,
    inertiaTensor,
    principalMoments: [ia, ib, ic],
    principalAxes: vectors,
    rotationalConstantsGHz: [toGHz(ia), toGHz(ib), toGHz(ic)],
    rotationalConstantsCm1: [toCm1(ia), toCm1(ib), toCm1(ic)],
    rotorType: classifyRotor(ia, ib, ic),
  };
}
