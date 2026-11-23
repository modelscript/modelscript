// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dxf — Standard Diagnostic Error Codes (DXF1001–DXF5006).
 */

export const DxfErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "DXF1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `DXF syntax error: ${detail}.`,
  },
  UNCLOSED_SECTION: {
    code: 1002,
    id: "DXF1002",
    rule: "unclosed-section",
    severity: "error" as const,
    message: (sectionName: string) => `DXF SECTION '${sectionName}' is not closed by a matching 'ENDSEC'.`,
  },
  MISSING_EOF: {
    code: 1003,
    id: "DXF1003",
    rule: "missing-eof",
    severity: "error" as const,
    message: () => `DXF file is missing the required '0 / EOF' end-of-file marker.`,
  },
  UNEXPECTED_ENDSEC: {
    code: 1004,
    id: "DXF1004",
    rule: "unexpected-endsec",
    severity: "error" as const,
    message: () => `Unexpected 'ENDSEC' encountered outside of an active DXF SECTION.`,
  },
  UNDEFINED_LAYER: {
    code: 2001,
    id: "DXF2001",
    rule: "undefined-layer",
    severity: "warning" as const,
    message: (entityType: string, layerName: string) =>
      `Entity '${entityType}' references layer '${layerName}' which is not defined in the LAYER table.`,
  },
  UNDEFINED_BLOCK: {
    code: 2002,
    id: "DXF2002",
    rule: "undefined-block",
    severity: "error" as const,
    message: (blockName: string) => `INSERT entity references undefined block '${blockName}'.`,
  },
  CYCLIC_BLOCK_REFERENCE: {
    code: 2003,
    id: "DXF2003",
    rule: "cyclic-block-reference",
    severity: "error" as const,
    message: (cyclePath: string) => `Cyclic INSERT block reference detected: ${cyclePath}.`,
  },
  ZERO_RADIUS_CIRCLE: {
    code: 3001,
    id: "DXF3001",
    rule: "zero-radius-circle",
    severity: "error" as const,
    message: (radius: number) => `CIRCLE entity has non-positive radius '${radius}'.`,
  },
  ZERO_RADIUS_ARC: {
    code: 3002,
    id: "DXF3002",
    rule: "zero-radius-arc",
    severity: "error" as const,
    message: (radius: number) => `ARC entity has non-positive radius '${radius}'.`,
  },
  DEGENERATE_LWPOLYLINE: {
    code: 3003,
    id: "DXF3003",
    rule: "degenerate-lwpolyline",
    severity: "error" as const,
    message: (vertexCount: number) =>
      `Degenerate LWPOLYLINE entity has only ${vertexCount} vertex(es); at least 2 are required.`,
  },
  DEGENERATE_3DFACE: {
    code: 3004,
    id: "DXF3004",
    rule: "degenerate-3dface",
    severity: "error" as const,
    message: () => `Degenerate 3DFACE entity has zero surface area (coincident or collinear vertices).`,
  },
  DEGENERATE_ELLIPSE: {
    code: 3005,
    id: "DXF3005",
    rule: "degenerate-ellipse",
    severity: "error" as const,
    message: (detail: string) => `Degenerate ELLIPSE entity: ${detail}.`,
  },
  INVALID_INSUNITS: {
    code: 4001,
    id: "DXF4001",
    rule: "invalid-insunits",
    severity: "error" as const,
    message: (value: string | number) =>
      `Invalid HEADER variable '$INSUNITS' value '${value}'; expected an integer unit code between 0 and 20.`,
  },
  UNCLOSED_BLOCK: {
    code: 4002,
    id: "DXF4002",
    rule: "unclosed-block",
    severity: "error" as const,
    message: (blockName: string) => `BLOCK '${blockName}' is not closed by a matching 'ENDBLK'.`,
  },
  ZERO_LENGTH_LINE: {
    code: 5001,
    id: "DXF5001",
    rule: "zero-length-line",
    severity: "warning" as const,
    message: () => `LINE entity has zero length (start and end points are coincident).`,
  },
  ZERO_SCALE_INSERT: {
    code: 5002,
    id: "DXF5002",
    rule: "zero-scale-insert",
    severity: "warning" as const,
    message: (blockName: string) => `INSERT entity for block '${blockName}' has a zero scale factor.`,
  },
  INVALID_SPLINE_DEGREE: {
    code: 5003,
    id: "DXF5003",
    rule: "invalid-spline-degree",
    severity: "error" as const,
    message: (degree: number, ctrlCount: number) =>
      `SPLINE entity with degree '${degree}' requires at least ${degree + 1} control points (found ${ctrlCount}).`,
  },
  UNCLOSED_POLYLINE: {
    code: 5004,
    id: "DXF5004",
    rule: "unclosed-polyline",
    severity: "error" as const,
    message: () => `POLYLINE entity is missing its terminating 'SEQEND' record.`,
  },
  DUPLICATE_LAYER: {
    code: 5005,
    id: "DXF5005",
    rule: "duplicate-layer",
    severity: "warning" as const,
    message: (layerName: string) => `Layer '${layerName}' is defined multiple times in the LAYER table.`,
  },
  DUPLICATE_BLOCK: {
    code: 5006,
    id: "DXF5006",
    rule: "duplicate-block",
    severity: "warning" as const,
    message: (blockName: string) => `Block '${blockName}' is defined multiple times in the BLOCKS section.`,
  },
} as const;

export type DxfErrorCodeKey = keyof typeof DxfErrorCode;

export interface DxfDiagnostic {
  id: string;
  code: number;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column?: number | undefined;
  entityType?: string | undefined;
  symbolName?: string | undefined;
}
