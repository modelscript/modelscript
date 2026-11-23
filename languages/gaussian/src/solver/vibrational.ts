// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Harmonic vibrational normal-mode analysis via mass-weighted Hessian
 * diagonalization (Wilson GF method).
 */

import type { CartesianAtom, NormalModeEntry, NormalModeResult } from "../types.js";
import { computeMomentsOfInertia } from "./inertia.js";
import { bondAngleDeg, bondDistance, perceiveBonds, vecCross, vecDot, vecNorm, vecSub } from "./nerf.js";

/** Speed of light in cm/s. */
const C_CM_S = 2.99792458e10;
/** Conversion from eigenvalue in (mDyne/Å) / amu to wavenumber^2 (cm^-2):
 *  1 mDyne/Å = 100 N/m = 100 kg/s^2, 1 amu = 1.66053906660e-27 kg
 *  omega = sqrt(100 / 1.66053906660e-27) * sqrt(lambda)
 *  nu_cm1 = omega / (2 * pi * c_cm) = 1302.791 * sqrt(lambda)
 */
const FREQ_FACTOR_CM1 = 1302.791;
/** Zero-point energy conversion: 1 cm^-1 = 0.002859144 kcal/mol. */
const CM1_TO_KCAL_MOL = 0.002859144;
/** 1 Hartree = 627.509474 kcal/mol. */
const KCAL_MOL_PER_HARTREE = 627.509474;

/**
 * Symmetric Jacobi eigensolver for dense `n x n` real symmetric matrices.
 */
function jacobiSymmetricNxN(
  matrix: number[][],
  maxSweeps: number = 60,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = matrix.length;
  const a: number[][] = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1.0 : 0.0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxOff = 0.0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        const absApq = Math.abs(apq);
        if (absApq > maxOff) maxOff = absApq;
        if (absApq < 1e-13) continue;

        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const tau = (aqq - app) / (2.0 * apq);
        const t = tau >= 0 ? 1.0 / (tau + Math.hypot(1.0, tau)) : -1.0 / (-tau + Math.hypot(1.0, tau));
        const c = 1.0 / Math.hypot(1.0, t);
        const s = t * c;

        a[p]![p] = app - t * apq;
        a[q]![q] = aqq + t * apq;
        a[p]![q] = 0.0;
        a[q]![p] = 0.0;

        for (let r = 0; r < n; r++) {
          if (r === p || r === q) continue;
          const arp = a[r]![p]!;
          const arq = a[r]![q]!;
          a[r]![p] = c * arp - s * arq;
          a[p]![r] = a[r]![p]!;
          a[r]![q] = s * arp + c * arq;
          a[q]![r] = a[r]![q]!;
        }

        for (let r = 0; r < n; r++) {
          const vrp = v[r]![p]!;
          const vrq = v[r]![q]!;
          v[r]![p] = c * vrp - s * vrq;
          v[r]![q] = s * vrp + c * vrq;
        }
      }
    }
    if (maxOff < 1e-12) break;
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i]![i]! - a[j]![j]!);
  const eigenvalues = order.map((i) => a[i]![i]!);
  const eigenvectors = order.map((col) => Array.from({ length: n }, (_, row) => v[row]![col]!));
  return { eigenvalues, eigenvectors };
}

/**
 * Estimates a harmonic bond stretch force constant (in mDyne/Å) based on element pair and bond order.
 */
function estimateStretchForceConstant(el1: string, el2: string, order: 1 | 2 | 3): number {
  const pair = [el1, el2].sort().join("-");
  if (pair === "H-O") return 7.7;
  if (pair === "C-H") return 5.0;
  if (pair === "H-N") return 6.4;
  if (pair === "H-H") return 5.75;
  if (pair === "O-O") return order === 2 ? 11.4 : 4.2;
  if (pair === "C-O") return order === 3 ? 18.6 : order === 2 ? 12.1 : 5.0;
  if (pair === "C-C") return order === 3 ? 15.6 : order === 2 ? 9.6 : 4.5;
  return order === 3 ? 14.0 : order === 2 ? 9.0 : 4.5;
}

/**
 * Constructs an analytical Cartesian harmonic Hessian (in mDyne/Å) from perceived
 * covalent bond stretches and valence angle bends.
 */
export function buildHarmonicHessian(
  atoms: ReadonlyArray<CartesianAtom>,
  stretchScale: number = 1.0,
  bendForceConstant: number = 0.65,
): number[][] {
  const realAtoms = atoms.filter((a) => !a.isDummy && a.mass > 0);
  const n = realAtoms.length;
  const dim = 3 * n;
  const H: number[][] = Array.from({ length: dim }, () => Array<number>(dim).fill(0.0));

  const indexByAtomNumber = new Map<number, number>();
  realAtoms.forEach((a, idx) => indexByAtomNumber.set(a.index, idx));

  const bonds = perceiveBonds(realAtoms);
  const adjacency: number[][] = Array.from({ length: n }, () => []);

  // 1. Bond stretching contributions: V = 0.5 * k_r * (r - r0)^2 -> d^2V/dx_i dx_j = k_r * u_ij u_ij^T
  for (const bond of bonds) {
    const i = indexByAtomNumber.get(bond.atom1);
    const j = indexByAtomNumber.get(bond.atom2);
    if (i === undefined || j === undefined) continue;
    adjacency[i]!.push(j);
    adjacency[j]!.push(i);

    const ai = realAtoms[i]!;
    const aj = realAtoms[j]!;
    const dx = aj.x - ai.x;
    const dy = aj.y - ai.y;
    const dz = aj.z - ai.z;
    const r = Math.hypot(dx, dy, dz);
    if (r < 1e-8) continue;

    const u = [dx / r, dy / r, dz / r];
    const k = estimateStretchForceConstant(ai.element, aj.element, bond.order) * stretchScale;

    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        const val = k * u[a]! * u[b]!;
        H[3 * i + a]![3 * i + b]! += val;
        H[3 * j + a]![3 * j + b]! += val;
        H[3 * i + a]![3 * j + b]! -= val;
        H[3 * j + a]![3 * i + b]! -= val;
      }
    }
  }

  // 2. Valence angle bending contributions: V = 0.5 * k_theta * (theta - theta0)^2
  // Using Wilson B-vector for angle i-j-k (j is central atom): d^2V = k_theta * B^T B
  for (let j = 0; j < n; j++) {
    const nbrs = adjacency[j]!;
    const aj = realAtoms[j]!;
    for (let p = 0; p < nbrs.length; p++) {
      for (let q = p + 1; q < nbrs.length; q++) {
        const i = nbrs[p]!;
        const k = nbrs[q]!;
        const ai = realAtoms[i]!;
        const ak = realAtoms[k]!;

        const v1 = vecSub(ai, aj);
        const v2 = vecSub(ak, aj);
        const r1 = bondDistance(ai, aj);
        const r2 = bondDistance(ak, aj);
        if (r1 < 1e-8 || r2 < 1e-8) continue;

        const thetaDeg = bondAngleDeg(ai, aj, ak);
        if (thetaDeg < 1.0 || thetaDeg > 179.0) continue;

        const u1 = { x: v1.x / r1, y: v1.y / r1, z: v1.z / r1 };
        const u2 = { x: v2.x / r2, y: v2.y / r2, z: v2.z / r2 };
        const cosT = Math.max(-0.9999, Math.min(0.9999, vecDot(u1, u2)));
        const sinT = Math.sqrt(Math.max(1e-8, 1.0 - cosT * cosT));

        // B-vector components for i, k, and j = -(Bi + Bk)
        const bi = [
          (cosT * u1.x - u2.x) / (r1 * sinT),
          (cosT * u1.y - u2.y) / (r1 * sinT),
          (cosT * u1.z - u2.z) / (r1 * sinT),
        ];
        const bk = [
          (cosT * u2.x - u1.x) / (r2 * sinT),
          (cosT * u2.y - u1.y) / (r2 * sinT),
          (cosT * u2.z - u1.z) / (r2 * sinT),
        ];
        const bj = [-(bi[0]! + bk[0]!), -(bi[1]! + bk[1]!), -(bi[2]! + bk[2]!)];

        const entries: Array<[number, number[]]> = [
          [i, bi],
          [j, bj],
          [k, bk],
        ];
        // Ensure angular bending force constant in mDyne*Å/rad^2
        const kTheta = bendForceConstant;
        for (const [idxA, vecA] of entries) {
          for (const [idxB, vecB] of entries) {
            for (let a = 0; a < 3; a++) {
              for (let b = 0; b < 3; b++) {
                H[3 * idxA + a]![3 * idxB + b]! += kTheta * vecA[a]! * vecB[b]!;
              }
            }
          }
        }
      }
    }
  }

  // 3. Torsion stiffness for 4-atom chains (small positive force constant so dihedral modes are nonzero)
  for (const bond of bonds) {
    const bIdx = indexByAtomNumber.get(bond.atom1);
    const cIdx = indexByAtomNumber.get(bond.atom2);
    if (bIdx === undefined || cIdx === undefined) continue;
    const nbrsB = adjacency[bIdx]!.filter((x) => x !== cIdx);
    const nbrsC = adjacency[cIdx]!.filter((x) => x !== bIdx);
    if (nbrsB.length === 0 || nbrsC.length === 0) continue;

    const aIdx = nbrsB[0]!;
    const dIdx = nbrsC[0]!;
    const vBA = vecSub(realAtoms[aIdx]!, realAtoms[bIdx]!);
    const vBC = vecSub(realAtoms[cIdx]!, realAtoms[bIdx]!);
    const vCD = vecSub(realAtoms[dIdx]!, realAtoms[cIdx]!);
    const n1 = vecCross(vBA, vBC);
    const n2 = vecCross(vBC, vCD);
    const n1Len = vecNorm(n1);
    const n2Len = vecNorm(n2);
    if (n1Len < 1e-6 || n2Len < 1e-6) continue;

    const kTor = 0.08;
    const u1 = [n1.x / n1Len, n1.y / n1Len, n1.z / n1Len];
    const u2 = [n2.x / n2Len, n2.y / n2Len, n2.z / n2Len];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        H[3 * aIdx + a]![3 * aIdx + b]! += kTor * u1[a]! * u1[b]!;
        H[3 * dIdx + a]![3 * dIdx + b]! += kTor * u2[a]! * u2[b]!;
        H[3 * aIdx + a]![3 * dIdx + b]! -= kTor * u1[a]! * u2[b]!;
        H[3 * dIdx + a]![3 * aIdx + b]! -= kTor * u2[a]! * u1[b]!;
      }
    }
  }

  return H;
}

/**
 * Performs harmonic vibrational normal-mode analysis on a molecule.
 * If no custom Cartesian Hessian (in mDyne/Å) is provided, constructs a
 * molecular-mechanics harmonic Hessian from perceived bonds and angles.
 */
export function computeHarmonicNormalModes(
  atoms: ReadonlyArray<CartesianAtom>,
  customHessianMdyneA?: number[][],
): NormalModeResult {
  const realAtoms = atoms.filter((a) => !a.isDummy && a.mass > 0);
  const n = realAtoms.length;
  if (n < 2) {
    return {
      atomCount: n,
      isLinear: true,
      vibrationalModes: [],
      frequenciesCm1: [],
      zeroPointEnergyKcalMol: 0,
      zeroPointEnergyHartree: 0,
    };
  }

  const inertia = computeMomentsOfInertia(realAtoms);
  const isLinear = inertia.rotorType === "linear";
  const expectedVibModes = Math.max(0, 3 * n - (isLinear ? 5 : 6));
  const H = customHessianMdyneA ?? buildHarmonicHessian(realAtoms);
  const dim = 3 * n;

  // Mass-weight Hessian: H_mw[i][j] = H[i][j] / sqrt(m_i * m_j)
  const invSqrtMass: number[] = [];
  for (let i = 0; i < n; i++) {
    const isq = 1.0 / Math.sqrt(Math.max(1e-6, realAtoms[i]!.mass));
    invSqrtMass.push(isq, isq, isq);
  }

  const Hmw: number[][] = Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (_, j) => H[i]![j]! * invSqrtMass[i]! * invSqrtMass[j]!),
  );

  const { eigenvalues, eigenvectors } = jacobiSymmetricNxN(Hmw);

  // Take the top `expectedVibModes` eigenvalues (excluding the 5 or 6 zero trans/rot modes)
  const startIdx = Math.max(0, dim - expectedVibModes);
  const vibrationalModes: NormalModeEntry[] = [];
  let sumFreqCm1 = 0.0;

  for (let k = startIdx; k < dim; k++) {
    const lambda = eigenvalues[k]!;
    const rawVec = eigenvectors[k]!;

    // Convert mass-weighted eigenvector to Cartesian displacement to compute reduced mass
    let cartNormSq = 0.0;
    const cartVec: number[] = [];
    for (let i = 0; i < dim; i++) {
      const c = rawVec[i]! * invSqrtMass[i]!;
      cartVec.push(c);
      cartNormSq += c * c;
    }
    const reducedMassAmu = cartNormSq > 1e-12 ? 1.0 / cartNormSq : 1.0;
    const freqCm1 = lambda >= 0 ? FREQ_FACTOR_CM1 * Math.sqrt(lambda) : -FREQ_FACTOR_CM1 * Math.sqrt(-lambda);
    const angularFrequencyRadS = 2.0 * Math.PI * C_CM_S * Math.abs(freqCm1);
    const forceConstantMdyneA = lambda * reducedMassAmu;

    if (freqCm1 > 0) sumFreqCm1 += freqCm1;

    vibrationalModes.push({
      modeIndex: vibrationalModes.length + 1,
      frequencyCm1: freqCm1,
      angularFrequencyRadS,
      reducedMassAmu,
      forceConstantMdyneA,
      displacementVector: cartVec,
    });
  }

  const zeroPointEnergyKcalMol = 0.5 * sumFreqCm1 * CM1_TO_KCAL_MOL;
  const zeroPointEnergyHartree = zeroPointEnergyKcalMol / KCAL_MOL_PER_HARTREE;

  return {
    atomCount: n,
    isLinear,
    vibrationalModes,
    frequenciesCm1: vibrationalModes.map((m) => m.frequencyCm1),
    zeroPointEnergyKcalMol,
    zeroPointEnergyHartree,
  };
}
