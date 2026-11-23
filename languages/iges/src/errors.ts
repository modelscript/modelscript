// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Standard IGES 5.3 Diagnostic Error Codes (IGES1001–IGES5006).
 */

export const IgesErrorCode = {
  SYNTAX_COLUMN_WIDTH: {
    code: 1001,
    id: "IGES1001",
    rule: "syntax-column-width",
    severity: "error" as const,
    message: (line: number, detail: string) => `IGES line ${line} column/syntax error: ${detail}.`,
  },
  INVALID_HOLLERITH_STRING: {
    code: 1002,
    id: "IGES1002",
    rule: "invalid-hollerith-string",
    severity: "error" as const,
    message: (token: string, detail: string) => `Invalid Hollerith string '${token}': ${detail}.`,
  },
  INVALID_SECTION_ORDER: {
    code: 1003,
    id: "IGES1003",
    rule: "invalid-section-order",
    severity: "error" as const,
    message: (found: string, previous: string) =>
      `IGES section '${found}' appears out of order after section '${previous}' (expected S -> G -> D -> P -> T).`,
  },
  MISSING_START_SECTION: {
    code: 2001,
    id: "IGES2001",
    rule: "missing-start-section",
    severity: "error" as const,
    message: () => "IGES file is missing mandatory Start ('S') section.",
  },
  MISSING_GLOBAL_SECTION: {
    code: 2002,
    id: "IGES2002",
    rule: "missing-global-section",
    severity: "error" as const,
    message: () => "IGES file is missing mandatory Global ('G') section.",
  },
  MISSING_DIRECTORY_SECTION: {
    code: 2003,
    id: "IGES2003",
    rule: "missing-directory-section",
    severity: "error" as const,
    message: () => "IGES file is missing mandatory Directory Entry ('D') section.",
  },
  MISSING_PARAMETER_SECTION: {
    code: 2004,
    id: "IGES2004",
    rule: "missing-parameter-section",
    severity: "error" as const,
    message: () => "IGES file is missing mandatory Parameter Data ('P') section.",
  },
  MISSING_TERMINATE_SECTION: {
    code: 2005,
    id: "IGES2005",
    rule: "missing-terminate-section",
    severity: "error" as const,
    message: () => "IGES file is missing mandatory Terminate ('T') section.",
  },
  MISMATCHED_TERMINATE_COUNTS: {
    code: 2006,
    id: "IGES2006",
    rule: "mismatched-terminate-counts",
    severity: "error" as const,
    message: (section: string, declared: number, actual: number) =>
      `Terminate section count mismatch for '${section}': declared ${declared}, actual ${actual}.`,
  },
  INVALID_DE_POINTER: {
    code: 3001,
    id: "IGES3001",
    rule: "invalid-de-pointer",
    severity: "error" as const,
    message: (pointer: number, context: string) =>
      `Invalid Directory Entry pointer '${pointer}' in ${context} (must reference an existing odd DE sequence number).`,
  },
  INCOMPLETE_DE_RECORD: {
    code: 3002,
    id: "IGES3002",
    rule: "incomplete-de-record",
    severity: "error" as const,
    message: (deNumber: number) =>
      `Directory Entry 'D${deNumber}' has an odd-line record without its matching second line.`,
  },
  DE_ENTITY_TYPE_MISMATCH: {
    code: 3003,
    id: "IGES3003",
    rule: "de-entity-type-mismatch",
    severity: "error" as const,
    message: (deNumber: number, expected: number, actual: number) =>
      `Directory Entry 'D${deNumber}' entity type mismatch: expected '${expected}', found '${actual}'.`,
  },
  INVALID_UNIT_FLAG: {
    code: 4001,
    id: "IGES4001",
    rule: "invalid-unit-flag",
    severity: "error" as const,
    message: (unitFlag: number) =>
      `Global section unit flag '${unitFlag}' is outside the valid IGES 5.3 range (1..11).`,
  },
  MISSING_PARAMETER_DATA: {
    code: 4002,
    id: "IGES4002",
    rule: "missing-parameter-data",
    severity: "error" as const,
    message: (deNumber: number) => `Directory Entry 'D${deNumber}' has no corresponding Parameter Data ('P') record.`,
  },
  DEGENERATE_ZERO_LENGTH_LINE: {
    code: 5001,
    id: "IGES5001",
    rule: "degenerate-zero-length-line",
    severity: "error" as const,
    message: (deNumber: number) => `Line entity 'D${deNumber}' (Type 110) is degenerate with zero length.`,
  },
  DEGENERATE_ZERO_RADIUS_ARC: {
    code: 5002,
    id: "IGES5002",
    rule: "degenerate-zero-radius-arc",
    severity: "error" as const,
    message: (deNumber: number, detail: string) =>
      `Circular Arc entity 'D${deNumber}' (Type 100) is degenerate: ${detail}.`,
  },
  NON_MONOTONIC_NURBS_KNOTS: {
    code: 5003,
    id: "IGES5003",
    rule: "non-monotonic-nurbs-knots",
    severity: "error" as const,
    message: (deNumber: number, axis: string, index: number) =>
      `NURBS entity 'D${deNumber}' has non-monotonic ${axis} knot vector at index ${index}.`,
  },
  INVALID_NURBS_WEIGHTS: {
    code: 5004,
    id: "IGES5004",
    rule: "invalid-nurbs-weights",
    severity: "error" as const,
    message: (deNumber: number, detail: string) =>
      `NURBS entity 'D${deNumber}' has invalid weights or knot/control-point counts: ${detail}.`,
  },
  SINGULAR_TRANSFORM_MATRIX: {
    code: 5005,
    id: "IGES5005",
    rule: "singular-transform-matrix",
    severity: "warning" as const,
    message: (deNumber: number, det: number) =>
      `Transformation Matrix 'D${deNumber}' (Type 124) is nearly singular (det=${det.toExponential(3)}).`,
  },
  INVALID_BREP_REFERENCE: {
    code: 5006,
    id: "IGES5006",
    rule: "invalid-brep-reference",
    severity: "error" as const,
    message: (deNumber: number, pointer: number) =>
      `Manifold Solid B-Rep 'D${deNumber}' (Type 186) references invalid shell pointer '${pointer}'.`,
  },
} as const;

export type IgesErrorCodeKey = keyof typeof IgesErrorCode;
