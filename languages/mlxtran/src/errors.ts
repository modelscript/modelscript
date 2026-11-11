// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/mlxtran — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9421 - M9430).
 */

import type { MlxtranRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: MlxtranRange | undefined;
}

export const MlxtranErrorCode = {
  MISSING_LONGITUDINAL_BLOCK: {
    code: 9421,
    rule: "missing-longitudinal-block",
    severity: "error" as DiagnosticSeverity,
    message: () => `MLXTRAN model is missing the required '[LONGITUDINAL]' section header.`,
  },
  UNDECLARED_INPUT_PARAMETER: {
    code: 9422,
    rule: "undeclared-input-parameter",
    severity: "error" as DiagnosticSeverity,
    message: (paramName: string) =>
      `Equation references parameter '${paramName}' that is not declared in 'input = {...}'.`,
  },
  ORPHAN_DERIVATIVE: {
    code: 9423,
    rule: "orphan-derivative",
    severity: "warning" as DiagnosticSeverity,
    message: (stateName: string) =>
      `Differential variable '${stateName}' has time derivative 'ddt_${stateName}' but is never referenced in outputs or transfers.`,
  },
  MASS_CONSERVATION_LEAK: {
    code: 9424,
    rule: "mass-conservation-leak",
    severity: "error" as DiagnosticSeverity,
    message: (fromCmt: string, toCmt: string) =>
      `Mass conservation violation: transfer between compartment '${fromCmt}' and '${toCmt}' has unbalanced stoichiometry or rates.`,
  },
  NEGATIVE_PARAMETER_BOUND: {
    code: 9425,
    rule: "negative-parameter-bound",
    severity: "error" as DiagnosticSeverity,
    message: (paramName: string, val: number) =>
      `Physiological parameter '${paramName}' must be positive (> 0), got '${val}'.`,
  },
  DUPLICATE_EQUATION_DEFINITION: {
    code: 9426,
    rule: "duplicate-equation-definition",
    severity: "error" as DiagnosticSeverity,
    message: (ident: string) => `Variable or derivative '${ident}' is defined multiple times in EQUATION block.`,
  },
  MISSING_OUTPUT_DEFINITION: {
    code: 9427,
    rule: "missing-output-definition",
    severity: "warning" as DiagnosticSeverity,
    message: () => `Model defines differential equations but is missing an 'OUTPUT:' block.`,
  },
  INVALID_MACRO_TARGET: {
    code: 9428,
    rule: "invalid-macro-target",
    severity: "error" as DiagnosticSeverity,
    message: (macroKind: string, targetName: string) =>
      `PK macro '${macroKind}' targets undefined compartment or state variable '${targetName}'.`,
  },
  SYNTAX_ERROR: {
    code: 9429,
    rule: "syntax-error",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `MLXTRAN syntax error: ${detail}.`,
  },
  UNBALANCED_COMPARTMENT_TRANSFER: {
    code: 9430,
    rule: "unbalanced-compartment-transfer",
    severity: "error" as DiagnosticSeverity,
    message: (from: string, to: string) =>
      `Compartment transfer references invalid or identical compartment index ('from=${from}', 'to=${to}').`,
  },
} as const;

export function formatMlxtranDiagnostic(d: DiagnosticItem, filename = "model.mlxtran"): string {
  const r = d.range;
  const loc = r ? `[${filename}:${r.startLine}:${r.startColumn}-${r.endLine}:${r.endColumn}] ` : "";
  const sev = d.severity.charAt(0).toUpperCase() + d.severity.slice(1);
  return `${loc}${sev}: [M${d.code}] ${d.message}`;
}
