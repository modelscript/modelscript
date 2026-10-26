// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — Standard Diagnostic Error Codes (M7501–M7520).
 */

export const UrdfErrorCode = {
  UNRESOLVED_PARENT_LINK: {
    code: "M7501",
    rule: "unresolved-parent-link",
    severity: "error" as const,
    message: (jointName: string, linkName: string) =>
      `Joint '${jointName}' references non-existent parent link '${linkName}'.`,
  },
  KINEMATIC_LOOP: {
    code: "M7502",
    rule: "kinematic-loop",
    severity: "error" as const,
    message: (linkName: string) =>
      `Closed kinematic chain or duplicate parent detected at link '${linkName}' (URDF requires open tree).`,
  },
  INVALID_INERTIA_TENSOR: {
    code: "M7503",
    rule: "invalid-inertia-tensor",
    severity: "error" as const,
    message: (linkName: string, reason: string) => `Link '${linkName}' defines non-physical inertia tensor: ${reason}.`,
  },
  INVALID_JOINT_LIMITS: {
    code: "M7504",
    rule: "invalid-joint-limits",
    severity: "error" as const,
    message: (jointName: string, lower: number, upper: number) =>
      `Joint '${jointName}' defines invalid limits (lower: ${lower} >= upper: ${upper}).`,
  },
  MISSING_MESH_RESOURCE: {
    code: "M7505",
    rule: "missing-mesh-resource",
    severity: "warning" as const,
    message: (linkName: string, uri: string) =>
      `Visual mesh URI '${uri}' on link '${linkName}' may not resolve at runtime.`,
  },
  MASSLESS_LINK: {
    code: "M7506",
    rule: "massless-link",
    severity: "warning" as const,
    message: (linkName: string) => `Link '${linkName}' has zero mass and no inertial specification.`,
  },
  ZERO_NORM_JOINT_AXIS: {
    code: "M7507",
    rule: "zero-norm-joint-axis",
    severity: "error" as const,
    message: (jointName: string) => `Joint '${jointName}' defines a zero-norm rotation/translation axis [0, 0, 0].`,
  },
  CONTINUOUS_JOINT_LIMITS: {
    code: "M7508",
    rule: "continuous-joint-with-limits",
    severity: "warning" as const,
    message: (jointName: string) => `Joint '${jointName}' is declared 'continuous' but specifies upper/lower limits.`,
  },
} as const;

export type UrdfErrorCodeKey = keyof typeof UrdfErrorCode;
