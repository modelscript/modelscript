// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified SciML-inspired Problem & ModelFunction hierarchy for ModelScript.
 *
 * All problem classes share:
 *   - A discriminated `kind` tag
 *   - Typed parameter carrier `p`
 *   - Immutable construction + `remake(prob, patch)` for parameter sweeps, UQ, and calibration
 *   - Shared `ModelFunction` attaching optional AD/sparse Jacobians and outward-rounded interval
 *     evaluators ONCE so every solver (ODE, DAE, Reachability, Optimization) inherits them.
 */

import type { OutwardInterval } from "./outward-interval.js";

/** Out-of-place or in-place vector field signature. */
export type OopVectorField<P = unknown> = (t: number, u: Readonly<Float64Array | number[]>, p?: P) => number[];
export type IipVectorField<P = unknown> = (
  du: Float64Array,
  u: Readonly<Float64Array>,
  p: P | undefined,
  t: number,
) => void;

export type JacobianFunction<P = unknown> = (t: number, u: Readonly<Float64Array | number[]>, p?: P) => number[][];
export type IntervalVectorField<P = unknown> = (
  t: OutwardInterval,
  u: readonly OutwardInterval[],
  p?: P,
) => OutwardInterval[];

/**
 * Shared compiled/annotated model function attached to ODE, DAE, Reachability, and Control problems.
 */
export interface ModelFunction<P = unknown> {
  /** Out-of-place RHS `du/dt = f(t, u, p)` (or residual `F(t, u, du, p)` for implicit DAEs). */
  readonly f: OopVectorField<P>;
  /** Optional allocation-free in-place RHS `f!(du, u, p, t)` for hot loops. */
  readonly fInPlace?: IipVectorField<P> | undefined;
  /** Optional analytical or AD Jacobian `J = df/du`. */
  readonly jac?: JacobianFunction<P> | undefined;
  /** Optional mass matrix `M` for `M * du/dt = f(t, u, p)`. */
  readonly massMatrix?: readonly (readonly number[])[] | undefined;
  /** Optional outward-rounded interval extension of `f` for rigorous reachability & verification. */
  readonly fInterval?: IntervalVectorField<P> | undefined;
  /** Optional state names for diagnostics, plots, and certificates. */
  readonly stateNames?: readonly string[] | undefined;
  /** Optional opaque handle to a compiled `DAEBuilder` arena (avoids circular dependency on runtime). */
  readonly arenaHandle?: unknown;
}

export type ProblemKind =
  | "ode"
  | "dae"
  | "sde"
  | "dde"
  | "bvp"
  | "reachability"
  | "hybrid-reachability"
  | "barrier"
  | "optimization"
  | "abstract-interpretation"
  | "ensemble";

export interface AbstractProblem<K extends ProblemKind = ProblemKind, P = unknown> {
  readonly kind: K;
  readonly p?: P | undefined;
}

export interface UnifiedODEProblem<P = unknown> extends AbstractProblem<"ode", P> {
  readonly fn: ModelFunction<P>;
  readonly u0: readonly number[];
  readonly tSpan: readonly [number, number];
}

export interface UnifiedDAEProblem<P = unknown> extends AbstractProblem<"dae", P> {
  readonly fn: ModelFunction<P>;
  readonly residual?: ((t: number, u: readonly number[], du: readonly number[], p?: P) => number[]) | undefined;
  readonly u0: readonly number[];
  readonly du0?: readonly number[] | undefined;
  readonly differentialVars?: readonly boolean[] | undefined;
  readonly tSpan: readonly [number, number];
}

export interface UnifiedSDEProblem<P = unknown> extends AbstractProblem<"sde", P> {
  readonly drift: ModelFunction<P>;
  readonly diffusion: (t: number, u: Readonly<Float64Array | number[]>, p?: P) => number[] | number[][];
  readonly noiseType?: "diagonal" | "scalar" | "matrix" | undefined;
  readonly u0: readonly number[];
  readonly tSpan: readonly [number, number];
  readonly seed?: number | undefined;
}

export interface UnifiedDDEProblem<P = unknown> extends AbstractProblem<"dde", P> {
  readonly f: (t: number, u: readonly number[], history: (tPast: number) => number[], p?: P) => number[];
  readonly history: (tPast: number, p?: P) => number[];
  readonly u0: readonly number[];
  readonly tSpan: readonly [number, number];
  readonly constantDelays?: readonly number[] | undefined;
}

export interface UnifiedBVPProblem<P = unknown> extends AbstractProblem<"bvp", P> {
  readonly fn: ModelFunction<P>;
  readonly bc: (ua: readonly number[], ub: readonly number[], p?: P) => number[];
  readonly uGuess: readonly number[] | ((t: number) => number[]);
  readonly tSpan: readonly [number, number];
}

export interface SafetyPropertySpec {
  readonly stateIndex: number;
  readonly stateName?: string | undefined;
  readonly operator: "<=" | ">=" | "<" | ">";
  readonly limit: number;
}

export interface UnifiedReachabilityProblem<P = unknown> extends AbstractProblem<"reachability", P> {
  readonly fn: ModelFunction<P>;
  readonly initialSet: readonly OutwardInterval[];
  readonly tSpan: readonly [number, number];
  readonly properties?: readonly SafetyPropertySpec[] | undefined;
}

export interface UnifiedBarrierProblem<P = unknown> extends AbstractProblem<"barrier", P> {
  readonly fn: ModelFunction<P>;
  readonly initialRadius: number;
  readonly unsafeRadius: number;
}

export interface UnifiedOptimizationProblem<P = unknown> extends AbstractProblem<"optimization", P> {
  readonly objective: (x: readonly number[], p?: P) => number;
  readonly x0: readonly number[];
  readonly lb?: readonly number[] | undefined;
  readonly ub?: readonly number[] | undefined;
  readonly grad?: ((x: readonly number[], p?: P) => number[]) | undefined;
}

export interface UnifiedEnsembleProblem<
  TProb extends AbstractProblem = AbstractProblem,
  P = unknown,
> extends AbstractProblem<"ensemble", P> {
  readonly baseProblem: TProb;
  readonly trajectories: number;
  readonly probFunc: (prob: TProb, index: number) => TProb;
}

export type AnyProblem =
  | UnifiedODEProblem
  | UnifiedDAEProblem
  | UnifiedSDEProblem
  | UnifiedDDEProblem
  | UnifiedBVPProblem
  | UnifiedReachabilityProblem
  | UnifiedBarrierProblem
  | UnifiedOptimizationProblem
  | UnifiedEnsembleProblem;

/** Helper constructors (SciML style). */
export function ODEProblem<P = unknown>(
  fnOrF: ModelFunction<P> | OopVectorField<P>,
  u0: readonly number[],
  tSpan: readonly [number, number],
  p?: P,
): UnifiedODEProblem<P> {
  const fn: ModelFunction<P> = typeof fnOrF === "function" ? { f: fnOrF } : fnOrF;
  return Object.freeze({ kind: "ode", fn, u0: [...u0], tSpan: [tSpan[0], tSpan[1]] as const, p });
}

export function DAEProblem<P = unknown>(
  fn: ModelFunction<P>,
  u0: readonly number[],
  tSpan: readonly [number, number],
  opts?: {
    du0?: readonly number[] | undefined;
    differentialVars?: readonly boolean[] | undefined;
    residual?: ((t: number, u: readonly number[], du: readonly number[], p?: P) => number[]) | undefined;
    p?: P | undefined;
  },
): UnifiedDAEProblem<P> {
  return Object.freeze({
    kind: "dae",
    fn,
    u0: [...u0],
    du0: opts?.du0 ? [...opts.du0] : undefined,
    differentialVars: opts?.differentialVars ? [...opts.differentialVars] : undefined,
    residual: opts?.residual,
    tSpan: [tSpan[0], tSpan[1]] as const,
    p: opts?.p,
  });
}

export function ReachabilityProblem<P = unknown>(
  fn: ModelFunction<P>,
  initialSet: readonly OutwardInterval[],
  tSpan: readonly [number, number],
  opts?: { properties?: readonly SafetyPropertySpec[] | undefined; p?: P | undefined },
): UnifiedReachabilityProblem<P> {
  return Object.freeze({
    kind: "reachability",
    fn,
    initialSet: [...initialSet],
    tSpan: [tSpan[0], tSpan[1]] as const,
    properties: opts?.properties ? [...opts.properties] : undefined,
    p: opts?.p,
  });
}

export function SDEProblem<P = unknown>(
  driftOrF: ModelFunction<P> | OopVectorField<P>,
  diffusion: (t: number, u: Readonly<Float64Array | number[]>, p?: P) => number[] | number[][],
  u0: readonly number[],
  tSpan: readonly [number, number],
  opts?: { noiseType?: "diagonal" | "scalar" | "matrix" | undefined; seed?: number | undefined; p?: P | undefined },
): UnifiedSDEProblem<P> {
  const drift: ModelFunction<P> = typeof driftOrF === "function" ? { f: driftOrF } : driftOrF;
  return Object.freeze({
    kind: "sde",
    drift,
    diffusion,
    u0: [...u0],
    tSpan: [tSpan[0], tSpan[1]] as const,
    noiseType: opts?.noiseType,
    seed: opts?.seed,
    p: opts?.p,
  });
}

export function DDEProblem<P = unknown>(
  f: UnifiedDDEProblem<P>["f"],
  history: UnifiedDDEProblem<P>["history"],
  u0: readonly number[],
  tSpan: readonly [number, number],
  opts?: { constantDelays?: readonly number[] | undefined; p?: P | undefined },
): UnifiedDDEProblem<P> {
  return Object.freeze({
    kind: "dde",
    f,
    history,
    u0: [...u0],
    tSpan: [tSpan[0], tSpan[1]] as const,
    constantDelays: opts?.constantDelays ? [...opts.constantDelays] : undefined,
    p: opts?.p,
  });
}

export function BVPProblem<P = unknown>(
  fnOrF: ModelFunction<P> | OopVectorField<P>,
  bc: UnifiedBVPProblem<P>["bc"],
  uGuess: UnifiedBVPProblem<P>["uGuess"],
  tSpan: readonly [number, number],
  p?: P,
): UnifiedBVPProblem<P> {
  const fn: ModelFunction<P> = typeof fnOrF === "function" ? { f: fnOrF } : fnOrF;
  return Object.freeze({
    kind: "bvp",
    fn,
    bc,
    uGuess: Array.isArray(uGuess) ? [...uGuess] : uGuess,
    tSpan: [tSpan[0], tSpan[1]] as const,
    p,
  });
}

export function EnsembleProblem<TProb extends AbstractProblem>(
  baseProblem: TProb,
  trajectories: number,
  probFunc: (prob: TProb, index: number) => TProb,
): UnifiedEnsembleProblem<TProb> {
  return Object.freeze({
    kind: "ensemble",
    baseProblem,
    trajectories,
    probFunc,
  });
}

/**
 * Creates a shallow copy of any problem with overridden fields (identical to SciML's `remake(prob; ...)`).
 * Preserves `kind` and immutability.
 */
export function remake<TProb extends AbstractProblem>(prob: TProb, patch: Partial<Omit<TProb, "kind">>): TProb {
  return Object.freeze({ ...prob, ...patch, kind: prob.kind });
}
