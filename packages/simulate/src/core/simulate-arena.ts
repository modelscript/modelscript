// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DAEBuilder,
  WasmEventDetectorBridge,
  eliminateArenaAliases,
  evaluateArenaExpression,
  foldArenaConstants,
  hasArrayEquations,
  pantelidesIndexReductionArena,
  performBltTransformationArena,
  scalarizeArena,
  type ArenaBltBlock,
  type ArenaExecutionBlock,
} from "@modelscript/runtime";
import { Dual, evaluateArenaDualExpression, evaluateArenaRuntime } from "@modelscript/runtime/wasm_evaluator.js";
import {
  DefaultFmuSubsystem,
  FmuSubsystemRegistry,
  type FmuInstanceMetadata,
  type FmuSubsystem,
} from "@modelscript/runtime/wasm_fmu_subsystem.js";
import { executeArenaStatements, executeArenaStatementsAsync } from "@modelscript/runtime/wasm_statement_executor.js";
import {
  detectPreservedVectorODE,
  runArenaAdaptiveSimulation,
  runArenaCvodeWasm,
  runPreservedVectorODE,
  type ArenaAdaptiveSolverHost,
} from "./arena-adaptive-solver.js";
import { ArenaAlgebraicSolver, type ArenaAlgebraicSolverHost } from "./arena-algebraic-solver.js";
import {
  canRunArenaWasmSimulationLoop,
  compileArenaBlocks,
  prepareArenaFlatBytecode,
  runArenaWasmSimulationLoop,
  type ArenaBlockCompilerHost,
} from "./arena-block-compiler.js";
import {
  checkArenaAssertions,
  checkArenaIntervalSafetyBarriers,
  executeArenaStateMachines,
  extractArenaAssertions,
  extractArenaEventIndicators,
  extractArenaStateMachines,
  extractArenaWhenClauses,
  processArenaWhenClauses,
  type ArenaHybridEventsHost,
} from "./arena-hybrid-events.js";
import {
  allocateDiscreteEventEpoch,
  isAdaptiveArenaSolver,
  type ArenaCpuSolver,
  type ArenaSimulateOptions,
  type ArenaSimulationResult,
  type FlatBytecodeCache,
  type FmuMapping,
  type FrictionStateMapping,
  type SafetyViolationRecord,
  type SimDAEBuilder,
  type VectorStateDescriptor,
} from "./arena-sim-types.js";
import {
  executeArenaSimulation,
  executeArenaSimulationAsync,
  initializeArenaEnvironment,
} from "./arena-simulation-runner.js";
import {
  buildArenaExecutionBlocks,
  identifyArenaDerivatives,
  prepareArenaFrictionMappings,
  projectArenaFrictionRestStates,
  reduceArenaAffineStateConstraints,
  reduceArenaBilinearVolumeStates,
  resolveArenaKinematicVelocities,
  resolveArenaOutputIds,
  resolveArenaParameters,
} from "./arena-structural-reduction.js";
import { CallbackDispatcher, type IntegratorCallback } from "./callbacks.js";
import type {
  ArenaAssertion,
  ArenaEventIndicator,
  ArenaStateMachineRuntime,
  ArenaWhenClause,
  SimulationDebugger,
} from "./simulation.js";
import type { OnlineSTLMonitor, STLStepResult } from "./stl_monitor.js";

export {
  initializeArenaEnvironment,
  type ArenaSimulateOptions,
  type ArenaSimulationResult,
  type VectorStateDescriptor,
};

/**
 * Arena-native DAE/ODE simulation engine operating directly on linear-memory `DAEBuilder` structures.
 *
 * Handles parameter evaluation, Pantelides index reduction, Tarjan BLT causalization,
 * JIT block compilation, hybrid zero-crossing event handling, state machines, and integration
 * via RK4, DOPRI5, BDF, RadauIIA, Symplectic Euler, and SUNDIALS CVODE/IDA WASM.
 */
export class ArenaSimulator {
  /** Resolved parameter and constant values keyed by variable name. */
  public parameters = new Map<string, number>();
  /** Optional interactive debugger hook invoked during equation evaluation and step transitions. */
  public debuggerHook?: SimulationDebugger | undefined;
  /** When true, skips Pantelides index reduction for pre-causalized Index-1 DAEs. */
  public skipPantelides = false;

  /** Recorded safety barrier violations during simulation. */
  public safetyViolations: SafetyViolationRecord[] = [];

  /** Recorded interval / DAE singularity issues. */
  public intervalIssues: string[] = [];

  // Sets of VarIdx for fast arena-native processing
  /** Set of arena variable indices classified as parameters or constants. */
  public parameterVars = new Set<number>();
  /** Set of arena variable indices classified as continuous ODE states ($x$). */
  public stateVars = new Set<number>();
  /** Set of arena variable indices representing state derivatives ($\dot{x}$). */
  public derivativeVars = new Set<number>();
  /** Set of arena variable indices whose derivatives were eliminated by kinematic/affine index reduction. */
  private eliminatedDerVars = new Set<number>();

  /** Topologically sorted equation indices produced by BLT transformation. */
  public sortedEquations: number[] = [];
  /** Strongly connected components (algebraic/causal blocks) produced by Tarjan BLT analysis. */
  public blocks: ArenaBltBlock[] = [];
  /** Set of arena variable indices demoted to algebraic dummy derivatives during Pantelides index reduction. */
  public dummyDerivatives = new Set<number>();
  /** Prepared execution blocks (explicit single assignments and implicit algebraic systems). */
  public executionBlocks: ArenaExecutionBlock[] = [];
  /** Optional JIT-compiled fast-path evaluator for causal execution blocks. */
  public compiledBlocks: ((env: Float64Array) => void) | null = null;
  /** Cached flat bytecode data and WebAssembly memory pointers. */
  public _cachedFlatBytecode: FlatBytecodeCache | null = null;

  /** Extracted when-clauses for event handling. */
  public whenClauses: ArenaWhenClause[] = [];

  /** Extracted assertion equations for runtime checking. */
  public assertions: ArenaAssertion[] = [];

  /** Event indicator functions for zero-crossing detection. */
  public eventIndicators: ArenaEventIndicator[] = [];
  private sampleNextTimeByIdx = new Map<number, number>();
  private wasmEventDetector: WasmEventDetectorBridge | null = null;

  /** State machine runtimes. */
  public stateMachineRuntimes: ArenaStateMachineRuntime[] = [];
  private prevStateMachineTime = -1;
  private readonly warnedAssertions = new WeakSet<ArenaAssertion>();

  /**
   * Optional registry of FMU co-simulation subsystems.
   * When set, the simulator delegates input/step/output for matched variable
   * prefixes to the corresponding FmuSubsystem during each integration step.
   */
  public fmuRegistry?: FmuSubsystemRegistry | undefined;
  public fmuLoader?: ((fmuPath: string, instance: FmuInstanceMetadata) => FmuSubsystem) | undefined;

  /** Cached FMU prefix → subsystem mapping (built once in prepare). */
  private fmuMappings: FmuMapping[] = [];
  /** Cached friction/stiction velocity-state mappings (built once in prepare). */
  private frictionStateMappings: FrictionStateMapping[] = [];

  /** Current discrete-event epoch; incremented whenever discrete variables, state machines, or parameters change. */
  private discreteEventEpoch = allocateDiscreteEventEpoch();
  /** True during intermediate trial-stage ODE RHS evaluations inside adaptive solvers. */
  private inAdaptiveTrialStage = false;
  /** Signaled when an algebraic loop diverges badly during an adaptive trial stage so the solver shrinks step size. */
  private algebraicDivergedInTrialStage = false;
  /** Counter of block evaluations (used to cache event indicator environment synchronization). */
  private blockEvalCount = 0;

  /** Flag indicating whether the prepared system is an unconstrained preserved vector ODE. */
  public isVectorMode = false;
  /** Preserved vector state descriptors for direct vector stepping without scalarization. */
  public vectorStates: VectorStateDescriptor[] = [];

  /** Previous-step variable value buffer indexed by interned string ID (for `pre(v)` and edge detection). */
  public preValuesByStringId!: Float64Array;

  /** Zero-allocation algebraic loop solver owning pre-allocated Newton scratch & warm-start buffers. */
  private readonly algebraicSolver: ArenaAlgebraicSolver;

  /** Unified internal host adapter (allocated once per simulator instance) connecting subsystem modules without leaking public API. */
  private readonly internalHost: ArenaAlgebraicSolverHost &
    ArenaBlockCompilerHost &
    ArenaHybridEventsHost &
    ArenaAdaptiveSolverHost;

  /**
   * Creates a new `ArenaSimulator` bound to a flattened `DAEBuilder` arena.
   *
   * @param arena - Flattened DAE arena containing variables, equations, and expressions.
   */
  constructor(public arena: DAEBuilder) {
    this.internalHost = ArenaSimulator.createInternalHost(this);
    this.algebraicSolver = new ArenaAlgebraicSolver(this.internalHost);
  }

  private static createInternalHost(
    sim: ArenaSimulator,
  ): ArenaAlgebraicSolverHost & ArenaBlockCompilerHost & ArenaHybridEventsHost & ArenaAdaptiveSolverHost {
    return {
      get arena() {
        return sim.arena;
      },
      get stateVars() {
        return sim.stateVars;
      },
      get executionBlocks() {
        return sim.executionBlocks;
      },
      get whenClauses() {
        return sim.whenClauses;
      },
      get assertions() {
        return sim.assertions;
      },
      get eventIndicators() {
        return sim.eventIndicators;
      },
      get stateMachineRuntimes() {
        return sim.stateMachineRuntimes;
      },
      get preValuesByStringId() {
        return sim.preValuesByStringId;
      },
      set preValuesByStringId(v) {
        sim.preValuesByStringId = v;
      },
      get _cachedFlatBytecode() {
        return sim._cachedFlatBytecode;
      },
      set _cachedFlatBytecode(v) {
        sim._cachedFlatBytecode = v;
      },
      get fmuRegistry() {
        return sim.fmuRegistry;
      },
      get fmuLoader() {
        return sim.fmuLoader;
      },
      get fmuMappings() {
        return sim.fmuMappings;
      },
      get frictionStateMappings() {
        return sim.frictionStateMappings;
      },
      get sampleNextTimeByIdx() {
        return sim.sampleNextTimeByIdx;
      },
      get safetyViolations() {
        return sim.safetyViolations;
      },
      set safetyViolations(v) {
        sim.safetyViolations = v;
      },
      get intervalIssues() {
        return sim.intervalIssues;
      },
      set intervalIssues(v) {
        sim.intervalIssues = v;
      },
      getDiscreteEventEpoch: () => sim.discreteEventEpoch,
      bumpDiscreteEventEpoch: () => {
        sim.discreteEventEpoch = allocateDiscreteEventEpoch();
      },
      isInAdaptiveTrialStage: () => sim.inAdaptiveTrialStage,
      markAlgebraicDivergedInTrialStage: () => {
        sim.algebraicDivergedInTrialStage = true;
      },
      getBlockEvalCount: () => sim.blockEvalCount,
      getNewtonScratchDualStack: () => sim.algebraicSolver.newtonScratchDualStack,
      solveNewtonBlock: (block, env) => sim.algebraicSolver.solveNewtonBlock(block, env),
      evaluateBlocks: (env) => sim.evaluateBlocks(env),
      evaluateDerivativeEquations: (env) => sim.evaluateDerivativeEquations(env),
      executeStateMachines: (env) => sim.executeStateMachines(env),
      stepFmuSubsystemsIfAny: (env, t, dt) => {
        if (sim.fmuMappings.length > 0) sim.stepFmuSubsystems(env, t, dt);
      },
      canRunWasmSimulationLoop: () => sim.canRunWasmSimulationLoop(),
      runWasmSimulationLoop: (steps, step, env, stateIds, derivIds, timeId, opts) =>
        sim.runWasmSimulationLoop(steps, step, env, stateIds, derivIds, timeId, opts),
      buildRhsFunction: (env, stateIds, derivIds, timeId) => sim.buildRhsFunction(env, stateIds, derivIds, timeId),
      processWhenClauses: (env) => sim.processWhenClauses(env),
      checkIntervalSafetyBarriers: (env, stateIds, t) => sim.checkIntervalSafetyBarriers(env, stateIds, t),
    };
  }

  /** Returns the linear-memory WASM EventDetector bridge if available for this arena. */
  public getWasmEventDetector(): WasmEventDetectorBridge | null {
    if (this.wasmEventDetector) return this.wasmEventDetector;
    if (this.arena.ptr === 0) return null;
    try {
      this.wasmEventDetector = new WasmEventDetectorBridge(this.arena.ptr);
      return this.wasmEventDetector;
    } catch {
      return null;
    }
  }

  /**
   * Prepares the DAE arena for numerical integration: scalarizes array equations, resolves parameters,
   * reduces high-index constraints (Pantelides + affine/kinematic reduction), performs Tarjan BLT
   * causalization, compiles execution blocks, and extracts hybrid events, assertions, and state machines.
   */
  prepare() {
    this.discreteEventEpoch = allocateDiscreteEventEpoch();
    this.algebraicSolver.resetWarmStart();
    this.eliminatedDerVars.clear();
    const preOverrides = this.parameters.size > 0 ? new Map(this.parameters) : null;

    let hasPreservedArrays = hasArrayEquations(this.arena);
    if (!hasPreservedArrays) {
      for (let i = 0; i < this.arena.varCount; i++) {
        if (!this.arena.isVarRemoved(i) && this.arena.getVarShape(i).length > 0) {
          hasPreservedArrays = true;
          break;
        }
      }
    }
    if (hasPreservedArrays) {
      if (detectPreservedVectorODE(this.arena, this.parameters, this.vectorStates, preOverrides)) {
        this.isVectorMode = true;
        return;
      }
      this.arena = (scalarizeArena as (arena: DAEBuilder, forceFullScalarize?: boolean) => DAEBuilder)(
        this.arena,
        true,
      );
      foldArenaConstants(this.arena);
      eliminateArenaAliases(this.arena);
    }

    const simArena = this.arena as SimDAEBuilder;
    const cachedPrep = simArena._cachedSimPrep;
    const canUseCachedPrep =
      cachedPrep &&
      (!preOverrides || Array.from(preOverrides.entries()).every(([k, v]) => cachedPrep.parameters.get(k) === v));
    if (canUseCachedPrep) {
      this.parameters = new Map(cachedPrep.parameters);
      if (preOverrides) {
        for (const [k, v] of preOverrides) this.parameters.set(k, v);
      }
      this.parameterVars = new Set(cachedPrep.parameterVars);
      for (const i of this.parameterVars) {
        if (this.arena.isVarRemoved(i)) continue;
        const name = this.arena.getVarName(i);
        if (preOverrides && preOverrides.has(name)) {
          this.parameters.set(name, preOverrides.get(name)!);
          continue;
        }
        const exprId = typeof this.arena.getVarExpression === "function" ? this.arena.getVarExpression(i) : undefined;
        let val: number | null = null;
        if (typeof exprId === "number" && exprId !== -1) {
          const rawVal = evaluateArenaExpression(this.arena, exprId, this.parameters);
          if (typeof rawVal === "number" && isFinite(rawVal)) {
            val = rawVal;
          }
        }
        if (val === null || typeof val !== "number" || !isFinite(val)) {
          val = this.arena.getVarStartValue(i);
        }
        this.parameters.set(name, val);
      }
      this.stateVars = new Set(cachedPrep.stateVars);
      this.derivativeVars = new Set(cachedPrep.derivativeVars);
      this.dummyDerivatives = new Set(cachedPrep.dummyDerivatives);
      this.sortedEquations = cachedPrep.sortedEquations;
      this.blocks = cachedPrep.blocks;
      this.executionBlocks = cachedPrep.executionBlocks;
      this.preValuesByStringId = new Float64Array(this.arena.interner.size);
      simArena._delayHistory = new Map();
      this.finishPrepareSubsystems();
      return;
    }

    this.arena.isMutatedBySim = true;
    simArena._delayHistory = new Map();
    this.preValuesByStringId = new Float64Array(this.arena.interner.size);
    resolveArenaParameters(this.arena, this.parameters, this.parameterVars, this.stateVars, preOverrides);
    resolveArenaKinematicVelocities(this.arena, this.parameters, this.parameterVars, this.eliminatedDerVars);
    reduceArenaAffineStateConstraints(this.arena, this.parameters, this.parameterVars, this.eliminatedDerVars);
    reduceArenaBilinearVolumeStates(this.arena, this.parameterVars, this.eliminatedDerVars);
    identifyArenaDerivatives(
      this.arena,
      this.stateVars,
      this.derivativeVars,
      this.parameterVars,
      this.eliminatedDerVars,
    );

    // Arena-Native Pantelides Index Reduction
    if (this.skipPantelides) {
      this.dummyDerivatives = new Set<number>();
    } else {
      const pantelidesRes = pantelidesIndexReductionArena(
        this.arena,
        this.stateVars,
        this.derivativeVars,
        this.parameterVars,
      );
      this.dummyDerivatives = pantelidesRes.dummyDerivatives;
    }

    // Arena-Native BLT / Bipartite Matching
    const bltRes = performBltTransformationArena(this.arena, this.stateVars, this.dummyDerivatives, this.parameterVars);
    this.sortedEquations = bltRes.sortedEquations;
    this.blocks = bltRes.blocks;

    buildArenaExecutionBlocks(
      this.arena,
      this.blocks,
      this.sortedEquations,
      this.stateVars,
      this.derivativeVars,
      this.executionBlocks,
    );
    simArena._cachedSimPrep = {
      parameters: new Map(this.parameters),
      parameterVars: new Set(this.parameterVars),
      stateVars: new Set(this.stateVars),
      derivativeVars: new Set(this.derivativeVars),
      dummyDerivatives: new Set(this.dummyDerivatives),
      sortedEquations: this.sortedEquations,
      blocks: this.blocks,
      executionBlocks: this.executionBlocks,
    };

    this.finishPrepareSubsystems();
  }

  private finishPrepareSubsystems(): void {
    this.compiledBlocks = compileArenaBlocks(this.internalHost);
    this.whenClauses = extractArenaWhenClauses(this.arena);
    this.assertions = extractArenaAssertions(this.arena);
    this.eventIndicators = extractArenaEventIndicators(this.arena, this.whenClauses, this.parameters);
    this.prevStateMachineTime = -1;
    this.stateMachineRuntimes = extractArenaStateMachines(this.arena);
    this.prepareFmuMappings();
    this.frictionStateMappings = prepareArenaFrictionMappings(this.arena, this.stateVars, this.parameters);
  }

  /**
   * Directly integrates an unconstrained preserved vector ODE without expanding
   * variables or execution blocks in linear memory.
   */
  public simulateVector(options?: ArenaSimulateOptions): ArenaSimulationResult {
    return runPreservedVectorODE(this.arena, this.vectorStates, options);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FMU Co-Simulation Bridge
  // ─────────────────────────────────────────────────────────────────────────

  /** Build the prefix→subsystem mappings from the FMU registry. */
  private prepareFmuMappings(): void {
    this.fmuMappings = [];

    // Auto-register FMU subsystems from arena.extensionMetadata.fmuInstances if present
    const fmuInstances = this.arena.extensionMetadata?.["fmuInstances"] as FmuInstanceMetadata[] | undefined;
    if (Array.isArray(fmuInstances) && fmuInstances.length > 0) {
      if (!this.fmuRegistry) {
        this.fmuRegistry = new FmuSubsystemRegistry();
      }
      for (const inst of fmuInstances) {
        if (!this.fmuRegistry.has(inst.instanceName)) {
          const sub =
            this.fmuLoader?.(inst.fmuPath, inst) ??
            new DefaultFmuSubsystem(inst.instanceName || "fmu", inst.inputs, inst.outputs, inst.parameters);
          this.fmuRegistry.register(inst.instanceName, sub);
        }
      }
    }

    if (!this.fmuRegistry) return;

    for (const [prefix, subsystem] of this.fmuRegistry.entries()) {
      const inputIds = subsystem.inputNames.map((n) => this.arena.interner.intern(prefix ? `${prefix}.${n}` : n));
      const outputIds = subsystem.outputNames.map((n) => this.arena.interner.intern(prefix ? `${prefix}.${n}` : n));
      this.fmuMappings.push({ prefix, subsystem, inputIds, outputIds });
    }
  }

  /**
   * Drive all registered FMU subsystems for one communication step.
   */
  private stepFmuSubsystems(valuesByStringId: Float64Array, currentTime: number, stepSize: number): void {
    for (const mapping of this.fmuMappings) {
      const inputs = new Map<string, number>();
      for (let i = 0; i < mapping.subsystem.inputNames.length; i++) {
        const nameId = mapping.inputIds[i];
        if (nameId !== undefined) {
          inputs.set(mapping.subsystem.inputNames[i] ?? "", valuesByStringId[nameId] ?? 0);
        }
      }

      mapping.subsystem.setInputs(inputs);
      mapping.subsystem.doStep(currentTime, stepSize);
      const outputs = mapping.subsystem.getOutputs();

      for (let i = 0; i < mapping.subsystem.outputNames.length; i++) {
        const nameId = mapping.outputIds[i];
        const outName = mapping.subsystem.outputNames[i] ?? "";
        if (nameId !== undefined) {
          valuesByStringId[nameId] = outputs.get(outName) ?? 0;
        }
      }
    }
  }

  /**
   * Initialize all registered FMU subsystems. Should be called once before
   * the integration loop begins (after prepare() and before simulate()).
   */
  public initializeFmuSubsystems(startTime: number, stopTime: number, stepSize: number): void {
    this.fmuRegistry?.initializeAll(startTime, stopTime, stepSize);
  }

  /** Terminate all registered FMU subsystems (cleanup). */
  public terminateFmuSubsystems(): void {
    this.fmuRegistry?.terminateAll();
  }

  /**
   * Placeholder hook for evaluating explicit derivative equations (now scheduled
   * directly inside the topological BLT execution blocks).
   */
  public evaluateDerivativeEquations(_valuesByStringId: Float64Array): void {
    // Handled by BLT
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bytecode & WASM Simulation Loop
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Prepares and caches the flat linear bytecode representation of execution blocks
   * along with WebAssembly linear memory allocations if available.
   */
  public prepareFlatBytecode(): FlatBytecodeCache | null {
    return prepareArenaFlatBytecode(this.internalHost);
  }

  /**
   * Determines whether the current model can be integrated directly inside WebAssembly linear memory
   * using sim_runBytecodeSimulationLoop without host context-switching.
   */
  public canRunWasmSimulationLoop(): boolean {
    return canRunArenaWasmSimulationLoop(this.internalHost);
  }

  /**
   * Runs the full time-stepping simulation loop directly in WebAssembly linear memory,
   * generating a zero-copy trajectory buffer and eliminating per-step host transitions.
   */
  public runWasmSimulationLoop(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
    options?: {
      solver?: string | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      safetySpec?:
        | {
            invariants?: Array<{ expr: string }>;
            guarantees?: Array<{ expr: string }>;
            [key: string]: unknown;
          }
        | undefined;
      safetyMode?: string | undefined;
      intervalMode?: boolean | undefined;
      outputStringIds?: number[] | undefined;
    },
  ): {
    t: number[];
    y: Float64Array[];
    terminatedEarly: boolean;
    safetyViolations: SafetyViolationRecord[];
    intervalIssues: string[];
  } {
    return runArenaWasmSimulationLoop(
      this.internalHost,
      steps,
      step,
      valuesByStringId,
      stateStringIds,
      derivStringIds,
      timeId,
      options,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Block Evaluation, Hybrid Events & Safety Barriers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluates all topological BLT execution blocks (`single` assignments and `system` algebraic loops)
   * in causal order, updating `valuesByStringId` in-place via the JIT-compiled closure when available.
   */
  public evaluateBlocks(valuesByStringId: Float64Array): void {
    this.blockEvalCount++;
    if (this.compiledBlocks) {
      this.compiledBlocks(valuesByStringId);
      return;
    }
    for (const block of this.executionBlocks) {
      if (block.type === "single") {
        const val = evaluateArenaRuntime(this.arena, block.exprId, valuesByStringId, this.preValuesByStringId);
        const varNameId = this.arena.getVarNameId(block.varIdx);
        valuesByStringId[varNameId] = val;
      } else if (block.type === "system") {
        this.algebraicSolver.solveNewtonBlock(block, valuesByStringId);
      }
    }
  }

  private executeStateMachines(valuesByStringId: Float64Array): void {
    this.prevStateMachineTime = executeArenaStateMachines(
      this.arena,
      this.stateMachineRuntimes,
      valuesByStringId,
      this.preValuesByStringId,
      this.prevStateMachineTime,
    );
  }

  private checkAssertions(valuesByStringId: Float64Array, t: number): void {
    checkArenaAssertions(this.arena, this.assertions, this.warnedAssertions, valuesByStringId, t);
  }

  private processWhenClauses(valuesByStringId: Float64Array): void {
    processArenaWhenClauses(this.internalHost, valuesByStringId);
  }

  /**
   * Constructs a pure ODE right-hand side closure `(t, y) => dy/dt` for adaptive
   * integrators (Dopri5, Tsit5, BDF, Rodas4P, TR-BDF2).
   */
  private buildRhsFunction(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
  ): (t: number, y: number[]) => number[] {
    const n = stateStringIds.length;
    let epochEvalCount = 0;
    let seenEpoch = this.discreteEventEpoch;
    return (t: number, y: number[]): number[] => {
      if (this.discreteEventEpoch !== seenEpoch) {
        seenEpoch = this.discreteEventEpoch;
        epochEvalCount = 0;
      }
      epochEvalCount++;

      // Write state into the environment
      valuesByStringId[timeId] = t;
      for (let i = 0; i < n; i++) {
        valuesByStringId[stateStringIds[i] ?? -1] = y[i] ?? 0;
      }
      // Evaluate all blocks and derivative equations.
      // NOTE: When-clauses and state machines are NOT evaluated here because
      // they have memory (wasActive, activeState) that would be corrupted by
      // the intermediate trial-point evaluations of adaptive RK stages.
      // They are processed exclusively in the event callback.
      this.inAdaptiveTrialStage = epochEvalCount > 1;
      this.algebraicDivergedInTrialStage = false;
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
      this.inAdaptiveTrialStage = false;
      if (this.algebraicDivergedInTrialStage) {
        return new Array<number>(n).fill(NaN);
      }
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, t, 0);
      this.checkAssertions(valuesByStringId, t);

      // Read derivatives
      const dydt = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        dydt[i] = valuesByStringId[derivStringIds[i] ?? -1] ?? 0;
      }
      return dydt;
    };
  }

  /**
   * Checks numerical variables against interval bounds, min/max attributes, and domain singularities.
   */
  public checkIntervalSafetyBarriers(
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    currentTime: number,
  ): void {
    checkArenaIntervalSafetyBarriers(this.arena, this.intervalIssues, valuesByStringId, stateStringIds, currentTime);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Simulation (multi-solver: Euler, RK4, Dopri5, Tsit5, BDF, CVODE, ...)
  // ─────────────────────────────────────────────────────────────────────────

  private advanceFixedStep(
    solver: "euler" | "rk4",
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    timeId: number,
    currentTime: number,
  ): void {
    if (solver === "rk4") {
      const numEi = this.eventIndicators.length;
      if (numEi > 0) {
        const envStart = new Float64Array(valuesByStringId);
        const warmStartVals = new Float64Array(this.algebraicSolver.algWarmStartVals);
        const warmStartValid = new Uint8Array(this.algebraicSolver.algWarmStartValid);
        const eiStart = new Float64Array(numEi);
        for (let k = 0; k < numEi; k++) {
          eiStart[k] = evaluateArenaRuntime(this.arena, this.eventIndicators[k]!.exprId, valuesByStringId);
        }

        this.rk4Step(step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
        valuesByStringId[timeId] = currentTime + step;
        this.evaluateBlocks(valuesByStringId);

        let crossed = false;
        for (let k = 0; k < numEi; k++) {
          const v0 = eiStart[k]!;
          const v1 = evaluateArenaRuntime(this.arena, this.eventIndicators[k]!.exprId, valuesByStringId);
          if ((v0 > 0 && v1 < 0) || (v0 < 0 && v1 > 0)) {
            crossed = true;
            break;
          }
        }

        if (crossed) {
          let lo = 0;
          let hi = step;
          for (let b = 0; b < 16; b++) {
            const mid = 0.5 * (lo + hi);
            valuesByStringId.set(envStart);
            this.algebraicSolver.restoreWarmStart(warmStartVals, warmStartValid);
            this.rk4Step(mid, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
            valuesByStringId[timeId] = currentTime + mid;
            this.evaluateBlocks(valuesByStringId);
            let midCrossed = false;
            for (let k = 0; k < numEi; k++) {
              const v0 = eiStart[k]!;
              const vm = evaluateArenaRuntime(this.arena, this.eventIndicators[k]!.exprId, valuesByStringId);
              if ((v0 > 0 && vm < 0) || (v0 < 0 && vm > 0)) {
                midCrossed = true;
                break;
              }
            }
            if (midCrossed) {
              hi = mid;
            } else {
              lo = mid;
            }
          }

          // Advance to hi (just past the event crossing), re-evaluate blocks & derivatives, then step remaining time
          valuesByStringId.set(envStart);
          this.algebraicSolver.restoreWarmStart(warmStartVals, warmStartValid);
          this.rk4Step(hi, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
          valuesByStringId[timeId] = currentTime + hi;
          this.evaluateBlocks(valuesByStringId);
          this.evaluateDerivativeEquations(valuesByStringId);
          this.processWhenClauses(valuesByStringId);

          const remStep = step - hi;
          if (remStep > 1e-15) {
            this.rk4Step(remStep, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime + hi);
          }
        }
      } else {
        this.rk4Step(step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      }
    } else {
      // Forward Euler
      const n = stateStringIds.length;
      const y0Euler = new Float64Array(n);
      for (let i = 0; i < n; i++) y0Euler[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      for (let i = 0; i < n; i++) {
        const stateId = stateStringIds[i] ?? -1;
        const derivId = derivStringIds[i] ?? -1;
        if (derivId !== -1 && stateId !== -1) {
          valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + step * (valuesByStringId[derivId] ?? 0);
        }
      }
      projectArenaFrictionRestStates(this.frictionStateMappings, y0Euler, valuesByStringId, stateStringIds);
    }
  }

  /**
   * Synchronously integrates the prepared DAE system over `steps` output intervals of width `step`,
   * supporting fixed-step (`"euler"`, `"rk4"`) and adaptive (`"dopri5"`, `"tsit5"`, `"bdf"`,
   * `"rodas4p"`, `"trbdf2"`, `"auto"`) solvers, online STL safety barrier monitors, and interval checks.
   */
  simulate(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      solver?: ArenaCpuSolver | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
      stlMonitors?: OnlineSTLMonitor[] | undefined;
      earlyTerminateOnViolation?: boolean | undefined;
      intervalBarrierCheck?: boolean | undefined;
      onStepViolation?:
        ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void) | undefined;
      callbacks?: IntegratorCallback[] | undefined;
    },
  ) {
    if (this.isVectorMode) {
      return this.simulateVector({
        numberOfIntervals: steps,
        step,
        solver: options?.solver,
      }) as unknown as {
        t: number[];
        y: Float64Array[];
        terminatedEarly: boolean;
        safetyViolations: SafetyViolationRecord[];
        intervalIssues: string[];
      };
    }
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const n = stateStringIds.length;
    const startTime = valuesByStringId[timeId] ?? 0;

    this.preValuesByStringId = new Float64Array(valuesByStringId.length);
    this.preValuesByStringId.set(valuesByStringId);

    // Execute initial algorithm sections (unless already executed by solveInitialEquationsArena)
    if (!(this.arena as SimDAEBuilder)._initialAlgorithmsExecuted) {
      for (const sec of this.arena.initialAlgorithmSections) {
        executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
      }
    }

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = startTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }
    // Initialize event indicator previous values
    for (const ei of this.eventIndicators) {
      ei.prevValue = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
    }

    // ── Adaptive & Quantized-State solvers ──
    if (isAdaptiveArenaSolver(solver)) {
      return runArenaAdaptiveSimulation(
        this.internalHost,
        solver,
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        options,
      );
    }
    if (solver === "cvode") {
      throw new Error("CVODE solver requires simulateAsync instead of simulate");
    }

    // ── Fixed-step solvers (RK4, Euler) ──
    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = startTime;

    this.safetyViolations = [];
    this.intervalIssues = [];
    const stlMonitors = options?.stlMonitors ?? [];
    for (const m of stlMonitors) m.reset();
    let terminatedEarly = false;

    const callbackDispatcher = new CallbackDispatcher(options?.callbacks, startTime);
    const stateIndexMap = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const sName = this.arena.interner.resolve(stateStringIds[i]!);
      if (sName) stateIndexMap.set(sName, i);
    }

    // ── In-WASM Simulation Fast Path ──
    if (
      (solver === "euler" || solver === "rk4") &&
      stlMonitors.length === 0 &&
      !callbackDispatcher.hasCallbacks &&
      !options?.intervalBarrierCheck &&
      this.eventIndicators.length === 0 &&
      this.whenClauses.length === 0 &&
      this.stateMachineRuntimes.length === 0 &&
      this.fmuMappings.length === 0 &&
      this.arena.algorithmSections.length === 0 &&
      this.frictionStateMappings.length === 0 &&
      this.assertions.length === 0 &&
      this.canRunWasmSimulationLoop()
    ) {
      return this.runWasmSimulationLoop(steps, step, valuesByStringId, stateStringIds, derivStringIds, timeId, options);
    }

    for (let s = 0; s <= steps; s++) {
      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
      this.preValuesByStringId.set(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, step);
      this.checkAssertions(valuesByStringId, currentTime);

      // Run regular algorithm sections
      for (const sec of this.arena.algorithmSections) {
        executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
      }

      // Record output
      const outIds = resolveArenaOutputIds(this.arena, options?.outputStringIds ?? stateStringIds);
      const currentState = new Float64Array(outIds.length);
      for (let i = 0; i < outIds.length; i++) {
        currentState[i] = valuesByStringId[outIds[i] ?? -1] ?? 0;
      }
      t_out.push(currentTime);
      y_out.push(currentState);

      // ── Safety barrier monitoring (STL) ──
      if (stlMonitors.length > 0) {
        for (const mon of stlMonitors) {
          const stepRes = mon.step(currentTime, currentState);
          if (stepRes.isViolated) {
            this.safetyViolations.push({
              t: currentTime,
              monitorName: mon.options.requirementName ?? "STL Safety Barrier",
              robustness: stepRes.robustness,
              details: `Safety barrier breached at t=${currentTime.toFixed(4)}s: rho=${stepRes.robustness.toFixed(4)} < 0`,
            });
            if (options?.onStepViolation) {
              options.onStepViolation(currentTime, currentState, mon, stepRes);
            }
            if (stepRes.shouldTerminate || options?.earlyTerminateOnViolation) {
              terminatedEarly = true;
              break;
            }
          }
        }
        if (terminatedEarly) break;
      }

      // ── Dynamic Callbacks Dispatch ──
      if (callbackDispatcher.hasCallbacks) {
        const controls = callbackDispatcher.step(currentTime, currentState, stateIndexMap, this.parameters);
        if (controls.discontinuityOccurred) {
          for (let i = 0; i < n; i++) {
            valuesByStringId[stateStringIds[i] ?? -1] = currentState[i] ?? 0;
          }
          this.evaluateBlocks(valuesByStringId);
          this.evaluateDerivativeEquations(valuesByStringId);
        }
        if (controls.terminated) {
          terminatedEarly = true;
          break;
        }
      }

      // ── Interval / singularity barrier check ──
      if (options?.intervalBarrierCheck) {
        this.checkIntervalSafetyBarriers(valuesByStringId, stateStringIds, currentTime);
        if (this.intervalIssues.length > 0 && options?.earlyTerminateOnViolation) {
          terminatedEarly = true;
          break;
        }
      }

      if (s === steps) break;

      this.advanceFixedStep(solver, step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      currentTime += step;
    }

    return {
      t: t_out,
      y: y_out,
      terminatedEarly,
      safetyViolations: this.safetyViolations,
      intervalIssues: this.intervalIssues,
    };
  }

  /**
   * Advances the DAE simulation by a single time step (dt).
   *
   * Evaluates algebraic blocks, event indicators, when clauses,
   * advances states using RK4 or Euler, and updates time to t + dt.
   */
  public step(
    dt: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      solver?: "euler" | "rk4" | undefined;
    },
  ): void {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const currentTime = valuesByStringId[timeId] ?? 0;
    const n = stateStringIds.length;

    if (!this.preValuesByStringId || this.preValuesByStringId.length !== valuesByStringId.length) {
      this.preValuesByStringId = new Float64Array(valuesByStringId.length);
      this.preValuesByStringId.set(valuesByStringId);
    }

    // Evaluate at current time
    valuesByStringId[timeId] = currentTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    this.preValuesByStringId.set(valuesByStringId);
    this.executeStateMachines(valuesByStringId);
    this.processWhenClauses(valuesByStringId);
    if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, dt);
    this.checkAssertions(valuesByStringId, currentTime);

    // Run regular algorithm sections
    for (const sec of this.arena.algorithmSections) {
      executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
    }

    // Integrate state variables
    if (solver === "rk4") {
      this.rk4Step(dt, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
    } else {
      const y0Euler = new Float64Array(n);
      for (let i = 0; i < n; i++) y0Euler[i] = valuesByStringId[stateStringIds[i] ?? -1] ?? 0;
      for (let i = 0; i < n; i++) {
        const stateId = stateStringIds[i] ?? -1;
        const derivId = derivStringIds[i] ?? -1;
        if (derivId !== -1 && stateId !== -1) {
          valuesByStringId[stateId] = (valuesByStringId[stateId] ?? 0) + dt * (valuesByStringId[derivId] ?? 0);
        }
      }
      projectArenaFrictionRestStates(this.frictionStateMappings, y0Euler, valuesByStringId, stateStringIds);
    }

    const nextTime = currentTime + dt;
    valuesByStringId[timeId] = nextTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
  }

  /**
   * Classical 4th-order Runge-Kutta step.
   * Updates state variables in valuesByStringId in-place.
   */
  public rk4Step(
    h: number,
    vals: Float64Array,
    stateIds: number[],
    derivIds: number[],
    timeId: number,
    t: number,
  ): void {
    const n = stateIds.length;

    // Save initial states
    const y0 = new Float64Array(n);
    for (let i = 0; i < n; i++) y0[i] = vals[stateIds[i] ?? -1] ?? 0;

    // k1 = f(t, y0) — already evaluated by evaluateBlocks + evaluateDerivativeEquations
    const k1 = new Float64Array(n);
    for (let i = 0; i < n; i++) k1[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k2 = f(t + h/2, y0 + h/2 * k1)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + 0.5 * h * (k1[i] as number);
    }
    vals[timeId] = t + 0.5 * h;
    this.evaluateBlocks(vals);
    this.evaluateDerivativeEquations(vals);
    const k2 = new Float64Array(n);
    for (let i = 0; i < n; i++) k2[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k3 = f(t + h/2, y0 + h/2 * k2)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + 0.5 * h * (k2[i] as number);
    }
    this.evaluateBlocks(vals);
    this.evaluateDerivativeEquations(vals);
    const k3 = new Float64Array(n);
    for (let i = 0; i < n; i++) k3[i] = vals[derivIds[i] ?? -1] ?? 0;

    // k4 = f(t + h, y0 + h * k3)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] = (y0[i] as number) + h * (k3[i] as number);
    }
    vals[timeId] = t + h;
    this.evaluateBlocks(vals);
    this.evaluateDerivativeEquations(vals);
    const k4 = new Float64Array(n);
    for (let i = 0; i < n; i++) k4[i] = vals[derivIds[i] ?? -1] ?? 0;

    // y_new = y0 + (h/6) * (k1 + 2*k2 + 2*k3 + k4)
    for (let i = 0; i < n; i++) {
      vals[stateIds[i] ?? -1] =
        (y0[i] as number) +
        (h / 6.0) * ((k1[i] as number) + 2 * (k2[i] as number) + 2 * (k3[i] as number) + (k4[i] as number));
    }
    projectArenaFrictionRestStates(this.frictionStateMappings, y0, vals, stateIds);
  }

  /**
   * Asynchronously integrates the prepared DAE system over `steps` intervals of size `step`,
   * supporting SUNDIALS CVODE WASM (`solver: "cvode"`), interactive DAP debugger hooks,
   * cooperative event-loop yielding, and `AbortSignal` cancellation.
   */
  async simulateAsync(
    steps: number,
    step: number,
    valuesByStringId: Float64Array,
    stateStringIds: number[],
    derivStringIds: number[],
    options?: {
      signal?: AbortSignal | undefined;
      solver?: ArenaCpuSolver | undefined;
      atol?: number | undefined;
      rtol?: number | undefined;
      outputStringIds?: number[] | undefined;
    },
  ) {
    const solver = options?.solver ?? "rk4";
    const timeId = this.arena.interner.intern("time");
    const startTime = valuesByStringId[timeId] ?? 0;

    this.preValuesByStringId = new Float64Array(valuesByStringId.length);
    this.preValuesByStringId.set(valuesByStringId);

    // Execute initial algorithm sections (unless already executed by solveInitialEquationsArena)
    if (!(this.arena as SimDAEBuilder)._initialAlgorithmsExecuted) {
      for (const sec of this.arena.initialAlgorithmSections) {
        if (this.debuggerHook) {
          await executeArenaStatementsAsync(
            this.arena,
            sec.start,
            sec.count,
            valuesByStringId,
            undefined,
            this.debuggerHook,
          );
        } else {
          executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
        }
      }
    }

    // Initialize when-clause wasActive flags
    valuesByStringId[timeId] = startTime;
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);
    for (const clause of this.whenClauses) {
      const condVal = evaluateArenaRuntime(this.arena, clause.conditionExprId, valuesByStringId);
      clause.wasActive = condVal !== 0;
    }
    for (const ei of this.eventIndicators) {
      ei.prevValue = evaluateArenaRuntime(this.arena, ei.exprId, valuesByStringId);
    }

    if (solver === "cvode") {
      if (options?.signal?.aborted) throw new Error("Simulation aborted");
      const { loadSundialsWasm, CvodeSolver } = await import("../solvers/sundials-wasm.js");
      const wasmMod = await loadSundialsWasm();
      return runArenaCvodeWasm(
        this.internalHost,
        wasmMod,
        CvodeSolver,
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        options,
      );
    }

    // Adaptive & Quantized-State solvers run synchronously (they're CPU-bound; yielding inside would break solver state)
    if (isAdaptiveArenaSolver(solver)) {
      if (options?.signal?.aborted) throw new Error("Simulation aborted");
      return runArenaAdaptiveSimulation(
        this.internalHost,
        solver,
        steps,
        step,
        valuesByStringId,
        stateStringIds,
        derivStringIds,
        timeId,
        options,
      );
    }

    // Fixed-step with async yielding
    const t_out: number[] = [];
    const y_out: Float64Array[] = [];
    let currentTime = startTime;

    for (let s = 0; s <= steps; s++) {
      if (options?.signal?.aborted) {
        throw new Error("Simulation aborted");
      }

      // Yield to the event loop every 100 steps
      if (s % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      valuesByStringId[timeId] = currentTime;
      this.evaluateBlocks(valuesByStringId);
      this.evaluateDerivativeEquations(valuesByStringId);
      this.preValuesByStringId.set(valuesByStringId);
      this.executeStateMachines(valuesByStringId);
      this.processWhenClauses(valuesByStringId);
      if (this.fmuMappings.length > 0) this.stepFmuSubsystems(valuesByStringId, currentTime, step);
      this.checkAssertions(valuesByStringId, currentTime);

      // Run regular algorithm sections
      for (const sec of this.arena.algorithmSections) {
        if (this.debuggerHook) {
          await executeArenaStatementsAsync(
            this.arena,
            sec.start,
            sec.count,
            valuesByStringId,
            undefined,
            this.debuggerHook,
          );
        } else {
          executeArenaStatements(this.arena, sec.start, sec.count, valuesByStringId);
        }
      }

      // Record output
      const outIds = resolveArenaOutputIds(this.arena, options?.outputStringIds ?? stateStringIds);
      const currentState = new Float64Array(outIds.length);
      for (let i = 0; i < outIds.length; i++) {
        currentState[i] = valuesByStringId[outIds[i] ?? -1] ?? 0;
      }
      t_out.push(currentTime);
      y_out.push(currentState);

      this.advanceFixedStep(solver, step, valuesByStringId, stateStringIds, derivStringIds, timeId, currentTime);
      currentTime += step;
    }

    return { t: t_out, y: y_out };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RHS & Forward-Mode AD Jacobian Evaluation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Evaluate the RHS (derivatives) of the ODE system at a given point.
   *
   * @param time          Current time
   * @param stateValues   Current state variable values
   * @param controlValues Current control variable values (overrides parameters)
   * @returns Map from state name to derivative value (dx/dt)
   */
  public evaluateRHS(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
  ): Map<string, number> {
    const envSize = Math.max(this.arena.interner.size + 256, 4096);
    const valuesByStringId = new Float64Array(envSize);

    // Load parameters
    for (const [name, val] of this.parameters) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }

    // Load states
    for (const [name, val] of stateValues) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }

    // Load controls
    if (controlValues) {
      for (const [name, val] of controlValues) {
        valuesByStringId[this.arena.interner.intern(name)] = val;
      }
    }

    const timeId = this.arena.interner.intern("time");
    valuesByStringId[timeId] = time;

    // Evaluate blocks and derivatives
    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);

    const f = new Map<string, number>();
    for (const varIdx of this.stateVars) {
      const name = this.arena.getVarName(varIdx);
      const derId = this.arena.interner.intern(`der(${name})`);
      f.set(name, valuesByStringId[derId] ?? 0);
    }
    return f;
  }

  /**
   * Evaluate the RHS and its Jacobian w.r.t a set of seed variables using forward-mode AD.
   *
   * @param time          Current time
   * @param stateValues   Current state variable values
   * @param controlValues Current control variable values
   * @param seedVars      Variables to compute derivatives with respect to
   * @returns { f: Map<stateName, dx/dt>, J: Map<stateName, Map<seedVar, ∂f/∂seedVar>> }
   */
  public evaluateRHSWithJacobian(
    time: number,
    stateValues: Map<string, number>,
    controlValues?: Map<string, number>,
    seedVars?: string[],
  ): { f: Map<string, number>; J: Map<string, Map<string, number>> } {
    const allSeedVars = seedVars ?? [
      ...Array.from(stateValues.keys()),
      ...(controlValues ? Array.from(controlValues.keys()) : []),
    ];

    // Compute base values using evaluateRHS
    const envSize = Math.max(this.arena.interner.size + 256, 4096);
    const valuesByStringId = new Float64Array(envSize);

    for (const [name, val] of this.parameters) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }
    for (const [name, val] of stateValues) {
      valuesByStringId[this.arena.interner.intern(name)] = val;
    }
    if (controlValues) {
      for (const [name, val] of controlValues) {
        valuesByStringId[this.arena.interner.intern(name)] = val;
      }
    }
    const timeId = this.arena.interner.intern("time");
    valuesByStringId[timeId] = time;

    this.evaluateBlocks(valuesByStringId);
    this.evaluateDerivativeEquations(valuesByStringId);

    const f = new Map<string, number>();
    for (const varIdx of this.stateVars) {
      const name = this.arena.getVarName(varIdx);
      const derId = this.arena.interner.intern(`der(${name})`);
      f.set(name, valuesByStringId[derId] ?? 0);
    }

    const J = new Map<string, Map<string, number>>();
    for (const varIdx of this.stateVars) {
      J.set(this.arena.getVarName(varIdx), new Map());
    }

    // Propagate dual numbers for each seed variable
    for (const seedVar of allSeedVars) {
      const dualEnv = new Array<Dual>(envSize);

      // Load all variables into the dual env from our base evaluation
      for (let sid = 0; sid < envSize; sid++) {
        const val = valuesByStringId[sid] ?? 0;
        dualEnv[sid] = Dual.constant(val);
      }

      // Perturb the seed variable with dot = 1.0
      const seedNameId = this.arena.interner.intern(seedVar);
      if (seedNameId < envSize) {
        const val = valuesByStringId[seedNameId] ?? 0;
        dualEnv[seedNameId] = new Dual(val, 1.0);
      }

      // Propagate dual numbers through blocks in execution order
      for (const block of this.executionBlocks) {
        if (block.type === "single") {
          const val = evaluateArenaDualExpression(this.arena, block.exprId, dualEnv);
          if (val !== null) {
            const varNameId = this.arena.getVarNameId(block.varIdx);
            dualEnv[varNameId] = val;
          }
        } else if (block.type === "system") {
          this.propagateSystemBlockDual(block, valuesByStringId, dualEnv);
        }
      }

      // Read sensitivities for each state
      for (const varIdx of this.stateVars) {
        const name = this.arena.getVarName(varIdx);
        const derId = this.arena.interner.intern(`der(${name})`);
        const dualDerVal = dualEnv[derId];
        const sensitivity = dualDerVal ? dualDerVal.dot : 0;
        J.get(name)!.set(seedVar, sensitivity);
      }
    }

    return { f, J };
  }

  /**
   * Propagates forward-mode dual sensitivities through a coupled algebraic system block
   * $F(z, y(s), s) = \text{lhs} - \text{rhs} = 0$ via the Implicit Function Theorem:
   * $$J_{\text{alg}} \dot{z} = -\left.\frac{\partial F}{\partial s}\right|_{\dot{z}=0}$$
   */
  public propagateSystemBlockDual(
    block: Extract<ArenaExecutionBlock, { type: "system" }>,
    valuesByStringId: Float64Array,
    dualEnv: Dual[],
  ): void {
    this.algebraicSolver.propagateSystemBlockDual(block, valuesByStringId, dualEnv);
  }
}

/**
 * Run a complete simulation using the arena-only pipeline.
 *
 * Steps:
 *   1. Build the ArenaSimulator and run `prepare()` (Pantelides, BLT, isolation)
 *   2. Initialize the Float64Array environment with parameters and start values
 *   3. Run the arena init solver (Newton-Raphson + homotopy)
 *   4. Execute the simulation (RK4 or Euler)
 *   5. Transform output into the standard `{ t, y, states }` format
 */
export function simulateArena(arena: DAEBuilder, options?: ArenaSimulateOptions): ArenaSimulationResult {
  return executeArenaSimulation(arena, (dae) => new ArenaSimulator(dae), options);
}

/**
 * Async variant of `simulateArena()` with cooperative yielding and abort support.
 */
export async function simulateArenaAsync(
  arena: DAEBuilder,
  options?: ArenaSimulateOptions,
): Promise<ArenaSimulationResult> {
  return executeArenaSimulationAsync(arena, (dae) => new ArenaSimulator(dae), options);
}
