// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Diagnostic Error Codes (OBJ1001–OBJ5006).
 */

export type ObjSeverity = "error" | "warning" | "info";

export interface ObjDiagnostic {
  /** Formatted diagnostic identifier, e.g. `"OBJ2002"`. */
  id: string;
  /** Numeric code matching `ObjErrorCode`. */
  code: number;
  /** Kebab-case rule identifier. */
  rule: string;
  /** Diagnostic severity. */
  severity: ObjSeverity;
  /** Human-readable diagnostic message. */
  message: string;
  /** 1-based line number. */
  line: number;
  /** Optional 1-based column number. */
  column?: number | undefined;
}

export const ObjErrorCode = {
  SYNTAX_ERROR: {
    code: 1001,
    id: "OBJ1001",
    rule: "syntax-error",
    severity: "error" as const,
    message: (detail: string) => `Wavefront OBJ/MTL syntax error: ${detail}.`,
  },
  ZERO_INDEX: {
    code: 2001,
    id: "OBJ2001",
    rule: "zero-index",
    severity: "error" as const,
    message: (kind: string) => `Invalid zero index for '${kind}'; Wavefront OBJ indices are 1-based.`,
  },
  VERTEX_INDEX_OUT_OF_RANGE: {
    code: 2002,
    id: "OBJ2002",
    rule: "vertex-index-out-of-range",
    severity: "error" as const,
    message: (index: number, count: number) => `Vertex index '${index}' is out of range for ${count} defined vertices.`,
  },
  TEXCOORD_INDEX_OUT_OF_RANGE: {
    code: 2003,
    id: "OBJ2003",
    rule: "texcoord-index-out-of-range",
    severity: "error" as const,
    message: (index: number, count: number) =>
      `Texture coordinate index '${index}' is out of range for ${count} defined texture coordinates.`,
  },
  NORMAL_INDEX_OUT_OF_RANGE: {
    code: 2004,
    id: "OBJ2004",
    rule: "normal-index-out-of-range",
    severity: "error" as const,
    message: (index: number, count: number) =>
      `Vertex normal index '${index}' is out of range for ${count} defined vertex normals.`,
  },
  FACE_TOO_FEW_VERTICES: {
    code: 3001,
    id: "OBJ3001",
    rule: "face-too-few-vertices",
    severity: "error" as const,
    message: (count: number) => `Face directive 'f' requires at least 3 vertices, found ${count}.`,
  },
  DEGENERATE_FACE: {
    code: 3002,
    id: "OBJ3002",
    rule: "degenerate-face",
    severity: "warning" as const,
    message: (faceIndex: number) => `Face #${faceIndex} is degenerate with zero surface area.`,
  },
  UNDEFINED_MATERIAL: {
    code: 4001,
    id: "OBJ4001",
    rule: "undefined-material",
    severity: "warning" as const,
    message: (materialName: string) =>
      `Material '${materialName}' referenced by 'usemtl' is not defined in the provided MTL library.`,
  },
  MTL_COLOR_OUT_OF_RANGE: {
    code: 4002,
    id: "OBJ4002",
    rule: "mtl-color-out-of-range",
    severity: "warning" as const,
    message: (materialName: string, prop: string, value: number) =>
      `MTL material '${materialName}' property '${prop}' has color component '${value}' outside [0, 1].`,
  },
  NON_MANIFOLD_EDGE: {
    code: 5006,
    id: "OBJ5006",
    rule: "non-manifold-edge",
    severity: "warning" as const,
    message: (v0: number, v1: number, incidentFaces: number) =>
      `Non-manifold edge (${v0 + 1}, ${v1 + 1}) is shared by ${incidentFaces} faces (expected at most 2).`,
  },
} as const;
