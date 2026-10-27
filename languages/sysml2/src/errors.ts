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
  field?: string | undefined;
  /** Starting byte offset in source. */
  startOffset?: number | undefined;
  /** Ending byte offset in source. */
  endOffset?: number | undefined;
}

/**
 * Definition of a SysML v2 error code rule.
 */
export interface ErrorCodeDef<TArgs extends readonly unknown[] = readonly never[]> {
  /** Unique numeric diagnostic code (1xxx-5xxx). */
  code: number;
  /** Kebab-case rule identifier used for filtering and suppression. */
  rule: string;
  /** Default severity level emitted when this rule triggers. */
  severity: DiagnosticSeverity;
  /** Message formatter accepting rule-specific context arguments. */
  message: (...args: TArgs) => string;
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
  UNRESOLVED_TRANSITION_STATE: {
    code: 2006,
    rule: "unresolved-transition-state",
    severity: "error" as DiagnosticSeverity,
    message: (stateName: string) => `Transition state '${stateName}' could not be resolved in enclosing state machine.`,
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
  EMPTY_PACKAGE: {
    code: 4007,
    rule: "empty-package",
    severity: "info" as DiagnosticSeverity,
    message: (name: string) => `Package '${name}' has no members`,
  },
  REQUIREMENT_WITHOUT_CONSTRAINT: {
    code: 4008,
    rule: "requirement-without-constraint",
    severity: "info" as DiagnosticSeverity,
    message: (name: string) => `Requirement '${name}' has no constraints or textual documentation`,
  },
  EMPTY_VERIFICATION_CASE: {
    code: 4009,
    rule: "empty-verification-case",
    severity: "info" as DiagnosticSeverity,
    message: (name: string) => `Verification case '${name}' has no verify requirements or sub-actions`,
  },
  MISSING_VERIFICATION_OBJECTIVE: {
    code: 4010,
    rule: "missing-verification-objective",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Verification case '${name}' has no verification objective or verify statement`,
  },
  UNVERIFIED_REQUIREMENT: {
    code: 4011,
    rule: "unverified-requirement",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string, pkgName: string) =>
      `Requirement '${name}' is not verified by any verification case in package '${pkgName}'`,
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
    severity: "warning" as DiagnosticSeverity,
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
  SATISFYING_VIOLATED_REQUIREMENT: {
    code: 5009,
    rule: "satisfying-violated-requirement",
    severity: "error" as DiagnosticSeverity,
    message: (partName: string, reqName: string, violations: string) =>
      `Part '${partName}' cannot satisfy requirement '${reqName}': ${violations}`,
  },
  CONFLICTING_REQUIREMENTS: {
    code: 5010,
    rule: "conflicting-requirements",
    severity: "error" as DiagnosticSeverity,
    message: (pkgName: string, conflictNames: string, witnessStr: string = "") =>
      `Conflicting requirements in '${pkgName}': ${conflictNames} cannot be simultaneously satisfied.${witnessStr}`,
  },
  INTERPROCEDURAL_CONTRACT_VIOLATION: {
    code: 5011,
    rule: "interprocedural-contract-violation",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => detail,
  },
  LOOP_NON_TERMINATING: {
    code: 5012,
    rule: "loop-non-terminating",
    severity: "warning" as DiagnosticSeverity,
    message: (detail: string) => detail,
  },
  DECISION_TABLE_NON_EXHAUSTIVE: {
    code: 5013,
    rule: "decision-table-non-exhaustive",
    severity: "warning" as DiagnosticSeverity,
    message: (decideName: string, detail?: string) =>
      detail ? `Decision node '${decideName}' is not exhaustive: ${detail}` : decideName,
  },
  DECISION_TABLE_NONDETERMINISTIC: {
    code: 5014,
    rule: "decision-table-nondeterministic",
    severity: "error" as DiagnosticSeverity,
    message: (decideName: string, detail?: string) =>
      detail ? `Decision node '${decideName}' has overlapping branch guards: ${detail}` : decideName,
  },
  DECISION_TABLE_DEAD_BRANCH: {
    code: 5015,
    rule: "decision-table-dead-branch",
    severity: "warning" as DiagnosticSeverity,
    message: (decideName: string, detail?: string) =>
      detail ? `Decision node '${decideName}' has dead branch(es): ${detail}` : decideName,
  },
  ACTIVITY_SAFETY_VIOLATION: {
    code: 5016,
    rule: "activity-safety-violation",
    severity: "error" as DiagnosticSeverity,
    message: (detail: string) => detail,
  },
} as const;

/**
 * Creates a structured LintResult annotated with numeric error code and optional byte span.
 *
 * @param def - Error code definition from `SysML2ErrorCode`.
 * @param args - Arguments forwarded to `def.message(...)`.
 * @param options - Optional source range or AST field targeting options.
 * @returns Formatted `LintResult` ready for IDE/CLI consumption.
 */
export function createSysML2Diagnostic<TArgs extends readonly unknown[] = readonly unknown[]>(
  def: ErrorCodeDef<TArgs>,
  args: TArgs | readonly unknown[] = [],
  options?: LintRangeOptions,
): LintResult & { rule?: string | undefined } {
  return {
    code: def.code,
    rule: def.rule,
    severity: def.severity,
    message: (def.message as (...a: readonly unknown[]) => string)(...args),
    ...options,
  };
}

// Precompute numeric code -> ErrorCodeDef lookup table (first registration wins for aliases)
const sysml2ErrorsByCode = new Map<number, ErrorCodeDef>();
for (const def of Object.values(SysML2ErrorCode)) {
  if (!sysml2ErrorsByCode.has(def.code)) {
    sysml2ErrorsByCode.set(def.code, def);
  }
}

/**
 * Look up a SysML v2 error code definition by numeric code, `"Sxxxx"` string, or kebab-case rule name.
 *
 * @param codeOrRule - Numeric code (e.g. `3001`), prefixed code (`"S3001"`), or rule slug (`"type-mismatch"`).
 * @returns Matching `ErrorCodeDef` or `undefined` if not registered.
 */
export function getSysML2ErrorCodeDef(codeOrRule: number | string): ErrorCodeDef | undefined {
  if (typeof codeOrRule === "number") {
    return sysml2ErrorsByCode.get(codeOrRule);
  }
  const numMatch = /^S?(\d+)$/i.exec(codeOrRule.trim());
  if (numMatch) {
    return sysml2ErrorsByCode.get(Number(numMatch[1]));
  }
  const norm = codeOrRule.toLowerCase();
  for (const def of Object.values(SysML2ErrorCode)) {
    if (def.rule.toLowerCase() === norm) return def;
  }
  return undefined;
}
