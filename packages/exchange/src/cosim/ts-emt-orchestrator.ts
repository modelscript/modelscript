// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/exchange — Automated Concurrent Multi-Plant TS-EMT Dynamic Hybrid Co-Simulation Orchestrator
 *
 * Couples positive-sequence electro-mechanical Transient Stability (TS) simulation
 * (macro-step Delta t_TS = 1-5 ms) with multiple concurrent instantaneous 3-phase
 * Electromagnetic Transient (EMT) simulation plants (sub-step Delta t_EMT = 20-50 us)
 * across arbitrary physical boundary buses.
 *
 * Multi-Plant Concurrent Interface Coupling:
 * - EMT -> TS: Sliding-window fundamental-frequency Discrete Fourier Transform (DFT)
 *   computes instantaneous boundary current phasors from each EMT plant, converts them
 *   via symmetrical components into positive-sequence current I_1, and aggregates
 *   multi-port boundary current injections at each TS boundary bus:
 *   I_TS,b(t) = Sum_{k in Plants, p in Ports(k, b)} I_inj,k,p(t).
 * - TS -> EMT: Symmetrical component positive-sequence voltage phasor V_1(b) is transformed
 *   into instantaneous 3-phase Thévenin voltage sources per plant with selectable
 *   linear or quadratic polynomial extrapolation across macro-intervals.
 * - Multi-Worker & WebGPU concurrency: Evaluates K >= 1 EMT plant instances simultaneously
 *   via Promise.all asynchronous worker pools.
 */

import { FdneDommelCompanion, fitFdneFromRlThevenin, fitFdneRational } from "./fdne-fitter.js";
import { EmtFmuParticipant } from "./participants/emt-fmu-participant.js";
import { PhasorFmuParticipant } from "./participants/phasor-fmu-participant.js";
import type {
  ComplexPhasor,
  EmtBoundaryFeedSpec,
  EmtNetworkParticipant,
  EmtTrajectoryResult,
  MultiPortBoundaryEquivalent,
  PhasorBoundaryBusVoltage,
  PhasorBoundaryInjection,
  PhasorEmtBoundaryPort,
  PhasorNetworkParticipant,
  PhasorTrajectoryResult,
  SequencePhasors,
  ThreePhaseValues,
} from "./phasor-emt-types.js";

export interface TsEmtBoundaryPortConfig {
  /** PSS/E bus number in the bulk transmission network. */
  psseBusNumber: number;
  /** PSCAD bus ID / node name in the local EMT sub-network. */
  pscadBusId: string;
  /** Nominal line-to-line voltage in kV (default: 230.0). */
  baseKvLL?: number | undefined;
  /** Base power in MVA (default: 100.0). */
  baseMva?: number | undefined;
  /** Thévenin source conductance in Siemens (default: 20.0 S = 0.05 Ohm). */
  theveninConductanceSiemens?: number | undefined;
}

export interface TsEmtCoSimOptions {
  /** Total co-simulation duration in seconds (default: 1.0). */
  durationSec?: number | undefined;
  /** PSS/E macro-step size in seconds (default: 0.005 s = 5 ms). */
  dtTsSec?: number | undefined;
  /** PSCAD EMT sub-step size in seconds (default: 50e-6 s = 50 us). */
  dtEmtSec?: number | undefined;
  /** Fundamental power frequency in Hz (default: 60.0). */
  frequencyHz?: number | undefined;
  /** Boundary port configurations mapping TS buses to EMT buses. */
  boundaryPorts: TsEmtBoundaryPortConfig[];
  /** Optional temporary balanced 3-phase fault applied on a TS bus. */
  fault?:
    | {
        busNumber: number;
        startSec: number;
        clearSec: number;
        susceptancePu?: number | undefined;
      }
    | undefined;
}

export interface TsEmtMacroRecord {
  timeSec: number;
  psseBusNumber: number;
  pscadBusId: string;
  vTsMagPu: number;
  vTsAngleDeg: number;
  vEmtPeakKv: number;
  iEmtInjAmpRms: number;
  iTsInjPuRe: number;
  iTsInjPuIm: number;
}

export interface TsEmtCoSimResult {
  macroRecords: TsEmtMacroRecord[];
  totalMacroSteps: number;
  totalEmtSubSteps: number;
  ratioM: number;
  wallClockTimeMs: number;
  tsTrajectory: {
    t: number[];
    states: string[];
    y: number[][];
    summary: {
      convergedPowerFlow: boolean;
      stable: boolean;
      maxRotorAngleSpreadDeg: number;
    };
  };
  emtTrajectory: {
    time: Float64Array;
    busPhaseVoltages: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
    controlSignals?: Map<string, Float64Array> | undefined;
  };
}

export interface EmtPlantConfig {
  /** Unique identifier for this EMT plant (e.g. "WindFarm_Bus7", "SolarBess_Bus9"). */
  id: string;
  /**
   * PSCAD runner or solver for this plant.
   * Can be synchronous or asynchronous (executing in WebWorker, child process, or WebGPU).
   */
  runner: (options: {
    durationSec: number;
    timeStepSec: number;
    boundaryFeeds: Array<{
      busId: string;
      thevenin?: (t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined;
      currentInjection?: (t: number) => { ia: number; ib: number; ic: number } | undefined;
    }>;
    onStep?: (t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void;
  }) => TsEmtCoSimResult["emtTrajectory"] | Promise<TsEmtCoSimResult["emtTrajectory"]>;
  /** Boundary port configurations mapping TS buses to this plant's EMT buses. */
  boundaryPorts: TsEmtBoundaryPortConfig[];
}

export interface MultiPlantTsEmtOptions {
  /** Total co-simulation duration in seconds (default: 1.0). */
  durationSec?: number | undefined;
  /** PSS/E macro-step size in seconds (default: 0.005 s = 5 ms). */
  dtTsSec?: number | undefined;
  /** PSCAD EMT sub-step size in seconds (default: 50e-6 s = 50 us). */
  dtEmtSec?: number | undefined;
  /** Fundamental power frequency in Hz (default: 60.0). */
  frequencyHz?: number | undefined;
  /** Array of EMT plants to simulate concurrently. */
  plants: EmtPlantConfig[];
  /** Optional temporary balanced 3-phase fault applied on a TS bus. */
  fault?:
    | {
        busNumber: number;
        startSec: number;
        clearSec: number;
        susceptancePu?: number | undefined;
      }
    | undefined;
  /** Maximum number of concurrent worker processes/promises (default: plants.length). */
  concurrency?: number | undefined;
  /** Extrapolation method for boundary voltage phasor between macro-steps (default: "quadratic"). */
  extrapolation?: "constant" | "linear" | "quadratic" | undefined;
}

export interface MultiPlantMacroRecord {
  timeSec: number;
  plantId: string;
  psseBusNumber: number;
  pscadBusId: string;
  vTsMagPu: number;
  vTsAngleDeg: number;
  vEmtPeakKv: number;
  iEmtInjAmpRms: number;
  iTsInjPuRe: number;
  iTsInjPuIm: number;
}

export interface MultiPlantTsEmtResult {
  macroRecords: MultiPlantMacroRecord[];
  totalMacroSteps: number;
  totalEmtSubSteps: number;
  ratioM: number;
  wallClockTimeMs: number;
  plantCount: number;
  tsTrajectory: {
    t: number[];
    states: string[];
    y: number[][];
    summary: {
      convergedPowerFlow: boolean;
      stable: boolean;
      maxRotorAngleSpreadDeg: number;
    };
  };
  plantTrajectories: Map<string, TsEmtCoSimResult["emtTrajectory"]>;
}

/**
 * Computes fundamental frequency Discrete Fourier Transform (DFT) phasor
 * from a discrete sampled waveform over a full cycle window.
 */
export function extractFundamentalPhasor(
  samples: Float64Array | number[],
  dt: number,
  f0: number,
  fTracked?: number | undefined,
  tWindowEndSec?: number | undefined,
): { re: number; im: number; mag: number; phaseRad: number } {
  const fEff = fTracked && fTracked > 5.0 && Number.isFinite(fTracked) ? fTracked : f0;
  const nCycle = Math.max(4, Math.round(1.0 / (fEff * dt)));
  const len = samples.length;
  if (len === 0) return { re: 0, im: 0, mag: 0, phaseRad: 0 };

  const start = Math.max(0, len - nCycle);
  const count = len - start;
  const omega = 2.0 * Math.PI * fEff;
  // When tWindowEndSec is provided, lock phase to the global synchronous frame t = tWindowEndSec - (count - 1 - i) * dt
  const tStart = tWindowEndSec !== undefined ? tWindowEndSec - (count - 1) * dt : 0.0;

  let sSS = 0.0;
  let sCC = 0.0;
  let sSC = 0.0;
  let bS = 0.0;
  let bC = 0.0;

  for (let i = 0; i < count; i++) {
    const idx = start + i;
    const val = typeof samples[idx] === "number" ? (samples[idx] as number) : 0.0;
    const theta = omega * (tStart + i * dt);
    const sn = Math.sin(theta);
    const cs = Math.cos(theta);
    sSS += sn * sn;
    sCC += cs * cs;
    sSC += sn * cs;
    bS += val * sn;
    bC += val * cs;
  }

  // Exact 2x2 normal-equation solve for x(t) = re*sin(w*t) + im*cos(w*t) = A*sin(w*t + phi).
  // Reduces identically to 2/N DFT for a full cycle, and eliminates partial-cycle leakage for count < nCycle.
  const det = sSS * sCC - sSC * sSC;
  let re: number;
  let im: number;
  if (Math.abs(det) > 1e-12) {
    re = (sCC * bS - sSC * bC) / det;
    im = (-sSC * bS + sSS * bC) / det;
  } else {
    const factor = 2.0 / count;
    re = bS * factor;
    im = bC * factor;
  }
  const mag = Math.hypot(re, im);
  const phaseRad = Math.atan2(im, re);

  return { re, im, mag, phaseRad };
}

/**
 * Converts 3-phase fundamental phasors (Ia, Ib, Ic) to positive-sequence phasor I1.
 */
export function toPositiveSequencePhasor(
  ia: { re: number; im: number },
  ib: { re: number; im: number },
  ic: { re: number; im: number },
): { re: number; im: number; mag: number; phaseRad: number } {
  // I1 = 1/3 * (Ia + a * Ib + a^2 * Ic)
  // a = -0.5 + j sqrt(3)/2
  // a^2 = -0.5 - j sqrt(3)/2
  const cos120 = -0.5;
  const sin120 = Math.sqrt(3.0) / 2.0;

  // a * Ib
  const aIbRe = cos120 * ib.re - sin120 * ib.im;
  const aIbIm = cos120 * ib.im + sin120 * ib.re;

  // a^2 * Ic
  const a2IcRe = cos120 * ic.re + sin120 * ic.im;
  const a2IcIm = cos120 * ic.im - sin120 * ic.re;

  const re = (ia.re + aIbRe + a2IcRe) / 3.0;
  const im = (ia.im + aIbIm + a2IcIm) / 3.0;
  const mag = Math.hypot(re, im);
  const phaseRad = Math.atan2(im, re);

  return { re, im, mag, phaseRad };
}

interface ActivePortState {
  plantId: string;
  port: TsEmtBoundaryPortConfig;
  baseKv: number;
  baseMva: number;
  iBaseAmpRms: number;
  gSrc: number;
  currentVmPu: number;
  currentVaRad: number;
  lastInjIrPu: number;
  lastInjIiPu: number;
  recentIa: number[];
  recentIb: number[];
  recentIc: number[];
  historyVm: Array<{ t: number; vm: number }>;
  historyVa: Array<{ t: number; va: number }>;
}

function extrapolateVoltage(
  ps: ActivePortState,
  t: number,
  mode: "constant" | "linear" | "quadratic",
): { vm: number; va: number } {
  const n = ps.historyVm.length;
  if (n === 0 || mode === "constant") {
    return { vm: ps.currentVmPu, va: ps.currentVaRad };
  }

  if (n < 3 || mode === "linear") {
    if (n < 2) {
      return { vm: ps.currentVmPu, va: ps.currentVaRad };
    }
    const p1 = ps.historyVm[n - 2]!;
    const p2 = ps.historyVm[n - 1]!;
    const dt = p2.t - p1.t;
    if (dt <= 1e-9) return { vm: ps.currentVmPu, va: ps.currentVaRad };

    const dtCurr = t - p2.t;
    const slopeVm = (p2.vm - p1.vm) / dt;
    let vmExtrap = p2.vm + slopeVm * dtCurr;
    vmExtrap = Math.max(0.0, Math.min(1.8, vmExtrap));

    // Phase angle unwrap
    const a1 = ps.historyVa[n - 2]!.va;
    const a2 = ps.historyVa[n - 1]!.va;
    let dVa = a2 - a1;
    dVa = dVa - 2 * Math.PI * Math.round(dVa / (2 * Math.PI));
    const slopeVa = dVa / dt;
    const vaExtrap = a2 + slopeVa * dtCurr;

    return { vm: vmExtrap, va: vaExtrap };
  }

  // Quadratic extrapolation (n >= 3)
  const t0 = ps.historyVm[n - 3]!.t;
  const v0 = ps.historyVm[n - 3]!.vm;
  const t1 = ps.historyVm[n - 2]!.t;
  const v1 = ps.historyVm[n - 2]!.vm;
  const t2 = ps.historyVm[n - 1]!.t;
  const v2 = ps.historyVm[n - 1]!.vm;

  const h1 = t1 - t0;
  const h2 = t2 - t1;
  if (h1 <= 1e-9 || h2 <= 1e-9) {
    return { vm: ps.currentVmPu, va: ps.currentVaRad };
  }

  const d1 = (v1 - v0) / h1;
  const d2 = (v2 - v1) / h2;
  const d12 = (d2 - d1) / (t2 - t0);

  const dtCurr = t - t2;
  let vmExtrap = v2 + d2 * dtCurr + d12 * dtCurr * (t - t1);
  vmExtrap = Math.max(0.0, Math.min(1.8, vmExtrap));

  // Phase angle quadratic extrapolation
  const a0 = ps.historyVa[n - 3]!.va;
  let a1 = ps.historyVa[n - 2]!.va;
  let a2 = ps.historyVa[n - 1]!.va;

  let diff1 = a1 - a0;
  diff1 = diff1 - 2 * Math.PI * Math.round(diff1 / (2 * Math.PI));
  a1 = a0 + diff1;

  let diff2 = a2 - a1;
  diff2 = diff2 - 2 * Math.PI * Math.round(diff2 / (2 * Math.PI));
  a2 = a1 + diff2;

  const ad1 = (a1 - a0) / h1;
  const ad2 = (a2 - a1) / h2;
  const ad12 = (ad2 - ad1) / (t2 - t0);

  const vaExtrap = a2 + ad2 * dtCurr + ad12 * dtCurr * (t - t1);

  return { vm: vmExtrap, va: vaExtrap };
}

/**
 * Executes a coupled multi-plant TS-EMT hybrid co-simulation coordinating K >= 1
 * concurrent EMT plants with positive-sequence transmission transient stability.
 */
export async function runMultiPlantTsEmtCoSimulation(
  psseRunner: (options: {
    stopTime: number;
    timeStep: number;
    boundaryInjections: Array<{ busNumber: number; inject: (t: number) => { irPu: number; iiPu: number } }>;
    onStep?: (t: number, busVoltages: Map<number, { vmPu: number; vaRad: number }>) => void;
    fault?: MultiPlantTsEmtOptions["fault"];
  }) => MultiPlantTsEmtResult["tsTrajectory"] | Promise<MultiPlantTsEmtResult["tsTrajectory"]>,
  options: MultiPlantTsEmtOptions,
): Promise<MultiPlantTsEmtResult> {
  const t0 = Date.now();
  const durationSec = options.durationSec ?? 1.0;
  const dtTsSec = options.dtTsSec ?? 0.005;
  const dtEmtSec = options.dtEmtSec ?? 50e-6;
  const f0 = options.frequencyHz ?? 60.0;
  const omega0 = 2.0 * Math.PI * f0;
  const ratioM = Math.max(1, Math.round(dtTsSec / dtEmtSec));
  const extrapMode = options.extrapolation ?? "quadratic";

  const macroRecords: MultiPlantMacroRecord[] = [];

  // Initialize port states across all plants
  const portStates: ActivePortState[] = [];
  for (const plant of options.plants) {
    for (const port of plant.boundaryPorts) {
      const baseKv = port.baseKvLL ?? 230.0;
      const baseMva = port.baseMva ?? 100.0;
      const iBaseAmpRms = (baseMva * 1e6) / (Math.sqrt(3.0) * baseKv * 1e3);
      const gSrc = port.theveninConductanceSiemens ?? 20.0;

      portStates.push({
        plantId: plant.id,
        port,
        baseKv,
        baseMva,
        iBaseAmpRms,
        gSrc,
        currentVmPu: 1.0,
        currentVaRad: 0.0,
        lastInjIrPu: 0.0,
        lastInjIiPu: 0.0,
        recentIa: [],
        recentIb: [],
        recentIc: [],
        historyVm: [{ t: 0.0, vm: 1.0 }],
        historyVa: [{ t: 0.0, va: 0.0 }],
      });
    }
  }

  // 1. Run all EMT plants concurrently via Promise.all
  const plantTrajectories = new Map<string, TsEmtCoSimResult["emtTrajectory"]>();
  const emtPromises = options.plants.map(async (plant) => {
    const plantPorts = portStates.filter((p) => p.plantId === plant.id);

    const boundaryFeeds = plantPorts.map((ps) => {
      return {
        busId: ps.port.pscadBusId,
        thevenin: (t: number) => {
          const { vm, va } = extrapolateVoltage(ps, t, extrapMode);
          const vPeak = (vm * ps.baseKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
          return {
            vPeak,
            freqRad: omega0,
            phaseRad: va,
            gSrc: ps.gSrc,
          };
        },
      };
    });

    const plantRes = await plant.runner({
      durationSec,
      timeStepSec: dtEmtSec,
      boundaryFeeds,
      onStep: (t, _stepIdx, busVoltages) => {
        for (const ps of plantPorts) {
          const vObj = busVoltages.get(ps.port.pscadBusId);
          if (vObj) {
            const { vm, va } = extrapolateVoltage(ps, t, extrapMode);
            const peak = (vm * ps.baseKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
            const ea = peak * Math.sin(omega0 * t + va);
            const eb = peak * Math.sin(omega0 * t + va - (2 * Math.PI) / 3);
            const ec = peak * Math.sin(omega0 * t + va + (2 * Math.PI) / 3);

            const ia = ps.gSrc * (ea - vObj.a);
            const ib = ps.gSrc * (eb - vObj.b);
            const ic = ps.gSrc * (ec - vObj.c);

            ps.recentIa.push(ia);
            ps.recentIb.push(ib);
            ps.recentIc.push(ic);

            if (ps.recentIa.length > ratioM * 2) {
              ps.recentIa.shift();
              ps.recentIb.shift();
              ps.recentIc.shift();
            }
          }
        }
      },
    });

    plantTrajectories.set(plant.id, plantRes);
  });

  await Promise.all(emtPromises);

  // 2. Aggregate boundary current injections per unique PSS/E bus
  const uniqueBusNumbers = Array.from(new Set(portStates.map((ps) => ps.port.psseBusNumber)));
  const boundaryInjections = uniqueBusNumbers.map((busNumber) => {
    const portsOnBus = portStates.filter((ps) => ps.port.psseBusNumber === busNumber);

    return {
      busNumber,
      inject: (_t: number) => {
        let totalIrPu = 0.0;
        let totalIiPu = 0.0;

        for (const ps of portsOnBus) {
          const fa = extractFundamentalPhasor(ps.recentIa, dtEmtSec, f0);
          const fb = extractFundamentalPhasor(ps.recentIb, dtEmtSec, f0);
          const fc = extractFundamentalPhasor(ps.recentIc, dtEmtSec, f0);
          const f1 = toPositiveSequencePhasor(fa, fb, fc);

          const irPu = f1.re / Math.SQRT2 / ps.iBaseAmpRms;
          const iiPu = f1.im / Math.SQRT2 / ps.iBaseAmpRms;

          ps.lastInjIrPu = irPu;
          ps.lastInjIiPu = iiPu;

          totalIrPu += irPu;
          totalIiPu += iiPu;
        }

        return { irPu: totalIrPu, iiPu: totalIiPu };
      },
    };
  });

  // 3. Run PSS/E transient stability simulation with aggregated boundary injections
  const tsRes = await psseRunner({
    stopTime: durationSec,
    timeStep: dtTsSec,
    boundaryInjections,
    fault: options.fault,
    onStep: (t, busMap) => {
      for (const ps of portStates) {
        const b = busMap.get(ps.port.psseBusNumber);
        if (b) {
          ps.currentVmPu = b.vmPu;
          ps.currentVaRad = b.vaRad;
          ps.historyVm.push({ t, vm: b.vmPu });
          ps.historyVa.push({ t, va: b.vaRad });
          if (ps.historyVm.length > 5) {
            ps.historyVm.shift();
            ps.historyVa.shift();
          }

          macroRecords.push({
            timeSec: Number(t.toFixed(4)),
            plantId: ps.plantId,
            psseBusNumber: ps.port.psseBusNumber,
            pscadBusId: ps.port.pscadBusId,
            vTsMagPu: Number(b.vmPu.toFixed(4)),
            vTsAngleDeg: Number(((b.vaRad * 180.0) / Math.PI).toFixed(2)),
            vEmtPeakKv: Number((((b.vmPu * ps.baseKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0)) * 1e-3).toFixed(2)),
            iEmtInjAmpRms: Number((Math.hypot(ps.lastInjIrPu, ps.lastInjIiPu) * ps.iBaseAmpRms).toFixed(1)),
            iTsInjPuRe: Number(ps.lastInjIrPu.toFixed(4)),
            iTsInjPuIm: Number(ps.lastInjIiPu.toFixed(4)),
          });
        }
      }
    },
  });

  const wallClockTimeMs = Date.now() - t0;
  const totalMacroSteps = Math.round(durationSec / dtTsSec);
  const totalEmtSubSteps = Math.round(durationSec / dtEmtSec);

  return {
    macroRecords,
    totalMacroSteps,
    totalEmtSubSteps,
    ratioM,
    wallClockTimeMs,
    plantCount: options.plants.length,
    tsTrajectory: tsRes,
    plantTrajectories,
  };
}

/**
 * Stateful Multi-Plant TS-EMT Co-Simulation Orchestrator.
 */
export class MultiPlantTsEmtCoSimOrchestrator {
  private options: MultiPlantTsEmtOptions;
  private plants: Map<string, EmtPlantConfig> = new Map();

  constructor(options?: Partial<MultiPlantTsEmtOptions>) {
    this.options = {
      durationSec: 1.0,
      dtTsSec: 0.005,
      dtEmtSec: 50e-6,
      frequencyHz: 60.0,
      plants: [],
      extrapolation: "quadratic",
      ...options,
    };
    if (options?.plants) {
      for (const p of options.plants) {
        this.plants.set(p.id, p);
      }
    }
  }

  public addPlant(plant: EmtPlantConfig): this {
    this.plants.set(plant.id, plant);
    return this;
  }

  public removePlant(id: string): boolean {
    return this.plants.delete(id);
  }

  public getPlant(id: string): EmtPlantConfig | undefined {
    return this.plants.get(id);
  }

  public getPlants(): EmtPlantConfig[] {
    return Array.from(this.plants.values());
  }

  public async run(
    psseRunner: (options: {
      stopTime: number;
      timeStep: number;
      boundaryInjections: Array<{ busNumber: number; inject: (t: number) => { irPu: number; iiPu: number } }>;
      onStep?: (t: number, busVoltages: Map<number, { vmPu: number; vaRad: number }>) => void;
      fault?: MultiPlantTsEmtOptions["fault"];
    }) => MultiPlantTsEmtResult["tsTrajectory"] | Promise<MultiPlantTsEmtResult["tsTrajectory"]>,
  ): Promise<MultiPlantTsEmtResult> {
    const fullOpts: MultiPlantTsEmtOptions = {
      ...this.options,
      plants: this.getPlants(),
    };
    return runMultiPlantTsEmtCoSimulation(psseRunner, fullOpts);
  }
}

/**
 * Executes a coupled TS-EMT hybrid co-simulation using supplied PSS/E and PSCAD
 * simulation runners across designated boundary ports.
 */
export async function runTsEmtCoSimulation(
  psseRunner: (options: {
    stopTime: number;
    timeStep: number;
    boundaryInjections: Array<{ busNumber: number; inject: (t: number) => { irPu: number; iiPu: number } }>;
    onStep?: (t: number, busVoltages: Map<number, { vmPu: number; vaRad: number }>) => void;
    fault?: TsEmtCoSimOptions["fault"];
  }) => MultiPlantTsEmtResult["tsTrajectory"] | Promise<MultiPlantTsEmtResult["tsTrajectory"]>,
  pscadRunner: (options: {
    durationSec: number;
    timeStepSec: number;
    boundaryFeeds: Array<{
      busId: string;
      thevenin?: (t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined;
      currentInjection?: (t: number) => { ia: number; ib: number; ic: number } | undefined;
    }>;
    onStep?: (t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void;
  }) => TsEmtCoSimResult["emtTrajectory"] | Promise<TsEmtCoSimResult["emtTrajectory"]>,
  options: TsEmtCoSimOptions,
): Promise<TsEmtCoSimResult> {
  const multiResult = await runMultiPlantTsEmtCoSimulation(psseRunner, {
    durationSec: options.durationSec,
    dtTsSec: options.dtTsSec,
    dtEmtSec: options.dtEmtSec,
    frequencyHz: options.frequencyHz,
    fault: options.fault,
    plants: [
      {
        id: "EMT_Plant_1",
        runner: pscadRunner,
        boundaryPorts: options.boundaryPorts,
      },
    ],
  });

  return {
    macroRecords: multiResult.macroRecords.map((r) => ({
      timeSec: r.timeSec,
      psseBusNumber: r.psseBusNumber,
      pscadBusId: r.pscadBusId,
      vTsMagPu: r.vTsMagPu,
      vTsAngleDeg: r.vTsAngleDeg,
      vEmtPeakKv: r.vEmtPeakKv,
      iEmtInjAmpRms: r.iEmtInjAmpRms,
      iTsInjPuRe: r.iTsInjPuRe,
      iTsInjPuIm: r.iTsInjPuIm,
    })),
    totalMacroSteps: multiResult.totalMacroSteps,
    totalEmtSubSteps: multiResult.totalEmtSubSteps,
    ratioM: multiResult.ratioM,
    wallClockTimeMs: multiResult.wallClockTimeMs,
    tsTrajectory: multiResult.tsTrajectory,
    emtTrajectory: multiResult.plantTrajectories.get("EMT_Plant_1")!,
  };
}

// ============================================================================
// Generic Polyglot Closed-Loop Phasor <-> EMT Hybrid Co-Simulation Engine
// ============================================================================

/**
 * Converts 3-phase fundamental phasors (Ia, Ib, Ic) into full symmetrical components:
 * positive (1), negative (2), and zero (0) sequence phasors.
 */
export function toSequencePhasors(ia: ComplexPhasor, ib: ComplexPhasor, ic: ComplexPhasor): SequencePhasors {
  const cos120 = -0.5;
  const sin120 = Math.sqrt(3.0) / 2.0;

  // a * Ib and a^2 * Ib
  const aIbRe = cos120 * ib.re - sin120 * ib.im;
  const aIbIm = cos120 * ib.im + sin120 * ib.re;
  const a2IbRe = cos120 * ib.re + sin120 * ib.im;
  const a2IbIm = cos120 * ib.im - sin120 * ib.re;

  // a * Ic and a^2 * Ic
  const aIcRe = cos120 * ic.re - sin120 * ic.im;
  const aIcIm = cos120 * ic.im + sin120 * ic.re;
  const a2IcRe = cos120 * ic.re + sin120 * ic.im;
  const a2IcIm = cos120 * ic.im - sin120 * ic.re;

  return {
    pos: {
      re: (ia.re + aIbRe + a2IcRe) / 3.0,
      im: (ia.im + aIbIm + a2IcIm) / 3.0,
    },
    neg: {
      re: (ia.re + a2IbRe + aIcRe) / 3.0,
      im: (ia.im + a2IbIm + aIcIm) / 3.0,
    },
    zero: {
      re: (ia.re + ib.re + ic.re) / 3.0,
      im: (ia.im + ib.im + ic.im) / 3.0,
    },
  };
}

/**
 * Synthesizes instantaneous 3-phase voltages (Volts) from sequence phasors (pu)
 * at angular frequency `omegaRad` and time `tSec`.
 *
 * V_a = V_0 + V_1 + V_2
 * V_b = V_0 + a^2 * V_1 + a * V_2
 * V_c = V_0 + a * V_1 + a^2 * V_2
 */
export function synthesizeThreePhaseFromSequences(
  seq: SequencePhasors,
  omegaRad: number,
  tSec: number,
  vPeakPhaseVolts: number,
): ThreePhaseValues {
  const v1Re = seq.pos.re;
  const v1Im = seq.pos.im;
  const v2Re = seq.neg?.re ?? 0.0;
  const v2Im = seq.neg?.im ?? 0.0;
  const v0Re = seq.zero?.re ?? 0.0;
  const v0Im = seq.zero?.im ?? 0.0;

  const cos120 = -0.5;
  const sin120 = Math.sqrt(3.0) / 2.0;

  // Phase A phasor
  const vaRe = v0Re + v1Re + v2Re;
  const vaIm = v0Im + v1Im + v2Im;

  // Phase B phasor: v0 + a^2*v1 + a*v2
  const a2v1Re = cos120 * v1Re + sin120 * v1Im;
  const a2v1Im = cos120 * v1Im - sin120 * v1Re;
  const av2Re = cos120 * v2Re - sin120 * v2Im;
  const av2Im = cos120 * v2Im + sin120 * v2Re;
  const vbRe = v0Re + a2v1Re + av2Re;
  const vbIm = v0Im + a2v1Im + av2Im;

  // Phase C phasor: v0 + a*v1 + a^2*v2
  const av1Re = cos120 * v1Re - sin120 * v1Im;
  const av1Im = cos120 * v1Im + sin120 * v1Re;
  const a2v2Re = cos120 * v2Re + sin120 * v2Im;
  const a2v2Im = cos120 * v2Im - sin120 * v2Re;
  const vcRe = v0Re + av1Re + a2v2Re;
  const vcIm = v0Im + av1Im + a2v2Im;

  const wt = omegaRad * tSec;
  const sinWt = Math.sin(wt);
  const cosWt = Math.cos(wt);

  // Instantaneous waveform matching sine reference: Im((Vr + j Vi) * e^(j wt)) = Vr * sin(wt) + Vi * cos(wt)
  return {
    a: vPeakPhaseVolts * (vaRe * sinWt + vaIm * cosWt),
    b: vPeakPhaseVolts * (vbRe * sinWt + vbIm * cosWt),
    c: vPeakPhaseVolts * (vcRe * sinWt + vcIm * cosWt),
  };
}

/**
 * Converts symmetrical-component diagonal port admittances (Y_1, Y_2, Y_0 in pu)
 * into a symmetric 3x3 real phase conductance matrix G_abc (Siemens, row-major length 9)
 * for Dommel nodal stamping:
 *   G_self   = (G_0 + G_1 + G_2) / 3
 *   G_mutual = (G_0 - 0.5 * (G_1 + G_2)) / 3
 */
export function computePhaseConductanceMatrix3x3(
  yPosPu: ComplexPhasor,
  yNegPu: ComplexPhasor | undefined,
  yZeroPu: ComplexPhasor | undefined,
  zBaseOhm: number,
  fallbackConductanceS = 20.0,
): { gSelf: number; gMutual: number; gMatrix3x3: Float64Array } {
  const yBaseS = zBaseOhm > 1e-12 ? 1.0 / zBaseOhm : 1.0;
  // Use admittance magnitude for Dommel resistive companion stability when X >> R
  const g1 = Math.max(1e-6, Math.hypot(yPosPu.re, yPosPu.im) * yBaseS);
  const g2 = yNegPu ? Math.max(1e-6, Math.hypot(yNegPu.re, yNegPu.im) * yBaseS) : g1;
  const g0 = yZeroPu ? Math.max(1e-6, Math.hypot(yZeroPu.re, yZeroPu.im) * yBaseS) : g1 / 3.0;

  if (!Number.isFinite(g1) || g1 <= 1e-9) {
    const m = new Float64Array(9);
    m[0] = fallbackConductanceS;
    m[4] = fallbackConductanceS;
    m[8] = fallbackConductanceS;
    return { gSelf: fallbackConductanceS, gMutual: 0.0, gMatrix3x3: m };
  }

  const gSelf = (g0 + g1 + g2) / 3.0;
  const gMutual = (g0 - 0.5 * (g1 + g2)) / 3.0;
  const gMatrix3x3 = new Float64Array([gSelf, gMutual, gMutual, gMutual, gSelf, gMutual, gMutual, gMutual, gSelf]);
  return { gSelf, gMutual, gMatrix3x3 };
}

export interface HybridEmtPlantConfig {
  id: string;
  participant: EmtNetworkParticipant;
  boundaryPorts: PhasorEmtBoundaryPort[];
}

export interface HybridPhasorEmtOptions {
  /** Total co-simulation duration in seconds (default: 1.0). */
  durationSec?: number | undefined;
  /** Phasor macro-step size in seconds (default: 0.005 s = 5 ms). */
  dtTsSec?: number | undefined;
  /** EMT micro-step size in seconds (default: 50e-6 s = 50 us). */
  dtEmtSec?: number | undefined;
  /** Fundamental power frequency in Hz (default: 60.0). */
  frequencyHz?: number | undefined;
  /** Coupling mode: direct in-process polyglot or FMI 3.0 (`fmi-ls-rms`/`fmi-ls-emt`) wrappers (default: "direct"). */
  mode?: "direct" | "fmi" | undefined;
  /** Sequence coupling order: 1 (positive-sequence balanced) or 3 (pos/neg/zero unbalanced). Default: 1. */
  sequences?: 1 | 3 | undefined;
  /** Whether to compute and update dynamic multi-port Y_eq from the phasor network (default: true). */
  useDynamicEquivalent?: boolean | undefined;
  /** Whether to synthesize passive FDNE Dommel companions at boundary ports (default: false). */
  useFdne?: boolean | undefined;
  /** Whether to adapt DFT extraction frequency to local/COI bus frequency during swings (default: true). */
  trackFrequency?: boolean | undefined;
  /** Boundary voltage extrapolation method between macro-steps (default: "linear"). */
  extrapolation?: "constant" | "linear" | "quadratic" | undefined;
  /** Maximum Picard / waveform-relaxation iterations per macro-step (default: 1). */
  maxIterations?: number | undefined;
  /** Convergence tolerance in pu for macro-step Picard iteration (default: 1e-3). */
  iterationTolerancePu?: number | undefined;
  /** Optional fault applied on a bus in the bulk phasor network. */
  fault?:
    | {
        busId: string;
        startSec: number;
        clearSec: number;
        susceptancePu?: number | undefined;
        faultType?: "3ph" | "slg" | "ll" | "llg" | undefined;
      }
    | undefined;
}

export interface HybridMacroRecord {
  timeSec: number;
  plantId: string;
  phasorBusId: string;
  emtBusId: string;
  vTsMagPu: number;
  vTsAngleDeg: number;
  vNegMagPu: number;
  vZeroMagPu: number;
  vEmtPeakKv: number;
  iEmtInjAmpRms: number;
  iTsInjPuRe: number;
  iTsInjPuIm: number;
  gSelfSiemens: number;
  picardIterations: number;
}

export interface HybridPhasorEmtResult {
  mode: "direct" | "fmi";
  sequences: 1 | 3;
  usedFdne: boolean;
  macroRecords: HybridMacroRecord[];
  totalMacroSteps: number;
  totalEmtSubSteps: number;
  ratioM: number;
  wallClockTimeMs: number;
  plantCount: number;
  topologyUpdates: number;
  totalPicardIterations: number;
  phasorTrajectory: PhasorTrajectoryResult;
  plantTrajectories: Map<string, EmtTrajectoryResult>;
}

interface HybridPortRuntime {
  plantId: string;
  port: PhasorEmtBoundaryPort;
  baseKv: number;
  baseMva: number;
  zBaseOhm: number;
  vPeakPhaseVolts: number;
  iBaseAmpRms: number;
  gSelf: number;
  gMatrix3x3: Float64Array;
  mutualCouplings?: Array<{ peerBusId: string; gMatrix3x3: Float64Array }> | undefined;
  fdneModel?: import("./fdne-fitter.js").FdneRationalModel | undefined;
  fdne?: FdneDommelCompanion | undefined;
  trackedFreqHz: number;
  currentSeqV: SequencePhasors;
  prevSeqV: SequencePhasors;
  targetSeqV: SequencePhasors | null;
  lastInjSeqPu: SequencePhasors;
  recentIa: number[];
  recentIb: number[];
  recentIc: number[];
  historyVm: Array<{ t: number; vm: number }>;
  historyVa: Array<{ t: number; va: number }>;
}

const DEFAULT_FDNE_FREQ_GRID_HZ: number[] = (() => {
  const pts: number[] = [];
  const minF = 10.0;
  const maxF = 2500.0;
  const n = 32;
  for (let i = 0; i < n; i++) {
    pts.push(minF * Math.pow(maxF / minF, i / (n - 1)));
  }
  return pts;
})();

function updatePortConductanceFromEquivalent(
  pr: HybridPortRuntime,
  equiv: MultiPortBoundaryEquivalent,
  sequences: 1 | 3,
  useFdne: boolean,
  dtEmtSec: number,
  f0: number,
  allPorts?: HybridPortRuntime[],
  phasor?: PhasorNetworkParticipant,
): void {
  const idx = equiv.busIds.indexOf(pr.port.phasorBusId);
  if (idx < 0) return;
  const n = equiv.busIds.length;
  const y1 = equiv.yEqPos[idx * n + idx] ?? { re: 0, im: 0 };
  const y2 = sequences === 3 ? equiv.yEqNeg?.[idx * n + idx] : undefined;
  const y0 = sequences === 3 ? equiv.yEqZero?.[idx * n + idx] : undefined;

  const fallbackG = pr.port.theveninConductanceSiemens ?? 20.0;
  const { gSelf, gMatrix3x3 } = computePhaseConductanceMatrix3x3(y1, y2, y0, pr.zBaseOhm, fallbackG);
  pr.gSelf = gSelf;
  pr.gMatrix3x3 = gMatrix3x3;

  // Populate off-diagonal multi-port mutual couplings to peer boundary ports in the SAME EMT plant
  if (allPorts && n > 1) {
    const mutuals: Array<{ peerBusId: string; gMatrix3x3: Float64Array }> = [];
    for (const peer of allPorts) {
      if (peer === pr || peer.plantId !== pr.plantId) continue;
      const peerIdx = equiv.busIds.indexOf(peer.port.phasorBusId);
      if (peerIdx < 0 || peerIdx === idx) continue;
      const yOff1 = equiv.yEqPos[idx * n + peerIdx];
      if (!yOff1 || Math.hypot(yOff1.re, yOff1.im) < 1e-9) continue;
      const yOff2 = sequences === 3 ? equiv.yEqNeg?.[idx * n + peerIdx] : undefined;
      const yOff0 = sequences === 3 ? equiv.yEqZero?.[idx * n + peerIdx] : undefined;
      // Off-diagonal Y_ij is negative of tie admittance; stamp real part preserving sign
      const yBaseS = pr.zBaseOhm > 1e-12 ? 1.0 / pr.zBaseOhm : 1.0;
      const g1 = yOff1.re * yBaseS;
      const g2 = yOff2 ? yOff2.re * yBaseS : g1;
      const g0 = yOff0 ? yOff0.re * yBaseS : g1 / 3.0;
      const gmSelf = (g0 + g1 + g2) / 3.0;
      const gmMut = (g0 - 0.5 * (g1 + g2)) / 3.0;
      if (Math.abs(gmSelf) > 1e-12 || Math.abs(gmMut) > 1e-12) {
        mutuals.push({
          peerBusId: peer.port.emtBusId,
          gMatrix3x3: new Float64Array([gmSelf, gmMut, gmMut, gmMut, gmSelf, gmMut, gmMut, gmMut, gmSelf]),
        });
      }
    }
    pr.mutualCouplings = mutuals.length > 0 ? mutuals : undefined;
  }

  if (useFdne) {
    // Prefer true multi-frequency Y_bus(jw) scan from the phasor network if supported
    const scanned = phasor?.scanBoundaryAdmittance?.(pr.port.phasorBusId, DEFAULT_FDNE_FREQ_GRID_HZ);
    if (scanned && scanned.length >= 6) {
      const fdneModel = fitFdneRational(scanned, {
        numPoles: 4,
        iterations: 5,
        includeCapacitiveTerm: true,
        enforcePassivity: true,
      });
      pr.fdneModel = fdneModel;
      pr.fdne = new FdneDommelCompanion(fdneModel, dtEmtSec, 3);
      pr.gSelf = pr.fdne.getConductanceSiemens();
      pr.gMatrix3x3 = new Float64Array([pr.gSelf, 0, 0, 0, pr.gSelf, 0, 0, 0, pr.gSelf]);
      // Single-port FDNE models the self-port Norton equivalent; do not mix with 60 Hz off-diagonal Kron mutuals
      pr.mutualCouplings = undefined;
      return;
    }

    // Fallback: fit from port fundamental RL Thévenin equivalent
    const yMagSq = y1.re * y1.re + y1.im * y1.im;
    if (yMagSq > 1e-12) {
      const rOhm = Math.max(1e-3, (y1.re / yMagSq) * pr.zBaseOhm);
      const xOhm = Math.max(1e-3, (-y1.im / yMagSq) * pr.zBaseOhm);
      const lHenry = xOhm / (2.0 * Math.PI * f0);
      const fdneModel = fitFdneFromRlThevenin(rOhm, lHenry, 0.0, { numPoles: 3, iterations: 4 });
      pr.fdneModel = fdneModel;
      pr.fdne = new FdneDommelCompanion(fdneModel, dtEmtSec, 3);
      pr.gSelf = pr.fdne.getConductanceSiemens();
      pr.gMatrix3x3 = new Float64Array([pr.gSelf, 0, 0, 0, pr.gSelf, 0, 0, 0, pr.gSelf]);
      pr.mutualCouplings = undefined;
    }
  }
}

/**
 * Executes a TRUE lock-stepped closed-loop hybrid Phasor <-> EMT co-simulation
 * across any `PhasorNetworkParticipant` (e.g. PSS/E) and one or more `EmtNetworkParticipant`s
 * (e.g. PSCAD), supporting both direct polyglot execution and FMI 3.0 (`fmi-ls-rms`/`fmi-ls-emt`).
 */
export async function runHybridPhasorEmtCoSimulation(
  phasorParticipant: PhasorNetworkParticipant,
  plants: HybridEmtPlantConfig[],
  options: HybridPhasorEmtOptions = {},
): Promise<HybridPhasorEmtResult> {
  const tStartWall = Date.now();
  const durationSec = options.durationSec ?? 1.0;
  const dtTsSec = options.dtTsSec ?? 0.005;
  const dtEmtSec = options.dtEmtSec ?? 50e-6;
  const f0 = options.frequencyHz ?? 60.0;
  const omega0 = 2.0 * Math.PI * f0;
  const mode = options.mode ?? "direct";
  const sequences = options.sequences ?? 1;
  const useDynamicEquivalent = options.useDynamicEquivalent ?? true;
  const useFdne = options.useFdne ?? false;
  const trackFrequency = options.trackFrequency ?? true;
  const extrapMode = options.extrapolation ?? "linear";
  const maxIterations = Math.max(1, options.maxIterations ?? 1);
  const iterTol = options.iterationTolerancePu ?? 1e-3;

  const ratioM = Math.max(1, Math.round(dtTsSec / dtEmtSec));
  const totalMacroSteps = Math.max(1, Math.round(durationSec / dtTsSec));
  const nCycleSamples = Math.max(4, Math.round(1.0 / (f0 * dtEmtSec)));

  // Collect all unique boundary bus IDs on the phasor side
  const uniquePhasorBusIds = Array.from(new Set(plants.flatMap((pl) => pl.boundaryPorts.map((bp) => bp.phasorBusId))));

  // Optionally wrap participants in FMI 3.0 `fmi-ls-rms` / `fmi-ls-emt` participants
  const activePhasor: PhasorNetworkParticipant =
    mode === "fmi"
      ? new PhasorFmuParticipant(phasorParticipant, { boundaryBusIds: uniquePhasorBusIds })
      : phasorParticipant;

  const activePlants = plants.map((pl) => ({
    ...pl,
    participant:
      mode === "fmi"
        ? new EmtFmuParticipant(pl.participant, {
            boundaryBusIds: pl.boundaryPorts.map((bp) => bp.emtBusId),
            dtEmtSec,
          })
        : pl.participant,
  }));

  // ── Phase 1: Coordinated t=0 Steady-State Power-Flow Initialization ──
  const initRes = await activePhasor.initialize({
    durationSec,
    dtMacroSec: dtTsSec,
    boundaryBusIds: uniquePhasorBusIds,
    sequences,
    fault: options.fault,
  });

  const sysBaseMva = initRes.baseMva > 0 ? initRes.baseMva : 100.0;
  const portStates: HybridPortRuntime[] = [];

  for (const plant of activePlants) {
    for (const port of plant.boundaryPorts) {
      const initBusV = initRes.boundaryVoltages.get(port.phasorBusId);
      const baseKv = port.baseKvLL ?? initBusV?.baseKvLL ?? 230.0;
      const baseMva = port.baseMva ?? sysBaseMva;
      const zBaseOhm = (baseKv * baseKv) / baseMva;
      const vPeakPhaseVolts = (baseKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
      const iBaseAmpRms = (baseMva * 1e6) / (Math.sqrt(3.0) * baseKv * 1e3);
      const gFallback = port.theveninConductanceSiemens ?? 20.0;
      const initSeq: SequencePhasors = initBusV?.voltagePu ?? { pos: { re: 1.0, im: 0.0 } };
      const vm0 = Math.hypot(initSeq.pos.re, initSeq.pos.im);
      const va0 = Math.atan2(initSeq.pos.im, initSeq.pos.re);

      const pr: HybridPortRuntime = {
        plantId: plant.id,
        port,
        baseKv,
        baseMva,
        zBaseOhm,
        vPeakPhaseVolts,
        iBaseAmpRms,
        gSelf: gFallback,
        gMatrix3x3: new Float64Array([gFallback, 0, 0, 0, gFallback, 0, 0, 0, gFallback]),
        trackedFreqHz: initBusV?.freqHz ?? f0,
        currentSeqV: initSeq,
        prevSeqV: initSeq,
        targetSeqV: null,
        lastInjSeqPu: { pos: { re: 0, im: 0 }, neg: { re: 0, im: 0 }, zero: { re: 0, im: 0 } },
        recentIa: [],
        recentIb: [],
        recentIc: [],
        historyVm: [{ t: 0.0, vm: vm0 }],
        historyVa: [{ t: 0.0, va: va0 }],
      };

      portStates.push(pr);
    }
  }

  if (useDynamicEquivalent && initRes.boundaryEquivalent) {
    for (const pr of portStates) {
      updatePortConductanceFromEquivalent(
        pr,
        initRes.boundaryEquivalent,
        sequences,
        useFdne,
        dtEmtSec,
        f0,
        portStates,
        activePhasor,
      );
    }
  }

  const buildPlantFeeds = (plantId: string, tMacroStart: number, dtMacro: number): EmtBoundaryFeedSpec[] => {
    const plantPorts = portStates.filter((ps) => ps.plantId === plantId);
    return plantPorts.map((pr) => ({
      busId: pr.port.emtBusId,
      fdneModel: pr.fdneModel,
      evaluateThevenin: (tSec: number) => {
        // If in Picard iteration > 0, linearly interpolate between currentSeqV (t_k) and targetSeqV (t_{k+1})
        let seqV: SequencePhasors;
        if (pr.targetSeqV) {
          const alpha = Math.max(0.0, Math.min(1.0, (tSec - tMacroStart) / Math.max(1e-12, dtMacro)));
          seqV = {
            pos: {
              re: pr.currentSeqV.pos.re + alpha * (pr.targetSeqV.pos.re - pr.currentSeqV.pos.re),
              im: pr.currentSeqV.pos.im + alpha * (pr.targetSeqV.pos.im - pr.currentSeqV.pos.im),
            },
            neg:
              sequences === 3
                ? {
                    re:
                      (pr.currentSeqV.neg?.re ?? 0) +
                      alpha * ((pr.targetSeqV.neg?.re ?? 0) - (pr.currentSeqV.neg?.re ?? 0)),
                    im:
                      (pr.currentSeqV.neg?.im ?? 0) +
                      alpha * ((pr.targetSeqV.neg?.im ?? 0) - (pr.currentSeqV.neg?.im ?? 0)),
                  }
                : undefined,
            zero:
              sequences === 3
                ? {
                    re:
                      (pr.currentSeqV.zero?.re ?? 0) +
                      alpha * ((pr.targetSeqV.zero?.re ?? 0) - (pr.currentSeqV.zero?.re ?? 0)),
                    im:
                      (pr.currentSeqV.zero?.im ?? 0) +
                      alpha * ((pr.targetSeqV.zero?.im ?? 0) - (pr.currentSeqV.zero?.im ?? 0)),
                  }
                : undefined,
          };
        } else {
          // Extrapolate positive-sequence magnitude/angle; hold neg/zero across macro-step
          const fakePortState = {
            currentVmPu: Math.hypot(pr.currentSeqV.pos.re, pr.currentSeqV.pos.im),
            currentVaRad: Math.atan2(pr.currentSeqV.pos.im, pr.currentSeqV.pos.re),
            historyVm: pr.historyVm,
            historyVa: pr.historyVa,
          } as ActivePortState;
          const { vm, va } = extrapolateVoltage(fakePortState, tSec, extrapMode);
          seqV = {
            pos: { re: vm * Math.cos(va), im: vm * Math.sin(va) },
            neg: sequences === 3 ? pr.currentSeqV.neg : undefined,
            zero: sequences === 3 ? pr.currentSeqV.zero : undefined,
          };
        }

        const v3 = synthesizeThreePhaseFromSequences(seqV, omega0, tSec, pr.vPeakPhaseVolts);
        return {
          ea: v3.a,
          eb: v3.b,
          ec: v3.c,
          gSrc: pr.gSelf,
          gMatrix3x3: pr.gMatrix3x3,
          mutualCouplings: pr.mutualCouplings,
          iHistA: 0.0,
          iHistB: 0.0,
          iHistC: 0.0,
        };
      },
    }));
  };

  // Initialize all EMT plants concurrently with t=0 steady-state boundary conditions
  await Promise.all(
    activePlants.map(async (pl) => {
      const emtInitMap = new Map<string, PhasorBoundaryBusVoltage>();
      for (const bp of pl.boundaryPorts) {
        const bv = initRes.boundaryVoltages.get(bp.phasorBusId);
        if (bv) emtInitMap.set(bp.emtBusId, bv);
      }
      await pl.participant.initialize({
        durationSec,
        dtEmtSec,
        frequencyHz: f0,
        boundaryBusIds: pl.boundaryPorts.map((bp) => bp.emtBusId),
        initialBoundaryVoltages: emtInitMap,
        initialFeeds: buildPlantFeeds(pl.id, 0.0, dtTsSec),
      });
    }),
  );

  // ── Phase 2: True Lock-Stepped Macro-Step Loop ──
  const macroRecords: HybridMacroRecord[] = [];
  let topologyUpdates = 0;
  let totalPicardIterations = 0;
  let topologyChangedFlag = false;

  const canRollback =
    maxIterations > 1 &&
    typeof activePhasor.getState === "function" &&
    typeof activePhasor.setState === "function" &&
    activePlants.every(
      (pl) => typeof pl.participant.getState === "function" && typeof pl.participant.setState === "function",
    );

  for (let k = 0; k < totalMacroSteps; k++) {
    const tMacro = k * dtTsSec;

    // Optional snapshots for Picard waveform relaxation (supports both sync and async worker threads)
    const phasorSnap = canRollback ? await activePhasor.getState!() : undefined;
    const plantSnaps = canRollback ? await Promise.all(activePlants.map((pl) => pl.participant.getState!())) : [];
    const portSnaps = canRollback
      ? portStates.map((pr) => ({
          recentIa: pr.recentIa.slice(),
          recentIb: pr.recentIb.slice(),
          recentIc: pr.recentIc.slice(),
          fdne: pr.fdne?.captureState(),
        }))
      : [];

    for (const pr of portStates) {
      pr.targetSeqV = null;
    }

    let stepRes!: Awaited<ReturnType<PhasorNetworkParticipant["stepMacro"]>>;
    let itersUsed = 0;

    for (let iter = 0; iter < (canRollback ? maxIterations : 1); iter++) {
      itersUsed = iter + 1;
      totalPicardIterations++;

      if (iter > 0 && canRollback) {
        await activePhasor.setState!(phasorSnap);
        await Promise.all(activePlants.map(async (pl, pi) => pl.participant.setState!(plantSnaps[pi])));
        for (let ri = 0; ri < portStates.length; ri++) {
          const ps = portStates[ri]!;
          const snap = portSnaps[ri]!;
          ps.recentIa = snap.recentIa.slice();
          ps.recentIb = snap.recentIb.slice();
          ps.recentIc = snap.recentIc.slice();
          if (ps.fdne && snap.fdne) ps.fdne.restoreState(snap.fdne);
        }
      }

      // 2a. Advance all EMT plants concurrently by M micro-steps
      const emtStepResults = await Promise.all(
        activePlants.map(async (pl) =>
          pl.participant.stepSubSteps(
            tMacro,
            dtEmtSec,
            ratioM,
            buildPlantFeeds(pl.id, tMacro, dtTsSec),
            topologyChangedFlag,
          ),
        ),
      );

      // 2b. Collect instantaneous boundary currents
      for (let pi = 0; pi < activePlants.length; pi++) {
        const pl = activePlants[pi]!;
        const emtRes = emtStepResults[pi]!;
        const plantPorts = portStates.filter((ps) => ps.plantId === pl.id);
        for (const pr of plantPorts) {
          const curr = emtRes.boundaryCurrents.get(pr.port.emtBusId);
          if (curr) {
            for (let s = 0; s < curr.ia.length; s++) {
              pr.recentIa.push(curr.ia[s]!);
              pr.recentIb.push(curr.ib[s]!);
              pr.recentIc.push(curr.ic[s]!);
            }
            const maxWin = Math.max(nCycleSamples, ratioM * 2);
            if (pr.recentIa.length > maxWin) {
              const drop = pr.recentIa.length - maxWin;
              pr.recentIa.splice(0, drop);
              pr.recentIb.splice(0, drop);
              pr.recentIc.splice(0, drop);
            }
          }
        }
      }

      // 2c. Extract fundamental sequence phasors (I_1, I_2, I_0) with optional frequency tracking
      const injectionsByBus = new Map<string, PhasorBoundaryInjection>();
      for (const busId of uniquePhasorBusIds) {
        injectionsByBus.set(busId, {
          busId,
          currentPu: { pos: { re: 0, im: 0 }, neg: { re: 0, im: 0 }, zero: { re: 0, im: 0 } },
        });
      }

      for (const pr of portStates) {
        const fDft = trackFrequency ? pr.trackedFreqHz : f0;
        const tWinEnd = tMacro + dtTsSec;
        const fa = extractFundamentalPhasor(pr.recentIa, dtEmtSec, f0, fDft, tWinEnd);
        const fb = extractFundamentalPhasor(pr.recentIb, dtEmtSec, f0, fDft, tWinEnd);
        const fc = extractFundamentalPhasor(pr.recentIc, dtEmtSec, f0, fDft, tWinEnd);
        const seqI = toSequencePhasors(fa, fb, fc);

        const scale = 1.0 / (Math.SQRT2 * pr.iBaseAmpRms);
        const injPos: ComplexPhasor = { re: seqI.pos.re * scale, im: seqI.pos.im * scale };
        const injNeg: ComplexPhasor =
          sequences === 3 && seqI.neg ? { re: seqI.neg.re * scale, im: seqI.neg.im * scale } : { re: 0, im: 0 };
        const injZero: ComplexPhasor =
          sequences === 3 && seqI.zero ? { re: seqI.zero.re * scale, im: seqI.zero.im * scale } : { re: 0, im: 0 };

        pr.lastInjSeqPu = { pos: injPos, neg: injNeg, zero: injZero };

        const agg = injectionsByBus.get(pr.port.phasorBusId)!;
        agg.currentPu.pos.re += injPos.re;
        agg.currentPu.pos.im += injPos.im;
        if (sequences === 3) {
          agg.currentPu.neg!.re += injNeg.re;
          agg.currentPu.neg!.im += injNeg.im;
          agg.currentPu.zero!.re += injZero.re;
          agg.currentPu.zero!.im += injZero.im;
        }
      }

      // 2d. Advance Phasor network one macro-step Δt_TS
      stepRes = await activePhasor.stepMacro(tMacro, dtTsSec, Array.from(injectionsByBus.values()));

      // Check Picard convergence if enabled
      if (canRollback && iter + 1 < maxIterations) {
        let maxResidual = 0.0;
        for (const pr of portStates) {
          const newV = stepRes.boundaryVoltages.get(pr.port.phasorBusId)?.voltagePu;
          if (!newV) continue;
          const refV = pr.targetSeqV ?? pr.currentSeqV;
          const resPos = Math.hypot(newV.pos.re - refV.pos.re, newV.pos.im - refV.pos.im);
          if (resPos > maxResidual) maxResidual = resPos;
          pr.targetSeqV = newV;
        }
        if (maxResidual <= iterTol) break;
      }
    }

    // 2e. Commit macro-step boundary voltages and topology updates
    const tNext = tMacro + dtTsSec;
    topologyChangedFlag = Boolean(stepRes.topologyChanged);
    if (topologyChangedFlag) {
      topologyUpdates++;
      const newEquiv = stepRes.boundaryEquivalent ?? activePhasor.computeBoundaryEquivalent(uniquePhasorBusIds);
      if (useDynamicEquivalent && newEquiv) {
        for (const pr of portStates) {
          updatePortConductanceFromEquivalent(pr, newEquiv, sequences, useFdne, dtEmtSec, f0, portStates, activePhasor);
        }
      }
    }

    for (const pr of portStates) {
      const bv = stepRes.boundaryVoltages.get(pr.port.phasorBusId);
      if (bv) {
        pr.prevSeqV = pr.currentSeqV;
        pr.currentSeqV = bv.voltagePu;
        if (bv.freqHz && Number.isFinite(bv.freqHz) && bv.freqHz > 10.0) {
          pr.trackedFreqHz = bv.freqHz;
        }
        pr.historyVm.push({ t: tNext, vm: bv.vmPu });
        pr.historyVa.push({ t: tNext, va: bv.vaRad });
        if (pr.historyVm.length > 5) {
          pr.historyVm.shift();
          pr.historyVa.shift();
        }
        // Reset extrapolation history on topology discontinuity (fault inception/clearing)
        if (topologyChangedFlag) {
          pr.historyVm = [{ t: tNext, vm: bv.vmPu }];
          pr.historyVa = [{ t: tNext, va: bv.vaRad }];
        }

        const vNegMag = bv.voltagePu.neg ? Math.hypot(bv.voltagePu.neg.re, bv.voltagePu.neg.im) : 0.0;
        const vZeroMag = bv.voltagePu.zero ? Math.hypot(bv.voltagePu.zero.re, bv.voltagePu.zero.im) : 0.0;
        const iPosMagPu = Math.hypot(pr.lastInjSeqPu.pos.re, pr.lastInjSeqPu.pos.im);

        macroRecords.push({
          timeSec: Number(tNext.toFixed(4)),
          plantId: pr.plantId,
          phasorBusId: pr.port.phasorBusId,
          emtBusId: pr.port.emtBusId,
          vTsMagPu: Number(bv.vmPu.toFixed(4)),
          vTsAngleDeg: Number(((bv.vaRad * 180.0) / Math.PI).toFixed(2)),
          vNegMagPu: Number(vNegMag.toFixed(4)),
          vZeroMagPu: Number(vZeroMag.toFixed(4)),
          vEmtPeakKv: Number((bv.vmPu * pr.vPeakPhaseVolts * 1e-3).toFixed(2)),
          iEmtInjAmpRms: Number((iPosMagPu * pr.iBaseAmpRms).toFixed(1)),
          iTsInjPuRe: Number(pr.lastInjSeqPu.pos.re.toFixed(4)),
          iTsInjPuIm: Number(pr.lastInjSeqPu.pos.im.toFixed(4)),
          gSelfSiemens: Number(pr.gSelf.toFixed(4)),
          picardIterations: itersUsed,
        });
      }
    }
  }

  // ── Phase 3: Finalize All Participants ──
  const phasorTrajectory = await activePhasor.finalize();
  const plantTrajectories = new Map<string, EmtTrajectoryResult>();
  const finalizedPlants = await Promise.all(activePlants.map(async (pl) => pl.participant.finalize()));
  for (let i = 0; i < activePlants.length; i++) {
    plantTrajectories.set(activePlants[i]!.id, finalizedPlants[i]!);
  }

  return {
    mode,
    sequences,
    usedFdne: useFdne,
    macroRecords,
    totalMacroSteps,
    totalEmtSubSteps: totalMacroSteps * ratioM,
    ratioM,
    wallClockTimeMs: Date.now() - tStartWall,
    plantCount: activePlants.length,
    topologyUpdates,
    totalPicardIterations,
    phasorTrajectory,
    plantTrajectories,
  };
}

/**
 * Stateful Generic Polyglot Phasor <-> EMT Coupler.
 */
export class PhasorEmtCoupler {
  private readonly options: HybridPhasorEmtOptions;
  private readonly plants: Map<string, HybridEmtPlantConfig> = new Map();

  constructor(options?: HybridPhasorEmtOptions) {
    this.options = { ...options };
  }

  public addPlant(plant: HybridEmtPlantConfig): this {
    this.plants.set(plant.id, plant);
    return this;
  }

  public removePlant(id: string): boolean {
    return this.plants.delete(id);
  }

  public run(phasor: PhasorNetworkParticipant): Promise<HybridPhasorEmtResult> {
    return runHybridPhasorEmtCoSimulation(phasor, Array.from(this.plants.values()), this.options);
  }
}
