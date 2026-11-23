// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes (SIN1001–SIN5006) for NASA SINDA / SINDA-FLUINT thermal networks.
 */

export interface SindaDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number | undefined;
  column?: number | undefined;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  nodeId?: number | undefined;
  conductorId?: number | undefined;
}

export const SindaErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "SIN1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in SINDA input deck: ${detail}.`,
  },
  MISSING_END_OF_DATA: {
    code: 1002,
    id: "SIN1002",
    rule: "missing-end-of-data",
    severity: "warning" as const,
    message: () => `Missing 'END OF DATA' terminator at end of SINDA input deck.`,
  },
  DUPLICATE_NODE_ID: {
    code: 2001,
    id: "SIN2001",
    rule: "duplicate-node-id",
    severity: "error" as const,
    message: (nodeId: number | string) => `Duplicate thermal node ID '${nodeId}' declared in NODE DATA.`,
  },
  DUPLICATE_CONDUCTOR_ID: {
    code: 2002,
    id: "SIN2002",
    rule: "duplicate-conductor-id",
    severity: "error" as const,
    message: (condId: number | string) => `Duplicate thermal conductor ID '${condId}' declared in CONDUCTOR DATA.`,
  },
  UNDEFINED_CONDUCTOR_NODE: {
    code: 2003,
    id: "SIN2003",
    rule: "undefined-conductor-node",
    severity: "error" as const,
    message: (condId: number | string, nodeId: number | string) =>
      `Conductor '${condId}' references undefined thermal node '${nodeId}'.`,
  },
  UNDEFINED_SOURCE_NODE: {
    code: 2004,
    id: "SIN2004",
    rule: "undefined-source-node",
    severity: "error" as const,
    message: (nodeId: number | string) => `Heat source in SOURCE DATA references undefined thermal node '${nodeId}'.`,
  },
  SELF_LOOP_CONDUCTOR: {
    code: 3001,
    id: "SIN3001",
    rule: "self-loop-conductor",
    severity: "error" as const,
    message: (condId: number | string, nodeId: number | string) =>
      `Self-loop conductor '${condId}' connects node '${nodeId}' to itself.`,
  },
  NEGATIVE_CAPACITANCE: {
    code: 3002,
    id: "SIN3002",
    rule: "negative-capacitance",
    severity: "error" as const,
    message: (nodeId: number | string, cap: number | string) =>
      `Thermal node '${nodeId}' has non-physical negative capacitance '${cap}' J/K.`,
  },
  NEGATIVE_CONDUCTANCE: {
    code: 3003,
    id: "SIN3003",
    rule: "negative-conductance",
    severity: "error" as const,
    message: (condId: number | string, g: number | string) =>
      `Thermal conductor '${condId}' has non-physical negative conductance magnitude '${g}'.`,
  },
  FLOATING_SUBNETWORK: {
    code: 4001,
    id: "SIN4001",
    rule: "floating-subnetwork",
    severity: "error" as const,
    message: (nodes: string) =>
      `Floating/disconnected thermal subnetwork [${nodes}] has no connected boundary node (singular steady-state matrix).`,
  },
  ZERO_CAPACITANCE_DIFFUSION: {
    code: 4002,
    id: "SIN4002",
    rule: "zero-capacitance-diffusion",
    severity: "warning" as const,
    message: (nodeId: number | string) =>
      `Diffusion node '${nodeId}' has zero thermal capacitance; treat as an arithmetic node or specify C > 0.`,
  },
  INVALID_RADIATION_TEMPERATURE: {
    code: 5001,
    id: "SIN5001",
    rule: "invalid-radiation-temperature",
    severity: "error" as const,
    message: (nodeId: number | string, tempK: number | string) =>
      `Invalid initial temperature '${tempK} K' (<= 0 K) on node '${nodeId}' in radiation thermal network.`,
  },
  INVALID_TIME_CONTROL: {
    code: 5002,
    id: "SIN5002",
    rule: "invalid-time-control",
    severity: "error" as const,
    message: (detail: string) => `Invalid transient time control in CONSTANTS DATA: ${detail}.`,
  },
  EMPTY_THERMAL_NETWORK: {
    code: 5006,
    id: "SIN5006",
    rule: "empty-thermal-network",
    severity: "error" as const,
    message: () => `Thermal network model defines no nodes in HEADER NODE DATA.`,
  },
} as const;
