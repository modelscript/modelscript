// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/swmm — 1D Open-Channel & Pressurized Hydraulic Flow Routing Solver.
 *
 * Implements Manning's equation and node head continuity balance for open-channel
 * conduits, circular pipes, and outfall boundary stages.
 */

import type { SwmmDeck, SwmmSubcatchment } from "../types.js";

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
  subcatchmentRunoff?: Map<string, number> | undefined;
}

export interface SwmmDynamicWaveStep {
  timeSeconds: number;
  nodeHeads: Record<string, number>;
  nodeDepths: Record<string, number>;
  conduitFlows: Record<string, number>;
  conduitVelocities: Record<string, number>;
  subcatchmentRunoffs: Record<string, number>;
}

export interface SwmmDynamicWaveOptions {
  durationSeconds?: number | undefined; // default 300s
  timeStepSeconds?: number | undefined; // default 5s
  rainfallIntensityMmPerHr?: number | undefined; // default 36 mm/hr (1e-5 m/s)
  infiltrationRateMmPerHr?: number | undefined; // default 5 mm/hr
  surchargeWaveSpeed?: number | undefined; // Preissmann slot acoustic wave speed c_s (m/s, default 25 m/s)
}

export interface SwmmDynamicWaveResult extends SwmmRoutingResult {
  timeSeries: SwmmDynamicWaveStep[];
  peakConduitFlows: Record<string, number>;
  surchargedConduits: string[];
  subcatchmentRunoff: Map<string, number>;
}

/**
 * Computes nonlinear reservoir overland rainfall-runoff from a SWMM subcatchment:
 *   Q_runoff = W * (k_Manning / n) * max(0, d - d_p)^(5/3) * S^(1/2)
 */
export function computeSubcatchmentRunoff(
  subcatchment: SwmmSubcatchment,
  pondedDepth: number,
  options?: {
    depressionStorage?: number | undefined;
    manningN?: number | undefined;
    isUS?: boolean | undefined;
  },
): number {
  const isUS = options?.isUS ?? false;
  const kManning = isUS ? 1.486 : 1.0;

  const impervFrac = Math.max(0.0, Math.min(1.0, subcatchment.impervPct / 100.0));
  const nImperv = subcatchment.nImperv ?? 0.012;
  const nPerv = subcatchment.nPerv ?? 0.1;
  const nEff = Math.max(1e-4, options?.manningN ?? impervFrac * nImperv + (1.0 - impervFrac) * nPerv);

  const dpImperv = (subcatchment.dstoreImperv ?? 1.5) * (isUS ? 1.0 / 12.0 : 0.001);
  const dpPerv = (subcatchment.dstorePerv ?? 5.0) * (isUS ? 1.0 / 12.0 : 0.001);
  const dp = options?.depressionStorage ?? impervFrac * dpImperv + (1.0 - impervFrac) * dpPerv;

  const effectiveDepth = Math.max(0.0, pondedDepth - dp);
  if (effectiveDepth <= 0.0) return 0.0;

  const slope = Math.max(1e-5, subcatchment.slopePct / 100.0);
  const width = Math.max(0.0, subcatchment.width);

  return width * (kManning / nEff) * Math.pow(effectiveDepth, 5.0 / 3.0) * Math.sqrt(slope);
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

/**
 * Computes circular conduit cross-section augmented with a narrow vertical Preissmann slot
 * above the pipe crown (d > 0.98 * D) so pressurized surcharged pipes can be solved seamlessly
 * with the free-surface 1D Saint-Venant equations:
 *   T_slot = g * A_full / c_s^2
 */
export function computePreissmannSection(
  D: number,
  depth: number,
  waveSpeed = 25.0,
): {
  area: number;
  hydRadius: number;
  topWidth: number;
  wettedPerimeter: number;
  isSurcharged: boolean;
} {
  const g = 9.80665;
  const aFull = (Math.PI * D * D) / 4.0;
  const pFull = Math.PI * D;
  const rFull = D / 4.0;
  const cs = Math.max(5.0, waveSpeed);
  const tSlot = Math.max(1e-4 * D, (g * aFull) / (cs * cs));

  if (depth <= 0.0) {
    return { area: 0.0, hydRadius: 0.0, topWidth: tSlot, wettedPerimeter: 0.0, isSurcharged: false };
  }
  if (depth >= D) {
    const surDepth = depth - D;
    return {
      area: aFull + tSlot * surDepth,
      hydRadius: rFull,
      topWidth: tSlot,
      wettedPerimeter: pFull,
      isSurcharged: true,
    };
  }
  const openSec = computeCircularSection(D, depth);
  return {
    area: openSec.area,
    hydRadius: openSec.hydRadius,
    topWidth: Math.max(tSlot, openSec.topWidth),
    wettedPerimeter: openSec.wettedPerimeter,
    isSurcharged: depth >= 0.98 * D,
  };
}

/**
 * Unsteady time-stepping 1D Saint-Venant Dynamic Wave (`DYNWAVE`) solver with Preissmann slot
 * surcharge pressurization and nonlinear reservoir subcatchment rainfall-runoff.
 *
 * Solves:
 *   - Subcatchment overland runoff: Q_runoff = W * (1/n) * (d - d_p)^(5/3) * S^(1/2)
 *   - Conduit 1D Saint-Venant momentum: dQ/dt + d(Q^2/A)/dx + g*A*dH/dx + g*A*S_f = 0
 *   - Nodal continuity with Preissmann slot: A_node * dH/dt = sum(Q_in) - sum(Q_out) + Q_runoff
 */
export function solveSwmmDynamicWave(deck: SwmmDeck, options?: SwmmDynamicWaveOptions): SwmmDynamicWaveResult {
  const isUS = deck.flowUnits === "CFS" || deck.flowUnits === "GPM" || deck.flowUnits === "MGD";
  const kManning = isUS ? 1.486 : 1.0;
  const g = isUS ? 32.174 : 9.80665;

  const duration = options?.durationSeconds ?? 120.0;
  const dt = Math.max(0.1, options?.timeStepSeconds ?? 2.0);
  const nSteps = Math.max(1, Math.round(duration / dt));
  const waveSpeed = options?.surchargeWaveSpeed ?? 25.0;

  // Rainfall and infiltration rates in m/s (or ft/s)
  const rainMmHr = options?.rainfallIntensityMmPerHr ?? 36.0;
  const infilMmHr = options?.infiltrationRateMmPerHr ?? 5.0;
  const netRainRate = Math.max(0.0, (rainMmHr - infilMmHr) / (1000.0 * 3600.0)) * (isUS ? 3.28084 : 1.0);

  const nJunctions = deck.junctions.size;
  const nOutfalls = deck.outfalls.size;
  const totalNodes = nJunctions + nOutfalls;

  const nodeIdxMap = new Map<string, number>();
  const nodeIds: string[] = new Array(totalNodes);
  const elevations = new Float64Array(totalNodes);
  const maxDepths = new Float64Array(totalNodes);
  const surDepths = new Float64Array(totalNodes);
  const pondAreas = new Float64Array(totalNodes);
  const heads = new Float64Array(totalNodes);
  const depths = new Float64Array(totalNodes);

  let jIdx = 0;
  for (const [id, j] of deck.junctions) {
    nodeIdxMap.set(id, jIdx);
    nodeIds[jIdx] = id;
    elevations[jIdx] = j.elevation;
    maxDepths[jIdx] = j.maxDepth > 0 ? j.maxDepth : 2.5;
    surDepths[jIdx] = j.surDepth ?? 0.0;
    pondAreas[jIdx] = j.aPond && j.aPond > 0 ? j.aPond : 1.13;
    const initD = j.initDepth && j.initDepth > 0 ? j.initDepth : maxDepths[jIdx]! * 0.2;
    depths[jIdx] = initD;
    heads[jIdx] = j.elevation + initD;
    jIdx++;
  }

  let oIdx = nJunctions;
  for (const [id, o] of deck.outfalls) {
    nodeIdxMap.set(id, oIdx);
    nodeIds[oIdx] = id;
    elevations[oIdx] = o.elevation;
    maxDepths[oIdx] = 10.0;
    surDepths[oIdx] = 0.0;
    pondAreas[oIdx] = 10.0;
    const stage = o.stage ?? (o.type === "FREE" ? 0.0 : 0.5);
    depths[oIdx] = stage;
    heads[oIdx] = o.elevation + stage;
    oIdx++;
  }

  // Conduits setup
  const nConduits = deck.conduits.size;
  const conduitIds: string[] = new Array(nConduits);
  const cDiam = new Float64Array(nConduits);
  const cRoughness = new Float64Array(nConduits);
  const cLength = new Float64Array(nConduits);
  const cInletNode = new Int32Array(nConduits);
  const cOutletNode = new Int32Array(nConduits);
  const cFlows = new Float64Array(nConduits);
  const cVels = new Float64Array(nConduits);
  const cDepths = new Float64Array(nConduits);
  const cSurcharged = new Uint8Array(nConduits);
  const peakConduitFlows: Record<string, number> = {};

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
    const D = xsec?.geom1 ?? 1.0;
    cDiam[cIdx] = D;
    const n = Math.max(c.roughness, 0.005);
    cRoughness[cIdx] = n;
    const L = Math.max(c.length, 1.0);
    cLength[cIdx] = L;

    // Initialize conduit flow from initial head gradient or initFlow
    const dH0 = heads[inNodeIdx]! - heads[outNodeIdx]!;
    const d0 = Math.max(0.05 * D, 0.5 * (depths[inNodeIdx]! + depths[outNodeIdx]!));
    const sec0 = computePreissmannSection(D, d0, waveSpeed);
    const qManning0 =
      (dH0 >= 0 ? 1.0 : -1.0) *
      (kManning / n) *
      sec0.area *
      Math.pow(Math.max(1e-4, sec0.hydRadius), 2.0 / 3.0) *
      Math.sqrt(Math.max(1e-6, Math.abs(dH0) / L));
    cFlows[cIdx] = c.initFlow && c.initFlow !== 0 ? c.initFlow : qManning0;
    cDepths[cIdx] = d0;
    cVels[cIdx] = sec0.area > 0 ? cFlows[cIdx]! / sec0.area : 0.0;
    peakConduitFlows[id] = Math.abs(cFlows[cIdx]!);
    cIdx++;
  }

  // Subcatchment nonlinear reservoir state
  const subIds = Array.from(deck.subcatchments.keys());
  const subDepths = new Float64Array(subIds.length);
  const subRunoffs = new Float64Array(subIds.length);
  for (let s = 0; s < subIds.length; s++) {
    // Seed initial surface moisture above depression storage so active rainfall immediately generates overland flow
    subDepths[s] = isUS ? 0.015 : 0.004;
  }

  const timeSeries: SwmmDynamicWaveStep[] = [];
  const nodeRunoffInflow = new Float64Array(totalNodes);

  for (let step = 0; step <= nSteps; step++) {
    const t = step * dt;
    nodeRunoffInflow.fill(0.0);

    // 1. Update subcatchment ponded depths & nonlinear reservoir runoff:
    //    Q_runoff = W * (1/n) * (d - d_p)^(5/3) * S^(1/2)
    for (let s = 0; s < subIds.length; s++) {
      const scId = subIds[s]!;
      const sc = deck.subcatchments.get(scId)!;
      // Convert catchment area (ha -> m^2, or acres -> ft^2)
      const areaM2 = Math.max(1.0, sc.area * (isUS ? 43560.0 : 10000.0));
      const qRunoff = computeSubcatchmentRunoff(sc, subDepths[s]!, { isUS });
      subRunoffs[s] = qRunoff;

      const outIdx = nodeIdxMap.get(sc.outlet);
      if (outIdx !== undefined) {
        nodeRunoffInflow[outIdx] = (nodeRunoffInflow[outIdx] ?? 0) + qRunoff;
      }

      if (step < nSteps) {
        const dDepth = (netRainRate - qRunoff / areaM2) * dt;
        subDepths[s] = Math.max(0.0, subDepths[s]! + dDepth);
      }
    }

    // Record snapshot
    const nodeHeadsSnap: Record<string, number> = {};
    const nodeDepthsSnap: Record<string, number> = {};
    for (let i = 0; i < totalNodes; i++) {
      nodeHeadsSnap[nodeIds[i]!] = heads[i]!;
      nodeDepthsSnap[nodeIds[i]!] = depths[i]!;
    }
    const conduitFlowsSnap: Record<string, number> = {};
    const conduitVelsSnap: Record<string, number> = {};
    for (let c = 0; c < nConduits; c++) {
      conduitFlowsSnap[conduitIds[c]!] = cFlows[c]!;
      conduitVelsSnap[conduitIds[c]!] = cVels[c]!;
    }
    const subRunoffSnap: Record<string, number> = {};
    for (let s = 0; s < subIds.length; s++) {
      subRunoffSnap[subIds[s]!] = subRunoffs[s]!;
    }

    timeSeries.push({
      timeSeconds: t,
      nodeHeads: nodeHeadsSnap,
      nodeDepths: nodeDepthsSnap,
      conduitFlows: conduitFlowsSnap,
      conduitVelocities: conduitVelsSnap,
      subcatchmentRunoffs: subRunoffSnap,
    });

    if (step === nSteps) break;

    // 2. Sub-step 1D Saint-Venant momentum & nodal continuity with Preissmann slot
    const nSub = Math.max(1, Math.ceil(dt / 1.0));
    const dtSub = dt / nSub;

    for (let sub = 0; sub < nSub; sub++) {
      const nodeNetQ = new Float64Array(totalNodes);
      const nodeSurfArea = new Float64Array(totalNodes);

      for (let i = 0; i < nJunctions; i++) {
        nodeNetQ[i] = nodeRunoffInflow[i]!;
        nodeSurfArea[i] = pondAreas[i]!;
      }

      // Conduit 1D Saint-Venant momentum update:
      //   dQ/dt + d(Q^2/A)/dx + g*A*dH/dx + g*A*S_f = 0
      for (let c = 0; c < nConduits; c++) {
        const inIdx = cInletNode[c]!;
        const outIdx = cOutletNode[c]!;
        const D = cDiam[c]!;
        const n = cRoughness[c]!;
        const L = cLength[c]!;

        const dIn = Math.max(0.05 * D, depths[inIdx]!);
        const dOut = Math.max(0.05 * D, depths[outIdx]!);
        const dMid = 0.5 * (dIn + dOut);

        const secIn = computePreissmannSection(D, dIn, waveSpeed);
        const secOut = computePreissmannSection(D, dOut, waveSpeed);
        const secMid = computePreissmannSection(D, dMid, waveSpeed);

        if (secMid.isSurcharged || dIn >= D || dOut >= D) {
          cSurcharged[c] = 1;
        }

        const A = Math.max(1e-4, secMid.area);
        const Rh = Math.max(1e-4, secMid.hydRadius);
        const qOld = cFlows[c]!;
        const vOld = qOld / A;

        // Convective inertia term d(Q^2/A)/dx
        const aIn = Math.max(1e-3, secIn.area);
        const aOut = Math.max(1e-3, secOut.area);
        const vIn = qOld / aIn;
        const vOut = qOld / aOut;
        const dConvDx = Math.max(-0.5 * g * A, Math.min(0.5 * g * A, ((vOut - vIn) / L) * qOld));

        // Hydraulic head gradient term -g * A * dH/dx = g * A * (H_in - H_out) / L
        const dH = heads[inIdx]! - heads[outIdx]!;
        const pressureGradTerm = g * A * (dH / L);

        // Semi-implicit Manning friction coefficient: g * n^2 * |v| / (k_M^2 * R_h^(4/3))
        const fricDragCoeff =
          (g * n * n * Math.max(0.05, Math.abs(vOld))) / (kManning * kManning * Math.pow(Rh, 4.0 / 3.0));

        const qNew = (qOld + dtSub * (pressureGradTerm - dConvDx)) / (1.0 + dtSub * fricDragCoeff);
        cFlows[c] = qNew;
        cDepths[c] = dMid;
        cVels[c] = qNew / A;

        const id = conduitIds[c]!;
        if (Math.abs(qNew) > (peakConduitFlows[id] ?? 0)) {
          peakConduitFlows[id] = Math.abs(qNew);
        }

        // Contribute conduit surface width (open-channel top width or Preissmann slot width) to connected nodes
        const halfArea = 0.5 * secMid.topWidth * L;
        nodeSurfArea[inIdx] = (nodeSurfArea[inIdx] ?? 0) + halfArea;
        nodeSurfArea[outIdx] = (nodeSurfArea[outIdx] ?? 0) + halfArea;

        nodeNetQ[inIdx] = (nodeNetQ[inIdx] ?? 0) - qNew;
        nodeNetQ[outIdx] = (nodeNetQ[outIdx] ?? 0) + qNew;
      }

      // Nodal continuity update at junctions: A_node * dH/dt = Q_net
      for (let j = 0; j < nJunctions; j++) {
        const aNode = Math.max(1.13, nodeSurfArea[j]!);
        const dH = (nodeNetQ[j]! * dtSub) / aNode;
        const elev = elevations[j]!;
        const minDepth = deck.junctions.get(nodeIds[j]!)?.initDepth
          ? deck.junctions.get(nodeIds[j]!)!.initDepth! * 0.5
          : 0.02;
        const newDepth = Math.max(minDepth, depths[j]! + dH);
        depths[j] = newDepth;
        heads[j] = elev + newDepth;
      }
    }
  }

  // Build final SwmmRoutingResult compatible summary
  const nodeResults = new Map<string, NodeHydraulicResult>();
  const conduitResults = new Map<string, ConduitFlowResult>();
  const subcatchmentRunoffMap = new Map<string, number>();

  for (let s = 0; s < subIds.length; s++) {
    subcatchmentRunoffMap.set(subIds[s]!, subRunoffs[s]!);
  }

  let isFlooding = false;
  for (let i = 0; i < totalNodes; i++) {
    const id = nodeIds[i]!;
    const depth = depths[i]!;
    const maxCapDepth = maxDepths[i]! + surDepths[i]!;
    const overflow = i < nJunctions && depth > maxCapDepth ? depth - maxCapDepth : 0.0;
    if (overflow > 0) isFlooding = true;
    nodeResults.set(id, {
      nodeId: id,
      head: heads[i]!,
      depth,
      inflow: nodeRunoffInflow[i]!,
      overflow,
    });
  }

  let totalInflow = 0.0;
  let totalOutflow = 0.0;
  const surchargedConduits: string[] = [];

  for (let c = 0; c < nConduits; c++) {
    const id = conduitIds[c]!;
    const inIdx = cInletNode[c]!;
    const outIdx = cOutletNode[c]!;
    const D = cDiam[c]!;
    const n = cRoughness[c]!;
    const L = cLength[c]!;

    const flow = Math.max(0.0, cFlows[c]!);
    const dCond = cDepths[c]!;
    const sec = computePreissmannSection(D, dCond, waveSpeed);

    const slope = Math.max(1e-5, Math.abs(heads[inIdx]! - heads[outIdx]!) / L);
    const aFull = (Math.PI * D * D) / 4.0;
    const rFull = D / 4.0;
    const qFull = (kManning / n) * aFull * Math.pow(rFull, 2.0 / 3.0) * Math.sqrt(slope);

    const capFrac = qFull > 0 ? flow / qFull : 0.0;
    const isSur = cSurcharged[c] === 1 || sec.isSurcharged || capFrac >= 1.0;
    if (isSur) surchargedConduits.push(id);

    const status = isSur ? "SURCHARGED" : flow < 1e-4 ? "DRY" : "NORMAL";
    conduitResults.set(id, {
      conduitId: id,
      flowRate: flow,
      velocity: sec.area > 0 ? flow / sec.area : 0.0,
      depth: Math.min(D, dCond),
      capacityFraction: capFrac,
      status,
    });

    const inNodeRes = nodeResults.get(nodeIds[inIdx]!)!;
    inNodeRes.inflow += flow;
    totalInflow += flow;
    if (outIdx >= nJunctions) {
      totalOutflow += flow;
    }
  }

  return {
    conduits: conduitResults,
    nodes: nodeResults,
    totalInflow,
    totalOutflow,
    isFlooding,
    subcatchmentRunoff: subcatchmentRunoffMap,
    timeSeries,
    peakConduitFlows,
    surchargedConduits,
  };
}

/**
 * Unified hydraulic solver entry point: dispatches to unsteady 1D Saint-Venant Dynamic Wave
 * when `deck.routingModel === "DYNWAVE"` and steady/kinematic routing otherwise.
 */
export function solveSwmmHydraulics(deck: SwmmDeck, options?: SwmmDynamicWaveOptions): SwmmRoutingResult {
  if (deck.routingModel === "DYNWAVE") {
    return solveSwmmDynamicWave(deck, options);
  }
  return routeNetworkFlow(deck);
}

export function routeNetworkFlow(deck: SwmmDeck): SwmmRoutingResult {
  const isUS = deck.flowUnits === "CFS" || deck.flowUnits === "GPM" || deck.flowUnits === "MGD";
  const kManning = isUS ? 1.486 : 1.0;

  const nodeResults = new Map<string, NodeHydraulicResult>();
  const conduitResults = new Map<string, ConduitFlowResult>();
  const subcatchmentRunoff = new Map<string, number>();

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
  const extInflows = new Float64Array(totalNodes);

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

  // Evaluate subcatchment nonlinear reservoir runoff into outlet junctions
  for (const [scId, sc] of deck.subcatchments) {
    const nominalPondedDepth = isUS ? 0.015 : 0.004;
    const qRunoff = computeSubcatchmentRunoff(sc, nominalPondedDepth, { isUS });
    subcatchmentRunoff.set(scId, qRunoff);
    const outIdx = nodeIdxMap.get(sc.outlet);
    if (outIdx !== undefined && outIdx < nJunctions) {
      extInflows[outIdx] = (extInflows[outIdx] ?? 0) + qRunoff;
    }
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
    for (let j = 0; j < nJunctions; j++) {
      netFlows[j] = extInflows[j]!;
      flowDerivs[j] = 0.0;
    }

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

      // Exact circular geometry with Preissmann slot for pressurized surcharge
      const inDepth = Math.max(0.05 * D, depths[inIdx]!);
      const { area, hydRadius } = computePreissmannSection(D, inDepth);
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

    const inDepth = Math.max(0.05 * D, depths[inIdx]!);
    const { area, hydRadius, isSurcharged } = computePreissmannSection(D, inDepth);
    const flow = Math.max(
      0.0,
      (kManning / n) * area * Math.pow(Math.max(1e-4, hydRadius), 2.0 / 3.0) * Math.sqrt(slope),
    );

    const aFull = (Math.PI * D * D) / 4.0;
    const rFull = D / 4.0;
    const qFull = (kManning / n) * aFull * Math.pow(rFull, 2.0 / 3.0) * Math.sqrt(slope);

    const velocity = area > 0 ? flow / area : 0.0;
    const capFrac = qFull > 0 ? flow / qFull : 0.0;

    const status = isSurcharged || capFrac >= 1.0 ? "SURCHARGED" : flow < 1e-4 ? "DRY" : "NORMAL";

    conduitResults.set(id, {
      conduitId: id,
      flowRate: flow,
      velocity,
      depth: Math.min(D, inDepth),
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
    subcatchmentRunoff,
  };
}
