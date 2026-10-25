// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FeaModelData } from "./types.js";

export interface InpMeshPayload {
  positions: number[];
  indices: number[];
  normals: number[];
  fixedNodes: { id: number; position: [number, number, number] }[];
  loads: { id: number; position: [number, number, number]; force: [number, number, number] }[];
  stats: {
    numNodes: number;
    numElements: number;
    materials: string[];
    isQuadratic: boolean;
  };
}

export interface InpMeshGeometry {
  positions: number[];
  surfaceIndices: number[];
  nodeIdToIdx: Map<number, number>;
  elements: Uint32Array;
  isQuadratic: boolean;
  nodesPerElem: number;
  numElems: number;
  fixedNodes: { id: number; position: [number, number, number] }[];
  loads: { id: number; position: [number, number, number]; force: [number, number, number] }[];
  material: { E: number; nu: number; rho: number };
  payload: InpMeshPayload;
}

/**
 * Extracts outer boundary surface triangles from volume tetrahedral elements (e.g., C3D4 or C3D10).
 * External boundary faces appear exactly once in the mesh element connectivity.
 */
export function extractInpSurfaceTriangles(elements: Uint32Array | number[], nodesPerElem: number): number[] {
  const surfaceIndices: number[] = [];
  const numElems = elements.length > 0 ? Math.floor(elements.length / nodesPerElem) : 0;
  if (numElems <= 0) return surfaceIndices;

  const faceMap = new Map<string, { count: number; face: [number, number, number] }>();
  for (let e = 0; e < numElems; e++) {
    const base = e * nodesPerElem;
    const n0 = elements[base + 0]!;
    const n1 = elements[base + 1]!;
    const n2 = elements[base + 2]!;
    const n3 = elements[base + 3]!;

    const faces: [number, number, number][] = [
      [n0, n2, n1],
      [n0, n1, n3],
      [n1, n2, n3],
      [n0, n3, n2],
    ];
    for (const f of faces) {
      const key = [f[0], f[1], f[2]].sort((a, b) => a - b).join("_");
      const entry = faceMap.get(key);
      if (entry) {
        entry.count++;
      } else {
        faceMap.set(key, { count: 1, face: f });
      }
    }
  }

  for (const { count, face } of faceMap.values()) {
    if (count === 1) {
      surfaceIndices.push(face[0], face[1], face[2]);
    }
  }

  return surfaceIndices;
}

/**
 * Extracts structured mesh geometry, surface boundary triangles, and node/element mappings
 * from parsed FeaModelData.
 */
export function extractCalculixInpMesh(data: FeaModelData): InpMeshGeometry {
  // Map nodes into contiguous position array
  const nodeIdToIdx = new Map<number, number>();
  const positions: number[] = [];
  let idx = 0;
  for (const [id, node] of data.nodes.entries()) {
    nodeIdToIdx.set(id, idx++);
    positions.push(node.x, node.y, node.z);
  }

  // Map elements
  const elementIndices: number[] = [];
  let isQuadratic = false;
  for (const elem of data.elements.values()) {
    if (elem.type === "C3D10") isQuadratic = true;
    for (const nId of elem.nodes) {
      const nIdx = nodeIdToIdx.get(nId);
      if (nIdx !== undefined) {
        elementIndices.push(nIdx);
      }
    }
  }

  const elements = new Uint32Array(elementIndices);
  const nodesPerElem = isQuadratic ? 10 : 4;
  const numElems = elements.length > 0 ? Math.floor(elements.length / nodesPerElem) : 0;

  // Resolve material properties
  let material = { E: 70e9, nu: 0.33, rho: 2700.0 };
  for (const mat of data.materials.values()) {
    material = {
      E: mat.E ?? 70e9,
      nu: mat.nu ?? 0.33,
      rho: mat.rho ?? 2700.0,
    };
    break;
  }

  // Surface boundary extraction
  const surfaceIndices = extractInpSurfaceTriangles(elements, nodesPerElem);

  // Fixed nodes and loads positions
  const fixedNodesList: { id: number; position: [number, number, number] }[] = [];
  for (const nId of data.fixedNodes) {
    const node = data.nodes.get(nId);
    if (node) {
      fixedNodesList.push({ id: nId, position: [node.x, node.y, node.z] });
    }
  }

  const loadsList: { id: number; position: [number, number, number]; force: [number, number, number] }[] = [];
  for (const [nId, f] of data.nodalLoads.entries()) {
    const node = data.nodes.get(nId);
    if (node) {
      loadsList.push({ id: nId, position: [node.x, node.y, node.z], force: f });
    }
  }

  const payload: InpMeshPayload = {
    positions,
    indices: surfaceIndices.length > 0 ? surfaceIndices : Array.from({ length: positions.length / 3 }, (_, i) => i),
    normals: [],
    fixedNodes: fixedNodesList,
    loads: loadsList,
    stats: {
      numNodes: data.nodes.size,
      numElements: numElems,
      materials: Array.from(data.materials.keys()),
      isQuadratic,
    },
  };

  return {
    positions,
    surfaceIndices,
    nodeIdToIdx,
    elements,
    isQuadratic,
    nodesPerElem,
    numElems,
    fixedNodes: fixedNodesList,
    loads: loadsList,
    material,
    payload,
  };
}
