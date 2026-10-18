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
    } else if (ns.length === 8 && (family === "hex" || elem.type.startsWith("C3D8") || elem.type === "CHEXA")) {
      // Subdivide 8-node hexahedron into 6 linear tetrahedra (Kuhn subdivision)
      const [v0, v1, v2, v3, v4, v5, v6, v7] = ns;
      tet4Elements.push(...orientTet(v0!, v1!, v2!, v6!));
      tet4Elements.push(...orientTet(v0!, v2!, v3!, v6!));
      tet4Elements.push(...orientTet(v0!, v3!, v7!, v6!));
      tet4Elements.push(...orientTet(v0!, v7!, v4!, v6!));
      tet4Elements.push(...orientTet(v0!, v4!, v5!, v6!));
      tet4Elements.push(...orientTet(v0!, v5!, v1!, v6!));
    } else if (ns.length >= 4) {
      tet4Elements.push(...orientTet(ns[0]!, ns[1]!, ns[2]!, ns[3]!));
    }
  }

  const useQuadratic = tet10Elements.length > 0 && tet4Elements.length === 0;
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
    nodeCoords,
    elements,
    numNodes,
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
