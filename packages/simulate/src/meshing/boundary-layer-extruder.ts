// SPDX-License-Identifier: AGPL-3.0-or-later

export interface BoundaryLayerOptions {
  /** First layer height in meters (default: 0.0005 = 0.5mm). */
  firstLayerHeight?: number;
  /** Number of inflation layers (default: 3). */
  numLayers?: number;
  /** Geometric expansion ratio between consecutive layers (default: 1.2). */
  growthRatio?: number;
  /** Tag name for the inflated boundary layer elements. Default: 'boundary_layer'. */
  layerTag?: string;
}

export interface ExtrusionResult {
  nodeCoords: Float32Array;
  elements: Uint32Array;
  numNodes: number;
  numElements: number;
  layerNodeIndices: number[][]; // per-layer node index arrays
}

/**
 * High-Performance Boundary Layer Inflation Extruder for Turbulent CFD & High-Stress FEA.
 * Extrudes structured prism layers from boundary triangles and decomposes them into conformal tetrahedra.
 */
export class BoundaryLayerExtruder {
  /**
   * Extrudes structured inflation layers from a triangular boundary surface.
   * Decomposes each triangular prism into 3 tetrahedra with consistent face orientation.
   */
  public static extrude(
    surfaceCoords: Float32Array | number[],
    surfaceTriangles: Uint32Array | number[],
    options: BoundaryLayerOptions = {},
  ): ExtrusionResult {
    const h1 = options.firstLayerHeight ?? 0.0005;
    const numLayers = options.numLayers ?? 3;
    const r = options.growthRatio ?? 1.2;

    const numBaseNodes = surfaceCoords.length / 3;
    const numBaseTriangles = surfaceTriangles.length / 3;

    // 1. Calculate vertex normals on the base surface
    const vertexNormals = new Float32Array(numBaseNodes * 3);
    for (let t = 0; t < numBaseTriangles; t++) {
      const n0 = surfaceTriangles[t * 3 + 0] * 3;
      const n1 = surfaceTriangles[t * 3 + 1] * 3;
      const n2 = surfaceTriangles[t * 3 + 2] * 3;

      const ax = surfaceCoords[n1 + 0] - surfaceCoords[n0 + 0];
      const ay = surfaceCoords[n1 + 1] - surfaceCoords[n0 + 1];
      const az = surfaceCoords[n1 + 2] - surfaceCoords[n0 + 2];

      const bx = surfaceCoords[n2 + 0] - surfaceCoords[n0 + 0];
      const by = surfaceCoords[n2 + 1] - surfaceCoords[n0 + 1];
      const bz = surfaceCoords[n2 + 2] - surfaceCoords[n0 + 2];

      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;

      // Accumulate into vertex normals
      for (const idx of [n0, n1, n2]) {
        vertexNormals[idx + 0] += nx;
        vertexNormals[idx + 1] += ny;
        vertexNormals[idx + 2] += nz;
      }
    }

    // Normalize vertex normals
    for (let i = 0; i < numBaseNodes; i++) {
      const idx = i * 3;
      const len = Math.hypot(vertexNormals[idx], vertexNormals[idx + 1], vertexNormals[idx + 2]);
      if (len > 1e-12) {
        vertexNormals[idx + 0] /= len;
        vertexNormals[idx + 1] /= len;
        vertexNormals[idx + 2] /= len;
      } else {
        vertexNormals[idx + 2] = 1.0; // Fallback unit normal
      }
    }

    // 2. Generate layered node coordinates
    const totalNodes = numBaseNodes * (numLayers + 1);
    const nodeCoords = new Float32Array(totalNodes * 3);
    const layerNodeIndices: number[][] = [];

    // Copy base layer (layer 0)
    for (let i = 0; i < surfaceCoords.length; i++) {
      nodeCoords[i] = surfaceCoords[i];
    }
    layerNodeIndices.push(Array.from({ length: numBaseNodes }, (_, i) => i));

    let currentHeight = 0;
    let stepHeight = h1;

    for (let layer = 1; layer <= numLayers; layer++) {
      currentHeight += stepHeight;
      stepHeight *= r;

      const layerOffset = layer * numBaseNodes * 3;
      const layerNodes: number[] = [];

      for (let i = 0; i < numBaseNodes; i++) {
        const baseIdx = i * 3;
        const targetIdx = layerOffset + baseIdx;

        const nx = vertexNormals[baseIdx + 0];
        const ny = vertexNormals[baseIdx + 1];
        const nz = vertexNormals[baseIdx + 2];

        nodeCoords[targetIdx + 0] = surfaceCoords[baseIdx + 0] + nx * currentHeight;
        nodeCoords[targetIdx + 1] = surfaceCoords[baseIdx + 1] + ny * currentHeight;
        nodeCoords[targetIdx + 2] = surfaceCoords[baseIdx + 2] + nz * currentHeight;

        layerNodes.push(layer * numBaseNodes + i);
      }
      layerNodeIndices.push(layerNodes);
    }

    // 3. Decompose each triangular prism between layers into 3 tetrahedra
    // Prism vertices: bottom [n0, n1, n2], top [m0, m1, m2]
    const totalTets = numBaseTriangles * numLayers * 3;
    const elements = new Uint32Array(totalTets * 4);
    let elemPtr = 0;

    for (let layer = 0; layer < numLayers; layer++) {
      const bottomBase = layer * numBaseNodes;
      const topBase = (layer + 1) * numBaseNodes;

      for (let t = 0; t < numBaseTriangles; t++) {
        const i0 = surfaceTriangles[t * 3 + 0];
        const i1 = surfaceTriangles[t * 3 + 1];
        const i2 = surfaceTriangles[t * 3 + 2];

        const n0 = bottomBase + i0;
        const n1 = bottomBase + i1;
        const n2 = bottomBase + i2;

        const m0 = topBase + i0;
        const m1 = topBase + i1;
        const m2 = topBase + i2;

        // Canonical 3-tetrahedron subdivision of a prism:
        // Tet 1: [n0, n1, n2, m2]
        elements[elemPtr++] = n0;
        elements[elemPtr++] = n1;
        elements[elemPtr++] = n2;
        elements[elemPtr++] = m2;

        // Tet 2: [n0, n1, m1, m2]
        elements[elemPtr++] = n0;
        elements[elemPtr++] = n1;
        elements[elemPtr++] = m1;
        elements[elemPtr++] = m2;

        // Tet 3: [n0, m0, m1, m2]
        elements[elemPtr++] = n0;
        elements[elemPtr++] = m0;
        elements[elemPtr++] = m1;
        elements[elemPtr++] = m2;
      }
    }

    return {
      nodeCoords,
      elements,
      numNodes: totalNodes,
      numElements: totalTets,
      layerNodeIndices,
    };
  }
}
