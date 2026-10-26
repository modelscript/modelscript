// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scad — Standard Diagnostic Error Codes (K1001–K1020).
 */

export const ScadErrorCode = {
  UNDEFINED_VARIABLE: {
    code: 1001,
    stdCode: "K1001",
    rule: "SCAD_UNDEFINED_VARIABLE",
    severity: "error" as const,
    message: (name: string) => `Undefined variable '${name}'.`,
  },
  UNDEFINED_FUNCTION: {
    code: 1002,
    stdCode: "K1002",
    rule: "SCAD_UNDEFINED_FUNCTION",
    severity: "error" as const,
    message: (name: string) => `Undefined function '${name}'.`,
  },
  UNDEFINED_MODULE: {
    code: 1003,
    stdCode: "K1003",
    rule: "SCAD_UNDEFINED_MODULE",
    severity: "error" as const,
    message: (name: string) => `Undefined module '${name}'.`,
  },
  DIVISION_BY_ZERO: {
    code: 1004,
    stdCode: "K1004",
    rule: "SCAD_DIVISION_BY_ZERO",
    severity: "error" as const,
    message: () => `Division by zero in expression.`,
  },
  INVALID_DIMENSION: {
    code: 1005,
    stdCode: "K1005",
    rule: "SCAD_INVALID_DIMENSION",
    severity: "error" as const,
    message: (param: string, val: string | number) =>
      `Invalid non-positive dimension (${val}) in '${param}': dimensions must be > 0.`,
  },
  ARGUMENT_COUNT: {
    code: 1006,
    stdCode: "K1006",
    rule: "SCAD_ARGUMENT_COUNT",
    severity: "error" as const,
    message: (name: string, expected: number, actual: number) =>
      `Too many arguments to '${name}': expected at most ${expected}, got ${actual}.`,
  },
  UNKNOWN_PARAMETER: {
    code: 1007,
    stdCode: "K1007",
    rule: "SCAD_UNKNOWN_PARAMETER",
    severity: "error" as const,
    message: (param: string, callable: string) => `Unknown parameter '${param}' in call to '${callable}'.`,
  },
  DUPLICATE_DECLARATION: {
    code: 1008,
    stdCode: "K1008",
    rule: "SCAD_DUPLICATE_DECLARATION",
    severity: "warning" as const,
    message: (name: string) => `Variable '${name}' is assigned multiple times in the same scope.`,
  },
} as const;
