// SPDX-License-Identifier: AGPL-3.0-or-later

import { polyhedron, type PolyhedronSolid } from "@modelscript/cad";
import { weldStlMesh } from "../solver/index.js";
import type { StlFacet, StlMeshDocument, Vec3 } from "../types.js";

export interface StlToCadOptions {
  name?: string | undefined;
  weldEpsilon?: number | undefined;
}

/**
 * Lowers an STL triangle mesh into a `@modelscript/cad` `PolyhedronSolid`
 * by spatially welding shared vertices and emitting indexed triangular face loops.
 */
export function stlToCadSolid(doc: StlMeshDocument, options?: StlToCadOptions): PolyhedronSolid {
  const weldEps = options?.weldEpsilon ?? 1e-6;
  const { points, faces } = weldStlMesh(doc, weldEps);
  const name = options?.name ?? doc.solids[0]?.name ?? doc.header ?? "StlMesh";

  return polyhedron({
    name: name || "StlMesh",
    points,
    faces,
  });
}

function computeNormal(v0: Vec3, v1: Vec3, v2: Vec3): Vec3 {
  const e1x = v1[0] - v0[0];
  const e1y = v1[1] - v0[1];
  const e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0];
  const e2y = v2[1] - v0[1];
  const e2z = v2[2] - v0[2];
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-15) return [0, 0, 0];
  return [nx / len, ny / len, nz / len];
}

/**
 * Converts a `@modelscript/cad` `PolyhedronSolid` back into an `StlMeshDocument`
 * by fan-triangulating polygonal face loops.
 */
export function cadSolidToStl(solid: PolyhedronSolid): StlMeshDocument {
  const facets: StlFacet[] = [];
  for (const face of solid.faces) {
    if (face.length < 3) continue;
    const i0 = face[0]!;
    const p0 = solid.points[i0];
    if (!p0) continue;
    for (let k = 1; k < face.length - 1; k++) {
      const i1 = face[k]!;
      const i2 = face[k + 1]!;
      const p1 = solid.points[i1];
      const p2 = solid.points[i2];
      if (!p1 || !p2) continue;
      const v0: Vec3 = [p0[0], p0[1], p0[2]];
      const v1: Vec3 = [p1[0], p1[1], p1[2]];
      const v2: Vec3 = [p2[0], p2[1], p2[2]];
      facets.push({
        normal: computeNormal(v0, v1, v2),
        vertices: [v0, v1, v2],
      });
    }
  }

  return {
    format: "ascii",
    header: solid.name,
    solids: [
      {
        name: solid.name,
        closed: true,
        facets,
      },
    ],
    facets,
    errors: [],
  };
}
