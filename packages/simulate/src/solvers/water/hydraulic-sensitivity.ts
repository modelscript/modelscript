// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Analytical Water Network Hydraulic Sensitivity Engine.
 *
 * Computes:
 *   1. Pipe hydraulic conductances y_l = dQ_l / d(deltaH_l)
 *   2. Nodal admittance matrix Y_net and Head Sensitivity Matrix S_H = J_H^-1
 *   3. Pipe Outage Distribution Factors (PODF) via dipole perturbations
 *   4. Hydrant fire flow drawdown vectors and available fire flow (AFF) limits
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";

export interface WaterNodeDef {
  id: string;
  elevationM: number;
  baseDemandLps: number;
  baseHeadM: number;
  isFixedHead?: boolean | undefined; // Reservoir or fixed-head tank
}

export interface WaterPipeDef {
  id: string;
  fromNode: string;
  toNode: string;
  lengthM: number;
  diameterM: number;
  roughness: number;
  baseFlowLps: number;
  headLossM: number;
}

export interface WaterSensitivityData {
  nodeCount: number;
  pipeCount: number;
  nodeIds: string[];
  pipeIds: string[];
  nodeIndexMap: Map<string, number>;
  pipeIndexMap: Map<string, number>;
  nodeElevations: Float32Array;
  nodeBaseHeads: Float32Array;
  nodeBaseDemands: Float32Array;
  pipeFromNodes: Uint32Array;
  pipeToNodes: Uint32Array;
  pipeConductances: Float32Array;
  pipeBaseFlows: Float32Array;
  pipeDiameters: Float32Array;
  pipeLengths: Float32Array;
  pipeOutageFactors: Float32Array;
  /** Flattened row-major N x N head sensitivity matrix S_H where S_H[i * N + j] = dH_i / dq_j */
  headSensitivityMatrix: Float32Array;
  totalBaseDemandLps: number;
}

/**
 * Computes the hydraulic sensitivity matrices for a water network around its baseline operating point.
 */
export function calculateWaterNetworkSensitivities(
  nodes: WaterNodeDef[],
  pipes: WaterPipeDef[],
  options?: { headlossExponent?: number | undefined },
): WaterSensitivityData {
  const N = nodes.length;
  const P = pipes.length;
  const nExp = options?.headlossExponent ?? 1.852; // Hazen-Williams default

  const nodeIndexMap = new Map<string, number>();
  const nodeIds: string[] = [];
  const nodeElevations = new Float32Array(N);
  const nodeBaseHeads = new Float32Array(N);
  const nodeBaseDemands = new Float32Array(N);
  let totalBaseDemandLps = 0.0;

  const fixedIndices = new Set<number>();

  for (let i = 0; i < N; i++) {
    const n = nodes[i]!;
    nodeIndexMap.set(n.id.toLowerCase(), i);
    nodeIndexMap.set(n.id, i);
    nodeIds.push(n.id);
    nodeElevations[i] = n.elevationM;
    nodeBaseHeads[i] = n.baseHeadM;
    nodeBaseDemands[i] = n.baseDemandLps;
    totalBaseDemandLps += Math.max(0.0, n.baseDemandLps);

    if (n.isFixedHead) {
      fixedIndices.add(i);
    }
  }

  // If no fixed nodes explicitly designated, designate the node with highest head or lowest demand
  if (fixedIndices.size === 0 && N > 0) {
    let maxHead = -1e9;
    let maxIdx = 0;
    for (let i = 0; i < N; i++) {
      if (nodeBaseHeads[i]! > maxHead) {
        maxHead = nodeBaseHeads[i]!;
        maxIdx = i;
      }
    }
    fixedIndices.add(maxIdx);
  }

  const pipeIndexMap = new Map<string, number>();
  const pipeIds: string[] = [];
  const pipeFromNodes = new Uint32Array(P);
  const pipeToNodes = new Uint32Array(P);
  const pipeConductances = new Float32Array(P);
  const pipeBaseFlows = new Float32Array(P);
  const pipeDiameters = new Float32Array(P);
  const pipeLengths = new Float32Array(P);
  const pipeOutageFactors = new Float32Array(P);

  // 1. Calculate pipe conductances y_l = dQ_l / d(deltaH_l)
  for (let p = 0; p < P; p++) {
    const pipe = pipes[p]!;
    pipeIndexMap.set(pipe.id.toLowerCase(), p);
    pipeIndexMap.set(pipe.id, p);
    pipeIds.push(pipe.id);

    const u = nodeIndexMap.get(pipe.fromNode.toLowerCase()) ?? 0;
    const v = nodeIndexMap.get(pipe.toNode.toLowerCase()) ?? 0;
    pipeFromNodes[p] = u;
    pipeToNodes[p] = v;
    pipeBaseFlows[p] = pipe.baseFlowLps;
    pipeDiameters[p] = pipe.diameterM;
    pipeLengths[p] = pipe.lengthM;

    const absQ = Math.abs(pipe.baseFlowLps);
    const absHf = Math.abs(pipe.headLossM);

    let y = 1.0;
    if (absQ > 1e-4 && absHf > 1e-5) {
      y = absQ / (nExp * absHf);
    } else {
      // Laminar / low-flow regularization based on Poiseuille conductance
      const D = Math.max(0.02, pipe.diameterM);
      const L = Math.max(1.0, pipe.lengthM);
      y = (1000.0 * Math.PI * Math.pow(D, 4) * 9.81) / (128.0 * 1.004e-6 * L);
      y = Math.min(100.0, Math.max(0.01, y));
    }
    pipeConductances[p] = y;
  }

  // 2. Assemble Nodal Admittance Matrix Y_net (N x N)
  // Non-fixed nodes are solved; fixed head nodes have deltaH = 0
  const freeNodes: number[] = [];
  const nodeToFreeMap = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    if (!fixedIndices.has(i)) {
      nodeToFreeMap[i] = freeNodes.length;
      freeNodes.push(i);
    }
  }

  const nFree = freeNodes.length;
  const Yred = Array.from({ length: nFree }, () => new Float64Array(nFree));

  for (let p = 0; p < P; p++) {
    const u = pipeFromNodes[p]!;
    const v = pipeToNodes[p]!;
    const y = pipeConductances[p]!;

    const fu = nodeToFreeMap[u]!;
    const fv = nodeToFreeMap[v]!;

    if (fu >= 0) {
      Yred[fu]![fu]! += y;
      if (fv >= 0) {
        Yred[fu]![fv]! -= y;
      }
    }
    if (fv >= 0) {
      Yred[fv]![fv]! += y;
      if (fu >= 0) {
        Yred[fv]![fu]! -= y;
      }
    }
  }

  // Regularize diagonal if any isolated components
  for (let f = 0; f < nFree; f++) {
    if (Yred[f]![f]! < 1e-6) {
      Yred[f]![f] = 1.0;
    }
  }

  // 3. Invert reduced admittance matrix to obtain head sensitivity
  const S_free = Array.from({ length: nFree }, () => new Float64Array(nFree));
  if (nFree > 0) {
    const fact = luFactor(Yred, nFree);
    const e = new Float64Array(nFree);
    for (let col = 0; col < nFree; col++) {
      e.fill(0);
      e[col] = 1.0;
      luSolve(fact, e);
      for (let row = 0; row < nFree; row++) {
        S_free[row]![col] = e[row]!;
      }
    }
  }

  // 4. Expand to full N x N S_H matrix
  const S_H = new Float32Array(N * N);
  for (let i = 0; i < N; i++) {
    const fi = nodeToFreeMap[i]!;
    if (fi < 0) continue; // Fixed head nodes have zero sensitivity
    for (let j = 0; j < N; j++) {
      const fj = nodeToFreeMap[j]!;
      if (fj < 0) continue;
      S_H[i * N + j] = S_free[fi]![fj]!;
    }
  }

  // 5. Calculate dipole factors for each pipe
  // factor_p = 1 - y_p * (S_uu + S_vv - 2 * S_uv)
  for (let p = 0; p < P; p++) {
    const u = pipeFromNodes[p]!;
    const v = pipeToNodes[p]!;
    const y = pipeConductances[p]!;

    const s_uu = S_H[u * N + u]!;
    const s_vv = S_H[v * N + v]!;
    const s_uv = S_H[u * N + v]!;

    const effImpedance = s_uu + s_vv - 2.0 * s_uv;
    let factor = 1.0 - y * effImpedance;
    if (Math.abs(factor) < 1e-4) {
      // Bridge line / subnetwork isolation
      factor = factor >= 0 ? 1e-4 : -1e-4;
    }
    pipeOutageFactors[p] = factor;
  }

  return {
    nodeCount: N,
    pipeCount: P,
    nodeIds,
    pipeIds,
    nodeIndexMap,
    pipeIndexMap,
    nodeElevations,
    nodeBaseHeads,
    nodeBaseDemands,
    pipeFromNodes,
    pipeToNodes,
    pipeConductances,
    pipeBaseFlows,
    pipeDiameters,
    pipeLengths,
    pipeOutageFactors,
    headSensitivityMatrix: S_H,
    totalBaseDemandLps,
  };
}
