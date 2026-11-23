// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/verilog` (VLOG1001–VLOG5006).
 *
 * Numbering:
 *   VLOG1xxx — Syntax & lexical errors
 *   VLOG2xxx — Declaration & name resolution errors
 *   VLOG3xxx — Procedural & sensitivity discipline errors
 *   VLOG4xxx — Net/reg driver & connectivity errors
 *   VLOG5xxx — Bit-width, sizing & semantic warnings
 */

export interface VerilogErrorDef {
  code: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: (...args: string[]) => string;
}

export const VerilogErrorCode = {
  SYNTAX_ERROR: {
    code: "VLOG1001",
    rule: "syntax-error",
    severity: "error",
    message: (detail: string) => `Verilog syntax error: ${detail}.`,
  },
  DUPLICATE_PORT: {
    code: "VLOG2001",
    rule: "duplicate-port",
    severity: "error",
    message: (portName: string, moduleName: string) =>
      `Duplicate port declaration '${portName}' in module '${moduleName}'.`,
  },
  DUPLICATE_NET: {
    code: "VLOG2002",
    rule: "duplicate-net",
    severity: "error",
    message: (netName: string, moduleName: string) =>
      `Duplicate net or variable declaration '${netName}' in module '${moduleName}'.`,
  },
  UNDECLARED_IDENTIFIER: {
    code: "VLOG2003",
    rule: "undeclared-identifier",
    severity: "error",
    message: (ident: string, moduleName: string) =>
      `Undeclared identifier '${ident}' referenced in module '${moduleName}'.`,
  },
  BLOCKING_IN_SEQUENTIAL: {
    code: "VLOG3001",
    rule: "blocking-in-sequential",
    severity: "warning",
    message: (target: string, moduleName: string) =>
      `Blocking assignment '=' to '${target}' inside sequential 'always @(posedge/negedge ...)' block in module '${moduleName}'; prefer non-blocking '<='.`,
  },
  NONBLOCKING_IN_COMBINATIONAL: {
    code: "VLOG3002",
    rule: "nonblocking-in-combinational",
    severity: "warning",
    message: (target: string, moduleName: string) =>
      `Non-blocking assignment '<=' to '${target}' inside combinational 'always' block in module '${moduleName}'; prefer blocking '='.`,
  },
  ASSIGN_TO_WIRE_IN_ALWAYS: {
    code: "VLOG4001",
    rule: "assign-to-wire-in-always",
    severity: "error",
    message: (target: string, moduleName: string) =>
      `Procedural assignment to net '${target}' (declared as wire) inside 'always'/'initial' block in module '${moduleName}'; declare '${target}' as 'reg'.`,
  },
  MULTIPLE_DRIVERS: {
    code: "VLOG4002",
    rule: "multiple-drivers",
    severity: "error",
    message: (netName: string, count: string, moduleName: string) =>
      `Multiple drivers (${count}) on non-tri net '${netName}' in module '${moduleName}'.`,
  },
  BIT_WIDTH_TRUNCATION: {
    code: "VLOG5006",
    rule: "bit-width-truncation",
    severity: "warning",
    message: (target: string, lhsWidth: string, rhsWidth: string, moduleName: string) =>
      `Possible bit-width truncation assigning ${rhsWidth}-bit expression to ${lhsWidth}-bit target '${target}' in module '${moduleName}'.`,
  },
} as const satisfies Record<string, VerilogErrorDef>;

export type VerilogErrorKey = keyof typeof VerilogErrorCode;
