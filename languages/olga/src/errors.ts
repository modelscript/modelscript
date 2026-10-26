// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Standard Diagnostic Error Codes (M7001–M7020).
 */

export const OlgaErrorCode = {
  CFL_CONDITION_VIOLATION: {
    code: "M7001",
    rule: "cfl-condition-violation",
    severity: "error" as const,
    message: (maxDt: number, cflDt: number) =>
      `Simulation timestep maxDt (${maxDt} s) violates convective/acoustic CFL stability limit (${cflDt.toFixed(3)} s).`,
  },
  INVALID_PIPE_DIMENSIONS: {
    code: "M7002",
    rule: "invalid-pipe-dimensions",
    severity: "error" as const,
    message: (sectionId: string, reason: string) => `Pipe section '${sectionId}' has invalid geometry: ${reason}.`,
  },
  MISSING_BOUNDARY_CONDITION: {
    code: "M7003",
    rule: "missing-boundary-condition",
    severity: "error" as const,
    message: (flowpath: string, missing: string) =>
      `Flowpath '${flowpath}' has no defined ${missing} boundary condition.`,
  },
  STEEP_ELEVATION_WARNING: {
    code: "M7004",
    rule: "steep-elevation-warning",
    severity: "warning" as const,
    message: (sectionId: string, angle: number) =>
      `Pipe section '${sectionId}' has steep inclination (${angle.toFixed(1)}°), risking hydrodynamic slugging.`,
  },
  FULLY_CLOSED_CHOKE_HAZARD: {
    code: "M7005",
    rule: "fully-closed-choke-hazard",
    severity: "error" as const,
    message: (chokeName: string) =>
      `Choke valve '${chokeName}' is fully closed (opening = 0) with no active bypass route.`,
  },
  SEVERE_SLUGGING_HAZARD: {
    code: "M7006",
    rule: "severe-slugging-hazard",
    severity: "warning" as const,
    message: (flowpath: string) =>
      `Severe slugging geometry detected on flowpath '${flowpath}' (seabed dip to steep riser).`,
  },
  PIG_STUCK_HAZARD: {
    code: "M7007",
    rule: "pig-stuck-hazard",
    severity: "error" as const,
    message: (pigName: string, reqPres: number, maxPres: number) =>
      `Pig '${pigName}' required differential pressure (${reqPres.toFixed(1)} bar) exceeds maximum available (${maxPres.toFixed(1)} bar).`,
  },
  PVT_TABLE_MISSING_OR_INVALID: {
    code: "M7008",
    rule: "pvt-table-missing-or-invalid",
    severity: "error" as const,
    message: (detail: string) => `PVT fluid table validation error: ${detail}.`,
  },
  WAX_DEPOSITION_RISK: {
    code: "M7009",
    rule: "wax-deposition-risk",
    severity: "warning" as const,
    message: (flowpath: string, minTemp: number, wat: number) =>
      `Fluid temperature (${minTemp.toFixed(1)}°C) on flowpath '${flowpath}' drops below Wax Appearance Temperature (${wat.toFixed(1)}°C).`,
  },
  SAND_EROSION_OR_DROPOUT_HAZARD: {
    code: "M7010",
    rule: "sand-erosion-or-dropout-hazard",
    severity: "warning" as const,
    message: (sectionId: string, reason: string) => `Sand transport issue on section '${sectionId}': ${reason}.`,
  },
  SOUR_SERVICE_METALLURGY_VIOLATION: {
    code: "M7011",
    rule: "sour-service-metallurgy-violation",
    severity: "error" as const,
    message: (flowpath: string, ppH2S: number, limit: number) =>
      `H2S partial pressure (${ppH2S.toFixed(2)} bar) on flowpath '${flowpath}' violates NACE MR0175 material limit (${limit.toFixed(2)} bar).`,
  },
  ASPHALTENE_PRECIPITATION_HAZARD: {
    code: "M7012",
    rule: "asphaltene-precipitation-hazard",
    severity: "warning" as const,
    message: (flowpath: string, pMin: number, aop: number) =>
      `Operating pressure (${pMin.toFixed(1)} bar) on flowpath '${flowpath}' enters Asphaltene Onset Pressure envelope (${aop.toFixed(1)} bar).`,
  },
  HEATEXCHANGER_PARAMETER_VIOLATION: {
    code: "M7013",
    rule: "heatexchanger-parameter-violation",
    severity: "error" as const,
    message: (hxName: string, detail: string) => `Heat exchanger '${hxName}' parameter violation: ${detail}.`,
  },
} as const;

export type OlgaErrorCodeKey = keyof typeof OlgaErrorCode;
