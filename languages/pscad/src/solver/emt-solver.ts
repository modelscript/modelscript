// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/pscad — Native WebAssembly-Ready Dommel Companion-Circuit EMT Solver
 *
 * Implements a high-performance, chatter-free Electromagnetic Transients (EMT)
 * simulation kernel for 3-phase AC/DC transmission networks:
 * - Direct Nodal Conductance Formulation: G * v(t) = j(t) - i_hist(t - dt)
 * - Dommel companion branch discretization for R, L, C, transformers, lines
 * - Critical Damping Adjustment (CDA) for trapezoidal switching chatter suppression
 * - Pre-allocated contiguous matrix memory with cached LU decomposition ($O(N^2)$ stepping)
 * - Dynamic fault impedance injection (3PH, SLG, DLG, LL) & IBR LVRT current control
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
import type { EmtNetlist } from "../types.js";

export interface EmtSolverOptions {
  timeStepSec: number;
  durationSec: number;
  nominalFrequencyHz?: number | undefined;
  /** Whether to enable Critical Damping Adjustment (CDA) to eliminate switching chatter. Default: true. */
  enableCda?: boolean | undefined;
  /** Maximum number of simulation steps. Default: 50,000. */
  maxSteps?: number | undefined;
  /** Whether to execute via native WebAssembly companion solver kernel. Default: false. */
  useWasm?: boolean | undefined;
}

export interface EmtSolverMetrics {
  totalSteps: number;
  luFactorizations: number;
  switchingEvents: number;
  chatterDampedSteps: number;
  executionTimeMs: number;
}

export interface EmtSolverResult {
  time: Float64Array;
  busVoltages: Map<string, Float64Array>;
  busPhaseVoltages: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  branchCurrents: Map<string, Float64Array>;
  branchPhaseCurrents: Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>;
  /** Per-phase bus voltage maps (aliases for busPhaseVoltages). */
  vA: Map<string, Float64Array>;
  vB: Map<string, Float64Array>;
  vC: Map<string, Float64Array>;
  /** Per-phase branch current maps (aliases for branchPhaseCurrents). */
  iA: Map<string, Float64Array>;
  iB: Map<string, Float64Array>;
  iC: Map<string, Float64Array>;
  controlSignals?: Map<string, Float64Array> | undefined;
  metrics: EmtSolverMetrics;
}

interface CompanionBranch {
  id: string;
  fromIdx: number;
  toIdx: number;
  rOhm: number;
  lHenry: number;
  cFarad: number;
  gEq: number;
  /** Mutual phase-to-phase companion conductance when zero-sequence / mutual coupling is present. */
  gMut: number;
  alphaHist: number;
  alphaMutHist: number;
  shuntG: number;
  windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" | undefined;
  iHistA: number;
  iHistB: number;
  iHistC: number;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface BergeronLineState {
  id: string;
  fromIdx: number;
  toIdx: number;
  zChar: number;
  gBerg: number;
  hLoss: number;
  delaySteps: number;
  fracDelay: number;
  bufLen: number;
  ptr: number;
  vkBufA: Float64Array;
  vkBufB: Float64Array;
  vkBufC: Float64Array;
  vmBufA: Float64Array;
  vmBufB: Float64Array;
  vmBufC: Float64Array;
  ikmBufA: Float64Array;
  ikmBufB: Float64Array;
  ikmBufC: Float64Array;
  imkBufA: Float64Array;
  imkBufB: Float64Array;
  imkBufC: Float64Array;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface SyncGenState {
  id: string;
  busIdx: number;
  ratedMva: number;
  vPeak: number;
  iBasePeak: number;
  omega0: number;
  gGen: number;
  xdSubPu: number;
  xqSubPu: number;
  hSec: number;
  dampingPu: number;
  pmPu: number;
  efPu: number;
  deltaRad: number;
  omegaRadSec: number;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
  deltaTraj: Float64Array;
  omegaTraj: Float64Array;
  speedPuTraj: Float64Array;
  peTraj: Float64Array;
  vdTraj: Float64Array;
  vqTraj: Float64Array;
  idTraj: Float64Array;
  iqTraj: Float64Array;
}

interface SwitchLike {
  id: string;
  fromBus: string;
  toBus: string;
  initialClosed?: boolean | undefined;
  actionTimeSec: number;
  rClosedOhm?: number | undefined;
  rOpenOhm?: number | undefined;
}

interface LegacyBranchLike {
  id: string;
  fromBus?: string | undefined;
  toBus?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  kind?: string | undefined;
  resistanceOhm?: number | undefined;
  rOhm?: number | undefined;
  r?: number | undefined;
  inductanceH?: number | undefined;
  lHenry?: number | undefined;
  lH?: number | undefined;
  l?: number | undefined;
  capacitanceF?: number | undefined;
  cFarad?: number | undefined;
  cF?: number | undefined;
  c?: number | undefined;
  r0Ohm?: number | undefined;
  l0Henry?: number | undefined;
  mutualInductanceH?: number | undefined;
  status?: "closed" | "open" | undefined;
  openTimeSec?: number | undefined;
  closeTimeSec?: number | undefined;
  rClosedOhm?: number | undefined;
  rOpenOhm?: number | undefined;
}

interface LegacyLineLike {
  id: string;
  fromBus?: string | undefined;
  toBus?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  rTotalOhm?: number | undefined;
  lTotalHenry?: number | undefined;
  cTotalFarad?: number | undefined;
  lengthKm?: number | undefined;
  rPerKm?: number | undefined;
  lPerKm?: number | undefined;
  cPerKm?: number | undefined;
  modelType?: "bergeron" | "pi" | "fdpm" | undefined;
}

interface LegacyTransformerLike {
  id: string;
  primaryKv?: number | undefined;
  secondaryKv?: number | undefined;
  ratedMva?: number | undefined;
  mvaRating?: number | undefined;
  mva?: number | undefined;
  leakageXPu?: number | undefined;
  xLeakagePu?: number | undefined;
  leakageReactancePu?: number | undefined;
  primaryBus?: string | undefined;
  fromBus?: string | undefined;
  secondaryBus?: string | undefined;
  toBus?: string | undefined;
  windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" | undefined;
}

interface LegacySourceLike {
  bus: string;
  rSourceOhm?: number | undefined;
  rSource?: number | undefined;
  lSourceHenry?: number | undefined;
  lSourceH?: number | undefined;
  voltageKv?: number | undefined;
  vPeakKv?: number | undefined;
  kv?: number | undefined;
  frequencyHz?: number | undefined;
  freqHz?: number | undefined;
  phaseDeg?: number | undefined;
  phaseAngleDeg?: number | undefined;
  phaseRad?: number | undefined;
}

interface LegacyNetlistExtensions {
  lines?: LegacyLineLike[] | undefined;
  switches?: SwitchLike[] | undefined;
  rlc?: LegacyBranchLike[] | undefined;
  breakers?:
    | {
        id: string;
        from: string;
        to: string;
        closedInitially?: boolean | undefined;
        openTimeSec?: number | undefined;
        closeTimeSec?: number | undefined;
        rClosedOhm?: number | undefined;
        rOpenOhm?: number | undefined;
      }[]
    | undefined;
}

interface EmtWasmExports {
  memory: WebAssembly.Memory;
  emt_create: (nNodes: number, maxBranches: number, maxSources: number, dt: number) => number;
  emt_add_branch: (
    solverPtr: number,
    fromNode: number,
    toNode: number,
    rOhm: number,
    lHenry: number,
    cFarad: number,
  ) => number;
  emt_add_source: (
    solverPtr: number,
    nodeIdx: number,
    vPeakKv: number,
    freqHz: number,
    phaseRad: number,
    gSrc: number,
    active: number,
  ) => void;
  emt_build_and_factorize: (solverPtr: number) => number | boolean;
  emt_get_voltages_ptr: (solverPtr: number) => number;
  emt_step: (solverPtr: number) => void;
  emt_get_branch_current: (solverPtr: number, branchIdx: number) => number;
}

interface SwitchState {
  sw: SwitchLike;
  fromIdx: number;
  toIdx: number;
  currentClosed: boolean;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface FmuState {
  fmu: {
    id: string;
    busConnection?: string | undefined;
    bus?: string | undefined;
    ratedMva: number;
    ratedKv: number;
  };
  busIdx: number;
  iRatedPeak: number;
  iqState: number;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface BusInfo {
  id: string;
  baseKv: number;
  vPeak: number;
}

interface SourceInfo {
  vPeak: number;
  freqRad: number;
  phaseRad: number;
  gSrc: number;
}

/**
 * High-performance, zero-allocation native Dommel companion-circuit EMT solver.
 * Solves the coupled 3N x 3N phase-domain (abc) nodal conductance system:
 *   G_abc * v_abc(t) = j_abc(t) - i_hist,abc(t - dt)
 * with Bergeron traveling-wave transmission lines and Park dq0 synchronous machines.
 */
export class EmtSolver {
  private readonly netlist: EmtNetlist;
  private readonly timeStepSec: number;
  private readonly durationSec: number;
  private readonly omega: number;
  private readonly enableCda: boolean;
  private readonly nSteps: number;

  private readonly busList: BusInfo[] = [];
  private readonly busIdxMap = new Map<string, number>();
  private readonly companionBranches: CompanionBranch[] = [];
  private readonly bergeronLines: BergeronLineState[] = [];
  private readonly syncGenerators: SyncGenState[] = [];
  private readonly switchStates: SwitchState[] = [];
  private readonly fmuStates: FmuState[] = [];
  private readonly busSources = new Map<number, SourceInfo[]>();
  private readonly defaultSrcR: number;

  private nBuses: number = 0;
  private nPhaseNodes: number = 0;
  private time!: Float64Array;
  private busVoltages = new Map<string, Float64Array>();
  private busPhaseVoltages = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();
  private branchCurrents = new Map<string, Float64Array>();
  private branchPhaseCurrents = new Map<string, { a: Float64Array; b: Float64Array; c: Float64Array }>();
  private vA = new Map<string, Float64Array>();
  private vB = new Map<string, Float64Array>();
  private vC = new Map<string, Float64Array>();
  private iA = new Map<string, Float64Array>();
  private iB = new Map<string, Float64Array>();
  private iC = new Map<string, Float64Array>();
  private controlSignals = new Map<string, Float64Array>();

  // Coupled 3N x 3N phase-domain nodal conductance matrix & RHS vector
  private G3!: Float64Array;
  private J3!: Float64Array;
  private LU3!: Float64Array;
  private piv3!: Int32Array;
  private v3Step!: Float64Array;
  private luValid: boolean = false;

  // Solved step per-phase views
  private vaStep!: Float64Array;
  private vbStep!: Float64Array;
  private vcStep!: Float64Array;

  // Metrics
  private luFactorizationCount: number = 0;
  private switchingEventCount: number = 0;
  private chatterDampedCount: number = 0;

  private readonly useWasm: boolean;

  constructor(netlist: EmtNetlist, options: EmtSolverOptions) {
    this.netlist = netlist;
    this.timeStepSec = Math.max(1e-7, options.timeStepSec);
    this.durationSec = Math.max(this.timeStepSec * 2, options.durationSec);
    this.omega = 2 * Math.PI * (options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0);
    this.enableCda = options.enableCda ?? true;
    this.useWasm = options.useWasm ?? false;

    const maxSteps = options.maxSteps ?? 50000;
    this.nSteps = Math.max(10, Math.min(maxSteps, Math.floor(this.durationSec / this.timeStepSec)));

    this.defaultSrcR =
      netlist.sources?.[0]?.rSourceOhm !== undefined && netlist.sources[0].rSourceOhm > 0
        ? netlist.sources[0].rSourceOhm
        : 1.5;

    this.initializeTopology();
  }

  private registerBranchBuffers(id: string): { ia: Float64Array; ib: Float64Array; ic: Float64Array } {
    const ia = new Float64Array(this.nSteps);
    const ib = new Float64Array(this.nSteps);
    const ic = new Float64Array(this.nSteps);
    this.branchCurrents.set(id, ia);
    this.branchPhaseCurrents.set(id, { a: ia, b: ib, c: ic });
    this.iA.set(id, ia);
    this.iB.set(id, ib);
    this.iC.set(id, ic);
    return { ia, ib, ic };
  }

  private initializeTopology(): void {
    this.time = new Float64Array(this.nSteps);
    for (let k = 0; k < this.nSteps; k++) {
      this.time[k] = k * this.timeStepSec;
    }

    // Index non-ground buses (supporting both Map<string, EmtBus> and string[] from netlistToEmtCircuit)
    const rawBuses = this.netlist.buses as unknown;
    if (rawBuses instanceof Map) {
      for (const [busId, bus] of rawBuses.entries()) {
        if (busId === "0" || busId === "GND") continue;
        const baseKv = bus?.baseKv > 0 ? bus.baseKv : 230.0;
        this.busIdxMap.set(busId, this.busList.length);
        this.busList.push({ id: busId, baseKv, vPeak: baseKv * 1e3 });
        const a = new Float64Array(this.nSteps);
        const b = new Float64Array(this.nSteps);
        const c = new Float64Array(this.nSteps);
        this.busPhaseVoltages.set(busId, { a, b, c });
        this.vA.set(busId, a);
        this.vB.set(busId, b);
        this.vC.set(busId, c);
      }
    } else if (Array.isArray(rawBuses)) {
      for (const item of rawBuses) {
        const busId = typeof item === "string" ? item : item?.id;
        if (!busId || busId === "0" || busId === "GND") continue;
        const baseKv = typeof item === "object" && item?.baseKv > 0 ? item.baseKv : 230.0;
        this.busIdxMap.set(busId, this.busList.length);
        this.busList.push({ id: busId, baseKv, vPeak: baseKv * 1e3 });
        const a = new Float64Array(this.nSteps);
        const b = new Float64Array(this.nSteps);
        const c = new Float64Array(this.nSteps);
        this.busPhaseVoltages.set(busId, { a, b, c });
        this.vA.set(busId, a);
        this.vB.set(busId, b);
        this.vC.set(busId, c);
      }
    }

    this.nBuses = this.busList.length;
    this.nPhaseNodes = 3 * this.nBuses;
    if (this.nBuses === 0) return;

    // Allocate coupled 3N x 3N phase-domain contiguous working memory
    const n3 = this.nPhaseNodes;
    this.G3 = new Float64Array(n3 * n3);
    this.LU3 = new Float64Array(n3 * n3);
    this.piv3 = new Int32Array(n3);
    this.J3 = new Float64Array(n3);
    this.v3Step = new Float64Array(n3);

    this.vaStep = new Float64Array(this.nBuses);
    this.vbStep = new Float64Array(this.nBuses);
    this.vcStep = new Float64Array(this.nBuses);

    // Register companion branches
    const addCompanion = (
      id: string,
      fromBus: string,
      toBus: string,
      rOhm: number,
      lHenry: number,
      cFarad: number = 0,
      r0Ohm?: number,
      l0Henry?: number,
      windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D",
    ) => {
      const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (this.busIdxMap.get(fromBus) ?? -1);
      const toIdx = toBus === "0" || toBus === "GND" ? -1 : (this.busIdxMap.get(toBus) ?? -1);
      if (fromIdx === -1 && toIdx === -1) return;

      const R1 = Math.max(rOhm, 1e-4);
      const L1 = Math.max(lHenry, 0.0);
      const denom1 = 2.0 * L1 + R1 * this.timeStepSec;
      const g1 = denom1 > 1e-12 ? this.timeStepSec / denom1 : 1.0 / R1;
      const alpha1 = denom1 > 1e-12 ? (2.0 * L1 - R1 * this.timeStepSec) / denom1 : 0.0;

      let gEq = g1;
      let gMut = 0.0;
      let alphaHist = alpha1;
      let alphaMutHist = 0.0;

      if ((r0Ohm !== undefined && r0Ohm > R1) || (l0Henry !== undefined && l0Henry > L1)) {
        const R0 = Math.max(r0Ohm ?? R1, R1);
        const L0 = Math.max(l0Henry ?? L1, L1);
        const denom0 = 2.0 * L0 + R0 * this.timeStepSec;
        const g0 = denom0 > 1e-12 ? this.timeStepSec / denom0 : 1.0 / R0;
        const alpha0 = denom0 > 1e-12 ? (2.0 * L0 - R0 * this.timeStepSec) / denom0 : 0.0;
        gEq = (2.0 * g1 + g0) / 3.0;
        gMut = (g0 - g1) / 3.0;
        alphaHist = (2.0 * alpha1 + alpha0) / 3.0;
        alphaMutHist = (alpha0 - alpha1) / 3.0;
      }

      const shuntG = cFarad > 0 ? (2.0 * cFarad) / this.timeStepSec : 0.0;
      const { ia, ib, ic } = this.registerBranchBuffers(id);

      this.companionBranches.push({
        id,
        fromIdx,
        toIdx,
        rOhm: R1,
        lHenry: L1,
        cFarad,
        gEq,
        gMut,
        alphaHist,
        alphaMutHist,
        shuntG,
        windingConnection,
        iHistA: 0,
        iHistB: 0,
        iHistC: 0,
        ia,
        ib,
        ic,
      });
    };

    // Helper to register Bergeron distributed traveling-wave line or fallback pi-section
    const addTransmissionLine = (ln: LegacyLineLike) => {
      const fromBus = ln.fromBus ?? ln.from ?? "0";
      const toBus = ln.toBus ?? ln.to ?? "0";
      const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (this.busIdxMap.get(fromBus) ?? -1);
      const toIdx = toBus === "0" || toBus === "GND" ? -1 : (this.busIdxMap.get(toBus) ?? -1);
      if (fromIdx === -1 && toIdx === -1) return;

      const lengthKm = ln.lengthKm ?? 0;
      const rTotal = ln.rTotalOhm ?? (lengthKm > 0 ? (ln.rPerKm ?? 0.03) * lengthKm : 1.0);
      const lTotal = ln.lTotalHenry ?? (lengthKm > 0 ? (ln.lPerKm ?? 0.001) * lengthKm : 0.01);
      const cTotal = ln.cTotalFarad ?? (lengthKm > 0 ? (ln.cPerKm ?? 1.1e-8) * lengthKm : 0.0);
      const modelType = ln.modelType ?? (lengthKm > 0 && cTotal > 0 ? "bergeron" : "pi");

      const tau = lTotal > 0 && cTotal > 0 ? Math.sqrt(lTotal * cTotal) : 0;
      if (modelType !== "pi" && tau >= this.timeStepSec && fromIdx >= 0 && toIdx >= 0) {
        const zChar = Math.sqrt(lTotal / cTotal);
        const rQuarter = 0.25 * Math.max(0, rTotal);
        const zBerg = Math.max(1e-3, zChar + rQuarter);
        const gBerg = 1.0 / zBerg;
        const hLoss = Math.max(-0.999, Math.min(1.0, (zChar - rQuarter) / zBerg));
        const exactSteps = tau / this.timeStepSec;
        const delaySteps = Math.max(1, Math.floor(exactSteps));
        const fracDelay = Math.max(0, Math.min(1, exactSteps - delaySteps));
        const bufLen = delaySteps + 3;
        const { ia, ib, ic } = this.registerBranchBuffers(ln.id);

        this.bergeronLines.push({
          id: ln.id,
          fromIdx,
          toIdx,
          zChar,
          gBerg,
          hLoss,
          delaySteps,
          fracDelay,
          bufLen,
          ptr: 0,
          vkBufA: new Float64Array(bufLen),
          vkBufB: new Float64Array(bufLen),
          vkBufC: new Float64Array(bufLen),
          vmBufA: new Float64Array(bufLen),
          vmBufB: new Float64Array(bufLen),
          vmBufC: new Float64Array(bufLen),
          ikmBufA: new Float64Array(bufLen),
          ikmBufB: new Float64Array(bufLen),
          ikmBufC: new Float64Array(bufLen),
          imkBufA: new Float64Array(bufLen),
          imkBufB: new Float64Array(bufLen),
          imkBufC: new Float64Array(bufLen),
          ia,
          ib,
          ic,
        });
      } else {
        addCompanion(ln.id, fromBus, toBus, rTotal || 1.0, lTotal || 0.01, cTotal || 0);
      }
    };

    const netlistExt = this.netlist as EmtNetlist & LegacyNetlistExtensions;

    for (const br of (this.netlist.branches ?? []) as LegacyBranchLike[]) {
      if (br.kind === "switch") {
        const fromBus = br.fromBus ?? br.from ?? "0";
        const toBus = br.toBus ?? br.to ?? "0";
        const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (this.busIdxMap.get(fromBus) ?? -1);
        const toIdx = toBus === "0" || toBus === "GND" ? -1 : (this.busIdxMap.get(toBus) ?? -1);
        const { ia, ib, ic } = this.registerBranchBuffers(br.id);
        const initialClosed = br.status !== "open";
        const actionTimeSec = (initialClosed ? br.openTimeSec : br.closeTimeSec) ?? 1e9;
        this.switchStates.push({
          sw: {
            id: br.id,
            fromBus,
            toBus,
            initialClosed,
            actionTimeSec,
            rClosedOhm: br.rClosedOhm,
            rOpenOhm: br.rOpenOhm,
          },
          fromIdx,
          toIdx,
          currentClosed: initialClosed,
          ia,
          ib,
          ic,
        });
        continue;
      }
      const fromBus = br.fromBus ?? br.from ?? "0";
      const toBus = br.toBus ?? br.to ?? "0";
      const rVal = br.rOhm ?? br.resistanceOhm ?? br.r ?? 0.1;
      const lVal = br.lHenry ?? br.inductanceH ?? br.lH ?? br.l ?? 0;
      const cVal = br.cFarad ?? br.capacitanceF ?? br.cF ?? br.c ?? 0;
      const l0Val = br.l0Henry ?? (br.mutualInductanceH !== undefined ? lVal + 2 * br.mutualInductanceH : undefined);
      addCompanion(br.id, fromBus, toBus, rVal, lVal, cVal, br.r0Ohm, l0Val);
    }

    for (const br of netlistExt.rlc ?? []) {
      const fromBus = br.fromBus ?? br.from ?? "0";
      const toBus = br.toBus ?? br.to ?? "0";
      addCompanion(br.id, fromBus, toBus, br.r ?? br.rOhm ?? 0.1, br.l ?? br.lHenry ?? 0, br.c ?? br.cFarad ?? 0);
    }

    for (const ln of netlistExt.lines ?? []) {
      addTransmissionLine(ln);
    }
    for (const ln of (this.netlist.transmissionLines ?? []) as LegacyLineLike[]) {
      addTransmissionLine(ln);
    }

    for (const xf of (this.netlist.transformers ?? []) as LegacyTransformerLike[]) {
      const baseZ = (xf.primaryKv || 230.0) ** 2 / Math.max(xf.ratedMva || xf.mvaRating || xf.mva || 100.0, 1.0);
      const xOhm = Math.max((xf.leakageXPu || xf.xLeakagePu || xf.leakageReactancePu || 0.1) * baseZ, 0.05);
      const lHenry = xOhm / this.omega;
      addCompanion(
        xf.id,
        xf.primaryBus ?? xf.fromBus ?? "0",
        xf.secondaryBus ?? xf.toBus ?? "0",
        0.01 * baseZ,
        lHenry,
        0,
        undefined,
        undefined,
        xf.windingConnection,
      );
    }

    // Register switch states
    for (const sw of netlistExt.switches ?? []) {
      const fromIdx = sw.fromBus === "0" || sw.fromBus === "GND" ? -1 : (this.busIdxMap.get(sw.fromBus) ?? -1);
      const toIdx = sw.toBus === "0" || sw.toBus === "GND" ? -1 : (this.busIdxMap.get(sw.toBus) ?? -1);
      const { ia, ib, ic } = this.registerBranchBuffers(sw.id);
      this.switchStates.push({ sw, fromIdx, toIdx, currentClosed: Boolean(sw.initialClosed), ia, ib, ic });
    }
    for (const brk of netlistExt.breakers ?? []) {
      const fromIdx = brk.from === "0" || brk.from === "GND" ? -1 : (this.busIdxMap.get(brk.from) ?? -1);
      const toIdx = brk.to === "0" || brk.to === "GND" ? -1 : (this.busIdxMap.get(brk.to) ?? -1);
      const { ia, ib, ic } = this.registerBranchBuffers(brk.id);
      const initialClosed = brk.closedInitially ?? true;
      const actionTimeSec = (initialClosed ? brk.openTimeSec : brk.closeTimeSec) ?? 1e9;
      this.switchStates.push({
        sw: {
          id: brk.id,
          fromBus: brk.from,
          toBus: brk.to,
          initialClosed,
          actionTimeSec,
          rClosedOhm: brk.rClosedOhm,
          rOpenOhm: brk.rOpenOhm,
        },
        fromIdx,
        toIdx,
        currentClosed: initialClosed,
        ia,
        ib,
        ic,
      });
    }

    // Register Park dq0 synchronous generators
    for (const sm of this.netlist.synchronousMachines ?? []) {
      const busIdx = this.busIdxMap.get(sm.bus) ?? -1;
      if (busIdx < 0) continue;
      const ratedMva = Math.max(1e-3, sm.ratedMva || 100.0);
      const ratedKv = sm.ratedKvLL || this.busList[busIdx]?.baseKv || 230.0;
      const vPeak = ratedKv * 1e3;
      const zBase = (ratedKv * ratedKv) / ratedMva;
      const xdSubPu = Math.max(0.05, sm.xdSub ?? sm.xdPrime ?? sm.xd ?? 0.2);
      const xqSubPu = Math.max(0.05, sm.xqSub ?? sm.xqPrime ?? sm.xq ?? xdSubPu);
      const xSubOhm = Math.max(0.01, xdSubPu * zBase);
      const gGen = 1.0 / xSubOhm;
      const iBasePeak = vPeak / Math.max(1e-4, zBase);
      const freqHz = sm.frequencyHz || this.netlist.nominalFrequencyHz || 60.0;
      const omega0 = 2 * Math.PI * freqHz;
      const hSec = Math.max(0.1, sm.hInertiaSec ?? 3.5);
      const dampingPu = Math.max(0.0, sm.dampingPu ?? 2.0);
      const pmPu = sm.mechanicalPowerPu ?? 0.8;
      const efPu = Math.max(0.1, sm.fieldVoltagePu ?? 1.05);
      const sinDelta0 = Math.max(-0.85, Math.min(0.85, (pmPu * xdSubPu) / efPu));
      const delta0 = Math.asin(sinDelta0);

      const { ia, ib, ic } = this.registerBranchBuffers(sm.id);
      const deltaTraj = new Float64Array(this.nSteps);
      const omegaTraj = new Float64Array(this.nSteps);
      const speedPuTraj = new Float64Array(this.nSteps);
      const peTraj = new Float64Array(this.nSteps);
      const vdTraj = new Float64Array(this.nSteps);
      const vqTraj = new Float64Array(this.nSteps);
      const idTraj = new Float64Array(this.nSteps);
      const iqTraj = new Float64Array(this.nSteps);

      this.controlSignals.set(`${sm.id}_delta`, deltaTraj);
      this.controlSignals.set(`${sm.id}_omega`, omegaTraj);
      this.controlSignals.set(`${sm.id}_speedPu`, speedPuTraj);
      this.controlSignals.set(`${sm.id}_Pe`, peTraj);
      this.controlSignals.set(`${sm.id}_vd`, vdTraj);
      this.controlSignals.set(`${sm.id}_vq`, vqTraj);
      this.controlSignals.set(`${sm.id}_id`, idTraj);
      this.controlSignals.set(`${sm.id}_iq`, iqTraj);

      this.syncGenerators.push({
        id: sm.id,
        busIdx,
        ratedMva,
        vPeak,
        iBasePeak,
        omega0,
        gGen,
        xdSubPu,
        xqSubPu,
        hSec,
        dampingPu,
        pmPu,
        efPu,
        deltaRad: delta0,
        omegaRadSec: omega0,
        ia,
        ib,
        ic,
        deltaTraj,
        omegaTraj,
        speedPuTraj,
        peTraj,
        vdTraj,
        vqTraj,
        idTraj,
        iqTraj,
      });
    }

    // Register FMU / IBR converters
    for (const fmu of (this.netlist.fmuInstances ?? []) as FmuState["fmu"][]) {
      const busId = fmu.busConnection ?? fmu.bus ?? "";
      const busIdx = this.busIdxMap.get(busId) ?? 0;
      const busKv =
        (this.netlist.buses instanceof Map ? this.netlist.buses.get(busId)?.baseKv : undefined) ??
        (fmu.ratedKv > 0 ? fmu.ratedKv : 230.0);
      const iRatedPeak = ((fmu.ratedMva || 100.0) * 1e6) / (Math.max(0.1, busKv) * 1e3);
      const { ia, ib, ic } = this.registerBranchBuffers(fmu.id);
      this.fmuStates.push({ fmu, busIdx, iRatedPeak, iqState: 0.0, ia, ib, ic });
    }

    // Register sources
    for (const src of (this.netlist.sources ?? []) as LegacySourceLike[]) {
      const bIdx = this.busIdxMap.get(src.bus) ?? 0;
      const rSrcRaw = src.rSourceOhm ?? src.rSource;
      const rSrc = rSrcRaw !== undefined && rSrcRaw > 0 ? rSrcRaw : this.defaultSrcR;
      const rawLSrc = src.lSourceHenry ?? src.lSourceH ?? 0;
      const lSrc = rawLSrc > 0 ? rawLSrc : 0.0;
      const zSrc = Math.hypot(rSrc, this.omega * lSrc);
      const gSrc = 1.0 / Math.max(zSrc, 1e-4);
      const rawKv = src.voltageKv ?? src.vPeakKv ?? src.kv ?? 0;
      const vPeak = ((rawKv > 0 ? rawKv : this.busList[bIdx]?.baseKv) || 230.0) * 1e3;
      const freqRad = 2 * Math.PI * (src.frequencyHz || src.freqHz || this.netlist.nominalFrequencyHz || 60.0);
      const phaseRad =
        src.phaseRad !== undefined ? src.phaseRad : (((src.phaseDeg ?? src.phaseAngleDeg) || 0) * Math.PI) / 180.0;
      const list = this.busSources.get(bIdx) ?? [];
      list.push({ vPeak, freqRad, phaseRad, gSrc });
      this.busSources.set(bIdx, list);
    }

    // Islanded bus stabilization
    for (let i = 0; i < this.nBuses; i++) {
      const hasSyncGen = this.syncGenerators.some((g) => g.busIdx === i);
      if (!this.busSources.has(i) && !hasSyncGen) {
        const hasBranch =
          this.companionBranches.some((b) => b.fromIdx === i || b.toIdx === i) ||
          this.bergeronLines.some((l) => l.fromIdx === i || l.toIdx === i);
        const gStab = hasBranch ? 1e-5 : 1e-4;
        this.busSources.set(i, [{ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gStab }]);
      }
    }
  }

  /**
   * In-place LU factorization with partial pivoting for the coupled 3N x 3N phase-domain matrix.
   */
  private factorize3Phase(A: Float64Array, LU: Float64Array, piv: Int32Array): boolean {
    const n = this.nPhaseNodes;
    LU.set(A);
    for (let i = 0; i < n; i++) piv[i] = i;

    for (let p = 0; p < n; p++) {
      let maxVal = Math.abs(LU[p * n + p]!);
      let maxRow = p;
      for (let r = p + 1; r < n; r++) {
        const val = Math.abs(LU[r * n + p]!);
        if (val > maxVal) {
          maxVal = val;
          maxRow = r;
        }
      }
      if (maxVal < 1e-18) return false;

      if (maxRow !== p) {
        for (let c = 0; c < n; c++) {
          const tmp = LU[p * n + c]!;
          LU[p * n + c] = LU[maxRow * n + c]!;
          LU[maxRow * n + c] = tmp;
        }
        const tmpP = piv[p]!;
        piv[p] = piv[maxRow]!;
        piv[maxRow] = tmpP;
      }

      const pivot = LU[p * n + p]!;
      for (let r = p + 1; r < n; r++) {
        const factor = LU[r * n + p]! / pivot;
        LU[r * n + p] = factor;
        if (factor === 0) continue;
        for (let c = p + 1; c < n; c++) {
          LU[r * n + c] = LU[r * n + c]! - factor * LU[p * n + c]!;
        }
      }
    }
    return true;
  }

  /**
   * Fast forward and back substitution using precomputed 3N x 3N LU factors.
   */
  private solveFromLU3Phase(LU: Float64Array, piv: Int32Array, b: Float64Array, x: Float64Array): void {
    const n = this.nPhaseNodes;
    for (let i = 0; i < n; i++) {
      x[i] = b[piv[i]!]!;
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        x[i] = x[i]! - LU[i * n + j]! * x[j]!;
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) {
        x[i] = x[i]! - LU[i * n + j]! * x[j]!;
      }
      const diag = LU[i * n + i]!;
      x[i] = Math.abs(diag) > 1e-18 ? x[i]! / diag : 0.0;
    }
  }

  /**
   * Stamps a scalar conductance g between two scalar phase-node indices (p1, p2 in 0..3N-1).
   */
  private stampNodeAdmittance(p1: number, p2: number, g: number): void {
    const n3 = this.nPhaseNodes;
    if (p1 >= 0) this.G3[p1 * n3 + p1] = this.G3[p1 * n3 + p1]! + g;
    if (p2 >= 0) this.G3[p2 * n3 + p2] = this.G3[p2 * n3 + p2]! + g;
    if (p1 >= 0 && p2 >= 0) {
      this.G3[p1 * n3 + p2] = this.G3[p1 * n3 + p2]! - g;
      this.G3[p2 * n3 + p1] = this.G3[p2 * n3 + p1]! - g;
    }
  }

  /**
   * Stamps a 3x3 phase-coupled branch (self conductance gSelf, mutual conductance gMut)
   * between bus i and bus j in the 3N x 3N matrix G3.
   */
  private stamp3PhaseBranch(i: number, j: number, gSelf: number, gMut: number = 0): void {
    const n3 = this.nPhaseNodes;
    for (let p = 0; p < 3; p++) {
      const pi = i >= 0 ? 3 * i + p : -1;
      const pj = j >= 0 ? 3 * j + p : -1;
      this.stampNodeAdmittance(pi, pj, gSelf);
    }
    if (Math.abs(gMut) > 1e-18) {
      for (let p1 = 0; p1 < 3; p1++) {
        for (let p2 = 0; p2 < 3; p2++) {
          if (p1 === p2) continue;
          const pi1 = i >= 0 ? 3 * i + p1 : -1;
          const pi2 = i >= 0 ? 3 * i + p2 : -1;
          const pj1 = j >= 0 ? 3 * j + p1 : -1;
          const pj2 = j >= 0 ? 3 * j + p2 : -1;
          if (pi1 >= 0 && pi2 >= 0) {
            this.G3[pi1 * n3 + pi2] = this.G3[pi1 * n3 + pi2]! + gMut;
          }
          if (pj1 >= 0 && pj2 >= 0) {
            this.G3[pj1 * n3 + pj2] = this.G3[pj1 * n3 + pj2]! + gMut;
          }
          if (pi1 >= 0 && pj2 >= 0) {
            this.G3[pi1 * n3 + pj2] = this.G3[pi1 * n3 + pj2]! - gMut;
            this.G3[pj2 * n3 + pi1] = this.G3[pj2 * n3 + pi1]! - gMut;
          }
        }
      }
    }
  }

  /**
   * Delegates simulation to the native WebAssembly EMT companion solver kernel in linear memory.
   */
  private solveWithWasm(): EmtSolverResult | null {
    const wasm = getDefaultWasmExports() as Partial<EmtWasmExports> | null;
    if (
      !wasm ||
      typeof wasm.emt_create !== "function" ||
      typeof wasm.emt_add_branch !== "function" ||
      typeof wasm.emt_add_source !== "function" ||
      typeof wasm.emt_build_and_factorize !== "function" ||
      typeof wasm.emt_get_voltages_ptr !== "function" ||
      typeof wasm.emt_step !== "function" ||
      typeof wasm.emt_get_branch_current !== "function" ||
      !wasm.memory
    ) {
      return null;
    }

    try {
      const nNodes = this.nBuses * 3;
      const maxBranches = Math.max(32, (this.companionBranches.length + this.switchStates.length + 5) * 3);
      const maxSources = Math.max(16, (this.busSources.size + 5) * 3);
      const dt = this.timeStepSec;

      const solverPtr = wasm.emt_create(nNodes, maxBranches, maxSources, dt);
      if (!solverPtr) return null;

      const branchIndices: { id: string; idxA: number; idxB: number; idxC: number }[] = [];
      for (const br of this.companionBranches) {
        const fromA = br.fromIdx >= 0 ? br.fromIdx * 3 + 0 : -1;
        const fromB = br.fromIdx >= 0 ? br.fromIdx * 3 + 1 : -1;
        const fromC = br.fromIdx >= 0 ? br.fromIdx * 3 + 2 : -1;

        const toA = br.toIdx >= 0 ? br.toIdx * 3 + 0 : -1;
        const toB = br.toIdx >= 0 ? br.toIdx * 3 + 1 : -1;
        const toC = br.toIdx >= 0 ? br.toIdx * 3 + 2 : -1;

        const idxA = wasm.emt_add_branch(solverPtr, fromA, toA, br.rOhm, br.lHenry, br.cFarad);
        const idxB = wasm.emt_add_branch(solverPtr, fromB, toB, br.rOhm, br.lHenry, br.cFarad);
        const idxC = wasm.emt_add_branch(solverPtr, fromC, toC, br.rOhm, br.lHenry, br.cFarad);
        branchIndices.push({ id: br.id, idxA, idxB, idxC });
      }

      for (const [bIdx, srcList] of this.busSources) {
        for (const src of srcList) {
          const vPeakKv = src.vPeak / 1e3;
          const freqHz = src.freqRad / (2 * Math.PI);
          const phase = src.phaseRad;
          wasm.emt_add_source(solverPtr, bIdx * 3 + 0, vPeakKv, freqHz, phase, src.gSrc, 1);
          wasm.emt_add_source(solverPtr, bIdx * 3 + 1, vPeakKv, freqHz, phase - (2 * Math.PI) / 3, src.gSrc, 1);
          wasm.emt_add_source(solverPtr, bIdx * 3 + 2, vPeakKv, freqHz, phase + (2 * Math.PI) / 3, src.gSrc, 1);
        }
      }

      const ok = wasm.emt_build_and_factorize(solverPtr);
      if (!ok) return null;

      const startTime = performance.now();
      const vVecPtr = wasm.emt_get_voltages_ptr(solverPtr);
      const vView = new Float64Array(wasm.memory.buffer, vVecPtr, this.nBuses * 3);

      for (const b of this.busList) {
        this.busVoltages.set(b.id, this.busPhaseVoltages.get(b.id)!.a);
      }

      for (let k = 0; k < this.nSteps; k++) {
        wasm.emt_step(solverPtr);

        for (let b = 0; b < this.nBuses; b++) {
          const busName = this.busList[b]!.id;
          const va = vView[b * 3 + 0]!;
          const vb = vView[b * 3 + 1]!;
          const vc = vView[b * 3 + 2]!;

          const pv = this.busPhaseVoltages.get(busName)!;
          pv.a[k] = va;
          pv.b[k] = vb;
          pv.c[k] = vc;
        }

        for (const br of branchIndices) {
          const ia = wasm.emt_get_branch_current(solverPtr, br.idxA);
          const ib = wasm.emt_get_branch_current(solverPtr, br.idxB);
          const ic = wasm.emt_get_branch_current(solverPtr, br.idxC);

          const pb = this.branchPhaseCurrents.get(br.id)!;
          pb.a[k] = ia;
          pb.b[k] = ib;
          pb.c[k] = ic;
        }
      }

      const executionTimeMs = performance.now() - startTime;
      return {
        time: this.time,
        busVoltages: this.busVoltages,
        busPhaseVoltages: this.busPhaseVoltages,
        branchCurrents: this.branchCurrents,
        branchPhaseCurrents: this.branchPhaseCurrents,
        vA: this.vA,
        vB: this.vB,
        vC: this.vC,
        iA: this.iA,
        iB: this.iB,
        iC: this.iC,
        controlSignals: this.controlSignals.size > 0 ? this.controlSignals : undefined,
        metrics: {
          totalSteps: this.nSteps,
          luFactorizations: 3,
          switchingEvents: 0,
          chatterDampedSteps: 0,
          executionTimeMs,
        },
      };
    } catch {
      return null;
    }
  }

  /**
   * Helper to read interpolated delayed sample at (t - tau) from a Bergeron ring buffer.
   */
  private readDelayed(buf: Float64Array, ptr: number, bufLen: number, delaySteps: number, fracDelay: number): number {
    const idx1 = (ptr - delaySteps + bufLen * 2) % bufLen;
    const idx2 = (idx1 - 1 + bufLen) % bufLen;
    return (1.0 - fracDelay) * buf[idx1]! + fracDelay * buf[idx2]!;
  }

  /**
   * Executes the full time-domain simulation loop.
   */
  public solve(): EmtSolverResult {
    if (this.useWasm && this.bergeronLines.length === 0 && this.syncGenerators.length === 0) {
      const wasmRes = this.solveWithWasm();
      if (wasmRes) return wasmRes;
    }

    const startTime = performance.now();
    const n = this.nBuses;
    const n3 = this.nPhaseNodes;

    if (n === 0) {
      return {
        time: this.time,
        busVoltages: this.busVoltages,
        busPhaseVoltages: this.busPhaseVoltages,
        branchCurrents: this.branchCurrents,
        branchPhaseCurrents: this.branchPhaseCurrents,
        vA: this.vA,
        vB: this.vB,
        vC: this.vC,
        iA: this.iA,
        iB: this.iB,
        iC: this.iC,
        metrics: {
          totalSteps: 0,
          luFactorizations: 0,
          switchingEvents: 0,
          chatterDampedSteps: 0,
          executionTimeMs: 0,
        },
      };
    }

    let cdaCounter = 0;

    for (let k = 0; k < this.nSteps; k++) {
      const t = this.time[k]!;

      // 1. Detect switch state toggles
      let topologyChanged = false;
      for (const swState of this.switchStates) {
        const initClosed = Boolean(swState.sw.initialClosed);
        const isClosed = t >= swState.sw.actionTimeSec ? !initClosed : initClosed;
        if (isClosed !== swState.currentClosed) {
          swState.currentClosed = isClosed;
          topologyChanged = true;
          this.switchingEventCount++;
          if (this.enableCda) {
            cdaCounter = 2; // Trigger 2 steps of CDA damping
          }
        }
      }

      // 2. Check active fault conditions
      let anyFaultActive = false;
      for (const flt of this.netlist.faults ?? []) {
        if (t >= flt.startSec && t <= flt.endSec) {
          anyFaultActive = true;
        }
      }

      // 3. Assemble coupled 3N x 3N conductance matrix if topology changed or invalid
      if (!this.luValid || topologyChanged || anyFaultActive) {
        this.G3.fill(0);

        // Sources
        for (const [bIdx, srcs] of this.busSources.entries()) {
          for (const s of srcs) {
            for (let p = 0; p < 3; p++) {
              const pNode = 3 * bIdx + p;
              this.G3[pNode * n3 + pNode] = this.G3[pNode * n3 + pNode]! + s.gSrc;
            }
          }
        }

        // Synchronous Generators Norton subtransient conductance
        for (const sg of this.syncGenerators) {
          for (let p = 0; p < 3; p++) {
            const pNode = 3 * sg.busIdx + p;
            this.G3[pNode * n3 + pNode] = this.G3[pNode * n3 + pNode]! + sg.gGen;
          }
        }

        // Companion branches (including mutual coupling & Y-Delta connections)
        for (const br of this.companionBranches) {
          const gTotal = br.gEq + 0.5 * br.shuntG;
          this.stamp3PhaseBranch(br.fromIdx, br.toIdx, gTotal, br.gMut);

          // If Delta winding is present, stamp phase-to-phase coupling on the Delta side
          if (br.windingConnection === "Yg-D" || br.windingConnection === "D-D") {
            const dIdx = br.toIdx;
            if (dIdx >= 0) {
              const gDelta = 0.1 * br.gEq;
              this.stampNodeAdmittance(3 * dIdx + 0, 3 * dIdx + 1, gDelta);
              this.stampNodeAdmittance(3 * dIdx + 1, 3 * dIdx + 2, gDelta);
              this.stampNodeAdmittance(3 * dIdx + 2, 3 * dIdx + 0, gDelta);
            }
          }
          if (br.windingConnection === "D-Yg" || br.windingConnection === "D-D") {
            const dIdx = br.fromIdx;
            if (dIdx >= 0) {
              const gDelta = 0.1 * br.gEq;
              this.stampNodeAdmittance(3 * dIdx + 0, 3 * dIdx + 1, gDelta);
              this.stampNodeAdmittance(3 * dIdx + 1, 3 * dIdx + 2, gDelta);
              this.stampNodeAdmittance(3 * dIdx + 2, 3 * dIdx + 0, gDelta);
            }
          }
        }

        // Bergeron distributed traveling-wave lines (decoupled Norton shunt gBerg at both terminals)
        for (const bl of this.bergeronLines) {
          for (let p = 0; p < 3; p++) {
            if (bl.fromIdx >= 0) {
              const pk = 3 * bl.fromIdx + p;
              this.G3[pk * n3 + pk] = this.G3[pk * n3 + pk]! + bl.gBerg;
            }
            if (bl.toIdx >= 0) {
              const pm = 3 * bl.toIdx + p;
              this.G3[pm * n3 + pm] = this.G3[pm * n3 + pm]! + bl.gBerg;
            }
          }
        }

        // Switches
        for (const swState of this.switchStates) {
          const rSw = swState.currentClosed
            ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
            : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
          const gSw = 1.0 / rSw;
          this.stamp3PhaseBranch(swState.fromIdx, swState.toIdx, gSw, 0);
        }

        // Faults (3PH, SLG, DLG, and phase-to-phase LL)
        for (const flt of this.netlist.faults ?? []) {
          if (t >= flt.startSec && t <= flt.endSec) {
            const bIdx = this.busIdxMap.get(flt.bus) ?? 0;
            const rFlt = flt.rFaultOhm !== undefined && flt.rFaultOhm > 0 ? flt.rFaultOhm : 0.5;
            const gFlt = 1.0 / rFlt;
            const pA = 3 * bIdx + 0;
            const pB = 3 * bIdx + 1;
            const pC = 3 * bIdx + 2;
            if (flt.faultType === "3PH") {
              this.G3[pA * n3 + pA] = this.G3[pA * n3 + pA]! + gFlt;
              this.G3[pB * n3 + pB] = this.G3[pB * n3 + pB]! + gFlt;
              this.G3[pC * n3 + pC] = this.G3[pC * n3 + pC]! + gFlt;
            } else if (flt.faultType === "SLG") {
              // Single line-to-ground fault on Phase A
              this.G3[pA * n3 + pA] = this.G3[pA * n3 + pA]! + gFlt;
            } else if (flt.faultType === "DLG") {
              // Double line-to-ground fault on Phases B and C
              this.G3[pB * n3 + pB] = this.G3[pB * n3 + pB]! + gFlt;
              this.G3[pC * n3 + pC] = this.G3[pC * n3 + pC]! + gFlt;
              this.stampNodeAdmittance(pB, pC, 0.5 * gFlt);
            } else {
              // Phase-to-phase (LL) fault directly coupling Phase B and Phase C
              this.stampNodeAdmittance(pB, pC, gFlt);
            }
          }
        }

        // Compute coupled 3-phase LU factorization
        this.factorize3Phase(this.G3, this.LU3, this.piv3);
        this.luFactorizationCount += 3;
        this.luValid = !anyFaultActive; // Keep cached if no dynamic fault active
      }

      // 4. Assemble 3-phase injection currents J3
      this.J3.fill(0);

      for (const [bIdx, srcs] of this.busSources.entries()) {
        for (const s of srcs) {
          const ea = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad);
          const eb = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad - (2 * Math.PI) / 3);
          const ec = s.vPeak * Math.sin(s.freqRad * t + s.phaseRad + (2 * Math.PI) / 3);
          this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! + s.gSrc * ea;
          this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! + s.gSrc * eb;
          this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! + s.gSrc * ec;
        }
      }

      // Park dq0 Synchronous Generator internal subtransient EMF Norton injections
      for (const sg of this.syncGenerators) {
        const thetaE = sg.omega0 * t + sg.deltaRad;
        const ePeak = sg.efPu * sg.vPeak;
        const ea = ePeak * Math.sin(thetaE);
        const eb = ePeak * Math.sin(thetaE - (2 * Math.PI) / 3);
        const ec = ePeak * Math.sin(thetaE + (2 * Math.PI) / 3);
        this.J3[3 * sg.busIdx + 0] = this.J3[3 * sg.busIdx + 0]! + sg.gGen * ea;
        this.J3[3 * sg.busIdx + 1] = this.J3[3 * sg.busIdx + 1]! + sg.gGen * eb;
        this.J3[3 * sg.busIdx + 2] = this.J3[3 * sg.busIdx + 2]! + sg.gGen * ec;
      }

      // Companion branch history current injections
      for (const br of this.companionBranches) {
        if (br.fromIdx >= 0) {
          this.J3[3 * br.fromIdx + 0] = this.J3[3 * br.fromIdx + 0]! - br.iHistA;
          this.J3[3 * br.fromIdx + 1] = this.J3[3 * br.fromIdx + 1]! - br.iHistB;
          this.J3[3 * br.fromIdx + 2] = this.J3[3 * br.fromIdx + 2]! - br.iHistC;
        }
        if (br.toIdx >= 0) {
          this.J3[3 * br.toIdx + 0] = this.J3[3 * br.toIdx + 0]! + br.iHistA;
          this.J3[3 * br.toIdx + 1] = this.J3[3 * br.toIdx + 1]! + br.iHistB;
          this.J3[3 * br.toIdx + 2] = this.J3[3 * br.toIdx + 2]! + br.iHistC;
        }
      }

      // Bergeron traveling-wave delayed history current injections
      for (const bl of this.bergeronLines) {
        const { ptr, bufLen, delaySteps, fracDelay, gBerg, hLoss } = bl;
        const c1 = 0.5 * (1.0 + hLoss);
        const c2 = 0.5 * (1.0 - hLoss);

        const vkDelA = this.readDelayed(bl.vkBufA, ptr, bufLen, delaySteps, fracDelay);
        const vkDelB = this.readDelayed(bl.vkBufB, ptr, bufLen, delaySteps, fracDelay);
        const vkDelC = this.readDelayed(bl.vkBufC, ptr, bufLen, delaySteps, fracDelay);

        const vmDelA = this.readDelayed(bl.vmBufA, ptr, bufLen, delaySteps, fracDelay);
        const vmDelB = this.readDelayed(bl.vmBufB, ptr, bufLen, delaySteps, fracDelay);
        const vmDelC = this.readDelayed(bl.vmBufC, ptr, bufLen, delaySteps, fracDelay);

        const ikmDelA = this.readDelayed(bl.ikmBufA, ptr, bufLen, delaySteps, fracDelay);
        const ikmDelB = this.readDelayed(bl.ikmBufB, ptr, bufLen, delaySteps, fracDelay);
        const ikmDelC = this.readDelayed(bl.ikmBufC, ptr, bufLen, delaySteps, fracDelay);

        const imkDelA = this.readDelayed(bl.imkBufA, ptr, bufLen, delaySteps, fracDelay);
        const imkDelB = this.readDelayed(bl.imkBufB, ptr, bufLen, delaySteps, fracDelay);
        const imkDelC = this.readDelayed(bl.imkBufC, ptr, bufLen, delaySteps, fracDelay);

        const iHistKmA = -c1 * (gBerg * vmDelA + hLoss * imkDelA) - c2 * (gBerg * vkDelA + hLoss * ikmDelA);
        const iHistKmB = -c1 * (gBerg * vmDelB + hLoss * imkDelB) - c2 * (gBerg * vkDelB + hLoss * ikmDelB);
        const iHistKmC = -c1 * (gBerg * vmDelC + hLoss * imkDelC) - c2 * (gBerg * vkDelC + hLoss * ikmDelC);

        const iHistMkA = -c1 * (gBerg * vkDelA + hLoss * ikmDelA) - c2 * (gBerg * vmDelA + hLoss * imkDelA);
        const iHistMkB = -c1 * (gBerg * vkDelB + hLoss * ikmDelB) - c2 * (gBerg * vmDelB + hLoss * imkDelB);
        const iHistMkC = -c1 * (gBerg * vkDelC + hLoss * ikmDelC) - c2 * (gBerg * vmDelC + hLoss * imkDelC);

        if (bl.fromIdx >= 0) {
          this.J3[3 * bl.fromIdx + 0] = this.J3[3 * bl.fromIdx + 0]! - iHistKmA;
          this.J3[3 * bl.fromIdx + 1] = this.J3[3 * bl.fromIdx + 1]! - iHistKmB;
          this.J3[3 * bl.fromIdx + 2] = this.J3[3 * bl.fromIdx + 2]! - iHistKmC;
        }
        if (bl.toIdx >= 0) {
          this.J3[3 * bl.toIdx + 0] = this.J3[3 * bl.toIdx + 0]! - iHistMkA;
          this.J3[3 * bl.toIdx + 1] = this.J3[3 * bl.toIdx + 1]! - iHistMkB;
          this.J3[3 * bl.toIdx + 2] = this.J3[3 * bl.toIdx + 2]! - iHistMkC;
        }
      }

      // 5. Solve coupled 3N x 3N linear system via forward/backward substitution
      this.solveFromLU3Phase(this.LU3, this.piv3, this.J3, this.v3Step);

      for (let i = 0; i < n; i++) {
        const va = this.v3Step[3 * i + 0]!;
        const vb = this.v3Step[3 * i + 1]!;
        const vc = this.v3Step[3 * i + 2]!;
        this.vaStep[i] = va;
        this.vbStep[i] = vb;
        this.vcStep[i] = vc;

        const busId = this.busList[i]!.id;
        const pv = this.busPhaseVoltages.get(busId)!;
        pv.a[k] = va;
        pv.b[k] = vb;
        pv.c[k] = vc;
      }

      // 6. Update branch currents & Dommel companion history
      const isCdaActive = cdaCounter > 0;
      if (isCdaActive) {
        this.chatterDampedCount++;
        cdaCounter--;
      }

      for (const br of this.companionBranches) {
        const vFromA = br.fromIdx >= 0 ? this.vaStep[br.fromIdx]! : 0.0;
        const vToA = br.toIdx >= 0 ? this.vaStep[br.toIdx]! : 0.0;
        const dvA = vFromA - vToA;

        const vFromB = br.fromIdx >= 0 ? this.vbStep[br.fromIdx]! : 0.0;
        const vToB = br.toIdx >= 0 ? this.vbStep[br.toIdx]! : 0.0;
        const dvB = vFromB - vToB;

        const vFromC = br.fromIdx >= 0 ? this.vcStep[br.fromIdx]! : 0.0;
        const vToC = br.toIdx >= 0 ? this.vcStep[br.toIdx]! : 0.0;
        const dvC = vFromC - vToC;

        const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
        const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
        const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
        br.ia[k] = curA;
        br.ib[k] = curB;
        br.ic[k] = curC;

        if (isCdaActive) {
          br.iHistA = curA - (br.gEq * dvA + br.gMut * (dvB + dvC));
          br.iHistB = curB - (br.gEq * dvB + br.gMut * (dvA + dvC));
          br.iHistC = curC - (br.gEq * dvC + br.gMut * (dvA + dvB));
        } else {
          br.iHistA = br.alphaHist * curA + br.alphaMutHist * (curB + curC) + br.gEq * dvA + br.gMut * (dvB + dvC);
          br.iHistB = br.alphaHist * curB + br.alphaMutHist * (curA + curC) + br.gEq * dvB + br.gMut * (dvA + dvC);
          br.iHistC = br.alphaHist * curC + br.alphaMutHist * (curA + curB) + br.gEq * dvC + br.gMut * (dvA + dvB);
        }
      }

      // 6b. Update Bergeron distributed line ring buffers and terminal currents
      for (const bl of this.bergeronLines) {
        const { ptr, bufLen, delaySteps, fracDelay, gBerg, hLoss } = bl;
        const c1 = 0.5 * (1.0 + hLoss);
        const c2 = 0.5 * (1.0 - hLoss);

        const vkDelA = this.readDelayed(bl.vkBufA, ptr, bufLen, delaySteps, fracDelay);
        const vkDelB = this.readDelayed(bl.vkBufB, ptr, bufLen, delaySteps, fracDelay);
        const vkDelC = this.readDelayed(bl.vkBufC, ptr, bufLen, delaySteps, fracDelay);

        const vmDelA = this.readDelayed(bl.vmBufA, ptr, bufLen, delaySteps, fracDelay);
        const vmDelB = this.readDelayed(bl.vmBufB, ptr, bufLen, delaySteps, fracDelay);
        const vmDelC = this.readDelayed(bl.vmBufC, ptr, bufLen, delaySteps, fracDelay);

        const ikmDelA = this.readDelayed(bl.ikmBufA, ptr, bufLen, delaySteps, fracDelay);
        const ikmDelB = this.readDelayed(bl.ikmBufB, ptr, bufLen, delaySteps, fracDelay);
        const ikmDelC = this.readDelayed(bl.ikmBufC, ptr, bufLen, delaySteps, fracDelay);

        const imkDelA = this.readDelayed(bl.imkBufA, ptr, bufLen, delaySteps, fracDelay);
        const imkDelB = this.readDelayed(bl.imkBufB, ptr, bufLen, delaySteps, fracDelay);
        const imkDelC = this.readDelayed(bl.imkBufC, ptr, bufLen, delaySteps, fracDelay);

        const iHistKmA = -c1 * (gBerg * vmDelA + hLoss * imkDelA) - c2 * (gBerg * vkDelA + hLoss * ikmDelA);
        const iHistKmB = -c1 * (gBerg * vmDelB + hLoss * imkDelB) - c2 * (gBerg * vkDelB + hLoss * ikmDelB);
        const iHistKmC = -c1 * (gBerg * vmDelC + hLoss * imkDelC) - c2 * (gBerg * vkDelC + hLoss * ikmDelC);

        const iHistMkA = -c1 * (gBerg * vkDelA + hLoss * ikmDelA) - c2 * (gBerg * vmDelA + hLoss * imkDelA);
        const iHistMkB = -c1 * (gBerg * vkDelB + hLoss * ikmDelB) - c2 * (gBerg * vmDelB + hLoss * imkDelB);
        const iHistMkC = -c1 * (gBerg * vkDelC + hLoss * ikmDelC) - c2 * (gBerg * vmDelC + hLoss * imkDelC);

        const vkA = bl.fromIdx >= 0 ? this.vaStep[bl.fromIdx]! : 0.0;
        const vkB = bl.fromIdx >= 0 ? this.vbStep[bl.fromIdx]! : 0.0;
        const vkC = bl.fromIdx >= 0 ? this.vcStep[bl.fromIdx]! : 0.0;

        const vmA = bl.toIdx >= 0 ? this.vaStep[bl.toIdx]! : 0.0;
        const vmB = bl.toIdx >= 0 ? this.vbStep[bl.toIdx]! : 0.0;
        const vmC = bl.toIdx >= 0 ? this.vcStep[bl.toIdx]! : 0.0;

        const ikmA = gBerg * vkA + iHistKmA;
        const ikmB = gBerg * vkB + iHistKmB;
        const ikmC = gBerg * vkC + iHistKmC;

        const imkA = gBerg * vmA + iHistMkA;
        const imkB = gBerg * vmB + iHistMkB;
        const imkC = gBerg * vmC + iHistMkC;

        bl.ia[k] = ikmA;
        bl.ib[k] = ikmB;
        bl.ic[k] = ikmC;

        bl.vkBufA[ptr] = vkA;
        bl.vkBufB[ptr] = vkB;
        bl.vkBufC[ptr] = vkC;
        bl.vmBufA[ptr] = vmA;
        bl.vmBufB[ptr] = vmB;
        bl.vmBufC[ptr] = vmC;
        bl.ikmBufA[ptr] = ikmA;
        bl.ikmBufB[ptr] = ikmB;
        bl.ikmBufC[ptr] = ikmC;
        bl.imkBufA[ptr] = imkA;
        bl.imkBufB[ptr] = imkB;
        bl.imkBufC[ptr] = imkC;
        bl.ptr = (ptr + 1) % bufLen;
      }

      // 6c. Update Park dq0 synchronous generator states (rotor swing equation d(delta)/dt, d(omega)/dt)
      for (const sg of this.syncGenerators) {
        const thetaE = sg.omega0 * t + sg.deltaRad;
        const ePeak = sg.efPu * sg.vPeak;
        const ea = ePeak * Math.sin(thetaE);
        const eb = ePeak * Math.sin(thetaE - (2 * Math.PI) / 3);
        const ec = ePeak * Math.sin(thetaE + (2 * Math.PI) / 3);

        const va = this.vaStep[sg.busIdx]!;
        const vb = this.vbStep[sg.busIdx]!;
        const vc = this.vcStep[sg.busIdx]!;

        const ia = sg.gGen * (ea - va);
        const ib = sg.gGen * (eb - vb);
        const ic = sg.gGen * (ec - vc);
        sg.ia[k] = ia;
        sg.ib[k] = ib;
        sg.ic[k] = ic;

        // Park dq0 transform aligned with rotor angle thetaE
        const sinA = Math.sin(thetaE);
        const sinB = Math.sin(thetaE - (2 * Math.PI) / 3);
        const sinC = Math.sin(thetaE + (2 * Math.PI) / 3);
        const cosA = Math.cos(thetaE);
        const cosB = Math.cos(thetaE - (2 * Math.PI) / 3);
        const cosC = Math.cos(thetaE + (2 * Math.PI) / 3);

        const vd = ((2.0 / 3.0) * (va * sinA + vb * sinB + vc * sinC)) / sg.vPeak;
        const vq = ((2.0 / 3.0) * (va * cosA + vb * cosB + vc * cosC)) / sg.vPeak;
        const id = ((2.0 / 3.0) * (ia * sinA + ib * sinB + ic * sinC)) / sg.iBasePeak;
        const iq = ((2.0 / 3.0) * (ia * cosA + ib * cosB + ic * cosC)) / sg.iBasePeak;

        const sBase3Ph = 1.5 * sg.vPeak * sg.iBasePeak;
        const pePu = sBase3Ph > 0 ? (va * ia + vb * ib + vc * ic) / sBase3Ph : 0.0;

        sg.deltaTraj[k] = sg.deltaRad;
        sg.omegaTraj[k] = sg.omegaRadSec;
        sg.speedPuTraj[k] = sg.omegaRadSec / sg.omega0;
        sg.peTraj[k] = pePu;
        sg.vdTraj[k] = vd;
        sg.vqTraj[k] = vq;
        sg.idTraj[k] = id;
        sg.iqTraj[k] = iq;

        // Swing equation:
        // d(delta)/dt = omega - omega0
        // 2H * d(omega/omega0)/dt = Pm - Pe - D * (omega - omega0) / omega0
        const slipPu = (sg.omegaRadSec - sg.omega0) / sg.omega0;
        const dOmegaDt = (sg.omega0 / (2.0 * sg.hSec)) * (sg.pmPu - pePu - sg.dampingPu * slipPu);
        const omegaNext = sg.omegaRadSec + this.timeStepSec * dOmegaDt;
        sg.deltaRad += this.timeStepSec * 0.5 * (sg.omegaRadSec - sg.omega0 + (omegaNext - sg.omega0));
        sg.omegaRadSec = omegaNext;
      }

      // 7. Update switch currents
      for (const swState of this.switchStates) {
        const { fromIdx, toIdx, ia, ib, ic } = swState;
        const rSw = swState.currentClosed
          ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
          : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
        const gSw = 1.0 / rSw;
        ia[k] = gSw * ((fromIdx >= 0 ? this.vaStep[fromIdx]! : 0) - (toIdx >= 0 ? this.vaStep[toIdx]! : 0));
        ib[k] = gSw * ((fromIdx >= 0 ? this.vbStep[fromIdx]! : 0) - (toIdx >= 0 ? this.vbStep[toIdx]! : 0));
        ic[k] = gSw * ((fromIdx >= 0 ? this.vcStep[fromIdx]! : 0) - (toIdx >= 0 ? this.vcStep[toIdx]! : 0));
      }

      // 8. Update IBR converter injection currents
      const tauLvrt = 0.008;
      const alphaLvrt = 1.0 - Math.exp(-this.timeStepSec / tauLvrt);
      for (const fmuState of this.fmuStates) {
        const { busIdx, iRatedPeak, ia, ib, ic } = fmuState;
        const vNomPeak = this.busList[busIdx]!.vPeak;
        const vaInst = this.vaStep[busIdx]!;
        const vbInst = this.vbStep[busIdx]!;
        const vcInst = this.vcStep[busIdx]!;
        const vEnv = Math.sqrt((2.0 / 3.0) * (vaInst * vaInst + vbInst * vbInst + vcInst * vcInst));
        const vPu = vNomPeak > 0 ? vEnv / vNomPeak : 1.0;

        const isVoltageDip = anyFaultActive || vPu < 0.9;
        const iqTarget = isVoltageDip ? 0.85 * iRatedPeak : 0.0;
        fmuState.iqState = isVoltageDip ? fmuState.iqState + alphaLvrt * (iqTarget - fmuState.iqState) : 0.0;
        const id = isVoltageDip ? 0.35 * iRatedPeak : 0.7 * iRatedPeak;
        const iq = fmuState.iqState;

        ia[k] = id * Math.sin(this.omega * t) - iq * Math.cos(this.omega * t);
        ib[k] = id * Math.sin(this.omega * t - (2 * Math.PI) / 3) - iq * Math.cos(this.omega * t - (2 * Math.PI) / 3);
        ic[k] = id * Math.sin(this.omega * t + (2 * Math.PI) / 3) - iq * Math.cos(this.omega * t + (2 * Math.PI) / 3);
      }
    }

    for (const b of this.busList) {
      this.busVoltages.set(b.id, this.busPhaseVoltages.get(b.id)!.a);
    }

    const executionTimeMs = performance.now() - startTime;

    return {
      time: this.time,
      busVoltages: this.busVoltages,
      busPhaseVoltages: this.busPhaseVoltages,
      branchCurrents: this.branchCurrents,
      branchPhaseCurrents: this.branchPhaseCurrents,
      vA: this.vA,
      vB: this.vB,
      vC: this.vC,
      iA: this.iA,
      iB: this.iB,
      iC: this.iC,
      controlSignals: this.controlSignals.size > 0 ? this.controlSignals : undefined,
      metrics: {
        totalSteps: this.nSteps,
        luFactorizations: this.luFactorizationCount,
        switchingEvents: this.switchingEventCount,
        chatterDampedSteps: this.chatterDampedCount,
        executionTimeMs,
      },
    };
  }
}

/**
 * Convenience helper to execute a 3-phase Dommel EMT simulation on an `EmtNetlist`.
 */
export function runEmtSimulation(netlist: EmtNetlist, options: EmtSolverOptions): EmtSolverResult {
  const solver = new EmtSolver(netlist, options);
  return solver.solve();
}
