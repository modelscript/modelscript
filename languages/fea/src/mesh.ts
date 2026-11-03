// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FeaModelData } from "./types.js";

export interface InpMeshPayload {
  positions: number[];
  indices: number[];
  edgeIndices?: number[] | undefined;
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
  edgeIndices: number[];
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
 * Extracts outer boundary surface triangles from volume elements (C3D4, C3D10, C3D8, C3D20, C3D6)
 * or shell elements (S3, S4). External boundary faces appear exactly once in the mesh connectivity.
 */
export function extractInpSurfaceTriangles(elements: Uint32Array | number[], nodesPerElem: number): number[] {
  const surfaceIndices: number[] = [];
  const numElems = elements.length > 0 ? Math.floor(elements.length / nodesPerElem) : 0;
  if (numElems <= 0) return surfaceIndices;

  if (nodesPerElem === 8 || nodesPerElem === 20) {
    const quadMap = new Map<string, { count: number; quad: [number, number, number, number] }>();
    for (let e = 0; e < numElems; e++) {
      const b = e * nodesPerElem;
      const n0 = elements[b + 0]!;
      const n1 = elements[b + 1]!;
      const n2 = elements[b + 2]!;
      const n3 = elements[b + 3]!;
      const n4 = elements[b + 4]!;
      const n5 = elements[b + 5]!;
      const n6 = elements[b + 6]!;
      const n7 = elements[b + 7]!;

      const quads: [number, number, number, number][] = [
        [n0, n3, n2, n1],
        [n4, n5, n6, n7],
        [n0, n1, n5, n4],
        [n1, n2, n6, n5],
        [n2, n3, n7, n6],
        [n3, n0, n4, n7],
      ];
      for (const q of quads) {
        const key = [q[0], q[1], q[2], q[3]].sort((a, c) => a - c).join("_");
        const entry = quadMap.get(key);
        if (entry) entry.count++;
        else quadMap.set(key, { count: 1, quad: q });
      }
    }
    for (const { count, quad } of quadMap.values()) {
      if (count === 1) {
        surfaceIndices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      }
    }
    return surfaceIndices;
  }

  const faceMap = new Map<string, { count: number; face: [number, number, number] }>();
  for (let e = 0; e < numElems; e++) {
    const base = e * nodesPerElem;
    const n0 = elements[base + 0]!;
    const n1 = elements[base + 1]!;
    const n2 = elements[base + 2]!;
    if (nodesPerElem === 3) {
      surfaceIndices.push(n0, n1, n2);
      continue;
    }
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
 * Extracts structured mesh geometry, surface boundary triangles, element wireframe edges,
 * and node/element mappings from parsed FeaModelData across all standard element families.
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

  const elementIndices: number[] = [];
  let isQuadratic = false;

  const triFaceMap = new Map<string, { count: number; face: [number, number, number] }>();
  const quadFaceMap = new Map<string, { count: number; quad: [number, number, number, number] }>();
  const edgeSet = new Set<string>();
  const edgeIndices: number[] = [];

  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (!edgeSet.has(k)) {
      edgeSet.add(k);
      edgeIndices.push(a, b);
    }
  };

  const addTriFace = (a: number, b: number, c: number) => {
    const key = [a, b, c].sort((x, y) => x - y).join("_");
    const entry = triFaceMap.get(key);
    if (entry) entry.count++;
    else triFaceMap.set(key, { count: 1, face: [a, b, c] });
  };

  const addQuadFace = (a: number, b: number, c: number, d: number) => {
    const key = [a, b, c, d].sort((x, y) => x - y).join("_");
    const entry = quadFaceMap.get(key);
    if (entry) entry.count++;
    else quadFaceMap.set(key, { count: 1, quad: [a, b, c, d] });
  };

  for (const elem of data.elements.values()) {
    const t = elem.type.toUpperCase();
    if (t === "C3D10") isQuadratic = true;
    const mapped = elem.nodes.map((nId) => nodeIdToIdx.get(nId)).filter((v): v is number => v !== undefined);
    if (mapped.length < 2) continue;

    if ((t.startsWith("C3D8") || t.startsWith("C3D20") || t.includes("CHEXA")) && mapped.length >= 8) {
      const [n0, n1, n2, n3, n4, n5, n6, n7] = mapped as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      addQuadFace(n0, n3, n2, n1);
      addQuadFace(n4, n5, n6, n7);
      addQuadFace(n0, n1, n5, n4);
      addQuadFace(n1, n2, n6, n5);
      addQuadFace(n2, n3, n7, n6);
      addQuadFace(n3, n0, n4, n7);
      // Decompose hex into 5 Tet4 elements for solver compatibility
      elementIndices.push(n0, n1, n3, n4, n1, n2, n3, n6, n1, n4, n5, n6, n3, n4, n6, n7, n1, n3, n4, n6);
    } else if ((t.startsWith("C3D6") || t.startsWith("C3D15") || t.includes("CPENTA")) && mapped.length >= 6) {
      const [n0, n1, n2, n3, n4, n5] = mapped as [number, number, number, number, number, number];
      addTriFace(n0, n2, n1);
      addTriFace(n3, n4, n5);
      addQuadFace(n0, n1, n4, n3);
      addQuadFace(n1, n2, n5, n4);
      addQuadFace(n2, n0, n3, n5);
      // Decompose wedge into 3 Tet4 elements
      elementIndices.push(n0, n1, n2, n3, n1, n2, n3, n4, n2, n3, n4, n5);
    } else if ((t.startsWith("C3D4") || t.startsWith("C3D10") || t.includes("CTETRA")) && mapped.length >= 4) {
      const [n0, n1, n2, n3] = mapped as [number, number, number, number];
      addTriFace(n0, n2, n1);
      addTriFace(n0, n1, n3);
      addTriFace(n1, n2, n3);
      addTriFace(n0, n3, n2);
      if (isQuadratic && mapped.length >= 10) {
        for (let i = 0; i < 10; i++) elementIndices.push(mapped[i]!);
      } else {
        elementIndices.push(n0, n1, n2, n3);
      }
    } else if (mapped.length >= 4) {
      addQuadFace(mapped[0]!, mapped[1]!, mapped[2]!, mapped[3]!);
    } else if (mapped.length === 3) {
      addTriFace(mapped[0]!, mapped[1]!, mapped[2]!);
    } else if (mapped.length === 2) {
      addEdge(mapped[0]!, mapped[1]!);
    }
  }

  const surfaceIndices: number[] = [];
  for (const { count, quad } of quadFaceMap.values()) {
    if (count === 1) {
      surfaceIndices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      addEdge(quad[0], quad[1]);
      addEdge(quad[1], quad[2]);
      addEdge(quad[2], quad[3]);
      addEdge(quad[3], quad[0]);
    }
  }
  for (const { count, face } of triFaceMap.values()) {
    if (count === 1) {
      surfaceIndices.push(face[0], face[1], face[2]);
      addEdge(face[0], face[1]);
      addEdge(face[1], face[2]);
      addEdge(face[2], face[0]);
    }
  }

  const elements = new Uint32Array(elementIndices);
  const nodesPerElem = isQuadratic ? 10 : 4;
  const numElems = elements.length > 0 ? Math.floor(elements.length / nodesPerElem) : data.elements.size;

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
    edgeIndices,
    normals: [],
    fixedNodes: fixedNodesList,
    loads: loadsList,
    stats: {
      numNodes: data.nodes.size,
      numElements: data.elements.size || numElems,
      materials: Array.from(data.materials.keys()),
      isQuadratic,
    },
  };

  return {
    positions,
    surfaceIndices,
    edgeIndices,
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
