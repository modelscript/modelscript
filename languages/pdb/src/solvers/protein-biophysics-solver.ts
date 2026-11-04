// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Macromolecular Biophysics & Gaussian Network Model (GNM) Elastic Fluctuations Solver.
 *
 * Computes:
 * 1. Mass-weighted Center of Mass (R_CM), Molecular Weight [Da], and Radius of Gyration (R_g) [Å]
 * 2. Backbone Ramachandran (phi, psi, omega) dihedral angles and favored/outlier statistics
 * 3. C_alpha Contact Map & Kirchhoff Matrix (Gamma) for the Bahar-Atilgan Gaussian Network Model (GNM)
 * 4. Moore-Penrose pseudoinverse Gamma^+ via symmetric Jacobi eigendecomposition
 * 5. Mean-square thermal fluctuations <(Delta R_i)^2> and crystallographic B-factor correlation
 */

import { atomDistance, computeRamachandranAngles } from "../lints/pdb-linter.js";
import { parsePdb } from "../parser/pdb-parser.js";
import type { PdbAtom, PdbDocument, PdbStructure, ProteinBiophysicsResult, ResidueContact } from "../types.js";

export interface ProteinBiophysicsOptions {
  cutoffDistance?: number | undefined; // GNM contact cutoff r_c [Å] (default 7.0 Å)
  springConstant?: number | undefined; // Harmonic spring constant gamma [kcal/(mol·Å^2)] (default 1.0)
  temperature?: number | undefined; // Absolute temperature T [K] (default 300.0 K)
}

const ELEMENT_MASSES_DA: Readonly<Record<string, number>> = {
  H: 1.008,
  D: 2.014,
  C: 12.011,
  N: 14.007,
  O: 15.999,
  F: 18.998,
  NA: 22.99,
  MG: 24.305,
  P: 30.974,
  S: 32.06,
  CL: 35.45,
  K: 39.098,
  CA: 40.078,
  MN: 54.938,
  FE: 55.845,
  CO: 58.933,
  NI: 58.693,
  CU: 63.546,
  ZN: 65.38,
  SE: 78.971,
  BR: 79.904,
  I: 126.904,
};

export function getAtomMassDa(atom: PdbAtom): number {
  const elem = (atom.element || "C").trim().toUpperCase();
  return ELEMENT_MASSES_DA[elem] ?? 12.011;
}

/**
 * Computes the diagonal of the Moore-Penrose pseudoinverse Gamma^+ of a real symmetric N x N Kirchhoff matrix
 * using the classical Jacobi eigenvalue algorithm (discarding zero translational modes lambda_k <= 1e-8).
 */
export function computeKirchhoffPseudoinverseDiagonal(gammaMatrix: number[][]): number[] {
  const n = gammaMatrix.length;
  if (n === 0) return [];
  if (n === 1) return [0.0];

  // Copy A = gammaMatrix and initialize eigenvectors V = I_n
  const A: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => gammaMatrix[i]?.[j] ?? 0.0),
  );
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (__, j) => (i === j ? 1.0 : 0.0)),
  );

  const maxSweeps = 60;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let maxOffDiag = 0.0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const val = Math.abs(A[p]![q]!);
        if (val > maxOffDiag) maxOffDiag = val;
      }
    }
    if (maxOffDiag < 1e-11) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-13) continue;

        const app = A[p]![p]!;
        const aqq = A[q]![q]!;
        const tau = (aqq - app) / (2.0 * apq);
        const t = tau >= 0.0 ? 1.0 / (tau + Math.sqrt(1.0 + tau * tau)) : -1.0 / (-tau + Math.sqrt(1.0 + tau * tau));
        const c = 1.0 / Math.sqrt(1.0 + t * t);
        const s = t * c;

        A[p]![p] = app - t * apq;
        A[q]![q] = aqq + t * apq;
        A[p]![q] = 0.0;
        A[q]![p] = 0.0;

        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const arp = A[r]![p]!;
            const arq = A[r]![q]!;
            A[r]![p] = c * arp - s * arq;
            A[p]![r] = A[r]![p]!;
            A[r]![q] = s * arp + c * arq;
            A[q]![r] = A[r]![q]!;
          }
          const vrp = V[r]![p]!;
          const vrq = V[r]![q]!;
          V[r]![p] = c * vrp - s * vrq;
          V[r]![q] = s * vrp + c * vrq;
        }
      }
    }
  }

  const diagPinverse = new Array<number>(n).fill(0.0);
  for (let k = 0; k < n; k++) {
    const lambda = A[k]![k]!;
    if (lambda > 1e-8) {
      const invLambda = 1.0 / lambda;
      for (let i = 0; i < n; i++) {
        const uik = V[i]![k]!;
        diagPinverse[i] = (diagPinverse[i] ?? 0.0) + uik * uik * invLambda;
      }
    }
  }

  return diagPinverse;
}

function computePearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0.0;

  let sumX = 0.0;
  let sumY = 0.0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let cov = 0.0;
  let varX = 0.0;
  let varY = 0.0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  const denom = Math.sqrt(varX * varY);
  if (denom < 1e-12) return 0.0;
  return cov / denom;
}

/**
 * Extracts representative C_alpha atoms (one per standard residue, or fallback to first atom per residue).
 */
export function extractCaAtoms(structure: PdbStructure): PdbAtom[] {
  const caList: PdbAtom[] = [];
  for (const res of structure.residues) {
    if (res.isStandardAminoAcid) {
      const ca = res.atoms.find((a) => a.name === "CA") ?? res.atoms[0];
      if (ca) caList.push(ca);
    }
  }
  if (caList.length === 0) {
    for (const res of structure.residues) {
      const first = res.atoms.find((a) => a.name === "CA") ?? res.atoms[0];
      if (first) caList.push(first);
    }
  }
  return caList;
}

/**
 * Solves structural biophysics properties, radius of gyration R_g, Ramachandran angles,
 * and Gaussian Network Model (GNM) C_alpha harmonic elastic fluctuations.
 */
export function solveProteinBiophysics(
  input: PdbStructure | PdbDocument | string,
  options?: ProteinBiophysicsOptions,
): ProteinBiophysicsResult {
  const structure: PdbStructure = typeof input === "string" ? parsePdb(input) : input;
  const cutoffDistance = options?.cutoffDistance ?? 7.0;
  const springConstant = options?.springConstant ?? 1.0;
  const temperature = options?.temperature ?? 300.0;

  const model1Atoms = [...structure.atoms, ...structure.hetAtoms].filter((a) => (a.modelNum ?? 1) === 1);

  let totalMass = 0.0;
  let sumMx = 0.0;
  let sumMy = 0.0;
  let sumMz = 0.0;
  let heavyAtomCount = 0;

  for (const atom of model1Atoms) {
    const elem = (atom.element || "C").toUpperCase();
    if (elem !== "H" && elem !== "D") {
      heavyAtomCount++;
    }
    const m = getAtomMassDa(atom);
    totalMass += m;
    sumMx += m * atom.x;
    sumMy += m * atom.y;
    sumMz += m * atom.z;
  }

  const cmX = totalMass > 0.0 ? sumMx / totalMass : 0.0;
  const cmY = totalMass > 0.0 ? sumMy / totalMass : 0.0;
  const cmZ = totalMass > 0.0 ? sumMz / totalMass : 0.0;

  let weightedSqDist = 0.0;
  for (const atom of model1Atoms) {
    const m = getAtomMassDa(atom);
    const dx = atom.x - cmX;
    const dy = atom.y - cmY;
    const dz = atom.z - cmZ;
    weightedSqDist += m * (dx * dx + dy * dy + dz * dz);
  }
  const radiusOfGyration = totalMass > 0.0 ? Math.sqrt(weightedSqDist / totalMass) : 0.0;

  // Ramachandran analysis
  const ramachandran = computeRamachandranAngles(structure);
  let evaluatedCount = 0;
  let favoredCount = 0;
  let outlierCount = 0;
  for (const r of ramachandran) {
    if (r.phi !== null && r.psi !== null) {
      evaluatedCount++;
      if (r.region === "favored_alpha" || r.region === "favored_beta" || r.region === "glycine_proline") {
        favoredCount++;
      }
      if (r.isOutlier) {
        outlierCount++;
      }
    }
  }
  const ramachandranFavoredFraction = evaluatedCount > 0 ? favoredCount / evaluatedCount : 1.0;

  // Gaussian Network Model (GNM) on C_alpha atoms
  const caAtoms = extractCaAtoms(structure);
  const nCa = caAtoms.length;
  const endToEndDistance = nCa >= 2 ? atomDistance(caAtoms[0]!, caAtoms[nCa - 1]!) : 0.0;

  const contactMap: number[][] = Array.from({ length: nCa }, () => new Array<number>(nCa).fill(0));
  const kirchhoffMatrix: number[][] = Array.from({ length: nCa }, () => new Array<number>(nCa).fill(0.0));
  const contacts: ResidueContact[] = [];

  for (let i = 0; i < nCa; i++) {
    const atomI = caAtoms[i]!;
    for (let j = i + 1; j < nCa; j++) {
      const atomJ = caAtoms[j]!;
      const dist = atomDistance(atomI, atomJ);
      if (dist <= cutoffDistance) {
        contactMap[i]![j] = 1;
        contactMap[j]![i] = 1;
        kirchhoffMatrix[i]![j] = -1.0;
        kirchhoffMatrix[j]![i] = -1.0;
        kirchhoffMatrix[i]![i] = (kirchhoffMatrix[i]![i] ?? 0.0) + 1.0;
        kirchhoffMatrix[j]![j] = (kirchhoffMatrix[j]![j] ?? 0.0) + 1.0;
        contacts.push({
          indexI: i,
          indexJ: j,
          chainI: atomI.chainId,
          resSeqI: atomI.resSeq,
          resNameI: atomI.resName,
          chainJ: atomJ.chainId,
          resSeqJ: atomJ.resSeq,
          resNameJ: atomJ.resName,
          distance: dist,
        });
      }
    }
  }

  const contactNumbers = kirchhoffMatrix.map((row, idx) => row[idx] ?? 0.0);
  const gammaPinverseDiag = computeKirchhoffPseudoinverseDiagonal(kirchhoffMatrix);

  // k_B * T in kcal/mol (k_B = 0.0019872041 kcal/(mol·K))
  const kBT = 0.0019872041 * temperature;
  const fluctuationScale = (3.0 * kBT) / Math.max(1e-9, springConstant);
  const bFactorScale = (8.0 * Math.PI * Math.PI) / 3.0;

  const predictedFluctuations = gammaPinverseDiag.map((gii) => fluctuationScale * gii);
  const predictedBFactors = predictedFluctuations.map((msf) => bFactorScale * msf);
  const experimentalBFactors = caAtoms.map((a) => a.tempFactor);
  const bFactorCorrelation = computePearsonCorrelation(predictedBFactors, experimentalBFactors);

  return {
    structureId: structure.id,
    title: structure.title,
    atomCount: model1Atoms.length,
    heavyAtomCount,
    residueCount: structure.residues.length,
    chainCount: structure.chains.length,
    molecularWeightDa: totalMass,
    centerOfMass: [cmX, cmY, cmZ],
    radiusOfGyration,
    endToEndDistance,
    ramachandran,
    ramachandranFavoredFraction,
    ramachandranOutlierCount: outlierCount,
    cutoffDistance,
    springConstant,
    caAtoms,
    contactMap,
    contacts,
    kirchhoffMatrix,
    contactNumbers,
    predictedFluctuations,
    predictedBFactors,
    experimentalBFactors,
    bFactorCorrelation,
  };
}
