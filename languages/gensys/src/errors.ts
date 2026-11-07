// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/gensys — Standard Diagnostic Error Codes (G1001–G1020).
 */

export const GensysErrorCode = {
  INVALID_BODY_MASS: {
    code: "G1001",
    rule: "invalid-body-mass",
    severity: "error" as const,
    message: (name: string, mass: number) => `Body '${name}' has non-positive mass (${mass} kg).`,
  },
  NON_POSITIVE_INERTIA: {
    code: "G1002",
    rule: "non-positive-inertia",
    severity: "error" as const,
    message: (name: string) => `Body '${name}' has non-positive principal inertia tensor components.`,
  },
  DANGLING_BODY1_REFERENCE: {
    code: "G1003",
    rule: "dangling-body1-reference",
    severity: "error" as const,
    message: (name: string, body1: string) => `Coupling '${name}' references unknown body1 '${body1}'.`,
  },
  DANGLING_BODY2_REFERENCE: {
    code: "G1004",
    rule: "dangling-body2-reference",
    severity: "error" as const,
    message: (name: string, body2: string) => `Coupling '${name}' references unknown body2 '${body2}'.`,
  },
  INVALID_TRACK_GAUGE: {
    code: "G1005",
    rule: "invalid-track-gauge",
    severity: "error" as const,
    message: (gauge: number) => `Track specification defines non-positive or unphysical gauge (${gauge} m).`,
  },
  UNCLOSED_RAIL_PROFILE: {
    code: "G1006",
    rule: "unclosed-rail-profile",
    severity: "warning" as const,
    message: (profileName: string) =>
      `Wheel-rail contact profile '${profileName}' curve has discontinuous slope or is unclosed.`,
  },
  GAUGE_MISMATCH: {
    code: "G1007",
    rule: "gauge-mismatch",
    severity: "error" as const,
    message: (bogieGauge: number, trackGauge: number) =>
      `Wheelset nominal axle gauge (${bogieGauge} m) differs from track rail gauge (${trackGauge} m).`,
  },
  HUNTING_CONICITY_RISK: {
    code: "G1008",
    rule: "hunting-conicity-risk",
    severity: "warning" as const,
    message: (conicity: number) =>
      `Wheel-rail equivalent conicity (${conicity}) exceeds stability limit, risking bogie hunting.`,
  },
  DISCONTINUOUS_TRACK_CANT: {
    code: "G1009",
    rule: "discontinuous-track-cant",
    severity: "error" as const,
    message: () => `Track cant superelevation transition specifies discontinuous curvature gradient.`,
  },
  ZERO_AXLE_LOAD: {
    code: "G1010",
    rule: "zero-axle-load",
    severity: "error" as const,
    message: (load: number) => `Wheelset axle nominal vertical load must be strictly positive (${load} kN).`,
  },
} as const;

export type GensysErrorCodeKey = keyof typeof GensysErrorCode;
