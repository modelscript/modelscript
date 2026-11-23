// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — Wavefront OBJ Parser.
 *
 * Supports:
 *   - Geometric vertices (`v x y z [w]`)
 *   - Texture coordinates (`vt u [v] [w]`)
 *   - Vertex normals (`vn nx ny nz`)
 *   - Parameter-space vertices (`vp u [v] [w]`)
 *   - Polygonal faces (`f` with `v`, `v/vt`, `v//vn`, `v/vt/vn`, positive 1-based and negative relative indices)
 *   - Polylines (`l`) and point clouds (`p`)
 *   - Objects (`o`), groups (`g`), smoothing groups (`s`)
 *   - Material libraries (`mtllib`) and material bindings (`usemtl`)
 *   - Comments (`#`) and backslash line continuations (`\`)
 */

import type {
  MtlDocument,
  ObjDocument,
  ObjFace,
  ObjFaceVertexRef,
  ObjGroup,
  ObjMaterialUsage,
  ObjNormal,
  ObjObject,
  ObjParamVertex,
  ObjParseError,
  ObjPointSet,
  ObjPolyline,
  ObjTexCoord,
  ObjVertex,
} from "../types.js";
import { parseMtl } from "./mtl-parser.js";

/**
 * Resolve a Wavefront OBJ 1-based positive or negative relative index into a 0-based array index.
 * Returns `-1` when `raw === 0` or out of bounds.
 */
export function resolveObjIndex(raw: number, count: number): number {
  if (!Number.isInteger(raw) || raw === 0) return -1;
  const resolved = raw > 0 ? raw - 1 : count + raw;
  if (resolved < 0 || resolved >= count) return -1;
  return resolved;
}

function parseNumberStrict(token: string): number {
  const v = Number(token);
  return Number.isFinite(v) ? v : Number.NaN;
}

function parseIntStrict(token: string): number {
  if (!/^[+-]?\d+$/.test(token)) return Number.NaN;
  return Number.parseInt(token, 10);
}

/**
 * Parse a Wavefront OBJ text document into a structured `ObjDocument`.
 */
export function parseObj(source: string): ObjDocument {
  const rawLines = source.split(/\r?\n/);

  const vertices: ObjVertex[] = [];
  const texCoords: ObjTexCoord[] = [];
  const normals: ObjNormal[] = [];
  const paramVertices: ObjParamVertex[] = [];
  const faces: ObjFace[] = [];
  const polylines: ObjPolyline[] = [];
  const points: ObjPointSet[] = [];
  const objects: ObjObject[] = [];
  const groups: ObjGroup[] = [];
  const mtlLibs: string[] = [];
  const usedMaterials: ObjMaterialUsage[] = [];
  const errors: ObjParseError[] = [];

  const objectByName = new Map<string, ObjObject>();
  const groupByName = new Map<string, ObjGroup>();

  let currentObject = "default";
  let currentGroups: string[] = ["default"];
  let currentMaterial: string | undefined;
  let currentSmoothing: number | null = null;

  // Compute byte/character start offset of each raw line
  const lineOffsets: number[] = [];
  let offset = 0;
  for (let i = 0; i < rawLines.length; i++) {
    lineOffsets.push(offset);
    offset += (rawLines[i]?.length ?? 0) + 1;
  }

  for (let i = 0; i < rawLines.length; i++) {
    const startLineIdx = i;
    const startOffset = lineOffsets[startLineIdx] ?? 0;
    let combined = rawLines[i] ?? "";

    // Support backslash line continuation
    while (combined.endsWith("\\") && i + 1 < rawLines.length) {
      combined = combined.slice(0, -1) + " " + (rawLines[i + 1] ?? "");
      i++;
    }
    const endOffset = (lineOffsets[i] ?? startOffset) + (rawLines[i]?.length ?? 0);
    const lineNum = startLineIdx + 1;

    // Strip # comments
    const hashIdx = combined.indexOf("#");
    const stripped = (hashIdx >= 0 ? combined.slice(0, hashIdx) : combined).trim();
    if (!stripped) continue;

    const parts = stripped.split(/\s+/);
    const keyword = parts[0] ?? "";
    const args = parts.slice(1);

    switch (keyword) {
      case "v": {
        if (args.length < 3 || args.length > 4) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Vertex directive 'v' expects 3 or 4 coordinates, got ${args.length}`,
            raw: combined,
          });
          break;
        }
        const x = parseNumberStrict(args[0]!);
        const y = parseNumberStrict(args[1]!);
        const z = parseNumberStrict(args[2]!);
        const w = args.length === 4 ? parseNumberStrict(args[3]!) : undefined;
        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z) || (w !== undefined && Number.isNaN(w))) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Invalid numeric coordinate in vertex directive 'v'`,
            raw: combined,
          });
          break;
        }
        vertices.push({ x, y, z, w, line: lineNum });
        break;
      }

      case "vt": {
        if (args.length < 1 || args.length > 3) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Texture coordinate directive 'vt' expects 1 to 3 coordinates, got ${args.length}`,
            raw: combined,
          });
          break;
        }
        const u = parseNumberStrict(args[0]!);
        const v = args.length >= 2 ? parseNumberStrict(args[1]!) : undefined;
        const w = args.length === 3 ? parseNumberStrict(args[2]!) : undefined;
        if (Number.isNaN(u) || (v !== undefined && Number.isNaN(v)) || (w !== undefined && Number.isNaN(w))) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Invalid numeric value in texture coordinate directive 'vt'`,
            raw: combined,
          });
          break;
        }
        texCoords.push({ u, v, w, line: lineNum });
        break;
      }

      case "vn": {
        if (args.length !== 3) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Vertex normal directive 'vn' expects 3 components, got ${args.length}`,
            raw: combined,
          });
          break;
        }
        const nx = parseNumberStrict(args[0]!);
        const ny = parseNumberStrict(args[1]!);
        const nz = parseNumberStrict(args[2]!);
        if (Number.isNaN(nx) || Number.isNaN(ny) || Number.isNaN(nz)) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Invalid numeric component in vertex normal directive 'vn'`,
            raw: combined,
          });
          break;
        }
        normals.push({ nx, ny, nz, line: lineNum });
        break;
      }

      case "vp": {
        if (args.length < 1 || args.length > 3) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Parameter-space vertex directive 'vp' expects 1 to 3 values, got ${args.length}`,
            raw: combined,
          });
          break;
        }
        const u = parseNumberStrict(args[0]!);
        const v = args.length >= 2 ? parseNumberStrict(args[1]!) : undefined;
        const w = args.length === 3 ? parseNumberStrict(args[2]!) : undefined;
        if (Number.isNaN(u) || (v !== undefined && Number.isNaN(v)) || (w !== undefined && Number.isNaN(w))) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Invalid numeric value in parameter vertex directive 'vp'`,
            raw: combined,
          });
          break;
        }
        paramVertices.push({ u, v, w, line: lineNum });
        break;
      }

      case "f": {
        const faceVerts: ObjFaceVertexRef[] = [];
        let malformed = false;
        for (const token of args) {
          const segs = token.split("/");
          if (segs.length > 3 || !segs[0]) {
            errors.push({
              line: lineNum,
              column: 1,
              message: `Malformed face vertex reference '${token}'`,
              raw: combined,
            });
            malformed = true;
            continue;
          }
          const rawV = parseIntStrict(segs[0]);
          if (Number.isNaN(rawV)) {
            errors.push({
              line: lineNum,
              column: 1,
              message: `Invalid vertex index '${segs[0]}' in face directive 'f'`,
              raw: combined,
            });
            malformed = true;
            continue;
          }

          let rawVt: number | undefined;
          if (segs.length >= 2 && segs[1] !== "") {
            const parsedVt = parseIntStrict(segs[1]!);
            if (Number.isNaN(parsedVt)) {
              errors.push({
                line: lineNum,
                column: 1,
                message: `Invalid texture coordinate index '${segs[1]}' in face directive 'f'`,
                raw: combined,
              });
              malformed = true;
              continue;
            }
            rawVt = parsedVt;
          }

          let rawVn: number | undefined;
          if (segs.length === 3 && segs[2] !== "") {
            const parsedVn = parseIntStrict(segs[2]!);
            if (Number.isNaN(parsedVn)) {
              errors.push({
                line: lineNum,
                column: 1,
                message: `Invalid normal index '${segs[2]}' in face directive 'f'`,
                raw: combined,
              });
              malformed = true;
              continue;
            }
            rawVn = parsedVn;
          }

          faceVerts.push({
            v: resolveObjIndex(rawV, vertices.length),
            vt: rawVt !== undefined ? resolveObjIndex(rawVt, texCoords.length) : undefined,
            vn: rawVn !== undefined ? resolveObjIndex(rawVn, normals.length) : undefined,
            rawV,
            rawVt,
            rawVn,
          });
        }

        if (!malformed || faceVerts.length > 0) {
          const faceIdx = faces.length;
          faces.push({
            vertices: faceVerts,
            objectName: currentObject,
            groupNames: [...currentGroups],
            materialName: currentMaterial,
            smoothingGroup: currentSmoothing,
            vertexCountAtFace: vertices.length,
            texCoordCountAtFace: texCoords.length,
            normalCountAtFace: normals.length,
            line: lineNum,
            startOffset,
            endOffset,
          });

          const obj = objectByName.get(currentObject);
          if (obj) obj.faceIndices.push(faceIdx);
          for (const gName of currentGroups) {
            const grp = groupByName.get(gName);
            if (grp) grp.faceIndices.push(faceIdx);
          }
        }
        break;
      }

      case "l": {
        const lineVerts: ObjPolyline["vertices"] = [];
        for (const token of args) {
          const segs = token.split("/");
          if (segs.length > 2 || !segs[0]) {
            errors.push({
              line: lineNum,
              column: 1,
              message: `Malformed polyline vertex reference '${token}'`,
              raw: combined,
            });
            continue;
          }
          const rawV = parseIntStrict(segs[0]);
          if (Number.isNaN(rawV)) {
            errors.push({
              line: lineNum,
              column: 1,
              message: `Invalid vertex index '${segs[0]}' in polyline directive 'l'`,
              raw: combined,
            });
            continue;
          }
          let rawVt: number | undefined;
          if (segs.length === 2 && segs[1] !== "") {
            const parsedVt = parseIntStrict(segs[1]!);
            if (Number.isNaN(parsedVt)) {
              errors.push({
                line: lineNum,
                column: 1,
                message: `Invalid texcoord index '${segs[1]}' in polyline directive 'l'`,
                raw: combined,
              });
              continue;
            }
            rawVt = parsedVt;
          }
          lineVerts.push({
            v: resolveObjIndex(rawV, vertices.length),
            vt: rawVt !== undefined ? resolveObjIndex(rawVt, texCoords.length) : undefined,
            rawV,
            rawVt,
          });
        }
        polylines.push({
          vertices: lineVerts,
          objectName: currentObject,
          groupNames: [...currentGroups],
          line: lineNum,
        });
        break;
      }

      case "p": {
        const ptVerts: ObjPointSet["vertices"] = [];
        for (const token of args) {
          const rawV = parseIntStrict(token);
          if (Number.isNaN(rawV)) {
            errors.push({
              line: lineNum,
              column: 1,
              message: `Invalid vertex index '${token}' in point directive 'p'`,
              raw: combined,
            });
            continue;
          }
          ptVerts.push({
            v: resolveObjIndex(rawV, vertices.length),
            rawV,
          });
        }
        points.push({
          vertices: ptVerts,
          objectName: currentObject,
          groupNames: [...currentGroups],
          line: lineNum,
        });
        break;
      }

      case "o": {
        const name = args.join(" ").trim() || "default";
        currentObject = name;
        if (!objectByName.has(name)) {
          const obj: ObjObject = {
            name,
            line: lineNum,
            startOffset,
            endOffset,
            faceIndices: [],
          };
          objectByName.set(name, obj);
          objects.push(obj);
        }
        break;
      }

      case "g": {
        const names = args.length > 0 ? args : ["default"];
        currentGroups = names;
        for (const name of names) {
          if (!groupByName.has(name)) {
            const grp: ObjGroup = {
              name,
              line: lineNum,
              startOffset,
              endOffset,
              faceIndices: [],
            };
            groupByName.set(name, grp);
            groups.push(grp);
          }
        }
        break;
      }

      case "s": {
        const val = (args[0] ?? "off").toLowerCase();
        if (val === "off" || val === "0") {
          currentSmoothing = null;
        } else {
          const sNum = parseIntStrict(val);
          if (Number.isNaN(sNum) || sNum < 0) {
            errors.push({
              line: lineNum,
              column: 1,
              message: `Invalid smoothing group '${args[0]}'`,
              raw: combined,
            });
          } else {
            currentSmoothing = sNum;
          }
        }
        break;
      }

      case "mtllib": {
        if (args.length === 0) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Directive 'mtllib' requires at least one filename`,
            raw: combined,
          });
        } else {
          for (const lib of args) {
            mtlLibs.push(lib);
          }
        }
        break;
      }

      case "usemtl": {
        const matName = args.join(" ").trim();
        if (!matName) {
          errors.push({
            line: lineNum,
            column: 1,
            message: `Directive 'usemtl' requires a material name`,
            raw: combined,
          });
        } else {
          currentMaterial = matName;
          usedMaterials.push({
            name: matName,
            line: lineNum,
            startOffset,
            endOffset,
          });
        }
        break;
      }

      default: {
        errors.push({
          line: lineNum,
          column: 1,
          message: `Unknown Wavefront OBJ directive '${keyword}'`,
          raw: combined,
        });
        break;
      }
    }
  }

  return {
    vertices,
    texCoords,
    normals,
    paramVertices,
    faces,
    polylines,
    points,
    objects,
    groups,
    mtlLibs,
    usedMaterials,
    errors,
    rawLines,
  };
}

/**
 * Parse a Wavefront OBJ document alongside a companion MTL material library string.
 */
export function parseObjWithMtl(objSource: string, mtlSource: string): { obj: ObjDocument; mtl: MtlDocument } {
  const obj = parseObj(objSource);
  const mtl = parseMtl(mtlSource);
  obj.materials = mtl.materials;
  return { obj, mtl };
}
