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

import {
  SparseTripletBuilder,
  computeAmdOrdering,
  getDefaultWasmExports,
  sparseLuAnalyze,
  sparseLuRefactorize,
  sparseLuSolve,
  type SparseCCSMatrix,
  type SparseLUFactors,
} from "@modelscript/runtime";
import { extractEmtNetlistFromXml } from "../netlist/emt-netlist.js";
import {
  EmtdcHostBridge,
  type EmtdcRegisteredUdm,
  type EmtdcWasmMachinaDllRunner,
} from "../script/emtdc-abi-bridge.js";
import type { EmtCustomFortranBlock, EmtNetlist } from "../types.js";
import { OemLicenseError, OemLicensePreflightGuard, type OemLicensePreflightGuardOptions } from "./license-guard.js";
import { createUniversalLineModel, stepUlmLine, type UniversalLineModelData } from "./universal-line-model.js";
import { synthesizeFdLineModel } from "./vector-fitting.js";

export { OemLicenseError, OemLicensePreflightGuard, type OemLicensePreflightGuardOptions, type UniversalLineModelData };

export interface PscadSnapshot {
  formatVersion: "1.0";
  timestampSec: number;
  nominalFrequencyHz: number;
  busVoltages: Record<string, { va: number; vb: number; vc: number }>;
  branchHistories: Record<string, { iHistA: number; iHistB: number; iHistC: number }>;
  bergeronBuffers?:
    | Record<
        string,
        {
          ptr: number;
          vkBufA: number[];
          vkBufB: number[];
          vkBufC: number[];
          vmBufA: number[];
          vmBufB: number[];
          vmBufC: number[];
          ikmBufA: number[];
          ikmBufB: number[];
          ikmBufC: number[];
          imkBufA: number[];
          imkBufB: number[];
          imkBufC: number[];
        }
      >
    | undefined;
  syncGenerators?: Record<string, { deltaRad: number; omegaRadSec: number }> | undefined;
  switchStates?: Record<string, boolean> | undefined;
}

export interface EmtBoundaryFeed {
  busId: string;
  /** Optional dynamic Thévenin source parameters computed by co-simulation orchestrator. */
  thevenin?:
    | ((t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined)
    | undefined;
  /** Optional dynamic 3-phase instantaneous current injection in Amperes. */
  currentInjection?: ((t: number) => { ia: number; ib: number; ic: number } | undefined) | undefined;
}

export interface EmtSolverOptions {
  timeStepSec: number;
  durationSec: number;
  nominalFrequencyHz?: number | undefined;
  /** Whether to enable Critical Damping Adjustment (CDA) to eliminate switching chatter. Default: true. */
  enableCda?: boolean | undefined;
  /** Whether to enable sub-step zero-crossing switching interpolation to suppress current chopping spikes. Default: true. */
  enableSwitchingInterpolation?: boolean | undefined;
  /** Whether to pre-solve fundamental-frequency AC steady-state load flow at t=0 before stepping. Default: false. */
  initializeFromLoadFlow?: boolean | undefined;
  /** Optional `.snp` snapshot state to restore at t=0. */
  initialSnapshot?: PscadSnapshot | undefined;
  /** Maximum number of simulation steps. Default: 50,000. */
  maxSteps?: number | undefined;
  /** Whether to execute via native WebAssembly companion solver kernel. Default: false. */
  useWasm?: boolean | undefined;
  /** Optional boundary feeds for TS-EMT hybrid co-simulation. */
  boundaryFeeds?: EmtBoundaryFeed[] | undefined;
  /** Optional step hook invoked with instantaneous phase voltages per step. */
  onStep?:
    | ((t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void)
    | undefined;
  /**
   * Whether to strictly enforce hardware dongle / DRM license checks on OEM black-box binary DLLs.
   * If true, any OEM binary block requiring CodeMeter or Sentinel HASP licensing will be validated
   * pre-flight; if unlicensed or no dongle is present, simulation immediately throws OemLicenseError.
   * Default: false.
   */
  strictDrmLicense?: boolean | undefined;
  /**
   * Optional custom DRM license options or DongleManager instance to verify against.
   */
  drmLicenseOptions?: import("@modelscript/exchange").DrmLicenseOptions | undefined;
}

export interface EmtSolverMetrics {
  totalSteps: number;
  luFactorizations: number;
  switchingEvents: number;
  chatterDampedSteps: number;
  interpolatedZeroCrossings?: number | undefined;
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
  /** Energy dissipated by Metal Oxide Surge Arresters in kilojoules (kJ). */
  surgeArresterEnergies?: Map<string, number> | undefined;
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
  /** Sign of G_eq * v(t) in trapezoidal history current (+1 for R-L, -1 for R-C). */
  vCoeffHist: number;
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
  /** Whether multi-conductor Clarke modal transformation is active for this 3-phase line. */
  hasModal: boolean;
  delaySteps0: number;
  fracDelay0: number;
  gBerg0: number;
  hLoss0: number;
  delaySteps1: number;
  fracDelay1: number;
  gBerg1: number;
  hLoss1: number;
  gSelf: number;
  gMutual: number;
  /** Whether frequency-dependent ULM / J. Marti recursive convolution is active for this line. */
  isFdpm: boolean;
  d0: number;
  gInf: number;
  yPoles: Float64Array;
  yResidues: Float64Array;
  hPoles: Float64Array;
  hResidues: Float64Array;
  expDecays: Float64Array;
  convGains: Float64Array;
  xKmA: Float64Array;
  xKmB: Float64Array;
  xKmC: Float64Array;
  xMkA: Float64Array;
  xMkB: Float64Array;
  xMkC: Float64Array;
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
  poleActionTimesSec?: [number, number, number] | undefined;
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
  r0PerKm?: number | undefined;
  l0PerKm?: number | undefined;
  c0PerKm?: number | undefined;
  r0TotalOhm?: number | undefined;
  l0TotalHenry?: number | undefined;
  c0TotalFarad?: number | undefined;
  hasModal?: boolean | undefined;
  towerHeightM?: number | undefined;
  phaseSpacingM?: number | undefined;
  conductorRadiusM?: number | undefined;
  soilResistivityOhmM?: number | undefined;
  modelType?: "bergeron" | "pi" | "fdpm" | "ulm" | undefined;
  ulmData?: UniversalLineModelData | undefined;
  poles?: number[] | undefined;
  residues?: number[] | undefined;
  d0?: number | undefined;
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
  emt_add_bergeron_line?: (
    solverPtr: number,
    fromNode: number,
    toNode: number,
    zc: number,
    tauSec: number,
    rTotal: number,
  ) => number;
  emt_add_fd_line?: (
    solverPtr: number,
    fromNode: number,
    toNode: number,
    gInf: number,
    tauSec: number,
    maxPolesY: number,
    maxPolesH: number,
  ) => number;
  emt_add_fd_line_y_pole?: (solverPtr: number, fdLineIdx: number, poleRad: number, residueSiemens: number) => number;
  emt_add_fd_line_h_pole?: (solverPtr: number, fdLineIdx: number, poleRad: number, residueDimless: number) => number;
  emt_add_fault?: (
    solverPtr: number,
    nodeA: number,
    nodeB: number,
    startSec: number,
    endSec: number,
    gFault: number,
  ) => number;
  emt_add_breaker?: (
    solverPtr: number,
    fromNode: number,
    toNode: number,
    gClosed: number,
    gOpen: number,
    closedInitially: boolean | number,
    openTimeSec: number,
    closeTimeSec: number,
    choppingCurrentAmp: number,
  ) => number;
  emt_add_sync_machine?: (
    solverPtr: number,
    nodeA: number,
    nodeB: number,
    nodeC: number,
    sBaseMva: number,
    vBaseKvLL: number,
    freqHz: number,
    xd: number,
    xq: number,
    xdPrime: number,
    xqPrime: number,
    xdSub: number,
    td0Prime: number,
    tq0Prime: number,
    td0Sub: number,
    tq0Sub: number,
    hInertia: number,
    dampingD: number,
    pmPu: number,
    efPu: number,
  ) => number;
  emt_build_and_factorize: (solverPtr: number) => number | boolean;
  emt_get_voltages_ptr: (solverPtr: number) => number;
  emt_step: (solverPtr: number) => void;
  emt_run_steps?: (solverPtr: number, nSteps: number) => number;
  emt_alloc_trajectory?: (solverPtr: number, maxSteps: number) => number;
  emt_get_trajectory_ptr?: (solverPtr: number) => number;
  emt_get_branch_current: (solverPtr: number, branchIdx: number) => number;
  emt_get_factorization_count?: (solverPtr: number) => number;
  emt_get_machine_speed_pu?: (solverPtr: number, macIdx: number) => number;
  emt_get_machine_angle_deg?: (solverPtr: number, macIdx: number) => number;
}

interface SwitchState {
  sw: SwitchLike;
  fromIdx: number;
  toIdx: number;
  currentClosed: boolean;
  phaseClosed: [boolean, boolean, boolean];
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

interface SurgeArresterState {
  id: string;
  fromIdx: number;
  toIdx: number;
  vRefVolts: number;
  rClampOhm: number;
  energyJoules: number;
  /** Precomputed Thévenin driving-point impedance per phase (Ohm). */
  zThPhase: [number, number, number];
  /** Precomputed Thévenin response vector G3^-1 * e_uv per phase. */
  xThPhase: [Float64Array, Float64Array, Float64Array];
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
 * with Bergeron traveling-wave transmission lines, ULM / J. Marti frequency-dependent
 * recursive convolution, sub-step zero-crossing switching interpolation, and Park dq0 machines.
 */
export class EmtSolver {
  private readonly netlist: EmtNetlist;
  private readonly timeStepSec: number;
  private readonly durationSec: number;
  private readonly omega: number;
  private readonly enableCda: boolean;
  private readonly enableSwitchingInterpolation: boolean;
  private readonly nSteps: number;

  private readonly busList: BusInfo[] = [];
  private readonly busIdxMap = new Map<string, number>();
  private readonly companionBranches: CompanionBranch[] = [];
  private readonly bergeronLines: BergeronLineState[] = [];
  private readonly ulmLines: UniversalLineModelData[] = [];
  private readonly syncGenerators: SyncGenState[] = [];
  private readonly switchStates: SwitchState[] = [];
  private readonly fmuStates: FmuState[] = [];
  private readonly surgeArresters: SurgeArresterState[] = [];
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
  private emtdcHostBridge: EmtdcHostBridge | null = null;
  private readonly licenseGuard: OemLicensePreflightGuard;
  private readonly customBlockStates: Array<{
    block: EmtCustomFortranBlock;
    udm: EmtdcRegisteredUdm;
    runner?: EmtdcWasmMachinaDllRunner | undefined;
    busIdx: number;
    ia?: Float64Array | undefined;
    ib?: Float64Array | undefined;
    ic?: Float64Array | undefined;
    signalTrajs: Map<string, Float64Array>;
  }> = [];

  // Coupled 3N x 3N phase-domain nodal conductance matrix & RHS vector
  private G3!: Float64Array;
  private J3!: Float64Array;
  private LU3!: Float64Array;
  private piv3!: Int32Array;
  private v3Step!: Float64Array;
  private luValid: boolean = false;

  // Sparse CCS conductance formulation for large-scale grids (nPhaseNodes >= 180)
  private useSparse: boolean = false;
  private gTriplets: SparseTripletBuilder | null = null;
  private sparseCcs: SparseCCSMatrix | null = null;
  private gTripletMap: Int32Array | null = null;
  private sparseFactors: SparseLUFactors | null = null;
  private colPerm: Int32Array | undefined = undefined;

  // Solved step per-phase views
  private vaStep!: Float64Array;
  private vbStep!: Float64Array;
  private vcStep!: Float64Array;

  // Metrics
  private luFactorizationCount: number = 0;
  private switchingEventCount: number = 0;
  private chatterDampedCount: number = 0;
  private interpolatedZeroCrossingsCount: number = 0;

  private readonly useWasm: boolean;
  private readonly options: EmtSolverOptions;

  constructor(netlist: EmtNetlist, options: EmtSolverOptions = { durationSec: 0.1, timeStepSec: 50e-6 }) {
    this.netlist = netlist;
    this.options = options;
    this.timeStepSec = Math.max(1e-7, options.timeStepSec);
    this.durationSec = Math.max(this.timeStepSec * 2, options.durationSec);
    this.omega = 2 * Math.PI * (options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0);
    this.enableCda = options.enableCda ?? true;
    this.enableSwitchingInterpolation = options.enableSwitchingInterpolation ?? true;
    this.useWasm = options.useWasm ?? false;

    const maxSteps = options.maxSteps ?? 50000;
    this.nSteps = Math.max(10, Math.min(maxSteps, Math.floor(this.durationSec / this.timeStepSec)));

    this.defaultSrcR =
      netlist.sources?.[0]?.rSourceOhm !== undefined && netlist.sources[0].rSourceOhm > 0
        ? netlist.sources[0].rSourceOhm
        : 1.5;

    this.licenseGuard = new OemLicensePreflightGuard({
      strictDrmLicense: options.strictDrmLicense,
      drmOptions: options.drmLicenseOptions,
    });

    this.initializeTopology();

    if (options.initialSnapshot) {
      this.applySnapshot(options.initialSnapshot);
    } else if (options.initializeFromLoadFlow) {
      this.initializeSteadyState();
    }
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

    // Allocate coupled 3N x 3N phase-domain working memory (sparse CCS for >= 60 buses / 180 phase nodes)
    const n3 = this.nPhaseNodes;
    this.useSparse = n3 >= 180;
    if (this.useSparse) {
      this.G3 = new Float64Array(0);
      this.LU3 = new Float64Array(0);
      this.piv3 = new Int32Array(0);
      this.gTriplets = new SparseTripletBuilder(n3, n3, n3 * 12);
    } else {
      this.G3 = new Float64Array(n3 * n3);
      this.LU3 = new Float64Array(n3 * n3);
      this.piv3 = new Int32Array(n3);
    }
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

      const L1 = Math.max(lHenry, 0.0);
      const isCapacitiveBranch = L1 === 0.0 && cFarad > 0.0;
      const R1 = isCapacitiveBranch ? Math.max(rOhm, 0.0) : Math.max(rOhm, 1e-4);

      let gEq: number;
      let gMut = 0.0;
      let alphaHist: number;
      let alphaMutHist = 0.0;
      let vCoeffHist = 1.0;
      let shuntG = 0.0;

      if (isCapacitiveBranch) {
        const denomC = this.timeStepSec + 2.0 * R1 * cFarad;
        gEq = denomC > 1e-18 ? (2.0 * cFarad) / denomC : 1e4;
        alphaHist = denomC > 1e-18 ? (2.0 * R1 * cFarad - this.timeStepSec) / denomC : -1.0;
        vCoeffHist = -1.0;
        shuntG = 0.0;
      } else {
        const denom1 = 2.0 * L1 + R1 * this.timeStepSec;
        const g1 = denom1 > 1e-12 ? this.timeStepSec / denom1 : 1.0 / R1;
        const alpha1 = denom1 > 1e-12 ? (2.0 * L1 - R1 * this.timeStepSec) / denom1 : 0.0;
        gEq = g1;
        alphaHist = alpha1;

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
        shuntG = cFarad > 0 ? (2.0 * cFarad) / this.timeStepSec : 0.0;
      }

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
        vCoeffHist,
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

    // Helper to register Bergeron distributed traveling-wave line, ULM / J. Marti FDPM line, or fallback pi-section
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

      if (modelType === "ulm" && fromIdx >= 0 && toIdx >= 0) {
        const ulm =
          ln.ulmData ??
          createUniversalLineModel({
            id: ln.id,
            fromBus,
            toBus,
            fromIdx,
            toIdx,
            lengthKm: lengthKm > 0 ? lengthKm : 100.0,
            dtSec: this.timeStepSec,
            rPerKm: ln.rPerKm ?? (lengthKm > 0 ? rTotal / lengthKm : 0.03),
            lPerKm: ln.lPerKm ?? (lengthKm > 0 ? lTotal / lengthKm : 0.001),
            cPerKm: ln.cPerKm ?? (lengthKm > 0 ? cTotal / lengthKm : 1.1e-8),
            r0PerKm: ln.r0PerKm,
            l0PerKm: ln.l0PerKm,
            c0PerKm: ln.c0PerKm,
          });
        this.ulmLines.push(ulm);
        this.registerBranchBuffers(ln.id);
        return;
      }

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

        const hasModal = Boolean(
          ln.hasModal ||
          ln.r0PerKm !== undefined ||
          ln.l0PerKm !== undefined ||
          ln.c0PerKm !== undefined ||
          ln.r0TotalOhm !== undefined ||
          ln.l0TotalHenry !== undefined ||
          ln.c0TotalFarad !== undefined,
        );

        let delaySteps0 = delaySteps;
        let fracDelay0 = fracDelay;
        let gBerg0 = gBerg;
        let hLoss0 = hLoss;
        let delaySteps1 = delaySteps;
        let fracDelay1 = fracDelay;
        let gBerg1 = gBerg;
        let hLoss1 = hLoss;
        let gSelf = gBerg;
        let gMutual = 0.0;

        if (hasModal) {
          const r0Total = ln.r0TotalOhm ?? (lengthKm > 0 && ln.r0PerKm ? ln.r0PerKm * lengthKm : 3.0 * rTotal);
          const l0Total = ln.l0TotalHenry ?? (lengthKm > 0 && ln.l0PerKm ? ln.l0PerKm * lengthKm : 3.0 * lTotal);
          const c0Total = ln.c0TotalFarad ?? (lengthKm > 0 && ln.c0PerKm ? ln.c0PerKm * lengthKm : 0.65 * cTotal);

          const tau0 = l0Total > 0 && c0Total > 0 ? Math.sqrt(l0Total * c0Total) : tau;
          const zChar0 = Math.sqrt(l0Total / c0Total);
          const rQuarter0 = 0.25 * Math.max(0, r0Total);
          const zBerg0 = Math.max(1e-3, zChar0 + rQuarter0);
          gBerg0 = 1.0 / zBerg0;
          hLoss0 = Math.max(-0.999, Math.min(1.0, (zChar0 - rQuarter0) / zBerg0));
          const exactSteps0 = tau0 / this.timeStepSec;
          delaySteps0 = Math.max(1, Math.floor(exactSteps0));
          fracDelay0 = Math.max(0, Math.min(1, exactSteps0 - delaySteps0));

          delaySteps1 = delaySteps;
          fracDelay1 = fracDelay;
          gBerg1 = gBerg;
          hLoss1 = hLoss;

          gSelf = (1.0 / 3.0) * gBerg0 + (2.0 / 3.0) * gBerg1;
          gMutual = (1.0 / 3.0) * (gBerg0 - gBerg1);
        }

        const maxDelay = Math.max(delaySteps, delaySteps0, delaySteps1);
        const bufLen = maxDelay + 3;
        const { ia, ib, ic } = this.registerBranchBuffers(ln.id);

        const isFdpm = modelType === "fdpm";
        const fdSynth = isFdpm
          ? synthesizeFdLineModel(
              {
                lengthKm: lengthKm > 0 ? lengthKm : 100.0,
                rPerKm: ln.rPerKm ?? (lengthKm > 0 ? rTotal / lengthKm : 0.03),
                lPerKm: ln.lPerKm ?? (lengthKm > 0 ? lTotal / lengthKm : 0.001),
                cPerKm: ln.cPerKm ?? (lengthKm > 0 ? cTotal / lengthKm : 1.1e-8),
                r0PerKm: ln.r0PerKm,
                l0PerKm: ln.l0PerKm,
                c0PerKm: ln.c0PerKm,
                towerHeightM: ln.towerHeightM,
                phaseSpacingM: ln.phaseSpacingM,
                conductorRadiusM: ln.conductorRadiusM,
                soilResistivityOhmM: ln.soilResistivityOhmM,
                poles: ln.poles,
                residues: ln.residues,
                d0: ln.d0,
              },
              this.timeStepSec,
            )
          : null;

        const rawPoles =
          isFdpm && ln.poles && ln.poles.length > 0 ? ln.poles : fdSynth ? Array.from(fdSynth.hPoles) : [];
        const nPoles = rawPoles.length;
        const expDecays = new Float64Array(nPoles);
        const convGains = new Float64Array(nPoles);
        let d0 = isFdpm ? (ln.d0 ?? fdSynth?.hD0 ?? 0.35) : 1.0;

        if (isFdpm && nPoles > 0) {
          const defaultWeights = [0.4, 0.3, 0.2, 0.1];
          const explicitRes =
            ln.residues && ln.residues.length === nPoles
              ? ln.residues
              : fdSynth && fdSynth.hResidues.length === nPoles
                ? Array.from(fdSynth.hResidues)
                : undefined;
          const hasExplicitResidues = Boolean(explicitRes && explicitRes.some((r) => r > 0));
          let sumWeights = 0.0;
          const poleWeights = new Float64Array(nPoles);

          for (let m = 0; m < nPoles; m++) {
            const p = -Math.max(1.0, Math.abs(rawPoles[m]!));
            const alpha = Math.exp(p * this.timeStepSec);
            expDecays[m] = alpha;
            if (hasExplicitResidues) {
              const res = Math.max(0.0, explicitRes![m]!);
              const pw = res / -p;
              poleWeights[m] = pw;
              sumWeights += pw;
            }
          }

          const hDc = Math.max(0.0, Math.min(1.0, hLoss > 0 ? hLoss : 0.98));
          if (hasExplicitResidues) {
            d0 = Math.max(0.05, Math.min(0.5, ln.d0 ?? fdSynth?.hD0 ?? 0.35));
            const totalDynamicGain = Math.max(0.0, hDc - d0);
            for (let m = 0; m < nPoles; m++) {
              const w = sumWeights > 1e-12 ? poleWeights[m]! / sumWeights : 1.0 / nPoles;
              convGains[m] = totalDynamicGain * w * (1.0 - expDecays[m]!);
            }
          } else {
            for (let m = 0; m < nPoles; m++) {
              const w = defaultWeights[m] ?? 1.0 / nPoles;
              convGains[m] = (1.0 - d0) * w * (1.0 - expDecays[m]!);
            }
          }
        }

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
          hasModal,
          delaySteps0,
          fracDelay0,
          gBerg0,
          hLoss0,
          delaySteps1,
          fracDelay1,
          gBerg1,
          hLoss1,
          gSelf,
          gMutual,
          isFdpm,
          d0,
          gInf: fdSynth ? fdSynth.gInf : gBerg,
          yPoles: fdSynth ? fdSynth.yPoles : new Float64Array(0),
          yResidues: fdSynth ? fdSynth.yResidues : new Float64Array(0),
          hPoles: fdSynth ? fdSynth.hPoles : new Float64Array(0),
          hResidues: fdSynth ? fdSynth.hResidues : new Float64Array(0),
          expDecays,
          convGains,
          xKmA: new Float64Array(nPoles),
          xKmB: new Float64Array(nPoles),
          xKmC: new Float64Array(nPoles),
          xMkA: new Float64Array(nPoles),
          xMkB: new Float64Array(nPoles),
          xMkC: new Float64Array(nPoles),
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
        const poleTimes = initialClosed
          ? (br as any).poleOpenTimesSec
          : ((br as any).poleCloseTimesSec ?? (br as any).poleActionTimesSec);
        const poleActionTimesSec: [number, number, number] | undefined = poleTimes
          ? [
              poleTimes.a ?? poleTimes[0] ?? actionTimeSec,
              poleTimes.b ?? poleTimes[1] ?? actionTimeSec,
              poleTimes.c ?? poleTimes[2] ?? actionTimeSec,
            ]
          : undefined;

        this.switchStates.push({
          sw: {
            id: br.id,
            fromBus,
            toBus,
            initialClosed,
            actionTimeSec,
            poleActionTimesSec,
            rClosedOhm: br.rClosedOhm,
            rOpenOhm: br.rOpenOhm,
          },
          fromIdx,
          toIdx,
          currentClosed: initialClosed,
          phaseClosed: [initialClosed, initialClosed, initialClosed],
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

    // Register Metal Oxide Surge Arresters (MOVs)
    for (const arr of this.netlist.surgeArresters ?? []) {
      const fromBus = arr.fromBus ?? "0";
      const toBus = arr.toBus ?? "0";
      const fromIdx = fromBus === "0" || fromBus === "GND" ? -1 : (this.busIdxMap.get(fromBus) ?? -1);
      const toIdx = toBus === "0" || toBus === "GND" ? -1 : (this.busIdxMap.get(toBus) ?? -1);
      if (fromIdx === -1 && toIdx === -1) continue;
      const vRefVolts = (arr.vRefKv ?? 400.0) * 1e3;
      const rClampOhm = arr.rClampOhm ?? 0.5;
      const n3 = this.nPhaseNodes;
      this.surgeArresters.push({
        id: arr.id,
        fromIdx,
        toIdx,
        vRefVolts,
        rClampOhm,
        energyJoules: 0.0,
        zThPhase: [50.0, 50.0, 50.0],
        xThPhase: [new Float64Array(n3), new Float64Array(n3), new Float64Array(n3)],
      });
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
      const initClosed = Boolean(sw.initialClosed);
      this.switchStates.push({
        sw,
        fromIdx,
        toIdx,
        currentClosed: initClosed,
        phaseClosed: [initClosed, initClosed, initClosed],
        ia,
        ib,
        ic,
      });
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
        phaseClosed: [initialClosed, initialClosed, initialClosed],
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
          this.bergeronLines.some((l) => l.fromIdx === i || l.toIdx === i) ||
          this.ulmLines.some((l) => l.fromIdx === i || l.toIdx === i);
        const gStab = hasBranch ? 1e-5 : 1e-4;
        this.busSources.set(i, [{ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gStab }]);
      }
    }

    // Register EMTDC Fortran / C / Binary UDM blocks
    if (this.netlist.customFortranBlocks && this.netlist.customFortranBlocks.length > 0) {
      this.emtdcHostBridge = new EmtdcHostBridge({
        timeStepSec: this.timeStepSec,
        maxNodes: Math.max(1024, this.nBuses + 1),
      });

      for (const block of this.netlist.customFortranBlocks) {
        let udm: EmtdcRegisteredUdm;
        let runner: EmtdcWasmMachinaDllRunner | undefined;
        if (block.binaryBuffer) {
          const drmOptions =
            this.options.drmLicenseOptions ??
            (this.options.strictDrmLicense || block.requireHardwareDongle
              ? {
                  mode: "strict" as const,
                  allowedFirmCodes: block.drmFirmCode !== undefined ? [block.drmFirmCode] : undefined,
                  allowedProductCodes: block.drmProductCode !== undefined ? [block.drmProductCode] : undefined,
                }
              : undefined);
          const res = this.emtdcHostBridge.registerBinaryDll({
            id: block.id,
            binaryBuffer: block.binaryBuffer,
            dsdynSymbol: block.dsdynSymbol,
            dsoutSymbol: block.dsoutSymbol,
            portNames: (block.referencedPorts ?? []).concat(block.assignedPorts ?? []),
            numRealStates: block.numRealStates,
            numIntStates: block.numIntStates,
            drmOptions,
          });
          udm = res.udm;
          runner = res.runner;
        } else if (block.step) {
          udm = this.emtdcHostBridge.registerCustomFortranBlock(block);
        } else {
          udm = this.emtdcHostBridge.registerUdm({
            id: block.id,
            subroutineName: block.name,
            numRealStates: block.numRealStates,
            numIntStates: block.numIntStates,
          });
        }

        const busId =
          block.connectedBus ??
          block.outputs?.find((o) => this.busIdxMap.has(o.targetId ?? ""))?.targetId ??
          block.inputs?.find((i) => this.busIdxMap.has(i.sourceId ?? ""))?.sourceId;
        const busIdx = busId ? (this.busIdxMap.get(busId) ?? -1) : -1;

        let ia: Float64Array | undefined;
        let ib: Float64Array | undefined;
        let ic: Float64Array | undefined;
        if (busIdx >= 0) {
          const buffers = this.registerBranchBuffers(block.id);
          ia = buffers.ia;
          ib = buffers.ib;
          ic = buffers.ic;
        }

        const signalTrajs = new Map<string, Float64Array>();
        const allPorts = (block.assignedPorts ?? []).concat(block.referencedPorts ?? []);
        for (const port of allPorts) {
          const traj = new Float64Array(this.nSteps);
          signalTrajs.set(port, traj);
          this.controlSignals.set(`${block.id}_${port}`, traj);
        }

        this.customBlockStates.push({
          block,
          udm,
          runner,
          busIdx,
          ia,
          ib,
          ic,
          signalTrajs,
        });
      }
    }
  }

  /**
   * Resets the conductance matrix G3 (or sparse triplet builder) prior to assembly.
   */
  private resetConductanceMatrix(): void {
    if (this.useSparse && this.gTriplets) {
      this.gTriplets.clear();
    } else {
      this.G3.fill(0);
    }
  }

  /**
   * Stamps a diagonal conductance g at scalar phase-node index pNode (0..3N-1).
   */
  private stampDiagonal(pNode: number, g: number): void {
    if (pNode < 0) return;
    if (this.useSparse && this.gTriplets) {
      this.gTriplets.addStructural(pNode, pNode, g);
    } else {
      const n3 = this.nPhaseNodes;
      this.G3[pNode * n3 + pNode] = this.G3[pNode * n3 + pNode]! + g;
    }
  }

  /**
   * Stamps a scalar entry g at (r, c) in G3 or sparse triplets.
   */
  private stampEntry(r: number, c: number, g: number): void {
    if (r < 0 || c < 0) return;
    if (this.useSparse && this.gTriplets) {
      this.gTriplets.addStructural(r, c, g);
    } else {
      const n3 = this.nPhaseNodes;
      this.G3[r * n3 + c] = this.G3[r * n3 + c]! + g;
    }
  }

  /**
   * In-place LU factorization with partial pivoting for the coupled 3N x 3N phase-domain matrix,
   * or sparse CCS symbolic-numeric factorization with cached AMD column permutation when `useSparse` is active.
   */
  private factorize3Phase(A: Float64Array, LU: Float64Array, piv: Int32Array): boolean {
    if (this.useSparse && this.gTriplets) {
      if (
        this.sparseCcs &&
        this.gTripletMap &&
        this.sparseFactors &&
        this.gTriplets.updateCCSValues(this.sparseCcs, this.gTripletMap)
      ) {
        if (sparseLuRefactorize(this.sparseCcs, this.sparseFactors, { allowPerturbation: true })) {
          return true;
        }
        this.sparseFactors = sparseLuAnalyze(this.sparseCcs, {
          colPerm: this.colPerm,
          allowPerturbation: true,
        });
        return this.sparseFactors !== null;
      }

      const built = this.gTriplets.buildCCSWithMap();
      this.sparseCcs = built.ccs;
      this.gTripletMap = built.tripletToCcsIdx;
      if (!this.colPerm) {
        this.colPerm = computeAmdOrdering(this.sparseCcs);
      }
      this.sparseFactors = sparseLuAnalyze(this.sparseCcs, {
        colPerm: this.colPerm,
        allowPerturbation: true,
      });
      return this.sparseFactors !== null;
    }

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
   * Fast forward and back substitution using precomputed 3N x 3N LU factors (dense or sparse CCS).
   */
  private solveFromLU3Phase(LU: Float64Array, piv: Int32Array, b: Float64Array, x: Float64Array): void {
    if (this.useSparse && this.sparseFactors) {
      sparseLuSolve(this.sparseFactors, b, x);
      return;
    }

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
   * Precomputes Thévenin driving-point impedances zTh and response vectors xTh = G3^-1 * e_uv
   * for all registered Metal Oxide Surge Arresters (MOVs) whenever G3 is factorized.
   */
  private updateSurgeArresterTheveninVectors(): void {
    if (this.surgeArresters.length === 0) return;
    const n3 = this.nPhaseNodes;
    const e = new Float64Array(n3);

    for (const arr of this.surgeArresters) {
      for (let p = 0; p < 3; p++) {
        const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
        const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
        if (u < 0 && v < 0) continue;

        e.fill(0);
        if (u >= 0) e[u] = 1.0;
        if (v >= 0) e[v] = -1.0;

        const x = arr.xThPhase[p]!;
        this.solveFromLU3Phase(this.LU3, this.piv3, e, x);

        const zTh = (u >= 0 ? x[u]! : 0.0) - (v >= 0 ? x[v]! : 0.0);
        arr.zThPhase[p] = Math.max(1e-4, zTh);
      }
    }
  }

  /**
   * Stamps a scalar conductance g between two scalar phase-node indices (p1, p2 in 0..3N-1).
   */
  private stampNodeAdmittance(p1: number, p2: number, g: number): void {
    if (p1 >= 0) this.stampDiagonal(p1, g);
    if (p2 >= 0) this.stampDiagonal(p2, g);
    if (p1 >= 0 && p2 >= 0) {
      this.stampEntry(p1, p2, -g);
      this.stampEntry(p2, p1, -g);
    }
  }

  /**
   * Stamps a 3x3 phase-coupled branch (self conductance gSelf, mutual conductance gMut)
   * between bus i and bus j in the 3N x 3N matrix G3.
   */
  private stamp3PhaseBranch(i: number, j: number, gSelf: number, gMut: number = 0): void {
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
            this.stampEntry(pi1, pi2, gMut);
          }
          if (pj1 >= 0 && pj2 >= 0) {
            this.stampEntry(pj1, pj2, gMut);
          }
          if (pi1 >= 0 && pj2 >= 0) {
            this.stampEntry(pi1, pj2, -gMut);
            this.stampEntry(pj2, pi1, -gMut);
          }
        }
      }
    }
  }

  /**
   * Stamps a 3-phase Universal Line Model (ULM) high-frequency terminal admittance matrix G_eq (3x3)
   * into the diagonal blocks of terminal bus K (fromIdx) and terminal bus M (toIdx).
   */
  private stampUlmModel(ulm: UniversalLineModelData): void {
    if (ulm.fromIdx >= 0) {
      const baseK = 3 * ulm.fromIdx;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          this.stampEntry(baseK + r, baseK + c, ulm.gEq[r * 3 + c]!);
        }
      }
    }
    if (ulm.toIdx >= 0) {
      const baseM = 3 * ulm.toIdx;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          this.stampEntry(baseM + r, baseM + c, ulm.gEq[r * 3 + c]!);
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

    // Fall back to TS if mutual branches or closed-loop relays are used
    if (
      this.companionBranches.some((br) => Math.abs(br.gMut) > 1e-12 || br.windingConnection !== undefined) ||
      (this.netlist.protectionRelays && this.netlist.protectionRelays.length > 0) ||
      (this.netlist.converterBridges && this.netlist.converterBridges.length > 0) ||
      this.fmuStates.length > 0 ||
      Boolean(this.options?.boundaryFeeds?.length)
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

      if (this.bergeronLines.length > 0) {
        for (const bl of this.bergeronLines) {
          const tauSec = (bl.delaySteps + bl.fracDelay) * dt;
          if (
            bl.isFdpm &&
            typeof wasm.emt_add_fd_line === "function" &&
            typeof wasm.emt_add_fd_line_y_pole === "function" &&
            typeof wasm.emt_add_fd_line_h_pole === "function"
          ) {
            const nY = bl.yPoles.length;
            const nH = bl.hPoles.length;
            for (let p = 0; p < 3; p++) {
              const fromNode = bl.fromIdx >= 0 ? bl.fromIdx * 3 + p : -1;
              const toNode = bl.toIdx >= 0 ? bl.toIdx * 3 + p : -1;
              const fdIdx = wasm.emt_add_fd_line(
                solverPtr,
                fromNode,
                toNode,
                bl.gInf,
                tauSec,
                Math.max(4, nY),
                Math.max(4, nH),
              );
              if (fdIdx < 0) return null;
              for (let m = 0; m < nY; m++) {
                wasm.emt_add_fd_line_y_pole(solverPtr, fdIdx, bl.yPoles[m]!, bl.yResidues[m]!);
              }
              for (let m = 0; m < nH; m++) {
                wasm.emt_add_fd_line_h_pole(solverPtr, fdIdx, bl.hPoles[m]!, bl.hResidues[m]!);
              }
            }
          } else {
            if (typeof wasm.emt_add_bergeron_line !== "function") return null;
            const rQuarter = Math.max(0, 1.0 / bl.gBerg - bl.zChar);
            const rTotal = 4.0 * rQuarter;
            for (let p = 0; p < 3; p++) {
              const fromNode = bl.fromIdx >= 0 ? bl.fromIdx * 3 + p : -1;
              const toNode = bl.toIdx >= 0 ? bl.toIdx * 3 + p : -1;
              wasm.emt_add_bergeron_line(solverPtr, fromNode, toNode, bl.zChar, tauSec, rTotal);
            }
          }
        }
      }

      if (this.switchStates.length > 0) {
        if (typeof wasm.emt_add_breaker !== "function") return null;
        for (const swState of this.switchStates) {
          const gClosed = 1.0 / Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4);
          const gOpen = 1.0 / Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
          const initClosed = Boolean(swState.sw.initialClosed);
          const openTime = initClosed ? swState.sw.actionTimeSec : 1e9;
          const closeTime = !initClosed ? swState.sw.actionTimeSec : 1e9;
          for (let p = 0; p < 3; p++) {
            const fromNode = swState.fromIdx >= 0 ? swState.fromIdx * 3 + p : -1;
            const toNode = swState.toIdx >= 0 ? swState.toIdx * 3 + p : -1;
            wasm.emt_add_breaker(solverPtr, fromNode, toNode, gClosed, gOpen, initClosed, openTime, closeTime, 0.0);
          }
        }
      }

      if (this.netlist.faults && this.netlist.faults.length > 0) {
        if (typeof wasm.emt_add_fault !== "function") return null;
        for (const flt of this.netlist.faults) {
          const bIdx = this.busIdxMap.get(flt.bus) ?? 0;
          const rFlt = flt.rFaultOhm !== undefined && flt.rFaultOhm > 0 ? flt.rFaultOhm : 0.5;
          const gFlt = 1.0 / rFlt;
          const pA = 3 * bIdx + 0;
          const pB = 3 * bIdx + 1;
          const pC = 3 * bIdx + 2;
          if (flt.faultType === "3PH") {
            wasm.emt_add_fault(solverPtr, pA, -1, flt.startSec, flt.endSec, gFlt);
            wasm.emt_add_fault(solverPtr, pB, -1, flt.startSec, flt.endSec, gFlt);
            wasm.emt_add_fault(solverPtr, pC, -1, flt.startSec, flt.endSec, gFlt);
          } else if (flt.faultType === "SLG") {
            wasm.emt_add_fault(solverPtr, pA, -1, flt.startSec, flt.endSec, gFlt);
          } else if (flt.faultType === "DLG") {
            wasm.emt_add_fault(solverPtr, pB, -1, flt.startSec, flt.endSec, gFlt);
            wasm.emt_add_fault(solverPtr, pC, -1, flt.startSec, flt.endSec, gFlt);
            wasm.emt_add_fault(solverPtr, pB, pC, flt.startSec, flt.endSec, 0.5 * gFlt);
          } else {
            wasm.emt_add_fault(solverPtr, pB, pC, flt.startSec, flt.endSec, gFlt);
          }
        }
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
      let wasmLuCount = 1;
      const wasmSwitchingEvents = 0;

      const startTime = performance.now();
      const vVecPtr = wasm.emt_get_voltages_ptr(solverPtr);
      const vView = new Float64Array(wasm.memory.buffer, vVecPtr, this.nBuses * 3);

      for (const b of this.busList) {
        this.busVoltages.set(b.id, this.busPhaseVoltages.get(b.id)!.a);
      }

      const busPvs = this.busList.map((b) => this.busPhaseVoltages.get(b.id)!);
      const branchPbs = branchIndices.map((br) => ({
        pb: this.branchPhaseCurrents.get(br.id)!,
        idxA: br.idxA,
        idxB: br.idxB,
        idxC: br.idxC,
      }));

      // If no discrete branches require per-step current queries and no step callback is attached,
      // execute the entire stepping sequence in a single zero-overhead WebAssembly call via emt_run_steps.
      if (
        branchIndices.length === 0 &&
        this.bergeronLines.length === 0 &&
        this.switchStates.length === 0 &&
        !this.options.onStep &&
        typeof wasm.emt_alloc_trajectory === "function" &&
        typeof wasm.emt_run_steps === "function" &&
        typeof wasm.emt_get_trajectory_ptr === "function"
      ) {
        const trajPtr = wasm.emt_alloc_trajectory(solverPtr, this.nSteps);
        if (trajPtr) {
          wasm.emt_run_steps(solverPtr, this.nSteps);
          const stride = 1 + this.nBuses * 3;
          const trajView = new Float64Array(wasm.memory.buffer, trajPtr, this.nSteps * stride);
          for (let k = 0; k < this.nSteps; k++) {
            const stepOffset = k * stride;
            for (let b = 0; b < this.nBuses; b++) {
              const base = stepOffset + 1 + b * 3;
              const pv = busPvs[b]!;
              pv.a[k] = trajView[base + 0]!;
              pv.b[k] = trajView[base + 1]!;
              pv.c[k] = trajView[base + 2]!;
            }
          }
        }
      } else {
        for (let k = 0; k < this.nSteps; k++) {
          wasm.emt_step(solverPtr);

          for (let b = 0; b < this.nBuses; b++) {
            const pv = busPvs[b]!;
            pv.a[k] = vView[b * 3 + 0]!;
            pv.b[k] = vView[b * 3 + 1]!;
            pv.c[k] = vView[b * 3 + 2]!;
          }

          for (let i = 0; i < branchPbs.length; i++) {
            const br = branchPbs[i]!;
            br.pb.a[k] = wasm.emt_get_branch_current(solverPtr, br.idxA);
            br.pb.b[k] = wasm.emt_get_branch_current(solverPtr, br.idxB);
            br.pb.c[k] = wasm.emt_get_branch_current(solverPtr, br.idxC);
          }

          if (this.options.onStep) {
            const busMap = new Map<string, { a: number; b: number; c: number }>();
            for (let b = 0; b < this.nBuses; b++) {
              const pv = busPvs[b]!;
              busMap.set(this.busList[b]!.id, { a: pv.a[k]!, b: pv.b[k]!, c: pv.c[k]! });
            }
            this.options.onStep(this.time[k]!, k, busMap);
          }
        }
      }

      if (typeof wasm.emt_get_factorization_count === "function") {
        wasmLuCount = Math.max(1, wasm.emt_get_factorization_count(solverPtr));
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
          luFactorizations: wasmLuCount,
          switchingEvents: wasmSwitchingEvents,
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
   * Computes terminal traveling-wave history currents for a Bergeron or ULM / J. Marti
   * frequency-dependent (`modelType === "fdpm"`) transmission line using O(N_poles) recursive convolution.
   */
  private computeLineHistoryCurrents(
    bl: BergeronLineState,
    advanceStates: boolean,
  ): {
    iHistKmA: number;
    iHistKmB: number;
    iHistKmC: number;
    iHistMkA: number;
    iHistMkB: number;
    iHistMkC: number;
  } {
    const { ptr, bufLen, delaySteps, fracDelay, gBerg, hLoss } = bl;
    const c1 = 0.5 * (1.0 + hLoss);
    const c2 = 0.5 * (1.0 - hLoss);

    let rawKmA: number;
    let rawKmB: number;
    let rawKmC: number;
    let rawMkA: number;
    let rawMkB: number;
    let rawMkC: number;

    if (bl.hasModal) {
      // 1. Retrieve delayed Mode 0 (Ground return mode with slower velocity tau0)
      const vkDel0 = this.readDelayed(bl.vkBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);
      const vmDel0 = this.readDelayed(bl.vmBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);
      const ikmDel0 = this.readDelayed(bl.ikmBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);
      const imkDel0 = this.readDelayed(bl.imkBufA, ptr, bufLen, bl.delaySteps0, bl.fracDelay0);

      const c1_0 = 0.5 * (1.0 + bl.hLoss0);
      const c2_0 = 0.5 * (1.0 - bl.hLoss0);
      const rawKm0 =
        -c1_0 * (bl.gBerg0 * vmDel0 + bl.hLoss0 * imkDel0) - c2_0 * (bl.gBerg0 * vkDel0 + bl.hLoss0 * ikmDel0);
      const rawMk0 =
        -c1_0 * (bl.gBerg0 * vkDel0 + bl.hLoss0 * ikmDel0) - c2_0 * (bl.gBerg0 * vmDel0 + bl.hLoss0 * imkDel0);

      // 2. Retrieve delayed Modes 1 & 2 (Aerial modes with velocity ~ c)
      const vkDel1 = this.readDelayed(bl.vkBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
      const vmDel1 = this.readDelayed(bl.vmBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
      const ikmDel1 = this.readDelayed(bl.ikmBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
      const imkDel1 = this.readDelayed(bl.imkBufB, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);

      const c1_1 = 0.5 * (1.0 + bl.hLoss1);
      const c2_1 = 0.5 * (1.0 - bl.hLoss1);
      const rawKm1 =
        -c1_1 * (bl.gBerg1 * vmDel1 + bl.hLoss1 * imkDel1) - c2_1 * (bl.gBerg1 * vkDel1 + bl.hLoss1 * ikmDel1);
      const rawMk1 =
        -c1_1 * (bl.gBerg1 * vkDel1 + bl.hLoss1 * ikmDel1) - c2_1 * (bl.gBerg1 * vmDel1 + bl.hLoss1 * imkDel1);

      const vkDel2 = this.readDelayed(bl.vkBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
      const vmDel2 = this.readDelayed(bl.vmBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
      const ikmDel2 = this.readDelayed(bl.ikmBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);
      const imkDel2 = this.readDelayed(bl.imkBufC, ptr, bufLen, bl.delaySteps1, bl.fracDelay1);

      const rawKm2 =
        -c1_1 * (bl.gBerg1 * vmDel2 + bl.hLoss1 * imkDel2) - c2_1 * (bl.gBerg1 * vkDel2 + bl.hLoss1 * ikmDel2);
      const rawMk2 =
        -c1_1 * (bl.gBerg1 * vkDel2 + bl.hLoss1 * ikmDel2) - c2_1 * (bl.gBerg1 * vmDel2 + bl.hLoss1 * imkDel2);

      // 3. Inverse Clarke Transformation T: Modal (0, 1, 2) -> Phase (A, B, C)
      const SQRT3_HALF = 0.5 * Math.sqrt(3.0);
      rawKmA = rawKm0 + rawKm1;
      rawKmB = rawKm0 - 0.5 * rawKm1 + SQRT3_HALF * rawKm2;
      rawKmC = rawKm0 - 0.5 * rawKm1 - SQRT3_HALF * rawKm2;

      rawMkA = rawMk0 + rawMk1;
      rawMkB = rawMk0 - 0.5 * rawMk1 + SQRT3_HALF * rawMk2;
      rawMkC = rawMk0 - 0.5 * rawMk1 - SQRT3_HALF * rawMk2;
    } else {
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

      rawKmA = -c1 * (gBerg * vmDelA + hLoss * imkDelA) - c2 * (gBerg * vkDelA + hLoss * ikmDelA);
      rawKmB = -c1 * (gBerg * vmDelB + hLoss * imkDelB) - c2 * (gBerg * vkDelB + hLoss * ikmDelB);
      rawKmC = -c1 * (gBerg * vmDelC + hLoss * imkDelC) - c2 * (gBerg * vkDelC + hLoss * ikmDelC);

      rawMkA = -c1 * (gBerg * vkDelA + hLoss * ikmDelA) - c2 * (gBerg * vmDelA + hLoss * imkDelA);
      rawMkB = -c1 * (gBerg * vkDelB + hLoss * ikmDelB) - c2 * (gBerg * vmDelB + hLoss * imkDelB);
      rawMkC = -c1 * (gBerg * vkDelC + hLoss * ikmDelC) - c2 * (gBerg * vmDelC + hLoss * imkDelC);
    }

    if (!bl.isFdpm || bl.expDecays.length === 0) {
      return {
        iHistKmA: rawKmA,
        iHistKmB: rawKmB,
        iHistKmC: rawKmC,
        iHistMkA: rawMkA,
        iHistMkB: rawMkB,
        iHistMkC: rawMkC,
      };
    }

    const nPoles = bl.expDecays.length;
    let convKmA = bl.d0 * rawKmA;
    let convKmB = bl.d0 * rawKmB;
    let convKmC = bl.d0 * rawKmC;
    let convMkA = bl.d0 * rawMkA;
    let convMkB = bl.d0 * rawMkB;
    let convMkC = bl.d0 * rawMkC;

    for (let m = 0; m < nPoles; m++) {
      const alpha = bl.expDecays[m]!;
      const beta = bl.convGains[m]!;
      const nextKmA = alpha * bl.xKmA[m]! + beta * rawKmA;
      const nextKmB = alpha * bl.xKmB[m]! + beta * rawKmB;
      const nextKmC = alpha * bl.xKmC[m]! + beta * rawKmC;
      const nextMkA = alpha * bl.xMkA[m]! + beta * rawMkA;
      const nextMkB = alpha * bl.xMkB[m]! + beta * rawMkB;
      const nextMkC = alpha * bl.xMkC[m]! + beta * rawMkC;

      convKmA += nextKmA;
      convKmB += nextKmB;
      convKmC += nextKmC;
      convMkA += nextMkA;
      convMkB += nextMkB;
      convMkC += nextMkC;

      if (advanceStates) {
        bl.xKmA[m] = nextKmA;
        bl.xKmB[m] = nextKmB;
        bl.xKmC[m] = nextKmC;
        bl.xMkA[m] = nextMkA;
        bl.xMkB[m] = nextMkB;
        bl.xMkC[m] = nextMkC;
      }
    }

    return {
      iHistKmA: convKmA,
      iHistKmB: convKmB,
      iHistKmC: convKmC,
      iHistMkA: convMkA,
      iHistMkB: convMkB,
      iHistMkC: convMkC,
    };
  }

  /**
   * Pre-solves the fundamental-frequency AC steady-state over two full cycles prior to t = 0
   * (`t in [-2 * T0, -dt]`) so that all companion branch histories, Bergeron/ULM traveling-wave
   * delay buffers, and synchronous generator states start in sinusoidal steady state at t = 0
   * with zero initialization transient.
   */
  public initializeSteadyState(): void {
    if (this.nBuses === 0) return;
    const periodSec = (2 * Math.PI) / Math.max(1.0, this.omega);
    const stepsPerCycle = Math.max(16, Math.round(periodSec / this.timeStepSec));
    const preSteps = Math.min(2000, 2 * stepsPerCycle);
    const n = this.nBuses;

    // Assemble pre-fault steady-state conductance matrix G3
    this.resetConductanceMatrix();
    for (const [bIdx, srcs] of this.busSources.entries()) {
      for (const s of srcs) {
        for (let p = 0; p < 3; p++) {
          this.stampDiagonal(3 * bIdx + p, s.gSrc);
        }
      }
    }
    for (const sg of this.syncGenerators) {
      for (let p = 0; p < 3; p++) {
        this.stampDiagonal(3 * sg.busIdx + p, sg.gGen);
      }
    }
    for (const br of this.companionBranches) {
      const gTotal = br.gEq + 0.5 * br.shuntG;
      this.stamp3PhaseBranch(br.fromIdx, br.toIdx, gTotal, br.gMut);
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
    for (const bl of this.bergeronLines) {
      if (bl.hasModal) {
        for (let p = 0; p < 3; p++) {
          if (bl.fromIdx >= 0) {
            this.stampDiagonal(3 * bl.fromIdx + p, bl.gSelf);
            for (let q = 0; q < 3; q++) {
              if (p !== q) this.stampEntry(3 * bl.fromIdx + p, 3 * bl.fromIdx + q, bl.gMutual);
            }
          }
          if (bl.toIdx >= 0) {
            this.stampDiagonal(3 * bl.toIdx + p, bl.gSelf);
            for (let q = 0; q < 3; q++) {
              if (p !== q) this.stampEntry(3 * bl.toIdx + p, 3 * bl.toIdx + q, bl.gMutual);
            }
          }
        }
      } else {
        for (let p = 0; p < 3; p++) {
          if (bl.fromIdx >= 0) {
            this.stampDiagonal(3 * bl.fromIdx + p, bl.gBerg);
          }
          if (bl.toIdx >= 0) {
            this.stampDiagonal(3 * bl.toIdx + p, bl.gBerg);
          }
        }
      }
    }
    for (const ulm of this.ulmLines) {
      this.stampUlmModel(ulm);
    }
    for (const swState of this.switchStates) {
      const initClosed = Boolean(swState.sw.initialClosed);
      swState.currentClosed = initClosed;
      swState.phaseClosed = [initClosed, initClosed, initClosed];
      for (let p = 0; p < 3; p++) {
        const rSw = initClosed
          ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
          : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
        const gSw = 1.0 / rSw;
        const u = swState.fromIdx >= 0 ? 3 * swState.fromIdx + p : -1;
        const v = swState.toIdx >= 0 ? 3 * swState.toIdx + p : -1;
        if (u >= 0) this.stampDiagonal(u, gSw);
        if (v >= 0) this.stampDiagonal(v, gSw);
        if (u >= 0 && v >= 0) {
          this.stampEntry(u, v, -gSw);
          this.stampEntry(v, u, -gSw);
        }
      }
    }

    this.factorize3Phase(this.G3, this.LU3, this.piv3);
    this.luValid = true;
    this.updateSurgeArresterTheveninVectors();

    for (let step = -preSteps; step < 0; step++) {
      const t = step * this.timeStepSec;
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
      for (const sg of this.syncGenerators) {
        const thetaE = sg.omega0 * t + sg.deltaRad;
        const ePeak = sg.efPu * sg.vPeak;
        this.J3[3 * sg.busIdx + 0] = this.J3[3 * sg.busIdx + 0]! + sg.gGen * ePeak * Math.sin(thetaE);
        this.J3[3 * sg.busIdx + 1] =
          this.J3[3 * sg.busIdx + 1]! + sg.gGen * ePeak * Math.sin(thetaE - (2 * Math.PI) / 3);
        this.J3[3 * sg.busIdx + 2] =
          this.J3[3 * sg.busIdx + 2]! + sg.gGen * ePeak * Math.sin(thetaE + (2 * Math.PI) / 3);
      }
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
      for (const bl of this.bergeronLines) {
        const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = this.computeLineHistoryCurrents(
          bl,
          false,
        );
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
      for (const ulm of this.ulmLines) {
        const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = stepUlmLine(
          ulm,
          0,
          0,
          0,
          0,
          0,
          0,
          false,
        );
        if (ulm.fromIdx >= 0) {
          this.J3[3 * ulm.fromIdx + 0] = this.J3[3 * ulm.fromIdx + 0]! - iHistKmA;
          this.J3[3 * ulm.fromIdx + 1] = this.J3[3 * ulm.fromIdx + 1]! - iHistKmB;
          this.J3[3 * ulm.fromIdx + 2] = this.J3[3 * ulm.fromIdx + 2]! - iHistKmC;
        }
        if (ulm.toIdx >= 0) {
          this.J3[3 * ulm.toIdx + 0] = this.J3[3 * ulm.toIdx + 0]! - iHistMkA;
          this.J3[3 * ulm.toIdx + 1] = this.J3[3 * ulm.toIdx + 1]! - iHistMkB;
          this.J3[3 * ulm.toIdx + 2] = this.J3[3 * ulm.toIdx + 2]! - iHistMkC;
        }
      }

      // EMTDC Fortran / Binary UDM DSDYN pre-network steady-state step
      if (this.emtdcHostBridge && this.customBlockStates.length > 0) {
        for (const cbs of this.customBlockStates) {
          if (cbs.busIdx >= 0) {
            const va = this.vaStep[cbs.busIdx] ?? 0.0;
            const vb = this.vbStep[cbs.busIdx] ?? 0.0;
            const vc = this.vcStep[cbs.busIdx] ?? 0.0;
            cbs.udm.ports["VA"] = va;
            cbs.udm.ports["VB"] = vb;
            cbs.udm.ports["VC"] = vc;
            cbs.udm.ports["va"] = va;
            cbs.udm.ports["vb"] = vb;
            cbs.udm.ports["vc"] = vc;
            this.emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
          }
        }
        this.emtdcHostBridge.stepDsdyn(t, step === -preSteps, false);
        for (const cbs of this.customBlockStates) {
          if (cbs.busIdx >= 0) {
            const iaInj = cbs.udm.ports["IA_INJ"] ?? cbs.udm.ports["IA"] ?? cbs.udm.ports["ia"] ?? 0.0;
            const ibInj = cbs.udm.ports["IB_INJ"] ?? cbs.udm.ports["IB"] ?? cbs.udm.ports["ib"] ?? 0.0;
            const icInj = cbs.udm.ports["IC_INJ"] ?? cbs.udm.ports["IC"] ?? cbs.udm.ports["ic"] ?? 0.0;
            const ccin = this.emtdcHostBridge.state.CCIN[cbs.busIdx + 1] ?? 0.0;
            this.J3[3 * cbs.busIdx + 0] = this.J3[3 * cbs.busIdx + 0]! + iaInj + ccin;
            this.J3[3 * cbs.busIdx + 1] = this.J3[3 * cbs.busIdx + 1]! + ibInj;
            this.J3[3 * cbs.busIdx + 2] = this.J3[3 * cbs.busIdx + 2]! + icInj;
          }
        }
      }

      this.solveFromLU3Phase(this.LU3, this.piv3, this.J3, this.v3Step);

      // Apply Thévenin compensation for surge arresters during steady-state pre-solve
      for (const arr of this.surgeArresters) {
        for (let p = 0; p < 3; p++) {
          const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
          const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
          const vOpen = (u >= 0 ? this.v3Step[u]! : 0.0) - (v >= 0 ? this.v3Step[v]! : 0.0);
          const vMag = Math.abs(vOpen);
          if (vMag > arr.vRefVolts) {
            const zTh = arr.zThPhase[p]!;
            const iCorr = Math.sign(vOpen) * ((vMag - arr.vRefVolts) / (zTh + arr.rClampOhm));
            const xTh = arr.xThPhase[p]!;
            for (let j = 0; j < this.nPhaseNodes; j++) {
              this.v3Step[j] = this.v3Step[j]! - xTh[j]! * iCorr;
            }
          }
        }
      }

      for (let i = 0; i < n; i++) {
        this.vaStep[i] = this.v3Step[3 * i + 0]!;
        this.vbStep[i] = this.v3Step[3 * i + 1]!;
        this.vcStep[i] = this.v3Step[3 * i + 2]!;
      }

      // EMTDC Fortran / Binary UDM DSOUT post-network steady-state step
      if (this.emtdcHostBridge && this.customBlockStates.length > 0) {
        for (const cbs of this.customBlockStates) {
          if (cbs.busIdx >= 0) {
            const va = this.vaStep[cbs.busIdx]!;
            const vb = this.vbStep[cbs.busIdx]!;
            const vc = this.vcStep[cbs.busIdx]!;
            cbs.udm.ports["VA"] = va;
            cbs.udm.ports["VB"] = vb;
            cbs.udm.ports["VC"] = vc;
            cbs.udm.ports["va"] = va;
            cbs.udm.ports["vb"] = vb;
            cbs.udm.ports["vc"] = vc;
            this.emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
          }
        }
        this.emtdcHostBridge.stepDsout();
      }

      for (const br of this.companionBranches) {
        const dvA = (br.fromIdx >= 0 ? this.vaStep[br.fromIdx]! : 0) - (br.toIdx >= 0 ? this.vaStep[br.toIdx]! : 0);
        const dvB = (br.fromIdx >= 0 ? this.vbStep[br.fromIdx]! : 0) - (br.toIdx >= 0 ? this.vbStep[br.toIdx]! : 0);
        const dvC = (br.fromIdx >= 0 ? this.vcStep[br.fromIdx]! : 0) - (br.toIdx >= 0 ? this.vcStep[br.toIdx]! : 0);
        const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
        const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
        const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
        br.iHistA =
          br.alphaHist * curA +
          br.alphaMutHist * (curB + curC) +
          br.vCoeffHist * (br.gEq * dvA + br.gMut * (dvB + dvC));
        br.iHistB =
          br.alphaHist * curB +
          br.alphaMutHist * (curA + curC) +
          br.vCoeffHist * (br.gEq * dvB + br.gMut * (dvA + dvC));
        br.iHistC =
          br.alphaHist * curC +
          br.alphaMutHist * (curA + curB) +
          br.vCoeffHist * (br.gEq * dvC + br.gMut * (dvA + dvB));
      }

      for (const bl of this.bergeronLines) {
        const { ptr, bufLen, gBerg } = bl;
        const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = this.computeLineHistoryCurrents(
          bl,
          true,
        );
        const vkA = bl.fromIdx >= 0 ? this.vaStep[bl.fromIdx]! : 0.0;
        const vkB = bl.fromIdx >= 0 ? this.vbStep[bl.fromIdx]! : 0.0;
        const vkC = bl.fromIdx >= 0 ? this.vcStep[bl.fromIdx]! : 0.0;
        const vmA = bl.toIdx >= 0 ? this.vaStep[bl.toIdx]! : 0.0;
        const vmB = bl.toIdx >= 0 ? this.vbStep[bl.toIdx]! : 0.0;
        const vmC = bl.toIdx >= 0 ? this.vcStep[bl.toIdx]! : 0.0;

        if (bl.hasModal) {
          const ONE_OVER_3 = 1.0 / 3.0;
          const ONE_OVER_SQRT3 = 1.0 / Math.sqrt(3.0);
          const ikmA = bl.gSelf * vkA + bl.gMutual * (vkB + vkC) + iHistKmA;
          const ikmB = bl.gSelf * vkB + bl.gMutual * (vkA + vkC) + iHistKmB;
          const ikmC = bl.gSelf * vkC + bl.gMutual * (vkA + vkB) + iHistKmC;

          const imkA = bl.gSelf * vmA + bl.gMutual * (vmB + vmC) + iHistMkA;
          const imkB = bl.gSelf * vmB + bl.gMutual * (vmA + vmC) + iHistMkB;
          const imkC = bl.gSelf * vmC + bl.gMutual * (vmA + vmB) + iHistMkC;

          bl.vkBufA[ptr] = ONE_OVER_3 * (vkA + vkB + vkC);
          bl.vkBufB[ptr] = ONE_OVER_3 * (2.0 * vkA - vkB - vkC);
          bl.vkBufC[ptr] = ONE_OVER_SQRT3 * (vkB - vkC);

          bl.vmBufA[ptr] = ONE_OVER_3 * (vmA + vmB + vmC);
          bl.vmBufB[ptr] = ONE_OVER_3 * (2.0 * vmA - vmB - vmC);
          bl.vmBufC[ptr] = ONE_OVER_SQRT3 * (vmB - vmC);

          bl.ikmBufA[ptr] = ONE_OVER_3 * (ikmA + ikmB + ikmC);
          bl.ikmBufB[ptr] = ONE_OVER_3 * (2.0 * ikmA - ikmB - ikmC);
          bl.ikmBufC[ptr] = ONE_OVER_SQRT3 * (ikmB - ikmC);

          bl.imkBufA[ptr] = ONE_OVER_3 * (imkA + imkB + imkC);
          bl.imkBufB[ptr] = ONE_OVER_3 * (2.0 * imkA - imkB - imkC);
          bl.imkBufC[ptr] = ONE_OVER_SQRT3 * (imkB - imkC);
        } else {
          bl.vkBufA[ptr] = vkA;
          bl.vkBufB[ptr] = vkB;
          bl.vkBufC[ptr] = vkC;
          bl.vmBufA[ptr] = vmA;
          bl.vmBufB[ptr] = vmB;
          bl.vmBufC[ptr] = vmC;
          bl.ikmBufA[ptr] = gBerg * vkA + iHistKmA;
          bl.ikmBufB[ptr] = gBerg * vkB + iHistKmB;
          bl.ikmBufC[ptr] = gBerg * vkC + iHistKmC;
          bl.imkBufA[ptr] = gBerg * vmA + iHistMkA;
          bl.imkBufB[ptr] = gBerg * vmB + iHistMkB;
          bl.imkBufC[ptr] = gBerg * vmC + iHistMkC;
        }
        bl.ptr = (ptr + 1) % bufLen;
      }

      for (const ulm of this.ulmLines) {
        const vkA = ulm.fromIdx >= 0 ? this.vaStep[ulm.fromIdx]! : 0.0;
        const vkB = ulm.fromIdx >= 0 ? this.vbStep[ulm.fromIdx]! : 0.0;
        const vkC = ulm.fromIdx >= 0 ? this.vcStep[ulm.fromIdx]! : 0.0;
        const vmA = ulm.toIdx >= 0 ? this.vaStep[ulm.toIdx]! : 0.0;
        const vmB = ulm.toIdx >= 0 ? this.vbStep[ulm.toIdx]! : 0.0;
        const vmC = ulm.toIdx >= 0 ? this.vcStep[ulm.toIdx]! : 0.0;
        stepUlmLine(ulm, vkA, vkB, vkC, vmA, vmB, vmC, true);
      }
    }
  }

  /**
   * Restores solver internal state (bus voltages, companion branch histories, Bergeron/ULM line buffers,
   * synchronous generator rotor angles, and switch states) from a `PscadSnapshot` (`.snp`).
   */
  public applySnapshot(snapshot: PscadSnapshot): void {
    for (const [busId, v] of Object.entries(snapshot.busVoltages ?? {})) {
      const idx = this.busIdxMap.get(busId);
      if (idx !== undefined && idx >= 0) {
        this.vaStep[idx] = v.va;
        this.vbStep[idx] = v.vb;
        this.vcStep[idx] = v.vc;
      }
    }
    for (const br of this.companionBranches) {
      const h = snapshot.branchHistories?.[br.id];
      if (h) {
        br.iHistA = h.iHistA;
        br.iHistB = h.iHistB;
        br.iHistC = h.iHistC;
      }
    }
    if (snapshot.bergeronBuffers) {
      for (const bl of this.bergeronLines) {
        const b = snapshot.bergeronBuffers[bl.id];
        if (!b) continue;
        bl.ptr = b.ptr % bl.bufLen;
        const copyBuf = (dst: Float64Array, src: number[]) => {
          const len = Math.min(dst.length, src.length);
          for (let i = 0; i < len; i++) dst[i] = src[i]!;
        };
        copyBuf(bl.vkBufA, b.vkBufA);
        copyBuf(bl.vkBufB, b.vkBufB);
        copyBuf(bl.vkBufC, b.vkBufC);
        copyBuf(bl.vmBufA, b.vmBufA);
        copyBuf(bl.vmBufB, b.vmBufB);
        copyBuf(bl.vmBufC, b.vmBufC);
        copyBuf(bl.ikmBufA, b.ikmBufA);
        copyBuf(bl.ikmBufB, b.ikmBufB);
        copyBuf(bl.ikmBufC, b.ikmBufC);
        copyBuf(bl.imkBufA, b.imkBufA);
        copyBuf(bl.imkBufB, b.imkBufB);
        copyBuf(bl.imkBufC, b.imkBufC);
      }
    }
    if (snapshot.syncGenerators) {
      for (const sg of this.syncGenerators) {
        const g = snapshot.syncGenerators[sg.id];
        if (g) {
          sg.deltaRad = g.deltaRad;
          sg.omegaRadSec = g.omegaRadSec;
        }
      }
    }
    if (snapshot.switchStates) {
      for (const sw of this.switchStates) {
        const st = snapshot.switchStates[sw.sw.id];
        if (typeof st === "boolean") {
          sw.currentClosed = st;
        }
      }
    }
    this.luValid = false;
  }

  /**
   * Exports the current (or specified step's) complete EMT operating point as a `PscadSnapshot` (`.snp`).
   */
  public exportSnapshot(stepIndex?: number): PscadSnapshot {
    const k =
      stepIndex !== undefined ? Math.max(0, Math.min(this.nSteps - 1, stepIndex)) : Math.max(0, this.nSteps - 1);
    const busVoltages: Record<string, { va: number; vb: number; vc: number }> = {};
    for (let i = 0; i < this.nBuses; i++) {
      const busId = this.busList[i]!.id;
      const pv = this.busPhaseVoltages.get(busId);
      const useTraj = stepIndex !== undefined && pv && (pv.a[k] !== 0 || pv.b[k] !== 0 || pv.c[k] !== 0);
      busVoltages[busId] = {
        va: useTraj ? pv!.a[k]! : this.vaStep[i]!,
        vb: useTraj ? pv!.b[k]! : this.vbStep[i]!,
        vc: useTraj ? pv!.c[k]! : this.vcStep[i]!,
      };
    }

    const branchHistories: Record<string, { iHistA: number; iHistB: number; iHistC: number }> = {};
    for (const br of this.companionBranches) {
      branchHistories[br.id] = {
        iHistA: br.iHistA,
        iHistB: br.iHistB,
        iHistC: br.iHistC,
      };
    }

    const bergeronBuffers: NonNullable<PscadSnapshot["bergeronBuffers"]> = {};
    for (const bl of this.bergeronLines) {
      bergeronBuffers[bl.id] = {
        ptr: bl.ptr,
        vkBufA: Array.from(bl.vkBufA),
        vkBufB: Array.from(bl.vkBufB),
        vkBufC: Array.from(bl.vkBufC),
        vmBufA: Array.from(bl.vmBufA),
        vmBufB: Array.from(bl.vmBufB),
        vmBufC: Array.from(bl.vmBufC),
        ikmBufA: Array.from(bl.ikmBufA),
        ikmBufB: Array.from(bl.ikmBufB),
        ikmBufC: Array.from(bl.ikmBufC),
        imkBufA: Array.from(bl.imkBufA),
        imkBufB: Array.from(bl.imkBufB),
        imkBufC: Array.from(bl.imkBufC),
      };
    }

    const syncGenerators: Record<string, { deltaRad: number; omegaRadSec: number }> = {};
    for (const sg of this.syncGenerators) {
      syncGenerators[sg.id] = {
        deltaRad: sg.deltaRad,
        omegaRadSec: sg.omegaRadSec,
      };
    }

    const switchStates: Record<string, boolean> = {};
    for (const sw of this.switchStates) {
      switchStates[sw.sw.id] = sw.currentClosed;
    }

    return {
      formatVersion: "1.0",
      timestampSec: this.time[k] ?? k * this.timeStepSec,
      nominalFrequencyHz: this.omega / (2 * Math.PI),
      busVoltages,
      branchHistories,
      bergeronBuffers: Object.keys(bergeronBuffers).length > 0 ? bergeronBuffers : undefined,
      syncGenerators: Object.keys(syncGenerators).length > 0 ? syncGenerators : undefined,
      switchStates: Object.keys(switchStates).length > 0 ? switchStates : undefined,
    };
  }

  /**
   * Executes the full time-domain simulation loop.
   */
  public solve(): EmtSolverResult {
    // Pre-flight validation of OEM black-box DLL licenses and hardware security dongles
    this.licenseGuard.verifyOrThrow(
      this.customBlockStates.map((cbs) => ({
        block: cbs.block,
        runner: cbs.runner,
      })),
    );

    if (this.useWasm && this.syncGenerators.length === 0) {
      const wasmRes = this.solveWithWasm();
      if (wasmRes) return wasmRes;
    }

    const startTime = performance.now();
    const n = this.nBuses;

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
          interpolatedZeroCrossings: 0,
          executionTimeMs: 0,
        },
      };
    }

    let cdaCounter = 0;
    const vaPrevStep = new Float64Array(n);
    const vbPrevStep = new Float64Array(n);
    const vcPrevStep = new Float64Array(n);

    // Initialize closed-loop protection relay runtime states and control signal buffers
    const relayRuntimeStates = (this.netlist.protectionRelays ?? []).map((relay) => {
      const tripTraj = new Float64Array(this.nSteps);
      const zAppTraj = new Float64Array(this.nSteps);
      this.controlSignals.set(`${relay.id}_trip`, tripTraj);
      this.controlSignals.set(`${relay.id}_zAppOhm`, zAppTraj);
      return {
        relay,
        timerSec: 0.0,
        tripped: false,
        tripTraj,
        zAppTraj,
      };
    });

    // Initialize Detailed Equivalent Model (DEM) MMC arm submodule capacitor states
    const mmcBridges = (this.netlist.converterBridges ?? []).filter(
      (c) => c.kind === "mmc_thevenin" || c.kind === "mmc_valve_gpu",
    );
    const mmcRuntimeStates = mmcBridges.map((mmc) => {
      const nSm = Math.max(4, mmc.numSubmodulesPerArm || 16);
      const vDcKv = mmc.vDcNominalKv || 400.0;
      const vSmNomKv = vDcKv / nSm;
      const vCapUpper = new Float64Array(nSm);
      const vCapLower = new Float64Array(nSm);
      for (let i = 0; i < nSm; i++) {
        // Slight initial spread to exercise sorting & balancing
        vCapUpper[i] = vSmNomKv * (1.0 + 0.01 * ((i % 3) - 1));
        vCapLower[i] = vSmNomKv * (1.0 - 0.01 * ((i % 3) - 1));
      }
      const upperSumTraj = new Float64Array(this.nSteps);
      const lowerSumTraj = new Float64Array(this.nSteps);
      const spreadPctTraj = new Float64Array(this.nSteps);
      this.controlSignals.set(`${mmc.id}_vCapUpperSum`, upperSumTraj);
      this.controlSignals.set(`${mmc.id}_vCapLowerSum`, lowerSumTraj);
      this.controlSignals.set(`${mmc.id}_spreadPct`, spreadPctTraj);
      return {
        mmc,
        nSm,
        vDcKv,
        cSmFarad: Math.max(1e-4, mmc.submoduleCapacitanceF || 0.01),
        vCapUpper,
        vCapLower,
        upperSumTraj,
        lowerSumTraj,
        spreadPctTraj,
      };
    });

    for (let k = 0; k < this.nSteps; k++) {
      const t = this.time[k]!;
      if (k > 0) {
        vaPrevStep.set(this.vaStep);
        vbPrevStep.set(this.vbStep);
        vcPrevStep.set(this.vcStep);
      }

      // 1. Detect switch state toggles & compute sub-step zero-crossing interpolation factor alpha
      let topologyChanged = false;
      const switchedBusInterpolation = new Map<number, number>();
      for (const swState of this.switchStates) {
        const initClosed = Boolean(swState.sw.initialClosed);
        const poleTimes = swState.sw.poleActionTimesSec;
        if (poleTimes) {
          for (let p = 0; p < 3; p++) {
            const actionT = poleTimes[p]!;
            const isClosed = t >= actionT ? !initClosed : initClosed;
            if (isClosed !== swState.phaseClosed[p]) {
              swState.phaseClosed[p] = isClosed;
              topologyChanged = true;
              this.switchingEventCount++;
              if (this.enableCda) {
                cdaCounter = 2; // Trigger 2 steps of CDA damping
              }
              if (this.enableSwitchingInterpolation) {
                const tPrev = k > 0 ? this.time[k - 1]! : t - this.timeStepSec;
                const rawAlpha = (actionT - tPrev) / this.timeStepSec;
                const alpha = rawAlpha > 0.01 && rawAlpha < 0.99 ? rawAlpha : 0.5;
                this.interpolatedZeroCrossingsCount++;
                if (swState.fromIdx >= 0) switchedBusInterpolation.set(swState.fromIdx, alpha);
                if (swState.toIdx >= 0) switchedBusInterpolation.set(swState.toIdx, alpha);
              }
            }
          }
          swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
        } else {
          const actionT = swState.sw.actionTimeSec;
          const isClosed = t >= actionT ? !initClosed : initClosed;
          if (isClosed !== swState.currentClosed) {
            swState.currentClosed = isClosed;
            swState.phaseClosed[0] = isClosed;
            swState.phaseClosed[1] = isClosed;
            swState.phaseClosed[2] = isClosed;
            topologyChanged = true;
            this.switchingEventCount++;
            if (this.enableCda) {
              cdaCounter = 2; // Trigger 2 steps of CDA damping
            }
            if (this.enableSwitchingInterpolation) {
              const tPrev = k > 0 ? this.time[k - 1]! : t - this.timeStepSec;
              const rawAlpha = (actionT - tPrev) / this.timeStepSec;
              const alpha = rawAlpha > 0.01 && rawAlpha < 0.99 ? rawAlpha : 0.5;
              this.interpolatedZeroCrossingsCount++;
              if (swState.fromIdx >= 0) switchedBusInterpolation.set(swState.fromIdx, alpha);
              if (swState.toIdx >= 0) switchedBusInterpolation.set(swState.toIdx, alpha);
            }
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
        this.resetConductanceMatrix();

        // Sources
        for (const [bIdx, srcs] of this.busSources.entries()) {
          for (const s of srcs) {
            for (let p = 0; p < 3; p++) {
              this.stampDiagonal(3 * bIdx + p, s.gSrc);
            }
          }
        }

        // Synchronous Generators Norton subtransient conductance
        for (const sg of this.syncGenerators) {
          for (let p = 0; p < 3; p++) {
            this.stampDiagonal(3 * sg.busIdx + p, sg.gGen);
          }
        }

        // Boundary feeds Thévenin source conductances
        if (this.options?.boundaryFeeds) {
          for (const bf of this.options.boundaryFeeds) {
            const bIdx = this.busIdxMap.get(bf.busId);
            if (bIdx !== undefined && bf.thevenin) {
              const th = bf.thevenin(t);
              const gSrc = th?.gSrc ?? 10.0;
              for (let p = 0; p < 3; p++) {
                this.stampDiagonal(3 * bIdx + p, gSrc);
              }
            }
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

        // Bergeron / ULM distributed traveling-wave lines (coupled Norton shunt for modal lines)
        for (const bl of this.bergeronLines) {
          if (bl.hasModal) {
            for (let p = 0; p < 3; p++) {
              if (bl.fromIdx >= 0) {
                this.stampDiagonal(3 * bl.fromIdx + p, bl.gSelf);
                for (let q = 0; q < 3; q++) {
                  if (p !== q) this.stampEntry(3 * bl.fromIdx + p, 3 * bl.fromIdx + q, bl.gMutual);
                }
              }
              if (bl.toIdx >= 0) {
                this.stampDiagonal(3 * bl.toIdx + p, bl.gSelf);
                for (let q = 0; q < 3; q++) {
                  if (p !== q) this.stampEntry(3 * bl.toIdx + p, 3 * bl.toIdx + q, bl.gMutual);
                }
              }
            }
          } else {
            for (let p = 0; p < 3; p++) {
              if (bl.fromIdx >= 0) {
                this.stampDiagonal(3 * bl.fromIdx + p, bl.gBerg);
              }
              if (bl.toIdx >= 0) {
                this.stampDiagonal(3 * bl.toIdx + p, bl.gBerg);
              }
            }
          }
        }

        for (const ulm of this.ulmLines) {
          this.stampUlmModel(ulm);
        }

        // Switches (per-phase independent conductances for pole scatter)
        for (const swState of this.switchStates) {
          for (let p = 0; p < 3; p++) {
            const isClosed = swState.phaseClosed[p];
            const rSw = isClosed
              ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
              : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
            const gSw = 1.0 / rSw;
            const u = swState.fromIdx >= 0 ? 3 * swState.fromIdx + p : -1;
            const v = swState.toIdx >= 0 ? 3 * swState.toIdx + p : -1;
            if (u >= 0) this.stampDiagonal(u, gSw);
            if (v >= 0) this.stampDiagonal(v, gSw);
            if (u >= 0 && v >= 0) {
              this.stampEntry(u, v, -gSw);
              this.stampEntry(v, u, -gSw);
            }
          }
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
              this.stampDiagonal(pA, gFlt);
              this.stampDiagonal(pB, gFlt);
              this.stampDiagonal(pC, gFlt);
            } else if (flt.faultType === "SLG") {
              // Single line-to-ground fault on Phase A
              this.stampDiagonal(pA, gFlt);
            } else if (flt.faultType === "DLG") {
              // Double line-to-ground fault on Phases B and C
              this.stampDiagonal(pB, gFlt);
              this.stampDiagonal(pC, gFlt);
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
        this.updateSurgeArresterTheveninVectors();
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

      // Dynamic TS-EMT hybrid boundary feeds
      if (this.options?.boundaryFeeds) {
        for (const bf of this.options.boundaryFeeds) {
          const bIdx = this.busIdxMap.get(bf.busId);
          if (bIdx !== undefined) {
            if (bf.thevenin) {
              const th = bf.thevenin(t);
              if (th) {
                const ea = th.vPeak * Math.sin(th.freqRad * t + th.phaseRad);
                const eb = th.vPeak * Math.sin(th.freqRad * t + th.phaseRad - (2 * Math.PI) / 3);
                const ec = th.vPeak * Math.sin(th.freqRad * t + th.phaseRad + (2 * Math.PI) / 3);
                this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! + th.gSrc * ea;
                this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! + th.gSrc * eb;
                this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! + th.gSrc * ec;
              }
            }
            if (bf.currentInjection) {
              const cinj = bf.currentInjection(t);
              if (cinj) {
                this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! + cinj.ia;
                this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! + cinj.ib;
                this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! + cinj.ic;
              }
            }
          }
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

      // Bergeron / ULM traveling-wave delayed history current injections
      for (const bl of this.bergeronLines) {
        const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = this.computeLineHistoryCurrents(
          bl,
          false,
        );

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

      for (const ulm of this.ulmLines) {
        const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = stepUlmLine(
          ulm,
          0,
          0,
          0,
          0,
          0,
          0,
          false,
        );
        if (ulm.fromIdx >= 0) {
          this.J3[3 * ulm.fromIdx + 0] = this.J3[3 * ulm.fromIdx + 0]! - iHistKmA;
          this.J3[3 * ulm.fromIdx + 1] = this.J3[3 * ulm.fromIdx + 1]! - iHistKmB;
          this.J3[3 * ulm.fromIdx + 2] = this.J3[3 * ulm.fromIdx + 2]! - iHistKmC;
        }
        if (ulm.toIdx >= 0) {
          this.J3[3 * ulm.toIdx + 0] = this.J3[3 * ulm.toIdx + 0]! - iHistMkA;
          this.J3[3 * ulm.toIdx + 1] = this.J3[3 * ulm.toIdx + 1]! - iHistMkB;
          this.J3[3 * ulm.toIdx + 2] = this.J3[3 * ulm.toIdx + 2]! - iHistMkC;
        }
      }

      // FMU / IBR Converter current injections into J3 (coupled to grid nodal equations)
      const tauLvrtPre = 0.008;
      const alphaLvrtPre = 1.0 - Math.exp(-this.timeStepSec / tauLvrtPre);
      for (const fmuState of this.fmuStates) {
        const { busIdx, iRatedPeak } = fmuState;
        const vNomPeak = this.busList[busIdx]!.vPeak;
        let vPu = 1.0;
        if (k > 0) {
          const vaPrev = this.vaStep[busIdx]!;
          const vbPrev = this.vbStep[busIdx]!;
          const vcPrev = this.vcStep[busIdx]!;
          const vEnvPrev = Math.sqrt((2.0 / 3.0) * (vaPrev * vaPrev + vbPrev * vbPrev + vcPrev * vcPrev));
          vPu = vNomPeak > 0 ? vEnvPrev / vNomPeak : 1.0;
        }
        const isVoltageDip = anyFaultActive || vPu < 0.9;
        const iqEst = isVoltageDip ? fmuState.iqState + alphaLvrtPre * (0.85 * iRatedPeak - fmuState.iqState) : 0.0;
        const idEst = isVoltageDip ? 0.35 * iRatedPeak : 0.7 * iRatedPeak;

        const iaIbr = idEst * Math.sin(this.omega * t) - iqEst * Math.cos(this.omega * t);
        const ibIbr =
          idEst * Math.sin(this.omega * t - (2 * Math.PI) / 3) - iqEst * Math.cos(this.omega * t - (2 * Math.PI) / 3);
        const icIbr =
          idEst * Math.sin(this.omega * t + (2 * Math.PI) / 3) - iqEst * Math.cos(this.omega * t + (2 * Math.PI) / 3);

        this.J3[3 * busIdx + 0] = this.J3[3 * busIdx + 0]! + iaIbr;
        this.J3[3 * busIdx + 1] = this.J3[3 * busIdx + 1]! + ibIbr;
        this.J3[3 * busIdx + 2] = this.J3[3 * busIdx + 2]! + icIbr;
      }

      // EMTDC Fortran / C Binary DLL User-Defined Models (DSDYN pre-network solve)
      if (this.emtdcHostBridge && this.customBlockStates.length > 0) {
        for (const cbs of this.customBlockStates) {
          if (cbs.busIdx >= 0) {
            const va = k > 0 ? this.vaStep[cbs.busIdx]! : 0.0;
            const vb = k > 0 ? this.vbStep[cbs.busIdx]! : 0.0;
            const vc = k > 0 ? this.vcStep[cbs.busIdx]! : 0.0;
            cbs.udm.ports["VA"] = va;
            cbs.udm.ports["VB"] = vb;
            cbs.udm.ports["VC"] = vc;
            cbs.udm.ports["va"] = va;
            cbs.udm.ports["vb"] = vb;
            cbs.udm.ports["vc"] = vc;
            this.emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
          }
        }
        this.emtdcHostBridge.stepDsdyn(t, k === 0, k === this.nSteps - 1);
        for (const cbs of this.customBlockStates) {
          if (cbs.busIdx >= 0) {
            const iaInj = cbs.udm.ports["IA_INJ"] ?? cbs.udm.ports["IA"] ?? cbs.udm.ports["ia"] ?? 0.0;
            const ibInj = cbs.udm.ports["IB_INJ"] ?? cbs.udm.ports["IB"] ?? cbs.udm.ports["ib"] ?? 0.0;
            const icInj = cbs.udm.ports["IC_INJ"] ?? cbs.udm.ports["IC"] ?? cbs.udm.ports["ic"] ?? 0.0;
            const ccin = this.emtdcHostBridge.state.CCIN[cbs.busIdx + 1] ?? 0.0;
            this.J3[3 * cbs.busIdx + 0] = this.J3[3 * cbs.busIdx + 0]! + iaInj + ccin;
            this.J3[3 * cbs.busIdx + 1] = this.J3[3 * cbs.busIdx + 1]! + ibInj;
            this.J3[3 * cbs.busIdx + 2] = this.J3[3 * cbs.busIdx + 2]! + icInj;
          }
        }
      }

      // 5. Solve coupled 3N x 3N linear system via forward/backward substitution
      this.solveFromLU3Phase(this.LU3, this.piv3, this.J3, this.v3Step);

      // 5b. Non-linear Thévenin Norton Compensation for Surge Arresters (MOVs)
      if (this.surgeArresters.length > 0) {
        for (let iter = 0; iter < 3; iter++) {
          let maxCorr = 0.0;
          for (const arr of this.surgeArresters) {
            for (let p = 0; p < 3; p++) {
              const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
              const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
              const vOpen = (u >= 0 ? this.v3Step[u]! : 0.0) - (v >= 0 ? this.v3Step[v]! : 0.0);
              const vMag = Math.abs(vOpen);
              if (vMag > arr.vRefVolts) {
                const zTh = arr.zThPhase[p]!;
                const iCorr = Math.sign(vOpen) * ((vMag - arr.vRefVolts) / (zTh + arr.rClampOhm));
                if (Math.abs(iCorr) > 1e-4) {
                  maxCorr = Math.max(maxCorr, Math.abs(iCorr));
                  const xTh = arr.xThPhase[p]!;
                  for (let j = 0; j < this.nPhaseNodes; j++) {
                    this.v3Step[j] = this.v3Step[j]! - xTh[j]! * iCorr;
                  }
                  if (iter === 0) {
                    const vClamped = vOpen - zTh * iCorr;
                    arr.energyJoules += Math.abs(vClamped * iCorr) * this.timeStepSec;
                  }
                }
              }
            }
          }
          if (maxCorr < 1e-3) break;
        }
      }

      for (let i = 0; i < n; i++) {
        let va = this.v3Step[3 * i + 0]!;
        let vb = this.v3Step[3 * i + 1]!;
        let vc = this.v3Step[3 * i + 2]!;
        const swAlpha = k > 0 ? switchedBusInterpolation.get(i) : undefined;
        if (swAlpha !== undefined) {
          va = (1.0 - swAlpha) * vaPrevStep[i]! + swAlpha * va;
          vb = (1.0 - swAlpha) * vbPrevStep[i]! + swAlpha * vb;
          vc = (1.0 - swAlpha) * vcPrevStep[i]! + swAlpha * vc;
        }
        this.vaStep[i] = va;
        this.vbStep[i] = vb;
        this.vcStep[i] = vc;

        const busId = this.busList[i]!.id;
        const pv = this.busPhaseVoltages.get(busId)!;
        pv.a[k] = va;
        pv.b[k] = vb;
        pv.c[k] = vc;
      }

      if (this.options?.onStep) {
        const stepVolts = new Map<string, { a: number; b: number; c: number }>();
        for (let i = 0; i < n; i++) {
          const bId = this.busList[i]!.id;
          stepVolts.set(bId, { a: this.vaStep[i]!, b: this.vbStep[i]!, c: this.vcStep[i]! });
        }
        this.options.onStep(t, k, stepVolts);
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

        const interpAlpha = switchedBusInterpolation.get(br.fromIdx) ?? switchedBusInterpolation.get(br.toIdx);
        const iHistBeA =
          br.vCoeffHist < 0 ? -br.gEq * (dvA - br.rOhm * curA) : curA - (br.gEq * dvA + br.gMut * (dvB + dvC));
        const iHistBeB =
          br.vCoeffHist < 0 ? -br.gEq * (dvB - br.rOhm * curB) : curB - (br.gEq * dvB + br.gMut * (dvA + dvC));
        const iHistBeC =
          br.vCoeffHist < 0 ? -br.gEq * (dvC - br.rOhm * curC) : curC - (br.gEq * dvC + br.gMut * (dvA + dvB));

        const iHistTrapA =
          br.alphaHist * curA +
          br.alphaMutHist * (curB + curC) +
          br.vCoeffHist * (br.gEq * dvA + br.gMut * (dvB + dvC));
        const iHistTrapB =
          br.alphaHist * curB +
          br.alphaMutHist * (curA + curC) +
          br.vCoeffHist * (br.gEq * dvB + br.gMut * (dvA + dvC));
        const iHistTrapC =
          br.alphaHist * curC +
          br.alphaMutHist * (curA + curB) +
          br.vCoeffHist * (br.gEq * dvC + br.gMut * (dvA + dvB));

        if (interpAlpha !== undefined && this.enableSwitchingInterpolation) {
          br.iHistA = (1.0 - interpAlpha) * iHistBeA + interpAlpha * iHistTrapA;
          br.iHistB = (1.0 - interpAlpha) * iHistBeB + interpAlpha * iHistTrapB;
          br.iHistC = (1.0 - interpAlpha) * iHistBeC + interpAlpha * iHistTrapC;
        } else if (isCdaActive) {
          br.iHistA = iHistBeA;
          br.iHistB = iHistBeB;
          br.iHistC = iHistBeC;
        } else {
          br.iHistA = iHistTrapA;
          br.iHistB = iHistTrapB;
          br.iHistC = iHistTrapC;
        }
      }

      // 6b. Update Bergeron / ULM distributed line ring buffers and terminal currents
      for (const bl of this.bergeronLines) {
        const { ptr, bufLen, gBerg } = bl;
        const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = this.computeLineHistoryCurrents(
          bl,
          true,
        );

        const vkA = bl.fromIdx >= 0 ? this.vaStep[bl.fromIdx]! : 0.0;
        const vkB = bl.fromIdx >= 0 ? this.vbStep[bl.fromIdx]! : 0.0;
        const vkC = bl.fromIdx >= 0 ? this.vcStep[bl.fromIdx]! : 0.0;

        const vmA = bl.toIdx >= 0 ? this.vaStep[bl.toIdx]! : 0.0;
        const vmB = bl.toIdx >= 0 ? this.vbStep[bl.toIdx]! : 0.0;
        const vmC = bl.toIdx >= 0 ? this.vcStep[bl.toIdx]! : 0.0;

        let ikmA: number;
        let ikmB: number;
        let ikmC: number;
        let imkA: number;
        let imkB: number;
        let imkC: number;

        if (bl.hasModal) {
          const ONE_OVER_3 = 1.0 / 3.0;
          const ONE_OVER_SQRT3 = 1.0 / Math.sqrt(3.0);

          ikmA = bl.gSelf * vkA + bl.gMutual * (vkB + vkC) + iHistKmA;
          ikmB = bl.gSelf * vkB + bl.gMutual * (vkA + vkC) + iHistKmB;
          ikmC = bl.gSelf * vkC + bl.gMutual * (vkA + vkB) + iHistKmC;

          imkA = bl.gSelf * vmA + bl.gMutual * (vmB + vmC) + iHistMkA;
          imkB = bl.gSelf * vmB + bl.gMutual * (vmA + vmC) + iHistMkB;
          imkC = bl.gSelf * vmC + bl.gMutual * (vmA + vmB) + iHistMkC;

          bl.vkBufA[ptr] = ONE_OVER_3 * (vkA + vkB + vkC);
          bl.vkBufB[ptr] = ONE_OVER_3 * (2.0 * vkA - vkB - vkC);
          bl.vkBufC[ptr] = ONE_OVER_SQRT3 * (vkB - vkC);

          bl.vmBufA[ptr] = ONE_OVER_3 * (vmA + vmB + vmC);
          bl.vmBufB[ptr] = ONE_OVER_3 * (2.0 * vmA - vmB - vmC);
          bl.vmBufC[ptr] = ONE_OVER_SQRT3 * (vmB - vmC);

          bl.ikmBufA[ptr] = ONE_OVER_3 * (ikmA + ikmB + ikmC);
          bl.ikmBufB[ptr] = ONE_OVER_3 * (2.0 * ikmA - ikmB - ikmC);
          bl.ikmBufC[ptr] = ONE_OVER_SQRT3 * (ikmB - ikmC);

          bl.imkBufA[ptr] = ONE_OVER_3 * (imkA + imkB + imkC);
          bl.imkBufB[ptr] = ONE_OVER_3 * (2.0 * imkA - imkB - imkC);
          bl.imkBufC[ptr] = ONE_OVER_SQRT3 * (imkB - imkC);
        } else {
          ikmA = gBerg * vkA + iHistKmA;
          ikmB = gBerg * vkB + iHistKmB;
          ikmC = gBerg * vkC + iHistKmC;

          imkA = gBerg * vmA + iHistMkA;
          imkB = gBerg * vmB + iHistMkB;
          imkC = gBerg * vmC + iHistMkC;

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
        }

        bl.ia[k] = ikmA;
        bl.ib[k] = ikmB;
        bl.ic[k] = ikmC;
        bl.ptr = (ptr + 1) % bufLen;
      }

      // 6b2. Update Universal Line Model (ULM) distributed line ring buffers and terminal currents
      for (const ulm of this.ulmLines) {
        const vkA = ulm.fromIdx >= 0 ? this.vaStep[ulm.fromIdx]! : 0.0;
        const vkB = ulm.fromIdx >= 0 ? this.vbStep[ulm.fromIdx]! : 0.0;
        const vkC = ulm.fromIdx >= 0 ? this.vcStep[ulm.fromIdx]! : 0.0;
        const vmA = ulm.toIdx >= 0 ? this.vaStep[ulm.toIdx]! : 0.0;
        const vmB = ulm.toIdx >= 0 ? this.vbStep[ulm.toIdx]! : 0.0;
        const vmC = ulm.toIdx >= 0 ? this.vcStep[ulm.toIdx]! : 0.0;

        const curA = ulm.gEq[0]! * vkA + ulm.gEq[1]! * vkB + ulm.gEq[2]! * vkC + ulm.iHistK[0]!;
        const curB = ulm.gEq[3]! * vkA + ulm.gEq[4]! * vkB + ulm.gEq[5]! * vkC + ulm.iHistK[1]!;
        const curC = ulm.gEq[6]! * vkA + ulm.gEq[7]! * vkB + ulm.gEq[8]! * vkC + ulm.iHistK[2]!;

        const curBufs = this.branchPhaseCurrents.get(ulm.id);
        if (curBufs) {
          curBufs.a[k] = curA;
          curBufs.b[k] = curB;
          curBufs.c[k] = curC;
        }

        stepUlmLine(ulm, vkA, vkB, vkC, vmA, vmB, vmC, true);
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
        const currentArrays = [ia, ib, ic];
        for (let p = 0; p < 3; p++) {
          const isClosed = swState.phaseClosed[p];
          const rSw = isClosed
            ? Math.max(swState.sw.rClosedOhm || 1e-3, 1e-4)
            : Math.max(swState.sw.rOpenOhm || 1e6, 1e3);
          const gSw = 1.0 / rSw;
          const vFrom =
            fromIdx >= 0
              ? p === 0
                ? this.vaStep[fromIdx]!
                : p === 1
                  ? this.vbStep[fromIdx]!
                  : this.vcStep[fromIdx]!
              : 0;
          const vTo =
            toIdx >= 0 ? (p === 0 ? this.vaStep[toIdx]! : p === 1 ? this.vbStep[toIdx]! : this.vcStep[toIdx]!) : 0;
          currentArrays[p]![k] = gSw * (vFrom - vTo);
        }
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

      // 9. Closed-loop protection relay evaluation & circuit breaker trip actuation
      for (const rs of relayRuntimeStates) {
        const { relay } = rs;
        const bIdx = this.busIdxMap.get(relay.monitoredBus) ?? 0;
        const va = this.vaStep[bIdx] ?? 0.0;
        const vb = this.vbStep[bIdx] ?? 0.0;
        const vc = this.vcStep[bIdx] ?? 0.0;
        const vPeakMag = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
        const vNomPeak = this.busList[bIdx]?.vPeak || 230e3;

        const brCur =
          (relay.monitoredBranch ? this.branchPhaseCurrents.get(relay.monitoredBranch) : undefined) ??
          (relay.tripBreakerId ? this.branchPhaseCurrents.get(relay.tripBreakerId) : undefined) ??
          this.branchPhaseCurrents.values().next().value;
        const iaBr = brCur ? brCur.a[k]! : 0.0;
        const ibBr = brCur ? brCur.b[k]! : 0.0;
        const icBr = brCur ? brCur.c[k]! : 0.0;
        const iPeakMag = Math.sqrt((2.0 / 3.0) * (iaBr * iaBr + ibBr * ibBr + icBr * icBr));

        const zAppOhm = vPeakMag / Math.max(iPeakMag, 1e-3);
        rs.zAppTraj[k] = zAppOhm;

        if (!rs.tripped) {
          let pickup = false;
          let tripDelaySec = 0.0;
          if (relay.ansiCode === "21") {
            const z1 = relay.zone1ReachOhm ?? 15.0;
            const z2 = relay.zone2ReachOhm ?? 1.2 * z1;
            if (iPeakMag > 5.0 && zAppOhm <= z1) {
              pickup = true;
              tripDelaySec = 0.0;
            } else if (iPeakMag > 5.0 && zAppOhm <= z2) {
              pickup = true;
              tripDelaySec = 0.25;
            }
          } else if (relay.ansiCode === "50") {
            pickup = iPeakMag >= (relay.pickupCurrentA ?? 500.0);
            tripDelaySec = 0.0;
          } else if (relay.ansiCode === "51" || relay.ansiCode === "67") {
            const iPick = relay.pickupCurrentA ?? 200.0;
            if (iPeakMag >= iPick) {
              pickup = true;
              const mult = Math.max(1.05, iPeakMag / Math.max(1e-3, iPick));
              tripDelaySec = (0.14 * (relay.timeDialSetting ?? 0.5)) / (Math.pow(mult, 0.02) - 1.0);
            }
          } else if (relay.ansiCode === "87T" || relay.ansiCode === "87L") {
            pickup = iPeakMag >= (relay.pickupCurrentA ?? 100.0);
            tripDelaySec = 0.0;
          } else if (relay.ansiCode === "27") {
            pickup = vPeakMag < 0.8 * vNomPeak;
            tripDelaySec = 0.02;
          } else if (relay.ansiCode === "59") {
            pickup = vPeakMag > 1.2 * vNomPeak;
            tripDelaySec = 0.02;
          } else if (relay.ansiCode === "81U" || relay.ansiCode === "81O" || relay.ansiCode === "81R") {
            const gen0 = this.syncGenerators[0];
            const fHz = gen0 ? gen0.omegaRadSec / (2 * Math.PI) : this.omega / (2 * Math.PI);
            pickup = Math.abs(fHz - 60.0) > 0.5;
            tripDelaySec = 0.02;
          }

          if (pickup) {
            rs.timerSec += this.timeStepSec;
            if (rs.timerSec >= tripDelaySec) {
              rs.tripped = true;
              // Command target circuit breaker to open at next step
              const targetId = relay.tripBreakerId || relay.monitoredBranch;
              const targetSw =
                this.switchStates.find((s) => s.sw.id === targetId) ??
                (relay.tripBreakerId ? undefined : this.switchStates[0]);
              if (targetSw && targetSw.currentClosed) {
                targetSw.sw.actionTimeSec = Math.min(targetSw.sw.actionTimeSec, t + this.timeStepSec);
              }
            }
          } else {
            rs.timerSec = Math.max(0.0, rs.timerSec - 0.5 * this.timeStepSec);
          }
        }
        rs.tripTraj[k] = rs.tripped ? 1.0 : 0.0;
      }

      // 10. Step Detailed Equivalent Model (DEM) MMC submodule capacitor sorting & NLM
      for (const ms of mmcRuntimeStates) {
        const { nSm, vDcKv, cSmFarad, vCapUpper, vCapLower } = ms;
        const mMod = 0.85 * Math.sin(this.omega * t);
        const nUpper = Math.max(0, Math.min(nSm, Math.round(0.5 * nSm * (1.0 - mMod))));
        const nLower = Math.max(0, Math.min(nSm, nSm - nUpper));
        const iArmAmp = 400.0 * Math.sin(this.omega * t - 0.15);

        // Sort submodule indices by capacitor voltage to maintain charge balance
        const upperIdx = Array.from({ length: nSm }, (_, i) => i).sort((a, b) =>
          iArmAmp >= 0 ? vCapUpper[a]! - vCapUpper[b]! : vCapUpper[b]! - vCapUpper[a]!,
        );
        const lowerIdx = Array.from({ length: nSm }, (_, i) => i).sort((a, b) =>
          iArmAmp >= 0 ? vCapLower[a]! - vCapLower[b]! : vCapLower[b]! - vCapLower[a]!,
        );

        const dvKv = ((iArmAmp * this.timeStepSec) / cSmFarad) * 1e-3;
        for (let m = 0; m < nUpper; m++) {
          const idx = upperIdx[m]!;
          vCapUpper[idx] = Math.max(0.1, vCapUpper[idx]! + dvKv);
        }
        for (let m = 0; m < nLower; m++) {
          const idx = lowerIdx[m]!;
          vCapLower[idx] = Math.max(0.1, vCapLower[idx]! - dvKv);
        }

        let sumUpper = 0.0;
        let sumLower = 0.0;
        let vMin = Infinity;
        let vMax = -Infinity;
        for (let i = 0; i < nSm; i++) {
          const vu = vCapUpper[i]!;
          const vl = vCapLower[i]!;
          sumUpper += vu;
          sumLower += vl;
          if (vu < vMin) vMin = vu;
          if (vu > vMax) vMax = vu;
        }
        ms.upperSumTraj[k] = sumUpper;
        ms.lowerSumTraj[k] = sumLower;
        ms.spreadPctTraj[k] = vDcKv > 0 ? ((vMax - vMin) / (vDcKv / nSm)) * 100.0 : 0.0;
      }

      // EMTDC Fortran / C Binary DLL User-Defined Models (DSOUT post-network solve)
      if (this.emtdcHostBridge && this.customBlockStates.length > 0) {
        for (const cbs of this.customBlockStates) {
          if (cbs.busIdx >= 0) {
            const va = this.vaStep[cbs.busIdx]!;
            const vb = this.vbStep[cbs.busIdx]!;
            const vc = this.vcStep[cbs.busIdx]!;
            cbs.udm.ports["VA"] = va;
            cbs.udm.ports["VB"] = vb;
            cbs.udm.ports["VC"] = vc;
            cbs.udm.ports["va"] = va;
            cbs.udm.ports["vb"] = vb;
            cbs.udm.ports["vc"] = vc;
            this.emtdcHostBridge.state.VDC[cbs.busIdx + 1] = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
          }
        }
        this.emtdcHostBridge.stepDsout();
        for (const cbs of this.customBlockStates) {
          const iaInj = cbs.udm.ports["IA_INJ"] ?? cbs.udm.ports["IA"] ?? cbs.udm.ports["ia"] ?? 0.0;
          const ibInj = cbs.udm.ports["IB_INJ"] ?? cbs.udm.ports["IB"] ?? cbs.udm.ports["ib"] ?? 0.0;
          const icInj = cbs.udm.ports["IC_INJ"] ?? cbs.udm.ports["IC"] ?? cbs.udm.ports["ic"] ?? 0.0;
          if (cbs.ia && cbs.ib && cbs.ic) {
            cbs.ia[k] = iaInj;
            cbs.ib[k] = ibInj;
            cbs.ic[k] = icInj;
          }
          for (const [port, traj] of cbs.signalTrajs) {
            traj[k] = cbs.udm.ports[port] ?? 0.0;
          }
        }
      }
    }

    for (const b of this.busList) {
      this.busVoltages.set(b.id, this.busPhaseVoltages.get(b.id)!.a);
    }

    const executionTimeMs = performance.now() - startTime;

    const surgeArresterEnergies = new Map<string, number>();
    for (const arr of this.surgeArresters) {
      surgeArresterEnergies.set(arr.id, Number((arr.energyJoules / 1e3).toFixed(2)));
    }

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
      surgeArresterEnergies: this.surgeArresters.length > 0 ? surgeArresterEnergies : undefined,
      metrics: {
        totalSteps: this.nSteps,
        luFactorizations: this.luFactorizationCount,
        switchingEvents: this.switchingEventCount,
        chatterDampedSteps: this.chatterDampedCount,
        interpolatedZeroCrossings: this.interpolatedZeroCrossingsCount,
        executionTimeMs,
      },
    };
  }

  public getEmtdcHostBridge(): EmtdcHostBridge | null {
    return this.emtdcHostBridge;
  }

  public getLicenseGuard(): OemLicensePreflightGuard {
    return this.licenseGuard;
  }

  public getUlmLines(): readonly UniversalLineModelData[] {
    return this.ulmLines;
  }
}

/**
 * Serializes a `PscadSnapshot` operating point to a PSCAD `.snp` snapshot file string.
 */
export function serializePscadSnapshot(snapshot: PscadSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Parses a PSCAD `.snp` snapshot file string into a `PscadSnapshot` structure.
 */
export function parsePscadSnapshot(content: string): PscadSnapshot {
  const parsed = JSON.parse(content) as PscadSnapshot;
  return {
    formatVersion: "1.0",
    timestampSec: Number(parsed.timestampSec ?? 0),
    nominalFrequencyHz: Number(parsed.nominalFrequencyHz ?? 60),
    busVoltages: parsed.busVoltages ?? {},
    branchHistories: parsed.branchHistories ?? {},
    bergeronBuffers: parsed.bergeronBuffers,
    syncGenerators: parsed.syncGenerators,
    switchStates: parsed.switchStates,
  };
}

/**
 * Convenience helper to execute a 3-phase Dommel EMT simulation on an `EmtNetlist`.
 */
export function runEmtSimulation(netlist: EmtNetlist, options: EmtSolverOptions): EmtSolverResult {
  const solver = new EmtSolver(netlist, options);
  return solver.solve();
}

/**
 * Collects all unique `ArrayBuffer` instances backing an `EmtSolverResult` so a
 * Web Worker can transfer 100k-step `Float64Array` trajectories across threads with zero copy.
 */
export function extractEmtTransferableBuffers(result: EmtSolverResult): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const addBuf = (arr?: Float64Array) => {
    if (arr && arr.buffer instanceof ArrayBuffer) {
      seen.add(arr.buffer);
    }
  };
  addBuf(result.time);
  const addMapBufs = (map?: Map<string, Float64Array>) => {
    if (!map) return;
    for (const arr of map.values()) {
      addBuf(arr);
    }
  };
  addMapBufs(result.vA);
  addMapBufs(result.vB);
  addMapBufs(result.vC);
  addMapBufs(result.iA);
  addMapBufs(result.iB);
  addMapBufs(result.iC);
  for (const pv of result.busPhaseVoltages.values()) {
    addBuf(pv.a);
    addBuf(pv.b);
    addBuf(pv.c);
  }
  for (const pc of result.branchPhaseCurrents.values()) {
    addBuf(pc.a);
    addBuf(pc.b);
    addBuf(pc.c);
  }
  if (result.controlSignals) {
    for (const sig of result.controlSignals.values()) {
      addBuf(sig);
    }
  }
  return Array.from(seen);
}

/**
 * Executes a non-blocking 3-phase Dommel EMT simulation (yielding to the event loop
 * or Web Worker message pump) and returns both the `EmtSolverResult` and zero-copy
 * transferable `ArrayBuffer[]` list.
 */
export async function runEmtSimulationAsync(
  netlist: EmtNetlist,
  options: EmtSolverOptions,
): Promise<{ result: EmtSolverResult; transferables: ArrayBuffer[] }> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const result = runEmtSimulation(netlist, options);
  const transferables = extractEmtTransferableBuffers(result);
  return { result, transferables };
}

/**
 * End-to-end headless async EMT pipeline: parses `.pscx` XML directly into an
 * `EmtNetlist` (skipping graphics/FlyBy/lineStarts) and executes the EMT simulation.
 */
export async function runEmtSimulationFromXmlAsync(
  xmlSource: string,
  options: EmtSolverOptions,
): Promise<{ netlist: EmtNetlist; result: EmtSolverResult; transferables: ArrayBuffer[] }> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  const netlist = extractEmtNetlistFromXml(xmlSource);
  const result = runEmtSimulation(netlist, options);
  const transferables = extractEmtTransferableBuffers(result);
  return { netlist, result, transferables };
}
