// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for SIMSCRIPT II.5 (`SIMS1001`–`SIMS5006`).
 */

export const SimscriptErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "SIMS1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `SIMSCRIPT II.5 syntax error: ${detail}.`,
  },
  MISSING_PREAMBLE_END: {
    code: 1002,
    id: "SIMS1002",
    rule: "missing-preamble-end",
    severity: "error" as const,
    message: () => `Missing 'END' statement terminating the 'PREAMBLE' section.`,
  },
  DUPLICATE_DECLARATION: {
    code: 2001,
    id: "SIMS2001",
    rule: "duplicate-declaration",
    severity: "error" as const,
    message: (kind: string, name: string) => `Duplicate ${kind} declaration '${name}' in PREAMBLE.`,
  },
  UNDEFINED_RESOURCE: {
    code: 2002,
    id: "SIMS2002",
    rule: "undefined-resource",
    severity: "error" as const,
    message: (stmt: string, resource: string) =>
      `Undefined resource '${resource}' referenced in '${stmt}' statement (must be declared under RESOURCES in PREAMBLE).`,
  },
  UNDEFINED_SET: {
    code: 2003,
    id: "SIMS2003",
    rule: "undefined-set",
    severity: "error" as const,
    message: (stmt: string, setName: string) =>
      `Undefined set '${setName}' referenced in '${stmt}' statement (must be declared via OWNS or DEFINE ... SET in PREAMBLE).`,
  },
  MISMATCHED_REQUEST_RELINQUISH: {
    code: 3001,
    id: "SIMS3001",
    rule: "mismatched-request-relinquish",
    severity: "warning" as const,
    message: (routine: string, resource: string, requested: number, relinquished: number) =>
      `Mismatched REQUEST/RELINQUISH for resource '${resource}' in '${routine}': requested ${requested} unit(s), relinquished ${relinquished} unit(s).`,
  },
  MISSING_START_SIMULATION: {
    code: 4001,
    id: "SIMS4001",
    rule: "missing-start-simulation",
    severity: "error" as const,
    message: () => `MAIN routine does not contain a 'START SIMULATION' statement.`,
  },
  INVALID_RESOURCE_CAPACITY: {
    code: 5001,
    id: "SIMS5001",
    rule: "invalid-resource-capacity",
    severity: "error" as const,
    message: (resource: string, cap: number) =>
      `Invalid capacity ${cap} for resource '${resource}': capacity must be a positive integer.`,
  },
  INVALID_DISTRIBUTION_PARAM: {
    code: 5002,
    id: "SIMS5002",
    rule: "invalid-distribution-param",
    severity: "error" as const,
    message: (dist: string, detail: string) => `Invalid parameter in distribution '${dist}': ${detail}.`,
  },
  UNDEFINED_PROCESS_TARGET: {
    code: 5003,
    id: "SIMS5003",
    rule: "undefined-process-target",
    severity: "error" as const,
    message: (name: string) => `Undefined process '${name}' referenced in 'ACTIVATE' statement.`,
  },
  UNDEFINED_EVENT_TARGET: {
    code: 5004,
    id: "SIMS5004",
    rule: "undefined-event-target",
    severity: "error" as const,
    message: (name: string) => `Undefined event notice '${name}' referenced in 'SCHEDULE' statement.`,
  },
  UNREFERENCED_STAT_TARGET: {
    code: 5005,
    id: "SIMS5005",
    rule: "unreferenced-stat-target",
    severity: "warning" as const,
    message: (statKind: string, statName: string, target: string) =>
      `${statKind} '${statName}' tracks undeclared target '${target}'.`,
  },
  EMPTY_ROUTINE_BODY: {
    code: 5006,
    id: "SIMS5006",
    rule: "empty-routine-body",
    severity: "warning" as const,
    message: (kind: string, name: string) => `${kind} '${name}' has an empty body with no executable statements.`,
  },
} as const;

export type SimscriptErrorCodeKey = keyof typeof SimscriptErrorCode;
