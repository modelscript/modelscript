// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/slam` (SLAM1001–SLAM5006).
 */

export interface SlamDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line: number;
  column: number;
  endLine?: number | undefined;
  endColumn?: number | undefined;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  nodeId?: string | undefined;
}

export const SlamErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "SLAM1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `SLAM II syntax error: ${detail}.`,
  },
  UNDEFINED_RESOURCE: {
    code: 2001,
    id: "SLAM2001",
    rule: "undefined-resource",
    severity: "error" as const,
    message: (resource: string, nodeType: string) =>
      `Undefined resource '${resource}' referenced in '${nodeType}' node.`,
  },
  UNDEFINED_NODE_LABEL: {
    code: 2002,
    id: "SLAM2002",
    rule: "undefined-node-label",
    severity: "error" as const,
    message: (label: string) => `Undefined target node label '${label}' referenced in network routing.`,
  },
  UNDEFINED_GATE: {
    code: 2003,
    id: "SLAM2003",
    rule: "undefined-gate",
    severity: "error" as const,
    message: (gate: string, nodeType: string) => `Undefined gate '${gate}' referenced in '${nodeType}' node.`,
  },
  UNMATCHED_NETWORK: {
    code: 3001,
    id: "SLAM3001",
    rule: "unmatched-network",
    severity: "error" as const,
    message: (detail: string) => `Unmatched NETWORK/ENDNETWORK block: ${detail}.`,
  },
  MISSING_FIN: {
    code: 3002,
    id: "SLAM3002",
    rule: "missing-fin",
    severity: "warning" as const,
    message: () => `Missing terminating 'FIN' control statement at end of SLAM II input deck.`,
  },
  INVALID_CONTINUOUS_COUNT: {
    code: 4001,
    id: "SLAM4001",
    rule: "invalid-continuous-count",
    severity: "error" as const,
    message: (detail: string) => `Invalid CONTINUOUS NNEQD/NNEQS specification: ${detail}.`,
  },
  INVALID_DETECT_DIRECTION: {
    code: 4002,
    id: "SLAM4002",
    rule: "invalid-detect-direction",
    severity: "error" as const,
    message: (direction: string) =>
      `Invalid DETECT threshold crossing direction '${direction}'; expected one of 'XP', 'XN', 'X', 'P', or 'N'.`,
  },
  INVALID_CREATE_PARAM: {
    code: 5001,
    id: "SLAM5001",
    rule: "invalid-create-param",
    severity: "error" as const,
    message: (detail: string) => `Invalid CREATE node parameter: ${detail}.`,
  },
  INVALID_RESOURCE_CAPACITY: {
    code: 5002,
    id: "SLAM5002",
    rule: "invalid-resource-capacity",
    severity: "error" as const,
    message: (resource: string, cap: number) =>
      `Invalid capacity ${cap} for RESOURCE '${resource}'; capacity must be a positive integer.`,
  },
  INVALID_QUEUE_PARAM: {
    code: 5003,
    id: "SLAM5003",
    rule: "invalid-queue-param",
    severity: "error" as const,
    message: (detail: string) => `Invalid QUEUE node parameter: ${detail}.`,
  },
  INVALID_ACTIVITY_PARAM: {
    code: 5004,
    id: "SLAM5004",
    rule: "invalid-activity-param",
    severity: "error" as const,
    message: (detail: string) => `Invalid ACTIVITY branch parameter: ${detail}.`,
  },
  DUPLICATE_NODE_LABEL: {
    code: 5005,
    id: "SLAM5005",
    rule: "duplicate-node-label",
    severity: "error" as const,
    message: (label: string) => `Duplicate network node label '${label}'.`,
  },
  UNDECLARED_CONTINUOUS_STATE: {
    code: 5006,
    id: "SLAM5006",
    rule: "undeclared-continuous-state",
    severity: "error" as const,
    message: (detail: string) => `Continuous state equation error: ${detail}.`,
  },
} as const;
