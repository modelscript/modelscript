// SPDX-License-Identifier: AGPL-3.0-or-later

import { type LbmGridConfig, LbmCellType } from "./lbm-types.js";

export interface ObstacleBox {
  min: [number, number, number]; // [x, y, z] in normalized lattice coordinates [0, 1]
  max: [number, number, number];
}

export interface ObstacleCylinder {
  center: [number, number, number]; // [x, y, z] in normalized lattice coords
  radius: number; // radius in normalized units
  axis: "x" | "y" | "z";
  length: number;
}

export interface ObstacleTriangleMesh {
  /** Flat vertex coordinates [x0, y0, z0, x1, y1, z1, ...]. */
  vertices: Float32Array | number[];
  /** Triangle vertex indices [i0, i1, i2, ...]. */
  indices: Uint32Array | number[];
  /**
   * When true, vertex coordinates are interpreted in physical meters [0, nx*dx] x [0, ny*dy] x [0, nz*dz].
   * When false (default), vertex coordinates are interpreted in normalized lattice coordinates [0, 1]^3.
   */
  inPhysicalUnits?: boolean | undefined;
  /**
   * When true (default), automatically weld coincident vertices and strip degenerate triangles
   * before building the BVH. Set to false to use raw mesh buffers without healing.
   */
  heal?: boolean | undefined;
}

export interface MeshHealStats {
  weldedVertices: number;
  removedDegenerateTris: number;
  boundaryEdges: number;
  isWatertight: boolean;
}

export interface HealedTriangleMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  stats: MeshHealStats;
}

/**
 * Heals a triangle mesh by welding duplicate/near-coincident vertices within `weldTolerance`
 * (using a 3D spatial hash with 27-cell neighborhood lookup), removing degenerate zero-area
 * triangles (cross-product norm < 1e-12), and reporting watertightness via boundary edge counting.
 */
export function healTriangleMesh(mesh: ObstacleTriangleMesh, weldTolerance = 1e-6): HealedTriangleMesh {
  const srcVerts = mesh.vertices;
  const srcInds = mesh.indices;
  const numSrcVerts = Math.floor(srcVerts.length / 3);
  const numSrcTris = Math.floor(srcInds.length / 3);

  const tol = Math.max(0, weldTolerance);
  const tolSq = tol * tol;
  const remap = new Uint32Array(numSrcVerts);
  const uniqueVerts: number[] = [];
  let weldedVertices = 0;

  if (tol > 0) {
    const invTol = 1.0 / tol;
    const grid = new Map<string, number[]>();

    for (let i = 0; i < numSrcVerts; i++) {
      const x = srcVerts[i * 3]!;
      const y = srcVerts[i * 3 + 1]!;
      const z = srcVerts[i * 3 + 2]!;

      const gx = Math.floor(x * invTol);
      const gy = Math.floor(y * invTol);
      const gz = Math.floor(z * invTol);

      let found = -1;
      for (let dz = -1; dz <= 1 && found < 0; dz++) {
        for (let dy = -1; dy <= 1 && found < 0; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const bucket = grid.get(`${gx + dx},${gy + dy},${gz + dz}`);
            if (!bucket) continue;
            for (let b = 0; b < bucket.length; b++) {
              const cand = bucket[b]!;
              const ddx = x - uniqueVerts[cand * 3]!;
              const ddy = y - uniqueVerts[cand * 3 + 1]!;
              const ddz = z - uniqueVerts[cand * 3 + 2]!;
              if (ddx * ddx + ddy * ddy + ddz * ddz <= tolSq) {
                found = cand;
                break;
              }
            }
            if (found >= 0) break;
          }
        }
      }

      if (found >= 0) {
        remap[i] = found;
        weldedVertices++;
      } else {
        const newIdx = uniqueVerts.length / 3;
        uniqueVerts.push(x, y, z);
        remap[i] = newIdx;
        const key = `${gx},${gy},${gz}`;
        const bucket = grid.get(key);
        if (bucket) {
          bucket.push(newIdx);
        } else {
          grid.set(key, [newIdx]);
        }
      }
    }
  } else {
    const exactMap = new Map<string, number>();
    for (let i = 0; i < numSrcVerts; i++) {
      const x = srcVerts[i * 3]!;
      const y = srcVerts[i * 3 + 1]!;
      const z = srcVerts[i * 3 + 2]!;
      const key = `${x},${y},${z}`;
      const existing = exactMap.get(key);
      if (existing !== undefined) {
        remap[i] = existing;
        weldedVertices++;
      } else {
        const newIdx = uniqueVerts.length / 3;
        uniqueVerts.push(x, y, z);
        remap[i] = newIdx;
        exactMap.set(key, newIdx);
      }
    }
  }

  const keptIndices: number[] = [];
  let removedDegenerateTris = 0;

  for (let t = 0; t < numSrcTris; t++) {
    const raw0 = srcInds[t * 3]!;
    const raw1 = srcInds[t * 3 + 1]!;
    const raw2 = srcInds[t * 3 + 2]!;

    if (raw0 < 0 || raw0 >= numSrcVerts || raw1 < 0 || raw1 >= numSrcVerts || raw2 < 0 || raw2 >= numSrcVerts) {
      removedDegenerateTris++;
      continue;
    }

    const a = remap[raw0]!;
    const b = remap[raw1]!;
    const c = remap[raw2]!;

    if (a === b || b === c || c === a) {
      removedDegenerateTris++;
      continue;
    }

    const ax = uniqueVerts[a * 3]!;
    const ay = uniqueVerts[a * 3 + 1]!;
    const az = uniqueVerts[a * 3 + 2]!;
    const e1x = uniqueVerts[b * 3]! - ax;
    const e1y = uniqueVerts[b * 3 + 1]! - ay;
    const e1z = uniqueVerts[b * 3 + 2]! - az;
    const e2x = uniqueVerts[c * 3]! - ax;
    const e2y = uniqueVerts[c * 3 + 1]! - ay;
    const e2z = uniqueVerts[c * 3 + 2]! - az;

    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const crossNorm = Math.sqrt(cx * cx + cy * cy + cz * cz);

    if (crossNorm < 1e-12 || !Number.isFinite(crossNorm)) {
      removedDegenerateTris++;
      continue;
    }

    keptIndices.push(a, b, c);
  }

  // Count undirected edge incidences to detect open boundary edges
  const numUniqueVerts = uniqueVerts.length / 3;
  const edgeCounts = new Map<number, number>();
  const useNumericKey = numUniqueVerts < 90_000_000;
  const edgeCountsStr = useNumericKey ? null : new Map<string, number>();

  const addEdge = (u: number, v: number): void => {
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    if (useNumericKey) {
      const key = lo * numUniqueVerts + hi;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    } else {
      const key = `${lo},${hi}`;
      edgeCountsStr!.set(key, (edgeCountsStr!.get(key) ?? 0) + 1);
    }
  };

  for (let i = 0; i < keptIndices.length; i += 3) {
    const a = keptIndices[i]!;
    const b = keptIndices[i + 1]!;
    const c = keptIndices[i + 2]!;
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  let boundaryEdges = 0;
  if (useNumericKey) {
    for (const count of edgeCounts.values()) {
      if (count === 1) boundaryEdges++;
    }
  } else {
    for (const count of edgeCountsStr!.values()) {
      if (count === 1) boundaryEdges++;
    }
  }

  const isWatertight = keptIndices.length > 0 && boundaryEdges === 0;

  return {
    vertices: new Float32Array(uniqueVerts),
    indices: new Uint32Array(keptIndices),
    stats: {
      weldedVertices,
      removedDegenerateTris,
      boundaryEdges,
      isWatertight,
    },
  };
}

export interface LbmObstacleSet {
  boxes?: ObstacleBox[] | undefined;
  cylinders?: ObstacleCylinder[] | undefined;
  meshes?: ObstacleTriangleMesh[] | undefined;
  solidWalls?:
    | {
        minX?: boolean | undefined;
        maxX?: boolean | undefined;
        minY?: boolean | undefined;
        maxY?: boolean | undefined;
        minZ?: boolean | undefined;
        maxZ?: boolean | undefined;
      }
    | undefined;
}

interface TriBvhNode {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  left: number;
  right: number;
  start: number;
  count: number;
}

/**
 * Lightweight AABB-BVH over triangle soup in lattice index coordinates
 * for fast inside/outside occupancy voting and exact Möller–Trumbore Bouzidi ray-casting.
 */
class TriangleMeshBvh {
  public readonly triCoords: Float64Array; // 9 doubles per triangle: v0(3), v1(3), v2(3)
  public readonly triIndices: Int32Array;
  public readonly nodes: TriBvhNode[] = [];
  public readonly minX: number;
  public readonly minY: number;
  public readonly minZ: number;
  public readonly maxX: number;
  public readonly maxY: number;
  public readonly maxZ: number;
  public readonly isWatertight: boolean;
  public readonly boundaryEdges: number;

  constructor(mesh: ObstacleTriangleMesh, nx: number, ny: number, nz: number, dx: number) {
    const scaleX = mesh.inPhysicalUnits ? 1.0 / dx : nx;
    const scaleY = mesh.inPhysicalUnits ? 1.0 / dx : ny;
    const scaleZ = mesh.inPhysicalUnits ? 1.0 / dx : nz;

    let verts: Float32Array | number[];
    let inds: Uint32Array | number[];
    if (mesh.heal !== false) {
      const healed = healTriangleMesh(mesh);
      verts = healed.vertices;
      inds = healed.indices;
      this.isWatertight = healed.stats.isWatertight;
      this.boundaryEdges = healed.stats.boundaryEdges;
    } else {
      verts = mesh.vertices;
      inds = mesh.indices;
      this.isWatertight = true;
      this.boundaryEdges = 0;
    }

    const numTris = Math.floor(inds.length / 3);
    this.triCoords = new Float64Array(numTris * 9);
    this.triIndices = new Int32Array(numTris);

    let gMinX = Infinity,
      gMinY = Infinity,
      gMinZ = Infinity;
    let gMaxX = -Infinity,
      gMaxY = -Infinity,
      gMaxZ = -Infinity;

    for (let t = 0; t < numTris; t++) {
      this.triIndices[t] = t;
      const i0 = inds[t * 3]! * 3;
      const i1 = inds[t * 3 + 1]! * 3;
      const i2 = inds[t * 3 + 2]! * 3;

      const x0 = verts[i0]! * scaleX;
      const y0 = verts[i0 + 1]! * scaleY;
      const z0 = verts[i0 + 2]! * scaleZ;
      const x1 = verts[i1]! * scaleX;
      const y1 = verts[i1 + 1]! * scaleY;
      const z1 = verts[i1 + 2]! * scaleZ;
      const x2 = verts[i2]! * scaleX;
      const y2 = verts[i2 + 1]! * scaleY;
      const z2 = verts[i2 + 2]! * scaleZ;

      const base = t * 9;
      this.triCoords[base + 0] = x0;
      this.triCoords[base + 1] = y0;
      this.triCoords[base + 2] = z0;
      this.triCoords[base + 3] = x1;
      this.triCoords[base + 4] = y1;
      this.triCoords[base + 5] = z1;
      this.triCoords[base + 6] = x2;
      this.triCoords[base + 7] = y2;
      this.triCoords[base + 8] = z2;

      if (x0 < gMinX) gMinX = x0;
      if (x1 < gMinX) gMinX = x1;
      if (x2 < gMinX) gMinX = x2;
      if (y0 < gMinY) gMinY = y0;
      if (y1 < gMinY) gMinY = y1;
      if (y2 < gMinY) gMinY = y2;
      if (z0 < gMinZ) gMinZ = z0;
      if (z1 < gMinZ) gMinZ = z1;
      if (z2 < gMinZ) gMinZ = z2;

      if (x0 > gMaxX) gMaxX = x0;
      if (x1 > gMaxX) gMaxX = x1;
      if (x2 > gMaxX) gMaxX = x2;
      if (y0 > gMaxY) gMaxY = y0;
      if (y1 > gMaxY) gMaxY = y1;
      if (y2 > gMaxY) gMaxY = y2;
      if (z0 > gMaxZ) gMaxZ = z0;
      if (z1 > gMaxZ) gMaxZ = z1;
      if (z2 > gMaxZ) gMaxZ = z2;
    }

    this.minX = gMinX;
    this.minY = gMinY;
    this.minZ = gMinZ;
    this.maxX = gMaxX;
    this.maxY = gMaxY;
    this.maxZ = gMaxZ;

    if (numTris > 0) {
      this.buildNode(0, numTris);
    }
  }

  private buildNode(start: number, count: number): number {
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let k = start; k < start + count; k++) {
      const base = this.triIndices[k]! * 9;
      for (let v = 0; v < 3; v++) {
        const vx = this.triCoords[base + v * 3]!;
        const vy = this.triCoords[base + v * 3 + 1]!;
        const vz = this.triCoords[base + v * 3 + 2]!;
        if (vx < minX) minX = vx;
        if (vy < minY) minY = vy;
        if (vz < minZ) minZ = vz;
        if (vx > maxX) maxX = vx;
        if (vy > maxY) maxY = vy;
        if (vz > maxZ) maxZ = vz;
      }
    }

    const nodeIdx = this.nodes.length;
    const node: TriBvhNode = { minX, minY, minZ, maxX, maxY, maxZ, left: -1, right: -1, start, count };
    this.nodes.push(node);

    if (count <= 4) {
      return nodeIdx;
    }

    const extX = maxX - minX;
    const extY = maxY - minY;
    const extZ = maxZ - minZ;
    const axis = extX >= extY && extX >= extZ ? 0 : extY >= extZ ? 1 : 2;
    const midVal = axis === 0 ? 0.5 * (minX + maxX) : axis === 1 ? 0.5 * (minY + maxY) : 0.5 * (minZ + maxZ);

    let i = start;
    let j = start + count - 1;
    while (i <= j) {
      const base = this.triIndices[i]! * 9;
      const c =
        (this.triCoords[base + axis]! + this.triCoords[base + 3 + axis]! + this.triCoords[base + 6 + axis]!) / 3.0;
      if (c < midVal) {
        i++;
      } else {
        const tmp = this.triIndices[i]!;
        this.triIndices[i] = this.triIndices[j]!;
        this.triIndices[j] = tmp;
        j--;
      }
    }

    let leftCount = i - start;
    if (leftCount === 0 || leftCount === count) {
      leftCount = count >> 1;
    }

    node.left = this.buildNode(start, leftCount);
    node.right = this.buildNode(start + leftCount, count - leftCount);
    node.count = 0; // internal node
    return nodeIdx;
  }

  private static rayAabbHit(
    ox: number,
    oy: number,
    oz: number,
    invDx: number,
    invDy: number,
    invDz: number,
    node: TriBvhNode,
    maxT: number,
  ): boolean {
    const tx1 = (node.minX - ox) * invDx;
    const tx2 = (node.maxX - ox) * invDx;
    let tMin = Math.min(tx1, tx2);
    let tMax = Math.max(tx1, tx2);

    const ty1 = (node.minY - oy) * invDy;
    const ty2 = (node.maxY - oy) * invDy;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));

    const tz1 = (node.minZ - oz) * invDz;
    const tz2 = (node.maxZ - oz) * invDz;
    tMin = Math.max(tMin, Math.min(tz1, tz2));
    tMax = Math.min(tMax, Math.max(tz1, tz2));

    return tMax >= Math.max(0, tMin) && tMin <= maxT;
  }

  private rayTriIntersect(
    triIdx: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxT: number,
  ): number {
    const base = triIdx * 9;
    const v0x = this.triCoords[base + 0]!;
    const v0y = this.triCoords[base + 1]!;
    const v0z = this.triCoords[base + 2]!;
    const e1x = this.triCoords[base + 3]! - v0x;
    const e1y = this.triCoords[base + 4]! - v0y;
    const e1z = this.triCoords[base + 5]! - v0z;
    const e2x = this.triCoords[base + 6]! - v0x;
    const e2y = this.triCoords[base + 7]! - v0y;
    const e2z = this.triCoords[base + 8]! - v0z;

    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return -1;

    const invDet = 1.0 / det;
    const tx = ox - v0x;
    const ty = oy - v0y;
    const tz = oz - v0z;
    const u = (tx * px + ty * py + tz * pz) * invDet;
    if (u < -1e-7 || u > 1.0 + 1e-7) return -1;

    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * invDet;
    if (v < -1e-7 || u + v > 1.0 + 1e-7) return -1;

    const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
    if (t > 1e-9 && t <= maxT) return t;
    return -1;
  }

  /**
   * Returns the closest intersection parameter t in (0, maxT] along ray O + t*D, or Infinity if none.
   */
  public raycastFirstHit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number {
    if (this.nodes.length === 0) return Infinity;
    const invDx = dx !== 0 ? 1.0 / dx : 1e30;
    const invDy = dy !== 0 ? 1.0 / dy : 1e30;
    const invDz = dz !== 0 ? 1.0 / dz : 1e30;

    let bestT = Infinity;
    const stack: number[] = [0];
    while (stack.length > 0) {
      const node = this.nodes[stack.pop()!]!;
      if (!TriangleMeshBvh.rayAabbHit(ox, oy, oz, invDx, invDy, invDz, node, Math.min(maxT, bestT))) {
        continue;
      }
      if (node.count > 0) {
        for (let k = node.start; k < node.start + node.count; k++) {
          const t = this.rayTriIntersect(this.triIndices[k]!, ox, oy, oz, dx, dy, dz, Math.min(maxT, bestT));
          if (t > 0 && t < bestT) bestT = t;
        }
      } else {
        if (node.left >= 0) stack.push(node.left);
        if (node.right >= 0) stack.push(node.right);
      }
    }
    return bestT;
  }

  /**
   * Counts all ray-triangle intersections along O + t*D for t > 0 (for odd-even parity inside/outside test).
   */
  private countIntersections(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number {
    if (this.nodes.length === 0) return 0;
    const invDx = dx !== 0 ? 1.0 / dx : 1e30;
    const invDy = dy !== 0 ? 1.0 / dy : 1e30;
    const invDz = dz !== 0 ? 1.0 / dz : 1e30;

    let hits = 0;
    const stack: number[] = [0];
    while (stack.length > 0) {
      const node = this.nodes[stack.pop()!]!;
      if (!TriangleMeshBvh.rayAabbHit(ox, oy, oz, invDx, invDy, invDz, node, Infinity)) {
        continue;
      }
      if (node.count > 0) {
        for (let k = node.start; k < node.start + node.count; k++) {
          const t = this.rayTriIntersect(this.triIndices[k]!, ox, oy, oz, dx, dy, dz, Infinity);
          if (t > 0) hits++;
        }
      } else {
        if (node.left >= 0) stack.push(node.left);
        if (node.right >= 0) stack.push(node.right);
      }
    }
    return hits;
  }

  /**
   * Robust multi-ray majority-vote inside/outside classification using slightly jittered rays
   * to eliminate edge/vertex grazing degeneracy on watertight STL/STEP meshes, automatically
   * upgrading to 5-ray voting when the mesh is non-watertight (boundaryEdges > 0).
   */
  public isInside(px: number, py: number, pz: number): boolean {
    if (
      this.nodes.length === 0 ||
      px < this.minX ||
      px > this.maxX ||
      py < this.minY ||
      py > this.maxY ||
      pz < this.minZ ||
      pz > this.maxZ
    ) {
      return false;
    }

    if (!this.isWatertight) {
      // 5-ray majority vote across well-distributed jittered directions for graceful handling of open/cracked meshes
      let insideVotes = 0;
      if ((this.countIntersections(px, py, pz, 1.0, 1.37e-4, 2.71e-4) & 1) === 1) insideVotes++;
      if ((this.countIntersections(px, py, pz, 2.13e-4, 1.0, 1.19e-4) & 1) === 1) insideVotes++;
      if ((this.countIntersections(px, py, pz, 1.73e-4, 2.41e-4, 1.0) & 1) === 1) insideVotes++;
      if (insideVotes === 3) return true;
      if (insideVotes === 0) return false;
      if ((this.countIntersections(px, py, pz, -1.0, 1.91e-4, -2.29e-4) & 1) === 1) insideVotes++;
      if (insideVotes >= 3) return true;
      if (insideVotes <= 1) return false;
      if ((this.countIntersections(px, py, pz, -1.57e-4, -1.0, 2.83e-4) & 1) === 1) insideVotes++;
      return insideVotes >= 3;
    }

    let insideVotes = 0;
    if ((this.countIntersections(px, py, pz, 1.0, 1.37e-4, 2.71e-4) & 1) === 1) insideVotes++;
    if ((this.countIntersections(px, py, pz, 2.13e-4, 1.0, 1.19e-4) & 1) === 1) insideVotes++;
    if (insideVotes === 2) return true;
    if (insideVotes === 0) return false;
    if ((this.countIntersections(px, py, pz, 1.73e-4, 2.41e-4, 1.0) & 1) === 1) insideVotes++;
    return insideVotes >= 2;
  }
}

/**
 * 3D Grid Voxelizer for Lattice Boltzmann Simulation.
 * Synthesizes Cartesian occupancy buffers classifying fluid, solid obstacle,
 * inlet, and outlet cells, supporting analytical primitives and arbitrary watertight triangle meshes.
 */
export class LbmVoxelizer {
  public static voxelize(config: LbmGridConfig, obstacles: LbmObstacleSet): Uint8Array {
    const { nx, ny, nz } = config;
    const totalCells = nx * ny * nz;
    const grid = new Uint8Array(totalCells); // defaults to 0 = LbmCellType.Fluid

    const cellIdx = (x: number, y: number, z: number): number => {
      return x + y * nx + z * nx * ny;
    };

    // 1. Boundary channel conditions (e.g. wind tunnel walls, inlet, outlet)
    // By default: minX = VelocityInlet, maxX = PressureOutlet, outer boundaries = SolidBounceBack
    const walls = obstacles.solidWalls ?? {
      minY: true,
      maxY: true,
      minZ: true,
      maxZ: true,
    };

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = cellIdx(x, y, z);

          if (x === 0) {
            grid[idx] = LbmCellType.VelocityInlet;
          } else if (x === nx - 1) {
            grid[idx] = LbmCellType.PressureOutlet;
          } else if (
            (y === 0 && walls.minY) ||
            (y === ny - 1 && walls.maxY) ||
            (z === 0 && walls.minZ) ||
            (z === nz - 1 && walls.maxZ) ||
            (x === 0 && walls.minX) ||
            (x === nx - 1 && walls.maxX)
          ) {
            grid[idx] = LbmCellType.ChannelWall;
          }
        }
      }
    }

    // 2. Voxelize Box obstacles
    if (obstacles.boxes) {
      for (const b of obstacles.boxes) {
        const x0 = Math.max(1, Math.floor(b.min[0] * nx));
        const x1 = Math.min(nx - 2, Math.ceil(b.max[0] * nx));
        const y0 = Math.max(1, Math.floor(b.min[1] * ny));
        const y1 = Math.min(ny - 2, Math.ceil(b.max[1] * ny));
        const z0 = Math.max(1, Math.floor(b.min[2] * nz));
        const z1 = Math.min(nz - 2, Math.ceil(b.max[2] * nz));

        for (let z = z0; z <= z1; z++) {
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              grid[cellIdx(x, y, z)] = LbmCellType.ObstacleSolid;
            }
          }
        }
      }
    }

    // 3. Voxelize Cylinder obstacles (e.g. drone arm, motor pod, spar)
    if (obstacles.cylinders) {
      for (const cyl of obstacles.cylinders) {
        const cx = cyl.center[0] * nx;
        const cy = cyl.center[1] * ny;
        const cz = cyl.center[2] * nz;
        const rCells =
          cyl.radius * (cyl.axis === "x" ? Math.min(ny, nz) : cyl.axis === "y" ? Math.min(nx, nz) : Math.min(nx, ny));
        const rSq = rCells * rCells;

        const axisCells = cyl.axis === "z" ? nz : cyl.axis === "x" ? nx : ny;
        const halfLen = (cyl.length * axisCells) / 2;

        for (let z = 1; z < nz - 1; z++) {
          for (let y = 1; y < ny - 1; y++) {
            for (let x = 1; x < nx - 1; x++) {
              let inCyl = false;
              if (cyl.axis === "z") {
                const distSq = (x - cx) ** 2 + (y - cy) ** 2;
                if (distSq <= rSq && Math.abs(z - cz) <= halfLen) inCyl = true;
              } else if (cyl.axis === "x") {
                const distSq = (y - cy) ** 2 + (z - cz) ** 2;
                if (distSq <= rSq && Math.abs(x - cx) <= halfLen) inCyl = true;
              } else {
                const distSq = (x - cx) ** 2 + (z - cz) ** 2;
                if (distSq <= rSq && Math.abs(y - cy) <= halfLen) inCyl = true;
              }

              if (inCyl) {
                grid[cellIdx(x, y, z)] = LbmCellType.ObstacleSolid;
              }
            }
          }
        }
      }
    }

    // 4. Voxelize arbitrary watertight triangle meshes (STL / STEP / SU2 surface tessellations)
    if (obstacles.meshes && obstacles.meshes.length > 0) {
      for (const mesh of obstacles.meshes) {
        const bvh = new TriangleMeshBvh(mesh, nx, ny, nz, config.dx);
        if (bvh.nodes.length === 0) continue;
        const x0 = Math.max(1, Math.floor(bvh.minX));
        const x1 = Math.min(nx - 2, Math.ceil(bvh.maxX));
        const y0 = Math.max(1, Math.floor(bvh.minY));
        const y1 = Math.min(ny - 2, Math.ceil(bvh.maxY));
        const z0 = Math.max(1, Math.floor(bvh.minZ));
        const z1 = Math.min(nz - 2, Math.ceil(bvh.maxZ));

        for (let z = z0; z <= z1; z++) {
          for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
              if (bvh.isInside(x, y, z)) {
                grid[cellIdx(x, y, z)] = LbmCellType.ObstacleSolid;
              }
            }
          }
        }
      }
    }

    return grid;
  }

  /**
   * Computes sub-grid distance fraction delta in (0, 1) along each discrete velocity vector
   * from fluid cell centers to the exact CAD boundary for Bouzidi curved wall boundary conditions.
   */
  public static computeWallDistances(config: LbmGridConfig, obstacles: LbmObstacleSet, grid: Uint8Array): Float32Array {
    const { nx, ny, nz } = config;
    const totalCells = nx * ny * nz;
    const deltaWall = new Float32Array(totalCells * 19);
    deltaWall.fill(0.5); // default halfway bounce-back

    const CX = [0, 1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
    const CY = [0, 0, 0, 1, -1, 0, 0, 1, -1, -1, 1, 0, 0, 0, 0, 1, -1, 1, -1];
    const CZ = [0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 1, -1, -1, 1, 1, -1, -1, 1];

    const meshBvhs: TriangleMeshBvh[] =
      obstacles.meshes?.map((m) => new TriangleMeshBvh(m, nx, ny, nz, config.dx)) ?? [];

    const cellIdx = (x: number, y: number, z: number): number => {
      return x + y * nx + z * nx * ny;
    };

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const idx = cellIdx(x, y, z);
          const cType = grid[idx];
          if (cType === LbmCellType.ObstacleSolid || cType === LbmCellType.ChannelWall) {
            continue;
          }

          for (let i = 1; i < 19; i++) {
            const nxCoord = x + CX[i]!;
            const nyCoord = y + CY[i]!;
            const nzCoord = z + CZ[i]!;

            if (nxCoord < 0 || nxCoord >= nx || nyCoord < 0 || nyCoord >= ny || nzCoord < 0 || nzCoord >= nz) {
              continue;
            }

            const targetIdx = cellIdx(nxCoord, nyCoord, nzCoord);
            if (grid[targetIdx] !== LbmCellType.ObstacleSolid) {
              continue;
            }

            let bestS = Infinity;

            // Neighbor is solid obstacle. Check exact boundary distance along ray
            if (obstacles.cylinders) {
              for (const cyl of obstacles.cylinders) {
                const cx = cyl.center[0] * nx;
                const cy = cyl.center[1] * ny;
                const cz = cyl.center[2] * nz;
                const r =
                  cyl.radius *
                  (cyl.axis === "x" ? Math.min(ny, nz) : cyl.axis === "y" ? Math.min(nx, nz) : Math.min(nx, ny));
                const axisCells = cyl.axis === "z" ? nz : cyl.axis === "x" ? nx : ny;
                const halfLen = (cyl.length * axisCells) / 2;

                let p0x = 0,
                  p0y = 0,
                  p0z = 0,
                  dx = 0,
                  dy = 0,
                  dz = 0;
                if (cyl.axis === "z") {
                  p0x = x - cx;
                  p0y = y - cy;
                  p0z = z - cz;
                  dx = CX[i]!;
                  dy = CY[i]!;
                  dz = CZ[i]!;
                } else if (cyl.axis === "x") {
                  p0x = y - cy;
                  p0y = z - cz;
                  p0z = x - cx;
                  dx = CY[i]!;
                  dy = CZ[i]!;
                  dz = CX[i]!;
                } else {
                  p0x = x - cx;
                  p0y = z - cz;
                  p0z = y - cy;
                  dx = CX[i]!;
                  dy = CZ[i]!;
                  dz = CY[i]!;
                }

                // 1. Curved lateral cylinder surface
                const a = dx * dx + dy * dy;
                if (a > 0) {
                  const b = 2 * (p0x * dx + p0y * dy);
                  const c = p0x * p0x + p0y * p0y - r * r;
                  const disc = b * b - 4 * a * c;
                  if (disc >= 0) {
                    const s = (-b - Math.sqrt(disc)) / (2 * a);
                    if (s > 0 && s <= 1.0 && Math.abs(p0z + s * dz) <= halfLen + 1e-6) {
                      if (s < bestS) bestS = s;
                    }
                  }
                }

                // 2. Flat axial end-caps at p0z + s * dz = +-halfLen
                if (dz !== 0) {
                  for (const capZ of [-halfLen, halfLen]) {
                    const sCap = (capZ - p0z) / dz;
                    if (sCap > 0 && sCap <= 1.0) {
                      const rx = p0x + sCap * dx;
                      const ry = p0y + sCap * dy;
                      if (rx * rx + ry * ry <= r * r + 1e-6 && sCap < bestS) {
                        bestS = sCap;
                      }
                    }
                  }
                }
              }
            }

            if (obstacles.boxes) {
              for (const box of obstacles.boxes) {
                const bMinX = box.min[0] * nx,
                  bMaxX = box.max[0] * nx;
                const bMinY = box.min[1] * ny,
                  bMaxY = box.max[1] * ny;
                const bMinZ = box.min[2] * nz,
                  bMaxZ = box.max[2] * nz;

                let tMin = -Infinity;
                let tMax = Infinity;
                const orig = [x, y, z];
                const dir = [CX[i]!, CY[i]!, CZ[i]!];
                const bMin = [bMinX, bMinY, bMinZ];
                const bMax = [bMaxX, bMaxY, bMaxZ];
                let hit = true;
                for (let axis = 0; axis < 3; axis++) {
                  const d = dir[axis]!;
                  const o = orig[axis]!;
                  if (d === 0) {
                    if (o < bMin[axis]! || o > bMax[axis]!) {
                      hit = false;
                      break;
                    }
                  } else {
                    let t1 = (bMin[axis]! - o) / d;
                    let t2 = (bMax[axis]! - o) / d;
                    if (t1 > t2) {
                      const tmp = t1;
                      t1 = t2;
                      t2 = tmp;
                    }
                    if (t1 > tMin) tMin = t1;
                    if (t2 < tMax) tMax = t2;
                  }
                }
                if (hit && tMin <= tMax && tMin > 0 && tMin <= 1.0 && tMin < bestS) {
                  bestS = tMin;
                }
              }
            }

            if (meshBvhs.length > 0) {
              const rdx = CX[i]!;
              const rdy = CY[i]!;
              const rdz = CZ[i]!;
              for (const bvh of meshBvhs) {
                const hitS = bvh.raycastFirstHit(x, y, z, rdx, rdy, rdz, Math.min(1.0, bestS));
                if (hitS > 0 && hitS <= 1.0 && hitS < bestS) {
                  bestS = hitS;
                }
              }
            }

            if (bestS <= 1.0) {
              deltaWall[i * totalCells + idx] = Math.max(0.05, Math.min(0.95, bestS));
            }
          }
        }
      }
    }

    return deltaWall;
  }
}
