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
  }) => any | Promise<any>;
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
  plantTrajectories: Map<string, any>;
}

/**
 * Computes fundamental frequency Discrete Fourier Transform (DFT) phasor
 * from a discrete sampled waveform over a full cycle window.
 */
export function extractFundamentalPhasor(
  samples: Float64Array | number[],
  dt: number,
  f0: number,
): { re: number; im: number; mag: number; phaseRad: number } {
  const nCycle = Math.max(4, Math.round(1.0 / (f0 * dt)));
  const len = samples.length;
  if (len === 0) return { re: 0, im: 0, mag: 0, phaseRad: 0 };

  const start = Math.max(0, len - nCycle);
  const count = len - start;
  let sumRe = 0.0;
  let sumIm = 0.0;

  for (let i = 0; i < count; i++) {
    const idx = start + i;
    const val = typeof samples[idx] === "number" ? (samples[idx] as number) : 0.0;
    const theta = 2.0 * Math.PI * f0 * i * dt;
    sumRe += val * Math.cos(theta);
    sumIm -= val * Math.sin(theta);
  }

  const factor = 2.0 / count;
  const re = sumRe * factor;
  const im = sumIm * factor;
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
  }) => any | Promise<any>,
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
  const plantTrajectories = new Map<string, any>();
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
    }) => any | Promise<any>,
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
  }) => any,
  pscadRunner: (options: {
    durationSec: number;
    timeStepSec: number;
    boundaryFeeds: Array<{
      busId: string;
      thevenin?: (t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined;
      currentInjection?: (t: number) => { ia: number; ib: number; ic: number } | undefined;
    }>;
    onStep?: (t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void;
  }) => any,
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
    emtTrajectory: multiResult.plantTrajectories.get("EMT_Plant_1"),
  };
}
