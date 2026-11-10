// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Optical Fiber Plant (OSP) Industrial Benchmark Runner:
 * 144-Strand ANSI/TIA-598-D Metro Optical Ring & NESC Rule 250 Structural Pole Loading
 * with SRLG Physical Disjointness Audit & DAE Arena Lowering.
 */

import { DAEBuilder } from "@modelscript/runtime";
import { resolveStrandColor } from "../src/catalog/tia-598.js";
import { computeNescCableLoading, type AerialCableSpecification } from "../src/structural/nesc-loading.js";
import { evaluatePoleLoading, type PoleSpecification, type PoleAttachmentLoad } from "../src/structural/pole-stress.js";
import { evaluateSrlgDisjointness, type SrlgNetwork, type SrlgPath } from "../src/analysis/srlg-analyzer.js";
import { lowerFiberNetworkToDae, type FiberLinkParams } from "../src/dae/lowering.js";

export interface FiberBenchmarkResult {
  name: string;
  totalStrandCount: number;
  bufferTubeCount: number;
  numRingSpans: number;
  totalRingRouteKm: number;
  isSrlgDisjoint: boolean;
  maxPoleStressRatio: number;
  isPoleLoadingCompliant: boolean;
  minOpticalMarginDb: number;
  maxCatenarySagM: number;
  minGroundClearanceM: number;
  variableCount: number;
  equationCount: number;
  daeLoweringTimeMs: number;
  structuralTimeMs: number;
  totalTimeMs: number;
}

export function runFiberBenchmark(): FiberBenchmarkResult {
  const t0 = performance.now();

  // 1. ANSI/TIA-598-D 144-Strand Color Code Audit (12 tubes x 12 fibers)
  const strandCount = 144;
  const bufferTubeCount = 12;
  for (let s = 1; s <= 144; s++) {
    const info = resolveStrandColor(s, 12);
    if (!info.fiberColor || !info.tubeColor) {
      throw new Error(`Failed to resolve TIA-598 color for strand ${s}`);
    }
  }

  // 2. NESC Rule 250 Heavy Loading & ANSI O5.1 Pole Stress FEA
  const tStruct0 = performance.now();
  const cable: AerialCableSpecification = {
    id: "ADSS-144F",
    name: "144-Fiber ADSS Cable",
    outerDiameterInches: 0.65,
    weightLbsPerFt: 0.15,
    ratedBreakingStrengthLbs: 6000.0,
  };
  const spanLengthFeet = 200.0; // ~60m

  const nescLoad = computeNescCableLoading(cable, "heavy");

  const pole: PoleSpecification = {
    poleId: "METRO-POLE-1",
    species: "southern-yellow-pine",
    poleClass: "3",
    lengthFeet: 45.0,
  };

  const attachments: PoleAttachmentLoad[] = [
    {
      attachmentId: "FIBER-ATT-1",
      description: "144-Strand Metro Ring Attachment",
      heightAboveGroundFeet: 28.0,
      transverseWindForceLbs: nescLoad.transverseWindLoadLbsPerFt * (spanLengthFeet / 2),
      tensionForceLbs: 120.0,
    },
  ];

  const poleAnalysis = evaluatePoleLoading(pole, attachments, {
    grade: "C-elsewhere",
  });
  const structuralTimeMs = performance.now() - tStruct0;

  // 3. Shared Risk Link Group (SRLG) Disjointness Audit (Primary vs Protection Ring)
  const network: SrlgNetwork = {
    nodes: [
      { id: "CO", name: "Central Office" },
      { id: "NODE_1", name: "Node 1" },
      { id: "NODE_2", name: "Node 2" },
      { id: "NODE_3", name: "Node 3" },
    ],
    segments: [
      { segmentId: "S1", fromNodeId: "CO", toNodeId: "NODE_1", cableId: "C1", lengthMeters: 4000, srlgIds: ["DUCT_WEST"] },
      { segmentId: "S2", fromNodeId: "NODE_1", toNodeId: "NODE_2", cableId: "C2", lengthMeters: 3000, srlgIds: ["POLE_WEST"] },
      { segmentId: "S3", fromNodeId: "CO", toNodeId: "NODE_3", cableId: "C3", lengthMeters: 4500, srlgIds: ["DUCT_EAST"] },
      { segmentId: "S4", fromNodeId: "NODE_3", toNodeId: "NODE_2", cableId: "C4", lengthMeters: 3500, srlgIds: ["POLE_EAST"] },
    ],
  };

  const primaryPath: SrlgPath = {
    pathId: "PRIMARY",
    segmentIds: ["S1", "S2"],
    totalLengthMeters: 7000,
    srlgIds: new Set(["DUCT_WEST", "POLE_WEST"]),
  };

  const protectionPath: SrlgPath = {
    pathId: "PROTECTION",
    segmentIds: ["S3", "S4"],
    totalLengthMeters: 8000,
    srlgIds: new Set(["DUCT_EAST", "POLE_EAST"]),
  };

  const srlgResult = evaluateSrlgDisjointness(primaryPath, protectionPath, network);

  // 4. 6-Span Metro Optical Ring Link Budget & Catenary Profile
  const ringSpans: FiberLinkParams[] = [
    {
      id: "Ring_CO_NodeA",
      spanLengthMeters: 4500.0,
      attenuationDbPerKm: 0.19,
      numSplices: 6,
      spliceLossDb: 0.04,
      numConnectors: 2,
      connectorLossDb: 0.2,
      txPowerDbm: 3.0,
      rxSensitivityDbm: -28.0,
      cableWeightNPerM: 1.8,
      horizontalTensionN: 5500.0,
      attachmentHeightM: 8.5,
    },
    {
      id: "Ring_NodeA_NodeB",
      spanLengthMeters: 3800.0,
      attenuationDbPerKm: 0.19,
      numSplices: 4,
      spliceLossDb: 0.04,
      numConnectors: 2,
      connectorLossDb: 0.2,
      txPowerDbm: 3.0,
      rxSensitivityDbm: -28.0,
      cableWeightNPerM: 1.8,
      horizontalTensionN: 5500.0,
      attachmentHeightM: 8.5,
    },
    {
      id: "Ring_NodeB_NodeC",
      spanLengthMeters: 5200.0,
      attenuationDbPerKm: 0.19,
      numSplices: 8,
      spliceLossDb: 0.04,
      numConnectors: 2,
      connectorLossDb: 0.2,
      txPowerDbm: 3.0,
      rxSensitivityDbm: -28.0,
      cableWeightNPerM: 1.8,
      horizontalTensionN: 5500.0,
      attachmentHeightM: 8.5,
    },
    {
      id: "Ring_NodeC_NodeD",
      spanLengthMeters: 4100.0,
      attenuationDbPerKm: 0.19,
      numSplices: 5,
      spliceLossDb: 0.04,
      numConnectors: 2,
      connectorLossDb: 0.2,
      txPowerDbm: 3.0,
      rxSensitivityDbm: -28.0,
      cableWeightNPerM: 1.8,
      horizontalTensionN: 5500.0,
      attachmentHeightM: 8.5,
    },
    {
      id: "Ring_NodeD_NodeE",
      spanLengthMeters: 3200.0,
      attenuationDbPerKm: 0.19,
      numSplices: 4,
      spliceLossDb: 0.04,
      numConnectors: 2,
      connectorLossDb: 0.2,
      txPowerDbm: 3.0,
      rxSensitivityDbm: -28.0,
      cableWeightNPerM: 1.8,
      horizontalTensionN: 5500.0,
      attachmentHeightM: 8.5,
    },
    {
      id: "Ring_NodeE_CO",
      spanLengthMeters: 4900.0,
      attenuationDbPerKm: 0.19,
      numSplices: 7,
      spliceLossDb: 0.04,
      numConnectors: 2,
      connectorLossDb: 0.2,
      txPowerDbm: 3.0,
      rxSensitivityDbm: -28.0,
      cableWeightNPerM: 1.8,
      horizontalTensionN: 5500.0,
      attachmentHeightM: 8.5,
    },
  ];

  let totalRouteM = 0;
  let minMargin = Infinity;
  let maxSag = 0;
  let minClearance = Infinity;

  for (const s of ringSpans) {
    totalRouteM += s.spanLengthMeters;
    const fiberLoss = (s.spanLengthMeters / 1000) * (s.attenuationDbPerKm ?? 0.2);
    const spliceLoss = (s.numSplices ?? 0) * (s.spliceLossDb ?? 0.05);
    const connLoss = (s.numConnectors ?? 0) * (s.connectorLossDb ?? 0.25);
    const totalLoss = fiberLoss + spliceLoss + connLoss;
    const rxP = (s.txPowerDbm ?? 0) - totalLoss;
    const margin = rxP - (s.rxSensitivityDbm ?? -28);
    if (margin < minMargin) minMargin = margin;

    const poleSpanM = 60.0;
    const sag = ((s.cableWeightNPerM ?? 1.5) * Math.pow(poleSpanM, 2)) / (8 * (s.horizontalTensionN ?? 5000));
    const clearance = (s.attachmentHeightM ?? 8.5) - sag;
    if (sag > maxSag) maxSag = sag;
    if (clearance < minClearance) minClearance = clearance;
  }

  // 5. DAE Arena Lowering
  const tDae0 = performance.now();
  const builder = new DAEBuilder();
  const daeResult = lowerFiberNetworkToDae(builder, ringSpans);
  const daeLoweringTimeMs = performance.now() - tDae0;

  const totalTimeMs = performance.now() - t0;

  return {
    name: "144-Strand ANSI/TIA-598-D Metro Optical Ring & NESC Structural Benchmark",
    totalStrandCount: strandCount,
    bufferTubeCount,
    numRingSpans: ringSpans.length,
    totalRingRouteKm: totalRouteM / 1000.0,
    isSrlgDisjoint: srlgResult.isFullyDisjoint,
    maxPoleStressRatio: poleAnalysis.percentPoleLoading / 100.0,
    isPoleLoadingCompliant: poleAnalysis.isCompliant,
    minOpticalMarginDb: minMargin,
    maxCatenarySagM: maxSag,
    minGroundClearanceM: minClearance,
    variableCount: daeResult.totalVariables,
    equationCount: daeResult.totalEquations,
    daeLoweringTimeMs,
    structuralTimeMs,
    totalTimeMs,
  };
}
