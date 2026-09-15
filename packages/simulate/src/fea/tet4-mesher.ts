// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Tet4Mesh } from "./tet4-types.js";

export interface BoxMeshOptions {
  width: number;
  height: number;
  depth: number;
  nx: number;
  ny: number;
  nz: number;
  /** Optional origin offset [ox, oy, oz] (default: [0, 0, 0] at box corner or centered). */
  origin?: [number, number, number];
  centered?: boolean;
  /** Element formulation order: 'linear' (default) or 'quadratic' (Tet10). */
  order?: "linear" | "quadratic";
  /** Tag names for the 6 outer faces. */
  faceTags?: {
    minX?: string;
    maxX?: string;
    minY?: string;
    maxY?: string;
    minZ?: string;
    maxZ?: string;
  };
}

export interface VoxelMeshOptions {
  /** 3D occupancy grid of cells (nx * ny * nz). Non-zero value indicates solid. */
  grid: Uint8Array | number[];
  nx: number;
  ny: number;
  nz: number;
  /** Physical lattice cell size in meters (e.g. 0.005 = 5mm). Default: 1.0. */
  dx?: number;
  /** Physical origin offset [ox, oy, oz]. Defaults to [0, 0, 0]. */
  origin?: [number, number, number];
  /** Element formulation order: 'linear' (default) or 'quadratic' (Tet10). */
  order?: "linear" | "quadratic";
  /** Optional boundary tag rules or semantic spatial predicates. */
  tagRules?: {
    name: string;
    predicate: (x: number, y: number, z: number, isBoundary: boolean) => boolean;
  }[];
}

export interface SurfaceMeshOptions {
  /** Vertex positions (x, y, z) packed contiguous [x0, y0, z0, x1, y1, z1, ...]. */
  vertices: Float32Array | number[];
  /** Triangle indices [t0_a, t0_b, t0_c, t1_a, ...]. */
  indices: Uint32Array | number[];
  /** Grid resolution along the longest bounding box dimension. Default: 20. */
  resolution?: number;
  /** Element formulation order: 'linear' (default) or 'quadratic' (Tet10). */
  order?: "linear" | "quadratic";
  /** Optional boundary tag rules or semantic spatial predicates. */
  tagRules?: {
    name: string;
    predicate: (x: number, y: number, z: number, isBoundary: boolean) => boolean;
  }[];
}

/**
 * Robust Volumetric Tetrahedral Mesher.
 */
export class Tet4Mesher {
  /**
   * Generates a high-quality tetrahedral mesh for a rectangular beam / prism / plate.
   * Decomposes each hexahedral cell into 5 or 6 tetrahedra with consistent face matching.
   */
  public static createBoxMesh(opts: BoxMeshOptions): Tet4Mesh {
    const { width, height, depth, nx, ny, nz } = opts;
    const numNodesX = nx + 1;
    const numNodesY = ny + 1;
    const numNodesZ = nz + 1;
    const totalNodes = numNodesX * numNodesY * numNodesZ;

    const nodeCoords = new Float32Array(totalNodes * 3);

    const ox = opts.centered ? -width / 2 : opts.origin ? opts.origin[0] : 0;
    const oy = opts.centered ? -height / 2 : opts.origin ? opts.origin[1] : 0;
    const oz = opts.centered ? -depth / 2 : opts.origin ? opts.origin[2] : 0;

    const dx = width / nx;
    const dy = height / ny;
    const dz = depth / nz;

    const nodeIndex = (ix: number, iy: number, iz: number): number => {
      return ix + iy * numNodesX + iz * numNodesX * numNodesY;
    };

    // 1. Generate node coordinates
    for (let iz = 0; iz <= nz; iz++) {
      for (let iy = 0; iy <= ny; iy++) {
        for (let ix = 0; ix <= nx; ix++) {
          const idx = nodeIndex(ix, iy, iz);
          nodeCoords[idx * 3 + 0] = ox + ix * dx;
          nodeCoords[idx * 3 + 1] = oy + iy * dy;
          nodeCoords[idx * 3 + 2] = oz + iz * dz;
        }
      }
    }

    // 2. Subdivide each hexahedral cell into 6 tetrahedra
    const totalHexCells = nx * ny * nz;
    const elements = new Uint32Array(totalHexCells * 6 * 4);
    let elemPtr = 0;

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          // Hex vertices:
          // Bottom face (z): v0=(0,0,0), v1=(1,0,0), v2=(1,1,0), v3=(0,1,0)
          // Top face (z+1):  v4=(0,0,1), v5=(1,0,1), v6=(1,1,1), v7=(0,1,1)
          const v0 = nodeIndex(ix, iy, iz);
          const v1 = nodeIndex(ix + 1, iy, iz);
          const v2 = nodeIndex(ix + 1, iy + 1, iz);
          const v3 = nodeIndex(ix, iy + 1, iz);

          const v4 = nodeIndex(ix, iy, iz + 1);
          const v5 = nodeIndex(ix + 1, iy, iz + 1);
          const v6 = nodeIndex(ix + 1, iy + 1, iz + 1);
          const v7 = nodeIndex(ix, iy + 1, iz + 1);

          // Exact 6-permutation Kuhn subdivision of a cube [0, 1]^3:
          const tets: [number, number, number, number][] = [
            [v0, v1, v2, v6],
            [v0, v1, v5, v6],
            [v0, v3, v2, v6],
            [v0, v3, v7, v6],
            [v0, v4, v5, v6],
            [v0, v4, v7, v6],
          ];

          for (const [n0, n1, n2, n3] of tets) {
            elements[elemPtr++] = n0;
            elements[elemPtr++] = n1;
            elements[elemPtr++] = n2;
            elements[elemPtr++] = n3;
          }
        }
      }
    }

    // 3. Classify boundary nodes into tags
    const boundaryNodes = new Map<string, number[]>();
    const faceTags = opts.faceTags ?? {
      minX: "fixed_support",
      maxX: "tip_load",
    };

    const addTaggedNode = (tag: string | undefined, nIdx: number) => {
      if (!tag) return;
      let list = boundaryNodes.get(tag);
      if (!list) {
        list = [];
        boundaryNodes.set(tag, list);
      }
      list.push(nIdx);
    };

    for (let iz = 0; iz <= nz; iz++) {
      for (let iy = 0; iy <= ny; iy++) {
        for (let ix = 0; ix <= nx; ix++) {
          const idx = nodeIndex(ix, iy, iz);
          if (ix === 0) addTaggedNode(faceTags.minX, idx);
          if (ix === nx) addTaggedNode(faceTags.maxX, idx);
          if (iy === 0) addTaggedNode(faceTags.minY, idx);
          if (iy === ny) addTaggedNode(faceTags.maxY, idx);
          if (iz === 0) addTaggedNode(faceTags.minZ, idx);
          if (iz === nz) addTaggedNode(faceTags.maxZ, idx);
        }
      }
    }

    const linearMesh: Tet4Mesh = {
      nodeCoords,
      elements,
      numNodes: totalNodes,
      numElements: totalHexCells * 6,
      elementOrder: "linear",
      nodesPerElement: 4,
      boundaryNodes,
    };

    if (opts.order === "quadratic") {
      return Tet4Mesher.convertToQuadratic(linearMesh);
    }

    return linearMesh;
  }

  /**
   * Converts a linear 4-node tetrahedral mesh (Tet4) into a quadratic 10-node mesh (Tet10).
   * Inserts mid-edge nodes on all unique element edges and updates boundary classifications.
   */
  public static convertToQuadratic(linear: Tet4Mesh): Tet4Mesh {
    const { nodeCoords, elements, numNodes, numElements, boundaryNodes } = linear;
    const edgeMap = new Map<string, number>();
    const midCoords: number[] = [];

    const getMidEdgeNode = (n0: number, n1: number): number => {
      const minN = Math.min(n0, n1);
      const maxN = Math.max(n0, n1);
      const key = `${minN}_${maxN}`;
      let midIdx = edgeMap.get(key);
      if (midIdx === undefined) {
        midIdx = numNodes + edgeMap.size;
        edgeMap.set(key, midIdx);
        midCoords.push(
          (nodeCoords[minN * 3 + 0] + nodeCoords[maxN * 3 + 0]) / 2.0,
          (nodeCoords[minN * 3 + 1] + nodeCoords[maxN * 3 + 1]) / 2.0,
          (nodeCoords[minN * 3 + 2] + nodeCoords[maxN * 3 + 2]) / 2.0,
        );
      }
      return midIdx;
    };

    const quadElements = new Uint32Array(numElements * 10);
    for (let e = 0; e < numElements; e++) {
      const n0 = elements[e * 4 + 0];
      const n1 = elements[e * 4 + 1];
      const n2 = elements[e * 4 + 2];
      const n3 = elements[e * 4 + 3];

      const n4 = getMidEdgeNode(n0, n1);
      const n5 = getMidEdgeNode(n1, n2);
      const n6 = getMidEdgeNode(n2, n0);
      const n7 = getMidEdgeNode(n0, n3);
      const n8 = getMidEdgeNode(n1, n3);
      const n9 = getMidEdgeNode(n2, n3);

      quadElements[e * 10 + 0] = n0;
      quadElements[e * 10 + 1] = n1;
      quadElements[e * 10 + 2] = n2;
      quadElements[e * 10 + 3] = n3;
      quadElements[e * 10 + 4] = n4;
      quadElements[e * 10 + 5] = n5;
      quadElements[e * 10 + 6] = n6;
      quadElements[e * 10 + 7] = n7;
      quadElements[e * 10 + 8] = n8;
      quadElements[e * 10 + 9] = n9;
    }

    const totalNodes = numNodes + edgeMap.size;
    const quadCoords = new Float32Array(totalNodes * 3);
    quadCoords.set(nodeCoords, 0);
    quadCoords.set(midCoords, numNodes * 3);

    // Update boundary nodes: mid-nodes whose endpoints both belong to a boundary tag also belong to it
    const quadBoundaryNodes = new Map<string, number[]>();
    for (const [tag, nodes] of boundaryNodes.entries()) {
      const nodeSet = new Set(nodes);
      const quadList = [...nodes];
      for (const [key, midIdx] of edgeMap.entries()) {
        const [aStr, bStr] = key.split("_");
        const a = parseInt(aStr, 10);
        const b = parseInt(bStr, 10);
        if (nodeSet.has(a) && nodeSet.has(b)) {
          quadList.push(midIdx);
        }
      }
      quadBoundaryNodes.set(tag, quadList);
    }

    return {
      nodeCoords: quadCoords,
      elements: quadElements,
      numNodes: totalNodes,
      numElements,
      elementOrder: "quadratic",
      nodesPerElement: 10,
      boundaryNodes: quadBoundaryNodes,
    };
  }

  /**
   * Generates a conformal tetrahedral mesh from an arbitrary 3D voxel occupancy grid.
   * Uses alternating parity 5-tetrahedron Kuhn subdivision to ensure strictly matching internal
   * face diagonals across all neighboring solid voxels.
   */
  public static createFromVoxelGrid(opts: VoxelMeshOptions): Tet4Mesh {
    const { grid, nx, ny, nz } = opts;
    const dx = opts.dx ?? 1.0;
    const ox = opts.origin ? opts.origin[0] : 0;
    const oy = opts.origin ? opts.origin[1] : 0;
    const oz = opts.origin ? opts.origin[2] : 0;

    const numCornersX = nx + 1;
    const numCornersY = ny + 1;
    const numCornersZ = nz + 1;
    const totalCorners = numCornersX * numCornersY * numCornersZ;

    const cornerIndex = (ix: number, iy: number, iz: number): number => {
      return ix + iy * numCornersX + iz * numCornersX * numCornersY;
    };

    const isSolid = (ix: number, iy: number, iz: number): boolean => {
      if (ix < 0 || ix >= nx || iy < 0 || iy >= ny || iz < 0 || iz >= nz) return false;
      return grid[ix + iy * nx + iz * nx * ny] !== 0;
    };

    // Compact active node map to avoid unreferenced vertex allocations
    const cornerToActiveNode = new Int32Array(totalCorners).fill(-1);
    const activeCoords: number[] = [];
    const isNodeBoundary = new Uint8Array(totalCorners);

    const getOrCreateNode = (ix: number, iy: number, iz: number): number => {
      const cIdx = cornerIndex(ix, iy, iz);
      let nIdx = cornerToActiveNode[cIdx];
      if (nIdx === -1) {
        nIdx = activeCoords.length / 3;
        cornerToActiveNode[cIdx] = nIdx;
        activeCoords.push(ox + ix * dx, oy + iy * dx, oz + iz * dx);
      }
      return nIdx;
    };

    const elements: number[] = [];

    // Helper: ensure positive orientation (n1 - n0) x (n2 - n0) . (n3 - n0) > 0
    const addTet = (n0: number, n1: number, n2: number, n3: number) => {
      const x0 = activeCoords[n0 * 3 + 0],
        y0 = activeCoords[n0 * 3 + 1],
        z0 = activeCoords[n0 * 3 + 2];
      const x1 = activeCoords[n1 * 3 + 0],
        y1 = activeCoords[n1 * 3 + 1],
        z1 = activeCoords[n1 * 3 + 2];
      const x2 = activeCoords[n2 * 3 + 0],
        y2 = activeCoords[n2 * 3 + 1],
        z2 = activeCoords[n2 * 3 + 2];
      const x3 = activeCoords[n3 * 3 + 0],
        y3 = activeCoords[n3 * 3 + 1],
        z3 = activeCoords[n3 * 3 + 2];

      const v1x = x1 - x0,
        v1y = y1 - y0,
        v1z = z1 - z0;
      const v2x = x2 - x0,
        v2y = y2 - y0,
        v2z = z2 - z0;
      const v3x = x3 - x0,
        v3y = y3 - y0,
        v3z = z3 - z0;

      const crossX = v1y * v2z - v1z * v2y;
      const crossY = v1z * v2x - v1x * v2z;
      const crossZ = v1x * v2y - v1y * v2x;

      const det = crossX * v3x + crossY * v3y + crossZ * v3z;
      if (det > 0) {
        elements.push(n0, n1, n2, n3);
      } else {
        elements.push(n0, n1, n3, n2);
      }
    };

    let minSolidX = nx,
      maxSolidX = 0;
    let minSolidY = ny,
      maxSolidY = 0;
    let minSolidZ = nz,
      maxSolidZ = 0;

    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          if (!isSolid(ix, iy, iz)) continue;

          minSolidX = Math.min(minSolidX, ix);
          maxSolidX = Math.max(maxSolidX, ix);
          minSolidY = Math.min(minSolidY, iy);
          maxSolidY = Math.max(maxSolidY, iy);
          minSolidZ = Math.min(minSolidZ, iz);
          maxSolidZ = Math.max(maxSolidZ, iz);

          const v0 = getOrCreateNode(ix, iy, iz);
          const v1 = getOrCreateNode(ix + 1, iy, iz);
          const v2 = getOrCreateNode(ix + 1, iy + 1, iz);
          const v3 = getOrCreateNode(ix, iy + 1, iz);
          const v4 = getOrCreateNode(ix, iy, iz + 1);
          const v5 = getOrCreateNode(ix + 1, iy, iz + 1);
          const v6 = getOrCreateNode(ix + 1, iy + 1, iz + 1);
          const v7 = getOrCreateNode(ix, iy + 1, iz + 1);

          // Tag boundary nodes on exposed faces
          if (!isSolid(ix - 1, iy, iz)) {
            isNodeBoundary[cornerIndex(ix, iy, iz)] = 1;
            isNodeBoundary[cornerIndex(ix, iy + 1, iz)] = 1;
            isNodeBoundary[cornerIndex(ix, iy + 1, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix, iy, iz + 1)] = 1;
          }
          if (!isSolid(ix + 1, iy, iz)) {
            isNodeBoundary[cornerIndex(ix + 1, iy, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy + 1, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy + 1, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy, iz + 1)] = 1;
          }
          if (!isSolid(ix, iy - 1, iz)) {
            isNodeBoundary[cornerIndex(ix, iy, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix, iy, iz + 1)] = 1;
          }
          if (!isSolid(ix, iy + 1, iz)) {
            isNodeBoundary[cornerIndex(ix, iy + 1, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy + 1, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy + 1, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix, iy + 1, iz + 1)] = 1;
          }
          if (!isSolid(ix, iy, iz - 1)) {
            isNodeBoundary[cornerIndex(ix, iy, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy, iz)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy + 1, iz)] = 1;
            isNodeBoundary[cornerIndex(ix, iy + 1, iz)] = 1;
          }
          if (!isSolid(ix, iy, iz + 1)) {
            isNodeBoundary[cornerIndex(ix, iy, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix + 1, iy + 1, iz + 1)] = 1;
            isNodeBoundary[cornerIndex(ix, iy + 1, iz + 1)] = 1;
          }

          // Alternating parity 5-tet subdivision
          if ((ix + iy + iz) % 2 === 0) {
            addTet(v0, v1, v3, v4);
            addTet(v1, v2, v3, v6);
            addTet(v1, v4, v5, v6);
            addTet(v3, v4, v7, v6);
            addTet(v1, v3, v4, v6);
          } else {
            addTet(v0, v1, v2, v5);
            addTet(v0, v2, v3, v7);
            addTet(v0, v4, v5, v7);
            addTet(v2, v5, v6, v7);
            addTet(v0, v2, v5, v7);
          }
        }
      }
    }

    const totalActiveNodes = activeCoords.length / 3;
    const boundaryNodes = new Map<string, number[]>();

    // Classify boundary nodes
    if (opts.tagRules && opts.tagRules.length > 0) {
      for (let n = 0; n < totalActiveNodes; n++) {
        const x = activeCoords[n * 3 + 0];
        const y = activeCoords[n * 3 + 1];
        const z = activeCoords[n * 3 + 2];
        for (const rule of opts.tagRules) {
          if (rule.predicate(x, y, z, true)) {
            let list = boundaryNodes.get(rule.name);
            if (!list) {
              list = [];
              boundaryNodes.set(rule.name, list);
            }
            list.push(n);
          }
        }
      }
    } else {
      // Default boundary tags based on bounding extents
      const tol = dx * 0.5;
      const minXVal = ox + minSolidX * dx;
      const maxXVal = ox + (maxSolidX + 1) * dx;
      for (let n = 0; n < totalActiveNodes; n++) {
        const x = activeCoords[n * 3 + 0];
        if (Math.abs(x - minXVal) <= tol) {
          let list = boundaryNodes.get("fixed_support");
          if (!list) {
            list = [];
            boundaryNodes.set("fixed_support", list);
          }
          list.push(n);
        }
        if (Math.abs(x - maxXVal) <= tol) {
          let list = boundaryNodes.get("tip_load");
          if (!list) {
            list = [];
            boundaryNodes.set("tip_load", list);
          }
          list.push(n);
        }
      }
    }

    const linearMesh: Tet4Mesh = {
      nodeCoords: new Float32Array(activeCoords),
      elements: new Uint32Array(elements),
      numNodes: totalActiveNodes,
      numElements: elements.length / 4,
      elementOrder: "linear",
      nodesPerElement: 4,
      boundaryNodes,
    };

    if (opts.order === "quadratic") {
      return Tet4Mesher.convertToQuadratic(linearMesh);
    }

    return linearMesh;
  }

  /**
   * Discretizes and tetrahedralizes an arbitrary closed watertight surface mesh
   * into a conformal volumetric Tet4/Tet10 mesh with zero external dependencies.
   */
  public static createFromSurfaceMesh(opts: SurfaceMeshOptions): Tet4Mesh {
    const { vertices, indices } = opts;
    const numVerts = vertices.length / 3;
    const numTriangles = indices.length / 3;

    if (numVerts < 4 || numTriangles < 4) {
      throw new Error("Invalid surface mesh: requires at least 4 vertices and 4 triangles.");
    }

    // 1. Compute bounding box
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < numVerts; i++) {
      const x = vertices[i * 3 + 0];
      const y = vertices[i * 3 + 1];
      const z = vertices[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const extentX = Math.max(1e-5, maxX - minX);
    const extentY = Math.max(1e-5, maxY - minY);
    const extentZ = Math.max(1e-5, maxZ - minZ);
    const maxExtent = Math.max(extentX, extentY, extentZ);

    const resolution = opts.resolution ?? 20;
    const dx = maxExtent / resolution;

    // Add 1-cell margin around bounds
    const ox = minX - dx;
    const oy = minY - dx;
    const oz = minZ - dx;

    const nx = Math.ceil((extentX + 2 * dx) / dx);
    const ny = Math.ceil((extentY + 2 * dx) / dx);
    const nz = Math.ceil((extentZ + 2 * dx) / dx);

    const grid = new Uint8Array(nx * ny * nz);

    // 2. Precompute per-triangle AABB extents for fast ray candidate filtering
    const triAABB = new Float32Array(numTriangles * 4); // [minY, maxY, minZ, maxZ]
    for (let t = 0; t < numTriangles; t++) {
      const i0 = indices[t * 3 + 0];
      const i1 = indices[t * 3 + 1];
      const i2 = indices[t * 3 + 2];

      const y0 = vertices[i0 * 3 + 1],
        y1 = vertices[i1 * 3 + 1],
        y2 = vertices[i2 * 3 + 1];
      const z0 = vertices[i0 * 3 + 2],
        z1 = vertices[i1 * 3 + 2],
        z2 = vertices[i2 * 3 + 2];

      triAABB[t * 4 + 0] = Math.min(y0, y1, y2);
      triAABB[t * 4 + 1] = Math.max(y0, y1, y2);
      triAABB[t * 4 + 2] = Math.min(z0, z1, z2);
      triAABB[t * 4 + 3] = Math.max(z0, z1, z2);
    }

    // Irrational ray perturbation to eliminate shared-edge / coplanar vertex degeneracy
    const rdx = 1.0;
    const rdy = 1.41421356e-6;
    const rdz = 1.7320508e-5;

    // 3. Fast 1D Ray-Sweep Interval Filling per (iy, iz) scanline
    for (let iz = 0; iz < nz; iz++) {
      const cz = oz + (iz + 0.5) * dx;

      for (let iy = 0; iy < ny; iy++) {
        const cy = oy + (iy + 0.5) * dx;

        // Collect all intersection X-coordinates along this scanline
        const hitX: number[] = [];

        for (let t = 0; t < numTriangles; t++) {
          const tMinY = triAABB[t * 4 + 0];
          const tMaxY = triAABB[t * 4 + 1];
          const tMinZ = triAABB[t * 4 + 2];
          const tMaxZ = triAABB[t * 4 + 3];

          // AABB rejection
          if (cy < tMinY || cy > tMaxY || cz < tMinZ || cz > tMaxZ) continue;

          const i0 = indices[t * 3 + 0];
          const i1 = indices[t * 3 + 1];
          const i2 = indices[t * 3 + 2];

          const v0x = vertices[i0 * 3 + 0],
            v0y = vertices[i0 * 3 + 1],
            v0z = vertices[i0 * 3 + 2];
          const v1x = vertices[i1 * 3 + 0],
            v1y = vertices[i1 * 3 + 1],
            v1z = vertices[i1 * 3 + 2];
          const v2x = vertices[i2 * 3 + 0],
            v2y = vertices[i2 * 3 + 1],
            v2z = vertices[i2 * 3 + 2];

          const e1x = v1x - v0x,
            e1y = v1y - v0y,
            e1z = v1z - v0z;
          const e2x = v2x - v0x,
            e2y = v2y - v0y,
            e2z = v2z - v0z;

          // pvec = rayDir x e2
          const pvecX = rdy * e2z - rdz * e2y;
          const pvecY = rdz * e2x - rdx * e2z;
          const pvecZ = rdx * e2y - rdy * e2x;

          const det = e1x * pvecX + e1y * pvecY + e1z * pvecZ;
          if (Math.abs(det) < 1e-11) continue;

          const invDet = 1.0 / det;
          const tvecX = ox - v0x,
            tvecY = cy - v0y,
            tvecZ = cz - v0z;

          const u = (tvecX * pvecX + tvecY * pvecY + tvecZ * pvecZ) * invDet;
          if (u < 0 || u > 1) continue;

          // qvec = tvec x e1
          const qvecX = tvecY * e1z - tvecZ * e1y;
          const qvecY = tvecZ * e1x - tvecX * e1z;
          const qvecZ = tvecX * e1y - tvecY * e1x;

          const v = (rdx * qvecX + rdy * qvecY + rdz * qvecZ) * invDet;
          if (v < 0 || u + v > 1) continue;

          const tRay = (e2x * qvecX + e2y * qvecY + e2z * qvecZ) * invDet;
          if (tRay > 0) {
            hitX.push(ox + tRay * rdx);
          }
        }

        if (hitX.length < 2) continue;
        hitX.sort((a, b) => a - b);

        // Fill interior intervals [hitX[2k], hitX[2k+1]]
        for (let k = 0; k < hitX.length - 1; k += 2) {
          const xStart = hitX[k];
          const xEnd = hitX[k + 1];

          const startCell = Math.max(0, Math.floor((xStart - ox) / dx));
          const endCell = Math.min(nx - 1, Math.ceil((xEnd - ox) / dx) - 1);

          for (let ix = startCell; ix <= endCell; ix++) {
            const cellCenterX = ox + (ix + 0.5) * dx;
            if (cellCenterX >= xStart && cellCenterX <= xEnd) {
              grid[ix + iy * nx + iz * nx * ny] = 1;
            }
          }
        }
      }
    }

    return Tet4Mesher.createFromVoxelGrid({
      grid,
      nx,
      ny,
      nz,
      dx,
      origin: [ox, oy, oz],
      order: opts.order,
      tagRules: opts.tagRules,
    });
  }
}
