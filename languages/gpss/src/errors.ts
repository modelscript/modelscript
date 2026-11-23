// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/gpss` (`GPSS1001`–`GPSS5006`).
 *
 * Numbering scheme:
 * - `GPSS1xxx` — Parser / Syntax
 * - `GPSS2xxx` — Name & Label Resolution
 * - `GPSS3xxx` — Resource Pairing (`SEIZE`/`RELEASE`, `QUEUE`/`DEPART`, `ENTER`/`LEAVE`)
 * - `GPSS4xxx` — Structural / Capacity & Operand Validity
 * - `GPSS5xxx` — Simulation Control & Termination
 */

export interface GpssDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  entityName?: string | undefined;
}

export const GpssErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "GPSS1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in GPSS statement: ${detail}.`,
  },
  UNKNOWN_OPCODE: {
    code: 1002,
    id: "GPSS1002",
    rule: "unknown-opcode",
    severity: "error" as const,
    message: (opcode: string) => `Unknown GPSS block or control statement '${opcode}'.`,
  },
  DUPLICATE_LABEL: {
    code: 2001,
    id: "GPSS2001",
    rule: "duplicate-label",
    severity: "error" as const,
    message: (label: string) => `Duplicate block label '${label}' declared multiple times.`,
  },
  UNDEFINED_TRANSFER_TARGET: {
    code: 2002,
    id: "GPSS2002",
    rule: "undefined-transfer-target",
    severity: "error" as const,
    message: (target: string) => `Undefined TRANSFER target label '${target}'.`,
  },
  UNDEFINED_STORAGE: {
    code: 2003,
    id: "GPSS2003",
    rule: "undefined-storage",
    severity: "warning" as const,
    message: (storage: string) =>
      `Storage '${storage}' is referenced without a STORAGE capacity definition (defaults to capacity 1).`,
  },
  UNMATCHED_SEIZE_RELEASE: {
    code: 3001,
    id: "GPSS3001",
    rule: "unmatched-seize-release",
    severity: "error" as const,
    message: (facility: string, missing: "SEIZE" | "RELEASE") =>
      `Unmatched facility '${facility}': missing corresponding '${missing}' block.`,
  },
  UNMATCHED_QUEUE_DEPART: {
    code: 3002,
    id: "GPSS3002",
    rule: "unmatched-queue-depart",
    severity: "error" as const,
    message: (queue: string, missing: "QUEUE" | "DEPART") =>
      `Unmatched queue '${queue}': missing corresponding '${missing}' block.`,
  },
  UNMATCHED_ENTER_LEAVE: {
    code: 3003,
    id: "GPSS3003",
    rule: "unmatched-enter-leave",
    severity: "error" as const,
    message: (storage: string, missing: "ENTER" | "LEAVE") =>
      `Unmatched storage '${storage}': missing corresponding '${missing}' block.`,
  },
  NON_POSITIVE_STORAGE_CAPACITY: {
    code: 4001,
    id: "GPSS4001",
    rule: "non-positive-storage-capacity",
    severity: "error" as const,
    message: (storage: string, capacity: number) =>
      `Non-positive STORAGE capacity '${capacity}' for storage '${storage}' (must be > 0).`,
  },
  INVALID_GENERATE_OPERAND: {
    code: 4002,
    id: "GPSS4002",
    rule: "invalid-generate-operand",
    severity: "error" as const,
    message: (detail: string) => `Invalid GENERATE operand: ${detail}.`,
  },
  INVALID_ADVANCE_OPERAND: {
    code: 4003,
    id: "GPSS4003",
    rule: "invalid-advance-operand",
    severity: "error" as const,
    message: (detail: string) => `Invalid ADVANCE operand: ${detail}.`,
  },
  MISSING_START: {
    code: 5001,
    id: "GPSS5001",
    rule: "missing-start",
    severity: "error" as const,
    message: () => `Missing 'START' control statement to execute simulation.`,
  },
  MISSING_TERMINATE: {
    code: 5002,
    id: "GPSS5002",
    rule: "missing-terminate",
    severity: "error" as const,
    message: () => `Missing 'TERMINATE' block in GPSS model; simulation cannot terminate.`,
  },
  MISSING_GENERATE: {
    code: 5003,
    id: "GPSS5003",
    rule: "missing-generate",
    severity: "warning" as const,
    message: () => `Missing 'GENERATE' block in GPSS model; no transactions will be created.`,
  },
  ZERO_TERMINATE_DECREMENT: {
    code: 5004,
    id: "GPSS5004",
    rule: "zero-terminate-decrement",
    severity: "error" as const,
    message: () => `No 'TERMINATE' block specifies a positive termination counter decrement (A > 0).`,
  },
  INVALID_TRANSFER_PROBABILITY: {
    code: 5005,
    id: "GPSS5005",
    rule: "invalid-transfer-probability",
    severity: "error" as const,
    message: (prob: string) => `Invalid TRANSFER statistical probability '${prob}' (must satisfy 0 < p < 1).`,
  },
  UNREACHABLE_BLOCK: {
    code: 5006,
    id: "GPSS5006",
    rule: "unreachable-block",
    severity: "warning" as const,
    message: (opcode: string, line: number) =>
      `Unreachable '${opcode}' block at line ${line} following unconditional transfer or termination without a label.`,
  },
} as const;
