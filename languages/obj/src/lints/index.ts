// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Domain Linter (OBJ1001–OBJ5006).
 *
 * Checks:
 *   - OBJ1001: Syntax errors from OBJ / MTL parser
 *   - OBJ2001: Zero index in face/line/point (Wavefront OBJ is 1-based)
 *   - OBJ2002: Out-of-range vertex index in `f`
 *   - OBJ2003: Out-of-range texture coordinate index in `f`
 *   - OBJ2004: Out-of-range vertex normal index in `f`
 *   - OBJ3001: Face with fewer than 3 vertices
 *   - OBJ3002: Degenerate zero-area face
 *   - OBJ4001: `usemtl` referencing undefined material when MTL is provided
 *   - OBJ4002: MTL color component (`Ka`, `Kd`, `Ks`, `Ke`) outside `[0, 1]`
 *   - OBJ5006: Non-manifold edge warning (shared by > 2 faces)
 */

import { ObjErrorCode, type ObjDiagnostic } from "../errors.js";
import type { MtlDocument, MtlMaterial, ObjDocument } from "../types.js";

const DEGENERATE_AREA_EPS = 1e-12;

/**
 * Lint a Wavefront MTL document for syntax errors and out-of-range color components.
 */
export function lintMtl(mtl: MtlDocument): ObjDiagnostic[] {
  const diags: ObjDiagnostic[] = [];

  for (const err of mtl.errors) {
    diags.push({
      id: ObjErrorCode.SYNTAX_ERROR.id,
      code: ObjErrorCode.SYNTAX_ERROR.code,
      rule: ObjErrorCode.SYNTAX_ERROR.rule,
      severity: ObjErrorCode.SYNTAX_ERROR.severity,
      message: ObjErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  const colorProps = ["Ka", "Kd", "Ks", "Ke"] as const;
  for (const mat of mtl.materials.values()) {
    for (const prop of colorProps) {
      const rgb = mat[prop];
      if (!rgb) continue;
      const propLine = mat.propertyLines[prop] ?? mat.line;
      for (const comp of rgb) {
        if (comp < 0 || comp > 1) {
          diags.push({
            id: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.id,
            code: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.code,
            rule: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.rule,
            severity: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.severity,
            message: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.message(mat.name, prop, comp),
            line: propLine,
          });
        }
      }
    }
  }

  return diags;
}

/**
 * Lint a parsed Wavefront OBJ document (and optional companion MTL document/map).
 */
export function lintObj(doc: ObjDocument, mtl?: MtlDocument | Map<string, MtlMaterial>): ObjDiagnostic[] {
  const diags: ObjDiagnostic[] = [];

  // 1. OBJ1001: Syntax errors
  for (const err of doc.errors) {
    diags.push({
      id: ObjErrorCode.SYNTAX_ERROR.id,
      code: ObjErrorCode.SYNTAX_ERROR.code,
      rule: ObjErrorCode.SYNTAX_ERROR.rule,
      severity: ObjErrorCode.SYNTAX_ERROR.severity,
      message: ObjErrorCode.SYNTAX_ERROR.message(err.message),
      line: err.line,
      column: err.column,
    });
  }

  // Track undirected edges -> { count, firstLine, v0, v1 } for OBJ5006 non-manifold detection
  const edgeCounts = new Map<string, { count: number; line: number; v0: number; v1: number }>();

  // 2. Inspect faces
  for (let fIdx = 0; fIdx < doc.faces.length; fIdx++) {
    const face = doc.faces[fIdx]!;

    // OBJ3001: Face with < 3 vertices
    if (face.vertices.length < 3) {
      diags.push({
        id: ObjErrorCode.FACE_TOO_FEW_VERTICES.id,
        code: ObjErrorCode.FACE_TOO_FEW_VERTICES.code,
        rule: ObjErrorCode.FACE_TOO_FEW_VERTICES.rule,
        severity: ObjErrorCode.FACE_TOO_FEW_VERTICES.severity,
        message: ObjErrorCode.FACE_TOO_FEW_VERTICES.message(face.vertices.length),
        line: face.line,
      });
    }

    let allValidVerts = face.vertices.length >= 3;

    for (const ref of face.vertices) {
      // Vertex index
      if (ref.rawV === 0) {
        allValidVerts = false;
        diags.push({
          id: ObjErrorCode.ZERO_INDEX.id,
          code: ObjErrorCode.ZERO_INDEX.code,
          rule: ObjErrorCode.ZERO_INDEX.rule,
          severity: ObjErrorCode.ZERO_INDEX.severity,
          message: ObjErrorCode.ZERO_INDEX.message("v"),
          line: face.line,
        });
      } else if (ref.v < 0 || ref.v >= doc.vertices.length) {
        allValidVerts = false;
        diags.push({
          id: ObjErrorCode.VERTEX_INDEX_OUT_OF_RANGE.id,
          code: ObjErrorCode.VERTEX_INDEX_OUT_OF_RANGE.code,
          rule: ObjErrorCode.VERTEX_INDEX_OUT_OF_RANGE.rule,
          severity: ObjErrorCode.VERTEX_INDEX_OUT_OF_RANGE.severity,
          message: ObjErrorCode.VERTEX_INDEX_OUT_OF_RANGE.message(ref.rawV, face.vertexCountAtFace),
          line: face.line,
        });
      }

      // Texture coordinate index
      if (ref.rawVt !== undefined) {
        if (ref.rawVt === 0) {
          diags.push({
            id: ObjErrorCode.ZERO_INDEX.id,
            code: ObjErrorCode.ZERO_INDEX.code,
            rule: ObjErrorCode.ZERO_INDEX.rule,
            severity: ObjErrorCode.ZERO_INDEX.severity,
            message: ObjErrorCode.ZERO_INDEX.message("vt"),
            line: face.line,
          });
        } else if (ref.vt === undefined || ref.vt < 0 || ref.vt >= doc.texCoords.length) {
          diags.push({
            id: ObjErrorCode.TEXCOORD_INDEX_OUT_OF_RANGE.id,
            code: ObjErrorCode.TEXCOORD_INDEX_OUT_OF_RANGE.code,
            rule: ObjErrorCode.TEXCOORD_INDEX_OUT_OF_RANGE.rule,
            severity: ObjErrorCode.TEXCOORD_INDEX_OUT_OF_RANGE.severity,
            message: ObjErrorCode.TEXCOORD_INDEX_OUT_OF_RANGE.message(ref.rawVt, face.texCoordCountAtFace),
            line: face.line,
          });
        }
      }

      // Normal index
      if (ref.rawVn !== undefined) {
        if (ref.rawVn === 0) {
          diags.push({
            id: ObjErrorCode.ZERO_INDEX.id,
            code: ObjErrorCode.ZERO_INDEX.code,
            rule: ObjErrorCode.ZERO_INDEX.rule,
            severity: ObjErrorCode.ZERO_INDEX.severity,
            message: ObjErrorCode.ZERO_INDEX.message("vn"),
            line: face.line,
          });
        } else if (ref.vn === undefined || ref.vn < 0 || ref.vn >= doc.normals.length) {
          diags.push({
            id: ObjErrorCode.NORMAL_INDEX_OUT_OF_RANGE.id,
            code: ObjErrorCode.NORMAL_INDEX_OUT_OF_RANGE.code,
            rule: ObjErrorCode.NORMAL_INDEX_OUT_OF_RANGE.rule,
            severity: ObjErrorCode.NORMAL_INDEX_OUT_OF_RANGE.severity,
            message: ObjErrorCode.NORMAL_INDEX_OUT_OF_RANGE.message(ref.rawVn, face.normalCountAtFace),
            line: face.line,
          });
        }
      }
    }

    if (allValidVerts) {
      // OBJ3002: Degenerate zero-area face (sum of fan triangle areas)
      const p0 = doc.vertices[face.vertices[0]!.v]!;
      let faceArea = 0;
      for (let k = 1; k < face.vertices.length - 1; k++) {
        const p1 = doc.vertices[face.vertices[k]!.v]!;
        const p2 = doc.vertices[face.vertices[k + 1]!.v]!;
        const ux = p1.x - p0.x;
        const uy = p1.y - p0.y;
        const uz = p1.z - p0.z;
        const vx = p2.x - p0.x;
        const vy = p2.y - p0.y;
        const vz = p2.z - p0.z;
        const cx = uy * vz - uz * vy;
        const cy = uz * vx - ux * vz;
        const cz = ux * vy - uy * vx;
        faceArea += 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
      }

      if (faceArea <= DEGENERATE_AREA_EPS) {
        diags.push({
          id: ObjErrorCode.DEGENERATE_FACE.id,
          code: ObjErrorCode.DEGENERATE_FACE.code,
          rule: ObjErrorCode.DEGENERATE_FACE.rule,
          severity: ObjErrorCode.DEGENERATE_FACE.severity,
          message: ObjErrorCode.DEGENERATE_FACE.message(fIdx + 1),
          line: face.line,
        });
      }

      // Accumulate polygon boundary edges for OBJ5006 non-manifold edge check
      const n = face.vertices.length;
      for (let k = 0; k < n; k++) {
        const a = face.vertices[k]!.v;
        const b = face.vertices[(k + 1) % n]!.v;
        if (a === b) continue;
        const lo = a < b ? a : b;
        const hi = a < b ? b : a;
        const key = `${lo}:${hi}`;
        const existing = edgeCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          edgeCounts.set(key, { count: 1, line: face.line, v0: lo, v1: hi });
        }
      }
    }
  }

  // 3. Check zero indices in polylines and point sets
  for (const pl of doc.polylines) {
    for (const ref of pl.vertices) {
      if (ref.rawV === 0) {
        diags.push({
          id: ObjErrorCode.ZERO_INDEX.id,
          code: ObjErrorCode.ZERO_INDEX.code,
          rule: ObjErrorCode.ZERO_INDEX.rule,
          severity: ObjErrorCode.ZERO_INDEX.severity,
          message: ObjErrorCode.ZERO_INDEX.message("v"),
          line: pl.line,
        });
      }
      if (ref.rawVt === 0) {
        diags.push({
          id: ObjErrorCode.ZERO_INDEX.id,
          code: ObjErrorCode.ZERO_INDEX.code,
          rule: ObjErrorCode.ZERO_INDEX.rule,
          severity: ObjErrorCode.ZERO_INDEX.severity,
          message: ObjErrorCode.ZERO_INDEX.message("vt"),
          line: pl.line,
        });
      }
    }
  }

  for (const pt of doc.points) {
    for (const ref of pt.vertices) {
      if (ref.rawV === 0) {
        diags.push({
          id: ObjErrorCode.ZERO_INDEX.id,
          code: ObjErrorCode.ZERO_INDEX.code,
          rule: ObjErrorCode.ZERO_INDEX.rule,
          severity: ObjErrorCode.ZERO_INDEX.severity,
          message: ObjErrorCode.ZERO_INDEX.message("v"),
          line: pt.line,
        });
      }
    }
  }

  // 4. OBJ5006: Non-manifold edges (shared by > 2 faces)
  for (const entry of edgeCounts.values()) {
    if (entry.count > 2) {
      diags.push({
        id: ObjErrorCode.NON_MANIFOLD_EDGE.id,
        code: ObjErrorCode.NON_MANIFOLD_EDGE.code,
        rule: ObjErrorCode.NON_MANIFOLD_EDGE.rule,
        severity: ObjErrorCode.NON_MANIFOLD_EDGE.severity,
        message: ObjErrorCode.NON_MANIFOLD_EDGE.message(entry.v0, entry.v1, entry.count),
        line: entry.line,
      });
    }
  }

  // 5. OBJ4001 & OBJ4002: Companion MTL checks
  const mtlMap: Map<string, MtlMaterial> | undefined = mtl instanceof Map ? mtl : mtl ? mtl.materials : doc.materials;

  if (mtlMap) {
    for (const usage of doc.usedMaterials) {
      if (!mtlMap.has(usage.name)) {
        diags.push({
          id: ObjErrorCode.UNDEFINED_MATERIAL.id,
          code: ObjErrorCode.UNDEFINED_MATERIAL.code,
          rule: ObjErrorCode.UNDEFINED_MATERIAL.rule,
          severity: ObjErrorCode.UNDEFINED_MATERIAL.severity,
          message: ObjErrorCode.UNDEFINED_MATERIAL.message(usage.name),
          line: usage.line,
        });
      }
    }

    if (mtl && !(mtl instanceof Map)) {
      diags.push(...lintMtl(mtl));
    } else {
      const colorProps = ["Ka", "Kd", "Ks", "Ke"] as const;
      for (const mat of mtlMap.values()) {
        for (const prop of colorProps) {
          const rgb = mat[prop];
          if (!rgb) continue;
          const propLine = mat.propertyLines[prop] ?? mat.line;
          for (const comp of rgb) {
            if (comp < 0 || comp > 1) {
              diags.push({
                id: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.id,
                code: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.code,
                rule: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.rule,
                severity: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.severity,
                message: ObjErrorCode.MTL_COLOR_OUT_OF_RANGE.message(mat.name, prop, comp),
                line: propLine,
              });
            }
          }
        }
      }
    }
  }

  return diags;
}

export { ObjErrorCode, type ObjDiagnostic, type ObjSeverity } from "../errors.js";
