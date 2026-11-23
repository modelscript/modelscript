// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Triangulated terrain surface builder and `@modelscript/cad` solid lowering for USGS DEM grids.
 */

import { polyhedron, type PolyhedronSolid, type Vec3 } from "@modelscript/cad";
import type { UsgsDemModel } from "../types.js";

export interface TerrainMeshOptions {
  /** Vertical exaggeration factor (default: 1.0). */
  verticalExaggeration?: number | undefined;
  /** Shift X/Y origin to (0, 0) for local CAD coordinates (default: true). */
  localCoordinates?: boolean | undefined;
  /** Reference base datum elevation for volume calculation and solid extrusion skirt (default: grid.minZ). */
  baseElevation?: number | undefined;
  /** Close the mesh with skirt walls and a flat bottom face to form a watertight solid (default: true for CAD solid). */
  watertight?: boolean | undefined;
}

export interface TerrainTriangle {
  i0: number;
  i1: number;
  i2: number;
  normal: Vec3;
  area: number;
}

export interface TerrainMeshResult {
  name: string;
  vertices: Vec3[];
  faces: [number, number, number][];
  surfaceArea: number;
  planarArea: number;
  volumeAboveBase: number;
  baseElevation: number;
  boundingBox: {
    min: Vec3;
    max: Vec3;
  };
}

function triangleNormalAndArea(p0: Vec3, p1: Vec3, p2: Vec3): { normal: Vec3; area: number } {
  const ux = p1[0] - p0[0];
  const uy = p1[1] - p0[1];
  const uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0];
  const vy = p2[1] - p0[1];
  const vz = p2[2] - p0[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const mag = Math.hypot(nx, ny, nz);
  if (mag === 0) return { normal: [0, 0, 1], area: 0 };
  return { normal: [nx / mag, ny / mag, nz / mag], area: 0.5 * mag };
}

/**
 * Builds a triangulated terrain surface mesh from a `UsgsDemModel` grid.
 */
export function buildTerrainMesh(model: UsgsDemModel, options: TerrainMeshOptions = {}): TerrainMeshResult {
  const { grid, header } = model;
  const { numCols, numRows, dx, dy, xOrigin, yOrigin, z, voidValue, minZ } = grid;
  const zScale = options.verticalExaggeration ?? 1.0;
  const localCoords = options.localCoordinates ?? true;
  const baseZ = options.baseElevation ?? minZ;
  const watertight = options.watertight ?? false;

  const vertices: Vec3[] = [];
  const faces: [number, number, number][] = [];

  if (numCols < 2 || numRows < 2) {
    return {
      name: header.quadrangleName || "USGS_DEM_Terrain",
      vertices,
      faces,
      surfaceArea: 0,
      planarArea: 0,
      volumeAboveBase: 0,
      baseElevation: baseZ,
      boundingBox: { min: [0, 0, 0], max: [0, 0, 0] },
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZOut = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZOut = Number.NEGATIVE_INFINITY;

  const ox = localCoords ? 0 : xOrigin;
  const oy = localCoords ? 0 : yOrigin;

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const rawZ = z[r * numCols + c]!;
      const elev = rawZ === voidValue ? baseZ : rawZ;
      const x = ox + c * dx;
      const y = oy + r * dy;
      const zv = elev * zScale;
      vertices.push([x, y, zv]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (zv < minZOut) minZOut = zv;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (zv > maxZOut) maxZOut = zv;
    }
  }

  let surfaceArea = 0;
  let planarArea = 0;
  let volumeAboveBase = 0;

  for (let r = 0; r < numRows - 1; r++) {
    for (let c = 0; c < numCols - 1; c++) {
      const i00 = r * numCols + c;
      const i10 = r * numCols + (c + 1);
      const i01 = (r + 1) * numCols + c;
      const i11 = (r + 1) * numCols + (c + 1);

      const p00 = vertices[i00]!;
      const p10 = vertices[i10]!;
      const p01 = vertices[i01]!;
      const p11 = vertices[i11]!;

      // Two CCW triangles per grid cell (normal +Z)
      faces.push([i00, i10, i11]);
      faces.push([i00, i11, i01]);

      const t1 = triangleNormalAndArea(p00, p10, p11);
      const t2 = triangleNormalAndArea(p00, p11, p01);
      surfaceArea += t1.area + t2.area;
      const cellPlanar = dx * dy;
      planarArea += cellPlanar;

      // Exact prism volume under the two triangles above baseZ * zScale
      const baseScaled = baseZ * zScale;
      const h00 = Math.max(0, p00[2] - baseScaled);
      const h10 = Math.max(0, p10[2] - baseScaled);
      const h01 = Math.max(0, p01[2] - baseScaled);
      const h11 = Math.max(0, p11[2] - baseScaled);
      const triAreaPlanar = 0.5 * cellPlanar;
      volumeAboveBase += triAreaPlanar * ((h00 + h10 + h11) / 3 + (h00 + h11 + h01) / 3);
    }
  }

  if (watertight) {
    const skirtBaseZ = (baseZ - Math.max(1, (grid.maxZ - grid.minZ) * 0.05)) * zScale;
    if (skirtBaseZ < minZOut) minZOut = skirtBaseZ;

    // Add 4 bottom corner vertices + boundary skirt vertices
    const bSW = vertices.length;
    vertices.push([ox, oy, skirtBaseZ]);
    const bSE = vertices.length;
    vertices.push([ox + (numCols - 1) * dx, oy, skirtBaseZ]);
    const bNE = vertices.length;
    vertices.push([ox + (numCols - 1) * dx, oy + (numRows - 1) * dy, skirtBaseZ]);
    const bNW = vertices.length;
    vertices.push([ox, oy + (numRows - 1) * dy, skirtBaseZ]);

    // Bottom face (normal -Z)
    faces.push([bSW, bNW, bNE]);
    faces.push([bSW, bNE, bSE]);

    // South edge (r = 0)
    for (let c = 0; c < numCols - 1; c++) {
      faces.push([c, bSW, c + 1]);
    }
    faces.push([numCols - 1, bSW, bSE]);

    // East edge (c = numCols - 1)
    for (let r = 0; r < numRows - 1; r++) {
      faces.push([r * numCols + (numCols - 1), bSE, (r + 1) * numCols + (numCols - 1)]);
    }
    faces.push([(numRows - 1) * numCols + (numCols - 1), bSE, bNE]);

    // North edge (r = numRows - 1)
    for (let c = numCols - 1; c > 0; c--) {
      faces.push([(numRows - 1) * numCols + c, bNE, (numRows - 1) * numCols + (c - 1)]);
    }
    faces.push([(numRows - 1) * numCols, bNE, bNW]);

    // West edge (c = 0)
    for (let r = numRows - 1; r > 0; r--) {
      faces.push([r * numCols, bNW, (r - 1) * numCols]);
    }
    faces.push([0, bNW, bSW]);
  }

  return {
    name: (header.quadrangleName || "USGS_DEM_Terrain").replace(/[^A-Za-z0-9_]/g, "_"),
    vertices,
    faces,
    surfaceArea,
    planarArea,
    volumeAboveBase,
    baseElevation: baseZ,
    boundingBox: {
      min: [minX, minY, minZOut],
      max: [maxX, maxY, maxZOut],
    },
  };
}

/**
 * Lowers a `UsgsDemModel` into an immutable `@modelscript/cad` `PolyhedronSolid`.
 */
export function lowerUsgsDemToCadSolid(model: UsgsDemModel, options: TerrainMeshOptions = {}): PolyhedronSolid {
  const mesh = buildTerrainMesh(model, { watertight: true, ...options });
  return polyhedron({
    name: mesh.name,
    points: mesh.vertices,
    faces: mesh.faces,
  });
}
