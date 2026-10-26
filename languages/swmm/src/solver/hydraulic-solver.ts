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

  // Initialize node heads
  for (const [id, j] of deck.junctions) {
    const depth = j.initDepth ?? j.maxDepth * 0.2;
    nodeResults.set(id, {
      nodeId: id,
      head: j.elevation + depth,
      depth,
      inflow: 0.0,
      overflow: 0.0,
    });
  }

  for (const [id, o] of deck.outfalls) {
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    nodeResults.set(id, {
      nodeId: id,
      head: o.elevation + stage,
      depth: stage,
      inflow: 0.0,
      overflow: 0.0,
    });
  }

  let totalInflow = 0.0;
  let totalOutflow = 0.0;
  let isFlooding = false;

  // Maximum Picard iterations for junction head continuity balance
  const maxIters = 25;
  const omega = 0.5; // Relaxation factor
  const dt = 30.0; // Nominal routing time step (s)

  // Pre-allocated maps to eliminate heap allocation during iterations
  const netFlows = new Map<string, number>();
  const flowDerivs = new Map<string, number>();
  for (const [id] of deck.junctions) {
    netFlows.set(id, 0.0);
    flowDerivs.set(id, 0.0);
  }

  for (let iter = 0; iter < maxIters; iter++) {
    // Reset junction net flows without recreating Map objects
    for (const [id] of deck.junctions) {
      netFlows.set(id, 0.0);
      flowDerivs.set(id, 0.0);
    }

    let maxNetError = 0.0;

    // Evaluate conduit flows
    for (const [id, c] of deck.conduits) {
      const xsec = deck.crossSections.get(id);
      const D = xsec?.geom1 ?? 1.0;
      const n = Math.max(c.roughness, 0.005);
      const L = Math.max(c.length, 1.0);

      const inNode = nodeResults.get(c.inletNode);
      const outNode = nodeResults.get(c.outletNode);
      if (!inNode || !outNode) {
        throw new Error(
          `Conduit '${id}' references undefined junction: inlet '${c.inletNode}', outlet '${c.outletNode}'`,
        );
      }

      const deltaH = inNode.head - outNode.head;
      const absDeltaH = Math.max(Math.abs(deltaH), 1e-6);
      const slope = absDeltaH / L;
      const flowSign = deltaH >= 0 ? 1.0 : -1.0;

      // Exact circular geometry with minimum 5% residual flow film
      const inDepth = Math.min(D, Math.max(0.05 * D, inNode.depth));
      const { area, hydRadius } = computeCircularSection(D, inDepth);
      const flow = flowSign * (kManning / n) * area * Math.pow(Math.max(1e-4, hydRadius), 2.0 / 3.0) * Math.sqrt(slope);
      const dqdH = Math.max(1e-4, Math.abs(flow) / (2.0 * absDeltaH));

      if (deck.junctions.has(c.inletNode)) {
        netFlows.set(c.inletNode, (netFlows.get(c.inletNode) ?? 0.0) - flow);
        flowDerivs.set(c.inletNode, (flowDerivs.get(c.inletNode) ?? 0.0) + dqdH);
      }
      if (deck.junctions.has(c.outletNode)) {
        netFlows.set(c.outletNode, (netFlows.get(c.outletNode) ?? 0.0) + flow);
        flowDerivs.set(c.outletNode, (flowDerivs.get(c.outletNode) ?? 0.0) + dqdH);
      }
    }

    // Update junction heads using Newton/Picard step
    for (const [id, j] of deck.junctions) {
      const netQ = netFlows.get(id) ?? 0.0;
      const dQdH = flowDerivs.get(id) ?? 1e-3;
      maxNetError = Math.max(maxNetError, Math.abs(netQ));

      const surfArea = 1.13; // Standard 1.2m diameter manhole surface area
      const dH = (netQ / (dQdH + surfArea / dt)) * omega;
      const node = nodeResults.get(id)!;
      const newHead = Math.max(j.elevation, node.head + dH);
      node.head = newHead;
      node.depth = Math.max(j.initDepth ? j.initDepth * 0.5 : 0.0, newHead - j.elevation);
    }

    if (maxNetError < 1e-4) {
      break;
    }
  }

  // Compute final conduit hydraulics and check flooding
  for (const [id, c] of deck.conduits) {
    const xsec = deck.crossSections.get(id);
    const D = xsec?.geom1 ?? 1.0;
    const n = Math.max(c.roughness, 0.005);
    const L = Math.max(c.length, 1.0);

    const inNode = nodeResults.get(c.inletNode)!;
    const outNode = nodeResults.get(c.outletNode)!;

    const deltaH = inNode.head - outNode.head;
    const absDeltaH = Math.max(Math.abs(deltaH), 1e-6);
    const slope = absDeltaH / L;

    const inDepth = Math.min(D, Math.max(0.05 * D, inNode.depth));
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
    if (deck.outfalls.has(c.outletNode)) {
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
