// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * ModelScript PSCAD Language Definition.
 *
 * Provides declarative grammar, XML AST parsing, pre-flight linter,
 * and polyglot cross-language projections for PSCAD v4/v5 projects.
 */

import { language } from "@modelscript/dsl";
import { emtResultToComtrade, writeComtrade } from "./comtrade/comtrade-writer.js";
import { writePscadOut, type PscadOutResult } from "./comtrade/pscad-out-writer.js";
import { lintPscx } from "./lints/index.js";
import { computeSimulationCoverage, type SimulationCoverage } from "./netlist/coverage.js";
import { extractEmtNetlist, netlistToEmtCircuit } from "./netlist/emt-netlist.js";
import { parsePscx } from "./parser/pscx-parser.js";
import {
  verifyIeee2800Compliance,
  type Ieee2800ComplianceReport,
  type Ieee2800FaultSpec,
} from "./verification/ieee2800.js";

/**
 * Configuration options for executing the end-to-end PSCAD `.pscx` simulation and compliance pipeline.
 */
export interface PscadSimulationPipelineOptions {
  /** Raw XML contents of the `.pscx` or `.pslx` project document. */
  documentText: string;
  /** Whether to execute fixed-step electromagnetic transient (EMT) time-domain simulation. */
  runSimulation?: boolean | undefined;
  /** Whether to serialize the simulated waveforms into IEEE C37.111 COMTRADE `.cfg` and `.dat` strings. */
  exportComtrade?: boolean | undefined;
  /** Whether to serialize the simulated waveforms into PSCAD-style `.inf` and `_NN.out` files. */
  exportOut?: boolean | undefined;
  /** Whether to run automated IEEE 2800-2022 / NERC PRC-029-1 fault ride-through compliance checks. */
  verifyIeee2800?: boolean | undefined;
  /** Optional overrides for the fault event specification evaluated during IEEE 2800-2022 verification. */
  faultSpec?: Partial<Ieee2800FaultSpec> | undefined;
  /** Optional simulation duration override in seconds (defaults to project settings or 0.2s). */
  durationSec?: number | undefined;
  /** Optional simulation fixed time step override in seconds (defaults to project settings or 50us). */
  timeStepSec?: number | undefined;
  /**
   * When true, never fall back to the built-in companion synthesizer (which injects reference
   * sources on unsourced buses and canned IBR currents). Without a `solverRunner` no result is produced.
   */
  strict?: boolean | undefined;
  /** Optional external EMT solver callback (e.g., `@modelscript/simulate` Dommel solver); falls back to built-in companion synthesizer when omitted. */
  solverRunner?:
    | ((
        circuit: ReturnType<typeof netlistToEmtCircuit>,
        options: {
          timeStepSec: number;
          durationSec: number;
          nominalFrequencyHz: number;
          threePhase?: boolean | undefined;
          steadyStateInit?: boolean | undefined;
        },
      ) => {
        time: Float64Array;
        busVoltages: Map<string, Float64Array>;
        busPhaseVoltages?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        branchCurrents: Map<string, Float64Array>;
        branchPhaseCurrents?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        controlSignals?: Map<string, Float64Array> | undefined;
      })
    | undefined;
}

/**
 * Synthesizes a 3-phase companion transient trajectory directly from the extracted EmtNetlist
 * when an external `@modelscript/simulate` `solverRunner` callback is not supplied.
 */
function synthesizeCompanionTrajectory(
  netlist: ReturnType<typeof extractEmtNetlist>,
  timeStepSec: number,
  durationSec: number,
) {
  const nSteps = Math.max(10, Math.min(25000, Math.floor(durationSec / timeStepSec)));
  const time = new Float64Array(nSteps);
  const omega = 2 * Math.PI * (netlist.nominalFrequencyHz || 60.0);

  const busVoltages = new Map<string, Float64Array>();
  const busPhaseVoltages = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();
  const branchCurrents = new Map<string, Float64Array>();
  const branchPhaseCurrents = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();

  for (let k = 0; k < nSteps; k++) {
    time[k] = k * timeStepSec;
  }

  // Index non-ground buses
  const busList: { id: string; baseKv: number; vPeak: number }[] = [];
  const busIdxMap = new Map<string, number>();
  for (const [busId, bus] of netlist.buses) {
    if (busId === "0" || busId === "GND") continue;
    const baseKv = bus.baseKv > 0 ? bus.baseKv : 230.0;
    busIdxMap.set(busId, busList.length);
    busList.push({ id: busId, baseKv, vPeak: baseKv * 1e3 });
    busPhaseVoltages.set(busId, {
      a: new Float64Array(nSteps),
      b: new Float64Array(nSteps),
      c: new Float64Array(nSteps),
    });
  }

  const nBuses = busList.length;
  if (nBuses === 0) {
    return { time, busVoltages, busPhaseVoltages, branchCurrents, branchPhaseCurrents };
  }

  // Build trapezoidal companion branches (RL branches, transmission lines, transformers)
  interface CompanionBranch {
    id: string;
    fromIdx: number; // -1 for ground
    toIdx: number; // -1 for ground
    gEq: number;
    alphaHist: number;
    shuntG: number;
    iHistA: number;
    iHistB: number;
    iHistC: number;
    ia: Float64Array;
    ib: Float64Array;
    ic: Float64Array;
  }

  const companionBranches: CompanionBranch[] = [];
  const addCompanionBranch = (
    id: string,
    fromBus: string,
    toBus: string,
    rOhm: number,
    lHenry: number,
    cFarad: number = 0,
  ) => {
    const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (busIdxMap.get(fromBus) ?? -1);
    const toIdx = toBus === "0" || toBus === "GND" ? -1 : (busIdxMap.get(toBus) ?? -1);
    if (fromIdx === -1 && toIdx === -1) return;

    // Dommel trapezoidal discretization of v = R*i + L*(di/dt):
    // gEq = dt / (2L + R*dt), alphaHist = (2L - R*dt) / (2L + R*dt)
    const R = Math.max(rOhm, 1e-4);
    const L = Math.max(lHenry, 0.0);
    const denom = 2.0 * L + R * timeStepSec;
    const gEq = denom > 1e-12 ? timeStepSec / denom : 1.0 / R;
    const alphaHist = denom > 1e-12 ? (2.0 * L - R * timeStepSec) / denom : 0.0;
    const shuntG = cFarad > 0 ? (2.0 * cFarad) / timeStepSec : 0.0;

    const ia = new Float64Array(nSteps);
    const ib = new Float64Array(nSteps);
    const ic = new Float64Array(nSteps);
    branchCurrents.set(id, ia);
    branchPhaseCurrents.set(id, { a: ia, b: ib, c: ic });

    companionBranches.push({
      id,
      fromIdx,
      toIdx,
      gEq,
      alphaHist,
      shuntG,
      iHistA: 0,
      iHistB: 0,
      iHistC: 0,
      ia,
      ib,
      ic,
    });
  };

  for (const br of (netlist.branches ?? []) as any[]) {
    addCompanionBranch(
      br.id,
      br.fromBus,
      br.toBus,
      br.rOhm || br.r || 0.1,
      br.lHenry || br.lH || 0,
      br.cFarad || br.cF || 0,
    );
  }
  for (const ln of ((netlist as any).lines ?? []) as any[]) {
    addCompanionBranch(ln.id, ln.fromBus, ln.toBus, ln.rTotalOhm || 1.0, ln.lTotalHenry || 0.01, ln.cTotalFarad || 0);
  }
  for (const xf of (netlist.transformers ?? []) as any[]) {
    const baseZ = (xf.primaryKv || 230.0) ** 2 / Math.max(xf.ratedMva || xf.mva || 100.0, 1.0);
    const xOhm = Math.max((xf.leakageXPu || xf.xLeakagePu || 0.1) * baseZ, 0.05);
    const lHenry = xOhm / omega;
    addCompanionBranch(xf.id, xf.primaryBus ?? xf.fromBus, xf.secondaryBus ?? xf.toBus, 0.01 * baseZ, lHenry, 0);
  }

  // Prepare switch trajectories
  const switchStates = (((netlist as any).switches ?? []) as any[]).map((sw: any) => {
    const fromIdx = sw.fromBus === "0" || sw.fromBus === "GND" ? -1 : (busIdxMap.get(sw.fromBus) ?? -1);
    const toIdx = sw.toBus === "0" || sw.toBus === "GND" ? -1 : (busIdxMap.get(sw.toBus) ?? -1);
    const ia = new Float64Array(nSteps);
    const ib = new Float64Array(nSteps);
    const ic = new Float64Array(nSteps);
    branchCurrents.set(sw.id, ia);
    branchPhaseCurrents.set(sw.id, { a: ia, b: ib, c: ic });
    return { sw, fromIdx, toIdx, ia, ib, ic };
  });

  // Prepare IBR / FMU converter state variables (first-order PLL & current loop)
  const fmuStates = (netlist.fmuInstances ?? []).map((fmu) => {
    const busIdx = busIdxMap.get(fmu.busConnection) ?? 0;
    const busKv = netlist.buses.get(fmu.busConnection)?.baseKv ?? (fmu.ratedKv > 0 ? fmu.ratedKv : 230.0);
    const iRatedPeak = ((fmu.ratedMva || 100.0) * 1e6) / (Math.max(0.1, busKv) * 1e3);
    const ia = new Float64Array(nSteps);
    const ib = new Float64Array(nSteps);
    const ic = new Float64Array(nSteps);
    branchCurrents.set(fmu.id, ia);
    branchPhaseCurrents.set(fmu.id, { a: ia, b: ib, c: ic });
    return { fmu, busIdx, iRatedPeak, iqState: 0.0, ia, ib, ic };
  });

  // Map voltage sources to buses (ensure every islanded bus has a Thevenin reference)
  const busSources = new Map<number, { vPeak: number; freqRad: number; phaseRad: number; gSrc: number }[]>();
  for (const src of (netlist.sources ?? []) as any[]) {
    const bIdx = busIdxMap.get(src.bus) ?? 0;
    const rSrc = src.rSourceOhm !== undefined && src.rSourceOhm > 0 ? src.rSourceOhm : 1.5;
    const lSrc = (src.lSourceHenry ?? src.lSourceH ?? 0) > 0 ? (src.lSourceHenry ?? src.lSourceH) : 0.0;
    const zSrc = Math.hypot(rSrc, omega * lSrc);
    const gSrc = 1.0 / Math.max(zSrc, 1e-4);
    const vPeak = (((src.voltageKv ?? src.kv) > 0 ? (src.voltageKv ?? src.kv) : busList[bIdx]!.baseKv) || 230.0) * 1e3;
    const freqRad = 2 * Math.PI * (src.frequencyHz || netlist.nominalFrequencyHz || 60.0);
    const phaseRad = (((src.phaseDeg ?? src.phaseAngleDeg) || 0) * Math.PI) / 180.0;
    const list = busSources.get(bIdx) ?? [];
    list.push({ vPeak, freqRad, phaseRad, gSrc });
    busSources.set(bIdx, list);
  }
  const defaultSrcR =
    netlist.sources?.[0]?.rSourceOhm !== undefined && netlist.sources[0].rSourceOhm > 0
      ? netlist.sources[0].rSourceOhm
      : 1.5;
  for (let i = 0; i < nBuses; i++) {
    if (!busSources.has(i)) {
      // Weak Thevenin reference unless connected via branches to a sourced bus
      const hasBranch = companionBranches.some((b) => b.fromIdx === i || b.toIdx === i);
      const gFallback = hasBranch ? 1e-3 : 1.0 / defaultSrcR;
      busSources.set(i, [{ vPeak: busList[i]!.vPeak, freqRad: omega, phaseRad: 0.0, gSrc: gFallback }]);
    }
  }

  // Dense nodal linear solver for nBuses x nBuses
  const solveNodal = (G: Float64Array, J: Float64Array): Float64Array => {
    if (nBuses === 1) {
      const v = new Float64Array(1);
      v[0] = Math.abs(G[0]!) > 1e-18 ? J[0]! / G[0]! : 0.0;
      return v;
    }
    const A = new Float64Array(G);
    const b = new Float64Array(J);
    for (let p = 0; p < nBuses; p++) {
      let maxRow = p;
      let maxVal = Math.abs(A[p * nBuses + p]!);
      for (let r = p + 1; r < nBuses; r++) {
        const val = Math.abs(A[r * nBuses + p]!);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }
      if (maxVal < 1e-18) continue;
      if (maxRow !== p) {
        for (let c = p; c < nBuses; c++) {
          const tmp = A[p * nBuses + c]!;
          A[p * nBuses + c] = A[maxRow * nBuses + c]!;
          A[maxRow * nBuses + c] = tmp;
        }
        const tmpB = b[p]!;
        b[p] = b[maxRow]!;
        b[maxRow] = tmpB;
      }
      const pivot = A[p * nBuses + p]!;
      for (let r = p + 1; r < nBuses; r++) {
        const factor = A[r * nBuses + p]! / pivot;
        if (factor === 0) continue;
        for (let c = p + 1; c < nBuses; c++) {
          A[r * nBuses + c] = A[r * nBuses + c]! - factor * A[p * nBuses + c]!;
        }
        b[r] = b[r]! - factor * b[p]!;
      }
    }
    const x = new Float64Array(nBuses);
    for (let r = nBuses - 1; r >= 0; r--) {
      let s = b[r]!;
      for (let c = r + 1; c < nBuses; c++) {
        s -= A[r * nBuses + c]! * x[c]!;
      }
      const d = A[r * nBuses + r]!;
      x[r] = Math.abs(d) > 1e-18 ? s / d : 0.0;
    }
    return x;
  };

  // Time-domain trapezoidal companion integration loop
  for (let k = 0; k < nSteps; k++) {
    const t = time[k]!;
    const Ga = new Float64Array(nBuses * nBuses);
    const Gb = new Float64Array(nBuses * nBuses);
    const Gc = new Float64Array(nBuses * nBuses);
    const Ja = new Float64Array(nBuses);
    const Jb = new Float64Array(nBuses);
    const Jc = new Float64Array(nBuses);

    const stampAdmittance = (G: Float64Array, i: number, j: number, g: number) => {
      if (i >= 0) G[i * nBuses + i] = G[i * nBuses + i]! + g;
      if (j >= 0) G[j * nBuses + j] = G[j * nBuses + j]! + g;
      if (i >= 0 && j >= 0) {
        G[i * nBuses + j] = G[i * nBuses + j]! - g;
        G[j * nBuses + i] = G[j * nBuses + i]! - g;
      }
    };

    // 1. Stamp Norton voltage sources
    for (const [bIdx, srcs] of busSources.entries()) {
      for (const s of srcs) {
        Ga[bIdx * nBuses + bIdx] = Ga[bIdx * nBuses + bIdx]! + s.gSrc;
        Gb[bIdx * nBuses + bIdx] = Gb[bIdx * nBuses + bIdx]! + s.gSrc;
        Gc[bIdx * nBuses + bIdx] = Gc[bIdx * nBuses + bIdx]! + s.gSrc;
        const ea = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad);
        const eb = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad - (2 * Math.PI) / 3);
        const ec = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad + (2 * Math.PI) / 3);
        Ja[bIdx] = Ja[bIdx]! + s.gSrc * ea;
        Jb[bIdx] = Jb[bIdx]! + s.gSrc * eb;
        Jc[bIdx] = Jc[bIdx]! + s.gSrc * ec;
      }
    }

    // 2. Stamp Dommel companion branches and inject history currents
    for (const br of companionBranches) {
      const gTotal = br.gEq + 0.5 * br.shuntG;
      stampAdmittance(Ga, br.fromIdx, br.toIdx, gTotal);
      stampAdmittance(Gb, br.fromIdx, br.toIdx, gTotal);
      stampAdmittance(Gc, br.fromIdx, br.toIdx, gTotal);
      if (br.fromIdx >= 0) {
        Ja[br.fromIdx] = Ja[br.fromIdx]! - br.iHistA;
        Jb[br.fromIdx] = Jb[br.fromIdx]! - br.iHistB;
        Jc[br.fromIdx] = Jc[br.fromIdx]! - br.iHistC;
      }
      if (br.toIdx >= 0) {
        Ja[br.toIdx] = Ja[br.toIdx]! + br.iHistA;
        Jb[br.toIdx] = Jb[br.toIdx]! + br.iHistB;
        Jc[br.toIdx] = Jc[br.toIdx]! + br.iHistC;
      }
    }

    // 3. Stamp timed switches/breakers
    for (const swState of switchStates) {
      const { sw, fromIdx, toIdx } = swState;
      const isClosed = t >= sw.actionTimeSec ? !sw.initialClosed : sw.initialClosed;
      const rSw = isClosed ? Math.max(sw.rClosedOhm || 1e-3, 1e-4) : Math.max(sw.rOpenOhm || 1e6, 1e3);
      const gSw = 1.0 / rSw;
      stampAdmittance(Ga, fromIdx, toIdx, gSw);
      stampAdmittance(Gb, fromIdx, toIdx, gSw);
      stampAdmittance(Gc, fromIdx, toIdx, gSw);
    }

    // 4. Stamp active faults
    let anyFaultActive = false;
    for (const flt of netlist.faults ?? []) {
      if (t >= flt.startSec && t <= flt.endSec) {
        anyFaultActive = true;
        const bIdx = busIdxMap.get(flt.bus) ?? 0;
        const rFlt = flt.rFaultOhm !== undefined && flt.rFaultOhm > 0 ? flt.rFaultOhm : 0.5;
        const gFlt = 1.0 / rFlt;
        if (flt.faultType === "3PH") {
          Ga[bIdx * nBuses + bIdx] = Ga[bIdx * nBuses + bIdx]! + gFlt;
          Gb[bIdx * nBuses + bIdx] = Gb[bIdx * nBuses + bIdx]! + gFlt;
          Gc[bIdx * nBuses + bIdx] = Gc[bIdx * nBuses + bIdx]! + gFlt;
        } else if (flt.faultType === "SLG") {
          Ga[bIdx * nBuses + bIdx] = Ga[bIdx * nBuses + bIdx]! + gFlt;
          // Zero-sequence ground return coupling on unfaulted phases
          Gb[bIdx * nBuses + bIdx] = Gb[bIdx * nBuses + bIdx]! + (1.0 / defaultSrcR) * (0.15 / 0.85);
          Gc[bIdx * nBuses + bIdx] = Gc[bIdx * nBuses + bIdx]! + (1.0 / defaultSrcR) * (0.1 / 0.9);
        } else if (flt.faultType === "DLG") {
          Ga[bIdx * nBuses + bIdx] = Ga[bIdx * nBuses + bIdx]! + gFlt;
          Gb[bIdx * nBuses + bIdx] = Gb[bIdx * nBuses + bIdx]! + gFlt;
          Gc[bIdx * nBuses + bIdx] = Gc[bIdx * nBuses + bIdx]! + (1.0 / defaultSrcR) * (0.1 / 0.9);
        } else {
          // LL fault
          Gb[bIdx * nBuses + bIdx] = Gb[bIdx * nBuses + bIdx]! + gFlt;
          Gc[bIdx * nBuses + bIdx] = Gc[bIdx * nBuses + bIdx]! + gFlt;
        }
      }
    }

    // 5. Solve 3-phase nodal voltages at step k
    const vaStep = solveNodal(Ga, Ja);
    const vbStep = solveNodal(Gb, Jb);
    const vcStep = solveNodal(Gc, Jc);

    for (let i = 0; i < nBuses; i++) {
      const busId = busList[i]!.id;
      const pv = busPhaseVoltages.get(busId)!;
      pv.a[k] = vaStep[i]!;
      pv.b[k] = vbStep[i]!;
      pv.c[k] = vcStep[i]!;
    }

    // 6. Update companion RL branch currents and Dommel history currents
    for (const br of companionBranches) {
      const vFromA = br.fromIdx >= 0 ? vaStep[br.fromIdx]! : 0.0;
      const vToA = br.toIdx >= 0 ? vaStep[br.toIdx]! : 0.0;
      const dvA = vFromA - vToA;
      const curA = br.gEq * dvA + br.iHistA;
      br.ia[k] = curA;
      br.iHistA = br.alphaHist * curA + br.gEq * dvA;

      const vFromB = br.fromIdx >= 0 ? vbStep[br.fromIdx]! : 0.0;
      const vToB = br.toIdx >= 0 ? vbStep[br.toIdx]! : 0.0;
      const dvB = vFromB - vToB;
      const curB = br.gEq * dvB + br.iHistB;
      br.ib[k] = curB;
      br.iHistB = br.alphaHist * curB + br.gEq * dvB;

      const vFromC = br.fromIdx >= 0 ? vcStep[br.fromIdx]! : 0.0;
      const vToC = br.toIdx >= 0 ? vcStep[br.toIdx]! : 0.0;
      const dvC = vFromC - vToC;
      const curC = br.gEq * dvC + br.iHistC;
      br.ic[k] = curC;
      br.iHistC = br.alphaHist * curC + br.gEq * dvC;
    }

    // 7. Update switch currents
    for (const swState of switchStates) {
      const { sw, fromIdx, toIdx, ia, ib, ic } = swState;
      const isClosed = t >= sw.actionTimeSec ? !sw.initialClosed : sw.initialClosed;
      const rSw = isClosed ? Math.max(sw.rClosedOhm || 1e-3, 1e-4) : Math.max(sw.rOpenOhm || 1e6, 1e3);
      const gSw = 1.0 / rSw;
      ia[k] = gSw * ((fromIdx >= 0 ? vaStep[fromIdx]! : 0) - (toIdx >= 0 ? vaStep[toIdx]! : 0));
      ib[k] = gSw * ((fromIdx >= 0 ? vbStep[fromIdx]! : 0) - (toIdx >= 0 ? vbStep[toIdx]! : 0));
      ic[k] = gSw * ((fromIdx >= 0 ? vcStep[fromIdx]! : 0) - (toIdx >= 0 ? vcStep[toIdx]! : 0));
    }

    // 8. Update IBR / FMU converter current injection based on solved bus voltage envelope
    const tauLvrt = 0.008;
    const alphaLvrt = 1.0 - Math.exp(-timeStepSec / tauLvrt);
    for (const fmuState of fmuStates) {
      const { busIdx, iRatedPeak, ia, ib, ic } = fmuState;
      const vNomPeak = busList[busIdx]!.vPeak;
      const vaInst = vaStep[busIdx]!;
      const vbInst = vbStep[busIdx]!;
      const vcInst = vcStep[busIdx]!;
      // Clarke/Park instantaneous 3-phase voltage envelope
      const vEnv = Math.sqrt((2.0 / 3.0) * (vaInst * vaInst + vbInst * vbInst + vcInst * vcInst));
      const vPu = vNomPeak > 0 ? vEnv / vNomPeak : 1.0;

      const isVoltageDip = anyFaultActive || vPu < 0.9;
      const iqTarget = isVoltageDip ? 0.85 * iRatedPeak : 0.0;
      fmuState.iqState = isVoltageDip ? fmuState.iqState + alphaLvrt * (iqTarget - fmuState.iqState) : 0.0;
      const id = isVoltageDip ? 0.35 * iRatedPeak : 0.7 * iRatedPeak;
      const iq = fmuState.iqState;

      ia[k] = id * Math.sin(omega * t) - iq * Math.cos(omega * t);
      ib[k] = id * Math.sin(omega * t - (2 * Math.PI) / 3) - iq * Math.cos(omega * t - (2 * Math.PI) / 3);
      ic[k] = id * Math.sin(omega * t + (2 * Math.PI) / 3) - iq * Math.cos(omega * t + (2 * Math.PI) / 3);
    }
  }

  for (const b of busList) {
    busVoltages.set(b.id, busPhaseVoltages.get(b.id)!.a);
  }

  return {
    time,
    busVoltages,
    busPhaseVoltages,
    branchCurrents,
    branchPhaseCurrents,
  };
}

/**
 * Executes the turnkey PSCAD `.pscx` parsing, pre-flight linting, EMT simulation,
 * IEEE C37.111 COMTRADE export, and IEEE 2800-2022 compliance verification pipeline.
 */
export function runPscadSimulationPipeline(options: PscadSimulationPipelineOptions) {
  const project = parsePscx(options.documentText);
  const netlist = extractEmtNetlist(project);
  const circuit = netlistToEmtCircuit(netlist);
  const diagnostics = lintPscx(project);
  const coverage = computeSimulationCoverage(project, netlist);
  const simulationReport: PscadSimulationReport = {
    solver: "none",
    coverage,
    injectedReferenceBuses: [],
    synthesizedIbr: false,
  };
  if (coverage.simulatable > 0 && coverage.ratio < 0.9) {
    const top = coverage.dropped
      .slice(0, 5)
      .map((d) => `${d.definition} (${d.count})`)
      .join(", ");
    diagnostics.push({
      code: "P6100",
      rule: "emt-netlist-coverage",
      severity: "warning",
      message: `Only ${coverage.lowered} of ${coverage.simulatable} simulatable components are supported by the EMT netlist; unsupported: ${top}.`,
    });
  }

  if (netlist.assumptions && netlist.assumptions.length > 0) {
    diagnostics.push({
      code: "P6103",
      rule: "emt-assumed-parameters",
      severity: "warning",
      message: `${netlist.assumptions.length} parameter default(s) were assumed: ${netlist.assumptions[0]}${netlist.assumptions.length > 1 ? " (and more)" : ""}`,
    });
  }

  const timeStepSec =
    typeof options.timeStepSec === "number" && options.timeStepSec > 0
      ? options.timeStepSec
      : Math.max(1e-6, (project.settings.timeStepUs || 50.0) * 1e-6);
  const durationSec =
    typeof options.durationSec === "number" && options.durationSec > 0
      ? options.durationSec
      : Math.max(timeStepSec * 10, project.settings.durationSec || 0.2);
  const shouldRunSim =
    Boolean(options.runSimulation) ||
    Boolean(options.solverRunner) ||
    Boolean(options.exportComtrade) ||
    Boolean(options.verifyIeee2800);

  let simulationResult:
    | {
        time: Float64Array;
        busVoltages: Map<string, Float64Array>;
        busPhaseVoltages?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        branchCurrents: Map<string, Float64Array>;
        branchPhaseCurrents?: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }> | undefined;
        controlSignals?: Map<string, Float64Array> | undefined;
      }
    | undefined;

  if (shouldRunSim) {
    if (options.solverRunner) {
      simulationReport.solver = "external";
      simulationResult = options.solverRunner(circuit, {
        timeStepSec,
        durationSec,
        nominalFrequencyHz: netlist.nominalFrequencyHz || 60.0,
        threePhase: true,
        steadyStateInit: true,
      });
    } else if (options.strict) {
      diagnostics.push({
        code: "P6101",
        rule: "emt-no-solver",
        severity: "error",
        message: "Strict simulation requested but no EMT solver was supplied.",
      });
    } else {
      simulationReport.solver = "builtin-companion";
      const sourced = new Set(((netlist.sources ?? []) as { bus?: string }[]).map((s) => s.bus));
      simulationReport.injectedReferenceBuses = Array.from(netlist.buses.keys()).filter((b) => !sourced.has(b));
      simulationReport.synthesizedIbr = (netlist.fmuInstances ?? []).length > 0;
      simulationResult = synthesizeCompanionTrajectory(netlist, timeStepSec, durationSec);
      if (simulationReport.injectedReferenceBuses.length > 0 || simulationReport.synthesizedIbr) {
        diagnostics.push({
          code: "P6102",
          rule: "emt-synthetic-fallback",
          severity: "warning",
          message:
            `Built-in companion fallback used: injected reference sources on ${simulationReport.injectedReferenceBuses.length} unsourced bus(es)` +
            (simulationReport.synthesizedIbr ? " and approximated IBR currents" : "") +
            "; results are not a faithful EMT simulation.",
        });
      }
    }
  }

  let comtrade: { cfg: string; dat: string } | undefined;
  if (simulationResult && (options.exportComtrade ?? true)) {
    const record = emtResultToComtrade(simulationResult, project.name, "MSX_EMT");
    comtrade = writeComtrade(record);
  }

  let pscadOut: PscadOutResult | undefined;
  if (simulationResult && (options.exportOut ?? true)) {
    pscadOut = writePscadOut(simulationResult, project.name);
  }

  let complianceReport: Ieee2800ComplianceReport | undefined;
  if (simulationResult && (options.verifyIeee2800 || netlist.fmuInstances.length > 0)) {
    const fmu = netlist.fmuInstances[0];
    const poiBusId =
      fmu?.busConnection ?? netlist.faults?.[0]?.bus ?? Array.from(simulationResult.busVoltages.keys())[0];
    const vPoi = poiBusId ? simulationResult.busVoltages.get(poiBusId) : undefined;
    const iIbr =
      (fmu ? simulationResult.branchCurrents.get(fmu.id) : undefined) ??
      Array.from(simulationResult.branchCurrents.values())[0];

    if (vPoi && iIbr) {
      const busBaseKv = (poiBusId ? netlist.buses.get(poiBusId)?.baseKv : undefined) ?? fmu?.ratedKv ?? 230.0;
      const netFault = netlist.faults?.[0];
      const spec: Ieee2800FaultSpec = {
        faultStartSec: options.faultSpec?.faultStartSec ?? netFault?.startSec ?? 0.05,
        faultDurationSec:
          options.faultSpec?.faultDurationSec ?? (netFault ? Math.max(0.01, netFault.endSec - netFault.startSec) : 0.1),
        vPreFaultKv: options.faultSpec?.vPreFaultKv ?? busBaseKv,
        vFaultKv: options.faultSpec?.vFaultKv ?? 0.25 * busBaseKv,
        ratedCurrentAmp: options.faultSpec?.ratedCurrentAmp,
        minK1Gain: options.faultSpec?.minK1Gain,
        minK2Gain: options.faultSpec?.minK2Gain,
        evaluateExtendedClauses: options.faultSpec?.evaluateExtendedClauses,
      };
      complianceReport = verifyIeee2800Compliance(
        project.name,
        netlist,
        {
          time: simulationResult.time,
          vPoi,
          iIbr,
          vPoiAbc: poiBusId ? simulationResult.busPhaseVoltages?.get(poiBusId) : undefined,
          iIbrAbc: fmu ? simulationResult.branchPhaseCurrents?.get(fmu.id) : undefined,
        },
        spec,
      );
    }
  }

  return {
    project: project.name,
    settings: project.settings,
    netlist,
    circuit,
    diagnostics,
    simulationResult,
    comtrade,
    pscadOut,
    complianceReport,
    simulationReport,
  };
}

/** Describes how a PSCAD simulation result was obtained and how much of the model it reflects. */
export interface PscadSimulationReport {
  solver: "external" | "builtin-companion" | "none";
  coverage: SimulationCoverage;
  /** Buses that received a fabricated Thevenin reference source in the companion fallback. */
  injectedReferenceBuses: string[];
  /** Whether IBR/FMU currents were approximated by the fallback's canned LVRT model. */
  synthesizedIbr: boolean;
}

/**
 * Declarative ModelScript language definition for PSCAD (`.pscx`, `.pslx`, `.pswx`, `.psmx`) projects,
 * registering LSP capabilities and IDE/MCP actions for pre-flight linting, schematic inspection, and hybrid EMT simulation.
 */
export const pscadLanguage = language({
  name: "pscad",
  fileExtensions: [".pscx", ".pslx", ".pswx", ".psmx"],
  lsp: {
    fileExtensions: [".pscx", ".pslx", ".pswx", ".psmx"],
    icons: {
      light: "./assets/pscad/icon-light.png",
      dark: "./assets/pscad/icon-dark.png",
    },
  },
  rules: {
    Root: () => "pscad",
  },

  actions: [
    {
      id: "lint_pscad_project",
      title: "Lint PSCAD Project",
      description: "Performs pre-flight electrical topology and parameter bounds checks.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(check)",
          group: "navigation@0",
        },
        explorerContextMenu: {
          group: "modelscript_run@0",
        },
        languageModelTool: {
          name: "pscad_lint",
          displayName: "Lint PSCAD Project",
          modelDescription: "Lints PSCAD project for floating nodes and parameter errors.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return [];
        const project = parsePscx(text);
        return lintPscx(project);
      },
    },
    {
      id: "inspect_pscad_schematic",
      title: "Inspect Power System Schematic",
      description: "Opens interactive Single-Line Diagram (SLD) and 3-phase schematic visualizer.",
      category: "query",
      ui: {
        editorTitle: {
          icon: "$(circuit-board)",
          group: "navigation@1",
        },
        explorerContextMenu: {
          group: "modelscript_run@1",
        },
        languageModelTool: {
          name: "pscad_inspect_schematic",
          displayName: "Inspect PSCAD Schematic",
          modelDescription: "Inspects PSCAD components, buses, and wiring topology.",
        },
      },
      execute: async (ctx: any, params: { documentText?: string | undefined }) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        const project = parsePscx(text);
        return extractEmtNetlist(project);
      },
    },
    {
      id: "simulate_hybrid_emt",
      title: "Launch Hybrid EMT Simulation",
      description: "Launches high-speed WebAssembly Dommel companion solver with black-box FMU co-simulation.",
      category: "simulate",
      ui: {
        editorTitle: {
          icon: "$(play)",
          group: "navigation@2",
        },
        explorerContextMenu: {
          group: "modelscript_run@2",
        },
        languageModelTool: {
          name: "pscad_simulate_emt",
          displayName: "Simulate Hybrid EMT",
          modelDescription: "Executes fixed-step companion circuit EMT simulation.",
        },
      },
      execute: async (ctx: any, params?: Partial<PscadSimulationPipelineOptions>) => {
        const text = params?.documentText ?? ctx?.documentText;
        if (!text) return null;
        return runPscadSimulationPipeline({
          runSimulation: true,
          ...params,
          documentText: text,
          solverRunner: params?.solverRunner ?? ctx?.solverRunner,
        });
      },
    },
  ],
});
