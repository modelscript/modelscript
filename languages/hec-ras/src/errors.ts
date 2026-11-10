// SPDX-License-Identifier: AGPL-3.0-or-later

export const HecRasErrorCode = {
  PARSE_ERROR: {
    code: 1001,
    rule: "hecras-parse-error",
    severity: "error" as const,
    message: (err: string) => `Syntax error in HEC-RAS deck: ${err}.`,
  },
  REACH_NOT_FOUND: {
    code: 2001,
    rule: "hecras-reach-not-found",
    severity: "error" as const,
    message: (river: string, reach: string) => `River '${river}', reach '${reach}' was referenced but not defined in geometry.`,
  },
  STATION_INVERSION: {
    code: 3001,
    rule: "hecras-station-inversion",
    severity: "error" as const,
    message: (station: number, prevSta: number, currSta: number) =>
      `Cross-section at station '${station}' has inverted station offsets: ${currSta} <= ${prevSta}. Offsets must be strictly monotonically increasing.`,
  },
  MANNING_OUT_OF_BOUNDS: {
    code: 3002,
    rule: "hecras-manning-out-of-bounds",
    severity: "warning" as const,
    message: (station: number, n: number) =>
      `Manning roughness coefficient ${n} at station '${station}' is outside typical physical bounds (0.01 - 0.20).`,
  },
  BANK_STATION_OUT_OF_BOUNDS: {
    code: 3003,
    rule: "hecras-bank-station-out-of-bounds",
    severity: "error" as const,
    message: (station: number, bank: number, minSta: number, maxSta: number) =>
      `Bank station ${bank} at station '${station}' is outside cross-section limits [${minSta}, ${maxSta}].`,
  },
  DISCONNECTED_REACH: {
    code: 4001,
    rule: "hecras-disconnected-reach",
    severity: "error" as const,
    message: (river: string, reach: string) =>
      `River reach '${river}, ${reach}' has fewer than 2 cross-sections and cannot form a valid conveyance profile.`,
  },
  ADVERSE_SLOPE: {
    code: 5001,
    rule: "hecras-adverse-slope",
    severity: "warning" as const,
    message: (usStation: number, dsStation: number, usBed: number, dsBed: number) =>
      `Adverse bed slope detected between upstream station '${usStation}' (invert ${usBed} m) and downstream station '${dsStation}' (invert ${dsBed} m).`,
  },
  MISSING_DOWNSTREAM_BOUNDARY: {
    code: 5002,
    rule: "hecras-missing-downstream-boundary",
    severity: "error" as const,
    message: (river: string, reach: string) =>
      `Reach '${river}, ${reach}' is missing a downstream boundary condition (Normal Depth, Known WS, or Rating Curve).`,
  },
};
