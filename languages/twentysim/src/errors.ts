// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/twentysim` (TS1001–TS5001).
 */

export interface TwentySimDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  symbol?: string | undefined;
}

export const TwentySimErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "TS1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `20-sim syntax error: ${detail}.`,
  },
  UNRESOLVED_REFERENCE: {
    code: 2001,
    id: "TS2001",
    rule: "unresolved-reference",
    severity: "error" as const,
    message: (ref: string) => `Unresolved submodel or port reference '${ref}' in connection.`,
  },
  DUPLICATE_SUBMODEL: {
    code: 2002,
    id: "TS2002",
    rule: "duplicate-submodel",
    severity: "error" as const,
    message: (name: string) => `Duplicate submodel declaration '${name}' in current scope.`,
  },
  PORT_KIND_MISMATCH: {
    code: 3001,
    id: "TS3001",
    rule: "port-kind-mismatch",
    severity: "error" as const,
    message: (fromRef: string, toRef: string) =>
      `Port kind mismatch between '${fromRef}' and '${toRef}' (cannot connect power bond port to signal port).`,
  },
  CAUSALITY_CONFLICT: {
    code: 4001,
    id: "TS4001",
    rule: "causality-conflict",
    severity: "error" as const,
    message: (node: string, detail: string) => `SCAP causality conflict at '${node}': ${detail}.`,
  },
  DERIVATIVE_CAUSALITY: {
    code: 4002,
    id: "TS4002",
    rule: "derivative-causality",
    severity: "warning" as const,
    message: (element: string, kind: string) =>
      `Storage element '${element}' (${kind}) assigned derivative causality (dependent state / index > 1 DAE).`,
  },
  ALGEBRAIC_LOOP: {
    code: 4003,
    id: "TS4003",
    rule: "algebraic-loop",
    severity: "warning" as const,
    message: (cycle: string) => `Algebraic loop detected in causal signal graph: ${cycle}.`,
  },
  UNCONNECTED_PORT: {
    code: 5001,
    id: "TS5001",
    rule: "unconnected-port",
    severity: "warning" as const,
    message: (element: string, port: string) => `Power port '${element}.${port}' is unconnected.`,
  },
} as const;
