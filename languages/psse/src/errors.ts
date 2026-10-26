// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Standard Diagnostic Error Codes (P1001–P4010).
 */

export const PsseErrorCode = {
  GENERATOR_BUS_NOT_FOUND: {
    code: "P1001",
    rule: "generator-bus-not-found",
    severity: "error" as const,
    message: (genId: string, busId: number) => `Generator '${genId}' references non-existent bus ${busId}.`,
  },
  GENERATOR_NEGATIVE_POWER: {
    code: "P1002",
    rule: "generator-negative-power",
    severity: "warning" as const,
    message: (genId: string, busId: number, pg: number) =>
      `Generator '${genId}' at bus ${busId} has negative active power output (${pg} MW).`,
  },
  DUPLICATE_GENERATOR_ID: {
    code: "P1003",
    rule: "duplicate-generator-id",
    severity: "error" as const,
    message: (genId: string, busId: number) => `Duplicate generator ID '${genId}' at bus ${busId}.`,
  },
  GENERATOR_REACTIVE_LIMITS_INVERTED: {
    code: "P1004",
    rule: "generator-reactive-limits-inverted",
    severity: "error" as const,
    message: (genId: string, busId: number, qMin: number, qMax: number) =>
      `Generator '${genId}' at bus ${busId} has inverted reactive limits (QB = ${qMin} > QT = ${qMax} Mvar).`,
  },
  GENERATOR_POWER_LIMITS_INVERTED: {
    code: "P1005",
    rule: "generator-power-limits-inverted",
    severity: "error" as const,
    message: (genId: string, busId: number, pMin: number, pMax: number) =>
      `Generator '${genId}' at bus ${busId} has inverted active power limits (PB = ${pMin} > PT = ${pMax} MW).`,
  },
  ISOLATED_BUS: {
    code: "P2001",
    rule: "isolated-bus",
    severity: "warning" as const,
    message: (busId: number, busName: string) =>
      `Bus ${busId} ('${busName}') has no connected branches or transformers (isolated bus).`,
  },
  MISSING_SLACK_BUS: {
    code: "P2002",
    rule: "missing-slack-bus",
    severity: "error" as const,
    message: () =>
      `Power network base case contains 0 slack/swing buses (Bus Type 3). Power flow solution cannot be anchored.`,
  },
  MULTIPLE_SLACK_BUSES: {
    code: "P2003",
    rule: "multiple-slack-buses",
    severity: "warning" as const,
    message: (count: number) =>
      `Power network base case contains ${count} swing buses without explicit multi-island partitioning.`,
  },
  VOLTAGE_OUT_OF_BOUNDS: {
    code: "P2004",
    rule: "voltage-out-of-bounds",
    severity: "warning" as const,
    message: (busId: number, vm: number) =>
      `Initial voltage magnitude at bus ${busId} (${vm.toFixed(3)} pu) is outside standard operational limits [0.8, 1.2 pu].`,
  },
  BRANCH_FROM_BUS_NOT_FOUND: {
    code: "P3001",
    rule: "branch-from-bus-not-found",
    severity: "error" as const,
    message: (fromBus: number, toBus: number) =>
      `Branch from bus ${fromBus} to bus ${toBus} references non-existent FROM-bus ${fromBus}.`,
  },
  BRANCH_TO_BUS_NOT_FOUND: {
    code: "P3002",
    rule: "branch-to-bus-not-found",
    severity: "error" as const,
    message: (fromBus: number, toBus: number) =>
      `Branch from bus ${fromBus} to bus ${toBus} references non-existent TO-bus ${toBus}.`,
  },
  BRANCH_ZERO_IMPEDANCE: {
    code: "P3003",
    rule: "branch-zero-impedance",
    severity: "error" as const,
    message: (fromBus: number, toBus: number) =>
      `Branch between bus ${fromBus} and bus ${toBus} has zero impedance (R = 0, X = 0).`,
  },
  BRANCH_NEGATIVE_RESISTANCE: {
    code: "P3004",
    rule: "branch-negative-resistance",
    severity: "warning" as const,
    message: (fromBus: number, toBus: number, r: number) =>
      `Branch between bus ${fromBus} and bus ${toBus} defines negative resistance (${r} pu).`,
  },
  TRANSFORMER_INVALID_RATIO: {
    code: "P3005",
    rule: "transformer-invalid-ratio",
    severity: "error" as const,
    message: (fromBus: number, toBus: number, ratio: number) =>
      `Transformer between bus ${fromBus} and bus ${toBus} has non-positive turns ratio (${ratio}).`,
  },
  LOAD_BUS_NOT_FOUND: {
    code: "P4001",
    rule: "load-bus-not-found",
    severity: "error" as const,
    message: (loadId: string, busId: number) => `Load '${loadId}' references non-existent bus ${busId}.`,
  },
} as const;

export type PsseErrorCodeKey = keyof typeof PsseErrorCode;
