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
  MULTIPLICITY_LOWER_GT_UPPER: {
    code: 3004,
    rule: "multiplicity-lower-gt-upper",
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
  SATISFY_TARGET_NOT_REQUIREMENT: {
    code: 3005,
    rule: "satisfy-target-not-requirement",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Target '${target}' is not a Requirement`,
  },
  VERIFY_TARGET_NOT_A_REQUIREMENT: {
    code: 3006,
    rule: "verify-target-not-a-requirement",
    severity: "error" as DiagnosticSeverity,
    message: (target: string) => `Verify target '${target}' is not a Requirement`,
  },
  PORT_CONJUGATION_MISMATCH: {
    code: 3008,
    rule: "port-conjugation-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (sourceName: string, targetName: string, portType: string) =>
      `Port conjugation mismatch between '${sourceName}' and '${targetName}' of port type '${portType}'.`,
  },
  BINDING_CONNECTOR_TYPE_MISMATCH: {
    code: 3009,
    rule: "binding-connector-type-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (sourceName: string, sourceType: string, targetName: string, targetType: string) =>
      `Binding connector type mismatch between '${sourceName}' (${sourceType}) and '${targetName}' (${targetType}).`,
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
  CALC_RETURN_MISSING: {
    code: 4012,
    rule: "calc-return-missing",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string) => `Calculation '${name}' has a body without a return parameter or result expression.`,
  },
  EXPOSE_TARGET_INVALID: {
    code: 4013,
    rule: "expose-target-invalid",
    severity: "error" as DiagnosticSeverity,
    message: (target: string, viewName: string) =>
      `Exposed target '${target}' in view '${viewName}' could not be resolved.`,
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
  UNSATISFIED_CRITICAL_REQUIREMENT: {
    code: 4017,
    rule: "unsatisfied-critical-requirement",
    severity: "warning" as DiagnosticSeverity,
    message: (reqName: string) => `Critical requirement '${reqName}' has no incoming satisfy or verify relationship.`,
  },
  CIRCULAR_PORT_DELEGATION: {
    code: 4018,
    rule: "circular-port-delegation",
    severity: "error" as DiagnosticSeverity,
    message: (portName: string) => `Port '${portName}' delegation connection chain contains a cyclic dependency.`,
  },
  INCOMPATIBLE_FLOW_DIMENSIONS: {
    code: 4019,
    rule: "incompatible-flow-dimensions",
    severity: "error" as DiagnosticSeverity,
    message: (sourceFlow: string, targetFlow: string) =>
      `Flow connection links incompatible physical dimensions ('${sourceFlow}' to '${targetFlow}').`,
  },
  DEAD_STATE_TRANSITION: {
    code: 5017,
    rule: "dead-state-transition",
    severity: "warning" as DiagnosticSeverity,
    message: (transName: string) => `State transition '${transName}' guard condition is tautologically false.`,
  },
  NON_DETERMINISTIC_TRANSITIONS: {
    code: 5018,
    rule: "non-deterministic-transitions",
    severity: "warning" as DiagnosticSeverity,
    message: (stateName: string) => `State '${stateName}' has overlapping, unprioritized outgoing transition guards.`,
  },
  STATE_TRANSITION_UNREACHABLE: {
    code: 5019,
    rule: "state-transition-unreachable",
    severity: "warning" as DiagnosticSeverity,
    message: (transName: string, stateName: string) =>
      `State transition '${transName}' originates from unreachable state '${stateName}'.`,
  },
  TGG_CONFORMANCE_MISSING_PORT: {
    code: 4080,
    rule: "tgg-conformance-missing-port",
    severity: "warning" as DiagnosticSeverity,
    message: (targetName: string, targetLang: string, portName: string, portType: string, sourceName: string) =>
      `TGG conformance warning: '${targetName}' (${targetLang}) is missing counterpart port '${portName}' (${portType}) expected by '${sourceName}'.`,
  },
  TGG_CONFORMANCE_PARAM_MISMATCH: {
    code: 4081,
    rule: "tgg-conformance-param-mismatch",
    severity: "warning" as DiagnosticSeverity,
    message: (paramName: string, expectedType: string, actualType: string) =>
      `TGG conformance warning: parameter or port '${paramName}' type '${actualType}' is incompatible with '${expectedType}'.`,
  },
  TGG_CONFORMANCE_MISSING_COMPONENT: {
    code: 4082,
    rule: "tgg-conformance-missing-component",
    severity: "warning" as DiagnosticSeverity,
    message: (targetName: string, targetLang: string, compName: string, compType: string) =>
      `TGG conformance warning: '${targetName}' (${targetLang}) is missing expected component '${compName}' : '${compType}'.`,
  },
  TGG_CONFORMANCE_UNRESOLVED_TARGET: {
    code: 4083,
    rule: "tgg-conformance-unresolved-target",
    severity: "error" as DiagnosticSeverity,
    message: (sourceName: string, targetLang: string) =>
      `Counterpart element referenced by '${sourceName}' could not be resolved in '${targetLang}'.`,
  },
  STANDARD_COMPLIANCE_VIOLATION: {
    code: 5020,
    rule: "standard-compliance-violation",
    severity: "error" as DiagnosticSeverity,
    message: (clauseLabel: string, subjectName: string, reqName: string, detail: string = "") =>
      clauseLabel
        ? `[${clauseLabel}] '${subjectName}' violates requirement '${reqName}'${detail ? `: ${detail}` : "."}`
        : `'${subjectName}' violates standard requirement '${reqName}'${detail ? `: ${detail}` : "."}`,
  },
  STANDARD_COMPLIANCE_WARNING: {
    code: 5021,
    rule: "standard-compliance-warning",
    severity: "warning" as DiagnosticSeverity,
    message: (clauseLabel: string, subjectName: string, reqName: string, detail: string = "") =>
      clauseLabel
        ? `[${clauseLabel}] '${subjectName}' triggers advisory requirement '${reqName}'${detail ? `: ${detail}` : "."}`
        : `'${subjectName}' triggers advisory requirement '${reqName}'${detail ? `: ${detail}` : "."}`,
  },
  REQUIREMENT_NOT_APPLICABLE: {
    code: 5022,
    rule: "requirement-not-applicable",
    severity: "warning" as DiagnosticSeverity,
    message: (reqName: string, subjectName: string = "", clauseLabel: string = "") =>
      `${clauseLabel ? `[${clauseLabel}] ` : ""}Requirement '${reqName}' is not applicable${subjectName ? ` to '${subjectName}'` : ""}: assume constraint evaluates to false.`,
  },
  STANDARD_TABLE_LOOKUP_MISSING: {
    code: 5023,
    rule: "standard-table-lookup-missing",
    severity: "warning" as DiagnosticSeverity,
    message: (calcName: string, reason: string = "") =>
      `Standard table/calculator lookup '${calcName}' could not be evaluated${reason ? `: ${reason}` : "."}`,
  },

  // ── 2xxx (Extended): SOTA Scoping, Visibility & Specialization Hygiene ─
  UNRESOLVED_REDEFINITION_OR_SUBSETTING: {
    code: 2007,
    rule: "unresolved-redefinition-or-subsetting",
    severity: "error" as DiagnosticSeverity,
    message: (kind: string, target: string) => `Unresolved ${kind} target '${target}' in enclosing or inherited scope.`,
  },
  VISIBILITY_ACCESS_VIOLATION: {
    code: 2009,
    rule: "visibility-access-violation",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, visibility: string, owner: string) =>
      `Cannot access ${visibility} member '${name}' of '${owner}' from this scope.`,
  },
  TOP_LEVEL_IMPORT_NOT_PRIVATE: {
    code: 2010,
    rule: "top-level-import-not-private",
    severity: "warning" as DiagnosticSeverity,
    message: (pkg: string) => `Top-level import '${pkg}' should be declared 'private'.`,
  },
  INHERITED_MEMBER_SHADOWING: {
    code: 2011,
    rule: "inherited-member-shadowing",
    severity: "warning" as DiagnosticSeverity,
    message: (name: string, baseName: string) =>
      `Member '${name}' shadows inherited feature from '${baseName}' without ':>>' ('redefines').`,
  },
  UNUSED_IMPORT_OR_PRIVATE_MEMBER: {
    code: 2012,
    rule: "unused-import-or-private-member",
    severity: "info" as DiagnosticSeverity,
    message: (kind: string, name: string) => `Unused ${kind} '${name}' is never referenced.`,
  },

  // ── 3xxx (Extended): SOTA KerML / SysML v2 Type & Specialization ───────
  USAGE_DEFINITION_KIND_MISMATCH: {
    code: 3010,
    rule: "usage-definition-kind-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (usageName: string, usageKind: string, actualType: string, expectedKind: string) =>
      `Usage '${usageName}' (${usageKind}) cannot be typed by '${actualType}'; expected ${expectedKind}.`,
  },
  DISJOINT_CLASSIFIER_SPECIALIZATION: {
    code: 3011,
    rule: "disjoint-classifier-specialization",
    severity: "error" as DiagnosticSeverity,
    message: (subName: string, subKind: string, superName: string, superKind: string) =>
      `'${subName}' (${subKind}) cannot specialize disjoint classifier '${superName}' (${superKind}).`,
  },
  REDEFINITION_TYPE_NOT_CONFORMING: {
    code: 3012,
    rule: "redefinition-type-not-conforming",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, subType: string, baseFeature: string, baseType: string) =>
      `Feature '${featureName}' type '${subType}' does not conform to specialized feature '${baseFeature}' type '${baseType}'.`,
  },
  SUBSETTING_MULTIPLICITY_WIDENING: {
    code: 3013,
    rule: "subsetting-multiplicity-widening",
    severity: "warning" as DiagnosticSeverity,
    message: (featureName: string, subMult: string, baseFeature: string, baseMult: string) =>
      `Multiplicity [${subMult}] on '${featureName}' violates conformance with [${baseMult}] on '${baseFeature}'.`,
  },
  REDEFINITION_MODIFIER_CONFORMANCE: {
    code: 3014,
    rule: "redefinition-modifier-conformance",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, detail: string) =>
      `Specialization modifier conformance violation on '${featureName}': ${detail}.`,
  },
  INVOCATION_SIGNATURE_MISMATCH: {
    code: 3015,
    rule: "invocation-signature-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (callee: string, detail: string) => `Invalid invocation of '${callee}': ${detail}.`,
  },
  TRIGGER_EXPRESSION_TYPE_MISMATCH: {
    code: 3016,
    rule: "trigger-expression-type-mismatch",
    severity: "error" as DiagnosticSeverity,
    message: (construct: string, expectedType: string, actualType: string) =>
      `'${construct}' expression expects '${expectedType}', got '${actualType}'.`,
  },
  MULTIPLICITY_BOUND_NOT_NATURAL: {
    code: 3017,
    rule: "multiplicity-bound-not-natural",
    severity: "error" as DiagnosticSeverity,
    message: (boundText: string) =>
      `Multiplicity bound '${boundText}' must evaluate to a non-negative integer ('Natural') or '*'.`,
  },
  INVALID_CAST_OR_TYPE_TEST: {
    code: 3018,
    rule: "invalid-cast-or-type-test",
    severity: "warning" as DiagnosticSeverity,
    message: (op: string, sourceType: string, targetType: string) =>
      `Invalid '${op}' expression: '${sourceType}' and '${targetType}' are mutually disjoint types.`,
  },

  // ── 4xxx (Extended): SOTA Metamodel & INCOSE Requirement Rules ─────────
  VARIATION_VARIANT_MISUSE: {
    code: 4014,
    rule: "variation-variant-misuse",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, detail: string) => `Invalid variation/variant usage on '${name}': ${detail}.`,
  },
  ABSTRACT_OR_COMPOSITE_MISUSE: {
    code: 4015,
    rule: "abstract-or-composite-misuse",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, detail: string) => `Invalid modifier or composite ownership on '${name}': ${detail}.`,
  },
  PARALLEL_STATE_INVALID_TRANSITION: {
    code: 4016,
    rule: "parallel-state-invalid-transition",
    severity: "error" as DiagnosticSeverity,
    message: (stateName: string) => `Parallel state '${stateName}' cannot directly own transitions or successions.`,
  },
  DUPLICATE_SINGLETON_MEMBER: {
    code: 4020,
    rule: "duplicate-singleton-member",
    severity: "error" as DiagnosticSeverity,
    message: (memberKind: string, ownerName: string) => `'${ownerName}' may have at most one '${memberKind}' member.`,
  },
  SEND_TO_PORT_WITHOUT_VIA: {
    code: 4021,
    rule: "send-to-port-without-via",
    severity: "warning" as DiagnosticSeverity,
    message: (portName: string) =>
      `Sending to port '${portName}' should use 'via ${portName}' instead of 'to ${portName}'.`,
  },
  INTERFACE_END_NOT_PORT: {
    code: 4022,
    rule: "interface-end-not-port",
    severity: "error" as DiagnosticSeverity,
    message: (endName: string, ifaceName: string) =>
      `Interface end '${endName}' in '${ifaceName}' must be a port usage.`,
  },
  BINDING_CONNECTOR_NOT_BINARY: {
    code: 4023,
    rule: "binding-connector-not-binary",
    severity: "error" as DiagnosticSeverity,
    message: (name: string) => `Binding connector '${name}' must connect exactly two features.`,
  },
  INCOSE_REQUIREMENT_QUALITY: {
    code: 4024,
    rule: "incose-requirement-quality",
    severity: "info" as DiagnosticSeverity,
    message: (reqName: string, term: string) =>
      `Requirement '${reqName}' documentation contains ambiguous or unverified term '${term}' (INCOSE GtWR).`,
  },
  INDIVIDUAL_OR_PORTION_MISUSE: {
    code: 4025,
    rule: "individual-or-portion-misuse",
    severity: "error" as DiagnosticSeverity,
    message: (name: string, detail: string) => `Invalid individual/portion usage on '${name}': ${detail}.`,
  },
  METADATA_ANNOTATION_INVALID: {
    code: 4026,
    rule: "metadata-annotation-invalid",
    severity: "error" as DiagnosticSeverity,
    message: (metaName: string, detail: string) => `Invalid metadata annotation '${metaName}': ${detail}.`,
  },

  // ── 6xxx: Live Fast Formal Verification & Reasoner Lints (<10ms) ───────
  CONTRACT_REFINEMENT_VIOLATION: {
    code: 6001,
    rule: "contract-refinement-violation",
    severity: "error" as DiagnosticSeverity,
    message: (subName: string, superName: string, detail: string) =>
      `Behavioral Liskov substitution violated: '${subName}' does not refine contract of '${superName}' (${detail}).`,
  },
  REQUIREMENT_DECOMPOSITION_GAP: {
    code: 6002,
    rule: "requirement-decomposition-gap",
    severity: "warning" as DiagnosticSeverity,
    message: (parentReq: string, detail: string) =>
      `Requirement decomposition gap on '${parentReq}': sub-requirements do not entail parent (${detail}).`,
  },
  VACUOUS_REQUIREMENT_ASSUMPTION: {
    code: 6003,
    rule: "vacuous-requirement-assumption",
    severity: "warning" as DiagnosticSeverity,
    message: (reqName: string, detail: string) =>
      `Requirement '${reqName}' is vacuously satisfied because its 'assume' constraints are unsatisfiable (${detail}).`,
  },
  OPAQUE_INTERFACE_INCOMPATIBILITY: {
    code: 6004,
    rule: "opaque-interface-incompatibility",
    severity: "error" as DiagnosticSeverity,
    message: (sourcePort: string, targetPort: string, detail: string) =>
      `Incompatible port contract between '${sourcePort}' and '${targetPort}': ${detail}.`,
  },
  ZENO_CHATTERING_TRANSITION_CYCLE: {
    code: 6011,
    rule: "zeno-chattering-transition-cycle",
    severity: "warning" as DiagnosticSeverity,
    message: (cycleDesc: string) => `Zero-dwell Zeno chattering cycle detected across transitions: ${cycleDesc}.`,
  },
  PARALLEL_REGION_WRITE_RACE: {
    code: 6012,
    rule: "parallel-region-write-race",
    severity: "error" as DiagnosticSeverity,
    message: (stateName: string, varName: string, regA: string, regB: string) =>
      `Concurrent write race in parallel state '${stateName}': variable '${varName}' written simultaneously by regions '${regA}' and '${regB}'.`,
  },
  CALC_DOMAIN_OR_DIV_ZERO: {
    code: 6020,
    rule: "calc-domain-or-div-zero",
    severity: "error" as DiagnosticSeverity,
    message: (ownerName: string, detail: string) =>
      `Abstract interpretation domain violation in '${ownerName}': ${detail}.`,
  },
  SEQUENCE_INDEX_OUT_OF_BOUNDS: {
    code: 6021,
    rule: "sequence-index-out-of-bounds",
    severity: "error" as DiagnosticSeverity,
    message: (seqName: string, indexDesc: string, boundsDesc: string) =>
      `1-based sequence index ${indexDesc} on '${seqName}' is out of bounds (${boundsDesc}).`,
  },
  PHYSICAL_DOMAIN_IMPOSSIBILITY: {
    code: 6022,
    rule: "physical-domain-impossibility",
    severity: "error" as DiagnosticSeverity,
    message: (featureName: string, typeName: string, detail: string) =>
      `Physical domain impossibility on '${featureName}' ('${typeName}'): ${detail}.`,
  },
  OVER_OR_UNDER_CONSTRAINED_PART: {
    code: 6030,
    rule: "over-or-under-constrained-part",
    severity: "warning" as DiagnosticSeverity,
    message: (partName: string, detail: string) => `Structural equation imbalance in '${partName}': ${detail}.`,
  },
  HIGH_INDEX_PARAMETRIC_CONSTRAINT: {
    code: 6031,
    rule: "high-index-parametric-constraint",
    severity: "warning" as DiagnosticSeverity,
    message: (modelName: string, index: number | string, detail: string) =>
      `High-index parametric DAE (index ${index}) in '${modelName}': ${detail}.`,
  },
  FLOW_NETWORK_DRIVER_CONFLICT: {
    code: 6032,
    rule: "flow-network-driver-conflict",
    severity: "error" as DiagnosticSeverity,
    message: (targetPort: string, drivers: string) =>
      `Multiple conflicting 'out' flow drivers (${drivers}) connected to '${targetPort}'.`,
  },
  CYBER_PHYSICAL_NYQUIST_VIOLATION: {
    code: 6033,
    rule: "cyber-physical-nyquist-violation",
    severity: "warning" as DiagnosticSeverity,
    message: (controllerName: string, fsHz: string, minHz: string, detail: string) =>
      `Cyber-physical Nyquist violation on '${controllerName}': sampling rate ${fsHz} Hz is below required ${minHz} Hz (${detail}).`,
  },
  MULTIPLICITY_BUDGET_ROLLUP_VIOLATION: {
    code: 6041,
    rule: "multiplicity-budget-rollup-violation",
    severity: "error" as DiagnosticSeverity,
    message: (parentName: string, attrName: string, minRollup: string, limit: string) =>
      `Multiplicity roll-up violation in '${parentName}': child minimum '${attrName}' sum (${minRollup}) exceeds limit (${limit}).`,
  },
  SPATIAL_ENVELOPE_CLASH_OR_PROTRUSION: {
    code: 6042,
    rule: "spatial-envelope-clash-or-protrusion",
    severity: "warning" as DiagnosticSeverity,
    message: (ownerOrPart: string, detail: string) => `Spatial envelope violation on '${ownerOrPart}': ${detail}.`,
  },

  // ── 7xxx: On-Demand Deep Formal Verification Lints (--formal / Ansatz) ─
  HIERARCHICAL_PDR_UNSAFE_STATE: {
    code: 7001,
    rule: "hierarchical-pdr-unsafe-state",
    severity: "error" as DiagnosticSeverity,
    message: (smName: string, targetState: string, trace: string) =>
      `[IC3/PDR] Unsafe state '${targetState}' in '${smName}' is reachable (${trace}).`,
  },
  ASIL_SINGLE_POINT_OF_FAILURE: {
    code: 7002,
    rule: "asil-single-point-of-failure",
    severity: "error" as DiagnosticSeverity,
    message: (hazardName: string, detail: string) =>
      `[FTA/MCS] Safety violation for hazard '${hazardName}': ${detail}.`,
  },
  PROBABILISTIC_REQUIREMENT_VIOLATED: {
    code: 7003,
    rule: "probabilistic-requirement-violated",
    severity: "error" as DiagnosticSeverity,
    message: (reqName: string, detail: string) =>
      `[UQ/Chance] Probabilistic requirement '${reqName}' violated: ${detail}.`,
  },
  MECHANICAL_TOLERANCE_STACK_INTERFERENCE: {
    code: 7004,
    rule: "mechanical-tolerance-stack-interference",
    severity: "warning" as DiagnosticSeverity,
    message: (chainName: string, detail: string) =>
      `[Tolerance Stack] Assembly chain '${chainName}' violates clearance bounds: ${detail}.`,
  },
  RELATIONAL_HYPERPROPERTY_VIOLATION: {
    code: 7005,
    rule: "relational-hyperproperty-violation",
    severity: "error" as DiagnosticSeverity,
    message: (targetName: string, detail: string) =>
      `[2-Safety] Relational hyperproperty violated in '${targetName}': ${detail}.`,
  },
  CONTINUOUS_FLOWPIPE_OR_BARRIER_VIOLATION: {
    code: 7006,
    rule: "continuous-flowpipe-or-barrier-violation",
    severity: "error" as DiagnosticSeverity,
    message: (modelName: string, detail: string) =>
      `[DAE/Barrier] Continuous safety reachability violation in '${modelName}': ${detail}.`,
  },
  EGRAPH_REQUIREMENT_CONFLICT_OR_REDUNDANCY: {
    code: 7007,
    rule: "egraph-requirement-contradiction-or-redundancy",
    severity: "error" as DiagnosticSeverity,
    message: (reqA: string, reqB: string, detail: string) =>
      `[E-Graph] Requirement '${reqA}' and '${reqB}' exhibit ${detail}.`,
  },
  HC4_ROLLUP_BUDGET_INFEASIBLE: {
    code: 7008,
    rule: "hc4-rollup-budget-infeasible",
    severity: "error" as DiagnosticSeverity,
    message: (attrName: string, detail: string) => `[HC4] Rollup budget infeasibility on '${attrName}': ${detail}.`,
  },
  TARJAN_CYCLIC_BINDING_OR_FLOW_DEADLOCK: {
    code: 7009,
    rule: "tarjan-cyclic-binding-or-flow-deadlock",
    severity: "error" as DiagnosticSeverity,
    message: (cycleDesc: string) =>
      `[Tarjan SCC] Cyclic binding or synchronous item-flow deadlock detected: ${cycleDesc}.`,
  },
  CHC_ACTION_LOOP_TERMINATION: {
    code: 7010,
    rule: "chc-action-loop-termination",
    severity: "warning" as DiagnosticSeverity,
    message: (actionName: string, detail: string) =>
      `[CHC/Invariant] Looping action '${actionName}' failed inductive termination check: ${detail}.`,
  },
  DDE_CYBERPHYSICAL_LATENCY_INSTABILITY: {
    code: 7011,
    rule: "dde-cyberphysical-latency-instability",
    severity: "error" as DiagnosticSeverity,
    message: (partName: string, detail: string) =>
      `[DDE Flowpipe] Cyber-physical latency chain in '${partName}' exceeds stability phase margin: ${detail}.`,
  },
  HJI_ADVERSARIAL_HAZARD_REACHABLE: {
    code: 7012,
    rule: "hji-adversarial-hazard-reachable",
    severity: "error" as DiagnosticSeverity,
    message: (hazardName: string, detail: string) =>
      `[HJI Reachability] Adversarial disturbance can trigger hazard '${hazardName}': ${detail}.`,
  },
  STARSET_DECISION_TABLE_BREACH: {
    code: 7013,
    rule: "starset-decision-table-gap-or-breach",
    severity: "warning" as DiagnosticSeverity,
    message: (calcName: string, detail: string) =>
      `[Star-Set] Piecewise-linear calc/decision table '${calcName}' violates output envelope: ${detail}.`,
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
