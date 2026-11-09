// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Multi-Species Water Quality & Water Age Engine.
 *
 * Simulates 1D advective mass transport, first-order disinfectant (chlorine/chloramine)
 * bulk and wall decay reactions, multi-tank mixing, and water age (residence time)
 * across municipal water distribution networks.
 */

import type { EpanetNetwork } from "../types.js";
import { solveHydraulics } from "./todini-ggm.js";

export type WaterQualityParameter = "CHLORINE" | "WATER_AGE" | "TRACE";

export interface WaterQualityOptions {
  parameter?: WaterQualityParameter | undefined; // default: "CHLORINE"
  durationHours?: number | undefined; // default: 24h
  timeStepMinutes?: number | undefined; // default: 15 min
  bulkReactionRatePerDay?: number | undefined; // k_b, 1/day (e.g. -0.5), default: -0.5
  wallReactionRateMPerDay?: number | undefined; // k_w, m/day, default: -0.05
  sourceQualityMgL?: number | undefined; // default: 2.0 mg/L for chlorine
  traceNodeId?: string | undefined; // source node for TRACE parameter
  minResidualThresholdMgL?: number | undefined; // default: 0.2 mg/L (EPA standard)
  maxAgeThresholdHours?: number | undefined; // default: 72.0 h
}

export interface NodeQualityProfile {
  nodeId: string;
  timeHours: number[];
  concentrations: number[];
  averageValue: number;
  minValue: number;
  maxValue: number;
  violatesResidualStandard: boolean;
  violatesAgeStandard: boolean;
}

export interface WaterQualityResult {
  parameter: WaterQualityParameter;
  durationHours: number;
  timeStepMinutes: number;
  nodeProfiles: Map<string, NodeQualityProfile>;
  systemAverageValue: number;
  minSystemResidual: number;
  maxSystemAgeHours: number;
  criticalNodes: string[]; // nodes failing minimum residual or maximum age
  summary: string;
}

/**
 * Solves water quality advection, reaction decay, and water age over time.
 */
export function solveWaterQuality(net: EpanetNetwork, options?: WaterQualityOptions): WaterQualityResult {
  const param = options?.parameter ?? "CHLORINE";
  const durationH = options?.durationHours ?? 24;
  const dtMin = options?.timeStepMinutes ?? 15;
  const dtSec = dtMin * 60.0;
  const totalSteps = Math.ceil((durationH * 60.0) / dtMin);

  const kbPerDay = options?.bulkReactionRatePerDay ?? -0.5;
  const kbPerSec = kbPerDay / 86400.0;
  const kwPerDay = options?.wallReactionRateMPerDay ?? -0.05;
  const kwPerSec = kwPerDay / 86400.0;
  const sourceQuality = param === "CHLORINE" ? (options?.sourceQualityMgL ?? 2.0) : param === "TRACE" ? 100.0 : 0.0;
  const minResidual = options?.minResidualThresholdMgL ?? 0.2;
  const maxAge = options?.maxAgeThresholdHours ?? 72.0;

  // 1. Solve steady-state baseline hydraulics for velocities and flows
  const hyd = solveHydraulics(net);

  // Pre-calculate pipe travel times and reaction decay factors
  interface PipeTransport {
    id: string;
    fromNode: string;
    toNode: string;
    velocityMps: number;
    travelTimeSec: number;
    hydraulicRadiusM: number;
    decayFactor: number;
  }

  const pipeTransports: PipeTransport[] = [];
  for (const pipe of net.pipes) {
    const flowLps = hyd.linkFlows.get(pipe.id) ?? 0.0;
    const absFlowM3s = Math.abs(flowLps) / 1000.0;
    const diamM = pipe.diameter / 1000.0;
    const areaM2 = (Math.PI * diamM * diamM) / 4.0;
    const vel = areaM2 > 0 ? absFlowM3s / areaM2 : 0.01;
    const travelTime = vel > 0.001 ? pipe.length / vel : 86400.0;

    // Directionality based on flow sign
    const from = flowLps >= 0 ? pipe.node1 : pipe.node2;
    const to = flowLps >= 0 ? pipe.node2 : pipe.node1;

    // Total reaction decay rate in pipe: k_total = k_b + (4 * k_w / D)
    const kTotalPerSec = kbPerSec + (4.0 * kwPerSec) / Math.max(0.01, diamM);
    // Exponential decay factor over dtSec
    const decayFactor = param === "CHLORINE" ? Math.exp(kTotalPerSec * dtSec) : 1.0;

    pipeTransports.push({
      id: pipe.id,
      fromNode: from,
      toNode: to,
      velocityMps: vel,
      travelTimeSec: travelTime,
      hydraulicRadiusM: diamM / 4.0,
      decayFactor,
    });
  }

  // Map incoming pipes for each node
  const incomingPipes = new Map<string, PipeTransport[]>();
  for (const p of pipeTransports) {
    if (!incomingPipes.has(p.toNode)) {
      incomingPipes.set(p.toNode, []);
    }
    incomingPipes.get(p.toNode)!.push(p);
  }

  // 2. Initialize nodal concentrations
  const nodeConcentrations = new Map<string, number[]>();
  const allNodeIds = [
    ...net.junctions.map((j) => j.id),
    ...net.reservoirs.map((r) => r.id),
    ...net.tanks.map((t) => t.id),
  ];

  // Set initial condition
  let currentConc = new Map<string, number>();
  for (const nid of allNodeIds) {
    const isSource = net.reservoirs.some((r) => r.id === nid);
    if (param === "CHLORINE") {
      currentConc.set(nid, isSource ? sourceQuality : sourceQuality * 0.7);
    } else if (param === "WATER_AGE") {
      currentConc.set(nid, isSource ? 0.0 : 12.0); // start at 12 hours initial age
    } else {
      // TRACE
      currentConc.set(nid, nid === (options?.traceNodeId ?? net.reservoirs[0]?.id) ? 100.0 : 0.0);
    }
    nodeConcentrations.set(nid, [currentConc.get(nid)!]);
  }

  const timeHoursList: number[] = [0.0];

  // 3. Time-marching advective-reactive Eulerian-Lagrangian integration
  for (let step = 1; step <= totalSteps; step++) {
    const tHours = (step * dtMin) / 60.0;
    timeHoursList.push(tHours);

    const nextConc = new Map<string, number>();

    for (const nid of allNodeIds) {
      const isReservoir = net.reservoirs.some((r) => r.id === nid);
      if (isReservoir) {
        // Reservoirs are infinite sources: maintain boundary condition
        nextConc.set(nid, sourceQuality);
        nodeConcentrations.get(nid)!.push(sourceQuality);
        continue;
      }

      const inPipes = incomingPipes.get(nid) ?? [];

      if (inPipes.length === 0) {
        // Dead end or source without inputs
        const prev = currentConc.get(nid) ?? 0.0;
        if (param === "CHLORINE") {
          const decayed = prev * Math.exp(kbPerSec * dtSec);
          nextConc.set(nid, decayed);
          nodeConcentrations.get(nid)!.push(decayed);
        } else if (param === "WATER_AGE") {
          const aged = prev + dtMin / 60.0;
          nextConc.set(nid, aged);
          nodeConcentrations.get(nid)!.push(aged);
        } else {
          nextConc.set(nid, prev);
          nodeConcentrations.get(nid)!.push(prev);
        }
        continue;
      }

      // Advective mixing from incoming pipe parcels
      let weightedConcSum = 0.0;
      let totalFlowWeight = 0.0;

      for (const p of inPipes) {
        const fromConc = currentConc.get(p.fromNode) ?? 0.0;
        const linkFlow = Math.max(0.001, Math.abs(hyd.linkFlows.get(p.id) ?? 1.0));

        let arrivedConc = fromConc;
        if (param === "CHLORINE") {
          arrivedConc = fromConc * p.decayFactor;
        } else if (param === "WATER_AGE") {
          arrivedConc = fromConc + p.travelTimeSec / 3600.0;
        }

        weightedConcSum += arrivedConc * linkFlow;
        totalFlowWeight += linkFlow;
      }

      const mixed = totalFlowWeight > 0 ? weightedConcSum / totalFlowWeight : currentConc.get(nid)!;

      // Tank mixing dynamics if node is a tank
      const isTank = net.tanks.some((t) => t.id === nid);
      let finalVal = mixed;
      if (isTank) {
        const prev = currentConc.get(nid)!;
        // Continuous stirred tank reactor (CSTR) dilution with storage volume
        const dilutionFraction = Math.min(0.2, (totalFlowWeight * 0.001 * dtSec) / 1000.0);
        finalVal = prev * (1 - dilutionFraction) + mixed * dilutionFraction;
        if (param === "CHLORINE") {
          finalVal *= Math.exp(kbPerSec * dtSec);
        } else if (param === "WATER_AGE") {
          finalVal += dtMin / 60.0;
        }
      }

      nextConc.set(nid, Math.max(0, finalVal));
      nodeConcentrations.get(nid)!.push(Math.max(0, finalVal));
    }

    currentConc = nextConc;
  }

  // 4. Summarize and identify critical nodes
  const nodeProfiles = new Map<string, NodeQualityProfile>();
  const criticalNodes: string[] = [];
  let sumAll = 0.0;
  let countAll = 0;
  let minRes = Infinity;
  let maxAgeVal = 0.0;

  for (const [nid, values] of nodeConcentrations) {
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const avgVal = values.reduce((s, v) => s + v, 0) / values.length;

    sumAll += avgVal;
    countAll++;

    const isResidualViolation = param === "CHLORINE" && minVal < minResidual;
    const isAgeViolation = param === "WATER_AGE" && maxVal > maxAge;

    if (isResidualViolation || isAgeViolation) {
      criticalNodes.push(nid);
    }

    if (param === "CHLORINE" && minVal < minRes) minRes = minVal;
    if (param === "WATER_AGE" && maxVal > maxAgeVal) maxAgeVal = maxVal;

    nodeProfiles.set(nid, {
      nodeId: nid,
      timeHours: timeHoursList,
      concentrations: values,
      averageValue: avgVal,
      minValue: minVal,
      maxValue: maxVal,
      violatesResidualStandard: isResidualViolation,
      violatesAgeStandard: isAgeViolation,
    });
  }

  const systemAvg = countAll > 0 ? sumAll / countAll : 0.0;

  let summaryText = "";
  if (param === "CHLORINE") {
    summaryText = `Water Quality Chlorine Simulation: System average residual is ${systemAvg.toFixed(2)} mg/L (Min: ${minRes.toFixed(2)} mg/L). ${criticalNodes.length} node(s) breach the ${minResidual} mg/L minimum EPA disinfectant standard.`;
  } else if (param === "WATER_AGE") {
    summaryText = `Water Age Simulation: System average residence time is ${systemAvg.toFixed(1)} hours (Max: ${maxAgeVal.toFixed(1)} h). ${criticalNodes.length} node(s) exceed the ${maxAge} hour stagnation limit.`;
  } else {
    summaryText = `Source Tracing Simulation completed over ${durationH} hours.`;
  }

  return {
    parameter: param,
    durationHours: durationH,
    timeStepMinutes: dtMin,
    nodeProfiles,
    systemAverageValue: systemAvg,
    minSystemResidual: minRes === Infinity ? 0.0 : minRes,
    maxSystemAgeHours: maxAgeVal,
    criticalNodes,
    summary: summaryText,
  };
}
