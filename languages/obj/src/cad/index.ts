// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/obj — CAD Lowering to `@modelscript/cad` `PolyhedronSolid` & `Assembly`.
 *
 * Lowers Wavefront OBJ geometry (with fan triangulation of n-gon faces and optional
 * MTL diffuse color metadata) into `@modelscript/cad` solids.
 */

import {
  assembly,
  part,
  polyhedron,
  type Assembly,
  type Vec3 as CadVec3,
  type PolyhedronSolid,
} from "@modelscript/cad";
import { triangulateObjMesh, type TriangulatedFace } from "../solver/index.js";
import type { MtlMaterial, ObjDocument } from "../types.js";

export interface ObjCadLoweringOptions {
  /** Override root assembly/solid name. */
  name?: string | undefined;
  /** Optional uniform scale factor applied to vertex coordinates. Default: 1.0. */
  scale?: number | undefined;
  /** Optional companion MTL materials map (defaults to `doc.materials`). */
  materials?: Map<string, MtlMaterial> | undefined;
}

export interface ObjCadLoweringResult {
  /** Combined fan-triangulated `PolyhedronSolid` representing the full mesh. */
  solid: PolyhedronSolid;
  /** Per-object `PolyhedronSolid` entries (one per named object in the OBJ). */
  solids: PolyhedronSolid[];
  /** `@modelscript/cad` `Assembly` containing all lowered parts. */
  assembly: Assembly;
  /** Total triangulated face count. */
  triangleCount: number;
}

function resolveColorRgba(
  materialName: string | undefined,
  materials: Map<string, MtlMaterial> | undefined,
): readonly [number, number, number, number] | undefined {
  if (!materialName || !materials) return undefined;
  const mat = materials.get(materialName);
  if (!mat?.Kd) return undefined;
  const alpha = mat.d !== undefined ? Math.max(0, Math.min(1, mat.d)) : 1.0;
  return [mat.Kd[0], mat.Kd[1], mat.Kd[2], alpha];
}

function buildCompactPolyhedron(
  doc: ObjDocument,
  tris: TriangulatedFace[],
  name: string,
  scale: number,
  color?: readonly [number, number, number, number],
): PolyhedronSolid {
  const indexRemap = new Map<number, number>();
  const points: CadVec3[] = [];
  const faces: Array<readonly [number, number, number]> = [];

  for (const tri of tris) {
    const mapped: [number, number, number] = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const origIdx = tri.indices[k]!;
      let localIdx = indexRemap.get(origIdx);
      if (localIdx === undefined) {
        const v = doc.vertices[origIdx]!;
        localIdx = points.length;
        indexRemap.set(origIdx, localIdx);
        points.push([v.x * scale, v.y * scale, v.z * scale]);
      }
      mapped[k] = localIdx;
    }
    faces.push(mapped);
  }

  return polyhedron({
    name,
    points,
    faces,
    sourceMetadata: color ? { color } : undefined,
  });
}

/**
 * Lower a parsed Wavefront `ObjDocument` into fan-triangulated `@modelscript/cad` `PolyhedronSolid`s
 * and an `Assembly`.
 */
export function lowerObjToCad(doc: ObjDocument, options?: ObjCadLoweringOptions): ObjCadLoweringResult {
  const scale = options?.scale ?? 1.0;
  const materials = options?.materials ?? doc.materials;
  const triangles = triangulateObjMesh(doc);
  const rootName = options?.name ?? doc.objects[0]?.name ?? "ObjMesh";

  // Group triangles by object name
  const byObject = new Map<string, TriangulatedFace[]>();
  for (const tri of triangles) {
    const key = tri.objectName || "default";
    let list = byObject.get(key);
    if (!list) {
      list = [];
      byObject.set(key, list);
    }
    list.push(tri);
  }

  const solids: PolyhedronSolid[] = [];
  for (const [objName, objTris] of byObject.entries()) {
    const primaryMaterial = objTris.find((t) => t.materialName)?.materialName;
    const color = resolveColorRgba(primaryMaterial, materials);
    solids.push(buildCompactPolyhedron(doc, objTris, objName, scale, color));
  }

  const primaryColor = resolveColorRgba(triangles.find((t) => t.materialName)?.materialName, materials);
  const combinedSolid = buildCompactPolyhedron(doc, triangles, rootName, scale, primaryColor);

  const partList =
    solids.length > 0
      ? solids.map((s) =>
          part(s, {
            color: s.sourceMetadata?.color
              ? [s.sourceMetadata.color[0], s.sourceMetadata.color[1], s.sourceMetadata.color[2]]
              : undefined,
          }),
        )
      : [
          part(combinedSolid, {
            color: combinedSolid.sourceMetadata?.color
              ? [
                  combinedSolid.sourceMetadata.color[0],
                  combinedSolid.sourceMetadata.color[1],
                  combinedSolid.sourceMetadata.color[2],
                ]
              : undefined,
          }),
        ];

  const cadAssembly = assembly(rootName, partList);

  return {
    solid: combinedSolid,
    solids,
    assembly: cadAssembly,
    triangleCount: triangles.length,
  };
}
