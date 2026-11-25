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

import { extractEmtNetlistFromXml } from "../netlist/emt-netlist.js";
import type { EmtdcHostBridge } from "../script/emtdc-abi-bridge.js";
import type { EmtNetlist } from "../types.js";
import type { CsmfControlEvaluator } from "./csmf-evaluator.js";
import {
  applyInteractiveWrite,
  stepCsmfControlBlocks,
  stepEmtdcCustomBlocksDsout,
  type EmtCsmfStepContext,
} from "./emt-control-blocks.js";
import {
  initMmcRuntimeStates,
  stepConverterBridges,
  stepIbrFmuConverters,
  stepMmcConverters,
} from "./emt-converters-step.js";
import { stepInductionMachines, stepSynchronousGenerators } from "./emt-machine-step.js";
import {
  assembleDynamicInjections,
  computeCompanionDrop,
  computeTopologyKey,
  ensureConductanceMatrixFactorized,
  factorize3Phase,
  injectCompanionHistory,
  resetConductanceMatrix,
  saveTopologyToCache,
  solveFromLU3Phase,
  stamp3PhaseBranch,
  stampDiagonal,
  stampEntry,
  stampNUlmModel,
  stampUlmModel,
  type EmtNetworkStampContext,
} from "./emt-network-stamp.js";
import {
  applySurgeArresterCompensation,
  stepOltcTapChangers,
  stepSaturableTransformers,
  updateSurgeArresterTheveninVectors,
} from "./emt-nonlinear-elements.js";
import {
  initProtectionRelayStates,
  stepProtectionRelays,
  type EmtProtectionRelayContext,
} from "./emt-protection-relays.js";
import {
  applyEmtSnapshot,
  captureEmtStepSessionState,
  exportEmtSnapshot,
  extractEmtTransferableBuffers,
  parsePscadSnapshot,
  restoreEmtStepSessionState,
  serializePscadSnapshot,
  type EmtSnapshotContext,
} from "./emt-snapshot.js";
import type {
  BergeronLineState,
  BusInfo,
  CompanionBranch,
  ConverterBridgeRuntimeState,
  CustomBlockRuntimeState,
  EmtBoundaryFeed,
  EmtNetlistInput,
  EmtNetworkMatrixState,
  EmtSolveLoopState,
  EmtSolverMetrics,
  EmtSolverOptions,
  EmtSolverResult,
  EmtStepSession,
  FmuState,
  IndMachineRuntimeState,
  NUlmLineRuntimeState,
  OltcState,
  PscadSnapshot,
  SatXfmrRuntimeState,
  SourceInfo,
  SurgeArresterState,
  SwitchState,
  SyncGenState,
} from "./emt-solver-types.js";
import { initializeEmtSteadyState } from "./emt-steady-state.js";
import {
  evaluateSwitchToggles,
  executeCdaHalfStep,
  executeSwitchingRollbackInterpolation,
  updateCompanionBranchesAndLines,
  updateSwitchCurrents,
  type EmtSwitchingContext,
} from "./emt-switching-and-lines.js";
import { initializeEmtTopology, type EmtTopologyContext } from "./emt-topology.js";
import { solveEmtWithWasm } from "./emt-wasm-kernel.js";
import { OemLicenseError, OemLicensePreflightGuard, type OemLicensePreflightGuardOptions } from "./license-guard.js";
import type { NConductorUlmData, UniversalLineModelData } from "./universal-line-model.js";

export {
  OemLicenseError,
  OemLicensePreflightGuard,
  type NConductorUlmData,
  type OemLicensePreflightGuardOptions,
  type UniversalLineModelData,
};

export { extractEmtTransferableBuffers, parsePscadSnapshot, serializePscadSnapshot };
export type { EmtBoundaryFeed, EmtNetlistInput, EmtSolverMetrics, EmtSolverOptions, EmtSolverResult, PscadSnapshot };

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
  private readonly nUlmLines: NUlmLineRuntimeState[] = [];
  private readonly syncGenerators: SyncGenState[] = [];
  private readonly oltcStates: OltcState[] = [];
  private readonly bridgeRuntimeStates: ConverterBridgeRuntimeState[] = [];
  private readonly switchStates: SwitchState[] = [];
  private readonly fmuStates: FmuState[] = [];
  private readonly surgeArresters: SurgeArresterState[] = [];
  private readonly busSources = new Map<number, SourceInfo[]>();
  private readonly defaultSrcR: number;
  private snapshotApplied: boolean = false;
  private mmcSourcesRegistered: boolean = false;

  private nBuses: number = 0;
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
  private readonly customBlockStates: CustomBlockRuntimeState[] = [];
  private readonly indMachineStates: IndMachineRuntimeState[] = [];
  private readonly satXfmrStates: SatXfmrRuntimeState[] = [];

  // Coupled 3N x 3N phase-domain matrix, LU factors, sparse CCS & topology cache state
  private mat!: EmtNetworkMatrixState;

  // Solved step per-phase views
  private vaStep!: Float64Array;
  private vbStep!: Float64Array;
  private vcStep!: Float64Array;

  // Pre-allocated step contexts (zero per-step allocations)
  private stampCtx!: EmtNetworkStampContext;
  private switchingCtx!: EmtSwitchingContext;
  private relayCtx!: EmtProtectionRelayContext;
  private csmfCtx!: EmtCsmfStepContext;

  // Metrics
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
    const ctx: EmtTopologyContext = {
      netlist: this.netlist,
      options: this.options,
      timeStepSec: this.timeStepSec,
      omega: this.omega,
      nSteps: this.nSteps,
      defaultSrcR: this.defaultSrcR,
      busList: this.busList,
      busIdxMap: this.busIdxMap,
      companionBranches: this.companionBranches,
      bergeronLines: this.bergeronLines,
      ulmLines: this.ulmLines,
      nUlmLines: this.nUlmLines,
      syncGenerators: this.syncGenerators,
      oltcStates: this.oltcStates,
      bridgeRuntimeStates: this.bridgeRuntimeStates,
      switchStates: this.switchStates,
      fmuStates: this.fmuStates,
      surgeArresters: this.surgeArresters,
      busSources: this.busSources,
      customBlockStates: this.customBlockStates,
      indMachineStates: this.indMachineStates,
      satXfmrStates: this.satXfmrStates,
      busPhaseVoltages: this.busPhaseVoltages,
      branchCurrents: this.branchCurrents,
      branchPhaseCurrents: this.branchPhaseCurrents,
      vA: this.vA,
      vB: this.vB,
      vC: this.vC,
      iA: this.iA,
      iB: this.iB,
      iC: this.iC,
      controlSignals: this.controlSignals,
      nBuses: 0,
      nPhaseNodes: 0,
      time: new Float64Array(0),
      csmfEvaluator: null,
      emtdcHostBridge: null,
      G3: new Float64Array(0),
      J3: new Float64Array(0),
      LU3: new Float64Array(0),
      piv3: new Int32Array(0),
      v3Step: new Float64Array(0),
      vaStep: new Float64Array(0),
      vbStep: new Float64Array(0),
      vcStep: new Float64Array(0),
      useSparse: false,
      gTriplets: null,
      registerBranchBuffers: (id) => this.registerBranchBuffers(id),
    };
    initializeEmtTopology(ctx);
    this.nBuses = ctx.nBuses;
    this.time = ctx.time;
    this.csmfEvaluator = ctx.csmfEvaluator;
    this.emtdcHostBridge = ctx.emtdcHostBridge;
    this.vaStep = ctx.vaStep;
    this.vbStep = ctx.vbStep;
    this.vcStep = ctx.vcStep;

    this.mat = {
      nPhaseNodes: ctx.nPhaseNodes,
      G3: ctx.G3,
      J3: ctx.J3,
      LU3: ctx.LU3,
      piv3: ctx.piv3,
      v3Step: ctx.v3Step,
      luValid: false,
      luCache: new Map(),
      activeTopoKey: "",
      useSparse: ctx.useSparse,
      gTriplets: ctx.gTriplets,
      sparseCcs: null,
      gTripletMap: null,
      sparseFactors: null,
      colPerm: undefined,
      zArresterPorts: new Float64Array(0),
      luFactorizationCount: 0,
      luCacheHitsCount: 0,
    };

    this.stampCtx = {
      netlist: this.netlist,
      options: this.options,
      timeStepSec: this.timeStepSec,
      omega: this.omega,
      nSteps: this.nSteps,
      busList: this.busList,
      busIdxMap: this.busIdxMap,
      busSources: this.busSources,
      companionBranches: this.companionBranches,
      bergeronLines: this.bergeronLines,
      ulmLines: this.ulmLines,
      nUlmLines: this.nUlmLines,
      syncGenerators: this.syncGenerators,
      oltcStates: this.oltcStates,
      bridgeRuntimeStates: this.bridgeRuntimeStates,
      switchStates: this.switchStates,
      fmuStates: this.fmuStates,
      surgeArresters: this.surgeArresters,
      indMachineStates: this.indMachineStates,
      satXfmrStates: this.satXfmrStates,
      customBlockStates: this.customBlockStates,
      csmfEvaluator: this.csmfEvaluator,
      emtdcHostBridge: this.emtdcHostBridge,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
      mat: this.mat,
    };

    this.switchingCtx = {
      nBuses: this.nBuses,
      timeStepSec: this.timeStepSec,
      enableCda: this.enableCda,
      enableSwitchingInterpolation: this.enableSwitchingInterpolation,
      time: this.time,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
      switchStates: this.switchStates,
      csmfBreakerOverrides: this.csmfBreakerOverrides,
      branchPhaseCurrents: this.branchPhaseCurrents,
      stampCtx: this.stampCtx,
    };

    this.relayCtx = {
      omega: this.omega,
      timeStepSec: this.timeStepSec,
      busList: this.busList,
      busIdxMap: this.busIdxMap,
      branchPhaseCurrents: this.branchPhaseCurrents,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
      syncGenerators: this.syncGenerators,
      switchStates: this.switchStates,
    };

    this.csmfCtx = {
      csmfEvaluator: this.csmfEvaluator,
      netlist: this.netlist,
      busIdxMap: this.busIdxMap,
      busPhaseVoltages: this.busPhaseVoltages,
      branchPhaseCurrents: this.branchPhaseCurrents,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
      controlSignals: this.controlSignals,
      switchStates: this.switchStates,
      csmfBreakerOverrides: this.csmfBreakerOverrides,
      timeStepSec: this.timeStepSec,
    };
  }

  private createSnapshotContext(): EmtSnapshotContext {
    return {
      nBuses: this.nBuses,
      nSteps: this.nSteps,
      timeStepSec: this.timeStepSec,
      omega: this.omega,
      time: this.time,
      busList: this.busList,
      busIdxMap: this.busIdxMap,
      busPhaseVoltages: this.busPhaseVoltages,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
      companionBranches: this.companionBranches,
      bergeronLines: this.bergeronLines,
      syncGenerators: this.syncGenerators,
      switchStates: this.switchStates,
    };
  }

  /**
   * Delegates simulation to the native WebAssembly EMT companion solver kernel in linear memory.
   */
  private solveWithWasm(): EmtSolverResult | null {
    return solveEmtWithWasm({
      netlist: this.netlist,
      options: this.options,
      timeStepSec: this.timeStepSec,
      nSteps: this.nSteps,
      nBuses: this.nBuses,
      snapshotApplied: this.snapshotApplied,
      time: this.time,
      busList: this.busList,
      busIdxMap: this.busIdxMap,
      busSources: this.busSources,
      companionBranches: this.companionBranches,
      bergeronLines: this.bergeronLines,
      ulmLines: this.ulmLines,
      nUlmLines: this.nUlmLines,
      oltcStates: this.oltcStates,
      bridgeRuntimeStates: this.bridgeRuntimeStates,
      switchStates: this.switchStates,
      fmuStates: this.fmuStates,
      surgeArresters: this.surgeArresters,
      customBlockStates: this.customBlockStates,
      csmfEvaluator: this.csmfEvaluator,
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
      controlSignals: this.controlSignals,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
    });
  }

  /**
   * Pre-solves the fundamental-frequency AC steady-state over two full cycles prior to t = 0
   * (`t in [-2 * T0, -dt]`) so that all companion branch histories, Bergeron/ULM traveling-wave
   * delay buffers, and synchronous generator states start in sinusoidal steady state at t = 0
   * with zero initialization transient.
   */
  public initializeSteadyState(): void {
    const mat = this.mat;
    initializeEmtSteadyState({
      nBuses: this.nBuses,
      nPhaseNodes: mat.nPhaseNodes,
      omega: this.omega,
      timeStepSec: this.timeStepSec,
      G3: mat.G3,
      J3: mat.J3,
      LU3: mat.LU3,
      piv3: mat.piv3,
      v3Step: mat.v3Step,
      vaStep: this.vaStep,
      vbStep: this.vbStep,
      vcStep: this.vcStep,
      busSources: this.busSources,
      syncGenerators: this.syncGenerators,
      companionBranches: this.companionBranches,
      bergeronLines: this.bergeronLines,
      ulmLines: this.ulmLines,
      nUlmLines: this.nUlmLines,
      switchStates: this.switchStates,
      surgeArresters: this.surgeArresters,
      emtdcHostBridge: this.emtdcHostBridge,
      customBlockStates: this.customBlockStates,
      resetConductanceMatrix: () => resetConductanceMatrix(mat),
      stampDiagonal: (pNode, g) => stampDiagonal(mat, pNode, g),
      stampEntry: (r, c, g) => stampEntry(mat, r, c, g),
      stamp3PhaseBranch: (fromIdx, toIdx, gSelf, gMut, tapRatio, windingConnection) =>
        stamp3PhaseBranch(mat, fromIdx, toIdx, gSelf, gMut, tapRatio, windingConnection),
      stampUlmModel: (ulm) => stampUlmModel(mat, ulm),
      stampNUlmModel: (nu) => stampNUlmModel(mat, nu),
      factorize3Phase: (A, LU, piv) => factorize3Phase(mat, A, LU, piv),
      solveFromLU3Phase: (LU, piv, b, x) => solveFromLU3Phase(mat, LU, piv, b, x),
      updateSurgeArresterTheveninVectors: () => {
        mat.zArresterPorts = updateSurgeArresterTheveninVectors(
          this.surgeArresters,
          mat.nPhaseNodes,
          (rhs, out) => solveFromLU3Phase(mat, mat.LU3, mat.piv3, rhs, out),
          mat.zArresterPorts,
        );
      },
      computeTopologyKey: (t) => computeTopologyKey(this.options, this.netlist, this.switchStates, this.oltcStates, t),
      saveTopologyToCache: (key) => saveTopologyToCache(mat, this.surgeArresters, key),
      injectCompanionHistory: (br) => injectCompanionHistory(mat.J3, br),
      computeCompanionDrop: (br, useV3Step) =>
        computeCompanionDrop(br, mat.v3Step, this.vaStep, this.vbStep, this.vcStep, useV3Step),
      onSteadyStateFactorized: (activeTopoKey) => {
        mat.luValid = true;
        mat.activeTopoKey = activeTopoKey;
      },
    });
  }

  /**
   * Restores solver internal state (bus voltages, companion branch histories, Bergeron/ULM line buffers,
   * synchronous generator rotor angles, and switch states) from a `PscadSnapshot` (`.snp`).
   */
  public applySnapshot(snapshot: PscadSnapshot): void {
    this.snapshotApplied = true;
    applyEmtSnapshot(this.createSnapshotContext(), snapshot);
    this.mat.luValid = false;
  }

  /**
   * Exports the current (or specified step's) complete EMT operating point as a `PscadSnapshot` (`.snp`).
   */
  public exportSnapshot(stepIndex?: number): PscadSnapshot {
    return exportEmtSnapshot(this.createSnapshotContext(), stepIndex);
  }

  /**
   * Mutates a live runtime parameter (CSMF slider/dial/pushbutton `Value`, breaker open/close state,
   * converter `pRefMw`/`qRefMvar`/`vDcRefKv`/`firingAngleDeg`, or generator `efPu`/`pmPu`) mid-run.
   */
  public interactiveWrite(targetId: string, paramOrAction: string, value: number | boolean): boolean {
    return applyInteractiveWrite(
      {
        netlist: this.netlist,
        csmfEvaluator: this.csmfEvaluator,
        switchStates: this.switchStates,
        csmfBreakerOverrides: this.csmfBreakerOverrides,
        bridgeRuntimeStates: this.bridgeRuntimeStates,
        syncGenerators: this.syncGenerators,
      },
      targetId,
      paramOrAction,
      value,
    );
  }

  /**
   * Executes the full time-domain simulation loop.
   */
  public solve(): EmtSolverResult {
    this.verifyOemLicenses();
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
   * Begins an incremental, lock-stepped EMT co-simulation session.
   * Call `stepSessionBatch()` once per macro-step, then `endStepSession()` to retrieve full trajectories.
   */
  public beginStepSession(): EmtStepSession {
    this.verifyOemLicenses();
    const startTime = performance.now();
    const loopState = this.initSolveLoopState();
    return { loopState, stepCursor: 0, startTime };
  }

  /**
   * Updates boundary feeds dynamically between macro-steps.
   */
  public setBoundaryFeeds(feeds: EmtBoundaryFeed[] | undefined): void {
    this.options.boundaryFeeds = feeds;
  }

  /**
   * Advances an active EMT session by `nSubSteps` micro-steps.
   */
  public stepSessionBatch(
    session: EmtStepSession,
    nSubSteps: number,
    updatedFeeds?: EmtBoundaryFeed[] | undefined,
  ): number {
    if (updatedFeeds !== undefined) {
      this.options.boundaryFeeds = updatedFeeds;
    }
    if (this.nBuses === 0 || nSubSteps <= 0) return 0;
    const kStart = session.stepCursor;
    const kEnd = Math.min(this.nSteps, kStart + nSubSteps);
    if (kEnd <= kStart) return 0;
    this.runStepBatch(session.loopState, kStart, kEnd);
    session.stepCursor = kEnd;
    return kEnd - kStart;
  }

  /**
   * Finalizes an incremental EMT session and builds the full `EmtSolverResult`.
   */
  public endStepSession(session: EmtStepSession): EmtSolverResult {
    if (this.nBuses === 0) {
      return this.solveZeroBusSystem(session.startTime);
    }
    return this.finalizeSolveResult(session.startTime);
  }

  /**
   * Captures a complete in-memory checkpoint of an active EMT step session
   * for macro-step Picard / waveform-relaxation rollback.
   */
  public captureStepSessionState(session: EmtStepSession): unknown {
    return captureEmtStepSessionState(this.createSnapshotContext(), session);
  }

  /**
   * Restores a previously captured EMT step session checkpoint.
   */
  public restoreStepSessionState(session: EmtStepSession, snapshot: unknown): void {
    restoreEmtStepSessionState(this.createSnapshotContext(), session, snapshot);
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
    this.verifyOemLicenses();
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

  private verifyOemLicenses(): void {
    this.licenseGuard.verifyOrThrow(
      this.customBlockStates.map((cbs) => ({
        block: cbs.block,
        runner: cbs.runner,
      })),
    );
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

  private initSolveLoopState(): EmtSolveLoopState {
    const n = this.nBuses;
    const nPhaseNodes = this.mat.nPhaseNodes;
    const nArr = this.surgeArresters.length;
    const arrM = nArr * 3;

    const relayRuntimeStates = initProtectionRelayStates(
      this.netlist,
      this.busList,
      this.busIdxMap,
      this.controlSignals,
      this.nSteps,
      this.omega,
      this.timeStepSec,
    );

    const mmcInit = initMmcRuntimeStates(
      this.netlist,
      this.busIdxMap,
      this.busSources,
      this.controlSignals,
      this.nSteps,
      this.omega,
      this.mmcSourcesRegistered,
    );
    this.mmcSourcesRegistered = mmcInit.mmcSourcesRegistered;

    return {
      cdaCounter: 0,
      vaPrevStep: new Float64Array(n),
      vbPrevStep: new Float64Array(n),
      vcPrevStep: new Float64Array(n),
      vPreStep3: new Float64Array(nPhaseNodes),
      nArr,
      arrM,
      v0Step: arrM > 0 ? new Float64Array(nPhaseNodes) : null,
      arrV0: arrM > 0 ? new Float64Array(arrM) : null,
      arrCurr: arrM > 0 ? new Float64Array(arrM) : null,
      arrRes: arrM > 0 ? new Float64Array(arrM) : null,
      arrDelta: arrM > 0 ? new Float64Array(arrM) : null,
      arrJac: arrM > 0 ? new Float64Array(arrM * arrM) : null,
      switchedBusInterpolation: new Map<number, number>(),
      relayRuntimeStates,
      mmcRuntimeStates: mmcInit.mmcRuntimeStates,
    };
  }

  private runStepBatch(state: EmtSolveLoopState, kStart: number, kEnd: number): void {
    const n = this.nBuses;
    const mat = this.mat;
    let cdaCounter = state.cdaCounter;
    const {
      vaPrevStep,
      vbPrevStep,
      vcPrevStep,
      vPreStep3,
      switchedBusInterpolation,
      relayRuntimeStates,
      mmcRuntimeStates,
    } = state;

    for (let k = kStart; k < kEnd; k++) {
      const t = this.time[k]!;
      const prevTopoKey = mat.activeTopoKey;
      if (k > 0) {
        vaPrevStep.set(this.vaStep);
        vbPrevStep.set(this.vbStep);
        vcPrevStep.set(this.vcStep);
      }

      // 1. Detect switch state toggles & compute sub-step zero-crossing interpolation factor alpha
      const swToggle = evaluateSwitchToggles(this.switchingCtx, t, k, switchedBusInterpolation, cdaCounter);
      cdaCounter = swToggle.cdaCounter;
      this.switchingEventCount += swToggle.switchingEvents;
      this.interpolatedZeroCrossingsCount += swToggle.interpolatedZeroCrossings;

      // 2. Check active fault conditions
      let anyFaultActive = false;
      for (const flt of this.netlist.faults ?? []) {
        if (t >= flt.startSec && t <= flt.endSec) {
          anyFaultActive = true;
        }
      }

      // 3. Assemble coupled 3N x 3N conductance matrix on topology key miss (cache hit swaps LU in O(1))
      const topoKey = ensureConductanceMatrixFactorized(this.stampCtx, t);

      // 3b. True dt/2 CDA half-step (Backward Euler at t - 0.5*dt) to resynchronize onto the main grid
      if (this.enableCda && cdaCounter === 2 && k > 0 && mat.luValid) {
        executeCdaHalfStep(this.switchingCtx, t, k, anyFaultActive, mmcRuntimeStates);
        this.chatterDampedCount++;
        cdaCounter = 1;
      }

      // 4. Switching rollback double-interpolation (if topology toggled sub-step at t_sw = tPrev + alpha*dt)
      const hasPreSwitchSolution = executeSwitchingRollbackInterpolation(
        this.switchingCtx,
        t,
        k,
        prevTopoKey,
        topoKey,
        anyFaultActive,
        mmcRuntimeStates,
        switchedBusInterpolation,
        state,
      );

      // 4b. Assemble 3-phase injection currents J3 at t_k and advance main-step sources/lines
      assembleDynamicInjections(this.stampCtx, t, k, true, anyFaultActive, mmcRuntimeStates);

      // 5. Solve coupled 3N x 3N post-switch linear system via forward/backward substitution
      solveFromLU3Phase(mat, mat.LU3, mat.piv3, mat.J3, mat.v3Step);

      // 5b. Coupled Multi-Port Non-linear Thévenin Newton-Raphson Compensation for Surge Arresters (MOVs)
      if (state.arrM > 0) {
        this.coupledNonlinearIterationsCount += applySurgeArresterCompensation(
          this.surgeArresters,
          mat.zArresterPorts,
          mat.nPhaseNodes,
          this.timeStepSec,
          mat.v3Step,
          state,
        );
      }

      // Record per-phase bus voltages with optional sub-step switching interpolation
      for (let i = 0; i < n; i++) {
        let va = mat.v3Step[3 * i + 0]!;
        let vb = mat.v3Step[3 * i + 1]!;
        let vc = mat.v3Step[3 * i + 2]!;
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

      // 6, 6b, 6b2. Update companion branches, Bergeron, ULM, and N-conductor ULM histories
      const isCdaActive = cdaCounter > 0;
      if (isCdaActive) {
        this.chatterDampedCount++;
        cdaCounter--;
      }
      updateCompanionBranchesAndLines(this.switchingCtx, k, isCdaActive, switchedBusInterpolation);

      // 6c. Update Park dq0 synchronous generator states & torsional shaft mechanics
      if (this.syncGenerators.length > 0) {
        stepSynchronousGenerators(
          this.syncGenerators,
          this.vaStep,
          this.vbStep,
          this.vcStep,
          this.csmfEvaluator,
          this.timeStepSec,
          t,
          k,
        );
      }

      // 7. Update switch currents
      if (this.switchStates.length > 0) {
        updateSwitchCurrents(this.switchStates, this.vaStep, this.vbStep, this.vcStep, k);
      }

      // 8. Update IBR / FMU converter injection currents
      if (this.fmuStates.length > 0) {
        stepIbrFmuConverters(
          this.fmuStates,
          this.busList,
          this.vaStep,
          this.vbStep,
          this.vcStep,
          this.omega,
          this.timeStepSec,
          t,
          k,
          anyFaultActive,
        );
      }

      // 9. Closed-loop protection relay evaluation & breaker trip actuation
      if (relayRuntimeStates.length > 0) {
        stepProtectionRelays(relayRuntimeStates, this.relayCtx, t, k);
      }

      // 10. Step 6-arm 3-phase Detailed Equivalent Model (DEM) MMC with NLM & CCSC
      if (mmcRuntimeStates.length > 0) {
        stepMmcConverters(mmcRuntimeStates, this.vaStep, this.vbStep, this.vcStep, this.omega, this.timeStepSec, t, k);
      }

      // 10b. Step switched VSC PWM & 6-pulse LCC converter bridges
      if (this.bridgeRuntimeStates.length > 0) {
        stepConverterBridges(
          this.bridgeRuntimeStates,
          this.vaStep,
          this.vbStep,
          this.vcStep,
          this.omega,
          this.timeStepSec,
          t,
          k,
        );
      }

      // 10c. Step OLTC transformer automatic tap changers
      if (this.oltcStates.length > 0) {
        const tapEvents = stepOltcTapChangers(
          this.oltcStates,
          this.companionBranches,
          this.vaStep,
          this.vbStep,
          this.vcStep,
          this.timeStepSec,
          k,
        );
        if (tapEvents > 0) {
          mat.luValid = false;
          this.switchingEventCount += tapEvents;
        }
      }

      // EMTDC Fortran / C Binary DLL User-Defined Models (DSOUT post-network solve)
      stepEmtdcCustomBlocksDsout(
        this.emtdcHostBridge,
        this.customBlockStates,
        this.csmfEvaluator,
        this.vaStep,
        this.vbStep,
        this.vcStep,
        k,
      );

      // Update induction machine slip & saturable transformer flux/magnetizing currents
      if (this.indMachineStates.length > 0) {
        stepInductionMachines(
          this.indMachineStates,
          this.vaStep,
          this.vbStep,
          this.vcStep,
          this.omega,
          this.timeStepSec,
          t,
          k,
        );
      }
      if (this.satXfmrStates.length > 0) {
        stepSaturableTransformers(this.satXfmrStates, this.vaStep, this.vbStep, this.vcStep, this.timeStepSec);
      }

      // Step CSMF control block network
      if (this.csmfEvaluator) {
        stepCsmfControlBlocks(this.csmfCtx, k);
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
        luFactorizations: this.mat.luFactorizationCount,
        luCacheHits: this.mat.luCacheHitsCount,
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
 * Convenience helper to execute a 3-phase Dommel EMT simulation on an `EmtNetlist`.
 */
export function runEmtSimulation(netlist: EmtNetlist | EmtNetlistInput, options: EmtSolverOptions): EmtSolverResult {
  const solver = new EmtSolver(netlist, options);
  return solver.solve();
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
