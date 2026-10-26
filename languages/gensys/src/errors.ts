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
} as const;

export type GensysErrorCodeKey = keyof typeof GensysErrorCode;
