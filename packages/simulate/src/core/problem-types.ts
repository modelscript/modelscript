// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Unified problem specifications for the ModelScript simulation suite.
 *
 * Covers all five major classes of differential equation systems:
 *   1. ODEProblem  - Explicit Ordinary Differential Equations: dx/dt = f(t, x, p)
 *   2. DAEProblem  - Differential-Algebraic Equations: F(t, x, x', p) = 0 or M dx/dt = f(t, x, p)
 *   3. SDEProblem  - Stochastic Differential Equations: dx = f(t, x, p)dt + g(t, x, p)dW_t
 *   4. DDEProblem  - Delay Differential Equations: dx/dt = f(t, x(t), history, p)
 *   5. BVPProblem  - Boundary Value Problems: dx/dt = f(t, x, p) s.t. g(x(t_0), x(t_f)) = 0
 */

export type { BVPOptions, DDEOptions, SDEOptions } from "./solver-options.js";
import type { STLOnlineMonitor, STLVerificationResult } from "./stl_monitor.js";

// ── Common Result Types ──

export interface SolverStats {
  acceptedSteps: number;
  rejectedSteps: number;
  fEvals: number;
  jacobianEvals?: number;
  luFactorizations?: number;
  converged?: boolean;
}

export interface CommonSolverResult {
  times: number[];
  states: number[][];
  stats?: SolverStats;
  /** Quantitative robustness certificates and violation metrics from attached STL monitors */
  stlResults?: STLVerificationResult[];
}

// ── 1. ODE Problem ──

export interface ODEProblem<P = Record<string, number> | number[]> {
  /** Vector field: dy/dt = f(t, y, p) */
  f: (t: number, y: number[], p?: P) => number[];
  /** Initial state vector at tSpan[0] */
  y0: number[];
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Optional parameter object or vector */
  p?: P;
  /** Optional analytical Jacobian J = df/dy */
  jac?: (t: number, y: number[], p?: P) => number[][];
  /** Optional streaming Signal Temporal Logic (STL) robustness monitors */
  stlMonitors?: STLOnlineMonitor[];
}

// ── 2. DAE Problem ──

export interface DAEProblem<P = Record<string, number> | number[]> {
  /**
   * Residual function: F(t, y, y', p) = 0,
   * OR right-hand side f(t, y, p) when massMatrix is provided.
   */
  f: (t: number, y: number[], yp?: number[], p?: P) => number[];
  /** Initial state vector y(t0) */
  y0: number[];
  /** Initial derivative vector y'(t0) */
  yp0?: number[];
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Optional mass matrix M: M * dy/dt = f(t, y) */
  massMatrix?: number[][];
  /** Optional boolean mask indicating which variables are algebraic vs differential */
  differentialVars?: boolean[];
  /** Optional parameter object or vector */
  p?: P;
  /** Optional analytical Jacobian */
  jac?: (t: number, y: number[], p?: P) => number[][];
  /** Optional streaming Signal Temporal Logic (STL) robustness monitors */
  stlMonitors?: STLOnlineMonitor[];
}

// ── 3. SDE Problem ──

export type SDENoiseType = "diagonal" | "scalar" | "matrix";

export interface SDEProblem<P = Record<string, number> | number[]> {
  /** Drift vector field: f(t, y, p) */
  f: (t: number, y: number[], p?: P) => number[];
  /**
   * Diffusion vector or matrix field: g(t, y, p).
   * For diagonal noise, returns vector of size n.
   * For scalar noise, returns scalar or 1-element array.
   * For matrix noise, returns n x m matrix.
   */
  g: (t: number, y: number[], p?: P) => number[] | number[][];
  /** Initial state vector */
  y0: number[];
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Noise structure (default: "diagonal") */
  noiseType?: SDENoiseType;
  /** Number of Brownian motion paths / noise channels m (default: y0.length for diagonal) */
  mBrownian?: number;
  /** Optional parameter object or vector */
  p?: P;
  /** Optional PRNG seed */
  seed?: number;
}

export interface SDESimulationResult extends CommonSolverResult {
  /** Realization seed used */
  seed?: number;
}

export interface SDEEnsembleResult {
  times: number[];
  /** Mean trajectory E[y(t)] */
  mean: number[][];
  /** Variance trajectory Var(y(t)) */
  variance: number[][];
  /** Lower quantile (e.g. 5%) */
  quantile05?: number[][];
  /** Median trajectory (50%) */
  median?: number[][];
  /** Upper quantile (e.g. 95%) */
  quantile95?: number[][];
  /** Sample trajectories (first few realizations) */
  samples?: number[][][];
  /** Total number of realizations */
  numTrajectories: number;
}

// ── 4. DDE Problem ──

export interface DDEProblem<P = Record<string, number> | number[]> {
  /**
   * Vector field with delay: dy/dt = f(t, y, history, p)
   * The history function h(t) returns the state vector at past time t <= current_t.
   */
  f: (t: number, y: number[], history: (t: number) => number[], p?: P) => number[];
  /** History function defined for t <= tSpan[0] */
  h: (t: number, p?: P) => number[];
  /** Initial state vector at tSpan[0] (typically equals h(tSpan[0])) */
  y0: number[];
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Known constant delays tau_i to track for breaking point discontinuity propagation */
  constantDelays?: number[];
  /** Optional parameter object or vector */
  p?: P;
}

// ── 5. BVP Problem ──

export interface BVPProblem<P = Record<string, number> | number[]> {
  /** Vector field: dy/dt = f(t, y, p) */
  f: (t: number, y: number[], p?: P) => number[];
  /**
   * Two-point boundary condition residual: g(ya, yb, p) = 0.
   * Returns vector of dimension equal to y0.length.
   */
  bc: (ya: number[], yb: number[], p?: P) => number[];
  /** Initial guess for state vector at t0, or a function y_guess(t) */
  yGuess: number[] | ((t: number) => number[]);
  /** Time interval [t0, tEnd] */
  tSpan: [number, number];
  /** Optional parameter object or vector */
  p?: P;
}

// ── 6. Flowpipe Reachability Problem ──

export interface FlowpipeRequirementSpec {
  stateIndex: number;
  stateName?: string;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
}

export interface FlowpipeIntervalEnclosure {
  lo: number;
  hi: number;
}

export interface FlowpipeReachabilityProblem<P = Record<string, number> | number[]> {
  /**
   * System dynamics vector field dy/dt = f(t, y, p)
   */
  f: (t: number, y: number[], p?: P) => number[];
  /** Initial state interval enclosure [lo, hi] for each state variable */
  initialEnclosure: FlowpipeIntervalEnclosure[];
  /** Nominal initial state point */
  nominalInitial: number[];
  /** Time interval [t0, tEnd] */
  tSpan: [number, number];
  /** Step size for flowpipe segments */
  dt: number;
  /** Polynomial order for Taylor Models (default: 2) */
  order?: number;
  /** Safety requirements to formally verify against flowpipe */
  requirements?: FlowpipeRequirementSpec[];
  /** Optional parameter object or vector */
  p?: P;
}

// ── 7. Hybrid Flowpipe Reachability Problem ──

export interface HybridFlowpipeMode<P = Record<string, number> | number[]> {
  id: string;
  name?: string;
  /** Continuous dynamics vector field dy/dt = f(t, y, p) */
  f: (t: number, y: number[], p?: P) => number[];
  /** Invariants: state bounds that must hold while active in this mode */
  invariants?: { stateIndex: number; min?: number; max?: number }[];
}

export interface HybridTransitionSpec {
  id: string;
  sourceModeId: string;
  targetModeId: string;
  /** Guard condition scalar function g(y) <= 0 or zero crossing */
  guard: (y: number[]) => number;
  /** State reset map: y_post = reset(y_pre) */
  reset?: (pre: number[]) => number[];
  label?: string;
}

export interface HybridFlowpipeProblem<P = Record<string, number> | number[]> {
  modes: HybridFlowpipeMode<P>[];
  transitions: HybridTransitionSpec[];
  initialModeId: string;
  initialEnclosure: FlowpipeIntervalEnclosure[];
  nominalInitial: number[];
  tSpan: [number, number];
  dt: number;
  order?: number;
  adaptive?: boolean;
  tol?: number;
  useQrPreconditioning?: boolean;
  requirements?: FlowpipeRequirementSpec[];
  maxJumps?: number;
  p?: P;
}

export interface HybridFlowpipeResult {
  isCertifiedSafe: boolean;
  totalSteps: number;
  jumpCount: number;
  violations: {
    stepIndex: number;
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
    reason: string;
  }[];
  summary: string;
}
