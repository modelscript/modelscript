// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error code catalog for `@modelscript/gaussian` (GAU1001–GAU5006).
 */

export interface GaussianErrorDefinition {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: never[]) => string;
}

export const GaussianErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "GAU1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Gaussian input syntax error: ${detail}.`,
  },
  MISSING_ROUTE_SECTION: {
    code: 1002,
    id: "GAU1002",
    rule: "missing-route-section",
    severity: "error" as const,
    message: (stepIndex: number) => `Job step ${stepIndex + 1} is missing a required route section starting with '#'.`,
  },
  MISSING_CHARGE_MULTIPLICITY: {
    code: 1003,
    id: "GAU1003",
    rule: "missing-charge-multiplicity",
    severity: "error" as const,
    message: (stepIndex: number) =>
      `Job step ${stepIndex + 1} is missing a valid charge and spin multiplicity specification.`,
  },
  UNKNOWN_ELEMENT: {
    code: 2001,
    id: "GAU2001",
    rule: "unknown-element",
    severity: "error" as const,
    message: (symbol: string, atomIndex: number) => `Unknown chemical element symbol '${symbol}' at atom ${atomIndex}.`,
  },
  UNDEFINED_ZMATRIX_VARIABLE: {
    code: 2002,
    id: "GAU2002",
    rule: "undefined-zmatrix-variable",
    severity: "error" as const,
    message: (varName: string, atomIndex: number) =>
      `Undefined Z-matrix variable '${varName}' referenced at atom ${atomIndex}.`,
  },
  DUPLICATE_VARIABLE: {
    code: 2003,
    id: "GAU2003",
    rule: "duplicate-variable",
    severity: "warning" as const,
    message: (varName: string) => `Duplicate Z-matrix variable definition '${varName}'.`,
  },
  INVALID_CHARGE_MULTIPLICITY_PARITY: {
    code: 3001,
    id: "GAU3001",
    rule: "invalid-charge-multiplicity-parity",
    severity: "error" as const,
    message: (electrons: number, charge: number, multiplicity: number) =>
      `Incompatible electron count (${electrons}, charge ${charge}) and spin multiplicity (${multiplicity}): ${
        electrons % 2 === 0
          ? "even electron systems require an odd multiplicity"
          : "odd electron systems require an even multiplicity"
      }.`,
  },
  INVALID_MULTIPLICITY_VALUE: {
    code: 3002,
    id: "GAU3002",
    rule: "invalid-multiplicity-value",
    severity: "error" as const,
    message: (multiplicity: number, electrons: number) =>
      `Invalid spin multiplicity ${multiplicity} for a system with ${electrons} electrons (must be >= 1 and <= ${electrons + 1}).`,
  },
  ZMATRIX_INVALID_ATOM_REF: {
    code: 4001,
    id: "GAU4001",
    rule: "zmatrix-invalid-atom-ref",
    severity: "error" as const,
    message: (refIndex: number, atomIndex: number) =>
      `Invalid Z-matrix atom reference ${refIndex} at atom ${atomIndex}: reference must be between 1 and ${atomIndex - 1}.`,
  },
  ZMATRIX_DUPLICATE_ATOM_REF: {
    code: 4002,
    id: "GAU4002",
    rule: "zmatrix-duplicate-atom-ref",
    severity: "error" as const,
    message: (refIndex: number, atomIndex: number) =>
      `Duplicate Z-matrix reference to atom ${refIndex} in atom ${atomIndex} definition.`,
  },
  ZMATRIX_COLLINEAR_REFERENCE: {
    code: 4003,
    id: "GAU4003",
    rule: "zmatrix-collinear-reference",
    severity: "error" as const,
    message: (atomIndex: number, refA: number, refB: number, refC: number) =>
      `Collinear Z-matrix reference atoms (${refA}, ${refB}, ${refC}) for dihedral angle at atom ${atomIndex}.`,
  },
  NON_POSITIVE_BOND_LENGTH: {
    code: 4004,
    id: "GAU4004",
    rule: "non-positive-bond-length",
    severity: "error" as const,
    message: (length: number, atomIndex: number) =>
      `Non-positive bond length (${length} Å) at atom ${atomIndex}; bond length must be > 0.`,
  },
  INVALID_BOND_ANGLE: {
    code: 4005,
    id: "GAU4005",
    rule: "invalid-bond-angle",
    severity: "error" as const,
    message: (angle: number, atomIndex: number) =>
      `Invalid Z-matrix bond angle (${angle}°) at atom ${atomIndex}; bond angle must lie strictly between 0° and 180°.`,
  },
  INVALID_MEM_DIRECTIVE: {
    code: 5001,
    id: "GAU5001",
    rule: "invalid-mem-directive",
    severity: "error" as const,
    message: (rawVal: string) =>
      `Invalid Link0 '%mem' directive value '${rawVal}': expected positive size with optional unit (KB, MB, GB, TB, KW, MW, GW).`,
  },
  INVALID_NPROC_DIRECTIVE: {
    code: 5002,
    id: "GAU5002",
    rule: "invalid-nproc-directive",
    severity: "error" as const,
    message: (directive: string, rawVal: string) =>
      `Invalid Link0 '%${directive}' directive value '${rawVal}': expected a positive integer.`,
  },
  EMPTY_MOLECULE: {
    code: 5003,
    id: "GAU5003",
    rule: "empty-molecule",
    severity: "warning" as const,
    message: (stepIndex: number) => `Job step ${stepIndex + 1} contains no atoms in the molecule specification.`,
  },
  MISSING_TITLE_SECTION: {
    code: 5004,
    id: "GAU5004",
    rule: "missing-title-section",
    severity: "warning" as const,
    message: (stepIndex: number) => `Job step ${stepIndex + 1} has an empty or missing title section.`,
  },
  UNKNOWN_METHOD_OR_BASIS: {
    code: 5005,
    id: "GAU5005",
    rule: "unknown-method-or-basis",
    severity: "info" as const,
    message: (token: string) => `Unrecognized quantum chemistry method or basis set '${token}' in route section.`,
  },
  OVERLAPPING_ATOMS: {
    code: 5006,
    id: "GAU5006",
    rule: "overlapping-atoms",
    severity: "warning" as const,
    message: (atom1: number, atom2: number, distance: number) =>
      `Atoms ${atom1} and ${atom2} are unusually close (${distance.toFixed(4)} Å < 0.40 Å).`,
  },
} as const;

export type GaussianErrorKey = keyof typeof GaussianErrorCode;
