// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LintRangeOptions, LintResult } from "@modelscript/dsl";

/**
 * Diagnostic severity level for SysML v2 diagnostics.
 */
export type DiagnosticSeverity = "error" | "warning" | "info" | "hint";

/**
 * Structured diagnostic definition for SysML v2.
 */
export interface SysML2Diagnostic {
  /** Numeric error code (e.g. 1003, 3001). */
  code: number;
  /** Short rule name for tooling and filtering (e.g. "type-mismatch"). */
  rule: string;
  /** Diagnostic severity level. */
  severity: DiagnosticSeverity;
  /** Human-readable diagnostic message. */
  message: string;
  /** Field name if diagnostic targets a specific AST field. */
  field?: string;
  /** Starting byte offset in source. */
  startByte?: number;
  /** Ending byte offset in source. */
  endByte?: number;
}

/**
 * Definition of a SysML v2 error code rule.
 */
export interface ErrorCodeDef {
  code: number;
  rule: string;
  severity: DiagnosticSeverity;
  message: (...args: any[]) => string;
}

/**
 * Central registry of all SysML v2 diagnostic and linter codes.
 *
 * Numbering scheme:
 *   1xxx: Syntax, Parsing & Naming Conventions
 *   2xxx: Scoping & Name Resolution
 *   3xxx: Type System & Static Checking
 *   4xxx: Structural & Metamodel Semantics
 *   5xxx: Behavior, State Machines & Formal Verification
 */
export const SysML2ErrorCode = {
  // ── 1xxx: Syntax, Parsing & Naming Conventions ─────────────────────────
  PARSE_ERROR: {
    code: 1001,
    rule: "parse-error",
    severity: "error" as DiagnosticSeverity,
    message: (detail?: string) => (detail ? `Parse error: ${detail}.` : "Parse error."),
  },
  PARSE_MISSING: {
    code: 1002,
    rule: "parse-missing",
    severity: "error" as DiagnosticSeverity,
    message: (expected: string) => `Expected token missing: '${expected}'.`,
  },
  DEFINITION_NAMING: {
    code: 1003,
    rule: "definition-naming",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Definition '${name}' should start with an uppercase letter`,
  },
  NAMING_CONVENTION_DEFINITION: {
    code: 1003,
    rule: "definition-naming",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Definition '${name}' should start with an uppercase letter`,
  },
  USAGE_NAMING: {
    code: 1004,
    rule: "usage-naming",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Usage '${name}' should start with a lowercase letter`,
  },
  NAMING_CONVENTION_USAGE: {
    code: 1004,
    rule: "usage-naming",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Usage '${name}' should start with a lowercase letter`,
  },

  // ── 2xxx: Scoping & Name Resolution ────────────────────────────────────
  DUPLICATE_MEMBER: {
    code: 2001,
    rule: "duplicate-member",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string, scope: string) => `Duplicate member '${name}' in '${scope}'`,
  },
  SYMBOL_NOT_FOUND: {
    code: 2002,
    rule: "symbol-not-found",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Symbol '${name}' not found in scope.`,
  },
  UNRESOLVED_TARGET: {
    code: 2003,
    rule: "unresolved-target",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Allocation target '${target}' could not be resolved`,
  },
  ALLOCATION_TARGET_UNRESOLVED: {
    code: 2003,
    rule: "allocation-target-unresolved",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Allocation target '${target}' could not be resolved`,
  },
  UNRESOLVED_SOURCE: {
    code: 2004,
    rule: "unresolved-source",
    severity: "error" as DiagnosticSeverity,
    message: (source: string) => `Allocation source '${source}' could not be resolved`,
  },
  ALLOCATION_SOURCE_UNRESOLVED: {
    code: 2004,
    rule: "allocation-source-unresolved",
    severity: "error" as DiagnosticSeverity,
    message: (source: string) => `Allocation source '${source}' could not be resolved`,
  },
  UNRESOLVED_IMPORT: {
    code: 2005,
    rule: "unresolved-import",
    severity: "error" as DiagnosticSeverity,
    message: (pkg: string) => `Import '${pkg}' could not be resolved.`,
  },

  // ── 3xxx: Type System & Static Checking ────────────────────────────────
  TYPE_MISMATCH: {
    code: 3001,
    rule: "type-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, declaredType: string, actualType: string) =>
      `Type mismatch: cannot assign value of type '${actualType}' to feature '${featureName}' with declared type '${declaredType}'.`,
  },
  TYPE_MISMATCH_ASSIGNMENT: {
    code: 3001,
    rule: "type-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, declaredType: string, actualType: string) =>
      `Type mismatch: cannot assign value of type '${actualType}' to feature '${featureName}' with declared type '${declaredType}'.`,
  },
  INCOMPATIBLE_PORT_CONNECTION: {
    code: 3002,
    rule: "incompatible-port-connection",
    severity: "error" as DiagnosticSeverity,
    message: (p1: string, t1: string, p2: string, t2: string) =>
      `Incompatible port connection between '${p1}' (${t1}) and '${p2}' (${t2}).`,
  },
  DIMENSIONAL_MISMATCH: {
    code: 3003,
    rule: "dimensional-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, targetDim?: string, actualDim?: string) =>
      targetDim && actualDim
        ? `Dimensional mismatch: cannot assign value of dimension '${actualDim}' to feature '${featureName}' with declared dimension '${targetDim}'.`
        : `Dimensional mismatch on feature '${featureName}'.`,
  },
  DIMENSION_MISMATCH: {
    code: 3003,
    rule: "dimensional-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, targetDim?: string, actualDim?: string) =>
      targetDim && actualDim
        ? `Dimensional mismatch: cannot assign value of dimension '${actualDim}' to feature '${featureName}' with declared dimension '${targetDim}'.`
        : `Dimensional mismatch on feature '${featureName}'.`,
  },
  DIMENSIONAL_CONNECTION_MISMATCH: {
    code: 3007,
    rule: "dimensional-connection-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (sourceName: string, sourceDim: string, targetName: string, targetDim: string) =>
      `Dimensional mismatch in connection between '${sourceName}' (${sourceDim}) and '${targetName}' (${targetDim}).`,
  },
  INVALID_MULTIPLICITY_BOUNDS: {
    code: 3004,
    rule: "invalid-multiplicity-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (lower: string, upper: string) =>
      `Invalid multiplicity bounds: lower bound (${lower}) cannot be greater than upper bound (${upper}).`,
  },
  TARGET_NOT_REQUIREMENT: {
    code: 3005,
    rule: "target-not-requirement",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Target '${target}' is not a Requirement`,
  },
  TARGET_NOT_A_REQUIREMENT: {
    code: 3005,
    rule: "target-not-requirement",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Target '${target}' is not a Requirement`,
  },
  VERIFY_TARGET_NOT_A_REQUIREMENT: {
    code: 3006,
    rule: "verify-target-not-a-requirement",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Verify target '${target}' is not a Requirement`,
  },

  // ── 4xxx: Structural & Metamodel Semantics ──────────────────────────────
  CIRCULAR_SPECIALIZATION: {
    code: 4001,
    rule: "circular-specialization",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Circular specialization: '${name}' transitively specializes itself`,
  },
  CIRCULAR_SATISFACTION: {
    code: 4002,
    rule: "circular-satisfaction",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Circular satisfaction: '${name}' transitively satisfies itself`,
  },
  CYCLIC_SATISFACTION: {
    code: 4002,
    rule: "circular-satisfaction",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Circular satisfaction: '${name}' transitively satisfies itself`,
  },
  EMPTY_DEFINITION: {
    code: 4003,
    rule: "empty-definition",
    severity: "info" as DiagnosticSeverity,
    message: (name: string) => `Definition '${name}' has no members`,
  },
  ABSTRACT_REQUIREMENT_VIOLATION: {
    code: 4004,
    rule: "abstract-requirement-violation",
    severity: "error" as DiagnosticSeverity,
    message: () => "Cannot make an existing concrete requirement abstract.",
  },
  ONTOLOGICAL_INCONSISTENCY: {
    code: 4005,
    rule: "ontological-inconsistency",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, detail: string = "") => `Ontological inconsistency detected in '${name}'${detail}`,
  },
  MISSING_SUBJECT: {
    code: 4006,
    rule: "missing-subject",
    severity: "info" as DiagnosticSeverity,
    message: (name: string) => `Requirement '${name}' should have a specified subject or satisfy relation`,
  },

  // ── 5xxx: Behavior, State Machines & Formal Verification ────────────────
  CONSTRAINT_VIOLATED: {
    code: 5001,
    rule: "constraint-violated",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Constraint '${name}' evaluates to false`,
  },
  REQUIREMENT_FAILED: {
    code: 5002,
    rule: "requirement-failed",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Requirement '${name}' has constraint(s) that evaluate to false`,
  },
  REQUIREMENT_CONSTRAINT_VIOLATED: {
    code: 5002,
    rule: "requirement-failed",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Requirement '${name}' has constraint(s) that evaluate to false`,
  },
  BROKEN_INTERFACE_CONTRACT: {
    code: 5003,
    rule: "broken-interface-contract",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, reason: string) => `Broken interface contract on '${name}': ${reason}`,
  },
  INTERFACE_CONTRACT_BROKEN: {
    code: 5003,
    rule: "interface-contract-broken",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, reason: string) => `Broken interface contract on '${name}': ${reason}`,
  },
  ACTIVITY_CFA_UNREACHABLE: {
    code: 5004,
    rule: "activity-cfa-unreachable",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => detail,
  },
  ACTIVITY_SOUNDNESS_VIOLATION: {
    code: 5005,
    rule: "activity-soundness-violation",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => detail,
  },
  DEFINITE_ASSIGNMENT_VIOLATION: {
    code: 5006,
    rule: "definite-assignment-violation",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Variable '${name}' may be used before definite assignment`,
  },
  PACKAGE_NAMING: {
    code: 1005,
    rule: "package-naming",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Package '${name}' should start with an uppercase letter`,
  },
  EMPTY_PACKAGE: {
    code: 4007,
    rule: "empty-package",
    severity: "info" as DiagnosticSeverity,
    message: (name: string) => `Package '${name}' has no members`,
  },
  STATEMACHINE_NONDETERMINISTIC: {
    code: 5007,
    rule: "statemachine-nondeterministic",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `Non-deterministic guards detected: ${detail}`,
  },
  STATEMACHINE_DEADLOCK: {
    code: 5008,
    rule: "statemachine-deadlock",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => `Deadlock gap detected in transition guards: ${detail}`,
  },
} as const;

/**
 * Creates a structured LintResult annotated with numeric error code.
 */
export function createSysML2Diagnostic(
  def: ErrorCodeDef,
  args: any[] = [],
  options?: LintRangeOptions,
): LintResult & { rule?: string } {
  return {
    code: def.code,
    rule: def.rule,
    severity: def.severity,
    message: def.message(...args),
    ...options,
  };
}
