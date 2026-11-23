// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/melcor — Pre-flight Diagnostic Error Definitions (MEL1001 - MEL5006).
 */

import type { MelcorRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface MelcorDiagnostic {
  code: string;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: MelcorRange | undefined;
}

export const MelcorErrorCode = {
  SYNTAX_ERROR: {
    code: "MEL1001",
    rule: "syntax-error",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `Syntax error in MELCOR input deck: ${detail}.`,
  },

  DUPLICATE_CV_ID: {
    code: "MEL2001",
    rule: "duplicate-cv-id",
    severity: "error" as DiagnosticSeverity,
    message: (cvId: number, name: string) => `Duplicate control volume ID '${cvId}' ('${name}') in CVH_INPUT.`,
  },
  DUPLICATE_FL_ID: {
    code: "MEL2002",
    rule: "duplicate-fl-id",
    severity: "error" as DiagnosticSeverity,
    message: (flId: number, name: string) => `Duplicate flow path ID '${flId}' ('${name}') in FL_INPUT.`,
  },
  DUPLICATE_HS_ID: {
    code: "MEL2003",
    rule: "duplicate-hs-id",
    severity: "error" as DiagnosticSeverity,
    message: (hsId: number, name: string) => `Duplicate heat structure ID '${hsId}' ('${name}') in HS_INPUT.`,
  },
  DUPLICATE_CF_ID: {
    code: "MEL2004",
    rule: "duplicate-cf-id",
    severity: "error" as DiagnosticSeverity,
    message: (cfId: number, name: string) => `Duplicate control function ID '${cfId}' ('${name}') in CF_INPUT.`,
  },
  DUPLICATE_TF_ID: {
    code: "MEL2005",
    rule: "duplicate-tf-id",
    severity: "error" as DiagnosticSeverity,
    message: (tfId: number, name: string) => `Duplicate tabular function ID '${tfId}' ('${name}') in TF_INPUT.`,
  },

  UNDEFINED_FLOW_VOLUME: {
    code: "MEL3001",
    rule: "undefined-flow-volume",
    severity: "error" as DiagnosticSeverity,
    message: (flId: number, cvId: number, end: "from" | "to") =>
      `Flow path '${flId}' references undefined ${end} control volume '${cvId}'.`,
  },
  UNDEFINED_HS_BOUNDARY_CV: {
    code: "MEL3002",
    rule: "undefined-hs-boundary-cv",
    severity: "error" as DiagnosticSeverity,
    message: (hsId: number, cvId: number, side: "left" | "right") =>
      `Heat structure '${hsId}' references undefined ${side} boundary control volume '${cvId}'.`,
  },

  NON_POSITIVE_CV_VOLUME: {
    code: "MEL4001",
    rule: "non-positive-cv-volume",
    severity: "error" as DiagnosticSeverity,
    message: (cvId: number, volume: number) =>
      `Control volume '${cvId}' specifies non-positive volume '${volume}' m^3.`,
  },
  NON_POSITIVE_FLOW_AREA: {
    code: "MEL4002",
    rule: "non-positive-flow-area",
    severity: "error" as DiagnosticSeverity,
    message: (flId: number, area: number) => `Flow path '${flId}' specifies non-positive flow area '${area}' m^2.`,
  },
  INVALID_INITIAL_PRESSURE: {
    code: "MEL4003",
    rule: "invalid-initial-pressure",
    severity: "error" as DiagnosticSeverity,
    message: (cvId: number, pressure: number) =>
      `Control volume '${cvId}' specifies invalid initial pressure '${pressure}' Pa (must be strictly positive).`,
  },
  INVALID_INITIAL_TEMPERATURE: {
    code: "MEL4004",
    rule: "invalid-initial-temperature",
    severity: "error" as DiagnosticSeverity,
    message: (entity: string, temperature: number) =>
      `Entity '${entity}' specifies invalid initial temperature '${temperature}' K (must be strictly positive).`,
  },

  CYCLIC_CONTROL_FUNCTION: {
    code: "MEL5001",
    rule: "cyclic-control-function",
    severity: "error" as DiagnosticSeverity,
    message: (cyclePath: string) => `Cyclic control function dependency detected: '${cyclePath}'.`,
  },
  MISSING_EXEC_TIME_BOUNDS: {
    code: "MEL5002",
    rule: "missing-exec-time-bounds",
    severity: "warning" as DiagnosticSeverity,
    message: () => `Missing EXEC_INPUT transient time bounds (EXEC_TEND must be strictly positive).`,
  },
  INVALID_TIME_STEP_BOUNDS: {
    code: "MEL5003",
    rule: "invalid-time-step-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (dtMin: number, dtMax: number) =>
      `EXEC_INPUT minimum time step '${dtMin}' s exceeds maximum time step '${dtMax}' s or is non-positive.`,
  },
  NEGATIVE_FLOW_LOSS: {
    code: "MEL5004",
    rule: "negative-flow-loss",
    severity: "error" as DiagnosticSeverity,
    message: (flId: number, kFwd: number, kRev: number) =>
      `Flow path '${flId}' specifies negative form loss coefficient (K_fwd='${kFwd}', K_rev='${kRev}').`,
  },
  NON_POSITIVE_CORE_MASS: {
    code: "MEL5005",
    rule: "non-positive-core-mass",
    severity: "error" as DiagnosticSeverity,
    message: (mass: number, cp: number) =>
      `COR_INPUT specifies non-positive core mass '${mass}' kg or specific heat '${cp}' J/(kg*K).`,
  },
  UNDEFINED_CF_ARGUMENT: {
    code: "MEL5006",
    rule: "undefined-cf-argument",
    severity: "warning" as DiagnosticSeverity,
    message: (cfId: number, kind: string, targetId: number | string) =>
      `Control function '${cfId}' references undefined ${kind} argument '${targetId}'.`,
  },
} as const;
