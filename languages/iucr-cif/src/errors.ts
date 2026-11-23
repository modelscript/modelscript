// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`ICIF1001`–`ICIF5006`) for `@modelscript/iucr-cif`.
 */

export type IucrCifSeverity = "error" | "warning" | "info";

export interface IucrCifErrorDescriptor {
  code: string;
  rule: string;
  severity: IucrCifSeverity;
  message: (...args: string[]) => string;
}

export const IucrCifErrorCode = {
  SYNTAX_ERROR: {
    code: "ICIF1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `STAR/CIF syntax error: ${detail}.`,
  },
  DUPLICATE_DATA_BLOCK: {
    code: "ICIF2001",
    rule: "duplicate-data-block",
    severity: "error" as const,
    message: (blockName: string) => `Duplicate data block 'data_${blockName}' in CIF document.`,
  },
  DUPLICATE_TAG: {
    code: "ICIF2002",
    rule: "duplicate-tag",
    severity: "error" as const,
    message: (tag: string, blockName: string) => `Duplicate data name '${tag}' in block 'data_${blockName}'.`,
  },
  LOOP_COLUMN_MISMATCH: {
    code: "ICIF3001",
    rule: "loop-column-mismatch",
    severity: "error" as const,
    message: (valueCount: string, colCount: string) =>
      `Loop value count (${valueCount}) is not divisible by column count (${colCount}).`,
  },
  EMPTY_LOOP: {
    code: "ICIF3002",
    rule: "empty-loop",
    severity: "warning" as const,
    message: (detail: string) => `Empty or incomplete loop_ structure: ${detail}.`,
  },
  NON_POSITIVE_CELL_LENGTH: {
    code: "ICIF4001",
    rule: "non-positive-cell-length",
    severity: "error" as const,
    message: (param: string, val: string) => `Unit cell length '${param}' must be positive (got ${val}).`,
  },
  INVALID_CELL_ANGLE: {
    code: "ICIF4002",
    rule: "invalid-cell-angle",
    severity: "error" as const,
    message: (param: string, val: string) =>
      `Unit cell angle '${param}' must lie strictly in (0, 180) degrees (got ${val}).`,
  },
  DEGENERATE_METRIC_TENSOR: {
    code: "ICIF4003",
    rule: "degenerate-metric-tensor",
    severity: "error" as const,
    message: (detVal: string) =>
      `Unit cell metric tensor is degenerate (det(G) = ${detVal} <= 0); angles do not form a valid 3D cell.`,
  },
  MISSING_ATOM_FRACT_COORDS: {
    code: "ICIF5001",
    rule: "missing-atom-fract-coords",
    severity: "error" as const,
    message: (missing: string) => `Atom site loop is missing required fractional coordinate tag(s): ${missing}.`,
  },
  INVALID_OCCUPANCY: {
    code: "ICIF5002",
    rule: "invalid-occupancy",
    severity: "error" as const,
    message: (label: string, occ: string) =>
      `Atom site '${label}' has invalid fractional occupancy ${occ}; expected value in (0, 1].`,
  },
  OVERLAPPING_ATOMS: {
    code: "ICIF5003",
    rule: "overlapping-atoms",
    severity: "error" as const,
    message: (labelA: string, labelB: string, dist: string) =>
      `Overlapping atoms '${labelA}' and '${labelB}' separated by ${dist} Å (< 0.5 Å).`,
  },
  MISSING_CELL_PARAMETERS: {
    code: "ICIF5004",
    rule: "missing-cell-parameters",
    severity: "warning" as const,
    message: (missing: string) => `Incomplete unit cell parameters in data block; missing: ${missing}.`,
  },
  INVALID_SYMMETRY_OP: {
    code: "ICIF5005",
    rule: "invalid-symmetry-op",
    severity: "error" as const,
    message: (op: string) => `Invalid symmetry operation '${op}' in _symmetry_equiv_pos_as_xyz.`,
  },
  UNKNOWN_ELEMENT_SYMBOL: {
    code: "ICIF5006",
    rule: "unknown-element-symbol",
    severity: "warning" as const,
    message: (symbol: string, label: string) =>
      `Unrecognized chemical element symbol '${symbol}' on atom site '${label}'.`,
  },
} as const satisfies Record<string, IucrCifErrorDescriptor>;

export type IucrCifErrorKey = keyof typeof IucrCifErrorCode;

export interface IucrCifDiagnostic {
  code: string;
  rule: string;
  severity: IucrCifSeverity;
  message: string;
  line: number;
  column: number;
  blockName?: string | undefined;
  tag?: string | undefined;
}
