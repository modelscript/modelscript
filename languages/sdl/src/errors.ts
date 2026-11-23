// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for ITU-T Z.100 SDL-88 (`SDL1001`–`SDL5006`).
 */

export interface SdlDiagnostic {
  code: number;
  id: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  startOffset?: number | undefined;
  endOffset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  symbolName?: string | undefined;
}

export const SdlErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "SDL1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `SDL-88 syntax error: ${detail}.`,
  },
  DUPLICATE_SYSTEM: {
    code: 2001,
    id: "SDL2001",
    rule: "duplicate-system",
    severity: "error" as const,
    message: (name: string) => `Duplicate SYSTEM declaration '${name}'.`,
  },
  DUPLICATE_BLOCK: {
    code: 2002,
    id: "SDL2002",
    rule: "duplicate-block",
    severity: "error" as const,
    message: (name: string) => `Duplicate BLOCK declaration '${name}' in system.`,
  },
  DUPLICATE_PROCESS: {
    code: 2003,
    id: "SDL2003",
    rule: "duplicate-process",
    severity: "error" as const,
    message: (name: string, blockName: string) => `Duplicate PROCESS declaration '${name}' in block '${blockName}'.`,
  },
  DUPLICATE_STATE: {
    code: 2004,
    id: "SDL2004",
    rule: "duplicate-state",
    severity: "error" as const,
    message: (stateName: string, processName: string) =>
      `Duplicate STATE declaration '${stateName}' in process '${processName}'.`,
  },
  UNDEFINED_SIGNAL: {
    code: 3001,
    id: "SDL3001",
    rule: "undefined-signal",
    severity: "error" as const,
    message: (signalName: string, context: string) => `Undefined signal '${signalName}' referenced in ${context}.`,
  },
  UNDEFINED_TIMER: {
    code: 3002,
    id: "SDL3002",
    rule: "undefined-timer",
    severity: "error" as const,
    message: (timerName: string, processName: string) =>
      `Undefined timer '${timerName}' referenced in process '${processName}'.`,
  },
  UNDEFINED_STATE: {
    code: 3003,
    id: "SDL3003",
    rule: "undefined-state",
    severity: "error" as const,
    message: (stateName: string, processName: string) =>
      `Undefined target state '${stateName}' in NEXTSTATE within process '${processName}'.`,
  },
  UNREACHABLE_STATE: {
    code: 4001,
    id: "SDL4001",
    rule: "unreachable-state",
    severity: "warning" as const,
    message: (stateName: string, processName: string) =>
      `State '${stateName}' in process '${processName}' is unreachable from START.`,
  },
  DEADLOCK_STATE: {
    code: 4002,
    id: "SDL4002",
    rule: "deadlock-state",
    severity: "warning" as const,
    message: (stateName: string, processName: string) =>
      `State '${stateName}' in process '${processName}' is a sink/deadlock state with no outgoing transitions.`,
  },
  UNMATCHED_NEXTSTATE: {
    code: 5001,
    id: "SDL5001",
    rule: "unmatched-nextstate",
    severity: "error" as const,
    message: (context: string, processName: string) =>
      `Transition in ${context} of process '${processName}' is missing a terminating NEXTSTATE or STOP.`,
  },
  MISSING_START: {
    code: 5002,
    id: "SDL5002",
    rule: "missing-start",
    severity: "error" as const,
    message: (processName: string) => `Process '${processName}' is missing a mandatory START transition.`,
  },
  DISCONNECTED_CHANNEL: {
    code: 5003,
    id: "SDL5003",
    rule: "disconnected-channel",
    severity: "warning" as const,
    message: (channelName: string, reason: string) => `Channel '${channelName}' is disconnected: ${reason}.`,
  },
  DISCONNECTED_SIGNALROUTE: {
    code: 5004,
    id: "SDL5004",
    rule: "disconnected-signalroute",
    severity: "warning" as const,
    message: (routeName: string, blockName: string, reason: string) =>
      `Signalroute '${routeName}' in block '${blockName}' is disconnected: ${reason}.`,
  },
  UNCONSUMED_SIGNAL: {
    code: 5005,
    id: "SDL5005",
    rule: "unconsumed-signal",
    severity: "info" as const,
    message: (signalName: string) => `Declared signal '${signalName}' is never consumed by any INPUT transition.`,
  },
  TIMER_NEVER_SET: {
    code: 5006,
    id: "SDL5006",
    rule: "timer-never-set",
    severity: "warning" as const,
    message: (timerName: string, processName: string) =>
      `Timer '${timerName}' in process '${processName}' is awaited in INPUT but never armed with SET.`,
  },
} as const;
