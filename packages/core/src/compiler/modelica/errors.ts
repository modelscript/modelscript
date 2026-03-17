// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Range } from "../../util/tree-sitter.js";

/**
 * Severity level for a diagnostic.
 */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A structured diagnostic emitted by the compiler or linter.
 * Replaces plain string errors with error codes, human-readable messages, and positional info.
 */
export interface ModelicaDiagnostic {
  /** Numeric error code (e.g. 3001). */
  code: number;
  /** Short rule name for tooling (e.g. "type-mismatch"). */
  rule: string;
  /** Severity level. */
  severity: DiagnosticSeverity;
  /** Human-readable message with interpolated details. */
  message: string;
  /** Source range in the file, if available. */
  range: Range | null;
}

// ---------------------------------------------------------------------------
// Error code definition
// ---------------------------------------------------------------------------

export interface ErrorCodeDef {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  /** Template function that produces the human-readable message. */
  message: (...args: string[]) => string;
}

/**
 * Central registry of all Modelica diagnostic codes.
 *
 * Naming: M{code} — e.g. M1001, M3001.
 * Ranges:
 *   1xxx  Syntax / parse
 *   2xxx  Name resolution
 *   3xxx  Type system
 *   4xxx  Structural / semantic
 *   5xxx  Equations & algorithms
 */
export const ModelicaErrorCode = {
  // ── 1xxx: Syntax & Parse ──────────────────────────────────────────────
  PARSE_ERROR: {
    code: 1001,
    rule: "parse-error",
    severity: "error",
    message: () => "Parse error.",
  },
  PARSE_MISSING: {
    code: 1002,
    rule: "parse-missing",
    severity: "error",
    message: (expected: string) => `Parse error: '${expected}' expected.`,
  },

  // ── 2xxx: Name Resolution ─────────────────────────────────────────────
  DUPLICATE_ELEMENT: {
    code: 2001,
    rule: "duplicate-element",
    severity: "error",
    message: (name: string) => `An element with name '${name}' is already declared in this scope.`,
  },
  NAME_NOT_FOUND: {
    code: 2002,
    rule: "name-not-found",
    severity: "error",
    message: (name: string) => `Name '${name}' not found in scope.`,
  },
  CLASS_NOT_FOUND: {
    code: 2003,
    rule: "class-not-found",
    severity: "error",
    message: (className: string, scope: string) => `Class '${className}' not found in scope '${scope}'.`,
  },
  MODIFIER_NOT_FOUND: {
    code: 2004,
    rule: "modifier-not-found",
    severity: "error",
    message: (modName: string, componentName: string, className: string) =>
      `In modifier of '${componentName}', class or component '${modName}' not found in '${className}'.`,
  },
  IDENTIFIER_MISMATCH: {
    code: 2005,
    rule: "identifier-mismatch",
    severity: "error",
    message: () => "The identifier at start and end are different.",
  },

  // ── 3xxx: Type System ─────────────────────────────────────────────────
  TYPE_MISMATCH_BINDING: {
    code: 3001,
    rule: "type-mismatch-binding",
    severity: "error",
    message: (componentName: string, expectedType: string, actualExpr: string, actualType: string) =>
      `Type mismatch: '${componentName}' of type '${expectedType}' cannot be assigned from '${actualExpr}' of type '${actualType}'.`,
  },
  TYPE_MISMATCH_MODIFIER: {
    code: 3002,
    rule: "type-mismatch-modifier",
    severity: "error",
    message: (modName: string, expectedType: string, actualType: string) =>
      `Type mismatch: '${modName}' expects type '${expectedType}' but got '${actualType}'.`,
  },
  NOT_PLUG_COMPATIBLE: {
    code: 3003,
    rule: "not-plug-compatible",
    severity: "error",
    message: (ref1: string, ref2: string) => `In connect(${ref1}, ${ref2}): connectors are not plug-compatible.`,
  },
  NOT_A_CONNECTOR: {
    code: 3004,
    rule: "not-a-connector",
    severity: "error",
    message: (ref1: string, ref2: string, which: string) =>
      `In connect(${ref1}, ${ref2}): '${which}' is not a connector.`,
  },
  REDECLARE_TYPE_MISMATCH: {
    code: 3005,
    rule: "redeclare-type-mismatch",
    severity: "error",
    message: (redeclaredName: string, newType: string, constrainingType: string) =>
      `Redeclare of '${redeclaredName}': type '${newType}' is not compatible with constraining type '${constrainingType}'.`,
  },
  FUNCTION_ARG_TYPE_MISMATCH: {
    code: 3006,
    rule: "function-arg-type-mismatch",
    severity: "error",
    message: (funcName: string, paramName: string, expectedType: string, actualType: string) =>
      `In call to '${funcName}': argument '${paramName}' expects type '${expectedType}' but got '${actualType}'.`,
  },
  FUNCTION_RETURN_TYPE_MISMATCH: {
    code: 3007,
    rule: "function-return-type-mismatch",
    severity: "error",
    message: (funcName: string, expectedType: string, actualType: string) =>
      `Function '${funcName}' returns type '${actualType}' but '${expectedType}' expected.`,
  },
  ARRAY_INDEX_TYPE_MISMATCH: {
    code: 3009,
    rule: "array-index-type-mismatch",
    severity: "error",
    message: (actualType: string) => `Array index type mismatch: expected Integer or Boolean, but got '${actualType}'.`,
  },

  // ── 4xxx: Structural / Semantic ───────────────────────────────────────
  EXTENDS_CYCLE: {
    code: 4001,
    rule: "extends-cycle",
    severity: "error",
    message: (className: string, baseName: string) => `Extends cycle detected: '${className}' extends '${baseName}'.`,
  },
  DUPLICATE_MODIFICATION: {
    code: 4002,
    rule: "duplicate-modification",
    severity: "error",
    message: (elementName: string, componentName: string) =>
      `Duplicate modification of element '${elementName}' on component '${componentName}'.`,
  },
  ARRAY_DIMENSION_MISMATCH: {
    code: 4003,
    rule: "array-dimension-mismatch",
    severity: "error",
    message: (context: string, actualShape: string, expectedShape: string) =>
      `Array dimension mismatch: ${context} has shape [${actualShape}] but expected [${expectedShape}].`,
  },
  UNBALANCED_MODEL: {
    code: 4004,
    rule: "unbalanced-model",
    severity: "warning",
    message: (classKind: string, name: string, nEquations: string, nVariables: string) =>
      `The ${classKind} '${name}' is not balanced: ${nEquations} equation(s) and ${nVariables} variable(s).`,
  },
  FUNCTION_PUBLIC_VARIABLE: {
    code: 4007,
    rule: "function-public-variable",
    severity: "warning",
    message: (varName: string) =>
      `Invalid public variable ${varName}, function variables that are not input/output must be protected.`,
  },
  ARRAY_SUBSCRIPT_COUNT_MISMATCH: {
    code: 4008,
    rule: "array-subscript-count-mismatch",
    severity: "error",
    message: (componentName: string, actualCount: string, expectedCount: string) =>
      `Array subscript count mismatch: '${componentName}' has ${expectedCount} dimension(s), but was indexed with ${actualCount} subscript(s).`,
  },

  // ── 5xxx: Equations & Algorithms ──────────────────────────────────────
  EQUATION_TYPE_MISMATCH: {
    code: 5001,
    rule: "equation-type-mismatch",
    severity: "error",
    message: (lhs: string, lhsType: string, rhs: string, rhsType: string) =>
      `Equation type mismatch: '${lhs}' (${lhsType}) = '${rhs}' (${rhsType}).`,
  },
  CONSTRAINEDBY_TYPE_MISMATCH: {
    code: 5002,
    rule: "constrainedby-type-mismatch",
    severity: "error",
    message: (componentName: string, defaultType: string, constrainingType: string) =>
      `Replaceable '${componentName}': default type '${defaultType}' is not compatible with constraining type '${constrainingType}'.`,
  },
  EXTENDS_TYPE_MISMATCH: {
    code: 3008,
    rule: "extends-type-mismatch",
    severity: "error",
    message: (className: string, redeclaredName: string, newType: string, originalType: string) =>
      `In extends of '${className}': redeclared '${redeclaredName}' of type '${newType}' is not compatible with original type '${originalType}'.`,
  },
  IF_BRANCH_TYPE_MISMATCH: {
    code: 5003,
    rule: "if-branch-type-mismatch",
    severity: "error",
    message: (varName: string, branchType: string, expectedType: string) =>
      `If-equation branch type mismatch: '${varName}' assigned type '${branchType}' but expected '${expectedType}'.`,
  },
  CONNECT_FLOW_MISMATCH: {
    code: 5004,
    rule: "connect-flow-mismatch",
    severity: "warning",
    message: (ref1: string, ref2: string) =>
      `In connect(${ref1}, ${ref2}): flow variable sets differ between connectors.`,
  },
  PROTECTED_MODIFICATION: {
    code: 4005,
    rule: "protected-modification",
    severity: "error",
    message: (elementName: string, modText: string) =>
      `Protected element '${elementName}' may not be modified, got '${modText}'.`,
  },
  EXTERNAL_WITH_ALGORITHM: {
    code: 4006,
    rule: "external-with-algorithm",
    severity: "error",
    message: () => "Element is not allowed in function context: algorithm",
  },
  DIVISION_BY_ZERO: {
    code: 5005,
    rule: "division-by-zero",
    severity: "error",
    message: (lhs: string) => `Division by zero: ${lhs} / 0.`,
  },
  ASSIGNMENT_TYPE_MISMATCH: {
    code: 5006,
    rule: "assignment-type-mismatch",
    severity: "error",
    message: (target: string, targetType: string, source: string, sourceType: string) =>
      `Type mismatch in assignment in ${target} := ${source} of ${targetType} := ${sourceType}.`,
  },
  FOR_ITERATOR_NOT_1D: {
    code: 5007,
    rule: "for-iterator-not-1d",
    severity: "error",
    message: (iteratorName: string, shape: string) =>
      `Iterator '${iteratorName}' has type [${shape}], but expected a 1D array expression.`,
  },
  ASSIGNMENT_TO_CONSTANT: {
    code: 5008,
    rule: "assignment-to-constant",
    severity: "error",
    message: (componentName: string) => `Trying to assign to constant component '${componentName}'.`,
  },
  ASSIGNMENT_TO_INPUT: {
    code: 5009,
    rule: "assignment-to-input",
    severity: "error",
    message: (componentName: string) => `Trying to assign to input component '${componentName}'.`,
  },
} as const satisfies Record<string, ErrorCodeDef>;

// Derive the union type of all error code keys
export type ModelicaErrorCodeKey = keyof typeof ModelicaErrorCode;

// ---------------------------------------------------------------------------
// Helper to create diagnostics
// ---------------------------------------------------------------------------

/**
 * Create a ModelicaDiagnostic from an error code definition.
 *
 * @param def - The error code definition from `ModelicaErrorCode`.
 * @param range - Optional source range for the diagnostic.
 * @param args - Arguments to interpolate into the message template.
 * @returns A fully formed ModelicaDiagnostic.
 *
 * @example
 * ```ts
 * makeDiagnostic(ModelicaErrorCode.CLASS_NOT_FOUND, typeSpecifier, "MyClass", "ParentModel")
 * // → { code: 2003, rule: "class-not-found", severity: "error",
 * //     message: "Class 'MyClass' not found in scope 'ParentModel'.", range: ... }
 * ```
 */
export function makeDiagnostic(
  def: ErrorCodeDef,
  range: Range | null | undefined,
  ...args: string[]
): ModelicaDiagnostic {
  return {
    code: def.code,
    rule: def.rule,
    severity: def.severity,
    message: (def.message as (...a: string[]) => string)(...args),
    range: range ?? null,
  };
}

/**
 * Format a diagnostic as a string with source range and severity.
 * E.g. "[path/to/file.mo:13:3-13:15] Warning: Invalid public variable ..."
 * When no range is available, falls back to "[M3001] Severity: message".
 */
export function formatDiagnostic(diag: ModelicaDiagnostic, resource?: string | null): string {
  const severity = diag.severity.charAt(0).toUpperCase() + diag.severity.slice(1);
  if (diag.range) {
    const r = diag.range;
    // Tree-sitter positions are 0-indexed; display as 1-indexed
    const start = `${r.startPosition.row + 1}:${r.startPosition.column + 1}`;
    const end = `${r.endPosition.row + 1}:${r.endPosition.column + 1}`;
    const prefix = resource ? `${resource}:` : "";
    return `[${prefix}${start}-${end}] ${severity}: ${diag.message}`;
  }
  return `[M${diag.code}] ${severity}: ${diag.message}`;
}
