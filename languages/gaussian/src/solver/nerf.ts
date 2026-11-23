// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Natural Extension Reference Frame (NeRF) Z-matrix <-> 3D Cartesian kinematics solver
 * and molecular geometry utilities.
 */

import { lookupElement } from "../elements.js";
import { resolveValueRef } from "../parser/gjf-parser.js";
import type {
  CartesianAtom,
  GaussianAtomSpec,
  GaussianJobStep,
  GaussianVariableEntry,
  MolecularBond,
  Vec3,
  ZMatrixEntry,
} from "../types.js";

const DEG_TO_RAD = Math.PI / 180.0;
const RAD_TO_DEG = 180.0 / Math.PI;

export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vecScale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

export function vecDot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function vecNorm(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function vecNormalize(v: Vec3): Vec3 {
  const n = vecNorm(v);
  if (n < 1e-15) return { x: 0, y: 0, z: 0 };
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/**
 * Euclidean distance between two 3D points (in Angstroms).
 */
export function bondDistance(a: Vec3, b: Vec3): number {
  return vecNorm(vecSub(a, b));
}

/**
 * Bond angle A-B-C in degrees, in `[0, 180]`.
 */
export function bondAngleDeg(a: Vec3, b: Vec3, c: Vec3): number {
  const u = vecNormalize(vecSub(a, b));
  const v = vecNormalize(vecSub(c, b));
  const cosTheta = Math.max(-1.0, Math.min(1.0, vecDot(u, v)));
  return Math.acos(cosTheta) * RAD_TO_DEG;
}

/**
 * Right-handed IUPAC dihedral (torsion) angle A-B-C-D in degrees, in `(-180, 180]`.
 */
export function dihedralAngleDeg(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
  const b1 = vecSub(b, a);
  const b2 = vecSub(c, b);
  const b3 = vecSub(d, c);
  const u2 = vecNormalize(b2);
  const n1 = vecCross(b1, b2);
  const n2 = vecCross(b2, b3);
  const sinPhi = vecDot(vecCross(n1, n2), u2);
  const cosPhi = vecDot(n1, n2);
  return Math.atan2(sinPhi, cosPhi) * RAD_TO_DEG;
}

/**
 * Checks whether three 3D points A, B, C are collinear within a sine threshold.
 */
export function areCollinear(a: Vec3, b: Vec3, c: Vec3, sinThreshold: number = 1e-4): boolean {
  const ab = vecSub(b, a);
  const bc = vecSub(c, b);
  const denom = vecNorm(ab) * vecNorm(bc);
  if (denom < 1e-12) return true;
  const sinAngle = vecNorm(vecCross(ab, bc)) / denom;
  return sinAngle < sinThreshold;
}

/**
 * Converts a Gaussian atom list (Z-matrix, Cartesian, or mixed) into 3D Cartesian
 * coordinates using the Natural Extension Reference Frame (NeRF) algorithm.
 */
export function zmatrixToCartesian(
  atoms: ReadonlyArray<GaussianAtomSpec>,
  variables: Map<string, GaussianVariableEntry> = new Map(),
  constants: Map<string, GaussianVariableEntry> = new Map(),
): CartesianAtom[] {
  const placed: CartesianAtom[] = [];

  for (let i = 0; i < atoms.length; i++) {
    const spec = atoms[i]!;
    const elData = lookupElement(spec.element);
    const mass = elData ? elData.atomicWeight : 0.0;
    const atomicNumber = elData ? elData.atomicNumber : spec.atomicNumber;
    const isDummy = elData ? Boolean(elData.isDummy) : spec.isDummy;

    if (spec.kind === "cartesian") {
      const x = resolveValueRef(spec.x, variables, constants) ?? 0.0;
      const y = resolveValueRef(spec.y, variables, constants) ?? 0.0;
      const z = resolveValueRef(spec.z, variables, constants) ?? 0.0;
      placed.push({
        index: spec.index,
        element: spec.element,
        atomicNumber,
        mass,
        x,
        y,
        z,
        isDummy,
      });
      continue;
    }

    // Z-matrix placement via NeRF
    if (i === 0 || spec.bondRef === undefined) {
      placed.push({
        index: spec.index,
        element: spec.element,
        atomicNumber,
        mass,
        x: 0.0,
        y: 0.0,
        z: 0.0,
        isDummy,
      });
      continue;
    }

    const r = resolveValueRef(spec.bondLength, variables, constants);
    if (r === undefined || r <= 0) {
      throw new Error(`Invalid or unresolved bond length at atom ${spec.index}`);
    }
    const atomC = placed[spec.bondRef - 1];
    if (!atomC) {
      throw new Error(`Invalid Z-matrix bond reference ${spec.bondRef} at atom ${spec.index}`);
    }

    // Atom 2: placed along +z from bondRef
    if (spec.angleRef === undefined) {
      placed.push({
        index: spec.index,
        element: spec.element,
        atomicNumber,
        mass,
        x: atomC.x,
        y: atomC.y,
        z: atomC.z + r,
        isDummy,
      });
      continue;
    }

    const thetaDeg = resolveValueRef(spec.bondAngle, variables, constants);
    if (thetaDeg === undefined) {
      throw new Error(`Unresolved bond angle at atom ${spec.index}`);
    }
    const atomB = placed[spec.angleRef - 1];
    if (!atomB) {
      throw new Error(`Invalid Z-matrix angle reference ${spec.angleRef} at atom ${spec.index}`);
    }

    const theta = thetaDeg * DEG_TO_RAD;
    const uBC = vecNormalize(vecSub(atomC, atomB));

    // Atom 3: placed in the xz-plane (or orthogonal reference plane)
    if (spec.dihedralRef === undefined) {
      const refAxis: Vec3 = Math.abs(uBC.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
      const dot = vecDot(refAxis, uBC);
      const m = vecNormalize(vecSub(refAxis, vecScale(uBC, dot)));
      const offset = vecAdd(vecScale(uBC, -r * Math.cos(theta)), vecScale(m, r * Math.sin(theta)));
      const pos = vecAdd(atomC, offset);
      placed.push({
        index: spec.index,
        element: spec.element,
        atomicNumber,
        mass,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        isDummy,
      });
      continue;
    }

    // Atom >= 4: Full Natural Extension Reference Frame (NeRF)
    const phiDeg = resolveValueRef(spec.dihedralAngle, variables, constants);
    if (phiDeg === undefined) {
      throw new Error(`Unresolved dihedral angle at atom ${spec.index}`);
    }
    const atomA = placed[spec.dihedralRef - 1];
    if (!atomA) {
      throw new Error(`Invalid Z-matrix dihedral reference ${spec.dihedralRef} at atom ${spec.index}`);
    }

    const ab = vecSub(atomB, atomA);
    const nRaw = vecCross(ab, uBC);
    const nNorm = vecNorm(nRaw);
    if (nNorm < 1e-10) {
      throw new Error(
        `Collinear Z-matrix reference atoms (${spec.dihedralRef}, ${spec.angleRef}, ${spec.bondRef}) at atom ${spec.index}`,
      );
    }

    const n = vecScale(nRaw, 1.0 / nNorm);
    const m = vecCross(n, uBC);
    const phi = phiDeg * DEG_TO_RAD;

    const offset = vecAdd(
      vecAdd(vecScale(uBC, -r * Math.cos(theta)), vecScale(m, r * Math.sin(theta) * Math.cos(phi))),
      vecScale(n, r * Math.sin(theta) * Math.sin(phi)),
    );
    const pos = vecAdd(atomC, offset);

    placed.push({
      index: spec.index,
      element: spec.element,
      atomicNumber,
      mass,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      isDummy,
    });
  }

  return placed;
}

/**
 * Convenience wrapper converting a parsed `GaussianJobStep` to 3D Cartesian coordinates.
 */
export function jobToCartesian(
  job: GaussianJobStep,
  options: { includeDummy?: boolean | undefined } = {},
): CartesianAtom[] {
  const all = zmatrixToCartesian(job.atoms, job.variables, job.constants);
  if (options.includeDummy === false) {
    return all.filter((a) => !a.isDummy);
  }
  return all;
}

/**
 * Inverse converter: converts 3D Cartesian coordinates into an internal Z-matrix.
 * Selects nearest bonded atom and non-collinear angle/dihedral references.
 */
export function cartesianToZMatrix(atoms: ReadonlyArray<CartesianAtom>): ZMatrixEntry[] {
  const entries: ZMatrixEntry[] = [];

  for (let i = 0; i < atoms.length; i++) {
    const cur = atoms[i]!;
    if (i === 0) {
      entries.push({ index: 1, element: cur.element });
      continue;
    }

    // Pick nearest preceding atom as bondRef
    let bondRefIdx = 0;
    let bestDist = Infinity;
    for (let j = 0; j < i; j++) {
      const d = bondDistance(cur, atoms[j]!);
      if (d < bestDist) {
        bestDist = d;
        bondRefIdx = j;
      }
    }

    if (i === 1) {
      entries.push({
        index: 2,
        element: cur.element,
        bondRef: bondRefIdx + 1,
        bondLength: bestDist,
      });
      continue;
    }

    // Pick angleRef: closest atom to bondRef (other than bondRef) that isn't collinear with cur & bondRef if possible
    let angleRefIdx = bondRefIdx === 0 ? 1 : 0;
    let bestAngleScore = Infinity;
    for (let j = 0; j < i; j++) {
      if (j === bondRefIdx) continue;
      const d = bondDistance(atoms[bondRefIdx]!, atoms[j]!);
      const collinearPenalty = areCollinear(cur, atoms[bondRefIdx]!, atoms[j]!) ? 1e6 : 0;
      const score = d + collinearPenalty;
      if (score < bestAngleScore) {
        bestAngleScore = score;
        angleRefIdx = j;
      }
    }

    const angle = bondAngleDeg(cur, atoms[bondRefIdx]!, atoms[angleRefIdx]!);

    if (i === 2) {
      entries.push({
        index: 3,
        element: cur.element,
        bondRef: bondRefIdx + 1,
        bondLength: bestDist,
        angleRef: angleRefIdx + 1,
        bondAngle: angle,
      });
      continue;
    }

    // Pick dihedralRef: preceding atom distinct from bondRef & angleRef and non-collinear with (angleRef, bondRef)
    let dihedralRefIdx = -1;
    let bestDihScore = Infinity;
    for (let j = 0; j < i; j++) {
      if (j === bondRefIdx || j === angleRefIdx) continue;
      const d = bondDistance(atoms[angleRefIdx]!, atoms[j]!);
      const collinearPenalty = areCollinear(atoms[j]!, atoms[angleRefIdx]!, atoms[bondRefIdx]!) ? 1e6 : 0;
      const score = d + collinearPenalty;
      if (score < bestDihScore) {
        bestDihScore = score;
        dihedralRefIdx = j;
      }
    }
    if (dihedralRefIdx === -1) dihedralRefIdx = 0;

    const dihedral = dihedralAngleDeg(atoms[dihedralRefIdx]!, atoms[angleRefIdx]!, atoms[bondRefIdx]!, cur);

    entries.push({
      index: i + 1,
      element: cur.element,
      bondRef: bondRefIdx + 1,
      bondLength: bestDist,
      angleRef: angleRefIdx + 1,
      bondAngle: angle,
      dihedralRef: dihedralRefIdx + 1,
      dihedralAngle: dihedral,
    });
  }

  return entries;
}

/**
 * Infers covalent bonds from 3D Cartesian coordinates using covalent radii sums.
 */
export function perceiveBonds(atoms: ReadonlyArray<CartesianAtom>, scaleFactor: number = 1.25): MolecularBond[] {
  const bonds: MolecularBond[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const ai = atoms[i]!;
    if (ai.isDummy) continue;
    const ri = lookupElement(ai.element)?.covalentRadius ?? 0.77;
    for (let j = i + 1; j < atoms.length; j++) {
      const aj = atoms[j]!;
      if (aj.isDummy) continue;
      const rj = lookupElement(aj.element)?.covalentRadius ?? 0.77;
      const d = bondDistance(ai, aj);
      const cutoff = scaleFactor * (ri + rj);
      if (d > 0.4 && d <= cutoff) {
        let order: 1 | 2 | 3 = 1;
        if (d < 0.82 * (ri + rj)) order = 3;
        else if (d < 0.91 * (ri + rj)) order = 2;
        bonds.push({
          atom1: ai.index,
          atom2: aj.index,
          distance: d,
          order,
        });
      }
    }
  }
  return bonds;
}
