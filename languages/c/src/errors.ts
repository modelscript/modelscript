// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error definitions for C language compilation and static verification.
 * Follows ModelScript diagnostic conventions (quoted identifiers, terminal period).
 */
export const CErrorCode = {
  UNINITIALIZED_VARIABLE: {
    code: 8401,
    rule: "uninitialized-variable",
    severity: "warning" as const,
    message: (varName: string) => `Local variable '${varName}' may be read before being initialized.`,
  },
  CONSTANT_DIVISION_BY_ZERO: {
    code: 8402,
    rule: "constant-division-by-zero",
    severity: "error" as const,
    message: () => "Division or modulo by constant zero detected in arithmetic expression.",
  },
  ARRAY_BOUNDS_OVERFLOW: {
    code: 8403,
    rule: "array-bounds-overflow",
    severity: "error" as const,
    message: (arrName: string, index: number, bound: number) =>
      `Static array subscript '${arrName}[${index}]' exceeds declared dimension bound of ${bound}.`,
  },
  UNREACHABLE_CODE: {
    code: 8404,
    rule: "unreachable-code",
    severity: "warning" as const,
    message: () => "Unreachable statements detected following unconditional 'return', 'break', or 'goto'.",
  },
  ASSIGNMENT_IN_CONDITIONAL: {
    code: 8405,
    rule: "assignment-in-conditional",
    severity: "warning" as const,
    message: () => "Assignment operator '=' used inside conditional expression; did you mean '=='?",
  },
  ALGEBRAIC_CYCLE: {
    code: 8406,
    rule: "algebraic-dependency-cycle",
    severity: "error" as const,
    message: (cycle: string) => `Procedural algebraic dependency cycle detected without state lag: '${cycle}'.`,
  },
  NULL_POINTER_DEREFERENCE: {
    code: 8407,
    rule: "null-pointer-dereference",
    severity: "error" as const,
    message: (expr: string) => `Dereference of statically known NULL pointer in expression '${expr}'.`,
  },
  PROTOTYPE_MISMATCH: {
    code: 8408,
    rule: "function-prototype-mismatch",
    severity: "error" as const,
    message: (fnName: string, expected: string, actual: string) =>
      `Function '${fnName}' signature conflicts with declaration: expected '${expected}', got '${actual}'.`,
  },
  MISSING_RETURN_VALUE: {
    code: 8409,
    rule: "missing-return-value",
    severity: "error" as const,
    message: (fnName: string, returnType: string) =>
      `Non-void function '${fnName}' with return type '${returnType}' reaches end of body without returning a value.`,
  },
  IMPLICIT_LOSSY_CONVERSION: {
    code: 8410,
    rule: "implicit-lossy-conversion",
    severity: "info" as const,
    message: (fromType: string, toType: string) =>
      `Implicit floating-point to integer conversion from '${fromType}' to '${toType}' may cause lossy truncation.`,
  },
} as const;

export type CErrorCodeKey = keyof typeof CErrorCode;
