// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Bridge for Batched Contingency & Fire Flow Screening.
 *
 * Extracts standardized node and pipe hydraulic geometries and operating points
 * from an EPANET network AST to feed into the WebGPU parallel screener.
 */

import type { EpanetNetwork } from "../types.js";
import { solveHydraulics, type EpanetHydraulicResult } from "./todini-ggm.js";

export interface EpanetScreeningNode {
  id: string;
  elevationM: number;
  baseDemandLps: number;
  baseHeadM: number;
  isFixedHead: boolean;
}

export interface EpanetScreeningPipe {
  id: string;
  fromNode: string;
  toNode: string;
  lengthM: number;
  diameterM: number;
  roughness: number;
  baseFlowLps: number;
  headLossM: number;
}

export interface EpanetScreeningModel {
  nodes: EpanetScreeningNode[];
  pipes: EpanetScreeningPipe[];
  hydraulics: EpanetHydraulicResult;
}

/**
 * Extracts nodes and pipes with their steady-state baseline heads and flows.
 */
export function extractEpanetScreeningModel(
  net: EpanetNetwork,
  baseHydraulics?: EpanetHydraulicResult,
): EpanetScreeningModel {
  const hyd = baseHydraulics ?? solveHydraulics(net);

  const nodes: EpanetScreeningNode[] = [];
  const nodeSet = new Set<string>();

  // Junctions
  for (const j of net.junctions) {
    nodeSet.add(j.id.toLowerCase());
    const head = hyd.nodeHeads.get(j.id) ?? j.elevation + (hyd.nodePressures.get(j.id) ?? 20.0);
    nodes.push({
      id: j.id,
      elevationM: j.elevation,
      baseDemandLps: j.demand,
      baseHeadM: head,
      isFixedHead: false,
    });
  }

  // Reservoirs (Fixed head source)
  for (const r of net.reservoirs) {
    nodeSet.add(r.id.toLowerCase());
    nodes.push({
      id: r.id,
      elevationM: r.totalHead,
      baseDemandLps: 0.0,
      baseHeadM: r.totalHead,
      isFixedHead: true,
    });
  }

  // Tanks (Fixed head during instantaneous contingency)
  for (const t of net.tanks ?? []) {
    nodeSet.add(t.id.toLowerCase());
    const head = t.elevation + t.initLevel;
    nodes.push({
      id: t.id,
      elevationM: t.elevation,
      baseDemandLps: 0.0,
      baseHeadM: head,
      isFixedHead: true,
    });
  }

  const pipes: EpanetScreeningPipe[] = [];
  for (const p of net.pipes) {
    const q = hyd.linkFlows.get(p.id) ?? 0.0;
    const hf = hyd.linkHeadLosses.get(p.id) ?? 0.01;
    const dM = p.diameter > 5.0 ? p.diameter / 1000.0 : Math.max(0.01, p.diameter);

    pipes.push({
      id: p.id,
      fromNode: p.node1,
      toNode: p.node2,
      lengthM: Math.max(1.0, p.length),
      diameterM: dM,
      roughness: p.roughness,
      baseFlowLps: q,
      headLossM: hf,
    });
  }

  return { nodes, pipes, hydraulics: hyd };
}
