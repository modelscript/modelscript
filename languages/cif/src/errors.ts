// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/cif` (CIF1001–CIF5006).
 */

export type CifSeverity = "error" | "warning" | "info";

export interface CifErrorSpec<Args extends unknown[] = unknown[]> {
  code: string;
  numericCode: number;
  rule: string;
  severity: CifSeverity;
  message: (...args: Args) => string;
}

export const CifErrorCode = {
  SYNTAX_ERROR: {
    code: "CIF1001",
    numericCode: 1001,
    rule: "syntax-error",
    severity: "error" as CifSeverity,
    message: (detail: string) => `CIF syntax error: ${detail}.`,
  },
  MISSING_END_COMMAND: {
    code: "CIF1002",
    numericCode: 1002,
    rule: "missing-end-command",
    severity: "warning" as CifSeverity,
    message: () => "CIF file is missing terminating 'E' (End) command.",
  },
  UNMATCHED_DS: {
    code: "CIF2001",
    numericCode: 2001,
    rule: "unmatched-ds",
    severity: "error" as CifSeverity,
    message: (symbolId: number) => `Definition Start 'DS ${symbolId}' is not closed by a matching 'DF' command.`,
  },
  UNMATCHED_DF: {
    code: "CIF2002",
    numericCode: 2002,
    rule: "unmatched-df",
    severity: "error" as CifSeverity,
    message: () => "Definition Finish 'DF' encountered outside any active 'DS' symbol definition.",
  },
  NESTED_DS: {
    code: "CIF2003",
    numericCode: 2003,
    rule: "nested-ds",
    severity: "error" as CifSeverity,
    message: (symbolId: number, parentId: number) =>
      `Nested Definition Start 'DS ${symbolId}' is not permitted inside open definition 'DS ${parentId}'.`,
  },
  DUPLICATE_SYMBOL_ID: {
    code: "CIF2004",
    numericCode: 2004,
    rule: "duplicate-symbol-id",
    severity: "error" as CifSeverity,
    message: (symbolId: number) => `Duplicate symbol definition ID '${symbolId}' in 'DS' command.`,
  },
  UNDEFINED_SYMBOL_CALL: {
    code: "CIF3001",
    numericCode: 3001,
    rule: "undefined-symbol-call",
    severity: "error" as CifSeverity,
    message: (symbolId: number) => `Call command 'C ${symbolId}' references undefined symbol ID '${symbolId}'.`,
  },
  RECURSIVE_SYMBOL_CYCLE: {
    code: "CIF3002",
    numericCode: 3002,
    rule: "recursive-symbol-cycle",
    severity: "error" as CifSeverity,
    message: (cyclePath: string) => `Recursive symbol call cycle detected: ${cyclePath}.`,
  },
  GEOMETRY_BEFORE_LAYER: {
    code: "CIF4001",
    numericCode: 4001,
    rule: "geometry-before-layer",
    severity: "error" as CifSeverity,
    message: (primitiveKind: string) =>
      `Geometry command '${primitiveKind}' appears before any active 'L' layer specification.`,
  },
  INVALID_SCALE_FACTOR: {
    code: "CIF4002",
    numericCode: 4002,
    rule: "invalid-scale-factor",
    severity: "error" as CifSeverity,
    message: (symbolId: number, a: number, b: number) =>
      `Symbol 'DS ${symbolId}' has non-positive scale factor '${a}/${b}'.`,
  },
  NON_POSITIVE_BOX_DIM: {
    code: "CIF5001",
    numericCode: 5001,
    rule: "non-positive-box-dimension",
    severity: "error" as CifSeverity,
    message: (length: number, width: number) =>
      `Box command 'B' must have positive length and width (got length=${length}, width=${width}).`,
  },
  NON_POSITIVE_ROUNDFLASH_DIM: {
    code: "CIF5002",
    numericCode: 5002,
    rule: "non-positive-roundflash-dimension",
    severity: "error" as CifSeverity,
    message: (diameter: number) => `Roundflash command 'R' must have positive diameter (got ${diameter}).`,
  },
  NON_POSITIVE_WIRE_DIM: {
    code: "CIF5003",
    numericCode: 5003,
    rule: "non-positive-wire-dimension",
    severity: "error" as CifSeverity,
    message: (width: number, pointCount: number) =>
      `Wire command 'W' requires positive width and at least 2 path points (got width=${width}, points=${pointCount}).`,
  },
  DEGENERATE_POLYGON: {
    code: "CIF5004",
    numericCode: 5004,
    rule: "degenerate-polygon",
    severity: "error" as CifSeverity,
    message: (pointCount: number) => `Polygon command 'P' requires at least 3 vertices (got ${pointCount}).`,
  },
  ZERO_ROTATION_VECTOR: {
    code: "CIF5005",
    numericCode: 5005,
    rule: "zero-rotation-vector",
    severity: "error" as CifSeverity,
    message: (context: string) => `Zero direction/rotation vector '(0, 0)' in '${context}' command.`,
  },
  DRC_MIN_WIDTH_VIOLATION: {
    code: "CIF5006",
    numericCode: 5006,
    rule: "drc-min-width-violation",
    severity: "error" as CifSeverity,
    message: (layer: string, actualUnits: number, requiredUnits: number, minWidthLambda: number) =>
      `DRC minimum width violation on layer '${layer}': feature width ${actualUnits.toFixed(2)} CIF units is below minimum ${requiredUnits.toFixed(2)} CIF units (${minWidthLambda}λ).`,
  },
} as const;

export type CifErrorKey = keyof typeof CifErrorCode;
