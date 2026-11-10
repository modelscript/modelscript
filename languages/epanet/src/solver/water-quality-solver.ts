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

export type WaterQualityParameter =
  | "CHLORINE"
  | "WATER_AGE"
  | "TRACE"
  | "DBP_TTHM"
  | "DBP_HAA5"
  | "CHLORAMINE_NITRIFICATION";

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

  // DBP & Water Chemistry Parameters
  tocMgL?: number | undefined; // Total Organic Carbon, default: 2.5 mg/L
  waterTempCelsius?: number | undefined; // Water temperature, default: 20 °C
  waterPh?: number | undefined; // pH, default: 7.6
  maxTthmThresholdUgL?: number | undefined; // EPA Stage 2 MCL: 80 ug/L, default: 80.0
  maxHaa5ThresholdUgL?: number | undefined; // EPA Stage 2 MCL: 60 ug/L, default: 60.0

  // Chloramine & Nitrification Parameters
  cl2ToNWeightRatio?: number | undefined; // Mass ratio Cl2:N, default: 4.5:1
  freeAmmoniaMgL?: number | undefined; // Free ammonia as N, default: 0.1 mg/L
  nitriteNitrateThresholdMgL?: number | undefined; // Nitrification trigger, default: 0.05 mg/L
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
  violatesDbpStandard?: boolean | undefined;
  nitrificationRisk?: "LOW" | "MODERATE" | "HIGH" | undefined;
}

export interface WaterQualityResult {
  parameter: WaterQualityParameter;
  durationHours: number;
  timeStepMinutes: number;
  nodeProfiles: Map<string, NodeQualityProfile>;
  systemAverageValue: number;
  minSystemResidual: number;
  maxSystemAgeHours: number;
  criticalNodes: string[]; // nodes failing minimum residual, maximum age, or DBP MCL
  maxTthmUgL?: number | undefined;
  maxHaa5UgL?: number | undefined;
  nitrificationAlertNodes?: string[] | undefined;
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
  const toc = options?.tocMgL ?? 2.5;
  const tempC = options?.waterTempCelsius ?? 20.0;
  const ph = options?.waterPh ?? 7.6;
  const maxTthm = options?.maxTthmThresholdUgL ?? 80.0;
  const maxHaa5 = options?.maxHaa5ThresholdUgL ?? 60.0;
  const freeAmm = options?.freeAmmoniaMgL ?? 0.1;

  let sourceQuality = 0.0;
  if (param === "CHLORINE") sourceQuality = options?.sourceQualityMgL ?? 2.0;
  else if (param === "TRACE") sourceQuality = 100.0;
  else if (param === "DBP_TTHM") sourceQuality = 15.0; // ug/L at plant effluent
  else if (param === "DBP_HAA5") sourceQuality = 10.0; // ug/L at plant effluent
  else if (param === "CHLORAMINE_NITRIFICATION") sourceQuality = options?.sourceQualityMgL ?? 3.0; // mg/L monochloramine

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
    } else if (param === "DBP_TTHM") {
      currentConc.set(nid, isSource ? sourceQuality : sourceQuality + 15.0);
    } else if (param === "DBP_HAA5") {
      currentConc.set(nid, isSource ? sourceQuality : sourceQuality + 10.0);
    } else if (param === "CHLORAMINE_NITRIFICATION") {
      currentConc.set(nid, isSource ? sourceQuality : sourceQuality * 0.85);
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
        } else if (param === "DBP_TTHM") {
          const formed = prev + 0.5 * (toc / 2.0) * Math.pow(dtMin / 60.0, 0.35);
          nextConc.set(nid, formed);
          nodeConcentrations.get(nid)!.push(formed);
        } else if (param === "DBP_HAA5") {
          const formed = prev + 0.4 * (toc / 2.0) * Math.pow(dtMin / 60.0, 0.30);
          nextConc.set(nid, formed);
          nodeConcentrations.get(nid)!.push(formed);
        } else if (param === "CHLORAMINE_NITRIFICATION") {
          const decayed = prev * Math.exp(kbPerSec * 1.2 * dtSec);
          nextConc.set(nid, decayed);
          nodeConcentrations.get(nid)!.push(decayed);
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
        } else if (param === "DBP_TTHM") {
          const tH = p.travelTimeSec / 3600.0;
          const deltaTthm = 1.2 * (toc / 2.0) * Math.pow(tempC / 20.0, 0.6) * Math.pow(ph / 7.0, 0.5) * Math.pow(Math.max(0.01, tH), 0.35);
          arrivedConc = fromConc + deltaTthm;
        } else if (param === "DBP_HAA5") {
          const tH = p.travelTimeSec / 3600.0;
          const deltaHaa5 = 0.9 * (toc / 2.0) * Math.pow(tempC / 20.0, 0.5) * Math.pow(Math.max(0.01, tH), 0.30);
          arrivedConc = fromConc + deltaHaa5;
        } else if (param === "CHLORAMINE_NITRIFICATION") {
          const tH = p.travelTimeSec / 3600.0;
          const kEff = (kbPerDay / 24.0) * (tempC / 20.0) * (1.0 + freeAmm / 0.1);
          arrivedConc = fromConc * Math.exp(kEff * tH);
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
        } else if (param === "DBP_TTHM") {
          finalVal += 0.8 * (toc / 2.0) * Math.pow(dtMin / 60.0, 0.35);
        } else if (param === "DBP_HAA5") {
          finalVal += 0.6 * (toc / 2.0) * Math.pow(dtMin / 60.0, 0.30);
        } else if (param === "CHLORAMINE_NITRIFICATION") {
          const kTank = (kbPerDay / 86400.0) * 1.5;
          finalVal *= Math.exp(kTank * dtSec);
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
  const nitAlertNodes: string[] = [];
  let sumAll = 0.0;
  let countAll = 0;
  let minRes = Infinity;
  let maxAgeVal = 0.0;
  let maxTthmVal = 0.0;
  let maxHaa5Val = 0.0;

  for (const [nid, values] of nodeConcentrations) {
    const minVal = Math.min(...values);
    const maxVal = Math.max(...values);
    const avgVal = values.reduce((s, v) => s + v, 0) / values.length;

    sumAll += avgVal;
    countAll++;

    const isResidualViolation = (param === "CHLORINE" || param === "CHLORAMINE_NITRIFICATION") && minVal < minResidual;
    const isAgeViolation = param === "WATER_AGE" && maxVal > maxAge;
    const isTthmViolation = param === "DBP_TTHM" && maxVal > maxTthm;
    const isHaa5Violation = param === "DBP_HAA5" && maxVal > maxHaa5;
    const isDbpViolation = isTthmViolation || isHaa5Violation;

    let nitRisk: "LOW" | "MODERATE" | "HIGH" | undefined = undefined;
    if (param === "CHLORAMINE_NITRIFICATION") {
      if (minVal < 1.0) nitRisk = "HIGH";
      else if (minVal < 1.8) nitRisk = "MODERATE";
      else nitRisk = "LOW";
    }

    if (isResidualViolation || isAgeViolation || isDbpViolation || nitRisk === "HIGH") {
      criticalNodes.push(nid);
    }

    if ((param === "CHLORINE" || param === "CHLORAMINE_NITRIFICATION") && minVal < minRes) minRes = minVal;
    if (param === "WATER_AGE" && maxVal > maxAgeVal) maxAgeVal = maxVal;
    if (param === "DBP_TTHM" && maxVal > maxTthmVal) maxTthmVal = maxVal;
    if (param === "DBP_HAA5" && maxVal > maxHaa5Val) maxHaa5Val = maxVal;
    if (param === "CHLORAMINE_NITRIFICATION" && minVal < 1.5) {
      nitAlertNodes.push(nid);
    }

    nodeProfiles.set(nid, {
      nodeId: nid,
      timeHours: timeHoursList,
      concentrations: values,
      averageValue: avgVal,
      minValue: minVal,
      maxValue: maxVal,
      violatesResidualStandard: isResidualViolation,
      violatesAgeStandard: isAgeViolation,
      violatesDbpStandard: isDbpViolation,
      nitrificationRisk: nitRisk,
    });
  }

  const systemAvg = countAll > 0 ? sumAll / countAll : 0.0;

  let summaryText = "";
  if (param === "CHLORINE") {
    summaryText = `Water Quality Chlorine Simulation: System average residual is ${systemAvg.toFixed(2)} mg/L (Min: ${minRes.toFixed(2)} mg/L). ${criticalNodes.length} node(s) breach the ${minResidual} mg/L minimum EPA disinfectant standard.`;
  } else if (param === "WATER_AGE") {
    summaryText = `Water Age Simulation: System average residence time is ${systemAvg.toFixed(1)} hours (Max: ${maxAgeVal.toFixed(1)} h). ${criticalNodes.length} node(s) exceed the ${maxAge} hour stagnation limit.`;
  } else if (param === "DBP_TTHM") {
    summaryText = `Water Quality DBP Simulation (Stage 2 DBPR): Maximum TTHM is ${maxTthmVal.toFixed(1)} µg/L (EPA MCL: ${maxTthm} µg/L). ${criticalNodes.length} node(s) exceed regulatory threshold.`;
  } else if (param === "DBP_HAA5") {
    summaryText = `Water Quality DBP Simulation (Stage 2 DBPR): Maximum HAA5 is ${maxHaa5Val.toFixed(1)} µg/L (EPA MCL: ${maxHaa5} µg/L). ${criticalNodes.length} node(s) exceed regulatory threshold.`;
  } else if (param === "CHLORAMINE_NITRIFICATION") {
    summaryText = `Chloramine Decay & Nitrification Assessment: System average monochloramine is ${systemAvg.toFixed(2)} mg/L (Min: ${minRes.toFixed(2)} mg/L). ${nitAlertNodes.length} node(s) flagged with elevated nitrification risk.`;
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
    maxTthmUgL: param === "DBP_TTHM" ? maxTthmVal : undefined,
    maxHaa5UgL: param === "DBP_HAA5" ? maxHaa5Val : undefined,
    nitrificationAlertNodes: param === "CHLORAMINE_NITRIFICATION" ? nitAlertNodes : undefined,
    criticalNodes,
    summary: summaryText,
  };
}
