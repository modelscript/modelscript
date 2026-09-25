// SPDX-License-Identifier: AGPL-3.0-or-later

import { getFeaDialect, type ParameterLookup } from "@modelscript/fea";
import { FeaSolver } from "./fea-solver.js";
import type { FeaBoundaryConditions, MaterialProperties, Tet4Mesh } from "./tet4-types.js";

export interface LoadInpOptions {
  evaluator?: ParameterLookup | Record<string, number | string>;
  defaultYoungsModulus?: number;
  defaultPoissonsRatio?: number;
  defaultDensity?: number;
  dialect?: string;
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

  // Filter 4-node tetrahedral elements (C3D4)
  const tetElements: number[] = [];
  for (const [, elem] of parsed.elements) {
    if (elem.nodes.length >= 4) {
      const n0 = idToIdx.get(elem.nodes[0]);
      const n1 = idToIdx.get(elem.nodes[1]);
      const n2 = idToIdx.get(elem.nodes[2]);
      const n3 = idToIdx.get(elem.nodes[3]);
      if (n0 !== undefined && n1 !== undefined && n2 !== undefined && n3 !== undefined) {
        tetElements.push(n0, n1, n2, n3);
      }
    }
  }

  const numElements = Math.floor(tetElements.length / 4);
  const elements = new Uint32Array(tetElements);

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
