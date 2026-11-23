// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for NASA TRASYS (TRA1001–TRA5006).
 */

export const TrasysErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "TRA1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Syntax error in TRASYS deck: ${detail}.`,
  },
  MISSING_END_OF_DATA: {
    code: 1002,
    id: "TRA1002",
    rule: "missing-end-of-data",
    severity: "warning" as const,
    message: () => `TRASYS deck is missing terminating 'END OF DATA' card.`,
  },
  DUPLICATE_SURFACE_ID: {
    code: 2001,
    id: "TRA2001",
    rule: "duplicate-surface-id",
    severity: "error" as const,
    message: (surfaceId: string) => `Duplicate surface identifier '${surfaceId}' in HEADER SURFACE DATA.`,
  },
  DUPLICATE_NODE_ID: {
    code: 2002,
    id: "TRA2002",
    rule: "duplicate-node-id",
    severity: "warning" as const,
    message: (nodeId: number, surfaceId: string) =>
      `Thermal node '${nodeId}' referenced by surface '${surfaceId}' is already assigned to another surface.`,
  },
  INVALID_SOLAR_ABSORPTANCE: {
    code: 3001,
    id: "TRA3001",
    rule: "invalid-solar-absorptance",
    severity: "error" as const,
    message: (surfaceId: string, alpha: number) =>
      `Surface '${surfaceId}' has invalid solar absorptance alpha_s = ${alpha} (must be in [0, 1]).`,
  },
  INVALID_IR_EMISSIVITY: {
    code: 3002,
    id: "TRA3002",
    rule: "invalid-ir-emissivity",
    severity: "error" as const,
    message: (surfaceId: string, epsilon: number) =>
      `Surface '${surfaceId}' has invalid IR emissivity epsilon_IR = ${epsilon} (must be in [0, 1]).`,
  },
  NON_POSITIVE_DIMENSION: {
    code: 4001,
    id: "TRA4001",
    rule: "non-positive-dimension",
    severity: "error" as const,
    message: (surfaceId: string, dimName: string, value: number) =>
      `Surface '${surfaceId}' has non-positive geometric dimension '${dimName}' = ${value} (must be > 0).`,
  },
  INVALID_POLYGON_VERTICES: {
    code: 4002,
    id: "TRA4002",
    rule: "invalid-polygon-vertices",
    severity: "error" as const,
    message: (surfaceId: string, count: number) =>
      `Polygon surface '${surfaceId}' requires at least 3 vertices, found ${count}.`,
  },
  INVALID_ORBIT_ALTITUDE: {
    code: 5001,
    id: "TRA5001",
    rule: "invalid-orbit-altitude",
    severity: "error" as const,
    message: (altitudeKm: number) => `Invalid orbit altitude ${altitudeKm} km in HEADER ORBIT DATA (must be > 0).`,
  },
  INVALID_ORBIT_BETA: {
    code: 5002,
    id: "TRA5002",
    rule: "invalid-orbit-beta",
    severity: "error" as const,
    message: (betaDeg: number) =>
      `Invalid orbit solar beta angle ${betaDeg} deg in HEADER ORBIT DATA (must be in [-90, 90]).`,
  },
  INVALID_ORBIT_ALBEDO: {
    code: 5003,
    id: "TRA5003",
    rule: "invalid-orbit-albedo",
    severity: "error" as const,
    message: (albedo: number) => `Invalid planetary albedo ${albedo} in HEADER ORBIT DATA (must be in [0, 1]).`,
  },
  INVALID_SOLAR_FLUX: {
    code: 5004,
    id: "TRA5004",
    rule: "invalid-solar-flux",
    severity: "error" as const,
    message: (solarFlux: number) => `Invalid solar flux ${solarFlux} W/m^2 in HEADER ORBIT DATA (must be >= 0).`,
  },
  UNMAPPED_THERMAL_NODE: {
    code: 5005,
    id: "TRA5005",
    rule: "unmapped-thermal-node",
    severity: "warning" as const,
    message: (surfaceId: string) => `Active radiative surface '${surfaceId}' has no thermal node mapping (NODE).`,
  },
  NO_ACTIVE_SURFACES: {
    code: 5006,
    id: "TRA5006",
    rule: "no-active-surfaces",
    severity: "warning" as const,
    message: () => `TRASYS deck contains no active radiative surfaces.`,
  },
} as const;

export type TrasysErrorKey = keyof typeof TrasysErrorCode;
