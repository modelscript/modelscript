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

import type { FmiLsEmtCompanionInstance } from "@modelscript/exchange";
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
import { CsmfControlEvaluator } from "./csmf-evaluator.js";
import { OemLicenseError, OemLicensePreflightGuard, type OemLicensePreflightGuardOptions } from "./license-guard.js";
import {
  createUniversalLineModel,
  stepNConductorUlm,
  stepUlmLine,
  type NConductorUlmData,
  type UniversalLineModelData,
} from "./universal-line-model.js";
import { synthesizeFdLineModel } from "./vector-fitting.js";

export {
  OemLicenseError,
  OemLicensePreflightGuard,
  type NConductorUlmData,
  type OemLicensePreflightGuardOptions,
  type UniversalLineModelData,
};

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
  /** Whether to execute via native WebAssembly companion solver kernel when eligible. Default: false. */
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
  /** Optional `fmi-ls-emt` Norton-companion FMU/WASM callbacks keyed by FMU instance ID. */
  fmuCompanions?: Map<string, FmiLsEmtCompanionInstance> | undefined;
}

export interface EmtSolverMetrics {
  totalSteps: number;
  luFactorizations: number;
  luCacheHits?: number | undefined;
  switchingEvents: number;
  chatterDampedSteps: number;
  interpolatedZeroCrossings?: number | undefined;
  coupledNonlinearIterations?: number | undefined;
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
  tapRatio?: number | undefined;
  alphaBe: number;
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
  alphaGen: number;
  iHistA: number;
  iHistB: number;
  iHistC: number;
  xdSubPu: number;
  xqSubPu: number;
  xdPu: number;
  xqPu: number;
  xdPrimePu: number;
  xqPrimePu: number;
  hSec: number;
  dampingPu: number;
  pmPu: number;
  efPu: number;
  eqPrimePu: number;
  edPrimePu: number;
  eqSubPu: number;
  edSubPu: number;
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
  efSignal?: string | undefined;
  tmSignal?: string | undefined;
  torsionalMasses?:
    | Array<{
        id: string;
        hInertiaSec: number;
        dampingPu: number;
        kShaftPuPerRad: number;
        dampingMutualPu: number;
        torqueFraction: number;
        deltaRad: number;
        omegaRadSec: number;
        torqueTraj: Float64Array;
        speedTraj: Float64Array;
      }>
    | undefined;
}

interface OltcState {
  id: string;
  branchIdx: number;
  baseTapRatio: number;
  tapPu: number;
  tapMin: number;
  tapMax: number;
  tapStepPu: number;
  targetBusIdx: number;
  vRefVoltsPeak: number;
  deadbandPu: number;
  delaySec: number;
  timerSec: number;
  tapTraj: Float64Array;
}

interface ConverterBridgeRuntimeState {
  conv: NonNullable<EmtNetlist["converterBridges"]>[number];
  acBusIdx: number;
  dcBusIdx: number;
  gChoke: number;
  alphaChoke: number;
  iHistChokeA: number;
  iHistChokeB: number;
  iHistChokeC: number;
  vPeakNom: number;
  iRatedPeak: number;
  vDcRefVolts: number;
  vDcVolts: number;
  iDcAmp: number;
  cDcFarad: number;
  rDcLoadOhm: number;
  thetaPll: number;
  intErrD: number;
  intErrQ: number;
  intErrVdc: number;
  vPoleA: number;
  vPoleB: number;
  vPoleC: number;
  muRad: number;
  gammaRad: number;
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
  vDcTraj: Float64Array;
  iDcTraj?: Float64Array | undefined;
  muDegTraj?: Float64Array | undefined;
  gammaDegTraj?: Float64Array | undefined;
  pMwTraj?: Float64Array | undefined;
  qMvarTraj?: Float64Array | undefined;
  mIndexTraj?: Float64Array | undefined;
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
  /** When true, opening waits for per-phase current zero crossing to suppress current chop. */
  waitForCurrentZero?: boolean | undefined;
  /** When true, switch behaves as an ideal/PWL power-electronic diode (forward-bias on, zero-current off). */
  diode?: boolean | undefined;
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
  nUlmData?: NConductorUlmData | undefined;
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
  tapPu?: number | undefined;
  isAutotransformer?: boolean | undefined;
  tertiaryBus?: string | undefined;
  tertiaryKv?: number | undefined;
  tertiaryLeakagePu?: number | undefined;
  tertiaryConnection?: "Yg" | "Y" | "D" | undefined;
  leakagePsPu?: number | undefined;
  leakagePtPu?: number | undefined;
  leakageStPu?: number | undefined;
  oltc?:
    | {
        tapMin?: number | undefined;
        tapMax?: number | undefined;
        tapStepPu?: number | undefined;
        targetBus?: string | undefined;
        vRefPu?: number | undefined;
        deadbandPu?: number | undefined;
        delaySec?: number | undefined;
      }
    | undefined;
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

/**
 * Flexible EMT netlist input shape accepted by `EmtSolver`, `runFrequencyScan`, and `runPointOnWaveSweep`
 * alongside the canonical `EmtNetlist` (supports `EmtCircuitDefinition` and concise test literals).
 */
export interface EmtNetlistInput extends LegacyNetlistExtensions {
  name?: string | undefined;
  nominalFrequencyHz?: number | undefined;
  buses:
    | EmtNetlist["buses"]
    | Map<
        string,
        {
          id: string;
          name?: string | undefined;
          baseKv?: number | undefined;
          nominalKv?: number | undefined;
          phaseCount?: number | undefined;
          connectedBranchIds?: string[] | undefined;
        }
      >
    | Array<{
        id: string;
        name?: string | undefined;
        baseKv?: number | undefined;
        nominalKv?: number | undefined;
        phaseCount?: number | undefined;
        connectedBranchIds?: string[] | undefined;
      }>
    | string[];
  sources?:
    | Array<
        LegacySourceLike & {
          id?: string | undefined;
          name?: string | undefined;
          type?: string | undefined;
          voltageKvLL?: number | undefined;
          mvaRating?: number | undefined;
        }
      >
    | undefined;
  branches?: LegacyBranchLike[] | undefined;
  transmissionLines?: LegacyLineLike[] | undefined;
  transformers?: LegacyTransformerLike[] | undefined;
  synchronousMachines?: EmtNetlist["synchronousMachines"] | undefined;
  inductionMachines?: EmtNetlist["inductionMachines"] | undefined;
  saturableTransformers?: EmtNetlist["saturableTransformers"] | undefined;
  fmuInstances?: EmtNetlist["fmuInstances"] | undefined;
  faults?: EmtNetlist["faults"] | undefined;
  relays?: EmtNetlist["protectionRelays"] | undefined;
  protectionRelays?: EmtNetlist["protectionRelays"] | undefined;
  surgeArresters?: EmtNetlist["surgeArresters"] | undefined;
  converterBridges?: EmtNetlist["converterBridges"] | undefined;
  controlBlocks?: EmtNetlist["controlBlocks"] | undefined;
  customFortranBlocks?: EmtNetlist["customFortranBlocks"] | undefined;
  voltageDependentLoads?: EmtNetlist["voltageDependentLoads"] | undefined;
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
  companion?: FmiLsEmtCompanionInstance | undefined;
  lastGEq?: Float64Array | undefined;
  lastIHist?: Float64Array | undefined;
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

interface CachedTopologyLu {
  dense?: { lu: Float64Array; piv: Int32Array } | undefined;
  sparse?: SparseLUFactors | undefined;
  zArresterPorts?: Float64Array | undefined;
  arresterThevenin?:
    | Array<{
        zThPhase: [number, number, number];
        xThPhase: [Float64Array, Float64Array, Float64Array];
      }>
    | undefined;
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
  private readonly nUlmLines: Array<{
    id: string;
    fromIdx: number;
    toIdx: number;
    model: NConductorUlmData;
    vK: Float64Array;
    vM: Float64Array;
  }> = [];
  private readonly syncGenerators: SyncGenState[] = [];
  private readonly oltcStates: OltcState[] = [];
  private readonly bridgeRuntimeStates: ConverterBridgeRuntimeState[] = [];
  private readonly switchStates: SwitchState[] = [];
  private readonly fmuStates: FmuState[] = [];
  private readonly surgeArresters: SurgeArresterState[] = [];
  private zArresterPorts: Float64Array = new Float64Array(0);
  private readonly busSources = new Map<number, SourceInfo[]>();
  private readonly defaultSrcR: number;
  private snapshotApplied: boolean = false;
  private mmcSourcesRegistered: boolean = false;

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
  private csmfEvaluator: CsmfControlEvaluator | null = null;
  private readonly csmfBreakerOverrides = new Map<string, boolean>();
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
  private readonly indMachineStates: Array<{
    id: string;
    busIdx: number;
    gStator: number;
    vPeak: number;
    eInternalPu: number;
    slip: number;
    thetaR: number;
    hSec: number;
    tmPu: number;
    sBaseVa: number;
    ia: Float64Array;
    ib: Float64Array;
    ic: Float64Array;
  }> = [];
  private readonly satXfmrStates: Array<{
    id: string;
    primIdx: number;
    secIdx: number;
    lambdaKnee: number;
    lSatH: number;
    fluxA: number;
    fluxB: number;
    fluxC: number;
    vPrevA: number;
    vPrevB: number;
    vPrevC: number;
    iMagA: number;
    iMagB: number;
    iMagC: number;
    coreModel?: "PIECEWISE_LINEAR" | "JILES_ATHERTON" | undefined;
    jaMs: number;
    jaA: number;
    jaK: number;
    jaC: number;
    jaAlpha: number;
    mA: number;
    mB: number;
    mC: number;
    hPrevA: number;
    hPrevB: number;
    hPrevC: number;
  }> = [];

  // Coupled 3N x 3N phase-domain nodal conductance matrix & RHS vector
  private G3!: Float64Array;
  private J3!: Float64Array;
  private LU3!: Float64Array;
  private piv3!: Int32Array;
  private v3Step!: Float64Array;
  private luValid: boolean = false;
  private readonly luCache = new Map<string, CachedTopologyLu>();
  private activeTopoKey: string = "";

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
  private luCacheHitsCount: number = 0;
  private switchingEventCount: number = 0;
  private chatterDampedCount: number = 0;
  private interpolatedZeroCrossingsCount: number = 0;
  private coupledNonlinearIterationsCount: number = 0;

  private readonly useWasm: boolean;
  private readonly options: EmtSolverOptions;

  constructor(
    netlist: EmtNetlist | EmtNetlistInput,
    options: EmtSolverOptions = { durationSec: 0.1, timeStepSec: 50e-6 },
  ) {
    this.netlist = netlist as EmtNetlist;
    this.options = options;
    this.timeStepSec = Math.max(1e-7, options.timeStepSec);
    this.durationSec = Math.max(this.timeStepSec * 2, options.durationSec);
    this.omega = 2 * Math.PI * (options.nominalFrequencyHz ?? netlist.nominalFrequencyHz ?? 60.0);
    this.enableCda = options.enableCda ?? true;
    this.enableSwitchingInterpolation = options.enableSwitchingInterpolation ?? true;
    this.useWasm = options.useWasm ?? true;

    const maxSteps = options.maxSteps ?? 500000;
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
        const busLike = bus as { baseKv?: number; nominalKv?: number } | undefined;
        const rawKv = busLike?.baseKv ?? busLike?.nominalKv ?? 0;
        const baseKv = rawKv > 0 ? rawKv : 230.0;
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
        const rawKv = typeof item === "object" && item !== null ? (item.baseKv ?? item.nominalKv) || 0 : 0;
        const baseKv = rawKv > 0 ? rawKv : 230.0;
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

    const ensureInternalBus = (busId: string, baseKv: number) => {
      if (!busId || busId === "0" || busId === "GND" || this.busIdxMap.has(busId)) return;
      const safeKv = baseKv > 0 ? baseKv : 230.0;
      this.busIdxMap.set(busId, this.busList.length);
      this.busList.push({ id: busId, baseKv: safeKv, vPeak: safeKv * 1e3 });
      const a = new Float64Array(this.nSteps);
      const b = new Float64Array(this.nSteps);
      const c = new Float64Array(this.nSteps);
      this.busPhaseVoltages.set(busId, { a, b, c });
      this.vA.set(busId, a);
      this.vB.set(busId, b);
      this.vC.set(busId, c);
    };

    for (const xf of (this.netlist.transformers ?? []) as LegacyTransformerLike[]) {
      if (xf.tertiaryBus) {
        ensureInternalBus(`_xf_star_${xf.id}`, xf.primaryKv || 230.0);
      }
    }
    for (const conv of this.netlist.converterBridges ?? []) {
      if (conv.dcBus) {
        ensureInternalBus(conv.dcBus, conv.vDcNominalKv || conv.vDcRefKv || conv.ratedKvLL * 1.6);
      }
    }

    const controlBlocks = this.netlist.controlBlocks ?? [];
    if (controlBlocks.length > 0) {
      this.csmfEvaluator = new CsmfControlEvaluator(controlBlocks);
      for (const blk of controlBlocks) {
        this.controlSignals.set(blk.id, new Float64Array(this.nSteps));
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
      tapRatio?: number,
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
      const shuntG = 0.0;

      if (isCapacitiveBranch) {
        const denomC = this.timeStepSec + 2.0 * R1 * cFarad;
        gEq = denomC > 1e-18 ? (2.0 * cFarad) / denomC : 1e4;
        alphaHist = denomC > 1e-18 ? (2.0 * R1 * cFarad - this.timeStepSec) / denomC : -1.0;
        vCoeffHist = -1.0;
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
        // Split Pi-section capacitance to ground at each terminal bus so capacitor history updates cleanly
        if (cFarad > 0.0) {
          const cHalf = fromIdx >= 0 && toIdx >= 0 ? 0.5 * cFarad : cFarad;
          if (fromIdx >= 0) addCompanion(`${id}__cFrom`, fromBus, "0", 0.0, 0.0, cHalf);
          if (toIdx >= 0) addCompanion(`${id}__cTo`, toBus, "0", 0.0, 0.0, cHalf);
        }
      }

      const alphaBe = L1 > 0.0 ? L1 / Math.max(1e-12, L1 + R1 * 0.5 * this.timeStepSec) : 0.0;
      const { ia, ib, ic } = this.registerBranchBuffers(id);

      this.companionBranches.push({
        id,
        fromIdx,
        toIdx,
        rOhm: R1,
        lHenry: L1,
        cFarad: isCapacitiveBranch ? cFarad : 0,
        gEq,
        gMut,
        alphaHist,
        alphaMutHist,
        vCoeffHist,
        shuntG,
        tapRatio,
        alphaBe,
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

      if (modelType === "ulm" && ln.nUlmData && fromIdx >= 0 && toIdx >= 0) {
        this.nUlmLines.push({
          id: ln.id,
          fromIdx,
          toIdx,
          model: ln.nUlmData,
          vK: new Float64Array(Math.max(3, ln.nUlmData.nCond)),
          vM: new Float64Array(Math.max(3, ln.nUlmData.nCond)),
        });
        this.registerBranchBuffers(ln.id);
        return;
      }

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
        type PoleTimesShape = { a?: number; b?: number; c?: number; [idx: number]: number | undefined };
        const brPole = br as unknown as {
          poleOpenTimesSec?: PoleTimesShape;
          poleCloseTimesSec?: PoleTimesShape;
          poleActionTimesSec?: PoleTimesShape;
        };
        const poleTimes = initialClosed
          ? brPole.poleOpenTimesSec
          : (brPole.poleCloseTimesSec ?? brPole.poleActionTimesSec);
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
            waitForCurrentZero: (br as { waitForCurrentZero?: boolean | undefined }).waitForCurrentZero,
            diode: (br as { diode?: boolean | undefined }).diode,
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
      const primKv = xf.primaryKv || 230.0;
      const secKv = xf.secondaryKv || primKv;
      const primBus = xf.primaryBus ?? xf.fromBus ?? "0";
      const secBus = xf.secondaryBus ?? xf.toBus ?? "0";
      const ratedMva = Math.max(xf.ratedMva || xf.mvaRating || xf.mva || 100.0, 1.0);
      const baseZ = primKv ** 2 / ratedMva;
      const autoScale = xf.isAutotransformer
        ? Math.max(0.15, 1.0 - Math.min(primKv, secKv) / Math.max(primKv, secKv))
        : 1.0;
      const xPuDefault = (xf.leakageXPu || xf.xLeakagePu || xf.leakageReactancePu || 0.1) * autoScale;
      const rPrimOhm = Math.max(1e-4, 0.005 * baseZ);
      const tapPu = xf.tapPu ?? 1.0;
      const baseTapRatio = primKv > 0 && secKv > 0 ? secKv / primKv : 1.0;

      if (xf.tertiaryBus) {
        const starBus = `_xf_star_${xf.id}`;
        const tertKv = xf.tertiaryKv || secKv;
        const xPsPu = xf.leakagePsPu ?? xPuDefault;
        const xPtPu = xf.leakagePtPu ?? Math.max(xPuDefault, 0.12);
        const xStPu =
          xf.leakageStPu ??
          (xf.tertiaryLeakagePu !== undefined ? xPsPu + xf.tertiaryLeakagePu : Math.max(xPuDefault, 0.12));
        const xPPu = Math.max(0.002, 0.5 * (xPsPu + xPtPu - xStPu));
        const xSPu = Math.max(0.002, 0.5 * (xPsPu + xStPu - xPtPu));
        const xTPu =
          xf.tertiaryLeakagePu !== undefined
            ? Math.max(0.002, xf.tertiaryLeakagePu)
            : Math.max(0.002, 0.5 * (xPtPu + xStPu - xPsPu));

        const secBranchIdx = this.companionBranches.length + 1;
        addCompanion(
          `${xf.id}_P`,
          primBus,
          starBus,
          rPrimOhm,
          (xPPu * baseZ) / this.omega,
          0,
          undefined,
          undefined,
          "Yg-Yg",
          1.0,
        );
        addCompanion(
          `${xf.id}_S`,
          starBus,
          secBus,
          rPrimOhm * baseTapRatio ** 2,
          (xSPu * baseZ) / this.omega,
          0,
          undefined,
          undefined,
          xf.windingConnection,
          baseTapRatio * tapPu,
        );
        const tertTapRatio = primKv > 0 && tertKv > 0 ? tertKv / primKv : 1.0;
        const tertConn = xf.tertiaryConnection === "D" ? "Yg-D" : "Yg-Yg";
        addCompanion(
          `${xf.id}_T`,
          starBus,
          xf.tertiaryBus,
          rPrimOhm * tertTapRatio ** 2,
          (xTPu * baseZ) / this.omega,
          0,
          undefined,
          undefined,
          tertConn,
          tertTapRatio,
        );
        // Mirror secondary winding buffer under main transformer ID for direct current lookup
        const secBuf = this.branchPhaseCurrents.get(`${xf.id}_S`);
        if (secBuf) {
          this.branchCurrents.set(xf.id, secBuf.a);
          this.branchPhaseCurrents.set(xf.id, secBuf);
          this.iA.set(xf.id, secBuf.a);
          this.iB.set(xf.id, secBuf.b);
          this.iC.set(xf.id, secBuf.c);
        }
        if (xf.oltc) {
          const targetId = xf.oltc.targetBus ?? secBus;
          const targetBusIdx = this.busIdxMap.get(targetId) ?? -1;
          const tapTraj = new Float64Array(this.nSteps);
          this.controlSignals.set(`${xf.id}_tapPu`, tapTraj);
          const vRefKv = this.busList[targetBusIdx]?.baseKv ?? secKv;
          this.oltcStates.push({
            id: xf.id,
            branchIdx: secBranchIdx,
            baseTapRatio,
            tapPu,
            tapMin: xf.oltc.tapMin ?? 0.9,
            tapMax: xf.oltc.tapMax ?? 1.1,
            tapStepPu: xf.oltc.tapStepPu ?? 0.00625,
            targetBusIdx,
            vRefVoltsPeak: ((xf.oltc.vRefPu ?? 1.0) * vRefKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0),
            deadbandPu: xf.oltc.deadbandPu ?? 0.015,
            delaySec: xf.oltc.delaySec ?? 0.01,
            timerSec: 0,
            tapTraj,
          });
        }
      } else {
        const xOhm = Math.max(xPuDefault * baseZ, 0.02);
        const lHenry = xOhm / this.omega;
        const branchIdx = this.companionBranches.length;
        addCompanion(
          xf.id,
          primBus,
          secBus,
          0.01 * baseZ,
          lHenry,
          0,
          undefined,
          undefined,
          xf.windingConnection,
          baseTapRatio * tapPu,
        );
        if (xf.oltc) {
          const targetId = xf.oltc.targetBus ?? secBus;
          const targetBusIdx = this.busIdxMap.get(targetId) ?? -1;
          const tapTraj = new Float64Array(this.nSteps);
          this.controlSignals.set(`${xf.id}_tapPu`, tapTraj);
          const vRefKv = this.busList[targetBusIdx]?.baseKv ?? secKv;
          this.oltcStates.push({
            id: xf.id,
            branchIdx,
            baseTapRatio,
            tapPu,
            tapMin: xf.oltc.tapMin ?? 0.9,
            tapMax: xf.oltc.tapMax ?? 1.1,
            tapStepPu: xf.oltc.tapStepPu ?? 0.00625,
            targetBusIdx,
            vRefVoltsPeak: ((xf.oltc.vRefPu ?? 1.0) * vRefKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0),
            deadbandPu: xf.oltc.deadbandPu ?? 0.015,
            delaySec: xf.oltc.delaySec ?? 0.01,
            timerSec: 0,
            tapTraj,
          });
        }
      }
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
      const vPeak = (ratedKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
      const zBase = (ratedKv * ratedKv) / ratedMva;
      const xdSubPu = Math.max(0.05, sm.xdSub ?? sm.xdPrime ?? sm.xd ?? 0.2);
      const xqSubPu = Math.max(0.05, sm.xqSub ?? sm.xqPrime ?? sm.xq ?? xdSubPu);
      const xSubOhm = Math.max(0.01, xdSubPu * zBase);
      const freqHz = sm.frequencyHz || this.netlist.nominalFrequencyHz || 60.0;
      const omega0 = 2 * Math.PI * freqHz;
      const lSubH = xSubOhm / omega0;
      const rGenOhm = Math.max(1e-4, 0.003 * zBase);
      const twoLOverDt = (2.0 * lSubH) / this.timeStepSec;
      const gGen = 1.0 / (rGenOhm + twoLOverDt);
      const alphaGen = (twoLOverDt - rGenOhm) / (twoLOverDt + rGenOhm);
      const iBasePeak = vPeak / Math.max(1e-4, zBase);
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

      const torsionalMasses =
        sm.torsionalMasses && sm.torsionalMasses.length >= 2
          ? sm.torsionalMasses.map((tm, mIdx) => {
              const torqueTraj = new Float64Array(this.nSteps);
              const speedTraj = new Float64Array(this.nSteps);
              this.controlSignals.set(`${sm.id}_torque_${mIdx}`, torqueTraj);
              this.controlSignals.set(`${sm.id}_speed_${mIdx}`, speedTraj);
              return {
                id: tm.id,
                hInertiaSec: Math.max(0.02, tm.hInertiaSec),
                dampingPu: tm.dampingPu ?? 0.25,
                kShaftPuPerRad: tm.kShaftPuPerRad ?? 20.0,
                dampingMutualPu: tm.dampingMutualPu ?? 0.0,
                torqueFraction:
                  tm.torqueFraction ??
                  (mIdx === sm.torsionalMasses!.length - 1 ? 0.0 : 1.0 / (sm.torsionalMasses!.length - 1)),
                deltaRad: delta0,
                omegaRadSec: omega0,
                torqueTraj,
                speedTraj,
              };
            })
          : undefined;

      this.syncGenerators.push({
        id: sm.id,
        busIdx,
        ratedMva,
        vPeak,
        iBasePeak,
        omega0,
        gGen,
        alphaGen,
        iHistA: 0.0,
        iHistB: 0.0,
        iHistC: 0.0,
        xdSubPu,
        xqSubPu,
        xdPu: sm.xd ?? Math.max(xdSubPu, 1.8),
        xqPu: sm.xq ?? Math.max(xqSubPu, 1.7),
        xdPrimePu: sm.xdPrime ?? Math.max(xdSubPu, 0.3),
        xqPrimePu: sm.xqPrime ?? Math.max(xqSubPu, 0.55),
        hSec,
        dampingPu,
        pmPu,
        efPu,
        eqPrimePu: efPu,
        edPrimePu: 0.0,
        eqSubPu: efPu,
        edSubPu: 0.0,
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
        efSignal: sm.efSignal,
        tmSignal: sm.tmSignal,
        torsionalMasses,
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
      const companion = this.options.fmuCompanions?.get(fmu.id);
      this.fmuStates.push({
        fmu,
        busIdx,
        iRatedPeak,
        iqState: 0.0,
        ia,
        ib,
        ic,
        companion,
        lastGEq: companion ? new Float64Array(9) : undefined,
        lastIHist: companion ? new Float64Array(3) : undefined,
      });
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
      const llKv = src.voltageKv ?? src.kv;
      const vPeak =
        src.vPeakKv !== undefined && src.vPeakKv > 0
          ? src.vPeakKv * 1e3
          : ((llKv !== undefined && llKv > 0 ? llKv : this.busList[bIdx]?.baseKv || 230.0) * 1e3 * Math.SQRT2) /
            Math.sqrt(3.0);
      const freqRad = 2 * Math.PI * (src.frequencyHz || src.freqHz || this.netlist.nominalFrequencyHz || 60.0);
      const phaseRad =
        src.phaseRad !== undefined ? src.phaseRad : (((src.phaseDeg ?? src.phaseAngleDeg) || 0) * Math.PI) / 180.0;
      const list = this.busSources.get(bIdx) ?? [];
      list.push({ vPeak, freqRad, phaseRad, gSrc });
      this.busSources.set(bIdx, list);
    }

    // Register Induction / DFIG Machines as slip-dependent Norton equivalents
    for (const im of this.netlist.inductionMachines ?? []) {
      const busIdx = this.busIdxMap.get(im.bus);
      if (busIdx === undefined) continue;
      const vBaseKv = this.busList[busIdx]?.baseKv || im.ratedKvLL || 230.0;
      const mvaBase = im.ratedMva > 0 ? im.ratedMva : 10.0;
      const sBaseVa = mvaBase * 1e6;
      const vPeak = (vBaseKv * 1e3 * Math.SQRT2) / Math.sqrt(3);
      const zBase = (vBaseKv * 1e3) ** 2 / sBaseVa;
      const rStator = (im.rsPu !== undefined && im.rsPu > 0 ? im.rsPu : 0.01) * zBase;
      const xTrans = Math.max(0.05, (im.xsPu ?? 0.1) + (im.xrPu ?? 0.1)) * zBase;
      const gStator = 1.0 / Math.max(Math.hypot(rStator, xTrans), 1e-4);
      const { ia, ib, ic } = this.registerBranchBuffers(im.id);
      this.indMachineStates.push({
        id: im.id,
        busIdx,
        gStator,
        vPeak,
        eInternalPu: 0.95,
        slip: im.initialSlip ?? 0.02,
        thetaR: 0.0,
        hSec: im.hInertiaSec !== undefined && im.hInertiaSec > 0 ? im.hInertiaSec : 1.5,
        tmPu: im.mechanicalTorquePu ?? 0.8,
        sBaseVa,
        ia,
        ib,
        ic,
      });
      const list = this.busSources.get(busIdx) ?? [];
      list.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gStator });
      this.busSources.set(busIdx, list);
    }

    // Register Saturable Transformers for nonlinear magnetizing branch compensation
    for (const xf of this.netlist.saturableTransformers ?? []) {
      const primIdx = this.busIdxMap.get(xf.fromBus);
      const secIdx = this.busIdxMap.get(xf.toBus);
      if (primIdx === undefined) continue;
      const vBaseKv = xf.primaryKv > 0 ? xf.primaryKv : this.busList[primIdx]?.baseKv || 230.0;
      const vPeak = (vBaseKv * 1e3 * Math.SQRT2) / Math.sqrt(3);
      const lambdaKnee =
        xf.kneeFluxWb !== undefined && xf.kneeFluxWb > 0 ? xf.kneeFluxWb : 1.15 * (vPeak / Math.max(1e-3, this.omega));
      const mvaBase = xf.mvaRating > 0 ? xf.mvaRating : 100.0;
      const zBase = (vBaseKv * 1e3) ** 2 / (mvaBase * 1e6);
      const lSatH =
        xf.lSatH !== undefined && xf.lSatH > 0 ? xf.lSatH : Math.max(1e-5, (0.2 * zBase) / Math.max(1e-3, this.omega));
      const fluxRem = xf.remanentFluxWb ?? 0;
      this.satXfmrStates.push({
        id: xf.id,
        primIdx,
        secIdx: secIdx ?? -1,
        lambdaKnee,
        lSatH,
        fluxA: fluxRem,
        fluxB: -0.5 * fluxRem,
        fluxC: -0.5 * fluxRem,
        vPrevA: 0,
        vPrevB: 0,
        vPrevC: 0,
        iMagA: 0,
        iMagB: 0,
        iMagC: 0,
        coreModel: xf.coreModel,
        jaMs: xf.jaParams?.ms ?? 1.6e6,
        jaA: xf.jaParams?.a ?? 1100,
        jaK: xf.jaParams?.k ?? 400,
        jaC: xf.jaParams?.c ?? 0.2,
        jaAlpha: xf.jaParams?.alpha ?? 1.6e-3,
        mA: 0,
        mB: 0,
        mC: 0,
        hPrevA: 0,
        hPrevB: 0,
        hPrevC: 0,
      });
    }

    // Register switched 2-level VSC PWM & 6-pulse LCC thyristor converter bridges
    for (const conv of this.netlist.converterBridges ?? []) {
      if (conv.kind !== "vsc_pwm" && conv.kind !== "lcc_6pulse") continue;
      const acBusIdx = this.busIdxMap.get(conv.acBus) ?? -1;
      if (acBusIdx < 0) continue;
      const dcBusIdx = conv.dcBus ? (this.busIdxMap.get(conv.dcBus) ?? -1) : -1;
      const ratedKv = Math.max(1.0, conv.ratedKvLL || this.busList[acBusIdx]?.baseKv || 230.0);
      const ratedMva = Math.max(1.0, conv.ratedMva || 100.0);
      const zBase = (ratedKv * ratedKv) / ratedMva;
      const vPeakNom = (ratedKv * 1e3 * Math.SQRT2) / Math.sqrt(3.0);
      const iRatedPeak = (ratedMva * 1e6 * Math.SQRT2) / (Math.sqrt(3.0) * ratedKv * 1e3);
      const xFilterOhm = Math.max(0.05, 0.12 * zBase);
      const rFilterOhm = Math.max(0.01, 0.01 * zBase);
      const lFilterH = xFilterOhm / this.omega;
      const twoLfOverDt = (2.0 * lFilterH) / this.timeStepSec;
      const gChoke = 1.0 / (rFilterOhm + twoLfOverDt);
      const alphaChoke = (twoLfOverDt - rFilterOhm) / (twoLfOverDt + rFilterOhm);
      const vDcRefVolts = (conv.vDcRefKv ?? conv.vDcNominalKv ?? Math.max(1.5, 1.8 * ratedKv)) * 1e3;
      const cDcFarad = Math.max(1e-4, conv.dcCapacitanceF ?? 2e-3);
      const pRatedW = ratedMva * 1e6;
      const rDcLoadOhm = Math.max(1.0, conv.dcLoadOhm ?? (vDcRefVolts * vDcRefVolts) / Math.max(1e3, 0.8 * pRatedW));

      if (conv.kind === "vsc_pwm") {
        const list = this.busSources.get(acBusIdx) ?? [];
        list.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gChoke });
        this.busSources.set(acBusIdx, list);
      }
      if (dcBusIdx >= 0) {
        const gDc = 1.0 / Math.max(0.05, 0.01 * rDcLoadOhm);
        const listDc = this.busSources.get(dcBusIdx) ?? [];
        listDc.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gDc });
        this.busSources.set(dcBusIdx, listDc);
      }

      const { ia, ib, ic } = this.registerBranchBuffers(conv.id);
      const vDcTraj = new Float64Array(this.nSteps);
      this.controlSignals.set(`${conv.id}_Vdc`, vDcTraj);

      const state: ConverterBridgeRuntimeState = {
        conv,
        acBusIdx,
        dcBusIdx,
        gChoke,
        alphaChoke,
        iHistChokeA: 0.0,
        iHistChokeB: 0.0,
        iHistChokeC: 0.0,
        vPeakNom,
        iRatedPeak,
        vDcRefVolts,
        vDcVolts: vDcRefVolts,
        iDcAmp: (0.8 * pRatedW) / Math.max(100.0, vDcRefVolts),
        cDcFarad,
        rDcLoadOhm,
        thetaPll: 0.0,
        intErrD: 0.0,
        intErrQ: 0.0,
        intErrVdc: 0.0,
        vPoleA: 0.0,
        vPoleB: 0.0,
        vPoleC: 0.0,
        muRad: 0.08,
        gammaRad: Math.PI - ((conv.firingAngleDeg ?? 15) * Math.PI) / 180 - 0.08,
        ia,
        ib,
        ic,
        vDcTraj,
      };

      if (conv.kind === "lcc_6pulse") {
        state.iDcTraj = new Float64Array(this.nSteps);
        state.muDegTraj = new Float64Array(this.nSteps);
        state.gammaDegTraj = new Float64Array(this.nSteps);
        this.controlSignals.set(`${conv.id}_Idc`, state.iDcTraj);
        this.controlSignals.set(`${conv.id}_muDeg`, state.muDegTraj);
        this.controlSignals.set(`${conv.id}_gammaDeg`, state.gammaDegTraj);
      } else {
        state.pMwTraj = new Float64Array(this.nSteps);
        state.qMvarTraj = new Float64Array(this.nSteps);
        state.mIndexTraj = new Float64Array(this.nSteps);
        this.controlSignals.set(`${conv.id}_P_mw`, state.pMwTraj);
        this.controlSignals.set(`${conv.id}_Q_mvar`, state.qMvarTraj);
        this.controlSignals.set(`${conv.id}_mIndex`, state.mIndexTraj);
      }

      this.bridgeRuntimeStates.push(state);
    }

    // Islanded bus stabilization
    for (let i = 0; i < this.nBuses; i++) {
      const hasSyncGen = this.syncGenerators.some((g) => g.busIdx === i);
      if (!this.busSources.has(i) && !hasSyncGen) {
        const hasBranch =
          this.companionBranches.some((b) => b.fromIdx === i || b.toIdx === i) ||
          this.bergeronLines.some((l) => l.fromIdx === i || l.toIdx === i) ||
          this.ulmLines.some((l) => l.fromIdx === i || l.toIdx === i) ||
          this.nUlmLines.some((l) => l.fromIdx === i || l.toIdx === i);
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
   * Computes a canonical topology bitmask key for per-phase switches and active faults.
   * Returns `""` if time-varying boundaryFeeds supply dynamic Thévenin conductances.
   */
  private computeTopologyKey(t: number): string {
    if (this.options?.boundaryFeeds?.some((bf) => Boolean(bf.thevenin))) {
      return "";
    }
    let swKey = "";
    for (let i = 0; i < this.switchStates.length; i++) {
      const p = this.switchStates[i]!.phaseClosed;
      swKey += (p[0] ? "1" : "0") + (p[1] ? "1" : "0") + (p[2] ? "1" : "0");
    }
    let fltKey = "";
    const faults = this.netlist.faults;
    if (faults && faults.length > 0) {
      for (let i = 0; i < faults.length; i++) {
        const flt = faults[i]!;
        fltKey += t >= flt.startSec && t <= flt.endSec ? "1" : "0";
      }
    }
    let oltcKey = "";
    if (this.oltcStates.length > 0) {
      for (let i = 0; i < this.oltcStates.length; i++) {
        oltcKey += `|${this.oltcStates[i]!.tapPu.toFixed(5)}`;
      }
    }
    return `sw:${swKey}|flt:${fltKey}${oltcKey ? `|oltc:${oltcKey}` : ""}`;
  }

  private cloneSparseFactors(f: SparseLUFactors): SparseLUFactors {
    return {
      n: f.n,
      lColPtr: f.lColPtr,
      lRowIndices: f.lRowIndices,
      lValues: f.lValues.slice(),
      uColPtr: f.uColPtr,
      uRowIndices: f.uRowIndices,
      uValues: f.uValues.slice(),
      uDiagInv: f.uDiagInv.slice(),
      perm: f.perm.slice(),
      permInv: f.permInv.slice(),
      colPerm: f.colPerm,
      scratchY: new Float64Array(f.n),
      scratchX: f.scratchX ? new Float64Array(f.n) : undefined,
      hasSymbolicPattern: f.hasSymbolicPattern,
    };
  }

  private saveTopologyToCache(key: string): void {
    if (!key) return;
    const MAX_ENTRIES = 16;
    if (this.luCache.has(key)) {
      this.luCache.delete(key);
    } else if (this.luCache.size >= MAX_ENTRIES) {
      const oldest = this.luCache.keys().next().value;
      if (oldest !== undefined) this.luCache.delete(oldest);
    }

    const arresterThevenin =
      this.surgeArresters.length > 0
        ? this.surgeArresters.map((arr) => ({
            zThPhase: [arr.zThPhase[0], arr.zThPhase[1], arr.zThPhase[2]] as [number, number, number],
            xThPhase: [arr.xThPhase[0].slice(), arr.xThPhase[1].slice(), arr.xThPhase[2].slice()] as [
              Float64Array,
              Float64Array,
              Float64Array,
            ],
          }))
        : undefined;

    this.luCache.set(key, {
      dense: !this.useSparse ? { lu: this.LU3.slice(), piv: this.piv3.slice() } : undefined,
      sparse: this.useSparse && this.sparseFactors ? this.cloneSparseFactors(this.sparseFactors) : undefined,
      zArresterPorts: this.zArresterPorts.length > 0 ? this.zArresterPorts.slice() : undefined,
      arresterThevenin,
    });
  }

  private restoreTopologyFromCache(entry: CachedTopologyLu): void {
    if (entry.dense) {
      this.LU3.set(entry.dense.lu);
      this.piv3.set(entry.dense.piv);
    } else if (entry.sparse) {
      this.sparseFactors = this.cloneSparseFactors(entry.sparse);
    }
    if (entry.zArresterPorts && this.zArresterPorts.length === entry.zArresterPorts.length) {
      this.zArresterPorts.set(entry.zArresterPorts);
    }
    if (entry.arresterThevenin) {
      for (let i = 0; i < this.surgeArresters.length && i < entry.arresterThevenin.length; i++) {
        const dst = this.surgeArresters[i]!;
        const src = entry.arresterThevenin[i]!;
        dst.zThPhase = [src.zThPhase[0], src.zThPhase[1], src.zThPhase[2]];
        dst.xThPhase[0].set(src.xThPhase[0]);
        dst.xThPhase[1].set(src.xThPhase[1]);
        dst.xThPhase[2].set(src.xThPhase[2]);
      }
    }
  }

  private solveWithCachedLu(entry: CachedTopologyLu, rhs: Float64Array, out: Float64Array): void {
    if (entry.sparse) {
      sparseLuSolve(entry.sparse, rhs, out);
      return;
    }
    if (!entry.dense) return;
    const LU = entry.dense.lu;
    const piv = entry.dense.piv;
    const n = this.nPhaseNodes;
    for (let i = 0; i < n; i++) out[i] = rhs[piv[i]!]!;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) out[i] = out[i]! - LU[i * n + j]! * out[j]!;
    }
    for (let i = n - 1; i >= 0; i--) {
      for (let j = i + 1; j < n; j++) out[i] = out[i]! - LU[i * n + j]! * out[j]!;
      const diag = LU[i * n + i]!;
      out[i] = Math.abs(diag) > 1e-18 ? out[i]! / diag : 0.0;
    }
  }

  /**
   * Solves small dense linear system `A * x = b` (`dim <= 3 * surgeArresters.length`) via partial pivoting.
   */
  private solveSmallDenseSystem(A: Float64Array, b: Float64Array, x: Float64Array, dim: number): boolean {
    for (let p = 0; p < dim; p++) {
      let maxVal = Math.abs(A[p * dim + p]!);
      let maxRow = p;
      for (let r = p + 1; r < dim; r++) {
        const v = Math.abs(A[r * dim + p]!);
        if (v > maxVal) {
          maxVal = v;
          maxRow = r;
        }
      }
      if (maxVal < 1e-15) return false;
      if (maxRow !== p) {
        for (let c = p; c < dim; c++) {
          const tmp = A[p * dim + c]!;
          A[p * dim + c] = A[maxRow * dim + c]!;
          A[maxRow * dim + c] = tmp;
        }
        const tmpB = b[p]!;
        b[p] = b[maxRow]!;
        b[maxRow] = tmpB;
      }
      const piv = A[p * dim + p]!;
      for (let r = p + 1; r < dim; r++) {
        const fac = A[r * dim + p]! / piv;
        if (fac === 0) continue;
        for (let c = p + 1; c < dim; c++) {
          A[r * dim + c] = A[r * dim + c]! - fac * A[p * dim + c]!;
        }
        b[r] = b[r]! - fac * b[p]!;
      }
    }
    for (let i = dim - 1; i >= 0; i--) {
      let sum = b[i]!;
      for (let c = i + 1; c < dim; c++) {
        sum -= A[i * dim + c]! * x[c]!;
      }
      x[i] = sum / A[i * dim + i]!;
    }
    return true;
  }

  /**
   * Precomputes Thévenin driving-point impedances zTh, response vectors xTh = G3^-1 * e_uv,
   * and coupled multi-port Z_ports matrix for all registered Metal Oxide Surge Arresters (MOVs).
   */
  private updateSurgeArresterTheveninVectors(): void {
    const nArr = this.surgeArresters.length;
    if (nArr === 0) return;
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

    const M = nArr * 3;
    if (this.zArresterPorts.length !== M * M) {
      this.zArresterPorts = new Float64Array(M * M);
    }
    for (let a = 0; a < nArr; a++) {
      const arrA = this.surgeArresters[a]!;
      for (let pA = 0; pA < 3; pA++) {
        const row = a * 3 + pA;
        const uA = arrA.fromIdx >= 0 ? 3 * arrA.fromIdx + pA : -1;
        const vA = arrA.toIdx >= 0 ? 3 * arrA.toIdx + pA : -1;
        for (let b = 0; b < nArr; b++) {
          const arrB = this.surgeArresters[b]!;
          for (let pB = 0; pB < 3; pB++) {
            const col = b * 3 + pB;
            const xB = arrB.xThPhase[pB]!;
            const zAb = (uA >= 0 ? xB[uA]! : 0.0) - (vA >= 0 ? xB[vA]! : 0.0);
            this.zArresterPorts[row * M + col] = zAb;
          }
        }
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
   * Stamps a 3x3 phase-coupled branch (self conductance gSelf, mutual conductance gMut,
   * off-nominal tap ratio a = V_sec/V_prim, and exact ±30° Y-Delta vector group incidence)
   * between bus i and bus j in the 3N x 3N matrix G3.
   */
  private stamp3PhaseBranch(
    i: number,
    j: number,
    gSelf: number,
    gMut: number = 0,
    tapRatio: number = 1.0,
    windingConnection?: "Yg-Yg" | "Yg-D" | "D-Yg" | "D-D" | undefined,
  ): void {
    const a = tapRatio > 0 ? tapRatio : 1.0;
    const invA = 1.0 / a;
    if (windingConnection === "Yg-D" || windingConnection === "D-Yg") {
      // Yd1 coupled winding incidence matrix: M_delta = (1/sqrt(3)) * [[1,-1,0],[0,1,-1],[-1,0,1]]
      const invSqrt3 = 1.0 / Math.sqrt(3.0);
      const mp =
        windingConnection === "D-Yg"
          ? [
              [invSqrt3, -invSqrt3, 0],
              [0, invSqrt3, -invSqrt3],
              [-invSqrt3, 0, invSqrt3],
            ]
          : [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ];
      const ms =
        windingConnection === "Yg-D"
          ? [
              [invSqrt3 * invA, -invSqrt3 * invA, 0],
              [0, invSqrt3 * invA, -invSqrt3 * invA],
              [-invSqrt3 * invA, 0, invSqrt3 * invA],
            ]
          : [
              [invA, 0, 0],
              [0, invA, 0],
              [0, 0, invA],
            ];
      const Gp = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (r === c ? gSelf : gMut)));
      for (let w1 = 0; w1 < 3; w1++) {
        for (let w2 = 0; w2 < 3; w2++) {
          const gw = Gp[w1]![w2]!;
          if (Math.abs(gw) <= 1e-18) continue;
          for (let p1 = 0; p1 < 3; p1++) {
            for (let p2 = 0; p2 < 3; p2++) {
              const alphaP1 = mp[w1]![p1]!;
              const alphaP2 = mp[w2]![p2]!;
              const betaS1 = ms[w1]![p1]!;
              const betaS2 = ms[w2]![p2]!;
              if (i >= 0 && alphaP1 !== 0 && alphaP2 !== 0) {
                this.stampEntry(3 * i + p1, 3 * i + p2, gw * alphaP1 * alphaP2);
              }
              if (j >= 0 && betaS1 !== 0 && betaS2 !== 0) {
                this.stampEntry(3 * j + p1, 3 * j + p2, gw * betaS1 * betaS2);
              }
              if (i >= 0 && j >= 0 && alphaP1 !== 0 && betaS2 !== 0) {
                this.stampEntry(3 * i + p1, 3 * j + p2, -gw * alphaP1 * betaS2);
              }
              if (i >= 0 && j >= 0 && betaS1 !== 0 && alphaP2 !== 0) {
                this.stampEntry(3 * j + p1, 3 * i + p2, -gw * betaS1 * alphaP2);
              }
            }
          }
        }
      }
      // Stabilize ungrounded zero-sequence mode on the Delta side without affecting positive/negative sequence
      const dIdx = windingConnection === "Yg-D" ? j : i;
      if (dIdx >= 0) {
        const gZ0 = Math.max(1e-9, gSelf * 1e-6);
        for (let p = 0; p < 3; p++) this.stampDiagonal(3 * dIdx + p, gZ0);
      }
      return;
    }

    const invA2 = invA * invA;
    for (let p = 0; p < 3; p++) {
      const pi = i >= 0 ? 3 * i + p : -1;
      const pj = j >= 0 ? 3 * j + p : -1;
      if (Math.abs(a - 1.0) < 1e-9) {
        this.stampNodeAdmittance(pi, pj, gSelf);
      } else {
        if (pi >= 0) this.stampDiagonal(pi, gSelf);
        if (pj >= 0) this.stampDiagonal(pj, gSelf * invA2);
        if (pi >= 0 && pj >= 0) {
          this.stampEntry(pi, pj, -gSelf * invA);
          this.stampEntry(pj, pi, -gSelf * invA);
        }
      }
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
            this.stampEntry(pj1, pj2, gMut * invA2);
          }
          if (pi1 >= 0 && pj2 >= 0) {
            this.stampEntry(pi1, pj2, -gMut * invA);
            this.stampEntry(pj2, pi1, -gMut * invA);
          }
        }
      }
    }
  }

  private computeCompanionDrop(br: CompanionBranch, useV3Step: boolean = false): [number, number, number] {
    const vfa = br.fromIdx >= 0 ? (useV3Step ? this.v3Step[3 * br.fromIdx + 0]! : this.vaStep[br.fromIdx]!) : 0.0;
    const vfb = br.fromIdx >= 0 ? (useV3Step ? this.v3Step[3 * br.fromIdx + 1]! : this.vbStep[br.fromIdx]!) : 0.0;
    const vfc = br.fromIdx >= 0 ? (useV3Step ? this.v3Step[3 * br.fromIdx + 2]! : this.vcStep[br.fromIdx]!) : 0.0;
    const vta = br.toIdx >= 0 ? (useV3Step ? this.v3Step[3 * br.toIdx + 0]! : this.vaStep[br.toIdx]!) : 0.0;
    const vtb = br.toIdx >= 0 ? (useV3Step ? this.v3Step[3 * br.toIdx + 1]! : this.vbStep[br.toIdx]!) : 0.0;
    const vtc = br.toIdx >= 0 ? (useV3Step ? this.v3Step[3 * br.toIdx + 2]! : this.vcStep[br.toIdx]!) : 0.0;
    const invA = 1.0 / (br.tapRatio && br.tapRatio > 0 ? br.tapRatio : 1.0);
    const invSqrt3 = 1.0 / Math.sqrt(3.0);
    if (br.windingConnection === "Yg-D") {
      return [
        vfa - invSqrt3 * invA * (vta - vtb),
        vfb - invSqrt3 * invA * (vtb - vtc),
        vfc - invSqrt3 * invA * (vtc - vta),
      ];
    }
    if (br.windingConnection === "D-Yg") {
      return [
        invSqrt3 * (vfa - vfb) - invA * vta,
        invSqrt3 * (vfb - vfc) - invA * vtb,
        invSqrt3 * (vfc - vfa) - invA * vtc,
      ];
    }
    return [vfa - invA * vta, vfb - invA * vtb, vfc - invA * vtc];
  }

  private injectCompanionHistory(br: CompanionBranch): void {
    const invA = 1.0 / (br.tapRatio && br.tapRatio > 0 ? br.tapRatio : 1.0);
    const invSqrt3 = 1.0 / Math.sqrt(3.0);
    if (br.fromIdx >= 0) {
      if (br.windingConnection === "D-Yg") {
        this.J3[3 * br.fromIdx + 0] = this.J3[3 * br.fromIdx + 0]! - invSqrt3 * (br.iHistA - br.iHistC);
        this.J3[3 * br.fromIdx + 1] = this.J3[3 * br.fromIdx + 1]! - invSqrt3 * (br.iHistB - br.iHistA);
        this.J3[3 * br.fromIdx + 2] = this.J3[3 * br.fromIdx + 2]! - invSqrt3 * (br.iHistC - br.iHistB);
      } else {
        this.J3[3 * br.fromIdx + 0] = this.J3[3 * br.fromIdx + 0]! - br.iHistA;
        this.J3[3 * br.fromIdx + 1] = this.J3[3 * br.fromIdx + 1]! - br.iHistB;
        this.J3[3 * br.fromIdx + 2] = this.J3[3 * br.fromIdx + 2]! - br.iHistC;
      }
    }
    if (br.toIdx >= 0) {
      if (br.windingConnection === "Yg-D") {
        const s = invSqrt3 * invA;
        this.J3[3 * br.toIdx + 0] = this.J3[3 * br.toIdx + 0]! + s * (br.iHistA - br.iHistC);
        this.J3[3 * br.toIdx + 1] = this.J3[3 * br.toIdx + 1]! + s * (br.iHistB - br.iHistA);
        this.J3[3 * br.toIdx + 2] = this.J3[3 * br.toIdx + 2]! + s * (br.iHistC - br.iHistB);
      } else {
        this.J3[3 * br.toIdx + 0] = this.J3[3 * br.toIdx + 0]! + br.iHistA * invA;
        this.J3[3 * br.toIdx + 1] = this.J3[3 * br.toIdx + 1]! + br.iHistB * invA;
        this.J3[3 * br.toIdx + 2] = this.J3[3 * br.toIdx + 2]! + br.iHistC * invA;
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

  private stampNUlmModel(nu: { fromIdx: number; toIdx: number; model: NConductorUlmData }): void {
    const n = nu.model.nCond;
    const pMax = Math.min(3, n);
    if (nu.fromIdx >= 0) {
      const baseK = 3 * nu.fromIdx;
      for (let r = 0; r < pMax; r++) {
        for (let c = 0; c < pMax; c++) {
          this.stampEntry(baseK + r, baseK + c, nu.model.gEq[r * n + c]!);
        }
      }
    }
    if (nu.toIdx >= 0) {
      const baseM = 3 * nu.toIdx;
      for (let r = 0; r < pMax; r++) {
        for (let c = 0; c < pMax; c++) {
          this.stampEntry(baseM + r, baseM + c, nu.model.gEq[r * n + c]!);
        }
      }
    }
  }

  private assembleDynamicInjections(
    t: number,
    k: number,
    isMainStep: boolean,
    anyFaultActive: boolean,
    mmcRuntimeStates: Array<{ busIdx: number | undefined; gArm: number; vAcA: number; vAcB: number; vAcC: number }>,
  ): void {
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

    for (const cs of this.netlist.currentSources ?? []) {
      const bIdx = this.busIdxMap.get(cs.bus);
      if (bIdx === undefined) continue;
      const w = 2 * Math.PI * (cs.frequencyHz || 60.0);
      const ph = cs.phaseRad || 0;
      this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! + cs.iPeakA * Math.sin(w * t + ph);
      this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! + cs.iPeakA * Math.sin(w * t + ph - (2 * Math.PI) / 3);
      this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! + cs.iPeakA * Math.sin(w * t + ph + (2 * Math.PI) / 3);
    }

    for (const im of this.indMachineStates) {
      const theta = this.omega * t + im.thetaR;
      const ePeak = im.eInternalPu * im.vPeak;
      this.J3[3 * im.busIdx + 0] = this.J3[3 * im.busIdx + 0]! + im.gStator * ePeak * Math.sin(theta);
      this.J3[3 * im.busIdx + 1] =
        this.J3[3 * im.busIdx + 1]! + im.gStator * ePeak * Math.sin(theta - (2 * Math.PI) / 3);
      this.J3[3 * im.busIdx + 2] =
        this.J3[3 * im.busIdx + 2]! + im.gStator * ePeak * Math.sin(theta + (2 * Math.PI) / 3);
    }

    for (const xf of this.satXfmrStates) {
      this.J3[3 * xf.primIdx + 0] = this.J3[3 * xf.primIdx + 0]! - xf.iMagA;
      this.J3[3 * xf.primIdx + 1] = this.J3[3 * xf.primIdx + 1]! - xf.iMagB;
      this.J3[3 * xf.primIdx + 2] = this.J3[3 * xf.primIdx + 2]! - xf.iMagC;
    }

    if (this.options?.boundaryFeeds) {
      for (const bf of this.options.boundaryFeeds) {
        const bIdx = this.busIdxMap.get(bf.busId);
        if (bIdx === undefined) continue;
        if (bf.thevenin) {
          const th = bf.thevenin(t);
          if (th) {
            this.J3[3 * bIdx + 0] =
              this.J3[3 * bIdx + 0]! + th.gSrc * th.vPeak * Math.sin(th.freqRad * t + th.phaseRad);
            this.J3[3 * bIdx + 1] =
              this.J3[3 * bIdx + 1]! + th.gSrc * th.vPeak * Math.sin(th.freqRad * t + th.phaseRad - (2 * Math.PI) / 3);
            this.J3[3 * bIdx + 2] =
              this.J3[3 * bIdx + 2]! + th.gSrc * th.vPeak * Math.sin(th.freqRad * t + th.phaseRad + (2 * Math.PI) / 3);
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

    for (const sg of this.syncGenerators) {
      const thetaE = sg.omega0 * t + sg.deltaRad;
      const ea = sg.vPeak * (sg.eqSubPu * Math.sin(thetaE) + sg.edSubPu * Math.cos(thetaE));
      const eb =
        sg.vPeak *
        (sg.eqSubPu * Math.sin(thetaE - (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE - (2 * Math.PI) / 3));
      const ec =
        sg.vPeak *
        (sg.eqSubPu * Math.sin(thetaE + (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE + (2 * Math.PI) / 3));
      this.J3[3 * sg.busIdx + 0] = this.J3[3 * sg.busIdx + 0]! + sg.gGen * ea + sg.iHistA;
      this.J3[3 * sg.busIdx + 1] = this.J3[3 * sg.busIdx + 1]! + sg.gGen * eb + sg.iHistB;
      this.J3[3 * sg.busIdx + 2] = this.J3[3 * sg.busIdx + 2]! + sg.gGen * ec + sg.iHistC;
    }

    for (const ms of mmcRuntimeStates) {
      if (ms.busIdx === undefined) continue;
      this.J3[3 * ms.busIdx + 0] = this.J3[3 * ms.busIdx + 0]! + ms.gArm * ms.vAcA;
      this.J3[3 * ms.busIdx + 1] = this.J3[3 * ms.busIdx + 1]! + ms.gArm * ms.vAcB;
      this.J3[3 * ms.busIdx + 2] = this.J3[3 * ms.busIdx + 2]! + ms.gArm * ms.vAcC;
    }

    for (const br of this.companionBranches) {
      this.injectCompanionHistory(br);
    }

    for (const bl of this.bergeronLines) {
      const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = this.computeLineHistoryCurrents(bl, false);
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
      const { iHistKmA, iHistKmB, iHistKmC, iHistMkA, iHistMkB, iHistMkC } = stepUlmLine(ulm, 0, 0, 0, 0, 0, 0, false);
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

    for (const nu of this.nUlmLines) {
      const { iHistK, iHistM } = stepNConductorUlm(nu.model, nu.vK, nu.vM, false);
      const pMax = Math.min(3, nu.model.nCond);
      if (nu.fromIdx >= 0) {
        for (let p = 0; p < pMax; p++) this.J3[3 * nu.fromIdx + p] = this.J3[3 * nu.fromIdx + p]! - iHistK[p]!;
      }
      if (nu.toIdx >= 0) {
        for (let p = 0; p < pMax; p++) this.J3[3 * nu.toIdx + p] = this.J3[3 * nu.toIdx + p]! - iHistM[p]!;
      }
    }

    const tauLvrtPre = 0.008;
    const alphaLvrtPre = 1.0 - Math.exp(-this.timeStepSec / tauLvrtPre);
    for (const fmuState of this.fmuStates) {
      const { busIdx, iRatedPeak } = fmuState;
      if (fmuState.companion) {
        if (isMainStep) {
          const { gEq, iHist } = fmuState.companion.stampCompanion(t, this.timeStepSec);
          const lastG = fmuState.lastGEq!;
          const lastI = fmuState.lastIHist!;
          let gChanged = false;
          for (let r = 0; r < 3; r++) {
            const ih = iHist[r] ?? 0;
            lastI[r] = ih;
            this.J3[3 * busIdx + r] = this.J3[3 * busIdx + r]! + ih;
            for (let c = 0; c < 3; c++) {
              const gVal = gEq[r * 3 + c] ?? 0;
              if (gVal !== lastG[r * 3 + c]) {
                this.stampEntry(3 * busIdx + r, 3 * busIdx + c, gVal - lastG[r * 3 + c]!);
                lastG[r * 3 + c] = gVal;
                gChanged = true;
              }
            }
          }
          if (gChanged) {
            this.factorize3Phase(this.G3, this.LU3, this.piv3);
            this.luFactorizationCount++;
            this.activeTopoKey = "";
            this.luValid = false;
          }
        } else if (fmuState.lastIHist) {
          for (let r = 0; r < 3; r++) {
            this.J3[3 * busIdx + r] = this.J3[3 * busIdx + r]! + (fmuState.lastIHist[r] ?? 0);
          }
        }
        continue;
      }
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
      this.J3[3 * busIdx + 0] =
        this.J3[3 * busIdx + 0]! + idEst * Math.sin(this.omega * t) - iqEst * Math.cos(this.omega * t);
      this.J3[3 * busIdx + 1] =
        this.J3[3 * busIdx + 1]! +
        idEst * Math.sin(this.omega * t - (2 * Math.PI) / 3) -
        iqEst * Math.cos(this.omega * t - (2 * Math.PI) / 3);
      this.J3[3 * busIdx + 2] =
        this.J3[3 * busIdx + 2]! +
        idEst * Math.sin(this.omega * t + (2 * Math.PI) / 3) -
        iqEst * Math.cos(this.omega * t + (2 * Math.PI) / 3);
    }

    const SQRT3 = Math.sqrt(3);
    for (const br of this.bridgeRuntimeStates) {
      const bIdx = br.acBusIdx;
      const va = k > 0 ? (this.vaStep[bIdx] ?? 0) : 0;
      const vb = k > 0 ? (this.vbStep[bIdx] ?? 0) : 0;
      const vc = k > 0 ? (this.vcStep[bIdx] ?? 0) : 0;
      const vMag = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
      const thetaRaw = vMag > 1e-3 ? Math.atan2((vb - vc) / SQRT3, (2 * va - vb - vc) / 3.0) : this.omega * t;
      const phase = Number.isFinite(thetaRaw) ? thetaRaw : this.omega * t;

      if (br.conv.kind === "lcc_6pulse") {
        // True 6-pulse thyristor bridge switching function with commutation overlap mu:
        // Conducting DC current iDcAmp splits across positive & negative valve groups per 60-deg sector.
        const alphaRad = ((br.conv.firingAngleDeg ?? 15.0) * Math.PI) / 180.0;
        const elecAngle = (((phase - alphaRad) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const switchWave = (ang: number): number => {
          const u = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const halfRamp = Math.max(0.02, 0.5 * br.muRad);
          // Positive half-cycle: [pi/6 .. 5pi/6], Negative: [7pi/6 .. 11pi/6]
          const sPos =
            Math.max(0, Math.min(1, (u - (Math.PI / 6 - halfRamp)) / (2 * halfRamp))) -
            Math.max(0, Math.min(1, (u - ((5 * Math.PI) / 6 - halfRamp)) / (2 * halfRamp)));
          const sNeg =
            Math.max(0, Math.min(1, (u - ((7 * Math.PI) / 6 - halfRamp)) / (2 * halfRamp))) -
            Math.max(0, Math.min(1, (u - ((11 * Math.PI) / 6 - halfRamp)) / (2 * halfRamp)));
          return sPos - sNeg;
        };
        const sa = switchWave(elecAngle);
        const sb = switchWave(elecAngle - (2 * Math.PI) / 3);
        const sc = switchWave(elecAngle + (2 * Math.PI) / 3);
        this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! - br.iDcAmp * sa;
        this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! - br.iDcAmp * sb;
        this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! - br.iDcAmp * sc;
      } else {
        // Switched 2-level VSC PWM Norton injection through R_f-L_f choke companion: I = gChoke * (vPole - vAc) + iHistChoke
        this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! + br.gChoke * br.vPoleA + br.iHistChokeA;
        this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! + br.gChoke * br.vPoleB + br.iHistChokeB;
        this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! + br.gChoke * br.vPoleC + br.iHistChokeC;
      }

      if (br.dcBusIdx >= 0) {
        const gDc = 1.0 / Math.max(0.05, 0.01 * br.rDcLoadOhm);
        this.J3[3 * br.dcBusIdx + 0] = this.J3[3 * br.dcBusIdx + 0]! + gDc * br.vDcVolts;
      }
    }

    for (const vdl of this.netlist.voltageDependentLoads ?? []) {
      const bIdx = this.busIdxMap.get(vdl.busId);
      if (bIdx === undefined) continue;
      const va = k > 0 ? (this.vaStep[bIdx] ?? 0) : 0;
      const vb = k > 0 ? (this.vbStep[bIdx] ?? 0) : 0;
      const vc = k > 0 ? (this.vcStep[bIdx] ?? 0) : 0;
      const vPeak = Math.sqrt((2 / 3) * (va * va + vb * vb + vc * vc));
      const v0Peak = (vdl.v0KvLL * 1e3 * Math.SQRT2) / SQRT3;
      if (vPeak > 1.0 && v0Peak > 1.0) {
        const vPu = Math.max(0.2, Math.min(2.0, vPeak / v0Peak));
        const pLoad = vdl.p0Mw * 1e6 * Math.pow(vPu, vdl.np);
        const qLoad = vdl.q0Mvar * 1e6 * Math.pow(vPu, vdl.nq);
        const vSq = Math.max(1.0, va * va + vb * vb + vc * vc);
        const vaPerp = (vb - vc) / SQRT3;
        const vbPerp = (vc - va) / SQRT3;
        const vcPerp = (va - vb) / SQRT3;
        this.J3[3 * bIdx + 0] = this.J3[3 * bIdx + 0]! - (pLoad * va + qLoad * vaPerp) / vSq;
        this.J3[3 * bIdx + 1] = this.J3[3 * bIdx + 1]! - (pLoad * vb + qLoad * vbPerp) / vSq;
        this.J3[3 * bIdx + 2] = this.J3[3 * bIdx + 2]! - (pLoad * vc + qLoad * vcPerp) / vSq;
      }
    }

    if (isMainStep && this.emtdcHostBridge && this.customBlockStates.length > 0) {
      for (const cbs of this.customBlockStates) {
        if (this.csmfEvaluator && cbs.block.inputs) {
          for (const inp of cbs.block.inputs) {
            if (inp.sourceId) {
              cbs.udm.ports[inp.portName] = this.csmfEvaluator.getSignal(inp.sourceId);
            }
          }
        }
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

    // Fall back to TS if features requiring coupled TS physics are active
    if (
      this.companionBranches.some((br) => Math.abs(br.gMut) > 1e-12 || br.windingConnection !== undefined) ||
      (this.netlist.protectionRelays && this.netlist.protectionRelays.length > 0) ||
      (this.netlist.converterBridges && this.netlist.converterBridges.length > 0) ||
      this.surgeArresters.length > 0 ||
      this.customBlockStates.length > 0 ||
      this.csmfEvaluator !== null ||
      this.ulmLines.length > 0 ||
      this.nUlmLines.length > 0 ||
      this.oltcStates.length > 0 ||
      this.bridgeRuntimeStates.length > 0 ||
      this.bergeronLines.some((b) => b.hasModal) ||
      (this.options.useWasm !== true &&
        (this.bergeronLines.length > 0 || (this.netlist.faults?.length ?? 0) > 0 || this.nBuses >= 50)) ||
      this.fmuStates.length > 0 ||
      Boolean(this.options?.boundaryFeeds?.length) ||
      Boolean(this.options?.initializeFromLoadFlow) ||
      Boolean(this.options?.initialSnapshot) ||
      this.snapshotApplied ||
      (this.options.useWasm !== true && this.switchStates.length > 0)
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
        !this.csmfEvaluator &&
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

      const lastK = Math.max(0, this.nSteps - 1);
      for (let i = 0; i < this.nBuses; i++) {
        const pv = this.busPhaseVoltages.get(this.busList[i]!.id);
        if (pv) {
          this.vaStep[i] = pv.a[lastK] ?? 0;
          this.vbStep[i] = pv.b[lastK] ?? 0;
          this.vcStep[i] = pv.c[lastK] ?? 0;
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
          luFactorizations: wasmLuCount,
          switchingEvents: wasmSwitchingEvents,
          chatterDampedSteps: 0,
          executionTimeMs,
        },
      };
    } catch (err) {
      console.warn(
        "[EMT:wasm] Fast-path failed, falling back to TS solver:",
        err instanceof Error ? err.message : String(err),
      );
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
      const sinDelta = Math.max(-0.9, Math.min(0.9, (sg.pmPu * sg.xdSubPu) / Math.max(0.1, sg.efPu)));
      sg.deltaRad = Math.asin(sinDelta);
      for (let p = 0; p < 3; p++) {
        this.stampDiagonal(3 * sg.busIdx + p, sg.gGen);
      }
    }
    for (const br of this.companionBranches) {
      const gTotal = br.gEq + 0.5 * br.shuntG;
      this.stamp3PhaseBranch(br.fromIdx, br.toIdx, gTotal, br.gMut, br.tapRatio ?? 1.0, br.windingConnection);
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
    for (const nu of this.nUlmLines) {
      this.stampNUlmModel(nu);
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
    this.activeTopoKey = this.computeTopologyKey(0);
    if (this.activeTopoKey) {
      this.saveTopologyToCache(this.activeTopoKey);
    }

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
        this.J3[3 * sg.busIdx + 0] = this.J3[3 * sg.busIdx + 0]! + sg.gGen * ePeak * Math.sin(thetaE) + sg.iHistA;
        this.J3[3 * sg.busIdx + 1] =
          this.J3[3 * sg.busIdx + 1]! + sg.gGen * ePeak * Math.sin(thetaE - (2 * Math.PI) / 3) + sg.iHistB;
        this.J3[3 * sg.busIdx + 2] =
          this.J3[3 * sg.busIdx + 2]! + sg.gGen * ePeak * Math.sin(thetaE + (2 * Math.PI) / 3) + sg.iHistC;
      }
      for (const br of this.companionBranches) {
        this.injectCompanionHistory(br);
      }
      for (const nu of this.nUlmLines) {
        const { iHistK, iHistM } = stepNConductorUlm(nu.model, nu.vK, nu.vM, false);
        const pMax = Math.min(3, nu.model.nCond);
        if (nu.fromIdx >= 0) {
          for (let p = 0; p < pMax; p++) this.J3[3 * nu.fromIdx + p] = this.J3[3 * nu.fromIdx + p]! - iHistK[p]!;
        }
        if (nu.toIdx >= 0) {
          for (let p = 0; p < pMax; p++) this.J3[3 * nu.toIdx + p] = this.J3[3 * nu.toIdx + p]! - iHistM[p]!;
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
      for (const nu of this.nUlmLines) {
        const { iHistK, iHistM } = stepNConductorUlm(nu.model, nu.vK, nu.vM, false);
        const pMax = Math.min(3, nu.model.nCond);
        if (nu.fromIdx >= 0) {
          for (let p = 0; p < pMax; p++) this.J3[3 * nu.fromIdx + p] = this.J3[3 * nu.fromIdx + p]! - iHistK[p]!;
        }
        if (nu.toIdx >= 0) {
          for (let p = 0; p < pMax; p++) this.J3[3 * nu.toIdx + p] = this.J3[3 * nu.toIdx + p]! - iHistM[p]!;
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
        const [dvA, dvB, dvC] = this.computeCompanionDrop(br);
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

      for (const sg of this.syncGenerators) {
        const thetaE = sg.omega0 * t + sg.deltaRad;
        const ePeak = sg.efPu * sg.vPeak;
        const ea = ePeak * Math.sin(thetaE);
        const eb = ePeak * Math.sin(thetaE - (2 * Math.PI) / 3);
        const ec = ePeak * Math.sin(thetaE + (2 * Math.PI) / 3);
        const diffA = ea - this.vaStep[sg.busIdx]!;
        const diffB = eb - this.vbStep[sg.busIdx]!;
        const diffC = ec - this.vcStep[sg.busIdx]!;
        const ia = sg.gGen * diffA + sg.iHistA;
        const ib = sg.gGen * diffB + sg.iHistB;
        const ic = sg.gGen * diffC + sg.iHistC;
        sg.iHistA = sg.alphaGen * ia + sg.gGen * diffA;
        sg.iHistB = sg.alphaGen * ib + sg.gGen * diffB;
        sg.iHistC = sg.alphaGen * ic + sg.gGen * diffC;
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

      for (const nu of this.nUlmLines) {
        nu.vK.fill(0);
        nu.vM.fill(0);
        if (nu.fromIdx >= 0) {
          nu.vK[0] = this.vaStep[nu.fromIdx]!;
          if (nu.model.nCond > 1) nu.vK[1] = this.vbStep[nu.fromIdx]!;
          if (nu.model.nCond > 2) nu.vK[2] = this.vcStep[nu.fromIdx]!;
        }
        if (nu.toIdx >= 0) {
          nu.vM[0] = this.vaStep[nu.toIdx]!;
          if (nu.model.nCond > 1) nu.vM[1] = this.vbStep[nu.toIdx]!;
          if (nu.model.nCond > 2) nu.vM[2] = this.vcStep[nu.toIdx]!;
        }
        stepNConductorUlm(nu.model, nu.vK, nu.vM, true);
      }
    }
  }

  /**
   * Restores solver internal state (bus voltages, companion branch histories, Bergeron/ULM line buffers,
   * synchronous generator rotor angles, and switch states) from a `PscadSnapshot` (`.snp`).
   */
  public applySnapshot(snapshot: PscadSnapshot): void {
    this.snapshotApplied = true;
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
      const useTraj = Boolean(pv && (pv.a[k] !== 0 || pv.b[k] !== 0 || pv.c[k] !== 0));
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
  /**
   * Mutates a live runtime parameter (CSMF slider/dial/pushbutton `Value`, breaker open/close state,
   * converter `pRefMw`/`qRefMvar`/`vDcRefKv`/`firingAngleDeg`, or generator `efPu`/`pmPu`) mid-run.
   */
  public interactiveWrite(targetId: string, paramOrAction: string, value: number | boolean): boolean {
    let applied = false;
    const key = paramOrAction.toLowerCase();
    if (key === "breaker" || key === "switch" || key === "closed" || typeof value === "boolean") {
      const closed = Boolean(value);
      for (const swState of this.switchStates) {
        if (
          swState.sw.id === targetId ||
          swState.sw.id.startsWith(`${targetId}_`) ||
          swState.sw.id.includes(targetId)
        ) {
          this.csmfBreakerOverrides.set(swState.sw.id, closed);
          applied = true;
        }
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (this.csmfEvaluator?.setBlockParam(targetId, paramOrAction || "Value", value)) {
        applied = true;
      }
      if (this.csmfEvaluator) {
        for (const blk of this.netlist.controlBlocks ?? []) {
          if (blk.id === targetId) {
            blk.params[paramOrAction || "Value"] = value;
            this.csmfEvaluator.setSignal(targetId, value);
            applied = true;
          }
        }
      }
      for (const br of this.bridgeRuntimeStates) {
        if (br.conv.id === targetId) {
          if (paramOrAction === "pRefMw" || paramOrAction === "p_ref") br.conv.pRefMw = value;
          else if (paramOrAction === "qRefMvar" || paramOrAction === "q_ref") br.conv.qRefMvar = value;
          else if (paramOrAction === "vDcRefKv" || paramOrAction === "vdc_ref") {
            br.conv.vDcRefKv = value;
            br.vDcRefVolts = value * 1e3;
          } else if (paramOrAction === "firingAngleDeg" || paramOrAction === "alpha") br.conv.firingAngleDeg = value;
          applied = true;
        }
      }
      for (const sg of this.syncGenerators) {
        if (sg.id === targetId) {
          if (paramOrAction === "efPu" || paramOrAction === "ef") sg.efPu = value;
          else if (paramOrAction === "pmPu" || paramOrAction === "tm" || paramOrAction === "pm") sg.pmPu = value;
          applied = true;
        }
      }
    }
    return applied;
  }

  public solve(): EmtSolverResult {
    this.licenseGuard.verifyOrThrow(
      this.customBlockStates.map((cbs) => ({
        block: cbs.block,
        runner: cbs.runner,
      })),
    );
    const startTime = performance.now();
    if (this.nBuses === 0) {
      return this.solveZeroBusSystem(startTime);
    }
    if (this.useWasm && this.syncGenerators.length === 0) {
      const wasmRes = this.solveWithWasm();
      if (wasmRes) return wasmRes;
    }
    const state = this.initSolveLoopState();
    this.runStepBatch(state, 0, this.nSteps);
    return this.finalizeSolveResult(startTime);
  }

  /**
   * Executes the EMT simulation in non-blocking chunks so browser WebWorkers or IDE runtimes
   * can Pause, Resume, Single-Step, Abort, stream progress, and apply `interactiveWrite()` mid-run.
   */
  public async solveChunked(options?: {
    chunkSteps?: number | undefined;
    signal?: AbortSignal | undefined;
    isPaused?: (() => boolean) | undefined;
    waitIfPaused?: (() => Promise<void>) | undefined;
    onChunk?: ((completedSteps: number, totalSteps: number, timeSec: number) => void) | undefined;
  }): Promise<EmtSolverResult> {
    this.licenseGuard.verifyOrThrow(
      this.customBlockStates.map((cbs) => ({
        block: cbs.block,
        runner: cbs.runner,
      })),
    );
    const startTime = performance.now();
    if (this.nBuses === 0) {
      return this.solveZeroBusSystem(startTime);
    }
    const chunkSteps = Math.max(1, Math.trunc(options?.chunkSteps ?? 250));
    const state = this.initSolveLoopState();
    for (let kStart = 0; kStart < this.nSteps; kStart += chunkSteps) {
      if (options?.signal?.aborted) break;
      if (options?.isPaused?.() && options.waitIfPaused) {
        await options.waitIfPaused();
        if (options?.signal?.aborted) break;
      }
      const kEnd = Math.min(this.nSteps, kStart + chunkSteps);
      this.runStepBatch(state, kStart, kEnd);
      if (kEnd < this.nSteps && !options?.signal?.aborted) {
        options?.onChunk?.(kEnd, this.nSteps, this.time[Math.max(0, kEnd - 1)] ?? 0);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    return this.finalizeSolveResult(startTime);
  }

  private solveZeroBusSystem(startTime: number): EmtSolverResult {
    if (this.csmfEvaluator) {
      const controlBlocks = this.netlist.controlBlocks ?? [];
      for (let k = 0; k < this.nSteps; k++) {
        this.time[k] = k * this.timeStepSec;
        const stepValues = this.csmfEvaluator.step(this.timeStepSec);
        for (const blk of controlBlocks) {
          const traj = this.controlSignals.get(blk.id);
          if (traj) traj[k] = stepValues.get(blk.id) ?? 0;
        }
      }
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
      metrics: {
        totalSteps: this.csmfEvaluator ? this.nSteps : 0,
        luFactorizations: 0,
        switchingEvents: 0,
        chatterDampedSteps: 0,
        interpolatedZeroCrossings: 0,
        executionTimeMs: performance.now() - startTime,
      },
    };
  }

  private initSolveLoopState() {
    const n = this.nBuses;
    const vaPrevStep = new Float64Array(n);
    const vbPrevStep = new Float64Array(n);
    const vcPrevStep = new Float64Array(n);
    const vPreStep3 = new Float64Array(this.nPhaseNodes);
    const nArr = this.surgeArresters.length;
    const arrM = nArr * 3;
    const v0Step = arrM > 0 ? new Float64Array(this.nPhaseNodes) : null;
    const arrV0 = arrM > 0 ? new Float64Array(arrM) : null;
    const arrCurr = arrM > 0 ? new Float64Array(arrM) : null;
    const arrRes = arrM > 0 ? new Float64Array(arrM) : null;
    const arrDelta = arrM > 0 ? new Float64Array(arrM) : null;
    const arrJac = arrM > 0 ? new Float64Array(arrM * arrM) : null;

    // Initialize closed-loop protection relay runtime states and control signal buffers
    const relayFreqHz = this.omega / (2 * Math.PI);
    const relayNCyc = Math.max(8, Math.round(1.0 / (Math.max(1.0, relayFreqHz) * Math.max(1e-7, this.timeStepSec))));
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
        nCyc: relayNCyc,
        dftIdx: 0,
        sampleCount: 0,
        vaBuf: new Float64Array(relayNCyc),
        iaBuf: new Float64Array(relayNCyc),
        secIaBuf: new Float64Array(relayNCyc),
        cos1Buf: new Float64Array(relayNCyc),
        sin1Buf: new Float64Array(relayNCyc),
        cos2Buf: new Float64Array(relayNCyc),
        sin2Buf: new Float64Array(relayNCyc),
        prevVa: 0.0,
        prevIa: 0.0,
        prevSecIa: 0.0,
        vMemRe: this.busList[this.busIdxMap.get(relay.monitoredBus) ?? 0]?.vPeak ?? 0.0,
        vMemIm: 0.0,
        ctFluxVs: 0.0,
        prevZAngleRad: 0.0,
        freqEstHz: relayFreqHz,
        smoothRocofHzPerSec: 0.0,
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
      const makeArms = () =>
        [0, 1, 2].map((p) => {
          const arr = new Float64Array(nSm);
          for (let i = 0; i < nSm; i++) {
            arr[i] = vSmNomKv * (1.0 + 0.01 * (((i + p) % 3) - 1));
          }
          return arr;
        }) as [Float64Array, Float64Array, Float64Array];
      const vCapUpper = makeArms();
      const vCapLower = makeArms();
      const upperSumTraj = new Float64Array(this.nSteps);
      const lowerSumTraj = new Float64Array(this.nSteps);
      const spreadPctTraj = new Float64Array(this.nSteps);
      const iCircATraj = new Float64Array(this.nSteps);
      this.controlSignals.set(`${mmc.id}_vCapUpperSum`, upperSumTraj);
      this.controlSignals.set(`${mmc.id}_vCapLowerSum`, lowerSumTraj);
      this.controlSignals.set(`${mmc.id}_spreadPct`, spreadPctTraj);
      this.controlSignals.set(`${mmc.id}_iCircA`, iCircATraj);
      const busIdx = this.busIdxMap.get(mmc.acBus);
      const zBase = (mmc.ratedKvLL * mmc.ratedKvLL) / Math.max(1.0, mmc.ratedMva);
      const gArm = 1.0 / Math.max(0.5, 0.15 * zBase);
      if (busIdx !== undefined && !this.mmcSourcesRegistered) {
        const list = this.busSources.get(busIdx) ?? [];
        list.push({ vPeak: 0.0, freqRad: 0, phaseRad: 0.0, gSrc: gArm });
        this.busSources.set(busIdx, list);
      }
      return {
        mmc,
        busIdx,
        gArm,
        lArmH: Math.max(1e-3, mmc.armInductanceH ?? (0.15 * zBase) / this.omega),
        vAcA: 0.0,
        vAcB: 0.0,
        vAcC: 0.0,
        iCirc: [0.0, 0.0, 0.0] as [number, number, number],
        nSm,
        vDcKv,
        cSmFarad: Math.max(1e-4, mmc.submoduleCapacitanceF || 0.01),
        vCapUpper,
        vCapLower,
        upperSumTraj,
        lowerSumTraj,
        spreadPctTraj,
        iCircATraj,
      };
    });
    if (mmcBridges.length > 0) this.mmcSourcesRegistered = true;

    return {
      cdaCounter: 0,
      vaPrevStep,
      vbPrevStep,
      vcPrevStep,
      vPreStep3,
      nArr,
      arrM,
      v0Step,
      arrV0,
      arrCurr,
      arrRes,
      arrDelta,
      arrJac,
      relayRuntimeStates,
      mmcRuntimeStates,
    };
  }

  private runStepBatch(state: ReturnType<EmtSolver["initSolveLoopState"]>, kStart: number, kEnd: number): void {
    const n = this.nBuses;
    let cdaCounter = state.cdaCounter;
    const {
      vaPrevStep,
      vbPrevStep,
      vcPrevStep,
      vPreStep3,
      nArr,
      arrM,
      v0Step,
      arrV0,
      arrCurr,
      arrRes,
      arrDelta,
      arrJac,
      relayRuntimeStates,
      mmcRuntimeStates,
    } = state;

    for (let k = kStart; k < kEnd; k++) {
      const t = this.time[k]!;
      const prevTopoKey = this.activeTopoKey;
      if (k > 0) {
        vaPrevStep.set(this.vaStep);
        vbPrevStep.set(this.vbStep);
        vcPrevStep.set(this.vcStep);
      }

      // 1. Detect switch state toggles & compute sub-step zero-crossing interpolation factor alpha
      const switchedBusInterpolation = new Map<number, number>();
      for (const swState of this.switchStates) {
        const initClosed = Boolean(swState.sw.initialClosed);
        const poleTimes = swState.sw.poleActionTimesSec;
        const phaseCurBufs = [swState.ia, swState.ib, swState.ic];
        const evaluateZeroCrossOpening = (p: number): { canOpen: boolean; alpha: number } => {
          if (!swState.sw.waitForCurrentZero || k === 0) {
            return { canOpen: true, alpha: 0.5 };
          }
          const iCurr = phaseCurBufs[p]![k - 1] ?? 0;
          const iPrev = k >= 2 ? (phaseCurBufs[p]![k - 2] ?? iCurr) : iCurr;
          if (Math.abs(iCurr) <= 1e-6 || iPrev * iCurr <= 0) {
            const denom = Math.abs(iPrev) + Math.abs(iCurr);
            const rawA = denom > 1e-12 ? Math.abs(iPrev) / denom : 0.5;
            return { canOpen: true, alpha: Math.max(0.01, Math.min(0.99, rawA)) };
          }
          return { canOpen: false, alpha: 0.5 };
        };

        if (swState.sw.diode) {
          const vStepArr = [this.vaStep, this.vbStep, this.vcStep];
          for (let p = 0; p < 3; p++) {
            const vFrom = swState.fromIdx >= 0 ? (vStepArr[p]![swState.fromIdx] ?? 0) : 0;
            const vTo = swState.toIdx >= 0 ? (vStepArr[p]![swState.toIdx] ?? 0) : 0;
            const vDiff = vFrom - vTo;
            const iPrev = k > 0 ? (phaseCurBufs[p]![k - 1] ?? 0) : 0;
            const nextClosed = swState.phaseClosed[p] ? iPrev > 1e-6 || vDiff > 0.7 : vDiff > 0.7;
            if (nextClosed !== swState.phaseClosed[p]) {
              swState.phaseClosed[p] = nextClosed;
              this.switchingEventCount++;
              if (this.enableCda) cdaCounter = 2;
            }
          }
          swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
        } else if (poleTimes) {
          for (let p = 0; p < 3; p++) {
            const actionT = poleTimes[p]!;
            const desiredClosed = t >= actionT ? !initClosed : initClosed;
            let nextClosed = desiredClosed;
            let zeroCrossAlpha: number | undefined;
            if (swState.phaseClosed[p] && !desiredClosed) {
              const zc = evaluateZeroCrossOpening(p);
              if (!zc.canOpen) {
                nextClosed = true;
              } else if (swState.sw.waitForCurrentZero) {
                zeroCrossAlpha = zc.alpha;
              }
            }
            if (nextClosed !== swState.phaseClosed[p]) {
              swState.phaseClosed[p] = nextClosed;
              this.switchingEventCount++;
              if (this.enableCda) {
                cdaCounter = 2; // Trigger 2 steps of CDA damping
              }
              if (this.enableSwitchingInterpolation) {
                const tPrev = k > 0 ? this.time[k - 1]! : t - this.timeStepSec;
                const rawAlpha = zeroCrossAlpha ?? (actionT - tPrev) / this.timeStepSec;
                const alpha = rawAlpha > 0.01 && rawAlpha < 0.99 ? rawAlpha : 0.5;
                this.interpolatedZeroCrossingsCount++;
                if (swState.fromIdx >= 0) switchedBusInterpolation.set(swState.fromIdx, alpha);
                if (swState.toIdx >= 0) switchedBusInterpolation.set(swState.toIdx, alpha);
              }
            }
          }
          swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
        } else {
          const overrideClosed = this.csmfBreakerOverrides.get(swState.sw.id);
          const actionT = swState.sw.actionTimeSec;
          const desiredClosed = overrideClosed !== undefined ? overrideClosed : t >= actionT ? !initClosed : initClosed;
          let anyToggled = false;
          let toggledZeroAlpha: number | undefined;
          for (let p = 0; p < 3; p++) {
            let nextClosed = desiredClosed;
            if (swState.phaseClosed[p] && !desiredClosed) {
              const zc = evaluateZeroCrossOpening(p);
              if (!zc.canOpen) {
                nextClosed = true;
              } else if (swState.sw.waitForCurrentZero) {
                toggledZeroAlpha = zc.alpha;
              }
            }
            if (nextClosed !== swState.phaseClosed[p]) {
              swState.phaseClosed[p] = nextClosed;
              anyToggled = true;
            }
          }
          if (anyToggled) {
            this.switchingEventCount++;
            if (this.enableCda) {
              cdaCounter = 2;
            }
            if (this.enableSwitchingInterpolation) {
              const tPrev = k > 0 ? this.time[k - 1]! : t - this.timeStepSec;
              const rawAlpha = toggledZeroAlpha ?? (actionT - tPrev) / this.timeStepSec;
              const alpha = rawAlpha > 0.01 && rawAlpha < 0.99 ? rawAlpha : 0.5;
              this.interpolatedZeroCrossingsCount++;
              if (swState.fromIdx >= 0) switchedBusInterpolation.set(swState.fromIdx, alpha);
              if (swState.toIdx >= 0) switchedBusInterpolation.set(swState.toIdx, alpha);
            }
          }
          swState.currentClosed = swState.phaseClosed[0] || swState.phaseClosed[1] || swState.phaseClosed[2];
        }
      }

      // 2. Check active fault conditions
      let anyFaultActive = false;
      for (const flt of this.netlist.faults ?? []) {
        if (t >= flt.startSec && t <= flt.endSec) {
          anyFaultActive = true;
        }
      }

      // 3. Assemble coupled 3N x 3N conductance matrix on topology key miss (cache hit swaps LU in O(1))
      const topoKey = this.computeTopologyKey(t);
      const needsRebuild = !this.luValid || topoKey === "" || topoKey !== this.activeTopoKey;
      const cachedLu = needsRebuild && topoKey !== "" ? this.luCache.get(topoKey) : undefined;
      if (cachedLu) {
        this.luCache.delete(topoKey);
        this.luCache.set(topoKey, cachedLu);
        this.restoreTopologyFromCache(cachedLu);
        this.activeTopoKey = topoKey;
        this.luValid = true;
        this.luCacheHitsCount++;
      } else if (needsRebuild) {
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

        // Companion branches (including mutual coupling, tap ratio & exact ±30° Y-Delta incidence)
        for (const br of this.companionBranches) {
          const gTotal = br.gEq + 0.5 * br.shuntG;
          this.stamp3PhaseBranch(br.fromIdx, br.toIdx, gTotal, br.gMut, br.tapRatio ?? 1.0, br.windingConnection);
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
        for (const nu of this.nUlmLines) {
          this.stampNUlmModel(nu);
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

        // Compute coupled 3-phase LU factorization and store in topology bitmask LRU cache
        this.factorize3Phase(this.G3, this.LU3, this.piv3);
        this.luFactorizationCount++;
        this.luValid = true;
        this.updateSurgeArresterTheveninVectors();
        this.activeTopoKey = topoKey;
        if (topoKey) {
          this.saveTopologyToCache(topoKey);
        }
      }

      // 3b. True dt/2 CDA half-step (Backward Euler at t - 0.5*dt) to resynchronize onto the main grid
      if (this.enableCda && cdaCounter === 2 && k > 0 && this.luValid) {
        const tHalf = t - 0.5 * this.timeStepSec;
        this.assembleDynamicInjections(tHalf, k, false, anyFaultActive, mmcRuntimeStates);
        this.solveFromLU3Phase(this.LU3, this.piv3, this.J3, this.v3Step);
        for (const br of this.companionBranches) {
          const [dvA, dvB, dvC] = this.computeCompanionDrop(br, true);
          const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
          const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
          const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
          br.iHistA = br.vCoeffHist < 0 ? -br.gEq * (dvA - br.rOhm * curA) : br.alphaBe * curA;
          br.iHistB = br.vCoeffHist < 0 ? -br.gEq * (dvB - br.rOhm * curB) : br.alphaBe * curB;
          br.iHistC = br.vCoeffHist < 0 ? -br.gEq * (dvC - br.rOhm * curC) : br.alphaBe * curC;
        }
        this.chatterDampedCount++;
        cdaCounter = 1;
      }

      // 4. Switching rollback double-interpolation (if topology toggled sub-step at t_sw = tPrev + alpha*dt)
      let hasPreSwitchSolution = false;
      if (
        k > 0 &&
        switchedBusInterpolation.size > 0 &&
        this.enableSwitchingInterpolation &&
        prevTopoKey !== "" &&
        prevTopoKey !== topoKey
      ) {
        const prevEntry = this.luCache.get(prevTopoKey);
        if (prevEntry) {
          this.assembleDynamicInjections(t, k, false, anyFaultActive, mmcRuntimeStates);
          this.solveWithCachedLu(prevEntry, this.J3, vPreStep3);
          hasPreSwitchSolution = true;

          // Average sub-step switching fraction alpha across active switching events on step k
          let alphaSum = 0.0;
          let alphaCnt = 0;
          for (const a of switchedBusInterpolation.values()) {
            alphaSum += a;
            alphaCnt++;
          }
          const alphaSw = alphaCnt > 0 ? alphaSum / alphaCnt : 0.5;
          const tSw = t - (1.0 - alphaSw) * this.timeStepSec;

          // Interpolate network node voltages at t_sw = (1 - alpha)*t_{k-1} + alpha*t_k
          for (let i = 0; i < n; i++) {
            this.v3Step[3 * i + 0] = (1.0 - alphaSw) * vaPrevStep[i]! + alphaSw * vPreStep3[3 * i + 0]!;
            this.v3Step[3 * i + 1] = (1.0 - alphaSw) * vbPrevStep[i]! + alphaSw * vPreStep3[3 * i + 1]!;
            this.v3Step[3 * i + 2] = (1.0 - alphaSw) * vcPrevStep[i]! + alphaSw * vPreStep3[3 * i + 2]!;
          }

          // Roll companion branch histories smoothly to the switching instant t_sw
          for (const br of this.companionBranches) {
            const [dvA, dvB, dvC] = this.computeCompanionDrop(br, true);
            const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
            const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
            const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
            const iHistSwA =
              br.alphaHist * curA +
              br.alphaMutHist * (curB + curC) +
              br.vCoeffHist * (br.gEq * dvA + br.gMut * (dvB + dvC));
            const iHistSwB =
              br.alphaHist * curB +
              br.alphaMutHist * (curA + curC) +
              br.vCoeffHist * (br.gEq * dvB + br.gMut * (dvA + dvC));
            const iHistSwC =
              br.alphaHist * curC +
              br.alphaMutHist * (curA + curB) +
              br.vCoeffHist * (br.gEq * dvC + br.gMut * (dvA + dvB));
            br.iHistA = (1.0 - alphaSw) * br.iHistA + alphaSw * iHistSwA;
            br.iHistB = (1.0 - alphaSw) * br.iHistB + alphaSw * iHistSwB;
            br.iHistC = (1.0 - alphaSw) * br.iHistC + alphaSw * iHistSwC;
          }

          // Half-step resynchronization injection at t_sw -> t_k
          this.assembleDynamicInjections(tSw, k, false, anyFaultActive, mmcRuntimeStates);
        }
      }

      // 4b. Assemble 3-phase injection currents J3 at t_k and advance main-step sources/lines
      this.assembleDynamicInjections(t, k, true, anyFaultActive, mmcRuntimeStates);

      // 5. Solve coupled 3N x 3N post-switch linear system via forward/backward substitution
      this.solveFromLU3Phase(this.LU3, this.piv3, this.J3, this.v3Step);

      // 5b. Coupled Multi-Port Non-linear Thévenin Newton-Raphson Compensation for Surge Arresters (MOVs)
      if (arrM > 0 && v0Step && arrV0 && arrCurr && arrRes && arrDelta && arrJac) {
        let anyConducting = false;
        for (let a = 0; a < nArr; a++) {
          const arr = this.surgeArresters[a]!;
          for (let p = 0; p < 3; p++) {
            const row = a * 3 + p;
            const u = arr.fromIdx >= 0 ? 3 * arr.fromIdx + p : -1;
            const v = arr.toIdx >= 0 ? 3 * arr.toIdx + p : -1;
            const vOpen = (u >= 0 ? this.v3Step[u]! : 0.0) - (v >= 0 ? this.v3Step[v]! : 0.0);
            arrV0[row] = vOpen;
            if (Math.abs(vOpen) > arr.vRefVolts) {
              anyConducting = true;
              arrCurr[row] =
                Math.sign(vOpen) * ((Math.abs(vOpen) - arr.vRefVolts) / (arr.zThPhase[p]! + arr.rClampOhm));
            } else {
              arrCurr[row] = 0.0;
            }
          }
        }

        if (anyConducting) {
          v0Step.set(this.v3Step);
          const Z = this.zArresterPorts;
          for (let iter = 0; iter < 12; iter++) {
            let maxRes = 0.0;
            for (let row = 0; row < arrM; row++) {
              const arr = this.surgeArresters[Math.floor(row / 3)]!;
              let zI = 0.0;
              const zRowOff = row * arrM;
              for (let col = 0; col < arrM; col++) {
                zI += Z[zRowOff + col]! * arrCurr[col]!;
              }
              const vPort = arrV0[row]! - zI;
              const vAbs = Math.abs(vPort);
              let iTarget = 0.0;
              let gSlope = 0.0;
              if (vAbs > 0.5 * arr.vRefVolts) {
                const ratio = Math.min(vAbs / Math.max(1.0, arr.vRefVolts), 2.0);
                const q = 22.0;
                const iRefA = 500.0;
                const iPow = iRefA * Math.pow(ratio, q);
                const gPow = (q * iPow) / Math.max(1.0, vAbs);
                const excessV = Math.max(0.0, vAbs - arr.vRefVolts);
                const gLin = excessV > 0 ? 1.0 / arr.rClampOhm : 0.0;
                gSlope = gPow + gLin;
                iTarget = Math.sign(vPort) * (iPow + excessV * gLin);
              }
              const rVal = arrCurr[row]! - iTarget;
              arrRes[row] = -rVal;
              if (Math.abs(rVal) > maxRes) maxRes = Math.abs(rVal);
              for (let col = 0; col < arrM; col++) {
                arrJac[zRowOff + col] = (row === col ? 1.0 : 0.0) + gSlope * Z[zRowOff + col]!;
              }
            }
            if (maxRes < 1e-4) break;
            this.coupledNonlinearIterationsCount++;
            if (!this.solveSmallDenseSystem(arrJac, arrRes, arrDelta, arrM)) break;
            for (let row = 0; row < arrM; row++) {
              arrCurr[row] = arrCurr[row]! + arrDelta[row]!;
            }
          }

          for (let a = 0; a < nArr; a++) {
            const arr = this.surgeArresters[a]!;
            for (let p = 0; p < 3; p++) {
              const row = a * 3 + p;
              const iCorr = arrCurr[row]!;
              if (Math.abs(iCorr) <= 1e-12) continue;
              const xTh = arr.xThPhase[p]!;
              for (let j = 0; j < this.nPhaseNodes; j++) {
                this.v3Step[j] = this.v3Step[j]! - xTh[j]! * iCorr;
              }
              let zI = 0.0;
              const zRowOff = row * arrM;
              for (let col = 0; col < arrM; col++) zI += Z[zRowOff + col]! * arrCurr[col]!;
              const vClamped = arrV0[row]! - zI;
              arr.energyJoules += Math.abs(vClamped * iCorr) * this.timeStepSec;
            }
          }
        }
      }

      for (let i = 0; i < n; i++) {
        let va = this.v3Step[3 * i + 0]!;
        let vb = this.v3Step[3 * i + 1]!;
        let vc = this.v3Step[3 * i + 2]!;
        const swAlpha = k > 0 ? switchedBusInterpolation.get(i) : undefined;
        if (swAlpha !== undefined && this.enableSwitchingInterpolation) {
          if (hasPreSwitchSolution) {
            va = swAlpha * vPreStep3[3 * i + 0]! + (1.0 - swAlpha) * va;
            vb = swAlpha * vPreStep3[3 * i + 1]! + (1.0 - swAlpha) * vb;
            vc = swAlpha * vPreStep3[3 * i + 2]! + (1.0 - swAlpha) * vc;
          } else {
            va = swAlpha * vaPrevStep[i]! + (1.0 - swAlpha) * va;
            vb = swAlpha * vbPrevStep[i]! + (1.0 - swAlpha) * vb;
            vc = swAlpha * vcPrevStep[i]! + (1.0 - swAlpha) * vc;
          }
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
        const [dvA, dvB, dvC] = this.computeCompanionDrop(br);

        const curA = br.gEq * dvA + br.gMut * (dvB + dvC) + br.iHistA;
        const curB = br.gEq * dvB + br.gMut * (dvA + dvC) + br.iHistB;
        const curC = br.gEq * dvC + br.gMut * (dvA + dvB) + br.iHistC;
        br.ia[k] = curA;
        br.ib[k] = curB;
        br.ic[k] = curC;

        const interpAlpha = switchedBusInterpolation.get(br.fromIdx) ?? switchedBusInterpolation.get(br.toIdx);
        const iHistBeA = br.vCoeffHist < 0 ? -br.gEq * (dvA - br.rOhm * curA) : br.alphaBe * curA;
        const iHistBeB = br.vCoeffHist < 0 ? -br.gEq * (dvB - br.rOhm * curB) : br.alphaBe * curB;
        const iHistBeC = br.vCoeffHist < 0 ? -br.gEq * (dvC - br.rOhm * curC) : br.alphaBe * curC;

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

      for (const nu of this.nUlmLines) {
        nu.vK.fill(0);
        nu.vM.fill(0);
        if (nu.fromIdx >= 0) {
          nu.vK[0] = this.vaStep[nu.fromIdx]!;
          if (nu.model.nCond > 1) nu.vK[1] = this.vbStep[nu.fromIdx]!;
          if (nu.model.nCond > 2) nu.vK[2] = this.vcStep[nu.fromIdx]!;
        }
        if (nu.toIdx >= 0) {
          nu.vM[0] = this.vaStep[nu.toIdx]!;
          if (nu.model.nCond > 1) nu.vM[1] = this.vbStep[nu.toIdx]!;
          if (nu.model.nCond > 2) nu.vM[2] = this.vcStep[nu.toIdx]!;
        }
        const n = nu.model.nCond;
        let curA = nu.model.iHistK[0] ?? 0;
        let curB = n > 1 ? (nu.model.iHistK[1] ?? 0) : 0;
        let curC = n > 2 ? (nu.model.iHistK[2] ?? 0) : 0;
        for (let c = 0; c < n; c++) {
          curA += (nu.model.gEq[0 * n + c] ?? 0) * nu.vK[c]!;
          if (n > 1) curB += (nu.model.gEq[1 * n + c] ?? 0) * nu.vK[c]!;
          if (n > 2) curC += (nu.model.gEq[2 * n + c] ?? 0) * nu.vK[c]!;
        }
        const curBufs = this.branchPhaseCurrents.get(nu.id);
        if (curBufs) {
          curBufs.a[k] = curA;
          curBufs.b[k] = curB;
          curBufs.c[k] = curC;
        }
        stepNConductorUlm(nu.model, nu.vK, nu.vM, true);
      }

      // 6c. Update Park dq0 synchronous generator states (rotor swing equation d(delta)/dt, d(omega)/dt)
      for (const sg of this.syncGenerators) {
        const thetaE = sg.omega0 * t + sg.deltaRad;
        const ea = sg.vPeak * (sg.eqSubPu * Math.sin(thetaE) + sg.edSubPu * Math.cos(thetaE));
        const eb =
          sg.vPeak *
          (sg.eqSubPu * Math.sin(thetaE - (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE - (2 * Math.PI) / 3));
        const ec =
          sg.vPeak *
          (sg.eqSubPu * Math.sin(thetaE + (2 * Math.PI) / 3) + sg.edSubPu * Math.cos(thetaE + (2 * Math.PI) / 3));

        const va = this.vaStep[sg.busIdx]!;
        const vb = this.vbStep[sg.busIdx]!;
        const vc = this.vcStep[sg.busIdx]!;

        const diffA = ea - va;
        const diffB = eb - vb;
        const diffC = ec - vc;
        const ia = sg.gGen * diffA + sg.iHistA;
        const ib = sg.gGen * diffB + sg.iHistB;
        const ic = sg.gGen * diffC + sg.iHistC;
        sg.iHistA = sg.alphaGen * ia + sg.gGen * diffA;
        sg.iHistB = sg.alphaGen * ib + sg.gGen * diffB;
        sg.iHistC = sg.alphaGen * ic + sg.gGen * diffC;
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

        // 6th-order dq0 rotor flux ODEs (transient & subtransient time constants)
        const td0p = 5.0;
        const td0pp = 0.035;
        const tq0p = 0.8;
        const tq0pp = 0.045;
        const dEqPrime = (sg.efPu - sg.eqPrimePu - (sg.xdPu - sg.xdPrimePu) * id) / td0p;
        const dEdPrime = (-sg.edPrimePu + (sg.xqPu - sg.xqPrimePu) * iq) / tq0p;
        sg.eqPrimePu += this.timeStepSec * dEqPrime;
        sg.edPrimePu += this.timeStepSec * dEdPrime;
        const dEqSub = (sg.eqPrimePu - sg.eqSubPu - (sg.xdPrimePu - sg.xdSubPu) * id) / td0pp;
        const dEdSub = (sg.edPrimePu - sg.edSubPu + (sg.xqPrimePu - sg.xqSubPu) * iq) / tq0pp;
        sg.eqSubPu += this.timeStepSec * dEqSub;
        sg.edSubPu += this.timeStepSec * dEdSub;

        // Wire closed-loop CSMF EF / TM ports & export w/delta/Pe signals if csmfEvaluator is active
        if (this.csmfEvaluator) {
          if (sg.efSignal) {
            sg.efPu = Math.max(0.05, Math.min(6.0, this.csmfEvaluator.getSignal(sg.efSignal)));
          }
          if (sg.tmSignal) {
            sg.pmPu = Math.max(-1.5, Math.min(2.0, this.csmfEvaluator.getSignal(sg.tmSignal)));
          }
          this.csmfEvaluator.setSignal(`${sg.id}_w`, sg.omegaRadSec / sg.omega0);
          this.csmfEvaluator.setSignal(`${sg.id}_delta`, sg.deltaRad);
          this.csmfEvaluator.setSignal(`${sg.id}_Pe`, pePu);
        }

        const speedPu = sg.omegaRadSec / sg.omega0;
        const tePu = pePu / Math.max(0.2, speedPu);

        if (sg.torsionalMasses && sg.torsionalMasses.length >= 2) {
          // Coupled N-mass spring-mass torsional shaft (mass N-1 is generator rotor)
          const masses = sg.torsionalMasses;
          const mCount = masses.length;
          const dt = this.timeStepSec;
          for (let j = 0; j < mCount; j++) {
            const m = masses[j]!;
            const prev = j > 0 ? masses[j - 1]! : undefined;
            const next = j < mCount - 1 ? masses[j + 1]! : undefined;
            const tmStage = j === mCount - 1 ? 0.0 : sg.pmPu * m.torqueFraction;
            const teStage = j === mCount - 1 ? tePu : 0.0;
            const springLeft = prev ? prev.kShaftPuPerRad * (m.deltaRad - prev.deltaRad) : 0.0;
            const springRight = next ? m.kShaftPuPerRad * (next.deltaRad - m.deltaRad) : 0.0;
            const dampLeft = prev ? prev.dampingMutualPu * ((m.omegaRadSec - prev.omegaRadSec) / sg.omega0) : 0.0;
            const dampRight = next ? m.dampingMutualPu * ((next.omegaRadSec - m.omegaRadSec) / sg.omega0) : 0.0;
            const selfDamp = m.dampingPu * ((m.omegaRadSec - sg.omega0) / sg.omega0);
            const netTorque = tmStage - teStage - selfDamp - springLeft + springRight - dampLeft + dampRight;
            const dOmega = (sg.omega0 / (2.0 * m.hInertiaSec)) * netTorque;
            const omegaNext = m.omegaRadSec + dt * dOmega;
            m.deltaRad += dt * 0.5 * (m.omegaRadSec - sg.omega0 + (omegaNext - sg.omega0));
            m.omegaRadSec = omegaNext;
            m.torqueTraj[k] = springRight + springLeft;
            m.speedTraj[k] = m.omegaRadSec / sg.omega0;
          }
          const genMass = masses[mCount - 1]!;
          sg.deltaRad = genMass.deltaRad;
          sg.omegaRadSec = genMass.omegaRadSec;
        } else {
          // Single-mass swing equation:
          // d(delta)/dt = omega - omega0
          // 2H * d(omega/omega0)/dt = Pm - Pe - D * (omega - omega0) / omega0
          const slipPu = (sg.omegaRadSec - sg.omega0) / sg.omega0;
          const dOmegaDt = (sg.omega0 / (2.0 * sg.hSec)) * (sg.pmPu - tePu - sg.dampingPu * slipPu);
          const omegaNext = sg.omegaRadSec + this.timeStepSec * dOmegaDt;
          sg.deltaRad += this.timeStepSec * 0.5 * (sg.omegaRadSec - sg.omega0 + (omegaNext - sg.omega0));
          sg.omegaRadSec = omegaNext;
        }
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
        const vaInst = this.vaStep[busIdx]!;
        const vbInst = this.vbStep[busIdx]!;
        const vcInst = this.vcStep[busIdx]!;
        if (fmuState.companion) {
          fmuState.companion.doStep(t, this.timeStepSec, [vaInst, vbInst, vcInst]);
          const g = fmuState.lastGEq!;
          const ih = fmuState.lastIHist!;
          ia[k] = ih[0]! - (g[0]! * vaInst + g[1]! * vbInst + g[2]! * vcInst);
          ib[k] = ih[1]! - (g[3]! * vaInst + g[4]! * vbInst + g[5]! * vcInst);
          ic[k] = ih[2]! - (g[6]! * vaInst + g[7]! * vbInst + g[8]! * vcInst);
          continue;
        }
        const vNomPeak = this.busList[busIdx]!.vPeak;
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

      // 9. Closed-loop protection relay evaluation (sliding DFT phasors, saturable CT, Mho/Quad 21, 87T 2nd-harmonic block, 67 directional, 81U/O/R) & breaker trip actuation
      const relayFreqHz = this.omega / (2 * Math.PI);
      for (const rs of relayRuntimeStates) {
        const { relay } = rs;
        const bIdx = this.busIdxMap.get(relay.monitoredBus) ?? 0;
        const va = this.vaStep[bIdx] ?? 0.0;
        const vb = this.vbStep[bIdx] ?? 0.0;
        const vc = this.vcStep[bIdx] ?? 0.0;
        const vPeakInst = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
        const vNomPeak = this.busList[bIdx]?.vPeak || 230e3;

        const brCur =
          (relay.monitoredBranch ? this.branchPhaseCurrents.get(relay.monitoredBranch) : undefined) ??
          (relay.tripBreakerId ? this.branchPhaseCurrents.get(relay.tripBreakerId) : undefined) ??
          this.branchPhaseCurrents.values().next().value;
        const iaBr = brCur ? brCur.a[k]! : 0.0;
        const ibBr = brCur ? brCur.b[k]! : 0.0;
        const icBr = brCur ? brCur.c[k]! : 0.0;

        // Optional saturable CT nonlinear core flux integration (backward Euler + guarded Newton-bisection)
        let iaMeas = iaBr;
        if (relay.ctKneeFluxVs !== undefined && relay.ctKneeFluxVs > 0.0) {
          const psiK = relay.ctKneeFluxVs;
          const rb = Math.max(0.2, relay.ctBurdenOhm ?? 2.0);
          const dtRb = Math.max(1e-9, this.timeStepSec * rb);
          const iKexc = Math.max(2.0, 0.01 * (relay.pickupCurrentA ?? 400.0));
          const psiOld = rs.ctFluxVs;
          const evalCtRes = (psi: number): number => {
            const u = psi / psiK;
            const u6 = u * u * u * u * u * u;
            const im = iKexc * (u + u * u6);
            return psi - psiOld - dtRb * (iaBr - im);
          };
          const evalCtDeriv = (psi: number): number => {
            const u = psi / psiK;
            const u6 = u * u * u * u * u * u;
            return 1.0 + ((dtRb * iKexc) / psiK) * (1.0 + 7.0 * u6);
          };
          const psiUnclamped = psiOld + dtRb * iaBr;
          let lo = Math.min(psiOld, psiUnclamped, -2.5 * psiK);
          let hi = Math.max(psiOld, psiUnclamped, 2.5 * psiK);
          for (let ex = 0; ex < 4 && evalCtRes(lo) > 0; ex++) lo *= 2.0;
          for (let ex = 0; ex < 4 && evalCtRes(hi) < 0; ex++) hi *= 2.0;
          let psi = Math.min(hi, Math.max(lo, psiOld));
          for (let it = 0; it < 8; it++) {
            const fVal = evalCtRes(psi);
            if (Math.abs(fVal) < 1e-11 * Math.max(1.0, psiK)) break;
            if (fVal < 0) lo = Math.max(lo, psi);
            else hi = Math.min(hi, psi);
            const cand = psi - fVal / evalCtDeriv(psi);
            psi = cand > lo && cand < hi ? cand : 0.5 * (lo + hi);
          }
          rs.ctFluxVs = psi;
          iaMeas = (psi - psiOld) / dtRb;
        }

        const secCur = relay.secondaryBranch ? this.branchPhaseCurrents.get(relay.secondaryBranch) : undefined;
        const secIa = secCur ? secCur.a[k]! : 0.0;

        // Sliding DFT ring buffer update
        const theta1 = this.omega * t;
        const cos1 = Math.cos(theta1);
        const sin1 = Math.sin(theta1);
        const cos2 = 2.0 * cos1 * cos1 - 1.0;
        const sin2 = 2.0 * sin1 * cos1;

        rs.vaBuf[rs.dftIdx] = va;
        rs.iaBuf[rs.dftIdx] = iaMeas;
        rs.secIaBuf[rs.dftIdx] = secIa;
        rs.cos1Buf[rs.dftIdx] = cos1;
        rs.sin1Buf[rs.dftIdx] = sin1;
        rs.cos2Buf[rs.dftIdx] = cos2;
        rs.sin2Buf[rs.dftIdx] = sin2;
        rs.dftIdx = (rs.dftIdx + 1) % rs.nCyc;
        rs.sampleCount++;

        const nHalf = Math.max(4, rs.nCyc >> 1);
        let v1Re = 0.0;
        let v1Im = 0.0;
        let i1Re = 0.0;
        let i1Im = 0.0;
        let i1H2Mag = 0.0;
        let i2Re = 0.0;
        let i2Im = 0.0;

        if (rs.sampleCount >= nHalf) {
          const winLen = rs.sampleCount >= rs.nCyc ? rs.nCyc : nHalf;
          let sumVRe = 0.0;
          let sumVIm = 0.0;
          let sumI1Re = 0.0;
          let sumI1Im = 0.0;
          let sumI1H2Re = 0.0;
          let sumI1H2Im = 0.0;
          let sumI2Re = 0.0;
          let sumI2Im = 0.0;
          for (let j = 0; j < winLen; j++) {
            const idx = (rs.dftIdx - 1 - j + rs.nCyc) % rs.nCyc;
            const c1 = rs.cos1Buf[idx]!;
            const s1 = rs.sin1Buf[idx]!;
            const vx = rs.vaBuf[idx]!;
            const ix = rs.iaBuf[idx]!;
            sumVRe += vx * c1;
            sumVIm -= vx * s1;
            sumI1Re += ix * c1;
            sumI1Im -= ix * s1;
            if (secCur) {
              const sx = rs.secIaBuf[idx]!;
              sumI2Re += sx * c1;
              sumI2Im -= sx * s1;
            }
            if (rs.sampleCount >= rs.nCyc) {
              const c2 = rs.cos2Buf[idx]!;
              const s2 = rs.sin2Buf[idx]!;
              sumI1H2Re += ix * c2;
              sumI1H2Im -= ix * s2;
            }
          }
          const scale = 2.0 / winLen;
          v1Re = sumVRe * scale;
          v1Im = sumVIm * scale;
          i1Re = sumI1Re * scale;
          i1Im = sumI1Im * scale;
          i2Re = sumI2Re * scale;
          i2Im = sumI2Im * scale;
          if (rs.sampleCount >= rs.nCyc) {
            i1H2Mag = Math.hypot(sumI1H2Re * scale, sumI1H2Im * scale);
          }
        } else {
          // Sub-half-cycle orthogonal derivative phasor estimate
          const invOmegaDt = 1.0 / Math.max(1e-9, this.omega * this.timeStepSec);
          const dv = k > 0 ? (va - rs.prevVa) * invOmegaDt : 0.0;
          const di = k > 0 ? (iaMeas - rs.prevIa) * invOmegaDt : 0.0;
          v1Re = va * cos1 - dv * sin1;
          v1Im = -va * sin1 - dv * cos1;
          i1Re = iaMeas * cos1 - di * sin1;
          i1Im = -iaMeas * sin1 - di * cos1;
          if (secCur) {
            const ds = k > 0 ? (secIa - rs.prevSecIa) * invOmegaDt : 0.0;
            i2Re = secIa * cos1 - ds * sin1;
            i2Im = -secIa * sin1 - ds * cos1;
          }
        }
        rs.prevVa = va;
        rs.prevIa = iaMeas;
        rs.prevSecIa = secIa;

        const v1Mag = Math.hypot(v1Re, v1Im);
        const i1Mag = Math.hypot(i1Re, i1Im);
        const iPeak3Ph = Math.sqrt((2.0 / 3.0) * (iaMeas * iaMeas + ibBr * ibBr + icBr * icBr));
        const effV = rs.sampleCount >= nHalf ? v1Mag : vPeakInst;
        const effI = rs.sampleCount >= nHalf ? i1Mag : Math.max(i1Mag, iPeak3Ph);

        // Update memory-polarized voltage phasor while healthy voltage exists
        if (v1Mag > 0.15 * vNomPeak) {
          const alphaMem = Math.min(0.25, this.timeStepSec / 0.08);
          rs.vMemRe += alphaMem * (v1Re - rs.vMemRe);
          rs.vMemIm += alphaMem * (v1Im - rs.vMemIm);
        }
        const vPolRe = 0.75 * v1Re + 0.25 * rs.vMemRe;
        const vPolIm = 0.75 * v1Im + 0.25 * rs.vMemIm;

        // Track DFT frequency and ROCOF from voltage phasor rotation
        if (v1Mag > 0.05 * vNomPeak && rs.sampleCount >= nHalf) {
          const vAng = Math.atan2(v1Im, v1Re);
          if (rs.sampleCount > nHalf) {
            let dAng = vAng - rs.prevZAngleRad;
            while (dAng > Math.PI) dAng -= 2.0 * Math.PI;
            while (dAng < -Math.PI) dAng += 2.0 * Math.PI;
            const instFreqHz = relayFreqHz + dAng / (2.0 * Math.PI * Math.max(1e-9, this.timeStepSec));
            const alphaF = Math.min(0.2, this.timeStepSec / 0.015);
            const prevSmoothF = rs.freqEstHz;
            rs.freqEstHz += alphaF * (instFreqHz - rs.freqEstHz);
            const instRocof = (rs.freqEstHz - prevSmoothF) / Math.max(1e-9, this.timeStepSec);
            const alphaR = Math.min(0.15, this.timeStepSec / 0.03);
            rs.smoothRocofHzPerSec += alphaR * (instRocof - rs.smoothRocofHzPerSec);
          }
          rs.prevZAngleRad = vAng;
        }

        // Apparent complex impedance Z_app = V1 / I1
        const iDenomSq = i1Re * i1Re + i1Im * i1Im;
        const zAppRe = iDenomSq > 1e-4 ? (v1Re * i1Re + v1Im * i1Im) / iDenomSq : 1e6;
        const zAppIm = iDenomSq > 1e-4 ? (v1Im * i1Re - v1Re * i1Im) / iDenomSq : 0.0;
        const zAppOhm = effV / Math.max(effI, 1e-3);
        rs.zAppTraj[k] = zAppOhm;

        if (!rs.tripped) {
          let pickup = false;
          let tripDelaySec = 0.0;
          if (relay.ansiCode === "21") {
            const z1 = relay.zone1ReachOhm ?? 15.0;
            const z2 = relay.zone2ReachOhm ?? 1.2 * z1;
            const z3 = relay.zone3ReachOhm ?? 1.8 * z1;
            const thetaRad = ((relay.lineAngleDeg ?? 75.0) * Math.PI) / 180.0;
            const cTh = Math.cos(thetaRad);
            const sTh = Math.sin(thetaRad);
            const inZone = (reach: number): boolean => {
              if (effI <= 5.0) return false;
              if (relay.characteristic === "quadrilateral") {
                return (
                  zAppIm >= -0.05 * reach &&
                  zAppIm <= reach * sTh &&
                  zAppRe >= -0.1 * reach &&
                  zAppRe <= reach * (Math.abs(cTh) + 0.5)
                );
              }
              // Memory-polarized Mho comparator: Re((Z_reach * I1 - V1) * conj(V_pol)) >= 0
              const zrRe = reach * cTh;
              const zrIm = reach * sTh;
              const opRe = zrRe * i1Re - zrIm * i1Im - v1Re;
              const opIm = zrRe * i1Im + zrIm * i1Re - v1Im;
              const vPolMagSq = vPolRe * vPolRe + vPolIm * vPolIm;
              if (vPolMagSq > 1.0 && rs.sampleCount >= nHalf) {
                return opRe * vPolRe + opIm * vPolIm >= 0.0;
              }
              return zAppOhm <= reach;
            };
            if (inZone(z1)) {
              pickup = true;
              tripDelaySec = 0.0;
            } else if (inZone(z2)) {
              pickup = true;
              tripDelaySec = 0.25;
            } else if (inZone(z3)) {
              pickup = true;
              tripDelaySec = 0.6;
            }
          } else if (relay.ansiCode === "50") {
            pickup = effI >= (relay.pickupCurrentA ?? 500.0);
            tripDelaySec = 0.0;
          } else if (relay.ansiCode === "51" || relay.ansiCode === "67") {
            const iPick = relay.pickupCurrentA ?? 200.0;
            let forwardOk = true;
            if (relay.ansiCode === "67" && rs.sampleCount >= nHalf) {
              const mtaRad = ((relay.mtaDeg ?? -(relay.lineAngleDeg ?? 60.0)) * Math.PI) / 180.0;
              const refRe = vPolRe * Math.cos(mtaRad) - vPolIm * Math.sin(mtaRad);
              const refIm = vPolRe * Math.sin(mtaRad) + vPolIm * Math.cos(mtaRad);
              forwardOk = i1Re * refRe + i1Im * refIm > 0.0;
            }
            if (forwardOk && effI >= iPick) {
              pickup = true;
              const mult = Math.max(1.05, effI / Math.max(1e-3, iPick));
              tripDelaySec = (0.14 * (relay.timeDialSetting ?? 0.5)) / (Math.pow(mult, 0.02) - 1.0);
            }
          } else if (relay.ansiCode === "87T" || relay.ansiCode === "87L") {
            const iPick = relay.pickupCurrentA ?? 100.0;
            const harm2PctLimit = relay.secondHarmonicBlockPercent ?? 15.0;
            const i2HarmRatioPct = rs.sampleCount >= rs.nCyc && i1Mag > 1e-3 ? (100.0 * i1H2Mag) / i1Mag : 0.0;
            const inrushBlocked = rs.sampleCount >= rs.nCyc && i2HarmRatioPct >= harm2PctLimit;
            if (!inrushBlocked) {
              if (secCur) {
                const iDiff = Math.hypot(i1Re - i2Re, i1Im - i2Im);
                const i2Mag = Math.hypot(i2Re, i2Im);
                const iRst = 0.5 * (i1Mag + i2Mag);
                const s1 = (relay.slope1Percent ?? 25.0) / 100.0;
                const s2 = (relay.slope2Percent ?? 50.0) / 100.0;
                const iKnee = 3.0 * iPick;
                const slopeThresh = iRst <= iKnee ? s1 * iRst : s1 * iKnee + s2 * (iRst - iKnee);
                pickup = iDiff >= Math.max(iPick, slopeThresh);
              } else {
                pickup = effI >= iPick;
              }
            }
            tripDelaySec = relay.ansiCode === "87T" ? 1.0 / Math.max(1.0, relayFreqHz) : 0.0;
          } else if (relay.ansiCode === "27") {
            pickup = effV < 0.8 * vNomPeak;
            tripDelaySec = 0.02;
          } else if (relay.ansiCode === "59") {
            pickup = effV > 1.2 * vNomPeak;
            tripDelaySec = 0.02;
          } else if (relay.ansiCode === "81U" || relay.ansiCode === "81O" || relay.ansiCode === "81R") {
            const gen0 = this.syncGenerators[0];
            const fHz = gen0 ? gen0.omegaRadSec / (2 * Math.PI) : rs.freqEstHz;
            if (relay.ansiCode === "81R") {
              pickup =
                (rs.sampleCount >= rs.nCyc && Math.abs(rs.smoothRocofHzPerSec) > 1.5) ||
                Math.abs(fHz - relayFreqHz) > 0.5;
            } else if (relay.ansiCode === "81O") {
              pickup = fHz > relayFreqHz + 0.5;
            } else {
              pickup = fHz < relayFreqHz - 0.5;
            }
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

      // 10. Step 6-arm 3-phase Detailed Equivalent Model (DEM) MMC with NLM & CCSC
      for (const ms of mmcRuntimeStates) {
        const { nSm, vDcKv, cSmFarad, vCapUpper, vCapLower, lArmH, iCirc } = ms;
        const dt = this.timeStepSec;
        const mMod: [number, number, number] = [
          0.85 * Math.sin(this.omega * t),
          0.85 * Math.sin(this.omega * t - (2 * Math.PI) / 3),
          0.85 * Math.sin(this.omega * t + (2 * Math.PI) / 3),
        ];
        const vBusPh: [number, number, number] =
          ms.busIdx !== undefined
            ? [this.vaStep[ms.busIdx] ?? 0, this.vbStep[ms.busIdx] ?? 0, this.vcStep[ms.busIdx] ?? 0]
            : [0, 0, 0];
        const vAcPrev: [number, number, number] = [ms.vAcA, ms.vAcB, ms.vAcC];
        const vAcOut: [number, number, number] = [0, 0, 0];

        let sumUpperA = 0.0;
        let sumLowerA = 0.0;
        let vMin = Infinity;
        let vMax = -Infinity;

        for (let p = 0; p < 3; p++) {
          const capUp = vCapUpper[p]!;
          const capLo = vCapLower[p]!;
          // CCSC (Circulating Current Suppressing Control): damp 2nd-harmonic common-mode arm current
          const vDiffCcsc = -0.25 * ms.lArmH * this.omega * iCirc[p]!;
          const mCcsc = vDcKv > 0 ? Math.max(-0.08, Math.min(0.08, vDiffCcsc / (0.5 * vDcKv * 1e3))) : 0;
          const nUpper = Math.max(0, Math.min(nSm, Math.round(0.5 * nSm * (1.0 - mMod[p]! - mCcsc))));
          const nLower = Math.max(0, Math.min(nSm, Math.round(0.5 * nSm * (1.0 + mMod[p]! - mCcsc))));

          const iPhaseAc =
            ms.busIdx !== undefined
              ? ms.gArm * (vAcPrev[p]! - vBusPh[p]!)
              : 400.0 * Math.sin(this.omega * t - (p * 2 * Math.PI) / 3 - 0.15);
          const iUpperAmp = 0.5 * iPhaseAc + iCirc[p]!;
          const iLowerAmp = -0.5 * iPhaseAc + iCirc[p]!;

          const upperIdx = Array.from({ length: nSm }, (_, i) => i).sort((a, b) =>
            iUpperAmp >= 0 ? capUp[a]! - capUp[b]! : capUp[b]! - capUp[a]!,
          );
          const lowerIdx = Array.from({ length: nSm }, (_, i) => i).sort((a, b) =>
            iLowerAmp >= 0 ? capLo[a]! - capLo[b]! : capLo[b]! - capLo[a]!,
          );

          const dvUpKv = ((iUpperAmp * dt) / cSmFarad) * 1e-3;
          const dvLoKv = ((iLowerAmp * dt) / cSmFarad) * 1e-3;
          let insertedUpperKv = 0;
          let insertedLowerKv = 0;
          for (let m = 0; m < nUpper; m++) {
            const idx = upperIdx[m]!;
            capUp[idx] = Math.max(0.1, capUp[idx]! + dvUpKv);
            insertedUpperKv += capUp[idx]!;
          }
          for (let m = 0; m < nLower; m++) {
            const idx = lowerIdx[m]!;
            capLo[idx] = Math.max(0.1, capLo[idx]! + dvLoKv);
            insertedLowerKv += capLo[idx]!;
          }
          vAcOut[p] = 0.5 * (insertedLowerKv - insertedUpperKv) * 1e3;

          // Common-mode circulating current ODE: L_arm * d(i_circ)/dt = 0.5*(V_dc - V_up - V_lo) - R_arm*i_circ
          const vCircDrive = 0.5 * (vDcKv - insertedUpperKv - insertedLowerKv) * 1e3;
          const rArm = Math.max(0.02, 0.05 * lArmH * this.omega);
          iCirc[p] = (iCirc[p]! + (dt / lArmH) * vCircDrive) / (1.0 + (rArm * dt) / lArmH);

          if (p === 0) {
            for (let i = 0; i < nSm; i++) {
              const vu = capUp[i]!;
              const vl = capLo[i]!;
              sumUpperA += vu;
              sumLowerA += vl;
              if (vu < vMin) vMin = vu;
              if (vu > vMax) vMax = vu;
            }
          }
        }

        ms.vAcA = vAcOut[0];
        ms.vAcB = vAcOut[1];
        ms.vAcC = vAcOut[2];
        ms.upperSumTraj[k] = sumUpperA;
        ms.lowerSumTraj[k] = sumLowerA;
        ms.spreadPctTraj[k] = vDcKv > 0 ? ((vMax - vMin) / (vDcKv / nSm)) * 100.0 : 0.0;
        ms.iCircATraj[k] = iCirc[0];
      }

      // 10b. Step switched VSC PWM & 6-pulse LCC converter bridges (with overlap/extinction & DC-link dynamics)
      for (const br of this.bridgeRuntimeStates) {
        const dt = this.timeStepSec;
        const va = this.vaStep[br.acBusIdx] ?? 0;
        const vb = this.vbStep[br.acBusIdx] ?? 0;
        const vc = this.vcStep[br.acBusIdx] ?? 0;
        const SQRT3 = Math.sqrt(3.0);
        const vAlpha = (2.0 * va - vb - vc) / 3.0;
        const vBeta = (vb - vc) / SQRT3;
        const vMag = Math.hypot(vAlpha, vBeta);
        const phase = vMag > 1e-3 ? Math.atan2(vBeta, vAlpha) : this.omega * t;
        br.thetaPll = phase;

        if (br.conv.kind === "lcc_6pulse") {
          const alphaRad = ((br.conv.firingAngleDeg ?? 15.0) * Math.PI) / 180.0;
          const vLlRms =
            vMag > 1e-3 ? (vMag * Math.SQRT2 > 0 ? (vMag * SQRT3) / Math.SQRT2 : 0) : br.conv.ratedKvLL * 1e3;
          const vAcBase = Math.max(10.0, vLlRms);
          const xCommOhm = 0.08 * ((br.conv.ratedKvLL * br.conv.ratedKvLL) / Math.max(1.0, br.conv.ratedMva));
          const vNoLoadDc = ((3.0 * Math.SQRT2) / Math.PI) * vAcBase * Math.cos(alphaRad);
          const vDropComm = ((3.0 * xCommOhm) / Math.PI) * br.iDcAmp;
          const vDcRect = Math.max(0.0, vNoLoadDc - vDropComm);
          const cosAlphaMinusOverlap = Math.max(
            -0.99,
            Math.min(1.0, Math.cos(alphaRad) - (2.0 * xCommOhm * br.iDcAmp) / (Math.SQRT2 * vAcBase)),
          );
          br.muRad = Math.max(0.01, Math.acos(cosAlphaMinusOverlap) - alphaRad);
          br.gammaRad = Math.max(0.0, Math.PI - alphaRad - br.muRad);

          const lDcSmooth = 0.05;
          br.iDcAmp = Math.max(
            0.0,
            (br.iDcAmp + (dt / lDcSmooth) * vDcRect) / (1.0 + (br.rDcLoadOhm * dt) / lDcSmooth),
          );
          br.vDcVolts = vDcRect;
          br.vDcTraj[k] = vDcRect * 1e-3;
          if (br.iDcTraj) br.iDcTraj[k] = br.iDcAmp;
          if (br.muDegTraj) br.muDegTraj[k] = (br.muRad * 180.0) / Math.PI;
          if (br.gammaDegTraj) br.gammaDegTraj[k] = (br.gammaRad * 180.0) / Math.PI;

          // Record actual 6-pulse line currents
          const ia = br.iDcAmp * Math.cos(phase - alphaRad);
          const ib = br.iDcAmp * Math.cos(phase - alphaRad - (2 * Math.PI) / 3);
          const ic = br.iDcAmp * Math.cos(phase - alphaRad + (2 * Math.PI) / 3);
          br.ia[k] = ia;
          br.ib[k] = ib;
          br.ic[k] = ic;
        } else {
          const vDcHalf = 0.5 * Math.max(100.0, br.vDcVolts);
          const vRefD = br.vPeakNom;
          const pRefW = (br.conv.pRefMw ?? br.conv.ratedMva * 0.8) * 1e6;
          const qRefVar = (br.conv.qRefMvar ?? 0.0) * 1e6;
          const idRef = Math.max(-br.iRatedPeak, Math.min(br.iRatedPeak, pRefW / Math.max(1.0, 1.5 * vRefD)));
          const vErrQ = br.vPeakNom > 0 ? (br.vPeakNom - vMag) / br.vPeakNom : 0;
          const iqRef =
            br.conv.controlMode === "pq"
              ? Math.max(-br.iRatedPeak, Math.min(br.iRatedPeak, -qRefVar / Math.max(1.0, 1.5 * vRefD)))
              : Math.max(-0.5 * br.iRatedPeak, Math.min(0.5 * br.iRatedPeak, 2.0 * br.iRatedPeak * vErrQ));

          const sinP = Math.sin(phase);
          const cosP = Math.cos(phase);
          const diffA = br.vPoleA - va;
          const diffB = br.vPoleB - vb;
          const diffC = br.vPoleC - vc;
          const ia = br.gChoke * diffA + br.iHistChokeA;
          const ib = br.gChoke * diffB + br.iHistChokeB;
          const ic = br.gChoke * diffC + br.iHistChokeC;
          br.iHistChokeA = br.alphaChoke * ia + br.gChoke * diffA;
          br.iHistChokeB = br.alphaChoke * ib + br.gChoke * diffB;
          br.iHistChokeC = br.alphaChoke * ic + br.gChoke * diffC;
          br.ia[k] = ia;
          br.ib[k] = ib;
          br.ic[k] = ic;

          const idMeas =
            (2.0 / 3.0) *
            (ia * cosP + ib * Math.cos(phase - (2 * Math.PI) / 3) + ic * Math.cos(phase + (2 * Math.PI) / 3));
          const iqMeas =
            -(2.0 / 3.0) *
            (ia * sinP + ib * Math.sin(phase - (2 * Math.PI) / 3) + ic * Math.sin(phase + (2 * Math.PI) / 3));
          const errD = idRef - idMeas;
          const errQ = iqRef - iqMeas;
          const zAcScale = br.vPeakNom / Math.max(1.0, br.iRatedPeak);
          br.intErrD = Math.max(
            -0.35 * br.vPeakNom,
            Math.min(0.35 * br.vPeakNom, br.intErrD + errD * zAcScale * dt * 25.0),
          );
          br.intErrQ = Math.max(
            -0.35 * br.vPeakNom,
            Math.min(0.35 * br.vPeakNom, br.intErrQ + errQ * zAcScale * dt * 25.0),
          );
          const kp = 0.12 * zAcScale;
          const vdMod = Math.max(-vDcHalf, Math.min(vDcHalf, vMag + kp * errD + br.intErrD));
          const vqMod = Math.max(-vDcHalf, Math.min(vDcHalf, kp * errQ + br.intErrQ));

          const mA = Math.max(-0.98, Math.min(0.98, (vdMod * cosP - vqMod * sinP) / vDcHalf));
          const mB = Math.max(
            -0.98,
            Math.min(
              0.98,
              (vdMod * Math.cos(phase - (2 * Math.PI) / 3) - vqMod * Math.sin(phase - (2 * Math.PI) / 3)) / vDcHalf,
            ),
          );
          const mC = Math.max(
            -0.98,
            Math.min(
              0.98,
              (vdMod * Math.cos(phase + (2 * Math.PI) / 3) - vqMod * Math.sin(phase + (2 * Math.PI) / 3)) / vDcHalf,
            ),
          );

          const fSw = Math.max(200.0, br.conv.carrierFreqHz ?? 2000.0);
          if (fSw * dt <= 0.15) {
            // Discrete switched 2-level carrier comparison when carrier is resolved by dt
            const tri = 4.0 * Math.abs(((t * fSw) % 1.0) - 0.5) - 1.0;
            br.vPoleA = (mA >= tri ? 1.0 : -1.0) * vDcHalf;
            br.vPoleB = (mB >= tri ? 1.0 : -1.0) * vDcHalf;
            br.vPoleC = (mC >= tri ? 1.0 : -1.0) * vDcHalf;
          } else {
            // Sub-step averaged PWM pole voltage
            br.vPoleA = mA * vDcHalf;
            br.vPoleB = mB * vDcHalf;
            br.vPoleC = mC * vDcHalf;
          }

          // DC link capacitor power balance
          const pAcW = va * ia + vb * ib + vc * ic;
          const iDcAc = pAcW / Math.max(100.0, br.vDcVolts);
          const iDcSrc =
            pRefW >= 0
              ? Math.max(
                  0.0,
                  (br.vDcRefVolts - br.vDcVolts) / Math.max(1.0, 0.05 * br.rDcLoadOhm) +
                    pRefW / Math.max(100.0, br.vDcVolts),
                )
              : 0.0;
          const iDcSink = pRefW < 0 ? br.vDcVolts / br.rDcLoadOhm : 0.0;
          br.vDcVolts = Math.max(
            100.0,
            Math.min(2.0 * br.vDcRefVolts, br.vDcVolts + (dt / br.cDcFarad) * (iDcSrc - iDcAc - iDcSink)),
          );
          br.iDcAmp = pRefW >= 0 ? iDcAc : iDcSink;
          br.vDcTraj[k] = br.vDcVolts * 1e-3;
          if (br.pMwTraj) br.pMwTraj[k] = pAcW * 1e-6;
          if (br.qMvarTraj) {
            const vaP = (vb - vc) / SQRT3;
            const vbP = (vc - va) / SQRT3;
            const vcP = (va - vb) / SQRT3;
            br.qMvarTraj[k] = (vaP * ia + vbP * ib + vcP * ic) * 1e-6;
          }
          if (br.mIndexTraj) br.mIndexTraj[k] = Math.hypot(vdMod, vqMod) / vDcHalf;
        }
      }

      // 10c. Step OLTC transformer automatic tap changers
      for (const oltc of this.oltcStates) {
        if (oltc.targetBusIdx >= 0 && oltc.vRefVoltsPeak > 0) {
          const va = this.vaStep[oltc.targetBusIdx] ?? 0;
          const vb = this.vbStep[oltc.targetBusIdx] ?? 0;
          const vc = this.vcStep[oltc.targetBusIdx] ?? 0;
          const vMag = Math.sqrt((2.0 / 3.0) * (va * va + vb * vb + vc * vc));
          const errPu = (oltc.vRefVoltsPeak - vMag) / oltc.vRefVoltsPeak;
          if (Math.abs(errPu) > oltc.deadbandPu) {
            oltc.timerSec += this.timeStepSec;
            if (oltc.timerSec >= oltc.delaySec) {
              const dir = errPu > 0 ? 1 : -1;
              const nextTap = Math.max(oltc.tapMin, Math.min(oltc.tapMax, oltc.tapPu + dir * oltc.tapStepPu));
              if (Math.abs(nextTap - oltc.tapPu) > 1e-6) {
                oltc.tapPu = nextTap;
                const br = this.companionBranches[oltc.branchIdx];
                if (br) {
                  br.tapRatio = oltc.baseTapRatio * oltc.tapPu;
                  this.luValid = false;
                  this.switchingEventCount++;
                }
              }
              oltc.timerSec = 0;
            }
          } else {
            oltc.timerSec = 0;
          }
        }
        oltc.tapTraj[k] = oltc.tapPu;
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
            const val = cbs.udm.ports[port] ?? 0.0;
            traj[k] = val;
            if (this.csmfEvaluator) {
              this.csmfEvaluator.setSignal(`${cbs.block.id}_${port}`, val);
              if (cbs.block.assignedPorts?.[0] === port) {
                this.csmfEvaluator.setSignal(cbs.block.id, val);
              }
            }
          }
        }
      }

      // Update induction machine slip & saturable transformer flux/magnetizing currents
      for (const im of this.indMachineStates) {
        const va = this.vaStep[im.busIdx] ?? 0;
        const vb = this.vbStep[im.busIdx] ?? 0;
        const vc = this.vcStep[im.busIdx] ?? 0;
        const theta = this.omega * t + im.thetaR;
        const ePeak = im.eInternalPu * im.vPeak;
        const ea = ePeak * Math.sin(theta);
        const eb = ePeak * Math.sin(theta - (2 * Math.PI) / 3);
        const ec = ePeak * Math.sin(theta + (2 * Math.PI) / 3);
        const curA = im.gStator * (ea - va);
        const curB = im.gStator * (eb - vb);
        const curC = im.gStator * (ec - vc);
        im.ia[k] = curA;
        im.ib[k] = curB;
        im.ic[k] = curC;
        const pElecW = va * curA + vb * curB + vc * curC;
        const tePu = pElecW / im.sBaseVa;
        const dSlip = ((im.tmPu - tePu) / (2.0 * im.hSec)) * this.timeStepSec;
        im.slip = Math.max(-0.5, Math.min(1.5, im.slip - dSlip));
        im.thetaR -= im.slip * this.omega * this.timeStepSec;
      }

      for (const xf of this.satXfmrStates) {
        const va = this.vaStep[xf.primIdx] ?? 0;
        const vb = this.vbStep[xf.primIdx] ?? 0;
        const vc = this.vcStep[xf.primIdx] ?? 0;
        xf.fluxA += 0.5 * (va + xf.vPrevA) * this.timeStepSec;
        xf.fluxB += 0.5 * (vb + xf.vPrevB) * this.timeStepSec;
        xf.fluxC += 0.5 * (vc + xf.vPrevC) * this.timeStepSec;
        xf.vPrevA = va;
        xf.vPrevB = vb;
        xf.vPrevC = vc;
        if (xf.coreModel === "JILES_ATHERTON") {
          const stepJa = (
            flux: number,
            mPrev: number,
            hPrev: number,
          ): { iMag: number; mNext: number; hNext: number } => {
            const fluxNorm = flux / Math.max(1e-6, xf.lambdaKnee);
            const hNext = fluxNorm * xf.jaA * 2.5;
            const dH = hNext - hPrev;
            const hEff = hNext + xf.jaAlpha * mPrev;
            const x = hEff / Math.max(1e-3, xf.jaA);
            const mAn = Math.abs(x) < 1e-4 ? (xf.jaMs * x) / 3.0 : xf.jaMs * (1 / Math.tanh(x) - 1 / x);
            const delta = dH >= 0 ? 1 : -1;
            const denom = delta * xf.jaK - xf.jaAlpha * (mAn - mPrev);
            const dmIrrev = Math.abs(denom) > 1e-6 ? ((mAn - mPrev) * dH) / denom : 0;
            const dManDh =
              Math.abs(x) < 1e-4 ? xf.jaMs / (3 * xf.jaA) : (xf.jaMs / xf.jaA) * (1 / (x * x) - 1 / Math.sinh(x) ** 2);
            const dmTotal = Math.max(
              -0.5 * xf.jaMs,
              Math.min(0.5 * xf.jaMs, (dmIrrev + xf.jaC * dManDh * dH) / (1 + xf.jaC)),
            );
            const mNext = Math.max(-xf.jaMs, Math.min(xf.jaMs, mPrev + dmTotal));
            const absF = Math.abs(flux);
            const iSat = absF > xf.lambdaKnee ? (Math.sign(flux) * (absF - xf.lambdaKnee)) / xf.lSatH : 0;
            const iHyst =
              0.02 *
              (xf.lambdaKnee / Math.max(1e-4, xf.lSatH)) *
              ((hNext / Math.max(1, xf.jaA)) * 0.1 - mNext / Math.max(1, xf.jaMs));
            return { iMag: iSat + iHyst, mNext, hNext };
          };
          const rA = stepJa(xf.fluxA, xf.mA, xf.hPrevA);
          xf.iMagA = rA.iMag;
          xf.mA = rA.mNext;
          xf.hPrevA = rA.hNext;
          const rB = stepJa(xf.fluxB, xf.mB, xf.hPrevB);
          xf.iMagB = rB.iMag;
          xf.mB = rB.mNext;
          xf.hPrevB = rB.hNext;
          const rC = stepJa(xf.fluxC, xf.mC, xf.hPrevC);
          xf.iMagC = rC.iMag;
          xf.mC = rC.mNext;
          xf.hPrevC = rC.hNext;
        } else {
          const satCurrent = (flux: number): number => {
            const absF = Math.abs(flux);
            if (absF <= xf.lambdaKnee) return 0;
            return (Math.sign(flux) * (absF - xf.lambdaKnee)) / xf.lSatH;
          };
          xf.iMagA = satCurrent(xf.fluxA);
          xf.iMagB = satCurrent(xf.fluxB);
          xf.iMagC = satCurrent(xf.fluxC);
        }
      }

      if (this.csmfEvaluator) {
        const controlBlocks = this.netlist.controlBlocks ?? [];
        for (const blk of controlBlocks) {
          const ph = Math.round(blk.params["phase"] ?? 0);
          if (blk.kind === "sensor_v" && blk.sensorTarget) {
            const bIdx = this.busIdxMap.get(blk.sensorTarget);
            const v =
              bIdx !== undefined
                ? ((ph === 1 ? this.vbStep[bIdx] : ph === 2 ? this.vcStep[bIdx] : this.vaStep[bIdx]) ?? 0)
                : ((ph === 1
                    ? this.busPhaseVoltages.get(blk.sensorTarget)?.b[k]
                    : ph === 2
                      ? this.busPhaseVoltages.get(blk.sensorTarget)?.c[k]
                      : this.busPhaseVoltages.get(blk.sensorTarget)?.a[k]) ?? 0);
            this.csmfEvaluator.setSignal(blk.id, v);
          } else if (blk.kind === "sensor_i" && blk.sensorTarget) {
            const brPh = this.branchPhaseCurrents.get(blk.sensorTarget);
            const i = (ph === 1 ? brPh?.b[k] : ph === 2 ? brPh?.c[k] : brPh?.a[k]) ?? 0;
            this.csmfEvaluator.setSignal(blk.id, i);
          }
        }
        const stepValues = this.csmfEvaluator.step(this.timeStepSec);
        for (const blk of controlBlocks) {
          const val = stepValues.get(blk.id) ?? 0;
          const traj = this.controlSignals.get(blk.id);
          if (traj) traj[k] = val;
          if (blk.actuator?.type === "breaker_status") {
            const target = blk.actuator.targetId;
            // Convention: signal > 0.5 trips/opens breaker (isClosed = false); <= 0.5 keeps closed
            const isClosed = val <= 0.5;
            for (const swState of this.switchStates) {
              if (
                swState.sw.id === target ||
                swState.sw.id.startsWith(`${target}_`) ||
                swState.sw.id.includes(target)
              ) {
                this.csmfBreakerOverrides.set(swState.sw.id, isClosed);
              }
            }
          }
        }
      }
    }
    state.cdaCounter = cdaCounter;
  }

  private finalizeSolveResult(startTime: number): EmtSolverResult {
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
        luCacheHits: this.luCacheHitsCount,
        switchingEvents: this.switchingEventCount,
        chatterDampedSteps: this.chatterDampedCount,
        interpolatedZeroCrossings: this.interpolatedZeroCrossingsCount,
        coupledNonlinearIterations: this.coupledNonlinearIterationsCount,
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

  public getNUlmLines(): readonly NConductorUlmData[] {
    return this.nUlmLines.map((u) => u.model);
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
export function runEmtSimulation(netlist: EmtNetlist | EmtNetlistInput, options: EmtSolverOptions): EmtSolverResult {
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
  netlist: EmtNetlist | EmtNetlistInput,
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
