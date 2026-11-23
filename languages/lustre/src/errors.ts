// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`LUST1001`–`LUST5006`) for `@modelscript/lustre`.
 */

export interface LustreDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  nodeName?: string | undefined;
  symbolName?: string | undefined;
}

export const LustreErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "LUST1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Lustre syntax error: ${detail}.`,
  },
  DUPLICATE_NODE: {
    code: 2001,
    id: "LUST2001",
    rule: "duplicate-node",
    severity: "error" as const,
    message: (nodeName: string) => `Duplicate node or function declaration '${nodeName}'.`,
  },
  DUPLICATE_VARIABLE: {
    code: 2002,
    id: "LUST2002",
    rule: "duplicate-variable",
    severity: "error" as const,
    message: (varName: string, scope: string) => `Duplicate variable or constant '${varName}' in '${scope}'.`,
  },
  UNDEFINED_VARIABLE: {
    code: 2003,
    id: "LUST2003",
    rule: "undefined-variable",
    severity: "error" as const,
    message: (varName: string, nodeName: string) => `Undefined variable '${varName}' in node '${nodeName}'.`,
  },
  UNDEFINED_NODE: {
    code: 2004,
    id: "LUST2004",
    rule: "undefined-node",
    severity: "error" as const,
    message: (callee: string, nodeName: string) => `Undefined node or function '${callee}' called in '${nodeName}'.`,
  },
  TYPE_MISMATCH: {
    code: 3001,
    id: "LUST3001",
    rule: "type-mismatch",
    severity: "error" as const,
    message: (expected: string, actual: string, context: string) =>
      `Type mismatch in ${context}: expected '${expected}', got '${actual}'.`,
  },
  CLOCK_MISMATCH: {
    code: 3002,
    id: "LUST3002",
    rule: "clock-mismatch",
    severity: "error" as const,
    message: (leftClock: string, rightClock: string, context: string) =>
      `Clock mismatch in ${context}: cannot combine streams on clocks '${leftClock}' and '${rightClock}'.`,
  },
  NODE_ARITY_MISMATCH: {
    code: 3003,
    id: "LUST3003",
    rule: "node-arity-mismatch",
    severity: "error" as const,
    message: (callee: string, expected: number, actual: number) =>
      `Arity mismatch in call to '${callee}': expected ${expected} argument(s), got ${actual}.`,
  },
  CAUSALITY_CYCLE: {
    code: 4001,
    id: "LUST4001",
    rule: "causality-cycle",
    severity: "error" as const,
    message: (cycle: string, nodeName: string) =>
      `Instantaneous algebraic causality cycle without 'pre' in node '${nodeName}': ${cycle}.`,
  },
  UNINITIALIZED_PRE: {
    code: 4002,
    id: "LUST4002",
    rule: "uninitialized-pre",
    severity: "warning" as const,
    message: (exprText: string, nodeName: string) =>
      `Uninitialized 'pre' expression '${exprText}' without '->' initialization guard in node '${nodeName}'.`,
  },
  MISSING_OUTPUT_EQUATION: {
    code: 5001,
    id: "LUST5001",
    rule: "missing-output-equation",
    severity: "error" as const,
    message: (outputName: string, nodeName: string) =>
      `Missing defining equation for output '${outputName}' in node '${nodeName}'.`,
  },
  MULTIPLE_DEFINITION: {
    code: 5002,
    id: "LUST5002",
    rule: "multiple-definition",
    severity: "error" as const,
    message: (varName: string, nodeName: string) =>
      `Variable '${varName}' is defined multiple times in node '${nodeName}'.`,
  },
  INPUT_ASSIGNMENT: {
    code: 5003,
    id: "LUST5003",
    rule: "input-assignment",
    severity: "error" as const,
    message: (varName: string, nodeName: string) =>
      `Cannot assign to input variable '${varName}' in node '${nodeName}'.`,
  },
  PRE_IN_FUNCTION: {
    code: 5004,
    id: "LUST5004",
    rule: "pre-in-function",
    severity: "error" as const,
    message: (op: string, fnName: string) =>
      `Temporal operator '${op}' is not permitted in stateless function '${fnName}'.`,
  },
  ASSERTION_NOT_BOOL: {
    code: 5005,
    id: "LUST5005",
    rule: "assertion-not-bool",
    severity: "error" as const,
    message: (actual: string, nodeName: string) =>
      `Assertion in node '${nodeName}' must have type 'bool', got '${actual}'.`,
  },
  UNUSED_LOCAL_VARIABLE: {
    code: 5006,
    id: "LUST5006",
    rule: "unused-local-variable",
    severity: "warning" as const,
    message: (varName: string, nodeName: string) =>
      `Local variable '${varName}' is declared but never used in node '${nodeName}'.`,
  },
} as const;
