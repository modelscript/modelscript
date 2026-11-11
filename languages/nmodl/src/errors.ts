// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/nmodl — Pre-flight Diagnostic Error Definitions.
 *
 * Conforms to OpenModelica-style diagnostic formatting (M9441 - M9450).
 */

import type { NmodlRange } from "./types.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface DiagnosticItem {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: string;
  range?: NmodlRange | undefined;
}

export const NmodlErrorCode = {
  MISSING_NEURON_BLOCK: {
    code: 9441,
    rule: "missing-neuron-block",
    severity: "error" as DiagnosticSeverity,
    message: () => `NMODL file is missing the required 'NEURON { ... }' interface block.`,
  },
  MISSING_SUFFIX_DECLARATION: {
    code: 9442,
    rule: "missing-suffix-declaration",
    severity: "error" as DiagnosticSeverity,
    message: () => `'NEURON' block is missing the required 'SUFFIX' mechanism identifier.`,
  },
  MISSING_DERIVATIVE_EVOLUTION: {
    code: 9443,
    rule: "missing-derivative-evolution",
    severity: "error" as DiagnosticSeverity,
    message: (stateName: string) =>
      `State variable '${stateName}' declared in 'STATE' block has no time-derivative equation in 'DERIVATIVE'.`,
  },
  UNASSIGNED_WRITE_CURRENT: {
    code: 9444,
    rule: "unassigned-write-current",
    severity: "error" as DiagnosticSeverity,
    message: (curName: string) =>
      `Ion current '${curName}' declared in 'USEION ... WRITE' is never computed in 'BREAKPOINT'.`,
  },
  GATING_PROBABILITY_BOUNDS: {
    code: 9445,
    rule: "gating-probability-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (varName: string, val: number) =>
      `Gating variable initial condition '${varName}' = ${val} falls outside physical probability bounds [0, 1].`,
  },
  REVERSAL_POTENTIAL_SIGN: {
    code: 9446,
    rule: "reversal-potential-sign",
    severity: "warning" as DiagnosticSeverity,
    message: (paramName: string, val: number) =>
      `Reversal potential parameter '${paramName}' has unexpected polarity (${val} mV).`,
  },
  MISSING_BREAKPOINT_BLOCK: {
    code: 9447,
    rule: "missing-breakpoint-block",
    severity: "error" as DiagnosticSeverity,
    message: () => `Channel mechanism is missing the required 'BREAKPOINT' block.`,
  },
  DUPLICATE_BLOCK_DECLARATION: {
    code: 9448,
    rule: "duplicate-block-declaration",
    severity: "error" as DiagnosticSeverity,
    message: (blockName: string) => `Section block '${blockName}' is declared multiple times.`,
  },
  SYNTAX_ERROR: {
    code: 9449,
    rule: "syntax-error",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `NMODL syntax error: ${detail}.`,
  },
  UNBALANCED_UNITS_BRACKET: {
    code: 9450,
    rule: "unbalanced-units-bracket",
    severity: "warning" as DiagnosticSeverity,
    message: (paramName: string) => `Parameter declaration '${paramName}' has unbalanced unit parentheses or brackets.`,
  },
} as const;

export function formatNmodlDiagnostic(d: DiagnosticItem, filename = "channel.mod"): string {
  const r = d.range;
  const loc = r ? `[${filename}:${r.startLine}:${r.startColumn}-${r.endLine}:${r.endColumn}] ` : "";
  const sev = d.severity.charAt(0).toUpperCase() + d.severity.slice(1);
  return `${loc}${sev}: [M${d.code}] ${d.message}`;
}
