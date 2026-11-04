// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/smiles — Cheminformatics Topological & Joback-Reid Group-Contribution Property Estimator.
 *
 * Computes:
 * - Exact Hill molecular formula, IUPAC molecular weight, monoisotopic exact mass
 * - Implicit hydrogen counts, connected components, and Euler characteristic ring count (R = E - V + C)
 * - Lipinski H-bond donors/acceptors, rotatable bonds, Ertl TPSA, and Wildman-Crippen logP
 * - Joback & Reid (1987) group-contribution critical properties (Tb, Tc, Pc, Vc),
 *   Lee-Kesler acentric factor (omega), standard enthalpy/Gibbs energy of formation,
 *   ideal-gas Cp(T) polynomial coefficients, and Antoine vapor-pressure coefficients.
 */

import { findChordlessCycles } from "../lints/smiles-linter.js";
import { ELEMENT_BY_SYMBOL, parseSmiles, parseSmilesDocument } from "../parser/smiles-parser.js";
import type { MolecularGraph, MoleculeBond, SmilesDocument, ThermophysicalEstimate } from "../types.js";

interface JobackGroupEntry {
  dTb: number;
  dTc: number;
  dPc: number;
  dVc: number;
  dHf: number;
  dGf: number;
  da: number;
  db: number;
  dc: number;
  dd: number;
}

const JOBACK_GROUPS: Record<string, JobackGroupEntry> = {
  // Non-ring hydrocarbon increments
  "-CH3": {
    dTb: 23.58,
    dTc: 0.0141,
    dPc: -0.0012,
    dVc: 65,
    dHf: -76.45,
    dGf: -43.96,
    da: 19.5,
    db: -0.00808,
    dc: 1.53e-4,
    dd: -9.67e-8,
  },
  "-CH2-": {
    dTb: 22.88,
    dTc: 0.0189,
    dPc: 0.0,
    dVc: 56,
    dHf: -20.64,
    dGf: 8.42,
    da: -0.909,
    db: 0.095,
    dc: -5.44e-5,
    dd: 1.19e-8,
  },
  ">CH-": {
    dTb: 21.74,
    dTc: 0.0164,
    dPc: 0.002,
    dVc: 41,
    dHf: 29.89,
    dGf: 58.36,
    da: -23.0,
    db: 0.204,
    dc: -2.65e-4,
    dd: 1.2e-7,
  },
  ">C<": {
    dTb: 18.25,
    dTc: 0.0067,
    dPc: 0.0043,
    dVc: 27,
    dHf: 82.23,
    dGf: 116.02,
    da: -66.2,
    db: 0.427,
    dc: -6.41e-4,
    dd: 3.01e-7,
  },
  "=CH2": {
    dTb: 18.18,
    dTc: 0.0113,
    dPc: -0.0028,
    dVc: 56,
    dHf: -9.63,
    dGf: 3.77,
    da: 23.6,
    db: -0.0381,
    dc: 1.72e-4,
    dd: -1.03e-7,
  },
  "=CH-": {
    dTb: 24.96,
    dTc: 0.0129,
    dPc: -0.0006,
    dVc: 46,
    dHf: 37.97,
    dGf: 48.53,
    da: -8.0,
    db: 0.105,
    dc: -9.63e-5,
    dd: 3.56e-8,
  },
  "=C<": {
    dTb: 24.14,
    dTc: 0.0117,
    dPc: 0.0011,
    dVc: 38,
    dHf: 83.99,
    dGf: 92.36,
    da: -28.1,
    db: 0.208,
    dc: -3.06e-4,
    dd: 1.46e-7,
  },
  "=C=": {
    dTb: 26.15,
    dTc: 0.0026,
    dPc: -0.0028,
    dVc: 36,
    dHf: 142.14,
    dGf: 136.7,
    da: 27.4,
    db: -0.0557,
    dc: 1.01e-4,
    dd: -5.02e-8,
  },
  "#CH": {
    dTb: 9.2,
    dTc: 0.0027,
    dPc: -0.0008,
    dVc: 46,
    dHf: 79.3,
    dGf: 77.71,
    da: 24.5,
    db: -0.0271,
    dc: 1.11e-4,
    dd: -6.78e-8,
  },
  "#C-": {
    dTb: 27.38,
    dTc: 0.002,
    dPc: 0.0046,
    dVc: 37,
    dHf: 115.51,
    dGf: 109.82,
    da: 7.87,
    db: 0.0201,
    dc: -8.33e-6,
    dd: 1.39e-9,
  },

  // Ring hydrocarbon increments
  "ring -CH2-": {
    dTb: 27.15,
    dTc: 0.01,
    dPc: 0.0025,
    dVc: 48,
    dHf: -26.8,
    dGf: -3.68,
    da: -6.03,
    db: 0.0854,
    dc: -8.0e-6,
    dd: -1.8e-8,
  },
  "ring >CH-": {
    dTb: 21.78,
    dTc: 0.0122,
    dPc: 0.0004,
    dVc: 38,
    dHf: 8.67,
    dGf: 40.99,
    da: -20.5,
    db: 0.162,
    dc: -1.6e-4,
    dd: 6.24e-8,
  },
  "ring >C<": {
    dTb: 21.32,
    dTc: 0.0042,
    dPc: 0.0061,
    dVc: 27,
    dHf: 79.72,
    dGf: 87.88,
    da: -90.9,
    db: 0.557,
    dc: -9.0e-4,
    dd: 4.69e-7,
  },
  "ring =CH-": {
    dTb: 26.73,
    dTc: 0.0082,
    dPc: 0.0011,
    dVc: 41,
    dHf: 2.09,
    dGf: 11.3,
    da: -2.14,
    db: 0.0574,
    dc: -1.64e-6,
    dd: -1.59e-8,
  },
  "ring =C<": {
    dTb: 31.01,
    dTc: 0.0143,
    dPc: 0.0008,
    dVc: 32,
    dHf: 46.43,
    dGf: 54.05,
    da: -8.25,
    db: 0.101,
    dc: -1.42e-4,
    dd: 6.78e-8,
  },

  // Oxygen increments
  "-OH (alcohol)": {
    dTb: 92.88,
    dTc: 0.0741,
    dPc: -0.0112,
    dVc: 28,
    dHf: -208.04,
    dGf: -189.2,
    da: 25.7,
    db: -0.0691,
    dc: 1.77e-4,
    dd: -9.88e-8,
  },
  "-OH (phenol)": {
    dTb: 76.34,
    dTc: 0.024,
    dPc: -0.0184,
    dVc: -25,
    dHf: -221.65,
    dGf: -197.37,
    da: -2.81,
    db: 0.111,
    dc: -1.16e-4,
    dd: 4.94e-8,
  },
  "-O- (non-ring)": {
    dTb: 22.42,
    dTc: 0.0168,
    dPc: 0.0015,
    dVc: 18,
    dHf: -132.22,
    dGf: -105.0,
    da: 25.5,
    db: -0.0632,
    dc: 1.11e-4,
    dd: -5.48e-8,
  },
  "ring -O-": {
    dTb: 31.22,
    dTc: 0.0098,
    dPc: 0.0048,
    dVc: 13,
    dHf: -138.16,
    dGf: -98.22,
    da: 12.2,
    db: -0.0126,
    dc: 6.03e-5,
    dd: -3.86e-8,
  },
  ">C=O (non-ring)": {
    dTb: 76.75,
    dTc: 0.038,
    dPc: 0.0031,
    dVc: 62,
    dHf: -133.22,
    dGf: -120.5,
    da: 6.45,
    db: 0.067,
    dc: -3.57e-5,
    dd: 2.86e-9,
  },
  "ring >C=O": {
    dTb: 94.97,
    dTc: 0.0284,
    dPc: 0.0028,
    dVc: 55,
    dHf: -164.5,
    dGf: -126.27,
    da: 30.4,
    db: -0.0829,
    dc: 2.36e-4,
    dd: -1.31e-7,
  },
  "-CH=O (aldehyde)": {
    dTb: 72.24,
    dTc: 0.0379,
    dPc: 0.003,
    dVc: 82,
    dHf: -162.03,
    dGf: -143.48,
    da: 30.9,
    db: -0.0336,
    dc: 1.6e-4,
    dd: -9.88e-8,
  },
  "-COOH (acid)": {
    dTb: 169.09,
    dTc: 0.0791,
    dPc: 0.0077,
    dVc: 89,
    dHf: -426.72,
    dGf: -387.87,
    da: 24.1,
    db: 0.0427,
    dc: 8.04e-5,
    dd: -6.87e-8,
  },
  "-COO- (ester)": {
    dTb: 81.1,
    dTc: 0.0481,
    dPc: 0.0005,
    dVc: 82,
    dHf: -337.92,
    dGf: -301.95,
    da: 24.5,
    db: 0.0402,
    dc: 4.02e-5,
    dd: -4.52e-8,
  },
  "=O (other)": {
    dTb: -10.5,
    dTc: 0.0143,
    dPc: 0.0101,
    dVc: 36,
    dHf: -247.61,
    dGf: -250.83,
    da: 6.82,
    db: 0.0196,
    dc: 1.27e-5,
    dd: -1.78e-8,
  },

  // Nitrogen increments
  "-NH2": {
    dTb: 73.23,
    dTc: 0.0243,
    dPc: -0.0109,
    dVc: 38,
    dHf: -22.02,
    dGf: 14.07,
    da: 26.9,
    db: -0.0412,
    dc: 1.64e-4,
    dd: -9.76e-8,
  },
  ">NH (non-ring)": {
    dTb: 50.17,
    dTc: 0.0295,
    dPc: 0.0077,
    dVc: 35,
    dHf: 53.47,
    dGf: 89.39,
    da: -1.21,
    db: 0.0762,
    dc: -4.86e-5,
    dd: 1.05e-8,
  },
  "ring >NH": {
    dTb: 52.82,
    dTc: 0.013,
    dPc: 0.0114,
    dVc: 29,
    dHf: 31.65,
    dGf: 75.61,
    da: 11.8,
    db: -0.023,
    dc: 1.07e-4,
    dd: -6.28e-8,
  },
  ">N- (non-ring)": {
    dTb: 11.74,
    dTc: 0.0169,
    dPc: 0.0074,
    dVc: 9,
    dHf: 123.34,
    dGf: 163.16,
    da: -31.1,
    db: 0.227,
    dc: -3.2e-4,
    dd: 1.46e-7,
  },
  "ring -N=": {
    dTb: 57.55,
    dTc: 0.0085,
    dPc: 0.0076,
    dVc: 34,
    dHf: 55.52,
    dGf: 79.93,
    da: 8.83,
    db: -0.00384,
    dc: 4.35e-5,
    dd: -2.6e-8,
  },
  "-CN": {
    dTb: 125.66,
    dTc: 0.0496,
    dPc: -0.0101,
    dVc: 91,
    dHf: 88.43,
    dGf: 89.22,
    da: 36.5,
    db: -0.0733,
    dc: 1.84e-4,
    dd: -1.03e-7,
  },
  "-NO2": {
    dTb: 152.54,
    dTc: 0.0437,
    dPc: 0.0064,
    dVc: 91,
    dHf: -66.57,
    dGf: -16.83,
    da: 25.9,
    db: -0.00374,
    dc: 1.29e-4,
    dd: -8.88e-8,
  },

  // Halogen & Sulfur increments
  "-F": {
    dTb: -0.03,
    dTc: 0.0111,
    dPc: -0.0057,
    dVc: 27,
    dHf: -251.92,
    dGf: -247.19,
    da: 26.5,
    db: -0.0913,
    dc: 1.91e-4,
    dd: -1.03e-7,
  },
  "-Cl": {
    dTb: 38.13,
    dTc: 0.0105,
    dPc: -0.0049,
    dVc: 58,
    dHf: -71.55,
    dGf: -64.31,
    da: 33.3,
    db: -0.0963,
    dc: 1.87e-4,
    dd: -9.96e-8,
  },
  "-Br": {
    dTb: 66.86,
    dTc: 0.0133,
    dPc: 0.0057,
    dVc: 71,
    dHf: -29.48,
    dGf: -38.06,
    da: 28.6,
    db: -0.0649,
    dc: 1.36e-4,
    dd: -7.45e-8,
  },
  "-I": {
    dTb: 93.84,
    dTc: 0.0068,
    dPc: -0.0034,
    dVc: 97,
    dHf: 21.06,
    dGf: 5.74,
    da: 32.1,
    db: -0.0641,
    dc: 1.26e-4,
    dd: -6.87e-8,
  },
  "-SH": {
    dTb: 63.56,
    dTc: 0.0031,
    dPc: 0.0084,
    dVc: 63,
    dHf: -17.33,
    dGf: -22.99,
    da: 35.3,
    db: -0.0758,
    dc: 1.85e-4,
    dd: -1.03e-7,
  },
  "-S- (non-ring)": {
    dTb: 68.78,
    dTc: 0.0119,
    dPc: 0.0049,
    dVc: 54,
    dHf: 41.87,
    dGf: 33.12,
    da: 19.6,
    db: -0.00561,
    dc: 4.02e-5,
    dd: -2.76e-8,
  },
  "ring -S-": {
    dTb: 52.1,
    dTc: 0.0019,
    dPc: 0.0051,
    dVc: 38,
    dHf: 39.1,
    dGf: 27.76,
    da: 16.7,
    db: 0.00481,
    dc: 2.77e-5,
    dd: -2.11e-8,
  },
};

export interface MolecularPropertySolution {
  molecules: ThermophysicalEstimate[];
  primary: ThermophysicalEstimate;
}

/**
 * Estimates molecular formula, molar mass, topological descriptors (R = E - V + C, TPSA, logP),
 * and Joback & Reid thermophysical properties for a single `MolecularGraph`.
 */
export function estimateThermophysicalProperties(mol: MolecularGraph): ThermophysicalEstimate {
  const elementCounts = new Map<string, number>();
  let molecularWeight = 0;
  let exactMass = 0;
  let heavyAtomCount = 0;
  let implicitHydrogenCount = 0;

  const hInfo = ELEMENT_BY_SYMBOL.get("H")!;

  for (const atom of mol.atoms) {
    const elInfo = ELEMENT_BY_SYMBOL.get(atom.element);
    if (atom.element === "H") {
      elementCounts.set("H", (elementCounts.get("H") ?? 0) + 1);
      const isoMass = atom.isotope !== undefined ? atom.isotope : hInfo.atomicWeight;
      molecularWeight += isoMass;
      exactMass += atom.isotope !== undefined ? atom.isotope : hInfo.monoisotopicMass;
      continue;
    }

    heavyAtomCount++;
    elementCounts.set(atom.element, (elementCounts.get(atom.element) ?? 0) + 1);

    const baseWeight = atom.isotope !== undefined ? atom.isotope : (elInfo?.atomicWeight ?? 12.011);
    const baseExact = atom.isotope !== undefined ? atom.isotope : (elInfo?.monoisotopicMass ?? 12.0);
    molecularWeight += baseWeight;
    exactMass += baseExact;

    const totalH = (atom.explicitHydrogens ?? 0) + atom.implicitHydrogens;
    implicitHydrogenCount += atom.implicitHydrogens;
    if (totalH > 0) {
      elementCounts.set("H", (elementCounts.get("H") ?? 0) + totalH);
      molecularWeight += totalH * hInfo.atomicWeight;
      exactMass += totalH * hInfo.monoisotopicMass;
    }
  }

  // Hill System Formula: C first, then H (if C present), then remaining elements alphabetically
  const formula = formatHillFormula(elementCounts);

  const totalAtomCount = Array.from(elementCounts.values()).reduce((acc, v) => acc + v, 0);

  // Build adjacency and unique bond edges for Euler characteristic R = E - V + C
  const adj = new Map<number, number[]>();
  const adjBonds = new Map<number, MoleculeBond[]>();
  for (const atom of mol.atoms) {
    adj.set(atom.index, []);
    adjBonds.set(atom.index, []);
  }

  const uniqueEdgeKeys = new Set<string>();
  for (const bond of mol.bonds) {
    if (bond.source === bond.target) continue;
    const u = Math.min(bond.source, bond.target);
    const v = Math.max(bond.source, bond.target);
    const edgeKey = `${u}:${v}`;
    if (!uniqueEdgeKeys.has(edgeKey)) {
      uniqueEdgeKeys.add(edgeKey);
      adj.get(bond.source)?.push(bond.target);
      adj.get(bond.target)?.push(bond.source);
      adjBonds.get(bond.source)?.push(bond);
      adjBonds.get(bond.target)?.push(bond);
    }
  }

  // Connected components C via BFS
  let connectedComponents = 0;
  const visited = new Set<number>();
  for (const atom of mol.atoms) {
    if (!visited.has(atom.index)) {
      connectedComponents++;
      const queue: number[] = [atom.index];
      visited.add(atom.index);
      let head = 0;
      while (head < queue.length) {
        const curr = queue[head++]!;
        for (const nxt of adj.get(curr) ?? []) {
          if (!visited.has(nxt)) {
            visited.add(nxt);
            queue.push(nxt);
          }
        }
      }
    }
  }

  const V = mol.atoms.length;
  const E = uniqueEdgeKeys.size;
  const ringCount = V > 0 ? Math.max(0, E - V + connectedComponents) : 0;

  // Identify all ring atoms via chordless cycles
  const allVertices = new Set<number>(mol.atoms.map((a) => a.index));
  const elementaryRings = findChordlessCycles(allVertices, adj);
  const ringAtoms = new Set<number>();
  let aromaticRingCount = 0;
  for (const r of elementaryRings) {
    let allArom = true;
    for (const idx of r) {
      ringAtoms.add(idx);
      if (!mol.atoms[idx]?.isAromatic) allArom = false;
    }
    if (allArom) aromaticRingCount++;
  }

  // H-bond donors, H-bond acceptors, rotatable bonds, TPSA (Ertl), and logP (Wildman-Crippen)
  let hBondDonors = 0;
  let hBondAcceptors = 0;
  let rotatableBonds = 0;
  let tpsa = 0;
  let logP = 0;

  for (const bond of mol.bonds) {
    if (bond.source === bond.target) continue;
    if (bond.order === 1 && !bond.isAromatic) {
      const a1 = mol.atoms[bond.source];
      const a2 = mol.atoms[bond.target];
      if (!a1 || !a2 || a1.element === "H" || a2.element === "H") continue;
      // Check if bond is in a ring
      const bothInSameRing = elementaryRings.some((r) => r.includes(bond.source) && r.includes(bond.target));
      const deg1 = (adj.get(bond.source) ?? []).filter((nIdx) => mol.atoms[nIdx]?.element !== "H").length;
      const deg2 = (adj.get(bond.target) ?? []).filter((nIdx) => mol.atoms[nIdx]?.element !== "H").length;
      if (!bothInSameRing && deg1 > 1 && deg2 > 1) {
        rotatableBonds++;
      }
    }
  }

  for (const atom of mol.atoms) {
    if (atom.element === "H") continue;
    const totalH = (atom.explicitHydrogens ?? 0) + atom.implicitHydrogens;
    const incident = adjBonds.get(atom.index) ?? [];

    // H-bond donors & acceptors (Lipinski)
    if (atom.element === "N" || atom.element === "O") {
      hBondAcceptors++;
      if (totalH > 0) {
        hBondDonors++;
      }
    }

    // Ertl TPSA contributions
    if (atom.element === "O") {
      if (atom.formalCharge < 0) {
        tpsa += 23.06;
      } else if (atom.isAromatic) {
        tpsa += 13.14;
      } else if (totalH >= 1) {
        tpsa += 20.23; // -OH
      } else if (incident.some((b) => b.order === 2)) {
        tpsa += 17.07; // =O
      } else {
        tpsa += 9.23; // -O- ether/ester
      }
    } else if (atom.element === "N") {
      if (atom.isAromatic) {
        if (totalH >= 1) {
          tpsa += 15.79; // [nH] pyrrole
        } else if (incident.length >= 3) {
          tpsa += 4.93; // tertiary aromatic n(R)
        } else {
          tpsa += 12.89; // pyridine n
        }
      } else if (incident.some((b) => b.order === 3)) {
        tpsa += 23.79; // #N nitrile
      } else if (incident.some((b) => b.order === 2)) {
        tpsa += 12.36; // =N-
      } else if (totalH >= 2) {
        tpsa += 26.02; // -NH2
      } else if (totalH === 1) {
        tpsa += 12.03; // >NH
      } else {
        tpsa += 3.24; // >N-
      }
    }

    // Wildman-Crippen logP atom/hydrogen contributions
    const hasHeteroNeighbor = incident.some((b) => {
      const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
      return nb !== undefined && nb.element !== "C" && nb.element !== "H";
    });
    const hasDoubleO = incident.some((b) => {
      const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
      return b.order === 2 && nb?.element === "O";
    });

    if (atom.element === "C") {
      if (hasDoubleO) {
        logP += -0.548 + totalH * 0.123;
      } else if (atom.isAromatic) {
        logP += (hasHeteroNeighbor ? 0.112 : 0.1581) + totalH * 0.123;
      } else {
        logP += (hasHeteroNeighbor ? -0.2035 : 0.1441) + totalH * 0.123;
      }
    } else if (atom.element === "O") {
      if (totalH >= 1) {
        logP += -0.2893 - 0.2677 * totalH;
      } else if (incident.some((b) => b.order === 2)) {
        logP += 0.1788;
      } else {
        logP += -0.0462;
      }
    } else if (atom.element === "N") {
      if (atom.isAromatic) {
        logP += -0.3239 - 0.2145 * totalH;
      } else {
        logP += -0.5262 - 0.2145 * totalH;
      }
    } else if (atom.element === "F") {
      logP += 0.4202;
    } else if (atom.element === "Cl") {
      logP += 0.6895;
    } else if (atom.element === "Br") {
      logP += 0.8456;
    } else if (atom.element === "I") {
      logP += 0.8857;
    } else if (atom.element === "S") {
      logP += 0.6482;
    }
  }

  // Joback & Reid (1987) Group Decomposition
  const groupCounts: Record<string, number> = {};
  const addGroup = (groupName: string, count = 1): void => {
    groupCounts[groupName] = (groupCounts[groupName] ?? 0) + count;
  };

  const consumedAtoms = new Set<number>();

  // Step 1: Composite groups (-COOH, -COO-, >C=O, -CH=O, -CN, -NO2)
  for (const atom of mol.atoms) {
    if (consumedAtoms.has(atom.index)) continue;
    const incident = adjBonds.get(atom.index) ?? [];
    const totalH = (atom.explicitHydrogens ?? 0) + atom.implicitHydrogens;

    if (atom.element === "C" && !atom.isAromatic) {
      // Check for nitrile -C#N
      const tripleNBond = incident.find((b) => {
        const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
        return b.order === 3 && nb?.element === "N" && !consumedAtoms.has(nb.index);
      });
      if (tripleNBond) {
        const nIdx = tripleNBond.source === atom.index ? tripleNBond.target : tripleNBond.source;
        consumedAtoms.add(atom.index);
        consumedAtoms.add(nIdx);
        addGroup("-CN");
        continue;
      }

      // Check for carbonyl >C=O
      const doubleOBond = incident.find((b) => {
        const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
        return b.order === 2 && nb?.element === "O" && !consumedAtoms.has(nb.index);
      });

      if (doubleOBond) {
        const oxDoubleIdx = doubleOBond.source === atom.index ? doubleOBond.target : doubleOBond.source;

        // Check if also bonded to -OH (carboxylic acid -COOH)
        const singleOhBond = incident.find((b) => {
          if (b.index === doubleOBond.index || b.order !== 1) return false;
          const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
          if (!nb || nb.element !== "O" || consumedAtoms.has(nb.index)) return false;
          const nbH = (nb.explicitHydrogens ?? 0) + nb.implicitHydrogens;
          return nbH >= 1;
        });

        if (singleOhBond) {
          const ohIdx = singleOhBond.source === atom.index ? singleOhBond.target : singleOhBond.source;
          consumedAtoms.add(atom.index);
          consumedAtoms.add(oxDoubleIdx);
          consumedAtoms.add(ohIdx);
          addGroup("-COOH (acid)");
          continue;
        }

        // Check if bonded to non-ring ether -O- (ester -COO-)
        const singleEsterOBond = incident.find((b) => {
          if (b.index === doubleOBond.index || b.order !== 1) return false;
          const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
          if (!nb || nb.element !== "O" || consumedAtoms.has(nb.index) || ringAtoms.has(nb.index)) return false;
          const nbH = (nb.explicitHydrogens ?? 0) + nb.implicitHydrogens;
          return nbH === 0;
        });

        if (singleEsterOBond) {
          const esterOIdx = singleEsterOBond.source === atom.index ? singleEsterOBond.target : singleEsterOBond.source;
          consumedAtoms.add(atom.index);
          consumedAtoms.add(oxDoubleIdx);
          consumedAtoms.add(esterOIdx);
          addGroup("-COO- (ester)");
          continue;
        }

        // Aldehyde -CH=O vs Ketone >C=O
        consumedAtoms.add(atom.index);
        consumedAtoms.add(oxDoubleIdx);
        if (totalH >= 1 && !ringAtoms.has(atom.index)) {
          addGroup("-CH=O (aldehyde)");
        } else if (ringAtoms.has(atom.index)) {
          addGroup("ring >C=O");
        } else {
          addGroup(">C=O (non-ring)");
        }
        continue;
      }
    }

    // Check aromatic carbonyl c(=O) (e.g. in Caffeine / Pyridone)
    if (atom.element === "C" && atom.isAromatic) {
      const doubleOBond = incident.find((b) => {
        const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
        return b.order === 2 && nb?.element === "O" && !consumedAtoms.has(nb.index);
      });
      if (doubleOBond) {
        const oxDoubleIdx = doubleOBond.source === atom.index ? doubleOBond.target : doubleOBond.source;
        consumedAtoms.add(atom.index);
        consumedAtoms.add(oxDoubleIdx);
        addGroup("ring >C=O");
        continue;
      }
    }
  }

  // Step 2: Classify remaining individual heavy atoms
  for (const atom of mol.atoms) {
    if (consumedAtoms.has(atom.index) || atom.element === "H") continue;
    const incident = adjBonds.get(atom.index) ?? [];
    const totalH = (atom.explicitHydrogens ?? 0) + atom.implicitHydrogens;
    const inRing = ringAtoms.has(atom.index);

    if (atom.element === "C") {
      if (atom.isAromatic) {
        addGroup(totalH >= 1 ? "ring =CH-" : "ring =C<");
      } else {
        const hasTriple = incident.some((b) => b.order === 3);
        const doubleCount = incident.filter((b) => b.order === 2).length;
        if (hasTriple) {
          addGroup(totalH >= 1 ? "#CH" : "#C-");
        } else if (doubleCount >= 2) {
          addGroup("=C=");
        } else if (doubleCount === 1) {
          if (inRing) {
            addGroup(totalH >= 1 ? "ring =CH-" : "ring =C<");
          } else if (totalH >= 2) {
            addGroup("=CH2");
          } else if (totalH === 1) {
            addGroup("=CH-");
          } else {
            addGroup("=C<");
          }
        } else if (inRing) {
          if (totalH >= 2) addGroup("ring -CH2-");
          else if (totalH === 1) addGroup("ring >CH-");
          else addGroup("ring >C<");
        } else {
          if (totalH >= 3) addGroup("-CH3");
          else if (totalH === 2) addGroup("-CH2-");
          else if (totalH === 1) addGroup(">CH-");
          else addGroup(">C<");
        }
      }
    } else if (atom.element === "O") {
      if (totalH >= 1) {
        const attachedToAromatic = incident.some((b) => {
          const nb = mol.atoms[b.source === atom.index ? b.target : b.source];
          return Boolean(nb?.isAromatic);
        });
        addGroup(attachedToAromatic ? "-OH (phenol)" : "-OH (alcohol)");
      } else if (incident.some((b) => b.order === 2)) {
        addGroup("=O (other)");
      } else {
        addGroup(inRing ? "ring -O-" : "-O- (non-ring)");
      }
    } else if (atom.element === "N") {
      if (inRing) {
        if (atom.isAromatic && totalH === 0 && incident.length <= 2) {
          addGroup("ring -N=");
        } else {
          addGroup("ring >NH");
        }
      } else if (totalH >= 2) {
        addGroup("-NH2");
      } else if (totalH === 1) {
        addGroup(">NH (non-ring)");
      } else {
        addGroup(">N- (non-ring)");
      }
    } else if (atom.element === "F") {
      addGroup("-F");
    } else if (atom.element === "Cl") {
      addGroup("-Cl");
    } else if (atom.element === "Br") {
      addGroup("-Br");
    } else if (atom.element === "I") {
      addGroup("-I");
    } else if (atom.element === "S") {
      if (totalH >= 1) addGroup("-SH");
      else addGroup(inRing ? "ring -S-" : "-S- (non-ring)");
    }
  }

  // Step 3: Evaluate Joback & Reid (1987) summation correlations
  let sumTb = 0;
  let sumTc = 0;
  let sumPc = 0;
  let sumVc = 0;
  let sumHf = 0;
  let sumGf = 0;
  let sumCa = 0;
  let sumCb = 0;
  let sumCc = 0;
  let sumCd = 0;

  for (const [grpName, count] of Object.entries(groupCounts)) {
    const g = JOBACK_GROUPS[grpName];
    if (!g) continue;
    sumTb += count * g.dTb;
    sumTc += count * g.dTc;
    sumPc += count * g.dPc;
    sumVc += count * g.dVc;
    sumHf += count * g.dHf;
    sumGf += count * g.dGf;
    sumCa += count * g.da;
    sumCb += count * g.db;
    sumCc += count * g.dc;
    sumCd += count * g.dd;
  }

  const Tb = 198.2 + sumTb;
  const tcDenom = Math.max(0.15, 0.584 + 0.965 * sumTc - sumTc * sumTc);
  const Tc = Tb / tcDenom;
  const pcDenom = Math.max(0.05, 0.113 + 0.0032 * totalAtomCount - sumPc);
  const Pc = 1.0 / (pcDenom * pcDenom);
  const Vc = Math.max(20.0, 17.5 + sumVc);

  const enthalpyOfFormation298K = 68.29 + sumHf;
  const gibbsEnergyOfFormation298K = 53.88 + sumGf;

  const cpA = sumCa - 37.93;
  const cpB = sumCb + 0.21;
  const cpC = sumCc - 3.91e-4;
  const cpD = sumCd + 2.06e-7;
  const Tref = 298.15;
  const idealGasCp298K = Math.max(10.0, cpA + cpB * Tref + cpC * Tref * Tref + cpD * Tref * Tref * Tref);

  // Lee-Kesler (1975) acentric factor omega
  const theta = Math.min(0.95, Math.max(0.3, Tb / Tc));
  const theta6 = Math.pow(theta, 6);
  const lnTheta = Math.log(theta);
  const numOmega =
    -Math.log(Math.max(1.05, Pc) / 1.01325) - 5.92714 + 6.09648 / theta + 1.28862 * lnTheta - 0.169347 * theta6;
  const denOmega = 15.2518 - 15.6875 / theta - 13.4721 * lnTheta + 0.43577 * theta6;
  const acentricFactor = Math.max(0.01, Math.min(1.5, numOmega / (denOmega || 1.0)));

  // Derive consistent Antoine coefficients log10(Psat[bar]) = A - B / (T[K] + C)
  const antoineC = -43.15;
  const log10Pc = Math.log10(Math.max(1.05, Pc));
  const log10Patm = Math.log10(1.01325);
  const invDiff = 1.0 / (Tb + antoineC) - 1.0 / (Tc + antoineC);
  const antoineB = Math.max(500.0, (log10Pc - log10Patm) / Math.max(1e-6, invDiff));
  const antoineA = log10Patm + antoineB / (Tb + antoineC);

  return {
    moleculeId: mol.id,
    moleculeName: mol.name,
    formula,
    molecularWeight: Math.round(molecularWeight * 1000) / 1000,
    exactMass: Math.round(exactMass * 100000) / 100000,
    heavyAtomCount,
    totalAtomCount,
    implicitHydrogenCount,
    ringCount,
    aromaticRingCount,
    connectedComponents,
    hBondDonors,
    hBondAcceptors,
    rotatableBonds,
    tpsa: Math.round(tpsa * 100) / 100,
    logP: Math.round(logP * 1000) / 1000,
    Tb: Math.round(Tb * 100) / 100,
    Tc: Math.round(Tc * 100) / 100,
    Pc: Math.round(Pc * 100) / 100,
    Vc: Math.round(Vc * 100) / 100,
    acentricFactor: Math.round(acentricFactor * 10000) / 10000,
    enthalpyOfFormation298K: Math.round(enthalpyOfFormation298K * 100) / 100,
    gibbsEnergyOfFormation298K: Math.round(gibbsEnergyOfFormation298K * 100) / 100,
    idealGasCpCoeffs: [cpA, cpB, cpC, cpD],
    idealGasCp298K: Math.round(idealGasCp298K * 100) / 100,
    antoineCoeffs: {
      A: Math.round(antoineA * 10000) / 10000,
      B: Math.round(antoineB * 100) / 100,
      C: antoineC,
    },
    groupCounts,
  };
}

function isSmilesDocument(input: SmilesDocument | MolecularGraph): input is SmilesDocument {
  return "molecules" in input && Array.isArray(input.molecules);
}

/**
 * Computes thermophysical and topological properties for all molecules in a `SmilesDocument`,
 * single `MolecularGraph`, or raw SMILES/Molfile string.
 */
export function solveMolecularProperties(input: SmilesDocument | MolecularGraph | string): MolecularPropertySolution {
  if (typeof input === "string") {
    const doc = parseSmilesDocument(input);
    return solveMolecularProperties(doc);
  }

  const molecules: MolecularGraph[] = isSmilesDocument(input) ? input.molecules : [input];

  if (molecules.length === 0) {
    const fallback = estimateThermophysicalProperties(parseSmiles("C", "Methane"));
    return { molecules: [fallback], primary: fallback };
  }

  const estimates = molecules.map((m) => estimateThermophysicalProperties(m));
  return {
    molecules: estimates,
    primary: estimates[0]!,
  };
}

function formatHillFormula(counts: Map<string, number>): string {
  if (counts.size === 0) return "";
  const orderedSymbols: string[] = [];

  if ((counts.get("C") ?? 0) > 0) {
    orderedSymbols.push("C");
    if ((counts.get("H") ?? 0) > 0) {
      orderedSymbols.push("H");
    }
    const rest = Array.from(counts.keys())
      .filter((k) => k !== "C" && k !== "H" && (counts.get(k) ?? 0) > 0)
      .sort();
    orderedSymbols.push(...rest);
  } else {
    const all = Array.from(counts.keys())
      .filter((k) => (counts.get(k) ?? 0) > 0)
      .sort();
    orderedSymbols.push(...all);
  }

  let out = "";
  for (const sym of orderedSymbols) {
    const c = counts.get(sym) ?? 0;
    if (c <= 0) continue;
    out += c === 1 ? sym : `${sym}${c}`;
  }
  return out;
}
