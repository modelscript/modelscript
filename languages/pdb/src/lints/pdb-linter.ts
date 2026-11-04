// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Stereochemical, Backbone, & Crystallographic Validation Linter (M9251 - M9260).
 */

import { PdbErrorCode, type DiagnosticItem } from "../errors.js";
import { parsePdb } from "../parser/pdb-parser.js";
import type {
  PdbAtom,
  PdbDocument,
  PdbResidue,
  PdbStructure,
  RamachandranAngle,
  RamachandranRegion,
} from "../types.js";

export function atomDistance(a: PdbAtom, b: PdbAtom): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Computes the IUPAC dihedral torsion angle (in degrees, [-180, 180]) for 4 3D points.
 */
export function computeDihedralAngle(
  p1: { x: number; y: number; z: number },
  p2: { x: number; y: number; z: number },
  p3: { x: number; y: number; z: number },
  p4: { x: number; y: number; z: number },
): number {
  const b1x = p2.x - p1.x;
  const b1y = p2.y - p1.y;
  const b1z = p2.z - p1.z;

  const b2x = p3.x - p2.x;
  const b2y = p3.y - p2.y;
  const b2z = p3.z - p2.z;

  const b3x = p4.x - p3.x;
  const b3y = p4.y - p3.y;
  const b3z = p4.z - p3.z;

  const b2Len = Math.sqrt(b2x * b2x + b2y * b2y + b2z * b2z);
  if (b2Len < 1e-12) return 0.0;

  const u2x = b2x / b2Len;
  const u2y = b2y / b2Len;
  const u2z = b2z / b2Len;

  // Normal 1: n1 = b1 x b2
  const n1x = b1y * b2z - b1z * b2y;
  const n1y = b1z * b2x - b1x * b2z;
  const n1z = b1x * b2y - b1y * b2x;

  // Normal 2: n2 = b2 x b3
  const n2x = b2y * b3z - b2z * b3y;
  const n2y = b2z * b3x - b2x * b3z;
  const n2z = b2x * b3y - b2y * b3x;

  const n1Len = Math.sqrt(n1x * n1x + n1y * n1y + n1z * n1z);
  const n2Len = Math.sqrt(n2x * n2x + n2y * n2y + n2z * n2z);
  if (n1Len < 1e-12 || n2Len < 1e-12) return 0.0;

  // m1 = n1 x u2
  const m1x = n1y * u2z - n1z * u2y;
  const m1y = n1z * u2x - n1x * u2z;
  const m1z = n1x * u2y - n1y * u2x;

  const x = n1x * n2x + n1y * n2y + n1z * n2z;
  const y = m1x * n2x + m1y * n2y + m1z * n2z;

  // Right-handed screw rule around b2: atan2(-y, x) == atan2((n1 x n2) . u2, n1 . n2)
  const angleRad = Math.atan2(-y, x);
  return (angleRad * 180.0) / Math.PI;
}

export function classifyRamachandranRegion(
  resName: string,
  phi: number | null,
  psi: number | null,
): { region: RamachandranRegion; isOutlier: boolean } {
  const upper = resName.trim().toUpperCase();
  if (upper === "GLY" || upper === "PRO") {
    return { region: "glycine_proline", isOutlier: false };
  }
  if (phi === null || psi === null) {
    return { region: "allowed", isOutlier: false };
  }

  // Core right-handed alpha-helix region: phi in [-140, -35], psi in [-75, +35]
  if (phi >= -140.0 && phi <= -35.0 && psi >= -75.0 && psi <= 35.0) {
    return { region: "favored_alpha", isOutlier: false };
  }

  // Core beta-sheet / polyproline-II region: phi in [-175, -45], psi in [+80, +180] or [-180, -135]
  if (phi >= -175.0 && phi <= -45.0 && (psi >= 80.0 || psi <= -135.0)) {
    return { region: "favored_beta", isOutlier: false };
  }

  // Generously allowed negative-phi regions and left-handed alpha-helix (phi in [+35, +95], psi in [-15, +80])
  if (phi >= -180.0 && phi <= -20.0 && psi >= -180.0 && psi <= 180.0) {
    // Disallow severe eclipsed syn-periplanar zone near (phi > -35, abs(psi) > 100)
    if (phi > -35.0 && Math.abs(psi) > 95.0) {
      return { region: "outlier", isOutlier: true };
    }
    return { region: "allowed", isOutlier: false };
  }

  // Left-handed alpha_L region
  if (phi >= 35.0 && phi <= 95.0 && psi >= -15.0 && psi <= 80.0) {
    return { region: "allowed", isOutlier: false };
  }

  return { region: "outlier", isOutlier: true };
}

function findBackboneAtom(res: PdbResidue, atomName: string): PdbAtom | undefined {
  return res.atoms.find((a) => a.name === atomName);
}

/**
 * Computes backbone Ramachandran dihedral angles (phi, psi, omega) across all chains in the structure.
 */
export function computeRamachandranAngles(input: PdbStructure | PdbDocument): RamachandranAngle[] {
  const results: RamachandranAngle[] = [];

  for (const chain of input.chains) {
    const stdResidues = chain.residues.filter((r) => r.isStandardAminoAcid);
    for (let i = 0; i < stdResidues.length; i++) {
      const curr = stdResidues[i]!;
      const prev = i > 0 ? stdResidues[i - 1] : undefined;
      const next = i + 1 < stdResidues.length ? stdResidues[i + 1] : undefined;

      const nCurr = findBackboneAtom(curr, "N");
      const caCurr = findBackboneAtom(curr, "CA");
      const cCurr = findBackboneAtom(curr, "C");

      let phi: number | null = null;
      let psi: number | null = null;
      let omega: number | null = null;

      if (prev && nCurr && caCurr && cCurr) {
        const cPrev = findBackboneAtom(prev, "C");
        const caPrev = findBackboneAtom(prev, "CA");
        if (cPrev && atomDistance(cPrev, nCurr) <= 2.0) {
          phi = computeDihedralAngle(cPrev, nCurr, caCurr, cCurr);
          if (caPrev) {
            omega = computeDihedralAngle(caPrev, cPrev, nCurr, caCurr);
          }
        }
      }

      if (next && nCurr && caCurr && cCurr) {
        const nNext = findBackboneAtom(next, "N");
        if (nNext && atomDistance(cCurr, nNext) <= 2.0) {
          psi = computeDihedralAngle(nCurr, caCurr, cCurr, nNext);
        }
      }

      const { region, isOutlier } = classifyRamachandranRegion(curr.resName, phi, psi);
      results.push({
        chainId: curr.chainId,
        resName: curr.resName,
        resSeq: curr.resSeq,
        phi,
        psi,
        omega,
        region,
        isOutlier,
        ...(curr.range ? { range: curr.range } : {}),
      });
    }
  }

  return results;
}

/**
 * Runs all 10 structural biology and crystallographic pre-flight lint rules (M9251 - M9260).
 */
export function lintPdb(input: PdbStructure | PdbDocument | string): DiagnosticItem[] {
  const structure: PdbStructure = typeof input === "string" ? parsePdb(input) : input;
  const diagnostics: DiagnosticItem[] = [];

  const allAtoms = [...structure.atoms, ...structure.hetAtoms];

  // M9260: Empty PDB structure
  if (allAtoms.length === 0) {
    diagnostics.push({
      code: PdbErrorCode.EMPTY_PDB_STRUCTURE.code,
      rule: PdbErrorCode.EMPTY_PDB_STRUCTURE.rule,
      severity: PdbErrorCode.EMPTY_PDB_STRUCTURE.severity,
      message: PdbErrorCode.EMPTY_PDB_STRUCTURE.message(structure.id || "XXXX"),
      ...(structure.range ? { range: structure.range } : {}),
    });
    return diagnostics;
  }

  // M9259: Duplicate atom serial, M9253: Invalid occupancy, M9254: Non-positive B-factor
  const seenSerialsByModel = new Map<number, Set<number>>();
  const allSerials = new Set<number>();

  for (const atom of allAtoms) {
    allSerials.add(atom.serial);
    const modelId = atom.modelNum ?? 1;
    let modelSet = seenSerialsByModel.get(modelId);
    if (!modelSet) {
      modelSet = new Set<number>();
      seenSerialsByModel.set(modelId, modelSet);
    }
    if (modelSet.has(atom.serial)) {
      diagnostics.push({
        code: PdbErrorCode.DUPLICATE_ATOM_SERIAL.code,
        rule: PdbErrorCode.DUPLICATE_ATOM_SERIAL.rule,
        severity: PdbErrorCode.DUPLICATE_ATOM_SERIAL.severity,
        message: PdbErrorCode.DUPLICATE_ATOM_SERIAL.message(atom.serial, atom.name),
        ...(atom.range ? { range: atom.range } : {}),
      });
    } else {
      modelSet.add(atom.serial);
    }

    if (atom.occupancy < 0.0 || atom.occupancy > 1.0) {
      diagnostics.push({
        code: PdbErrorCode.INVALID_OCCUPANCY.code,
        rule: PdbErrorCode.INVALID_OCCUPANCY.rule,
        severity: PdbErrorCode.INVALID_OCCUPANCY.severity,
        message: PdbErrorCode.INVALID_OCCUPANCY.message(atom.name, atom.serial, atom.occupancy.toFixed(2)),
        ...(atom.range ? { range: atom.range } : {}),
      });
    }

    if (atom.tempFactor <= 0.0) {
      diagnostics.push({
        code: PdbErrorCode.NON_POSITIVE_B_FACTOR.code,
        rule: PdbErrorCode.NON_POSITIVE_B_FACTOR.rule,
        severity: PdbErrorCode.NON_POSITIVE_B_FACTOR.severity,
        message: PdbErrorCode.NON_POSITIVE_B_FACTOR.message(atom.name, atom.serial, atom.tempFactor.toFixed(2)),
        ...(atom.range ? { range: atom.range } : {}),
      });
    }
  }

  // M9256: Missing backbone atoms (N, CA, C) in standard amino acid residues
  for (const res of structure.residues) {
    if (!res.isStandardAminoAcid) continue;
    const missing: string[] = [];
    if (!findBackboneAtom(res, "N")) missing.push("N");
    if (!findBackboneAtom(res, "CA")) missing.push("CA");
    if (!findBackboneAtom(res, "C")) missing.push("C");

    if (missing.length > 0) {
      diagnostics.push({
        code: PdbErrorCode.MISSING_BACKBONE_ATOMS.code,
        rule: PdbErrorCode.MISSING_BACKBONE_ATOMS.rule,
        severity: PdbErrorCode.MISSING_BACKBONE_ATOMS.severity,
        message: PdbErrorCode.MISSING_BACKBONE_ATOMS.message(res.chainId, res.resName, res.resSeq, missing.join(", ")),
        ...(res.range ? { range: res.range } : {}),
      });
    }
  }

  // M9252: Broken peptide backbone (consecutive residue C_i -- N_{i+1} distance > 2.0 Å)
  for (const chain of structure.chains) {
    const stdResidues = chain.residues.filter((r) => r.isStandardAminoAcid);
    for (let i = 0; i + 1 < stdResidues.length; i++) {
      const resA = stdResidues[i]!;
      const resB = stdResidues[i + 1]!;
      const cAtom = findBackboneAtom(resA, "C");
      const nAtom = findBackboneAtom(resB, "N");
      if (cAtom && nAtom) {
        const dist = atomDistance(cAtom, nAtom);
        if (dist > 2.0) {
          diagnostics.push({
            code: PdbErrorCode.BROKEN_PEPTIDE_BACKBONE.code,
            rule: PdbErrorCode.BROKEN_PEPTIDE_BACKBONE.rule,
            severity: PdbErrorCode.BROKEN_PEPTIDE_BACKBONE.severity,
            message: PdbErrorCode.BROKEN_PEPTIDE_BACKBONE.message(
              chain.id,
              resA.resName,
              resA.resSeq,
              resB.resName,
              resB.resSeq,
              dist.toFixed(2),
            ),
            ...(resB.range ? { range: resB.range } : {}),
          });
        }
      }
    }
  }

  // M9255: Ramachandran outlier
  const ramaAngles = computeRamachandranAngles(structure);
  for (const rama of ramaAngles) {
    if (rama.isOutlier && rama.phi !== null && rama.psi !== null) {
      diagnostics.push({
        code: PdbErrorCode.RAMACHANDRAN_OUTLIER.code,
        rule: PdbErrorCode.RAMACHANDRAN_OUTLIER.rule,
        severity: PdbErrorCode.RAMACHANDRAN_OUTLIER.severity,
        message: PdbErrorCode.RAMACHANDRAN_OUTLIER.message(
          rama.chainId,
          rama.resName,
          rama.resSeq,
          rama.phi.toFixed(1),
          rama.psi.toFixed(1),
        ),
        ...(rama.range ? { range: rama.range } : {}),
      });
    }
  }

  // M9257: Invalid disulfide bond distance (SG - SG distance outside [1.8, 2.5] Å)
  for (const ssb of structure.disulfideBonds) {
    const res1 = structure.residues.find((r) => r.chainId === ssb.chainId1 && r.resSeq === ssb.resSeq1);
    const res2 = structure.residues.find((r) => r.chainId === ssb.chainId2 && r.resSeq === ssb.resSeq2);
    const sg1 = res1?.atoms.find((a) => a.name === "SG");
    const sg2 = res2?.atoms.find((a) => a.name === "SG");

    const dist = sg1 && sg2 ? atomDistance(sg1, sg2) : ssb.length;
    if (dist !== undefined && (dist < 1.8 || dist > 2.5)) {
      diagnostics.push({
        code: PdbErrorCode.INVALID_DISULFIDE_DISTANCE.code,
        rule: PdbErrorCode.INVALID_DISULFIDE_DISTANCE.rule,
        severity: PdbErrorCode.INVALID_DISULFIDE_DISTANCE.severity,
        message: PdbErrorCode.INVALID_DISULFIDE_DISTANCE.message(
          ssb.chainId1,
          ssb.resSeq1,
          ssb.chainId2,
          ssb.resSeq2,
          dist.toFixed(2),
        ),
        ...(ssb.range ? { range: ssb.range } : {}),
      });
    }
  }

  // M9258: Unresolved CONECT serial
  const conectBondedPairs = new Set<string>();
  for (const con of structure.conectRecords) {
    if (!allSerials.has(con.atomSerial)) {
      diagnostics.push({
        code: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.code,
        rule: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.rule,
        severity: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.severity,
        message: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.message(con.atomSerial, con.atomSerial),
        ...(con.range ? { range: con.range } : {}),
      });
    }
    for (const target of con.bondedSerials) {
      const minS = Math.min(con.atomSerial, target);
      const maxS = Math.max(con.atomSerial, target);
      conectBondedPairs.add(`${minS}:${maxS}`);

      if (!allSerials.has(target)) {
        diagnostics.push({
          code: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.code,
          rule: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.rule,
          severity: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.severity,
          message: PdbErrorCode.UNRESOLVED_CONECT_SERIAL.message(con.atomSerial, target),
          ...(con.range ? { range: con.range } : {}),
        });
      }
    }
  }

  // M9251: Steric clash (non-bonded interatomic distance < 1.2 Å)
  const model1Atoms = allAtoms.filter((a) => (a.modelNum ?? 1) === 1);
  for (let i = 0; i < model1Atoms.length; i++) {
    const a = model1Atoms[i]!;
    for (let j = i + 1; j < model1Atoms.length; j++) {
      const b = model1Atoms[j]!;

      // Skip alternate conformations of the same atom
      if (a.altLoc && b.altLoc && a.altLoc !== b.altLoc) continue;

      // Skip explicitly CONECT-bonded pairs
      const minS = Math.min(a.serial, b.serial);
      const maxS = Math.max(a.serial, b.serial);
      if (conectBondedPairs.has(`${minS}:${maxS}`)) continue;

      // Skip covalent X-H bonds within the same residue
      const sameResidue = a.chainId === b.chainId && a.resSeq === b.resSeq && (a.iCode ?? "") === (b.iCode ?? "");
      if (sameResidue && (a.element === "H" || b.element === "H" || a.element === "D" || b.element === "D")) {
        continue;
      }

      const dist = atomDistance(a, b);
      if (dist < 1.2) {
        diagnostics.push({
          code: PdbErrorCode.STERIC_CLASH.code,
          rule: PdbErrorCode.STERIC_CLASH.rule,
          severity: PdbErrorCode.STERIC_CLASH.severity,
          message: PdbErrorCode.STERIC_CLASH.message(
            `${a.resName}${a.resSeq}.${a.name}`,
            a.serial,
            `${b.resName}${b.resSeq}.${b.name}`,
            b.serial,
            dist.toFixed(2),
          ),
          ...(b.range ? { range: b.range } : {}),
        });
      }
    }
  }

  return diagnostics;
}
