// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FmiLsEmtCompanionInstance } from "@modelscript/exchange";
import type { SparseCCSMatrix, SparseLUFactors, SparseTripletBuilder } from "@modelscript/runtime";
import type { EmtdcRegisteredUdm, EmtdcWasmMachinaDllRunner } from "../script/emtdc-abi-bridge.js";
import type { EmtCustomFortranBlock, EmtNetlist } from "../types.js";
import { type NConductorUlmData, type UniversalLineModelData } from "./universal-line-model.js";

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
    ((t: number) => { vPeak: number; freqRad: number; phaseRad: number; gSrc: number } | undefined) | undefined;
  /** Optional unbalanced 3-phase Thévenin/Norton feed with optional 3x3 phase conductance matrix and FDNE history current. */
  threePhaseThevenin?:
    | ((t: number) =>
        | {
            ea: number;
            eb: number;
            ec: number;
            gSrc: number;
            gMatrix3x3?: Float64Array | number[] | undefined;
            mutualCouplings?: Array<{ peerBusId: string; gMatrix3x3: Float64Array | number[] }> | undefined;
            iHistA?: number | undefined;
            iHistB?: number | undefined;
            iHistC?: number | undefined;
          }
        | undefined)
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
    ((t: number, stepIdx: number, busVoltages: Map<string, { a: number; b: number; c: number }>) => void) | undefined;
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

export interface CompanionBranch {
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

export interface BergeronLineState {
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

export interface SyncGenState {
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

export interface OltcState {
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

export interface ConverterBridgeRuntimeState {
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

export interface SwitchLike {
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

export interface LegacyBranchLike {
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

export interface LegacyLineLike {
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

export interface LegacyTransformerLike {
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

export interface LegacySourceLike {
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

export interface LegacyNetlistExtensions {
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

export interface EmtWasmExports {
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

export interface SwitchState {
  sw: SwitchLike;
  fromIdx: number;
  toIdx: number;
  currentClosed: boolean;
  phaseClosed: [boolean, boolean, boolean];
  ia: Float64Array;
  ib: Float64Array;
  ic: Float64Array;
}

export interface SurgeArresterState {
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

export interface FmuState {
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

export interface BusInfo {
  id: string;
  baseKv: number;
  vPeak: number;
}

export interface SourceInfo {
  vPeak: number;
  freqRad: number;
  phaseRad: number;
  gSrc: number;
}

export interface CachedTopologyLu {
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

export interface NUlmLineRuntimeState {
  id: string;
  fromIdx: number;
  toIdx: number;
  model: NConductorUlmData;
  vK: Float64Array;
  vM: Float64Array;
}

export interface CustomBlockRuntimeState {
  block: EmtCustomFortranBlock;
  udm: EmtdcRegisteredUdm;
  runner?: EmtdcWasmMachinaDllRunner | undefined;
  busIdx: number;
  ia?: Float64Array | undefined;
  ib?: Float64Array | undefined;
  ic?: Float64Array | undefined;
  signalTrajs: Map<string, Float64Array>;
}

export interface IndMachineRuntimeState {
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
}

export interface SatXfmrRuntimeState {
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
}

export interface RelayRuntimeState {
  relay: NonNullable<EmtNetlist["protectionRelays"]>[number];
  timerSec: number;
  tripped: boolean;
  tripTraj: Float64Array;
  zAppTraj: Float64Array;
  nCyc: number;
  dftIdx: number;
  sampleCount: number;
  vaBuf: Float64Array;
  iaBuf: Float64Array;
  secIaBuf: Float64Array;
  cos1Buf: Float64Array;
  sin1Buf: Float64Array;
  cos2Buf: Float64Array;
  sin2Buf: Float64Array;
  prevVa: number;
  prevIa: number;
  prevSecIa: number;
  vMemRe: number;
  vMemIm: number;
  ctFluxVs: number;
  prevZAngleRad: number;
  freqEstHz: number;
  smoothRocofHzPerSec: number;
}

export interface MmcRuntimeState {
  mmc: NonNullable<EmtNetlist["converterBridges"]>[number];
  busIdx: number | undefined;
  gArm: number;
  lArmH: number;
  vAcA: number;
  vAcB: number;
  vAcC: number;
  iCirc: [number, number, number];
  nSm: number;
  vDcKv: number;
  cSmFarad: number;
  vCapUpper: [Float64Array, Float64Array, Float64Array];
  vCapLower: [Float64Array, Float64Array, Float64Array];
  upperSumTraj: Float64Array;
  lowerSumTraj: Float64Array;
  spreadPctTraj: Float64Array;
  iCircATraj: Float64Array;
}

export interface EmtSolveLoopState {
  cdaCounter: number;
  vaPrevStep: Float64Array;
  vbPrevStep: Float64Array;
  vcPrevStep: Float64Array;
  vPreStep3: Float64Array;
  nArr: number;
  arrM: number;
  v0Step: Float64Array | null;
  arrV0: Float64Array | null;
  arrCurr: Float64Array | null;
  arrRes: Float64Array | null;
  arrDelta: Float64Array | null;
  arrJac: Float64Array | null;
  switchedBusInterpolation: Map<number, number>;
  relayRuntimeStates: RelayRuntimeState[];
  mmcRuntimeStates: MmcRuntimeState[];
}

export interface EmtStepSession {
  loopState: EmtSolveLoopState;
  stepCursor: number;
  startTime: number;
}

export interface EmtStepSessionCheckpoint {
  stepCursor: number;
  vaStep: Float64Array;
  vbStep: Float64Array;
  vcStep: Float64Array;
  vaPrevStep: Float64Array;
  vbPrevStep: Float64Array;
  vcPrevStep: Float64Array;
  vPreStep3: Float64Array;
  branchHistories: Array<{ iHistA: number; iHistB: number; iHistC: number }>;
  bergeronStates: Array<{
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
  }>;
  syncGenStates: Array<{ deltaRad: number; omegaRadSec: number; edSubPu: number; eqSubPu: number }>;
  switchStates: boolean[];
}

export interface EmtNetworkMatrixState {
  nPhaseNodes: number;
  G3: Float64Array;
  J3: Float64Array;
  LU3: Float64Array;
  piv3: Int32Array;
  v3Step: Float64Array;
  luValid: boolean;
  luCache: Map<string, CachedTopologyLu>;
  activeTopoKey: string;
  useSparse: boolean;
  gTriplets: SparseTripletBuilder | null;
  sparseCcs: SparseCCSMatrix | null;
  gTripletMap: Int32Array | null;
  sparseFactors: SparseLUFactors | null;
  colPerm: Int32Array | undefined;
  zArresterPorts: Float64Array;
  luFactorizationCount: number;
  luCacheHitsCount: number;
}
