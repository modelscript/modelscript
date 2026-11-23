// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/esterel` (`EST1001`–`EST5006`).
 */
export const EsterelErrorCode = {
  // 1xxx: Syntax & Parsing
  SYNTAX_ERROR: {
    code: "EST1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in Esterel module: ${detail}.`,
  },
  UNMATCHED_BLOCK: {
    code: "EST1002",
    rule: "unmatched-block",
    severity: "error" as const,
    message: (blockKind: string) => `Unmatched '${blockKind}' block; missing closing 'end'.`,
  },

  // 2xxx: Name & Scope Resolution
  DUPLICATE_MODULE: {
    code: "EST2001",
    rule: "duplicate-module",
    severity: "error" as const,
    message: (moduleName: string) => `Duplicate module declaration '${moduleName}'.`,
  },
  DUPLICATE_SIGNAL: {
    code: "EST2002",
    rule: "duplicate-signal",
    severity: "error" as const,
    message: (signalName: string, scope: string) => `Duplicate signal declaration '${signalName}' in '${scope}'.`,
  },
  UNDECLARED_SIGNAL: {
    code: "EST2003",
    rule: "undeclared-signal",
    severity: "error" as const,
    message: (signalName: string, moduleName: string) =>
      `Signal '${signalName}' is referenced in module '${moduleName}' without declaration.`,
  },
  UNDEFINED_TRAP: {
    code: "EST2004",
    rule: "undefined-trap",
    severity: "error" as const,
    message: (trapName: string) => `Statement 'exit ${trapName}' references undefined trap '${trapName}'.`,
  },
  DUPLICATE_TRAP: {
    code: "EST2005",
    rule: "duplicate-trap",
    severity: "error" as const,
    message: (trapName: string) => `Duplicate trap declaration '${trapName}' in the same 'trap' block.`,
  },

  // 3xxx: Interface & Relation Constraints
  INVALID_RELATION_CONFLICT: {
    code: "EST3001",
    rule: "invalid-relation-conflict",
    severity: "error" as const,
    message: (detail: string) => `Invalid signal relation conflict: ${detail}.`,
  },
  RELATION_NON_INPUT: {
    code: "EST3002",
    rule: "relation-non-input",
    severity: "warning" as const,
    message: (signalName: string) =>
      `Signal '${signalName}' in 'relation' clause is not declared as an input or inputoutput signal.`,
  },

  // 4xxx: Constructive Semantics & Reactivity
  INSTANTANEOUS_LOOP: {
    code: "EST4001",
    rule: "instantaneous-loop",
    severity: "error" as const,
    message: (moduleName: string) =>
      `Instantaneous infinite loop detected in module '${moduleName}': loop body can terminate without executing 'pause', 'await', 'halt', or 'sustain'.`,
  },
  CAUSALITY_CYCLE_NEGATIVE: {
    code: "EST4002",
    rule: "constructive-causality-cycle",
    severity: "error" as const,
    message: (cyclePath: string) =>
      `Non-constructive negative causality cycle detected: ${cyclePath} (e.g., 'present S else emit S').`,
  },
  CAUSALITY_CYCLE_POSITIVE: {
    code: "EST4003",
    rule: "positive-causality-cycle",
    severity: "error" as const,
    message: (cyclePath: string) => `Instantaneous self-referential causality cycle detected: ${cyclePath}.`,
  },

  // 5xxx: Structural & Behavioral Checks
  UNREACHABLE_STATEMENT: {
    code: "EST5001",
    rule: "unreachable-statement",
    severity: "warning" as const,
    message: (afterKind: string) => `Unreachable statement following '${afterKind}'.`,
  },
  EMIT_INPUT_SIGNAL: {
    code: "EST5002",
    rule: "emit-input-signal",
    severity: "error" as const,
    message: (signalName: string, direction: string) =>
      `Cannot emit ${direction} signal '${signalName}'; only 'output', 'inputoutput', or local signals may be emitted.`,
  },
  UNKNOWN_RUN_MODULE: {
    code: "EST5003",
    rule: "unknown-run-module",
    severity: "warning" as const,
    message: (targetModule: string) =>
      `Submodule '${targetModule}' referenced by 'run' is not defined in this compilation unit.`,
  },
  EMPTY_MODULE_BODY: {
    code: "EST5004",
    rule: "empty-module-body",
    severity: "warning" as const,
    message: (moduleName: string) => `Module '${moduleName}' has an empty reactive body.`,
  },
  DUPLICATE_HANDLER: {
    code: "EST5005",
    rule: "duplicate-trap-handler",
    severity: "error" as const,
    message: (trapName: string) => `Duplicate 'handle ${trapName}' clause in 'trap' statement.`,
  },
  NON_CONSTRUCTIVE_DEPENDENCY: {
    code: "EST5006",
    rule: "non-constructive-dependency",
    severity: "error" as const,
    message: (signalName: string) =>
      `Signal '${signalName}' has a non-constructive instantaneous dependency that cannot be statically resolved.`,
  },
} as const;

export type EsterelErrorKey = keyof typeof EsterelErrorCode;
