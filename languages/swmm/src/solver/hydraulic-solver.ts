// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — 1D Open-Channel & Pressurized Hydraulic Flow Routing Solver.
 *
 * Implements Manning's equation and node head continuity balance for open-channel
 * conduits, circular pipes, and outfall boundary stages.
 */

import type { SwmmDeck } from "../types.js";

export interface ConduitFlowResult {
  conduitId: string;
  flowRate: number; // m^3/s or cfs
  velocity: number; // m/s or ft/s
  depth: number; // water depth in conduit
  capacityFraction: number; // Q / Q_full
  status: "NORMAL" | "SURCHARGED" | "DRY";
}

export interface NodeHydraulicResult {
  nodeId: string;
  head: number; // Total hydraulic head
  depth: number; // Water depth
  inflow: number; // Total incoming flow
  overflow: number; // Flooding/surcharge rate
}

export interface SwmmRoutingResult {
  conduits: Map<string, ConduitFlowResult>;
  nodes: Map<string, NodeHydraulicResult>;
  totalInflow: number;
  totalOutflow: number;
  isFlooding: boolean;
}

/**
 * Exact geometric wetted properties of a circular conduit of diameter D at water depth d.
 * Based on standard open-channel hydraulics (Chow, 1959; EPA SWMM 5.2).
 */
export function computeCircularSection(
  D: number,
  depth: number,
): {
  area: number;
  hydRadius: number;
  topWidth: number;
  wettedPerimeter: number;
} {
  const d = Math.max(0.0, Math.min(D, depth));
  if (d <= 0.0) {
    return { area: 0.0, hydRadius: 0.0, topWidth: 0.0, wettedPerimeter: 0.0 };
  }
  if (d >= D) {
    const area = (Math.PI * D * D) / 4.0;
    return { area, hydRadius: D / 4.0, topWidth: 0.0, wettedPerimeter: Math.PI * D };
  }
  // Subtended angle theta = 2 * acos(1 - 2 * d / D)
  const theta = 2.0 * Math.acos(1.0 - 2.0 * (d / D));
  const area = ((D * D) / 8.0) * (theta - Math.sin(theta));
  const wettedPerimeter = 0.5 * D * theta;
  const hydRadius = wettedPerimeter > 0.0 ? area / wettedPerimeter : 0.0;
  const topWidth = D * Math.sin(theta / 2.0);
  return { area, hydRadius, topWidth, wettedPerimeter };
}

export function routeNetworkFlow(deck: SwmmDeck): SwmmRoutingResult {
  const isUS = deck.flowUnits === "CFS" || deck.flowUnits === "GPM" || deck.flowUnits === "MGD";
  const kManning = isUS ? 1.486 : 1.0;

  const nodeResults = new Map<string, NodeHydraulicResult>();
  const conduitResults = new Map<string, ConduitFlowResult>();

  // Map nodes to contiguous integer indices: junctions first [0, nJunctions-1], then outfalls [nJunctions, totalNodes-1]
  const nJunctions = deck.junctions.size;
  const nOutfalls = deck.outfalls.size;
  const totalNodes = nJunctions + nOutfalls;

  const nodeIdxMap = new Map<string, number>();
  const junctionIds: string[] = new Array(nJunctions);
  const elevations = new Float64Array(totalNodes);
  const initDepths = new Float64Array(nJunctions);
  const heads = new Float64Array(totalNodes);
  const depths = new Float64Array(totalNodes);

  let jIdx = 0;
  for (const [id, j] of deck.junctions) {
    nodeIdxMap.set(id, jIdx);
    junctionIds[jIdx] = id;
    elevations[jIdx] = j.elevation;
    initDepths[jIdx] = j.initDepth ?? 0.0;
    const depth = j.initDepth ?? j.maxDepth * 0.2;
    depths[jIdx] = depth;
    const head = j.elevation + depth;
    heads[jIdx] = head;
    nodeResults.set(id, {
      nodeId: id,
      head,
      depth,
      inflow: 0.0,
      overflow: 0.0,
    });
    jIdx++;
  }

  let oIdx = nJunctions;
  for (const [id, o] of deck.outfalls) {
    nodeIdxMap.set(id, oIdx);
    elevations[oIdx] = o.elevation;
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    depths[oIdx] = stage;
    const head = o.elevation + stage;
    heads[oIdx] = head;
    nodeResults.set(id, {
      nodeId: id,
      head,
      depth: stage,
      inflow: 0.0,
      overflow: 0.0,
    });
    oIdx++;
  }

  // Pre-extract conduit parameters into contiguous arrays
  const nConduits = deck.conduits.size;
  const conduitIds: string[] = new Array(nConduits);
  const cDiam = new Float64Array(nConduits);
  const cRoughness = new Float64Array(nConduits);
  const cLength = new Float64Array(nConduits);
  const cInletNode = new Int32Array(nConduits);
  const cOutletNode = new Int32Array(nConduits);

  let cIdx = 0;
  for (const [id, c] of deck.conduits) {
    conduitIds[cIdx] = id;
    const inNodeIdx = nodeIdxMap.get(c.inletNode);
    const outNodeIdx = nodeIdxMap.get(c.outletNode);
    if (inNodeIdx === undefined || outNodeIdx === undefined) {
      throw new Error(
        `Conduit '${id}' references undefined junction: inlet '${c.inletNode}', outlet '${c.outletNode}'`,
      );
    }
    cInletNode[cIdx] = inNodeIdx;
    cOutletNode[cIdx] = outNodeIdx;

    const xsec = deck.crossSections.get(id);
    cDiam[cIdx] = xsec?.geom1 ?? 1.0;
    cRoughness[cIdx] = Math.max(c.roughness, 0.005);
    cLength[cIdx] = Math.max(c.length, 1.0);
    cIdx++;
  }

  let totalInflow = 0.0;
  let totalOutflow = 0.0;
  let isFlooding = false;

  // Maximum Picard iterations for junction head continuity balance
  const maxIters = 25;
  const omega = 0.5; // Relaxation factor
  const dt = 30.0; // Nominal routing time step (s)

  // Pre-allocated contiguous working arrays for zero-allocation Picard iterations
  const netFlows = new Float64Array(nJunctions);
  const flowDerivs = new Float64Array(nJunctions);

  for (let iter = 0; iter < maxIters; iter++) {
    netFlows.fill(0.0);
    flowDerivs.fill(0.0);

    let maxNetError = 0.0;

    // Evaluate conduit flows
    for (let c = 0; c < nConduits; c++) {
      const inIdx = cInletNode[c]!;
      const outIdx = cOutletNode[c]!;
      const L = cLength[c]!;
      const D = cDiam[c]!;
      const n = cRoughness[c]!;

      const deltaH = heads[inIdx]! - heads[outIdx]!;
      const absDeltaH = Math.max(Math.abs(deltaH), 1e-6);
      const slope = absDeltaH / L;
      const flowSign = deltaH >= 0 ? 1.0 : -1.0;

      // Exact circular geometry with minimum 5% residual flow film
      const inDepth = Math.min(D, Math.max(0.05 * D, depths[inIdx]!));
      const { area, hydRadius } = computeCircularSection(D, inDepth);
      const flow = flowSign * (kManning / n) * area * Math.pow(Math.max(1e-4, hydRadius), 2.0 / 3.0) * Math.sqrt(slope);
      const dqdH = Math.max(1e-4, Math.abs(flow) / (2.0 * absDeltaH));

      if (inIdx < nJunctions) {
        netFlows[inIdx] = (netFlows[inIdx] ?? 0) - flow;
        flowDerivs[inIdx] = (flowDerivs[inIdx] ?? 0) + dqdH;
      }
      if (outIdx < nJunctions) {
        netFlows[outIdx] = (netFlows[outIdx] ?? 0) + flow;
        flowDerivs[outIdx] = (flowDerivs[outIdx] ?? 0) + dqdH;
      }
    }

    // Update junction heads using Newton/Picard step
    const surfArea = 1.13; // Standard 1.2m diameter manhole surface area
    for (let j = 0; j < nJunctions; j++) {
      const netQ = netFlows[j]!;
      const dQdH = flowDerivs[j]! > 0 ? flowDerivs[j]! : 1e-3;
      const absNetQ = Math.abs(netQ);
      if (absNetQ > maxNetError) {
        maxNetError = absNetQ;
      }

      const dH = (netQ / (dQdH + surfArea / dt)) * omega;
      const elev = elevations[j]!;
      const newHead = Math.max(elev, heads[j]! + dH);
      heads[j] = newHead;
      depths[j] = Math.max(initDepths[j]! ? initDepths[j]! * 0.5 : 0.0, newHead - elev);
    }

    if (maxNetError < 1e-4) {
      break;
    }
  }

  // Update node results from final contiguous vectors
  for (let j = 0; j < nJunctions; j++) {
    const id = junctionIds[j]!;
    const node = nodeResults.get(id)!;
    node.head = heads[j]!;
    node.depth = depths[j]!;
  }

  // Compute final conduit hydraulics and check flooding
  for (let c = 0; c < nConduits; c++) {
    const id = conduitIds[c]!;
    const inIdx = cInletNode[c]!;
    const outIdx = cOutletNode[c]!;
    const L = cLength[c]!;
    const D = cDiam[c]!;
    const n = cRoughness[c]!;

    const inNode = nodeResults.get(deck.conduits.get(id)!.inletNode)!;

    const deltaH = heads[inIdx]! - heads[outIdx]!;
    const absDeltaH = Math.max(Math.abs(deltaH), 1e-6);
    const slope = absDeltaH / L;

    const inDepth = Math.min(D, Math.max(0.05 * D, depths[inIdx]!));
    const { area, hydRadius } = computeCircularSection(D, inDepth);
    const flow = Math.max(
      0.0,
      (kManning / n) * area * Math.pow(Math.max(1e-4, hydRadius), 2.0 / 3.0) * Math.sqrt(slope),
    );

    const aFull = (Math.PI * D * D) / 4.0;
    const rFull = D / 4.0;
    const qFull = (kManning / n) * aFull * Math.pow(rFull, 2.0 / 3.0) * Math.sqrt(slope);

    const velocity = area > 0 ? flow / area : 0.0;
    const capFrac = qFull > 0 ? flow / qFull : 0.0;

    const status = capFrac >= 1.0 ? "SURCHARGED" : flow < 1e-4 ? "DRY" : "NORMAL";

    conduitResults.set(id, {
      conduitId: id,
      flowRate: flow,
      velocity,
      depth: inDepth,
      capacityFraction: capFrac,
      status,
    });

    inNode.inflow += flow;
    totalInflow += flow;
    if (outIdx >= nJunctions) {
      totalOutflow += flow;
    }
  }

  // Check surcharge and flooding
  for (const [id, j] of deck.junctions) {
    const res = nodeResults.get(id);
    if (res && res.depth > j.maxDepth) {
      res.overflow = res.depth - j.maxDepth;
      isFlooding = true;
    }
  }

  return {
    conduits: conduitResults,
    nodes: nodeResults,
    totalInflow,
    totalOutflow,
    isFlooding,
  };
}
