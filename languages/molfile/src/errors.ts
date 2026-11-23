// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`MOL1001`–`MOL5006`) for `@modelscript/molfile`.
 */

export type MolfileSeverity = "error" | "warning" | "info";

export interface MolfileErrorSpec<Args extends unknown[] = string[]> {
  readonly code: string;
  readonly numericCode: number;
  readonly rule: string;
  readonly severity: MolfileSeverity;
  readonly message: (...args: Args) => string;
}

export const MolfileErrorCode = {
  // 1xxx — Syntax & Structural Framing
  SYNTAX_ERROR: {
    code: "MOL1001",
    numericCode: 1001,
    rule: "syntax-error",
    severity: "error" as MolfileSeverity,
    message: (detail: string) => `Molfile/SDF syntax error: ${detail}.`,
  },
  MISSING_M_END: {
    code: "MOL1002",
    numericCode: 1002,
    rule: "missing-m-end",
    severity: "error" as MolfileSeverity,
    message: (recordName: string) => `Molfile record '${recordName}' is missing the required 'M  END' terminator.`,
  },

  // 2xxx — Counts & Connectivity Integrity
  ATOM_COUNT_MISMATCH: {
    code: "MOL2001",
    numericCode: 2001,
    rule: "atom-count-mismatch",
    severity: "error" as MolfileSeverity,
    message: (declared: string, actual: string) =>
      `Counts line declares ${declared} atoms, but ${actual} atom records were parsed.`,
  },
  BOND_COUNT_MISMATCH: {
    code: "MOL2002",
    numericCode: 2002,
    rule: "bond-count-mismatch",
    severity: "error" as MolfileSeverity,
    message: (declared: string, actual: string) =>
      `Counts line declares ${declared} bonds, but ${actual} bond records were parsed.`,
  },
  BOND_ATOM_OUT_OF_RANGE: {
    code: "MOL2003",
    numericCode: 2003,
    rule: "bond-atom-out-of-range",
    severity: "error" as MolfileSeverity,
    message: (bondIdx: string, atomIdx: string, maxAtoms: string) =>
      `Bond #${bondIdx} references out-of-range atom index '${atomIdx}' (valid range: 1..${maxAtoms}).`,
  },

  // 3xxx — Element, Bond Order & Stereo Validation
  UNKNOWN_ELEMENT: {
    code: "MOL3001",
    numericCode: 3001,
    rule: "unknown-element",
    severity: "error" as MolfileSeverity,
    message: (atomIdx: string, symbol: string) =>
      `Atom #${atomIdx} has unknown or unsupported element symbol '${symbol}'.`,
  },
  INVALID_BOND_ORDER: {
    code: "MOL3002",
    numericCode: 3002,
    rule: "invalid-bond-order",
    severity: "error" as MolfileSeverity,
    message: (bondIdx: string, order: string) => `Bond #${bondIdx} has invalid bond order '${order}' (expected 1..8).`,
  },
  INVALID_BOND_STEREO: {
    code: "MOL3003",
    numericCode: 3003,
    rule: "invalid-bond-stereo",
    severity: "error" as MolfileSeverity,
    message: (bondIdx: string, stereo: string) =>
      `Bond #${bondIdx} has invalid stereo flag '${stereo}' (expected 0, 1, 3, 4, or 6).`,
  },

  // 4xxx — Graph Topology
  SELF_LOOP_BOND: {
    code: "MOL4001",
    numericCode: 4001,
    rule: "self-loop-bond",
    severity: "error" as MolfileSeverity,
    message: (bondIdx: string, atomIdx: string) =>
      `Bond #${bondIdx} is a self-loop connecting atom #${atomIdx} to itself.`,
  },
  DUPLICATE_BOND: {
    code: "MOL4002",
    numericCode: 4002,
    rule: "duplicate-bond",
    severity: "error" as MolfileSeverity,
    message: (bondIdx: string, atom1: string, atom2: string) =>
      `Bond #${bondIdx} duplicates an existing bond between atoms #${atom1} and #${atom2}.`,
  },

  // 5xxx — Chemical Valence, Charge & Geometry
  VALENCE_VIOLATION: {
    code: "MOL5001",
    numericCode: 5001,
    rule: "valence-violation",
    severity: "error" as MolfileSeverity,
    message: (atomIdx: string, element: string, bondOrderSum: string, maxValence: string) =>
      `Atom #${atomIdx} ('${element}') exceeds maximum allowed valence: bond order sum ${bondOrderSum} > ${maxValence}.`,
  },
  INVALID_FORMAL_CHARGE: {
    code: "MOL5002",
    numericCode: 5002,
    rule: "invalid-formal-charge",
    severity: "warning" as MolfileSeverity,
    message: (atomIdx: string, element: string, charge: string) =>
      `Atom #${atomIdx} ('${element}') has unusual formal charge '${charge}'.`,
  },
  ZERO_LENGTH_BOND: {
    code: "MOL5006",
    numericCode: 5006,
    rule: "zero-length-bond",
    severity: "warning" as MolfileSeverity,
    message: (bondIdx: string, atom1: string, atom2: string) =>
      `Bond #${bondIdx} between atoms #${atom1} and #${atom2} has zero Euclidean length in 3D coordinates.`,
  },
} as const;

export type MolfileErrorKey = keyof typeof MolfileErrorCode;
