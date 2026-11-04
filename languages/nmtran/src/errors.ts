// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmtran — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9401 - M9410).
 */

import type { NmtranRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: NmtranRange | undefined;
}

export const NmtranErrorCode = {
  MISSING_PROBLEM_RECORD: {
    code: 9401,
    rule: "missing-problem-record",
    severity: "error" as DiagnosticSeverity,
    message: () => `NMTRAN control stream is missing the required '$PROBLEM' record.`,
  },
  THETA_BOUNDS_VIOLATION: {
    code: 9402,
    rule: "theta-bounds-violation",
    severity: "error" as DiagnosticSeverity,
    message: (thetaIndex: number, lower: number, init: number, upper: number) =>
      `$THETA parameter 'THETA(${thetaIndex})' violates bounds (lower=${lower}, init=${init}, upper=${upper}).`,
  },
  MISSING_DES_BLOCK_FOR_GENERAL_ADVAN: {
    code: 9403,
    rule: "missing-des-block-for-general-advan",
    severity: "error" as DiagnosticSeverity,
    message: (advan: string) => `Subroutine '${advan}' requires a '$DES' differential equation block.`,
  },
  UNDEFINED_THETA_REFERENCE: {
    code: 9404,
    rule: "undefined-theta-reference",
    severity: "error" as DiagnosticSeverity,
    message: (thetaIndex: number, maxTheta: number) =>
      `Block references 'THETA(${thetaIndex})' beyond the number of declared '$THETA' parameters ('${maxTheta}').`,
  },
  UNDEFINED_ETA_REFERENCE: {
    code: 9405,
    rule: "undefined-eta-reference",
    severity: "error" as DiagnosticSeverity,
    message: (etaIndex: number, maxOmega: number) =>
      `Block references 'ETA(${etaIndex})' beyond the dimension of declared '$OMEGA' variance entries ('${maxOmega}').`,
  },
  NON_POSITIVE_OMEGA_VARIANCE: {
    code: 9406,
    rule: "non-positive-omega-variance",
    severity: "error" as DiagnosticSeverity,
    message: (omegaIndex: number, variance: number) =>
      `$OMEGA diagonal variance entry 'OMEGA(${omegaIndex})' must be positive (> 0) unless FIXED to 0 (got '${variance}').`,
  },
  COMPARTMENT_INDEX_OUT_OF_BOUNDS: {
    code: 9407,
    rule: "compartment-index-out-of-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (cmtIndex: number, maxCmt: number) =>
      `Compartment reference '${cmtIndex}' exceeds declared compartment count ('${maxCmt}').`,
  },
  MISSING_ERROR_PREDICTION_Y: {
    code: 9408,
    rule: "missing-error-prediction-y",
    severity: "error" as DiagnosticSeverity,
    message: () => `$ERROR block does not define the required dependent prediction variable 'Y'.`,
  },
  MISSING_REQUIRED_TRANS_PARAMETER: {
    code: 9409,
    rule: "missing-required-trans-parameter",
    severity: "error" as DiagnosticSeverity,
    message: (advan: string, trans: string, paramName: string) =>
      `Subroutine '${advan}' with '${trans}' requires pharmacokinetic parameter '${paramName}' in '$PK'.`,
  },
  NEGATIVE_DOSING_AMOUNT: {
    code: 9410,
    rule: "negative-dosing-amount",
    severity: "error" as DiagnosticSeverity,
    message: (field: string, value: number) => `Dosing record specifies a negative '${field}' value ('${value}').`,
  },
} as const;
