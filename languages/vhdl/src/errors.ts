// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (`VHDL1001`–`VHDL5006`) for `@modelscript/vhdl`.
 *
 * Numbering scheme:
 * - `VHDL1xxx` — Parser & syntax structure
 * - `VHDL2xxx` — Name & declaration resolution
 * - `VHDL3xxx` — Port mode, width & type checking
 * - `VHDL4xxx` — Process sensitivity & synthesis (latches)
 * - `VHDL5xxx` — Concurrency, drivers, connectivity & simulation
 */

export type VhdlSeverity = "error" | "warning" | "info";

export interface VhdlDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: VhdlSeverity;
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  entityName?: string | undefined;
}

export const VhdlErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "VHDL1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in VHDL design unit: ${detail}.`,
  },
  MISMATCHED_END_NAME: {
    code: 1002,
    id: "VHDL1002",
    rule: "mismatched-end-name",
    severity: "error" as const,
    message: (kind: string, expected: string, actual: string) =>
      `Mismatched ${kind} end identifier: expected '${expected}', found '${actual}'.`,
  },
  DUPLICATE_DECLARATION: {
    code: 2001,
    id: "VHDL2001",
    rule: "duplicate-declaration",
    severity: "error" as const,
    message: (kind: string, name: string, scope: string) => `Duplicate ${kind} declaration '${name}' in '${scope}'.`,
  },
  UNDEFINED_IDENTIFIER: {
    code: 2002,
    id: "VHDL2002",
    rule: "undefined-identifier",
    severity: "error" as const,
    message: (name: string, scope: string) => `Signal, port, or variable '${name}' is not declared in '${scope}'.`,
  },
  ENTITY_NOT_FOUND: {
    code: 2003,
    id: "VHDL2003",
    rule: "entity-not-found",
    severity: "error" as const,
    message: (archName: string, entityName: string) =>
      `Architecture '${archName}' references undeclared entity '${entityName}'.`,
  },
  PORT_DIRECTION_VIOLATION: {
    code: 3001,
    id: "VHDL3001",
    rule: "port-direction-violation",
    severity: "error" as const,
    message: (portName: string, direction: string, action: "read" | "driven") =>
      `Port direction violation on '${portName}' (mode '${direction}'): port cannot be ${action} in VHDL-87/93.`,
  },
  WIDTH_MISMATCH: {
    code: 3002,
    id: "VHDL3002",
    rule: "width-mismatch",
    severity: "error" as const,
    message: (target: string, targetWidth: number, sourceWidth: number) =>
      `Vector width mismatch in assignment to '${target}': target is ${targetWidth} bits, source is ${sourceWidth} bits.`,
  },
  TYPE_MISMATCH: {
    code: 3003,
    id: "VHDL3003",
    rule: "type-mismatch",
    severity: "error" as const,
    message: (target: string, expectedType: string, actualType: string) =>
      `Type mismatch in assignment to '${target}': expected '${expectedType}', got '${actualType}'.`,
  },
  INCOMPLETE_SENSITIVITY_LIST: {
    code: 4001,
    id: "VHDL4001",
    rule: "incomplete-sensitivity-list",
    severity: "warning" as const,
    message: (signalName: string, procLabel: string) =>
      `Incomplete sensitivity list in combinational process '${procLabel}': signal '${signalName}' is read but missing from sensitivity list.`,
  },
  INFERRED_LATCH: {
    code: 4002,
    id: "VHDL4002",
    rule: "inferred-latch",
    severity: "warning" as const,
    message: (signalName: string, procLabel: string) =>
      `Inferred latch for signal '${signalName}' in combinational process '${procLabel}': not assigned on all control paths.`,
  },
  MULTIPLE_DRIVERS_UNRESOLVED: {
    code: 5001,
    id: "VHDL5001",
    rule: "multiple-drivers-unresolved",
    severity: "error" as const,
    message: (signalName: string, typeName: string, driverCount: number) =>
      `Multiple concurrent drivers (${driverCount}) on unresolved signal '${signalName}' of type '${typeName}'.`,
  },
  COMBINATIONAL_LOOP: {
    code: 5002,
    id: "VHDL5002",
    rule: "combinational-loop",
    severity: "warning" as const,
    message: (signalName: string) =>
      `Potential zero-delay combinational feedback loop involving signal '${signalName}'.`,
  },
  UNCONNECTED_PORT: {
    code: 5003,
    id: "VHDL5003",
    rule: "unconnected-port",
    severity: "warning" as const,
    message: (portName: string, instLabel: string) =>
      `Input port '${portName}' of component instance '${instLabel}' is left unconnected.`,
  },
  MISSING_RESET_ASSIGNMENT: {
    code: 5004,
    id: "VHDL5004",
    rule: "missing-reset-assignment",
    severity: "warning" as const,
    message: (signalName: string, procLabel: string) =>
      `Registered signal '${signalName}' in synchronous process '${procLabel}' is not initialized in the reset branch.`,
  },
  UNUSED_SIGNAL: {
    code: 5005,
    id: "VHDL5005",
    rule: "unused-signal",
    severity: "info" as const,
    message: (signalName: string, archName: string) =>
      `Signal '${signalName}' declared in architecture '${archName}' is never read.`,
  },
  DELTA_CYCLE_LIMIT: {
    code: 5006,
    id: "VHDL5006",
    rule: "delta-cycle-limit",
    severity: "error" as const,
    message: (limit: number) => `RTL simulation exceeded maximum delta-cycle limit (${limit}) without converging.`,
  },
} as const;
