// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scale — Diagnostic Error Code Definitions (SCL1001–SCL5006).
 */

import type { ScaleRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface ScaleDiagnostic {
  code: string;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: ScaleRange | undefined;
}

export const ScaleErrorCode = {
  SYNTAX_ERROR: {
    code: "SCL1001",
    rule: "syntax-error",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `Syntax error in SCALE deck: ${detail}.`,
  },
  UNCLOSED_READ_BLOCK: {
    code: "SCL1002",
    rule: "unclosed-read-block",
    severity: "error" as DiagnosticSeverity,
    message: (blockName: string) => `Unclosed 'read ${blockName}' block; expected matching 'end ${blockName}'.`,
  },
  UNKNOWN_SEQUENCE: {
    code: "SCL2001",
    rule: "unknown-sequence",
    severity: "error" as DiagnosticSeverity,
    message: (seqName: string) => `Unknown SCALE sequence '=${seqName}'.`,
  },
  DUPLICATE_MIXTURE_ID: {
    code: "SCL2002",
    rule: "duplicate-mixture-id",
    severity: "warning" as DiagnosticSeverity,
    message: (mixId: number) => `Duplicate mixture ID '${mixId}' declared in 'comp' block.`,
  },
  DUPLICATE_UNIT_ID: {
    code: "SCL2003",
    rule: "duplicate-unit-id",
    severity: "error" as DiagnosticSeverity,
    message: (unitId: number) => `Duplicate KENO unit ID '${unitId}' declared in 'geom' block.`,
  },
  DUPLICATE_ARRAY_ID: {
    code: "SCL2004",
    rule: "duplicate-array-id",
    severity: "error" as DiagnosticSeverity,
    message: (arrayId: number) => `Duplicate KENO array ID '${arrayId}' declared in 'array' block.`,
  },
  UNDEFINED_MIXTURE: {
    code: "SCL3001",
    rule: "undefined-mixture",
    severity: "error" as DiagnosticSeverity,
    message: (mixId: number, unitId: number) =>
      `Undefined mixture ID '${mixId}' referenced in 'media' card of unit '${unitId}'.`,
  },
  UNDEFINED_UNIT: {
    code: "SCL3002",
    rule: "undefined-unit",
    severity: "error" as DiagnosticSeverity,
    message: (unitId: number, context: string) => `Undefined KENO unit ID '${unitId}' referenced in ${context}.`,
  },
  MISSING_GLOBAL_UNIT: {
    code: "SCL3003",
    rule: "missing-global-unit",
    severity: "error" as DiagnosticSeverity,
    message: () => `KENO geometry block defines units but has no 'global unit' declaration.`,
  },
  NEGATIVE_DENSITY: {
    code: "SCL4001",
    rule: "negative-density",
    severity: "error" as DiagnosticSeverity,
    message: (material: string, mixId: number, density: number) =>
      `Composition '${material}' (mixture ${mixId}) specifies non-positive density (${density} g/cm³).`,
  },
  NEGATIVE_TEMPERATURE: {
    code: "SCL4002",
    rule: "negative-temperature",
    severity: "error" as DiagnosticSeverity,
    message: (material: string, mixId: number, temp: number) =>
      `Composition '${material}' (mixture ${mixId}) specifies non-positive temperature (${temp} K).`,
  },
  INVALID_ENRICHMENT: {
    code: "SCL4003",
    rule: "invalid-enrichment",
    severity: "error" as DiagnosticSeverity,
    message: (material: string, mixId: number, enrich: number) =>
      `Composition '${material}' (mixture ${mixId}) specifies invalid enrichment (${enrich} wt%); expected [0, 100].`,
  },
  INVALID_ORIGEN_TIME: {
    code: "SCL5001",
    rule: "invalid-origen-time",
    severity: "error" as DiagnosticSeverity,
    message: (caseId: string, detail: string) =>
      `Invalid ORIGEN irradiation/decay time in case '${caseId}': ${detail}.`,
  },
  INVALID_ORIGEN_POWER: {
    code: "SCL5002",
    rule: "invalid-origen-power",
    severity: "error" as DiagnosticSeverity,
    message: (caseId: string, kind: "power" | "flux", value: number) =>
      `Invalid ORIGEN ${kind} value (${value}) in case '${caseId}'; must be non-negative.`,
  },
  EMPTY_ORIGEN_CASE: {
    code: "SCL5003",
    rule: "empty-origen-case",
    severity: "warning" as DiagnosticSeverity,
    message: (caseId: string) => `ORIGEN case '${caseId}' specifies no time steps or initial nuclide inventory.`,
  },
  INVALID_GEOMETRY_DIMENSION: {
    code: "SCL5004",
    rule: "invalid-geometry-dimension",
    severity: "error" as DiagnosticSeverity,
    message: (unitId: number, bodyKind: string, bodyId: number, detail: string) =>
      `Invalid dimension in unit '${unitId}' ${bodyKind} '${bodyId}': ${detail}.`,
  },
  ARRAY_FILL_MISMATCH: {
    code: "SCL5005",
    rule: "array-fill-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (arrayId: number, expected: number, actual: number) =>
      `KENO array '${arrayId}' fill list has ${actual} entries; expected nux*nuy*nuz = ${expected}.`,
  },
  NEGATIVE_ORIGEN_NUCLIDE: {
    code: "SCL5006",
    rule: "negative-origen-nuclide",
    severity: "error" as DiagnosticSeverity,
    message: (caseId: string, nuclide: string, amount: number) =>
      `ORIGEN case '${caseId}' specifies negative initial concentration (${amount}) for nuclide '${nuclide}'.`,
  },
} as const;
