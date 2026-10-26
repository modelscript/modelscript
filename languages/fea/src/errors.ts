// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fea — Standard Diagnostic Error Codes (F1001–F1050 / M7401–M7408).
 */

export const FeaErrorCode = {
  ZERO_ELASTIC_MODULUS: {
    code: 7401,
    numericCode: 1001,
    stdCode: "F1001",
    rule: "zero-elastic-modulus",
    severity: "error" as const,
    message: (mat: string, val: number) => `Material '${mat}' has non-positive Young's modulus '${val}'.`,
  },
  POISSON_RATIO_LIMIT: {
    code: 7402,
    numericCode: 1002,
    stdCode: "F1002",
    rule: "poisson-ratio-limit",
    severity: "error" as const,
    message: (mat: string, val: number) =>
      `Poisson's ratio '${val}' for material '${mat}' violates physical stability bounds (-1.0 < nu < 0.5).`,
  },
  UNCONSTRAINED_RIGID_BODY: {
    code: 7403,
    numericCode: 1003,
    stdCode: "F1003",
    rule: "unconstrained-rigid-body",
    severity: "warning" as const,
    message: (name: string, count: number) =>
      `Structural mesh '${name}' has only '${count}' constrained boundary nodes; rigid-body motion may be unconstrained.`,
  },
  EMPTY_MESH: {
    code: 7404,
    numericCode: 1004,
    stdCode: "F1004",
    rule: "empty-mesh",
    severity: "error" as const,
    message: (name: string) => `FEA deck '${name}' does not contain any defined finite elements.`,
  },
  MISSING_MATERIAL_DEFINITION: {
    code: 7405,
    numericCode: 1005,
    stdCode: "F1005",
    rule: "missing-material-definition",
    severity: "error" as const,
    message: (elset: string) => `Element set '${elset}' lacks an assigned material specification or section.`,
  },
  DEGENERATE_ELEMENT_NODES: {
    code: 7406,
    numericCode: 1006,
    stdCode: "F1006",
    rule: "degenerate-element-nodes",
    severity: "error" as const,
    message: (elemId: number, type: string) =>
      `Element '${elemId}' of type '${type}' contains duplicate or degenerate node references.`,
  },
  NEGATIVE_YIELD_STRESS: {
    code: 7407,
    numericCode: 1007,
    stdCode: "F1007",
    rule: "negative-yield-stress",
    severity: "error" as const,
    message: (mat: string, val: number) =>
      `Plastic yield strength '${val}' for material '${mat}' must be strictly positive.`,
  },
  NEGATIVE_DENSITY: {
    code: 7408,
    numericCode: 1008,
    stdCode: "F1008",
    rule: "negative-density",
    severity: "warning" as const,
    message: (mat: string, val: number) =>
      `Mass density '${val}' for material '${mat}' must be strictly positive for dynamic analysis.`,
  },
} as const;

export type FeaErrorCodeKey = keyof typeof FeaErrorCode;
