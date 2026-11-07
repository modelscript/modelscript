// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/scad — Standard Diagnostic Error Codes (K1001–K1020).
 */

export const ScadErrorCode = {
  UNDEFINED_VARIABLE: {
    code: 1001,
    stdCode: "K1001",
    rule: "SCAD_UNDEFINED_VARIABLE",
    severity: "error" as const,
    message: (name: string) => `Undefined variable '${name}'.`,
  },
  UNDEFINED_FUNCTION: {
    code: 1002,
    stdCode: "K1002",
    rule: "SCAD_UNDEFINED_FUNCTION",
    severity: "error" as const,
    message: (name: string) => `Undefined function '${name}'.`,
  },
  UNDEFINED_MODULE: {
    code: 1003,
    stdCode: "K1003",
    rule: "SCAD_UNDEFINED_MODULE",
    severity: "error" as const,
    message: (name: string) => `Undefined module '${name}'.`,
  },
  DIVISION_BY_ZERO: {
    code: 1004,
    stdCode: "K1004",
    rule: "SCAD_DIVISION_BY_ZERO",
    severity: "error" as const,
    message: () => `Division by zero in expression.`,
  },
  INVALID_DIMENSION: {
    code: 1005,
    stdCode: "K1005",
    rule: "SCAD_INVALID_DIMENSION",
    severity: "error" as const,
    message: (param: string, val: string | number) =>
      `Invalid non-positive dimension (${val}) in '${param}': dimensions must be > 0.`,
  },
  ARGUMENT_COUNT: {
    code: 1006,
    stdCode: "K1006",
    rule: "SCAD_ARGUMENT_COUNT",
    severity: "error" as const,
    message: (name: string, expected: number, actual: number) =>
      `Too many arguments to '${name}': expected at most ${expected}, got ${actual}.`,
  },
  UNKNOWN_PARAMETER: {
    code: 1007,
    stdCode: "K1007",
    rule: "SCAD_UNKNOWN_PARAMETER",
    severity: "error" as const,
    message: (param: string, callable: string) => `Unknown parameter '${param}' in call to '${callable}'.`,
  },
  DUPLICATE_DECLARATION: {
    code: 1008,
    stdCode: "K1008",
    rule: "SCAD_DUPLICATE_DECLARATION",
    severity: "warning" as const,
    message: (name: string) => `Variable '${name}' is assigned multiple times in the same scope.`,
  },
  MIXED_2D_3D_BOOLEAN: {
    code: 1009,
    stdCode: "K1009",
    rule: "SCAD_MIXED_2D_3D_BOOLEAN",
    severity: "error" as const,
    message: (shape2d: string, solid3d: string) =>
      `Cannot combine 2D geometry '${shape2d}' with 3D solid '${solid3d}' in CSG boolean without linear extrusion.`,
  },
  INVALID_FACET_PARAMETER: {
    code: 1010,
    stdCode: "K1010",
    rule: "SCAD_INVALID_FACET_PARAMETER",
    severity: "error" as const,
    message: (param: string, val: number) =>
      `Mesh resolution parameter '${param}' must be strictly positive (found ${val}).`,
  },
  COLLINEAR_POLYGON_VERTICES: {
    code: 1011,
    stdCode: "K1011",
    rule: "SCAD_COLLINEAR_POLYGON_VERTICES",
    severity: "warning" as const,
    message: (name: string) =>
      `Polygon '${name}' contains degenerate collinear or zero-area vertex loop.`,
  },
  UNRESOLVED_USE_INCLUDE: {
    code: 1012,
    stdCode: "K1012",
    rule: "SCAD_UNRESOLVED_USE_INCLUDE",
    severity: "error" as const,
    message: (path: string) => `Included OpenSCAD library file '${path}' cannot be resolved.`,
  },
  NON_POSITIVE_RADIUS: {
    code: 1013,
    stdCode: "K1013",
    rule: "SCAD_NON_POSITIVE_RADIUS",
    severity: "error" as const,
    message: (param: string, primitive: string, val: number) =>
      `Radius '${param}' in '${primitive}' must be strictly positive (found ${val}).`,
  },
} as const;
