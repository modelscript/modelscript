// SPDX-License-Identifier: AGPL-3.0-or-later

import { MolfileErrorCode, type MolfileSeverity } from "../errors.js";
import { computeAllowedValences, computeBondLength3D, effectiveBondOrder, isKnownElement } from "../solver/index.js";
import type { MolfileDocument, MolRecord, SourceRange } from "../types.js";

export interface MolfileDiagnostic {
  code: string;
  numericCode: number;
  rule: string;
  severity: MolfileSeverity;
  message: string;
  line: number;
  recordName: string;
  range: SourceRange;
}

const VALID_BOND_STEREO_FLAGS = new Set([0, 1, 3, 4, 6]);

function makeRange(line: number): SourceRange {
  return {
    startLine: line,
    startColumn: 1,
    endLine: line,
    endColumn: 40,
    startOffset: 0,
    endOffset: 0,
  };
}

/**
 * Lints a single `MolRecord` for syntax, structural framing, counts parity,
 * bond connectivity, element validity, stereo flags, formal charges, and valence bounds.
 */
export function lintMolRecord(record: MolRecord): MolfileDiagnostic[] {
  const diags: MolfileDiagnostic[] = [];

  // MOL1001: Syntax / parse errors reported by parser
  for (const err of record.parseErrors) {
    diags.push({
      code: MolfileErrorCode.SYNTAX_ERROR.code,
      numericCode: MolfileErrorCode.SYNTAX_ERROR.numericCode,
      rule: MolfileErrorCode.SYNTAX_ERROR.rule,
      severity: MolfileErrorCode.SYNTAX_ERROR.severity,
      message: MolfileErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      recordName: record.name,
      range: makeRange(err.line),
    });
  }

  // MOL1002: Missing M  END terminator
  if (!record.hasMEnd) {
    diags.push({
      code: MolfileErrorCode.MISSING_M_END.code,
      numericCode: MolfileErrorCode.MISSING_M_END.numericCode,
      rule: MolfileErrorCode.MISSING_M_END.rule,
      severity: MolfileErrorCode.MISSING_M_END.severity,
      message: MolfileErrorCode.MISSING_M_END.message(record.name),
      line: record.range.endLine,
      recordName: record.name,
      range: makeRange(record.range.endLine),
    });
  }

  // MOL2001: Atom count mismatch with counts line
  if (record.counts.atomCount !== record.atoms.length) {
    diags.push({
      code: MolfileErrorCode.ATOM_COUNT_MISMATCH.code,
      numericCode: MolfileErrorCode.ATOM_COUNT_MISMATCH.numericCode,
      rule: MolfileErrorCode.ATOM_COUNT_MISMATCH.rule,
      severity: MolfileErrorCode.ATOM_COUNT_MISMATCH.severity,
      message: MolfileErrorCode.ATOM_COUNT_MISMATCH.message(
        String(record.counts.atomCount),
        String(record.atoms.length),
      ),
      line: record.counts.line,
      recordName: record.name,
      range: makeRange(record.counts.line),
    });
  }

  // MOL2002: Bond count mismatch with counts line
  if (record.counts.bondCount !== record.bonds.length) {
    diags.push({
      code: MolfileErrorCode.BOND_COUNT_MISMATCH.code,
      numericCode: MolfileErrorCode.BOND_COUNT_MISMATCH.numericCode,
      rule: MolfileErrorCode.BOND_COUNT_MISMATCH.rule,
      severity: MolfileErrorCode.BOND_COUNT_MISMATCH.severity,
      message: MolfileErrorCode.BOND_COUNT_MISMATCH.message(
        String(record.counts.bondCount),
        String(record.bonds.length),
      ),
      line: record.counts.line,
      recordName: record.name,
      range: makeRange(record.counts.line),
    });
  }

  const atomByIdx = new Map(record.atoms.map((a) => [a.index, a]));
  const maxAtomIdx = record.atoms.length;

  // MOL3001: Unknown element symbol & MOL5002: Unusual formal charge
  for (const atom of record.atoms) {
    if (!isKnownElement(atom.element)) {
      diags.push({
        code: MolfileErrorCode.UNKNOWN_ELEMENT.code,
        numericCode: MolfileErrorCode.UNKNOWN_ELEMENT.numericCode,
        rule: MolfileErrorCode.UNKNOWN_ELEMENT.rule,
        severity: MolfileErrorCode.UNKNOWN_ELEMENT.severity,
        message: MolfileErrorCode.UNKNOWN_ELEMENT.message(String(atom.index), atom.element),
        line: atom.line,
        recordName: record.name,
        range: makeRange(atom.line),
      });
    }
    if (Math.abs(atom.charge) > 4) {
      diags.push({
        code: MolfileErrorCode.INVALID_FORMAL_CHARGE.code,
        numericCode: MolfileErrorCode.INVALID_FORMAL_CHARGE.numericCode,
        rule: MolfileErrorCode.INVALID_FORMAL_CHARGE.rule,
        severity: MolfileErrorCode.INVALID_FORMAL_CHARGE.severity,
        message: MolfileErrorCode.INVALID_FORMAL_CHARGE.message(String(atom.index), atom.element, String(atom.charge)),
        line: atom.line,
        recordName: record.name,
        range: makeRange(atom.line),
      });
    }
  }

  // Bond checks: MOL2003, MOL3002, MOL3003, MOL4001, MOL4002, MOL5006
  const seenPairs = new Set<string>();
  const bondOrderSum = new Map<number, number>();
  for (const a of record.atoms) bondOrderSum.set(a.index, 0);

  for (const bond of record.bonds) {
    let endpointsValid = true;
    if (bond.atom1 < 1 || bond.atom1 > maxAtomIdx || !atomByIdx.has(bond.atom1)) {
      endpointsValid = false;
      diags.push({
        code: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.code,
        numericCode: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.numericCode,
        rule: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.rule,
        severity: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.severity,
        message: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.message(
          String(bond.index),
          String(bond.atom1),
          String(maxAtomIdx),
        ),
        line: bond.line,
        recordName: record.name,
        range: makeRange(bond.line),
      });
    }
    if (bond.atom2 < 1 || bond.atom2 > maxAtomIdx || !atomByIdx.has(bond.atom2)) {
      endpointsValid = false;
      diags.push({
        code: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.code,
        numericCode: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.numericCode,
        rule: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.rule,
        severity: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.severity,
        message: MolfileErrorCode.BOND_ATOM_OUT_OF_RANGE.message(
          String(bond.index),
          String(bond.atom2),
          String(maxAtomIdx),
        ),
        line: bond.line,
        recordName: record.name,
        range: makeRange(bond.line),
      });
    }

    // MOL3002: Invalid bond order
    if (bond.order < 1 || bond.order > 8) {
      diags.push({
        code: MolfileErrorCode.INVALID_BOND_ORDER.code,
        numericCode: MolfileErrorCode.INVALID_BOND_ORDER.numericCode,
        rule: MolfileErrorCode.INVALID_BOND_ORDER.rule,
        severity: MolfileErrorCode.INVALID_BOND_ORDER.severity,
        message: MolfileErrorCode.INVALID_BOND_ORDER.message(String(bond.index), String(bond.order)),
        line: bond.line,
        recordName: record.name,
        range: makeRange(bond.line),
      });
    }

    // MOL3003: Invalid bond stereo flag
    if (!VALID_BOND_STEREO_FLAGS.has(bond.stereo)) {
      diags.push({
        code: MolfileErrorCode.INVALID_BOND_STEREO.code,
        numericCode: MolfileErrorCode.INVALID_BOND_STEREO.numericCode,
        rule: MolfileErrorCode.INVALID_BOND_STEREO.rule,
        severity: MolfileErrorCode.INVALID_BOND_STEREO.severity,
        message: MolfileErrorCode.INVALID_BOND_STEREO.message(String(bond.index), String(bond.stereo)),
        line: bond.line,
        recordName: record.name,
        range: makeRange(bond.line),
      });
    }

    // MOL4001: Self-loop bond
    if (bond.atom1 === bond.atom2) {
      diags.push({
        code: MolfileErrorCode.SELF_LOOP_BOND.code,
        numericCode: MolfileErrorCode.SELF_LOOP_BOND.numericCode,
        rule: MolfileErrorCode.SELF_LOOP_BOND.rule,
        severity: MolfileErrorCode.SELF_LOOP_BOND.severity,
        message: MolfileErrorCode.SELF_LOOP_BOND.message(String(bond.index), String(bond.atom1)),
        line: bond.line,
        recordName: record.name,
        range: makeRange(bond.line),
      });
      continue;
    }

    // MOL4002: Duplicate bond between same atom pair
    const lo = Math.min(bond.atom1, bond.atom2);
    const hi = Math.max(bond.atom1, bond.atom2);
    const pairKey = `${lo}:${hi}`;
    if (seenPairs.has(pairKey)) {
      diags.push({
        code: MolfileErrorCode.DUPLICATE_BOND.code,
        numericCode: MolfileErrorCode.DUPLICATE_BOND.numericCode,
        rule: MolfileErrorCode.DUPLICATE_BOND.rule,
        severity: MolfileErrorCode.DUPLICATE_BOND.severity,
        message: MolfileErrorCode.DUPLICATE_BOND.message(String(bond.index), String(lo), String(hi)),
        line: bond.line,
        recordName: record.name,
        range: makeRange(bond.line),
      });
    } else {
      seenPairs.add(pairKey);
    }

    if (endpointsValid) {
      const bo = effectiveBondOrder(bond.order);
      bondOrderSum.set(bond.atom1, (bondOrderSum.get(bond.atom1) ?? 0) + bo);
      bondOrderSum.set(bond.atom2, (bondOrderSum.get(bond.atom2) ?? 0) + bo);

      // MOL5006: Zero-length bond when 3D coordinates are present
      if (record.header.dimensionCode === "3D") {
        const a1 = atomByIdx.get(bond.atom1)!;
        const a2 = atomByIdx.get(bond.atom2)!;
        if (computeBondLength3D(a1, a2) < 1e-6) {
          diags.push({
            code: MolfileErrorCode.ZERO_LENGTH_BOND.code,
            numericCode: MolfileErrorCode.ZERO_LENGTH_BOND.numericCode,
            rule: MolfileErrorCode.ZERO_LENGTH_BOND.rule,
            severity: MolfileErrorCode.ZERO_LENGTH_BOND.severity,
            message: MolfileErrorCode.ZERO_LENGTH_BOND.message(
              String(bond.index),
              String(bond.atom1),
              String(bond.atom2),
            ),
            line: bond.line,
            recordName: record.name,
            range: makeRange(bond.line),
          });
        }
      }
    }
  }

  // MOL5001: Valence violation (e.g. pentavalent neutral carbon)
  for (const atom of record.atoms) {
    if (!isKnownElement(atom.element)) continue;
    const sum = bondOrderSum.get(atom.index) ?? 0;
    const allowed = computeAllowedValences(atom.element, atom.charge);
    if (allowed.length === 0) continue;
    const maxValence = Math.max(...allowed);
    if (sum > maxValence + 1e-6) {
      diags.push({
        code: MolfileErrorCode.VALENCE_VIOLATION.code,
        numericCode: MolfileErrorCode.VALENCE_VIOLATION.numericCode,
        rule: MolfileErrorCode.VALENCE_VIOLATION.rule,
        severity: MolfileErrorCode.VALENCE_VIOLATION.severity,
        message: MolfileErrorCode.VALENCE_VIOLATION.message(
          String(atom.index),
          atom.element,
          String(sum),
          String(maxValence),
        ),
        line: atom.line,
        recordName: record.name,
        range: makeRange(atom.line),
      });
    }
  }

  return diags;
}

/**
 * Lints all records in a `MolfileDocument`.
 */
export function lintMolfile(doc: MolfileDocument): MolfileDiagnostic[] {
  const out: MolfileDiagnostic[] = [];
  for (const record of doc.records) {
    out.push(...lintMolRecord(record));
  }
  return out;
}
