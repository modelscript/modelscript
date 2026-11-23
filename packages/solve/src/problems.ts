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
  | "ensemble"
  | "spectral"
  | "sysid"
  | "mor"
  | "identifiability"
  | "probabilistic-inference"
  | "causal"
  | "reliability"
  | "motion-planning"
  | "trajectory-opt"
  | "multibody"
  | "synthesis"
  | "game-equilibrium"
  | "scheduling"
  | "graph-flow"
  | "graph-partition"
  | "des"
  | "topology-opt"
  | "eda-layout"
  | "geometry"
  | "stochastic-kinetics"
  | "fba"
  | "chemical-eq"
  | "electromagnetics"
  | "dose-transport";

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

export interface UnifiedSpectralProblem<P = unknown> extends AbstractProblem<"spectral", P> {
  readonly signal: Readonly<Float64Array | number[]>;
  readonly sampleRateHz: number;
}

export interface UnifiedSysIdProblem<P = unknown> extends AbstractProblem<"sysid", P> {
  readonly mode: "frequency" | "time";
  readonly frequenciesHz?: readonly number[] | undefined;
  readonly responseReal?: readonly number[] | undefined;
  readonly responseImag?: readonly number[] | undefined;
  readonly inputs?: readonly (readonly number[])[] | undefined;
  readonly outputs?: readonly (readonly number[])[] | undefined;
  readonly dt?: number | undefined;
  readonly order: number;
}

export interface UnifiedMorProblem<P = unknown> extends AbstractProblem<"mor", P> {
  readonly A: readonly (readonly number[])[];
  readonly B: readonly (readonly number[])[];
  readonly C: readonly (readonly number[])[];
  readonly D?: readonly (readonly number[])[] | undefined;
  readonly E?: readonly (readonly number[])[] | undefined;
  readonly targetOrder: number;
}

export interface UnifiedIdentifiabilityProblem<P = unknown> extends AbstractProblem<"identifiability", P> {
  readonly fn: ModelFunction<P>;
  readonly outputFn: (u: readonly number[], p: readonly number[]) => number[];
  readonly u0: readonly number[];
  readonly p0: readonly number[];
  readonly paramNames?: readonly string[] | undefined;
}

export interface UnifiedProbabilisticInferenceProblem<P = unknown> extends AbstractProblem<
  "probabilistic-inference",
  P
> {
  readonly logDensity: (theta: readonly number[]) => number;
  readonly gradLogDensity?: ((theta: readonly number[]) => number[]) | undefined;
  readonly initialTheta: readonly number[];
  readonly numSamples?: number | undefined;
  readonly warmup?: number | undefined;
  readonly seed?: number | undefined;
}

export interface UnifiedCausalProblem<P = unknown> extends AbstractProblem<"causal", P> {
  readonly variables: readonly string[];
  readonly edges: readonly (readonly [string, string])[];
  readonly intervention?: Readonly<Record<string, number>> | undefined;
  readonly target: string;
}

export interface UnifiedReliabilityProblem<P = unknown> extends AbstractProblem<"reliability", P> {
  readonly missionTime: number;
  readonly model: unknown;
}

export interface UnifiedMotionPlanningProblem<P = unknown> extends AbstractProblem<"motion-planning", P> {
  readonly start: readonly number[];
  readonly goal: readonly number[];
  readonly boundsMin: readonly number[];
  readonly boundsMax: readonly number[];
  readonly isCollisionFree: (q: readonly number[]) => boolean;
}

export interface UnifiedTrajectoryOptProblem<P = unknown> extends AbstractProblem<"trajectory-opt", P> {
  readonly dynamics: (x: readonly number[], u: readonly number[], t: number) => number[];
  readonly stageCost: (x: readonly number[], u: readonly number[], t: number) => number;
  readonly terminalCost: (x: readonly number[]) => number;
  readonly x0: readonly number[];
  readonly horizon: number;
  readonly steps: number;
  readonly uDim: number;
}

export interface UnifiedMultibodyProblem<P = unknown> extends AbstractProblem<"multibody", P> {
  readonly bodies: unknown;
  readonly q: readonly number[];
  readonly qd: readonly number[];
  readonly tau?: readonly number[] | undefined;
}

export interface UnifiedSynthesisProblem<P = unknown> extends AbstractProblem<"synthesis", P> {
  readonly mode: "cbf-clf-qp" | "gr1" | "cegis";
  readonly spec: unknown;
}

export interface UnifiedGameEquilibriumProblem<P = unknown> extends AbstractProblem<"game-equilibrium", P> {
  readonly payoffA: readonly (readonly number[])[];
  readonly payoffB: readonly (readonly number[])[];
}

export interface UnifiedSchedulingProblem<P = unknown> extends AbstractProblem<"scheduling", P> {
  readonly tasks: readonly {
    readonly id: string;
    readonly duration: number;
    readonly predecessors?: readonly string[] | undefined;
    readonly resourceDemand?: readonly number[] | undefined;
  }[];
  readonly resourceCapacities?: readonly number[] | undefined;
}

export interface UnifiedGraphFlowProblem<P = unknown> extends AbstractProblem<"graph-flow", P> {
  readonly numNodes: number;
  readonly edges: readonly {
    readonly from: number;
    readonly to: number;
    readonly capacity: number;
    readonly cost?: number | undefined;
  }[];
  readonly source: number;
  readonly sink: number;
}

export interface UnifiedGraphPartitionProblem<P = unknown> extends AbstractProblem<"graph-partition", P> {
  readonly numNodes: number;
  readonly edges: readonly (readonly [number, number, number?])[];
  readonly numPartitions: number;
}

export interface UnifiedDesProblem<P = unknown> extends AbstractProblem<"des", P> {
  readonly horizon: number;
  readonly initialEvents: readonly { readonly time: number; readonly type: string; readonly payload?: unknown }[];
}

export interface UnifiedTopologyOptProblem<P = unknown> extends AbstractProblem<"topology-opt", P> {
  readonly nelx: number;
  readonly nely: number;
  readonly volumeFraction: number;
  readonly penalization?: number | undefined;
  readonly rmin?: number | undefined;
}

export interface UnifiedEdaLayoutProblem<P = unknown> extends AbstractProblem<"eda-layout", P> {
  readonly components: unknown;
  readonly nets: unknown;
  readonly boardWidth: number;
  readonly boardHeight: number;
}

export interface UnifiedGeometryProblem<P = unknown> extends AbstractProblem<"geometry", P> {
  readonly operation: "delaunay" | "sdf" | "marching-cubes" | "nurbs";
  readonly payload: unknown;
}

export interface UnifiedStochasticKineticsProblem<P = unknown> extends AbstractProblem<"stochastic-kinetics", P> {
  readonly initialCounts: readonly number[];
  readonly stoichiometry: readonly (readonly number[])[];
  readonly propensities: (counts: readonly number[]) => number[];
  readonly tEnd: number;
  readonly seed?: number | undefined;
}

export interface UnifiedFbaProblem<P = unknown> extends AbstractProblem<"fba", P> {
  readonly stoichiometry: readonly (readonly number[])[];
  readonly lowerBounds: readonly number[];
  readonly upperBounds: readonly number[];
  readonly objective: readonly number[];
}

export interface UnifiedChemicalEqProblem<P = unknown> extends AbstractProblem<"chemical-eq", P> {
  readonly elementMatrix: readonly (readonly number[])[];
  readonly elementTotals: readonly number[];
  readonly standardGibbsRT: readonly number[];
}

export interface UnifiedElectromagneticsProblem<P = unknown> extends AbstractProblem<"electromagnetics", P> {
  readonly mode: "fdtd" | "ray-optics";
  readonly config: unknown;
}

export interface UnifiedDoseTransportProblem<P = unknown> extends AbstractProblem<"dose-transport", P> {
  readonly gridShape: readonly [number, number, number];
  readonly voxelSpacingMm: readonly [number, number, number];
  readonly beams: unknown;
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
  | UnifiedEnsembleProblem
  | UnifiedSpectralProblem
  | UnifiedSysIdProblem
  | UnifiedMorProblem
  | UnifiedIdentifiabilityProblem
  | UnifiedProbabilisticInferenceProblem
  | UnifiedCausalProblem
  | UnifiedReliabilityProblem
  | UnifiedMotionPlanningProblem
  | UnifiedTrajectoryOptProblem
  | UnifiedMultibodyProblem
  | UnifiedSynthesisProblem
  | UnifiedGameEquilibriumProblem
  | UnifiedSchedulingProblem
  | UnifiedGraphFlowProblem
  | UnifiedGraphPartitionProblem
  | UnifiedDesProblem
  | UnifiedTopologyOptProblem
  | UnifiedEdaLayoutProblem
  | UnifiedGeometryProblem
  | UnifiedStochasticKineticsProblem
  | UnifiedFbaProblem
  | UnifiedChemicalEqProblem
  | UnifiedElectromagneticsProblem
  | UnifiedDoseTransportProblem;

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
