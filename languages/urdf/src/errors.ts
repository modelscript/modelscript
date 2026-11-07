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
  NEGATIVE_LINK_MASS: {
    code: "M7509",
    rule: "negative-link-mass",
    severity: "error" as const,
    message: (linkName: string, mass: number) => `Link '${linkName}' specifies negative mass (${mass} kg).`,
  },
  INERTIA_TRIANGLE_INEQUALITY: {
    code: "M7510",
    rule: "inertia-triangle-inequality",
    severity: "error" as const,
    message: (linkName: string) => `Link '${linkName}' principal inertia violates triangle inequality: Ixx + Iyy < Izz.`,
  },
  MIMIC_JOINT_CYCLE: {
    code: "M7511",
    rule: "mimic-joint-cycle",
    severity: "error" as const,
    message: (jointName: string) => `Joint '${jointName}' mimic definition creates a circular dependency.`,
  },
  MISSING_COLLISION_WITH_VISUAL: {
    code: "M7512",
    rule: "missing-collision-with-visual",
    severity: "warning" as const,
    message: (linkName: string) => `Link '${linkName}' defines visual geometry but lacks a collision envelope.`,
  },
  UNRESOLVED_CHILD_LINK: {
    code: "M7513",
    rule: "unresolved-child-link",
    severity: "error" as const,
    message: (jointName: string, linkName: string) => `Joint '${jointName}' references non-existent child link '${linkName}'.`,
  },
  DUPLICATE_JOINT_NAME: {
    code: "M7514",
    rule: "duplicate-joint-name",
    severity: "error" as const,
    message: (jointName: string) => `Joint identifier '${jointName}' is declared multiple times in robot model.`,
  },
} as const;

export type UrdfErrorCodeKey = keyof typeof UrdfErrorCode;
