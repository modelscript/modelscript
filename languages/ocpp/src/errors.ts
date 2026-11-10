// SPDX-License-Identifier: AGPL-3.0-or-later

export const OcppErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "ocpp-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax or JSON-RPC format error in OCPP deck: ${err}.`,
  },
  POWER_LIMIT_EXCEEDED: {
    code: 3001,
    rule: "ocpp-power-limit-exceeded",
    severity: "warning" as const,
    message: (stationId: string, totalKw: number, limitKw: number) =>
      `Station '${stationId}' total peak power draw (${totalKw} kW) exceeds upstream grid transformer limit (${limitKw} kW).`,
  },
  INVALID_SOC_RANGE: {
    code: 3002,
    rule: "ocpp-invalid-soc-range",
    severity: "error" as const,
    message: (txId: string, currentSoC: number, targetSoC: number) =>
      `Charging session '${txId}' has invalid SoC range: current ${currentSoC}, target ${targetSoC}. Values must be in [0.0, 1.0] with target > current.`,
  },
  CONNECTOR_NOT_FOUND: {
    code: 4001,
    rule: "ocpp-connector-not-found",
    severity: "error" as const,
    message: (stationId: string, evseId: number, connId: number) =>
      `EVSE '${evseId}', connector '${connId}' in station '${stationId}' has invalid ID (must be positive integer).`,
  },
  DEADLINE_INFEASIBLE: {
    code: 5001,
    rule: "ocpp-deadline-infeasible",
    severity: "warning" as const,
    message: (txId: string, neededKWh: number, maxDeliverableKWh: number, departureMinutes: number) =>
      `Session '${txId}' requires ${neededKWh.toFixed(1)} kWh, but connector can only deliver ${maxDeliverableKWh.toFixed(1)} kWh in ${departureMinutes} min. Target SoC will not be reached before departure.`,
  },
};
