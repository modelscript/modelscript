// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diagnostic error codes for `@modelscript/stl` (`STL1001`–`STL5006`).
 */

export interface StlErrorDefinition {
  readonly code: string;
  readonly rule: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: (...args: string[]) => string;
}

export const StlErrorCode = {
  SYNTAX_ERROR: {
    code: "STL1001",
    rule: "stl-syntax-error",
    severity: "error" as const,
    message: (detail: string) => `STL syntax or binary truncation error: ${detail}.`,
  },
  MISMATCHED_ENDSOLID: {
    code: "STL1002",
    rule: "stl-mismatched-endsolid",
    severity: "warning" as const,
    message: (solidName: string, endSolidName: string) =>
      `Mismatched solid name: 'solid ${solidName}' closed by 'endsolid ${endSolidName}'.`,
  },
  NAN_OR_INF_COORDINATE: {
    code: "STL2001",
    rule: "stl-nan-or-inf-coordinate",
    severity: "error" as const,
    message: (facetIdx: string) => `Facet #${facetIdx} contains a NaN or Infinite vertex/normal coordinate.`,
  },
  DEGENERATE_TRIANGLE: {
    code: "STL3001",
    rule: "stl-degenerate-triangle",
    severity: "warning" as const,
    message: (facetIdx: string, area: string) =>
      `Facet #${facetIdx} is a degenerate zero-area triangle (area = ${area}).`,
  },
  INCONSISTENT_NORMAL: {
    code: "STL3002",
    rule: "stl-inconsistent-normal",
    severity: "warning" as const,
    message: (facetIdx: string, dot: string) =>
      `Facet #${facetIdx} normal is inconsistent with right-hand-rule vertex winding (n . n_geo = ${dot}).`,
  },
  NON_MANIFOLD_EDGE: {
    code: "STL4001",
    rule: "stl-non-manifold-edge",
    severity: "error" as const,
    message: (count: string) =>
      `Mesh contains ${count} non-manifold edge(s) shared by more than 2 incident triangular faces.`,
  },
  OPEN_BOUNDARY_EDGE: {
    code: "STL4002",
    rule: "stl-open-boundary-edge",
    severity: "warning" as const,
    message: (count: string) =>
      `Mesh is not watertight: detected ${count} open boundary edge(s) with only 1 incident face.`,
  },
  NEGATIVE_SIGNED_VOLUME: {
    code: "STL5001",
    rule: "stl-negative-signed-volume",
    severity: "warning" as const,
    message: (volume: string) =>
      `Mesh has negative signed volume (${volume}), indicating inverted face normals / inward winding.`,
  },
  EMPTY_MESH: {
    code: "STL5002",
    rule: "stl-empty-mesh",
    severity: "warning" as const,
    message: () => `STL document contains zero triangular facets.`,
  },
  UNCLOSED_SOLID: {
    code: "STL5003",
    rule: "stl-unclosed-solid",
    severity: "error" as const,
    message: (solidName: string) => `ASCII STL block 'solid ${solidName}' is missing a closing 'endsolid' statement.`,
  },
  BINARY_COUNT_MISMATCH: {
    code: "STL5004",
    rule: "stl-binary-count-mismatch",
    severity: "error" as const,
    message: (expected: string, actual: string) =>
      `Binary STL facet count mismatch: header declares ${expected} facet(s) but payload contains ${actual}.`,
  },
  ZERO_NORMAL_VECTOR: {
    code: "STL5005",
    rule: "stl-zero-normal-vector",
    severity: "info" as const,
    message: (facetIdx: string) =>
      `Facet #${facetIdx} specifies a zero-length normal vector (0, 0, 0); geometric winding normal will be inferred.`,
  },
  EULER_NON_SPHERICAL: {
    code: "STL5006",
    rule: "stl-euler-characteristic",
    severity: "info" as const,
    message: (chi: string) =>
      `Watertight mesh has Euler characteristic chi = ${chi} (differs from 2 for a single genus-0 closed shell).`,
  },
} as const;

export type StlErrorCodeKey = keyof typeof StlErrorCode;
