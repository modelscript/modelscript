// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/psse — Standard Diagnostic Error Codes (P1001–P4010).
 */

export const PsseErrorCode = {
  BUS_NOT_FOUND: {
    code: "P1001",
    rule: "bus-not-found",
    severity: "error" as const,
    message: (entityKind: string, id: string, busRole: string, busId: number) =>
      `${entityKind} '${id}' references non-existent ${busRole}bus ${busId}.`,
  },
  GENERATOR_NEGATIVE_POWER: {
    code: "P1002",
    rule: "generator-negative-power",
    severity: "warning" as const,
    message: (genId: string, busId: number, pg: number) =>
      `Generator '${genId}' at bus ${busId} has negative active power output (${pg} MW).`,
  },
  DUPLICATE_EQUIPMENT_ID: {
    code: "P1003",
    rule: "duplicate-equipment-id",
    severity: "error" as const,
    message: (genId: string, busId: number) => `Duplicate generator ID '${genId}' at bus ${busId}.`,
    branchMessage: (fromBus: number, toBus: number, ckt: string) =>
      `Duplicate transmission branch between bus ${fromBus} and ${toBus} with circuit ID '${ckt}'.`,
  },
  ISOLATED_BUS: {
    code: "P2001",
    rule: "isolated-bus",
    severity: "warning" as const,
    message: (busId: number, busName: string) =>
      `Bus ${busId} ('${busName}') is isolated with 0 in-service connecting branches or transformers.`,
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
  GENERATOR_REACTIVE_LIMITS_INVERTED: {
    code: "P3001",
    rule: "generator-reactive-limits-inverted",
    severity: "error" as const,
    message: (genId: string, busId: number, qMin: number, qMax: number) =>
      `Generator '${genId}' at bus ${busId} has inverted reactive limits: Qmin (${qMin} MVAR) > Qmax (${qMax} MVAR).`,
  },
  GENERATOR_POWER_LIMITS_INVERTED: {
    code: "P3002",
    rule: "generator-power-limits-inverted",
    severity: "error" as const,
    message: (genId: string, busId: number, pMin: number, pMax: number) =>
      `Generator '${genId}' at bus ${busId} has inverted active power limits: Pmin (${pMin} MW) > Pmax (${pMax} MW).`,
  },
  GENERATOR_SCHEDULED_VOLTAGE_BOUNDS: {
    code: "P3003",
    rule: "generator-scheduled-voltage-bounds",
    severity: "warning" as const,
    message: (genId: string, vs: number) =>
      `Generator '${genId}' scheduled voltage Vs = ${vs} p.u. is outside the typical operating band [0.8, 1.2].`,
  },
  BRANCH_INVALID_REACTANCE: {
    code: "P4001",
    rule: "branch-invalid-reactance",
    severity: "error" as const,
    message: (ckt: string, fromBus: number, toBus: number, x: number) =>
      `Transmission branch '${ckt}' between bus ${fromBus} and ${toBus} has zero or negative reactance X = ${x} p.u.`,
  },
  BRANCH_BASE_KV_MISMATCH: {
    code: "P4002",
    rule: "branch-base-kv-mismatch",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, fromKv: number, toBus: number, toKv: number) =>
      `Branch '${ckt}' connects bus ${fromBus} (${fromKv} kV) to bus ${toBus} (${toKv} kV) without a transformer.`,
  },
  TRANSFORMER_TAP_OUT_OF_BOUNDS: {
    code: "P4003",
    rule: "transformer-tap-out-of-bounds",
    severity: "warning" as const,
    message: (ckt: string, fromBus: number, toBus: number, ratio: number) =>
      `Transformer '${ckt}' between bus ${fromBus} and ${toBus} has off-nominal tap ratio ${ratio} outside typical limits [0.7, 1.3].`,
  },
} as const;

export type PsseErrorCodeKey = keyof typeof PsseErrorCode;
