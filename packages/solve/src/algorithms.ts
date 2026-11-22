// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Composable, typed Algorithm descriptors, ReturnCodes, Callbacks, and Solution interfaces.
 *
 * Replaces flat 27-member string unions with typed algorithm structs that carry their own
 * hyperparameters (linear solver, AD backend, order, reduction policy) and compose cleanly.
 */

import type { ProblemKind } from "./problems.js";

// ── Linear Solver & AD Backend Descriptors ──

export type LinearSolverSpec =
  | { readonly kind: "dense-lu" }
  | { readonly kind: "sparse-lu" }
  | { readonly kind: "klu" }
  | { readonly kind: "gmres"; readonly restart?: number | undefined; readonly tol?: number | undefined }
  | { readonly kind: "bicgstab"; readonly tol?: number | undefined };

export type DiffBackendSpec =
  | { readonly kind: "finite-diff"; readonly relStep?: number | undefined }
  | { readonly kind: "forward-ad" }
  | { readonly kind: "forward-colored-ad" }
  | { readonly kind: "reverse-ad" }
  | { readonly kind: "symbolic" };

export const DenseLU = (): LinearSolverSpec => ({ kind: "dense-lu" });
export const SparseLU = (): LinearSolverSpec => ({ kind: "sparse-lu" });
export const KLUFactorization = (): LinearSolverSpec => ({ kind: "klu" });
export const GMRES = (opts?: { restart?: number; tol?: number }): LinearSolverSpec => ({ kind: "gmres", ...opts });

export const FiniteDiff = (relStep?: number): DiffBackendSpec => ({ kind: "finite-diff", relStep });
export const ForwardAD = (): DiffBackendSpec => ({ kind: "forward-ad" });
export const ForwardColoredAD = (): DiffBackendSpec => ({ kind: "forward-colored-ad" });
export const ReverseAD = (): DiffBackendSpec => ({ kind: "reverse-ad" });

// ── Algorithm Descriptors ──

export interface AbstractAlgorithm<K extends ProblemKind = ProblemKind> {
  readonly problemKind: K;
  readonly name: string;
}

export interface ExplicitRKAlgorithm extends AbstractAlgorithm<"ode"> {
  readonly name: "Tsit5" | "Dopri5" | "Vern7" | "Vern9" | "RK4";
  readonly fsal?: boolean | undefined;
}

export interface StiffODEAlgorithm extends AbstractAlgorithm<"ode" | "dae"> {
  readonly name: "Rodas4P" | "RadauIIA5" | "RadauIIA9" | "TRBDF2" | "BDF" | "CVODE_BDF" | "IDA";
  readonly linsolve?: LinearSolverSpec | undefined;
  readonly autodiff?: DiffBackendSpec | undefined;
  readonly maxOrder?: number | undefined;
}

export interface AutoSwitchAlgorithm extends AbstractAlgorithm<"ode"> {
  readonly name: "AutoSwitch";
  readonly nonStiff: ExplicitRKAlgorithm;
  readonly stiff: StiffODEAlgorithm;
  readonly stiffThreshold: number;
}

export interface ReachabilityAlgorithm extends AbstractAlgorithm<"reachability"> {
  readonly name: "TMJets" | "ZonotopeReach" | "ConstrainedZonotopeReach";
  readonly order?: number | undefined;
  readonly maxGenerators?: number | undefined;
  readonly reduction?: "girard" | "pca" | "box" | undefined;
  readonly rounding: "outward-f64" | "floating-point";
}

export interface BarrierAlgorithm extends AbstractAlgorithm<"barrier"> {
  readonly name: "SosBarrier";
  readonly degree: 2 | 4 | 6;
  readonly sdpSolver: "ipm" | "heuristic";
}

export interface SDEAlgorithm extends AbstractAlgorithm<"sde"> {
  readonly name: "EulerMaruyama" | "SRIW1";
}

export interface DDEAlgorithm extends AbstractAlgorithm<"dde"> {
  readonly name: "MethodOfSteps";
  readonly bufferCapacity?: number | undefined;
}

export interface BVPAlgorithm extends AbstractAlgorithm<"bvp"> {
  readonly name: "Collocation" | "MultipleShooting";
  readonly numIntervals?: number | undefined;
}

export interface EnsembleAlgorithm extends AbstractAlgorithm<"ensemble"> {
  readonly name: "EnsembleSerial";
  readonly subAlgorithm?: AbstractAlgorithm | undefined;
}

export type AnyAlgorithm =
  | ExplicitRKAlgorithm
  | StiffODEAlgorithm
  | AutoSwitchAlgorithm
  | ReachabilityAlgorithm
  | BarrierAlgorithm
  | SDEAlgorithm
  | DDEAlgorithm
  | BVPAlgorithm
  | EnsembleAlgorithm
  | AbstractAlgorithm;

// Ergonomic algorithm factory constructors (mirroring DifferentialEquations.jl)
export const Tsit5 = (): ExplicitRKAlgorithm => ({ problemKind: "ode", name: "Tsit5", fsal: true });
export const Dopri5 = (): ExplicitRKAlgorithm => ({ problemKind: "ode", name: "Dopri5", fsal: true });
export const Vern7 = (): ExplicitRKAlgorithm => ({ problemKind: "ode", name: "Vern7" });
export const Vern9 = (): ExplicitRKAlgorithm => ({ problemKind: "ode", name: "Vern9" });

export const Rodas4P = (opts?: { linsolve?: LinearSolverSpec; autodiff?: DiffBackendSpec }): StiffODEAlgorithm => ({
  problemKind: "dae",
  name: "Rodas4P",
  linsolve: opts?.linsolve ?? DenseLU(),
  autodiff: opts?.autodiff ?? ForwardColoredAD(),
});

export const RadauIIA5 = (opts?: { linsolve?: LinearSolverSpec; autodiff?: DiffBackendSpec }): StiffODEAlgorithm => ({
  problemKind: "dae",
  name: "RadauIIA5",
  linsolve: opts?.linsolve ?? DenseLU(),
  autodiff: opts?.autodiff ?? ForwardColoredAD(),
});

export const TRBDF2 = (opts?: { linsolve?: LinearSolverSpec; autodiff?: DiffBackendSpec }): StiffODEAlgorithm => ({
  problemKind: "dae",
  name: "TRBDF2",
  linsolve: opts?.linsolve ?? DenseLU(),
  autodiff: opts?.autodiff ?? ForwardColoredAD(),
});

export const BDF = (opts?: {
  maxOrder?: number;
  linsolve?: LinearSolverSpec;
  autodiff?: DiffBackendSpec;
}): StiffODEAlgorithm => ({
  problemKind: "dae",
  name: "BDF",
  maxOrder: opts?.maxOrder ?? 5,
  linsolve: opts?.linsolve ?? DenseLU(),
  autodiff: opts?.autodiff ?? ForwardColoredAD(),
});

export const AutoSwitch = (
  nonStiff: ExplicitRKAlgorithm = Tsit5(),
  stiff: StiffODEAlgorithm = Rodas4P(),
  opts?: { stiffThreshold?: number },
): AutoSwitchAlgorithm => ({
  problemKind: "ode",
  name: "AutoSwitch",
  nonStiff,
  stiff,
  stiffThreshold: opts?.stiffThreshold ?? 3.3,
});

export const TMJets = (opts?: {
  order?: number;
  rounding?: "outward-f64" | "floating-point";
}): ReachabilityAlgorithm => ({
  problemKind: "reachability",
  name: "TMJets",
  order: opts?.order ?? 4,
  rounding: opts?.rounding ?? "outward-f64",
});

export const ZonotopeReach = (opts?: {
  maxGenerators?: number;
  reduction?: "girard" | "pca" | "box";
  rounding?: "outward-f64" | "floating-point";
}): ReachabilityAlgorithm => ({
  problemKind: "reachability",
  name: "ZonotopeReach",
  maxGenerators: opts?.maxGenerators ?? 40,
  reduction: opts?.reduction ?? "girard",
  rounding: opts?.rounding ?? "outward-f64",
});

export const EulerMaruyama = (): SDEAlgorithm => ({ problemKind: "sde", name: "EulerMaruyama" });
export const SRIW1 = (): SDEAlgorithm => ({ problemKind: "sde", name: "SRIW1" });
export const MethodOfSteps = (opts?: { bufferCapacity?: number }): DDEAlgorithm => ({
  problemKind: "dde",
  name: "MethodOfSteps",
  bufferCapacity: opts?.bufferCapacity,
});
export const Collocation = (opts?: { numIntervals?: number }): BVPAlgorithm => ({
  problemKind: "bvp",
  name: "Collocation",
  numIntervals: opts?.numIntervals ?? 20,
});
export const MultipleShooting = (opts?: { numIntervals?: number }): BVPAlgorithm => ({
  problemKind: "bvp",
  name: "MultipleShooting",
  numIntervals: opts?.numIntervals ?? 10,
});
export const EnsembleSerial = (subAlgorithm?: AbstractAlgorithm): EnsembleAlgorithm => ({
  problemKind: "ensemble",
  name: "EnsembleSerial",
  subAlgorithm,
});

// ── ReturnCode, Callbacks, Common Solve Options & Solution ──

export type ReturnCode =
  | "Success"
  | "Default"
  | "Terminated"
  | "MaxIters"
  | "DtLessThanMin"
  | "Unstable"
  | "NaNDetected"
  | "Infeasible"
  | "Timeout"
  | "Failure";

export interface UnifiedSolverStats {
  readonly acceptedSteps: number;
  readonly rejectedSteps: number;
  readonly fEvals: number;
  readonly jacEvals: number;
  readonly luFactorizations: number;
  readonly durationMs: number;
}

export interface ContinuousCallback {
  readonly kind: "continuous";
  readonly condition: (t: number, u: Readonly<Float64Array>) => number;
  readonly affect: (integrator: StepIntegrator) => void;
  readonly direction?: -1 | 0 | 1 | undefined;
}

export interface DiscreteCallback {
  readonly kind: "discrete";
  readonly condition: (t: number, u: Readonly<Float64Array>) => boolean;
  readonly affect: (integrator: StepIntegrator) => void;
}

export type UnifiedCallback = ContinuousCallback | DiscreteCallback;

export interface CommonSolveOptions {
  readonly reltol?: number | undefined;
  readonly abstol?: number | undefined;
  readonly dt?: number | undefined;
  readonly dtMin?: number | undefined;
  readonly dtMax?: number | undefined;
  readonly maxIters?: number | undefined;
  readonly saveAt?: readonly number[] | undefined;
  readonly dense?: boolean | undefined;
  readonly callbacks?: readonly UnifiedCallback[] | undefined;
  readonly timeoutMs?: number | undefined;
}

/** Step-by-step stateful integrator interface (SciML `init` / `step!`). */
export interface StepIntegrator {
  readonly t: number;
  readonly dt: number;
  readonly u: Float64Array;
  readonly retcode: ReturnCode;
  step(): ReturnCode;
  interpolate(tEval: number): number[];
  terminate(reason?: ReturnCode): void;
  dispose(): void;
  [Symbol.dispose](): void;
}

/** Continuous trajectory solution with optional dense interpolant `eval(t)`. */
export interface TrajectorySolution {
  readonly times: readonly number[];
  readonly states: readonly (readonly number[])[];
  readonly stateNames?: readonly string[] | undefined;
  readonly retcode: ReturnCode;
  readonly stats: UnifiedSolverStats;
  readonly algorithm: string;
  /** Evaluates the solution at any time `t` in `[t0, tEnd]` using the solver's native dense output. */
  eval(t: number): number[];
}
