// SPDX-License-Identifier: AGPL-3.0-or-later

import { sparseLuSolve } from "@modelscript/runtime";
import type { DssDeck } from "../types.js";
import { buildOpenDssYbus, type OpenDssYbusModel } from "./opendss-ybus-solver.js";

/**
 * Short-circuit fault calculation results for a single distribution bus.
 */
export interface BusFaultResult {
  busName: string;
  baseKv: number;
  theveninR: number; // Thevenin resistance (Ohms)
  theveninX: number; // Thevenin reactance (Ohms)
  theveninZ: number; // Thevenin impedance magnitude (Ohms)
  xrRatio: number; // X/R ratio
  iFault3PhaseAmps: number; // Symmetrical 3-phase fault current (A)
  iFaultSlgAmps: number; // Single-line-to-ground fault current (A)
  iFaultLlAmps: number; // Line-to-line fault current (A)
  shortCircuitMva: number; // 3-phase fault capacity (MVA)
}

/**
 * Comprehensive distribution network short-circuit study result.
 */
export interface FaultStudyResult {
  buses: Map<string, BusFaultResult>;
  maxFaultCurrentAmps: number;
  maxFaultBus: string;
  minFaultCurrentAmps: number;
  minFaultBus: string;
}

/**
 * Options for short-circuit fault study.
 */
export interface FaultStudyOptions {
  /** Fault impedance Z_f = R_f + j X_f in Ohms (default: 0). */
  faultImpedance?: { r: number; x: number };
  /** Pre-calculated Ybus model (optional). */
  model?: OpenDssYbusModel;
}

/**
 * Executes a distribution short-circuit fault study computing Thevenin driving-point impedances
 * and 3-phase, single-line-to-ground (SLG), and line-to-line (LL) fault currents across all buses.
 */
export function solveFaultStudy(deck: DssDeck, options: FaultStudyOptions = {}): FaultStudyResult {
  const model = options.model ?? buildOpenDssYbus(deck);
  const { buses, busBaseKv, nodes, luFactors, nNodes } = model;

  const rFault = options.faultImpedance?.r ?? 0;
  const xFault = options.faultImpedance?.x ?? 0;

  const busResults = new Map<string, BusFaultResult>();
  let maxFaultCurrentAmps = -Infinity;
  let maxFaultBus = "";
  let minFaultCurrentAmps = Infinity;
  let minFaultBus = "";

  const rhs = new Float64Array(2 * nNodes);
  const vSol = new Float64Array(2 * nNodes);

  for (const [busName, nodeIndices] of buses) {
    const baseKv = busBaseKv.get(busName) ?? 12.47;
    const vLn = (baseKv * 1000) / Math.sqrt(3);

    // Pick phase 1 node (or first available node)
    let targetIdx = nodeIndices[0];
    for (const idx of nodeIndices) {
      if (nodes[idx]?.phase === 1) {
        targetIdx = idx;
        break;
      }
    }

    if (targetIdx === undefined) continue;

    // Unit real current injection at target node: I_real = 1.0 A
    rhs.fill(0);
    rhs[targetIdx] = 1.0;

    sparseLuSolve(luFactors, rhs, vSol);

    // Voltage response is column of Z_bus (Thevenin driving-point impedance)
    const theveninR = Math.max(1e-4, Math.abs(vSol[targetIdx] ?? 0));
    const theveninX = Math.max(1e-4, Math.abs(vSol[nNodes + targetIdx] ?? 0));
    const theveninZ = Math.sqrt(theveninR * theveninR + theveninX * theveninX);
    const xrRatio = theveninX / theveninR;

    // Symmetrical 3-Phase Fault Current: I_3P = V_LN / |Z_th + Z_f|
    const rTot3P = theveninR + rFault;
    const xTot3P = theveninX + xFault;
    const zTot3P = Math.sqrt(rTot3P * rTot3P + xTot3P * xTot3P);
    const iFault3PhaseAmps = vLn / Math.max(1e-4, zTot3P);

    // Single-Line-To-Ground (SLG) Fault: I_SLG = 3 * V_LN / |2*Z_1 + Z_0 + 3*Z_f|
    // For distribution feeders, Z_1 ~ Z_th, Z_0 ~ 2.5 * Z_1
    const rTotSlg = 2 * theveninR + 2.5 * theveninR + 3 * rFault;
    const xTotSlg = 2 * theveninX + 2.5 * theveninX + 3 * xFault;
    const zTotSlg = Math.sqrt(rTotSlg * rTotSlg + xTotSlg * xTotSlg);
    const iFaultSlgAmps = (3 * vLn) / Math.max(1e-4, zTotSlg);

    // Line-to-Line (LL) Fault: I_LL = sqrt(3) * V_LN / |2*Z_1 + Z_f|
    const rTotLl = 2 * theveninR + rFault;
    const xTotLl = 2 * theveninX + xFault;
    const zTotLl = Math.sqrt(rTotLl * rTotLl + xTotLl * xTotLl);
    const iFaultLlAmps = (Math.sqrt(3) * vLn) / Math.max(1e-4, zTotLl);

    // Short-Circuit MVA Capacity: S_sc = sqrt(3) * V_LL(kV) * I_3P(kA)
    const shortCircuitMva = (Math.sqrt(3) * baseKv * (iFault3PhaseAmps / 1000)) / 1000;

    if (iFault3PhaseAmps > maxFaultCurrentAmps) {
      maxFaultCurrentAmps = iFault3PhaseAmps;
      maxFaultBus = busName;
    }
    if (iFault3PhaseAmps < minFaultCurrentAmps) {
      minFaultCurrentAmps = iFault3PhaseAmps;
      minFaultBus = busName;
    }

    busResults.set(busName, {
      busName,
      baseKv,
      theveninR,
      theveninX,
      theveninZ,
      xrRatio,
      iFault3PhaseAmps,
      iFaultSlgAmps,
      iFaultLlAmps,
      shortCircuitMva,
    });
  }

  return {
    buses: busResults,
    maxFaultCurrentAmps: isFinite(maxFaultCurrentAmps) ? maxFaultCurrentAmps : 0,
    maxFaultBus,
    minFaultCurrentAmps: isFinite(minFaultCurrentAmps) ? minFaultCurrentAmps : 0,
    minFaultBus,
  };
}
