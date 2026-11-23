// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`GDS1001`–`GDS5006`) for `@modelscript/gdsii`.
 */

export interface GdsiiDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  structureName?: string | undefined;
  layer?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
}

export const GdsiiErrorCode = {
  SYNTAX_STREAM_ERROR: {
    code: 1001,
    id: "GDS1001",
    rule: "syntax-stream-error",
    severity: "error" as const,
    message: (detail: string) => `GDSII stream syntax error: ${detail}.`,
  },
  UNCLOSED_BOUNDARY: {
    code: 2001,
    id: "GDS2001",
    rule: "unclosed-boundary",
    severity: "error" as const,
    message: (structName: string, layer: number) =>
      `Unclosed BOUNDARY polygon in structure '${structName}' on layer ${layer}: first and last XY vertices must coincide (minimum 4 vertices).`,
  },
  UNRESOLVED_STRUCTURE_REF: {
    code: 2002,
    id: "GDS2002",
    rule: "unresolved-structure-ref",
    severity: "error" as const,
    message: (refKind: string, target: string, parentStruct: string) =>
      `Unresolved ${refKind} reference to structure '${target}' in '${parentStruct}'.`,
  },
  CYCLIC_HIERARCHY: {
    code: 2003,
    id: "GDS2003",
    rule: "cyclic-hierarchy",
    severity: "error" as const,
    message: (cyclePath: string) => `Cyclic structure hierarchy detected: ${cyclePath}.`,
  },
  INVALID_LAYER_OR_DATATYPE: {
    code: 3001,
    id: "GDS3001",
    rule: "invalid-layer-or-datatype",
    severity: "error" as const,
    message: (field: string, value: number, structName: string) =>
      `Invalid ${field} value ${value} in structure '${structName}': GDSII requires 0 <= ${field} <= 65535.`,
  },
  ZERO_AREA_POLYGON: {
    code: 3002,
    id: "GDS3002",
    rule: "zero-area-polygon",
    severity: "warning" as const,
    message: (structName: string, layer: number) =>
      `Zero-area degenerate BOUNDARY polygon in structure '${structName}' on layer ${layer}.`,
  },
  DRC_MIN_WIDTH: {
    code: 5001,
    id: "GDS5001",
    rule: "drc-min-width",
    severity: "error" as const,
    message: (structName: string, layer: number, actual: number, required: number) =>
      `DRC min-width violation in '${structName}' on layer ${layer}: feature width ${actual.toFixed(4)} is less than minimum ${required.toFixed(4)}.`,
  },
  DRC_MIN_SPACING: {
    code: 5002,
    id: "GDS5002",
    rule: "drc-min-spacing",
    severity: "error" as const,
    message: (structName: string, layer: number, actual: number, required: number) =>
      `DRC min-spacing violation in '${structName}' on layer ${layer}: feature spacing ${actual.toFixed(4)} is less than minimum ${required.toFixed(4)}.`,
  },
  INVALID_AREF_COLROW: {
    code: 5003,
    id: "GDS5003",
    rule: "invalid-aref-colrow",
    severity: "error" as const,
    message: (structName: string, cols: number, rows: number) =>
      `Invalid AREF COLROW (${cols}, ${rows}) in structure '${structName}': columns and rows must be positive integers (1..32767).`,
  },
  INVALID_PATH_GEOMETRY: {
    code: 5004,
    id: "GDS5004",
    rule: "invalid-path-geometry",
    severity: "error" as const,
    message: (structName: string, layer: number, reason: string) =>
      `Invalid PATH element in structure '${structName}' on layer ${layer}: ${reason}.`,
  },
  INVALID_UNITS: {
    code: 5005,
    id: "GDS5005",
    rule: "invalid-units",
    severity: "error" as const,
    message: (dbInUser: number, dbInMeters: number) =>
      `Invalid GDSII UNITS (${dbInUser}, ${dbInMeters}): both database unit scale factors must be finite positive numbers.`,
  },
  DUPLICATE_STRUCTURE_NAME: {
    code: 5006,
    id: "GDS5006",
    rule: "duplicate-structure-name",
    severity: "error" as const,
    message: (structName: string) => `Duplicate structure name '${structName}' in GDSII library.`,
  },
} as const;
