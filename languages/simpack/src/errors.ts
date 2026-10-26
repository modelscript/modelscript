// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simpack — Standard Diagnostic Error Codes (K7001–K7020).
 */

export const SimpackErrorCode = {
  INVALID_BODY_MASS: {
    code: "K7001",
    rule: "invalid-body-mass",
    severity: "error" as const,
    message: (id: string, mass: number) => `Body '${id}' has non-positive mass (${mass} kg).`,
  },
  DANGLING_BODY_REFERENCE: {
    code: "K7002",
    rule: "dangling-body-reference",
    severity: "error" as const,
    message: (markerId: string, bodyId: string) => `Marker '${markerId}' references unknown parent body '${bodyId}'.`,
  },
  UNKNOWN_FROM_MARKER: {
    code: "K7003",
    rule: "unknown-from-marker",
    severity: "error" as const,
    message: (jointId: string, marker: string) => `Joint '${jointId}' references unknown from-marker '${marker}'.`,
  },
  UNKNOWN_TO_MARKER: {
    code: "K7004",
    rule: "unknown-to-marker",
    severity: "error" as const,
    message: (jointId: string, marker: string) => `Joint '${jointId}' references unknown to-marker '${marker}'.`,
  },
  OVERCONSTRAINED_MOBILITY: {
    code: "K7005",
    rule: "overconstrained-mobility",
    severity: "warning" as const,
    message: (mobility: number) =>
      `Mechanism is overconstrained according to Grübler-Kutzbach criterion (Mobility = ${mobility} < 0).`,
  },
  BAUMGARTE_DIVERGENCE: {
    code: "K7006",
    rule: "baumgarte-divergence",
    severity: "warning" as const,
    message: (jointId: string, param: string, val: number) =>
      `Joint '${jointId}' Baumgarte stabilization parameter '${param}' is non-positive or divergent (${val}).`,
  },
} as const;

export type SimpackErrorCodeKey = keyof typeof SimpackErrorCode;
