// SPDX-License-Identifier: AGPL-3.0-or-later

import { getFeaDialect, type ParameterLookup } from "@modelscript/fea";
import { FeaSolver } from "./fea-solver.js";
import type { FeaBoundaryConditions, MaterialProperties, Tet4Mesh } from "./tet4-types.js";

export interface LoadInpOptions {
  evaluator?: ParameterLookup | Record<string, number | string> | undefined;
  defaultYoungsModulus?: number | undefined;
  defaultPoissonsRatio?: number | undefined;
  defaultDensity?: number | undefined;
  dialect?: string | undefined;
}

export interface InpFeaSetup {
  mesh: Tet4Mesh;
  material: MaterialProperties;
  bcs: FeaBoundaryConditions;
  solver: FeaSolver;
}

/**
 * Loads a structural FEA deck (.inp / .bdf) directly into an in-WASM FeaSolver.
 */
export function loadInpToFea(deckContent: string, options: LoadInpOptions = {}): InpFeaSetup {
  const dialect = getFeaDialect(options.dialect || "inp");
  let text = deckContent;
  if (text.includes("{{")) {
    text = dialect.materialize(text, { evaluator: options.evaluator });
  }

  const parsed = dialect.parse(text);

  // Map 1-based or arbitrary node IDs to continuous 0-based indices
  const idToIdx = new Map<number, number>();
  const numNodes = parsed.nodes.size;
  const nodeCoords = new Float32Array(numNodes * 3);

  let idx = 0;
  for (const [id, node] of parsed.nodes) {
    idToIdx.set(id, idx);
    nodeCoords[idx * 3] = node.x;
    nodeCoords[idx * 3 + 1] = node.y;
    nodeCoords[idx * 3 + 2] = node.z;
    idx++;
  }

  // Helper to ensure positive orientation (n1 - n0) x (n2 - n0) . (n3 - n0) > 0
  const orientTet = (n0: number, n1: number, n2: number, n3: number): [number, number, number, number] => {
    const x0 = nodeCoords[n0 * 3]!,
      y0 = nodeCoords[n0 * 3 + 1]!,
      z0 = nodeCoords[n0 * 3 + 2]!;
    const v1x = nodeCoords[n1 * 3]! - x0,
      v1y = nodeCoords[n1 * 3 + 1]! - y0,
      v1z = nodeCoords[n1 * 3 + 2]! - z0;
    const v2x = nodeCoords[n2 * 3]! - x0,
      v2y = nodeCoords[n2 * 3 + 1]! - y0,
      v2z = nodeCoords[n2 * 3 + 2]! - z0;
    const v3x = nodeCoords[n3 * 3]! - x0,
      v3y = nodeCoords[n3 * 3 + 1]! - y0,
      v3z = nodeCoords[n3 * 3 + 2]! - z0;
    const det = v1x * (v2y * v3z - v2z * v3y) - v1y * (v2x * v3z - v2z * v3x) + v1z * (v2x * v3y - v2y * v3x);
    return det >= 0 ? [n0, n1, n2, n3] : [n0, n1, n3, n2];
  };

  const tet4Elements: number[] = [];
  const tet10Elements: number[] = [];

  for (const [, elem] of parsed.elements) {
    if (
      elem.family === "shell" ||
      elem.family === "beam" ||
      elem.family === "truss" ||
      elem.type === "CQUAD4" ||
      elem.type === "CTRIA3"
    ) {
      continue;
    }

    const mapped = elem.nodes.map((nid) => idToIdx.get(nid));
    if (mapped.some((m) => m === undefined)) continue;
    const ns = mapped as number[];

    const family = elem.family as string | undefined;
    if (ns.length === 10 && (family === "tet" || elem.type.includes("C3D10") || elem.type === "CTETRA")) {
      tet10Elements.push(...ns);
    } else if (
      (ns.length === 8 || ns.length === 20) &&
      (family === "hex" || elem.type.startsWith("C3D8") || elem.type.startsWith("C3D20") || elem.type === "CHEXA")
    ) {
      // Subdivide 8-node or 20-node hexahedron into 6 linear tetrahedra (Kuhn subdivision)
      const [v0, v1, v2, v3, v4, v5, v6, v7] = ns;
      tet4Elements.push(...orientTet(v0!, v1!, v2!, v6!));
      tet4Elements.push(...orientTet(v0!, v2!, v3!, v6!));
      tet4Elements.push(...orientTet(v0!, v3!, v7!, v6!));
      tet4Elements.push(...orientTet(v0!, v7!, v4!, v6!));
      tet4Elements.push(...orientTet(v0!, v4!, v5!, v6!));
      tet4Elements.push(...orientTet(v0!, v5!, v1!, v6!));
    } else if (
      (ns.length === 6 || ns.length === 15) &&
      (family === "wedge" || elem.type.startsWith("C3D6") || elem.type.startsWith("C3D15") || elem.type === "CPENTA")
    ) {
      // Subdivide 6-node or 15-node wedge/pentahedron into 3 linear tetrahedra
      const [v0, v1, v2, v3, v4, v5] = ns;
      tet4Elements.push(...orientTet(v0!, v1!, v2!, v3!));
      tet4Elements.push(...orientTet(v1!, v2!, v3!, v4!));
      tet4Elements.push(...orientTet(v2!, v3!, v4!, v5!));
    } else if (
      (ns.length === 5 || ns.length === 13) &&
      (family === "pyramid" || elem.type.startsWith("C3D5") || elem.type.startsWith("C3D13") || elem.type === "CPYRAM")
    ) {
      // Subdivide 5-node or 13-node pyramid into 2 linear tetrahedra
      const [v0, v1, v2, v3, v4] = ns;
      tet4Elements.push(...orientTet(v0!, v1!, v2!, v4!));
      tet4Elements.push(...orientTet(v0!, v2!, v3!, v4!));
    } else if (ns.length >= 4) {
      tet4Elements.push(...orientTet(ns[0]!, ns[1]!, ns[2]!, ns[3]!));
    }
  }

  let finalNodeCoords = nodeCoords;
  let finalNumNodes = numNodes;

  // If mesh mixes Tet10 and Tet4 elements, promote Tet4 elements to Tet10 by inserting mid-edge nodes
  if (tet10Elements.length > 0 && tet4Elements.length > 0) {
    const extraCoords: number[] = [];
    const edgeMidpoint = new Map<string, number>();
    const getCoord = (n: number, c: number): number => {
      if (n < numNodes) return nodeCoords[n * 3 + c]!;
      return extraCoords[(n - numNodes) * 3 + c]!;
    };
    const getMidNode = (a: number, b: number): number => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}_${hi}`;
      const existing = edgeMidpoint.get(key);
      if (existing !== undefined) return existing;
      const newIdx = finalNumNodes++;
      extraCoords.push(
        0.5 * (getCoord(a, 0) + getCoord(b, 0)),
        0.5 * (getCoord(a, 1) + getCoord(b, 1)),
        0.5 * (getCoord(a, 2) + getCoord(b, 2)),
      );
      edgeMidpoint.set(key, newIdx);
      return newIdx;
    };

    for (let i = 0; i < tet4Elements.length; i += 4) {
      const n0 = tet4Elements[i]!;
      const n1 = tet4Elements[i + 1]!;
      const n2 = tet4Elements[i + 2]!;
      const n3 = tet4Elements[i + 3]!;
      const n4 = getMidNode(n0, n1);
      const n5 = getMidNode(n1, n2);
      const n6 = getMidNode(n2, n0);
      const n7 = getMidNode(n0, n3);
      const n8 = getMidNode(n1, n3);
      const n9 = getMidNode(n2, n3);
      tet10Elements.push(n0, n1, n2, n3, n4, n5, n6, n7, n8, n9);
    }
    tet4Elements.length = 0;

    if (extraCoords.length > 0) {
      finalNodeCoords = new Float32Array(finalNumNodes * 3);
      finalNodeCoords.set(nodeCoords, 0);
      finalNodeCoords.set(extraCoords, numNodes * 3);
    }
  }

  const useQuadratic = tet10Elements.length > 0;
  const nodesPerElement = useQuadratic ? 10 : 4;
  const flatElements = useQuadratic ? tet10Elements : tet4Elements;
  const numElements = Math.floor(flatElements.length / nodesPerElement);
  const elements = new Uint32Array(flatElements);

  // Build boundary nodes map from node sets
  const boundaryNodes = new Map<string, number[]>();
  for (const [setName, setNodes] of parsed.nodeSets) {
    const indices: number[] = [];
    for (const nid of setNodes) {
      const i = idToIdx.get(nid);
      if (i !== undefined) indices.push(i);
    }
    boundaryNodes.set(setName, indices);
  }

  const mesh: Tet4Mesh = {
    nodeCoords: finalNodeCoords,
    elements,
    numNodes: finalNumNodes,
    numElements,
    elementOrder: useQuadratic ? "quadratic" : "linear",
    nodesPerElement,
    boundaryNodes,
  };

  // Extract first material or fallback defaults
  let E = options.defaultYoungsModulus ?? 70e9;
  let nu = options.defaultPoissonsRatio ?? 0.33;
  let rho = options.defaultDensity ?? 2700;
  let yieldStrength: number | undefined;

  for (const [, mat] of parsed.materials) {
    if (mat.E !== undefined) E = mat.E;
    if (mat.nu !== undefined) nu = mat.nu;
    if (mat.rho !== undefined) rho = mat.rho;
    if (mat.yieldStrength !== undefined) yieldStrength = mat.yieldStrength;
    break;
  }

  const material: MaterialProperties = {
    E,
    nu,
    rho,
    yieldStrength,
  };

  // Convert fixed nodes to 0-based indices
  const fixedNodes = new Set<number>();
  for (const nid of parsed.fixedNodes) {
    const i = idToIdx.get(nid);
    if (i !== undefined) fixedNodes.add(i);
  }

  // Convert nodal loads to 0-based indices
  const nodalLoads = new Map<number, [number, number, number]>();
  for (const [nid, loadVec] of parsed.nodalLoads) {
    const i = idToIdx.get(nid);
    if (i !== undefined) nodalLoads.set(i, loadVec);
  }

  const bcs: FeaBoundaryConditions = {
    fixedNodes,
    nodalLoads,
    corotational: true,
  };

  const solver = new FeaSolver(mesh, material);

  return { mesh, material, bcs, solver };
}
