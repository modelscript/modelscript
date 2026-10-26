// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/adams — Standard Diagnostic Error Codes (M7301–M7320).
 */

export const AdamsErrorCode = {
  OVERCONSTRAINED_MOBILITY: {
    code: "M7301",
    rule: "overconstrained-mobility",
    severity: "error" as const,
    message: (mobility: number) =>
      `Mechanism is overconstrained according to Grübler-Kutzbach criterion (Mobility = ${mobility} < 0).`,
  },
  GIMBAL_LOCK_ORIENTATION: {
    code: "M7302",
    rule: "gimbal-lock-orientation",
    severity: "warning" as const,
    message: (markerId: number, angle: number) =>
      `Euler orientation angles for marker '${markerId}' indicate near-gimbal-lock singularity (psi = ${angle.toFixed(1)}°).`,
  },
  DANGLING_MARKER_REFERENCE: {
    code: "M7303",
    rule: "dangling-marker-reference",
    severity: "error" as const,
    message: (source: string, targetId: number | string) => `${source} references non-existent marker '${targetId}'.`,
  },
  NON_PHYSICAL_INERTIA_TENSOR: {
    code: "M7304",
    rule: "non-physical-inertia-tensor",
    severity: "error" as const,
    message: (partId: number, reason: string) => `Part '${partId}' has non-physical inertia tensor: ${reason}.`,
  },
  MASSLESS_PART_FLOATING: {
    code: "M7305",
    rule: "massless-part-floating",
    severity: "error" as const,
    message: (partId: number) => `Moving part '${partId}' has zero or negative mass without kinematic grounding.`,
  },
  COINCIDENT_JOINT_MARKERS: {
    code: "M7307",
    rule: "coincident-joint-markers",
    severity: "warning" as const,
    message: (jointId: number, iMarker: number, _jMarker?: number) =>
      `Joint '${jointId}' uses identical I and J markers ('${iMarker}').`,
  },
  NEGATIVE_SPRING_DAMPING: {
    code: "M7308",
    rule: "negative-spring-damping",
    severity: "error" as const,
    message: (springId: number, param: string, value: number) =>
      `Spring-damper '${springId}' defines non-physical negative ${param} (${value}).`,
  },
  MISSING_GROUND_PART: {
    code: "M7309",
    rule: "missing-ground-part",
    severity: "error" as const,
    message: () => `Dataset does not define a ground reference body ('PART/... GROUND').`,
  },
  UNCONSTRAINED_PART: {
    code: "M7310",
    rule: "unconstrained-part",
    severity: "warning" as const,
    message: (partId: number) =>
      `Part '${partId}' is completely disconnected from joints or force elements (floating rigid body).`,
  },
} as const;

export type AdamsErrorCodeKey = keyof typeof AdamsErrorCode;
