// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  ArenaBltBlock,
  ArenaExecutionBlock,
  DAEBuilder,
  DAEPassManager,
  LinearSccPlan,
} from "@modelscript/runtime";
import type {
  FmuInstanceMetadata,
  FmuSubsystem,
  FmuSubsystemRegistry,
} from "@modelscript/runtime/wasm_fmu_subsystem.js";
import type { LUFactorizationFlat } from "@modelscript/runtime/wasm_gaussian.js";
import type { IntegratorCallback } from "./callbacks.js";
import type { SimulationDebugger } from "./simulation.js";
import type { OnlineSTLMonitor, STLStepResult } from "./stl_monitor.js";

export const createDynamicFunction = Object.getPrototypeOf(function () {}).constructor as (
  ...paramsAndBody: string[]
) => (...args: never[]) => unknown;

/** Globally monotonic epoch counter so cached LU factorizations never alias across simulator instances or discrete events. */
let nextDiscreteEventEpoch = 1;

export function allocateDiscreteEventEpoch(): number {
  return nextDiscreteEventEpoch++;
}

/** Maximum Newton iterations for algebraic loop solving. */
export const NEWTON_MAX_ITER = 20;
/** Newton convergence tolerance. */
export const NEWTON_TOL = 1e-10;
/** Square root of machine epsilon for finite-difference perturbation. */
export const SQRT_EPS = 1.4901161193847656e-8;
/** Static backtracking step-size schedule for torn Newton line search (zero per-call array allocations). */
export const TORN_LINE_ALPHAS = [1.0, 0.5, 0.25, 0.125, 0.05] as const;

export interface CachedSimPrep {
  parameters: Map<string, number>;
  parameterVars: Set<number>;
  stateVars: Set<number>;
  derivativeVars: Set<number>;
  dummyDerivatives: Set<number>;
  sortedEquations: number[];
  blocks: ArenaBltBlock[];
  executionBlocks: ArenaExecutionBlock[];
}

export interface VectorStateDescriptor {
  varIdx: number;
  name: string;
  shape: number[];
  length: number;
  startVal: number;
  eqIdx: number;
  rhsExprId: number;
}

export interface SimDAEBuilder extends DAEBuilder {
  _cachedSimPrep?: CachedSimPrep | undefined;
  _delayHistory?: Map<number, { t: number; v: number }[]> | undefined;
  _initialAlgorithmsExecuted?: boolean | undefined;
}

export interface TornExecutionPlan {
  k: number;
  tearingVarIndices: Int32Array;
  tearingVarNameIds: Int32Array;
  residualExprIds: Int32Array;
  causalChain: Array<{
    eqIdx: number;
    solvedVarIdx: number;
    solvedVarNameId: number;
    isolatedExprId: number;
  }>;
  compiledResiduals?: ((env: Float64Array, xTrial: Float64Array, R_out: Float64Array) => number) | undefined;
  cachedFact?: LUFactorizationFlat | undefined;
  cachedFactJ?: Float64Array | undefined;
  cachedJ?: Float64Array | undefined;
  cachedPiv?: Int32Array | undefined;
  cachedScale?: Float64Array | undefined;
  luEpoch?: number | undefined;
  fallbackCount?: number | undefined;
  scratchXTear?: Float64Array | undefined;
  scratchR?: Float64Array | undefined;
  scratchRPert?: Float64Array | undefined;
  scratchDeltaX?: Float64Array | undefined;
  scratchXTrial?: Float64Array | undefined;
  scratchBestXTear?: Float64Array | undefined;
  scratchOrigVals?: Float64Array | undefined;
}

export type SystemExecutionBlock = Extract<ArenaExecutionBlock, { type: "system" }> & {
  _varNameIds?: Int32Array | undefined;
  _resExprIds?: Int32Array | undefined;
  _isBoolVar?: Uint8Array | undefined;
  _isBoolEq?: Uint8Array | undefined;
  _hasBoolVars?: boolean | undefined;
  _compiledResiduals?: ((env: Float64Array, x: Float64Array, R: Float64Array) => number) | undefined;
  _compiledJacobian?: ((env: Float64Array, x: Float64Array, R: Float64Array, J: Float64Array) => void) | undefined;
  _isLinearSystem?: boolean | undefined;
  _isJacInvariantBetweenEvents?: boolean | undefined;
  _cachedFactJ?: Float64Array | undefined;
  _cachedPiv?: Int32Array | undefined;
  _cachedScale?: Float64Array | undefined;
  _cachedLuFact?: LUFactorizationFlat | undefined;
  _luEpoch?: number | undefined;
  _chordFailStreak?: number | undefined;
  _chordSkipRemaining?: number | undefined;
  _tornPlan?: TornExecutionPlan | null | undefined;
  _linearSccPlan?: LinearSccPlan | null | undefined;
};

export interface FlatBytecodeCache {
  bcPtr: number;
  bytecodeLen: number;
  litPtr: number;
  bytecode: Int32Array;
  litArray: Float64Array;
  hasSystemBlocks: boolean;
  systemBlocks: unknown[];
}

export interface FrictionStateMapping {
  stateIndex: number;
  stateId: number;
  flowVarId: number;
}

export interface FmuMapping {
  prefix: string;
  subsystem: FmuSubsystem;
  inputIds: number[];
  outputIds: number[];
}

export interface SafetyViolationRecord {
  t: number;
  monitorName?: string | undefined;
  robustness: number;
  details?: string | undefined;
}

export interface WasmArenaExports {
  memory?: WebAssembly.Memory;
  atomicChunkAlloc?: (bytes: number) => number;
  atomicChunkFree?: (ptr: number, bytes?: number) => void;
  sim_evalFlatBytecode?: (...args: number[]) => number;
  sim_runBytecodeSimulationLoop?: (...args: number[]) => number;
}

export type AdaptiveArenaCpuSolver =
  | "dopri5"
  | "tsit5"
  | "bdf"
  | "rodas4p"
  | "rodas5p"
  | "auto-composite"
  | "trbdf2"
  | "radau5"
  | "radau9"
  | "sprk"
  | "verlet"
  | "ruth3"
  | "forest-ruth4"
  | "yoshida6"
  | "yoshida8"
  | "vern7"
  | "vern9"
  | "kencarp4"
  | "qss1"
  | "qss2"
  | "qss3"
  | "liqss2"
  | "auto";

export type ArenaCpuSolver = "euler" | "rk4" | AdaptiveArenaCpuSolver | "cvode";

export function isAdaptiveArenaSolver(solver: ArenaCpuSolver): solver is AdaptiveArenaCpuSolver {
  return solver !== "euler" && solver !== "rk4" && solver !== "cvode";
}

/** Result of an arena-path simulation. */
export interface ArenaSimulationResult {
  /** Time points. */
  t: number[];
  /** State variable values at each time point (row-major: y[timeIdx][varIdx]). */
  y: number[][];
  /** Names of state variables (column headers for y). */
  states: string[];
  /** Whether simulation was terminated early by safety barrier monitor. */
  terminatedEarly?: boolean | undefined;
  /** Recorded safety barrier violations. */
  safetyViolations?: SafetyViolationRecord[] | undefined;
  /** Recorded interval domain and singularity issues. */
  intervalIssues?: string[] | undefined;
}

/** Options for `simulateArena()`. */
export interface ArenaSimulateOptions {
  /** Simulation start time $t_0$ (defaults to `experiment(StartTime)` or `0`). */
  startTime?: number | undefined;
  /** Simulation stop time $t_{\text{end}}$ (defaults to `experiment(StopTime)` or `10`). */
  stopTime?: number | undefined;
  /** Output interval (step size). */
  step?: number | undefined;
  /** Number of output intervals (used if `step` is not given). */
  numberOfIntervals?: number | undefined;
  /** ODE/DAE solver selection. */
  solver?: ArenaCpuSolver | "webgpu" | undefined;
  /** Absolute tolerance for adaptive solvers (default: 1e-6). */
  atol?: number | undefined;
  /** Relative tolerance for adaptive solvers (default: 1e-6). */
  rtol?: number | undefined;
  /** Custom output string IDs for subsetting result traces. */
  outputStringIds?: number[] | undefined;
  /** Parameter overrides (name → value). */
  parameterOverrides?: Map<string, number> | undefined;
  /** Initial state overrides (name → value) at startTime. */
  initialStateOverrides?: Map<string, number> | undefined;
  /** Abort signal for cooperative cancellation. */
  signal?: AbortSignal | undefined;
  /** Optional FMU co-simulation subsystem registry for hybrid simulation. */
  fmuRegistry?: FmuSubsystemRegistry | undefined;
  /** Optional custom FMU subsystem loader hook (resolves external binaries/participants). */
  fmuLoader?: ((fmuPath: string, instance: FmuInstanceMetadata) => FmuSubsystem) | undefined;
  /** Optional debugger hook for step-by-step statement execution. */
  debuggerHook?: SimulationDebugger | undefined;
  /** When true, preserves internal variables tagged with HideResult. */
  debug?: boolean | undefined;
  /** When true, only solves the steady-state initial equilibrium and returns immediately at startTime. */
  steadyStateOnly?: boolean | undefined;
  /** Real-time STL safety barrier monitors to evaluate during integration. */
  stlMonitors?: OnlineSTLMonitor[] | undefined;
  /** Immediately halt integration if an STL monitor detects safety violation (rho < 0). */
  earlyTerminateOnViolation?: boolean | undefined;
  /** Check variable min/max bounds and DAE singularities at each step. */
  intervalBarrierCheck?: boolean | undefined;
  /** Callback invoked on safety violation. */
  onStepViolation?:
    ((t: number, y: Float64Array, monitor: OnlineSTLMonitor, stepResult: STLStepResult) => void) | undefined;
  /** Dynamic simulation callbacks (continuous root-crossings, discrete stepping, manifold projections). */
  callbacks?: IntegratorCallback[] | undefined;
  /** Optional pre-simulation compiler pass pipeline to execute before solving. */
  passManager?: DAEPassManager | undefined;
  /** When true, runs set-based connector expansion, loop alias elimination, and vector causalization before scalarization. */
  vectorCausalize?: boolean | undefined;
  /** When true, lowers discontinuous expressions (abs, sign, min, max, if-else) to μ-Modelica discrete variables and When zero-crossings. */
  microModelica?: boolean | undefined;
  /** When true, skips Pantelides index reduction for systems known to be Index-1. */
  skipPantelides?: boolean | undefined;
}
