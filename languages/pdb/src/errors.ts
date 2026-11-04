// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pdb — Structural Biology & Stereochemical Validation Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9251 - M9260).
 */

import type { PdbRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: PdbRange | undefined;
}

export const PdbErrorCode = {
  STERIC_CLASH: {
    code: 9251,
    rule: "steric-clash",
    severity: "error" as DiagnosticSeverity,
    message: (
      atomA: string,
      serialA: number | string,
      atomB: string,
      serialB: number | string,
      distance: string | number,
    ) =>
      `Severe steric clash between non-bonded atoms '${atomA}' (serial '${serialA}') and '${atomB}' (serial '${serialB}') at distance '${distance}' Å (< 1.20 Å).`,
  },
  BROKEN_PEPTIDE_BACKBONE: {
    code: 9252,
    rule: "broken-peptide-backbone",
    severity: "warning" as DiagnosticSeverity,
    message: (
      chainId: string,
      resA: string,
      seqA: number | string,
      resB: string,
      seqB: number | string,
      distance: string | number,
    ) =>
      `Broken peptide backbone in chain '${chainId}' between '${resA}${seqA}' (C) and '${resB}${seqB}' (N) at distance '${distance}' Å (> 2.00 Å).`,
  },
  INVALID_OCCUPANCY: {
    code: 9253,
    rule: "invalid-occupancy",
    severity: "error" as DiagnosticSeverity,
    message: (atomName: string, serial: number | string, occupancy: number | string) =>
      `Atom '${atomName}' (serial '${serial}') has invalid occupancy '${occupancy}' outside allowed bounds [0.0, 1.0].`,
  },
  NON_POSITIVE_B_FACTOR: {
    code: 9254,
    rule: "non-positive-b-factor",
    severity: "warning" as DiagnosticSeverity,
    message: (atomName: string, serial: number | string, bFactor: number | string) =>
      `Atom '${atomName}' (serial '${serial}') has non-positive isotropic temperature factor (B-factor) '${bFactor}' Å^2 (<= 0.0).`,
  },
  RAMACHANDRAN_OUTLIER: {
    code: 9255,
    rule: "ramachandran-outlier",
    severity: "warning" as DiagnosticSeverity,
    message: (chainId: string, resName: string, resSeq: number | string, phi: string | number, psi: string | number) =>
      `Residue '${resName}${resSeq}' in chain '${chainId}' has Ramachandran backbone torsion angles (phi='${phi}' deg, psi='${psi}' deg) in a disallowed steric region.`,
  },
  MISSING_BACKBONE_ATOMS: {
    code: 9256,
    rule: "missing-backbone-atoms",
    severity: "error" as DiagnosticSeverity,
    message: (chainId: string, resName: string, resSeq: number | string, missingAtoms: string) =>
      `Standard amino acid residue '${resName}${resSeq}' in chain '${chainId}' is missing required main-chain backbone atoms '${missingAtoms}'.`,
  },
  INVALID_DISULFIDE_DISTANCE: {
    code: 9257,
    rule: "invalid-disulfide-distance",
    severity: "warning" as DiagnosticSeverity,
    message: (
      chain1: string,
      seq1: number | string,
      chain2: string,
      seq2: number | string,
      distance: string | number,
    ) =>
      `Disulfide bond (SSBOND) between 'CYS${seq1}' (chain '${chain1}') and 'CYS${seq2}' (chain '${chain2}') has invalid SG-SG distance '${distance}' Å outside [1.80, 2.50] Å.`,
  },
  UNRESOLVED_CONECT_SERIAL: {
    code: 9258,
    rule: "unresolved-conect-serial",
    severity: "error" as DiagnosticSeverity,
    message: (conectSerial: number | string, missingSerial: number | string) =>
      `CONECT record for atom serial '${conectSerial}' references unresolved atom serial '${missingSerial}'.`,
  },
  DUPLICATE_ATOM_SERIAL: {
    code: 9259,
    rule: "duplicate-atom-serial",
    severity: "error" as DiagnosticSeverity,
    message: (serial: number | string, atomName: string) =>
      `Duplicate atom serial number '${serial}' declared on atom '${atomName}'.`,
  },
  EMPTY_PDB_STRUCTURE: {
    code: 9260,
    rule: "empty-pdb-structure",
    severity: "error" as DiagnosticSeverity,
    message: (structureId: string) =>
      `Macromolecular structure '${structureId}' contains zero atomic coordinate records.`,
  },
} as const;
