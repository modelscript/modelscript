// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  BondAngleGeometry,
  BondGeometry,
  DihedralGeometry,
  MolAtom,
  MolBond,
  MolecularAnalysis,
  MolfileDocument,
  MolRecord,
} from "../types.js";
import { getElementData } from "./elements.js";

/**
 * Effective numeric bond order for valence & UFF bond-order calculations.
 */
export function effectiveBondOrder(order: number): number {
  switch (order) {
    case 1:
      return 1.0;
    case 2:
      return 2.0;
    case 3:
      return 3.0;
    case 4:
      return 1.5; // aromatic
    default:
      return 1.0;
  }
}

/**
 * Computes effective maximum neutral/charged valence for an atom.
 */
export function computeAllowedValences(element: string, charge: number): number[] {
  const el = getElementData(element);
  if (!el) return [];
  if (charge === 0) return [...el.valences];

  // Standard main-group charge valence adjustments
  if (el.symbol === "C") {
    return [Math.max(0, 4 - Math.abs(charge))];
  }
  if (el.symbol === "N" || el.symbol === "P") {
    if (charge > 0) return [Math.min(4 + (charge - 1), 5)];
    return [Math.max(0, 3 + charge)];
  }
  if (el.symbol === "O" || el.symbol === "S") {
    if (charge > 0) return [Math.min(3, 2 + charge)];
    return [Math.max(0, 2 + charge)];
  }
  if (el.symbol === "B") {
    if (charge < 0) return [4];
    return [Math.max(0, 3 - charge)];
  }
  if (el.symbol === "F" || el.symbol === "Cl" || el.symbol === "Br" || el.symbol === "I") {
    if (charge < 0) return [0];
    return [Math.max(1, 1 + charge)];
  }
  return el.valences.map((v) => Math.max(0, v - Math.abs(charge)));
}

/**
 * Computes the number of implicit hydrogens for a single atom given its explicit bond order sum.
 */
export function computeImplicitHydrogens(atom: MolAtom, explicitBondOrderSum: number): number {
  const el = getElementData(atom.element);
  if (!el) return 0;
  if (el.symbol === "H" || el.symbol === "D" || el.symbol === "T") return 0;

  // Explicit valence override in V2000/V3000
  if (atom.valence === 15) return 0; // 15 means explicit zero valence
  if (atom.valence > 0 && atom.valence < 15) {
    return Math.max(0, Math.floor(atom.valence - explicitBondOrderSum));
  }

  // Only add implicit hydrogens for organic-subset / standard covalent elements
  const organicAutoH = new Set(["B", "C", "N", "O", "P", "S", "F", "Cl", "Br", "I", "Si"]);
  if (!organicAutoH.has(el.symbol)) return 0;

  const radicalPenalty = atom.radical === 2 ? 1 : atom.radical === 1 || atom.radical === 3 ? 2 : 0;
  const allowed = computeAllowedValences(el.symbol, atom.charge);
  for (const v of allowed) {
    const target = v - radicalPenalty;
    if (target >= explicitBondOrderSum - 1e-6) {
      return Math.max(0, Math.floor(target - explicitBondOrderSum + 1e-6));
    }
  }
  return 0;
}

/**
 * Formats an element count map into canonical Hill system molecular formula
 * (C first, then H, then remaining elements alphabetically; if no C, all alphabetically).
 */
export function formatHillFormula(counts: Map<string, number>): string {
  const parts: string[] = [];
  const pushElem = (sym: string, count: number): void => {
    if (count <= 0) return;
    parts.push(count === 1 ? sym : `${sym}${count}`);
  };

  if (counts.has("C")) {
    pushElem("C", counts.get("C")!);
    if (counts.has("H")) {
      pushElem("H", counts.get("H")!);
    }
    const others = [...counts.keys()].filter((k) => k !== "C" && k !== "H").sort();
    for (const sym of others) {
      pushElem(sym, counts.get(sym)!);
    }
  } else {
    const all = [...counts.keys()].sort();
    for (const sym of all) {
      pushElem(sym, counts.get(sym)!);
    }
  }
  return parts.join("");
}

/**
 * Computes the Smallest Set of Smallest Rings (SSSR) using shortest-path BFS cycle extraction
 * with linear independence filtering over GF(2) edge incidence vectors.
 */
export function perceiveSSSR(atomCount: number, bonds: readonly MolBond[]): number[][] {
  if (atomCount === 0 || bonds.length === 0) return [];

  // Build adjacency list with bond indices
  const adj = new Map<number, Array<{ neighbor: number; bondIdx: number }>>();
  for (let i = 1; i <= atomCount; i++) adj.set(i, []);

  const validBonds: Array<{ idx: number; a1: number; a2: number }> = [];
  for (let b = 0; b < bonds.length; b++) {
    const bond = bonds[b]!;
    if (
      bond.atom1 >= 1 &&
      bond.atom1 <= atomCount &&
      bond.atom2 >= 1 &&
      bond.atom2 <= atomCount &&
      bond.atom1 !== bond.atom2
    ) {
      const idx = validBonds.length;
      validBonds.push({ idx, a1: bond.atom1, a2: bond.atom2 });
      adj.get(bond.atom1)!.push({ neighbor: bond.atom2, bondIdx: idx });
      adj.get(bond.atom2)!.push({ neighbor: bond.atom1, bondIdx: idx });
    }
  }

  // Count connected components for cyclomatic number = E - V + C
  const visitedComp = new Set<number>();
  let components = 0;
  for (let i = 1; i <= atomCount; i++) {
    if (visitedComp.has(i)) continue;
    components++;
    const queue = [i];
    visitedComp.add(i);
    while (queue.length > 0) {
      const u = queue.shift()!;
      for (const edge of adj.get(u) ?? []) {
        if (!visitedComp.has(edge.neighbor)) {
          visitedComp.add(edge.neighbor);
          queue.push(edge.neighbor);
        }
      }
    }
  }

  const cyclomaticNumber = validBonds.length - atomCount + components;
  if (cyclomaticNumber <= 0) return [];

  // Candidate shortest cycles: for each edge (u, v), BFS shortest path between u and v excluding that edge
  interface CandidateCycle {
    atoms: number[];
    edgeMask: Set<number>;
    key: string;
  }

  const candidates: CandidateCycle[] = [];
  const seenKeys = new Set<string>();

  for (const edge of validBonds) {
    const parentAtom = new Map<number, number>();
    const parentBond = new Map<number, number>();
    const queue: number[] = [edge.a1];
    parentAtom.set(edge.a1, -1);

    let found = false;
    while (queue.length > 0 && !found) {
      const u = queue.shift()!;
      for (const step of adj.get(u) ?? []) {
        if (step.bondIdx === edge.idx) continue;
        if (!parentAtom.has(step.neighbor)) {
          parentAtom.set(step.neighbor, u);
          parentBond.set(step.neighbor, step.bondIdx);
          if (step.neighbor === edge.a2) {
            found = true;
            break;
          }
          queue.push(step.neighbor);
        }
      }
    }

    if (found) {
      const atoms: number[] = [];
      const edgeMask = new Set<number>([edge.idx]);
      let curr = edge.a2;
      while (curr !== -1) {
        atoms.push(curr);
        const pb = parentBond.get(curr);
        if (pb !== undefined) edgeMask.add(pb);
        curr = parentAtom.get(curr) ?? -1;
      }
      const key = [...atoms].sort((a, b) => a - b).join(",");
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        candidates.push({ atoms, edgeMask, key });
      }
    }
  }

  // Sort candidates by ring size ascending (smallest rings first)
  candidates.sort((a, b) => a.atoms.length - b.atoms.length);

  // GF(2) Gaussian elimination to pick `cyclomaticNumber` linearly independent smallest rings
  const basis: Array<{ pivot: number; bits: Set<number> }> = [];
  const sssr: number[][] = [];

  for (const cand of candidates) {
    if (sssr.length >= cyclomaticNumber) break;
    const vec = new Set<number>(cand.edgeMask);

    for (const row of basis) {
      if (vec.has(row.pivot)) {
        for (const bit of row.bits) {
          if (vec.has(bit)) vec.delete(bit);
          else vec.add(bit);
        }
      }
    }

    if (vec.size > 0) {
      let pivot = Infinity;
      for (const b of vec) {
        if (b < pivot) pivot = b;
      }
      basis.push({ pivot, bits: vec });
      sssr.push(cand.atoms);
    }
  }

  return sssr;
}

/**
 * Computes UFF equilibrium bond length r0 (Angstrom) and harmonic force constant kb (kcal/(mol*A^2)).
 */
export function computeUffBondParams(
  element1: string,
  element2: string,
  order: number,
): { equilibriumLength: number; forceConstant: number } {
  const el1 = getElementData(element1);
  const el2 = getElementData(element2);
  const r1 = el1?.covalentRadius ?? 0.76;
  const r2 = el2?.covalentRadius ?? 0.76;
  const z1 = el1?.uffZStar ?? 1.912;
  const z2 = el2?.uffZStar ?? 1.912;

  const bo = effectiveBondOrder(order);
  const rSum = r1 + r2;
  // Pauling/UFF bond-order correction: r_BO = -0.1332 * (r1 + r2) * ln(n)
  const rBo = bo > 1.0 ? -0.1332 * rSum * Math.log(bo) : 0.0;
  const equilibriumLength = Math.max(0.5, rSum + rBo);
  // UFF harmonic stretch force constant: kb = 664.12 * Z1* * Z2* / r0^3  [kcal/(mol*A^2)]
  const forceConstant = (664.12 * z1 * z2) / (equilibriumLength * equilibriumLength * equilibriumLength);

  return { equilibriumLength, forceConstant };
}

/**
 * Computes 3D Euclidean distance between two atoms (Angstrom).
 */
export function computeBondLength3D(a1: MolAtom, a2: MolAtom): number {
  const dx = a2.x - a1.x;
  const dy = a2.y - a1.y;
  const dz = a2.z - a1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes bond angle (atom1 - vertex - atom3) in degrees [0, 180].
 */
export function computeBondAngleDeg(a1: MolAtom, vertex: MolAtom, a3: MolAtom): number {
  const ux = a1.x - vertex.x;
  const uy = a1.y - vertex.y;
  const uz = a1.z - vertex.z;
  const vx = a3.x - vertex.x;
  const vy = a3.y - vertex.y;
  const vz = a3.z - vertex.z;

  const magU = Math.sqrt(ux * ux + uy * uy + uz * uz);
  const magV = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (magU < 1e-12 || magV < 1e-12) return 0;

  const cosTheta = Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (magU * magV)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * Computes signed dihedral/torsion angle (a1 - a2 - a3 - a4) in degrees [-180, 180].
 */
export function computeDihedralDeg(a1: MolAtom, a2: MolAtom, a3: MolAtom, a4: MolAtom): number {
  // Bond vectors b1 = a2 - a1, b2 = a3 - a2, b3 = a4 - a3
  const b1x = a2.x - a1.x;
  const b1y = a2.y - a1.y;
  const b1z = a2.z - a1.z;

  const b2x = a3.x - a2.x;
  const b2y = a3.y - a2.y;
  const b2z = a3.z - a2.z;

  const b3x = a4.x - a3.x;
  const b3y = a4.y - a3.y;
  const b3z = a4.z - a3.z;

  // n1 = b1 x b2
  const n1x = b1y * b2z - b1z * b2y;
  const n1y = b1z * b2x - b1x * b2z;
  const n1z = b1x * b2y - b1y * b2x;

  // n2 = b2 x b3
  const n2x = b2y * b3z - b2z * b3y;
  const n2y = b2z * b3x - b2x * b3z;
  const n2z = b2x * b3y - b2y * b3x;

  const b2Len = Math.sqrt(b2x * b2x + b2y * b2y + b2z * b2z);
  if (b2Len < 1e-12) return 0;

  // m1 = n1 x (b2 / |b2|)
  const u2x = b2x / b2Len;
  const u2y = b2y / b2Len;
  const u2z = b2z / b2Len;

  const m1x = n1y * u2z - n1z * u2y;
  const m1y = n1z * u2x - n1x * u2z;
  const m1z = n1x * u2y - n1y * u2x;

  const x = n1x * n2x + n1y * n2y + n1z * n2z;
  const y = m1x * n2x + m1y * n2y + m1z * n2z;

  return (Math.atan2(y, x) * 180) / Math.PI;
}

/**
 * Performs comprehensive molecular graph, 3D geometry, and UFF/harmonic force-field analysis on a `MolRecord`.
 */
export function analyzeMolRecord(record: MolRecord): MolecularAnalysis {
  const atomByIdx = new Map<number, MolAtom>();
  for (const a of record.atoms) atomByIdx.set(a.index, a);

  // Explicit bond order sum & adjacency per atom
  const bondOrderSum = new Map<number, number>();
  const adjacency = new Map<number, number[]>();
  const aromaticAtoms = new Set<number>();

  for (const a of record.atoms) {
    bondOrderSum.set(a.index, 0);
    adjacency.set(a.index, []);
  }

  for (const b of record.bonds) {
    if (!atomByIdx.has(b.atom1) || !atomByIdx.has(b.atom2) || b.atom1 === b.atom2) continue;
    const bo = effectiveBondOrder(b.order);
    bondOrderSum.set(b.atom1, (bondOrderSum.get(b.atom1) ?? 0) + bo);
    bondOrderSum.set(b.atom2, (bondOrderSum.get(b.atom2) ?? 0) + bo);
    adjacency.get(b.atom1)!.push(b.atom2);
    adjacency.get(b.atom2)!.push(b.atom1);
    if (b.order === 4) {
      aromaticAtoms.add(b.atom1);
      aromaticAtoms.add(b.atom2);
    }
  }

  // Implicit hydrogens, formula, MW, exact mass
  const elemCounts = new Map<string, number>();
  const implicitHydrogensByAtom: Record<number, number> = {};
  const hData = getElementData("H")!;

  let molecularWeight = 0;
  let exactMass = 0;
  let heavyAtomCount = 0;
  let explicitHydrogenCount = 0;
  let implicitHydrogenCount = 0;
  let formalChargeTotal = 0;
  let hasNonZeroZ = false;

  for (const atom of record.atoms) {
    if (Math.abs(atom.z) > 1e-6) hasNonZeroZ = true;
    formalChargeTotal += atom.charge;

    const el = getElementData(atom.element);
    const sym = el?.symbol ?? atom.element;
    elemCounts.set(sym, (elemCounts.get(sym) ?? 0) + 1);

    if (sym === "H" || sym === "D" || sym === "T") {
      explicitHydrogenCount++;
    } else {
      heavyAtomCount++;
    }

    if (el) {
      if (atom.isotope !== undefined && atom.isotope > 0) {
        molecularWeight += atom.isotope;
        exactMass += atom.isotope;
      } else {
        molecularWeight += el.atomicWeight + atom.massDiff;
        exactMass += el.monoisotopicMass + atom.massDiff;
      }
    }

    const impH = computeImplicitHydrogens(atom, bondOrderSum.get(atom.index) ?? 0);
    implicitHydrogensByAtom[atom.index] = impH;
    if (impH > 0) {
      implicitHydrogenCount += impH;
      elemCounts.set("H", (elemCounts.get("H") ?? 0) + impH);
      molecularWeight += impH * hData.atomicWeight;
      exactMass += impH * hData.monoisotopicMass;
    }
  }

  const formula = formatHillFormula(elemCounts);
  const sssrRings = perceiveSSSR(record.atoms.length, record.bonds);

  // 3D Bond Geometries & UFF/Harmonic Stretch Energy
  const bondGeometries: BondGeometry[] = [];
  let totalStretchEnergy = 0;

  for (const b of record.bonds) {
    const a1 = atomByIdx.get(b.atom1);
    const a2 = atomByIdx.get(b.atom2);
    if (!a1 || !a2 || b.atom1 === b.atom2) continue;

    const length = computeBondLength3D(a1, a2);
    const { equilibriumLength, forceConstant } = computeUffBondParams(a1.element, a2.element, b.order);
    const delta = length - equilibriumLength;
    const stretchEnergy = 0.5 * forceConstant * delta * delta;
    totalStretchEnergy += stretchEnergy;

    bondGeometries.push({
      bondIndex: b.index,
      atom1: b.atom1,
      atom2: b.atom2,
      element1: a1.element,
      element2: a2.element,
      order: b.order,
      length,
      equilibriumLength,
      forceConstant,
      stretchEnergy,
    });
  }

  // Bond Angles (all unique i - j - k with i < k)
  const bondAngles: BondAngleGeometry[] = [];
  for (const atom of record.atoms) {
    const neighbors = adjacency.get(atom.index) ?? [];
    for (let i = 0; i < neighbors.length; i++) {
      for (let k = i + 1; k < neighbors.length; k++) {
        const a1 = atomByIdx.get(neighbors[i]!)!;
        const a3 = atomByIdx.get(neighbors[k]!)!;
        bondAngles.push({
          atom1: a1.index,
          vertex: atom.index,
          atom3: a3.index,
          angleDeg: computeBondAngleDeg(a1, atom, a3),
        });
      }
    }
  }

  // Dihedral Angles (for each bond j-k, all i-j-k-l where i != k and l != j and i != l)
  const dihedrals: DihedralGeometry[] = [];
  for (const b of record.bonds) {
    const a2 = atomByIdx.get(b.atom1);
    const a3 = atomByIdx.get(b.atom2);
    if (!a2 || !a3 || b.atom1 === b.atom2) continue;
    const n2 = adjacency.get(a2.index) ?? [];
    const n3 = adjacency.get(a3.index) ?? [];
    for (const iIdx of n2) {
      if (iIdx === a3.index) continue;
      const a1 = atomByIdx.get(iIdx)!;
      for (const lIdx of n3) {
        if (lIdx === a2.index || lIdx === iIdx) continue;
        const a4 = atomByIdx.get(lIdx)!;
        dihedrals.push({
          atom1: a1.index,
          atom2: a2.index,
          atom3: a3.index,
          atom4: a4.index,
          dihedralDeg: computeDihedralDeg(a1, a2, a3, a4),
        });
      }
    }
  }

  return {
    recordId: record.id,
    name: record.name,
    formula,
    molecularWeight,
    exactMass,
    heavyAtomCount,
    explicitHydrogenCount,
    implicitHydrogenCount,
    totalHydrogenCount: explicitHydrogenCount + implicitHydrogenCount,
    implicitHydrogensByAtom,
    bondCount: record.bonds.length,
    ringCount: sssrRings.length,
    sssrRings,
    aromaticAtomCount: aromaticAtoms.size,
    formalChargeTotal,
    has3DCoordinates: hasNonZeroZ || record.header.dimensionCode === "3D",
    bondGeometries,
    bondAngles,
    dihedrals,
    totalStretchEnergy,
  };
}

/**
 * Analyzes all records in a `MolfileDocument`.
 */
export function analyzeMolfileDocument(doc: MolfileDocument): MolecularAnalysis[] {
  return doc.records.map((r) => analyzeMolRecord(r));
}
