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
}
