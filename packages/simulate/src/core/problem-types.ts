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

/** Diagnostic step and evaluation statistics collected by numerical integrators. */
export interface SolverStats {
  /** Number of accepted integration steps. */
  acceptedSteps: number;
  /** Number of steps rejected by the local error controller. */
  rejectedSteps: number;
  /** Total number of right-hand side (or residual) evaluations. */
  fEvals: number;
  /** Total number of analytical or finite-difference Jacobian evaluations. */
  jacobianEvals?: number | undefined;
  /** Total number of linear system LU factorizations performed. */
  luFactorizations?: number | undefined;
  /** Whether the solver converged across the full integration interval. */
  converged?: boolean | undefined;
}

/** Standard trajectory and diagnostic output returned by numerical solvers. */
export interface CommonSolverResult {
  /** Monotonically increasing simulation time points $t_k$. */
  times: number[];
  /** State vectors $y(t_k)$ at each recorded time point (`states[timeIdx][stateIdx]`). */
  states: number[][];
  /** Optional solver performance and step-acceptance statistics. */
  stats?: SolverStats | undefined;
  /** Quantitative robustness certificates and violation metrics from attached STL monitors */
  stlResults?: STLVerificationResult[] | undefined;
}

// ── 1. ODE Problem ──

/**
 * Explicit Ordinary Differential Equation (ODE) initial value problem:
 * $$\frac{dy}{dt} = f(t, y, p), \quad y(t_0) = y_0$$
 */
export interface ODEProblem<P = Record<string, number> | number[]> {
  /** Vector field: dy/dt = f(t, y, p) */
  f: (t: number, y: number[], p?: P) => number[];
  /** Initial state vector at tSpan[0] */
  y0: number[];
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Optional parameter object or vector */
  p?: P | undefined;
  /** Optional analytical Jacobian J = df/dy */
  jac?: ((t: number, y: number[], p?: P) => number[][]) | undefined;
  /** Optional streaming Signal Temporal Logic (STL) robustness monitors */
  stlMonitors?: STLOnlineMonitor[] | undefined;
}

// ── 2. DAE Problem ──

/**
 * Differential-Algebraic Equation (DAE) initial value problem in fully implicit
 * form $F(t, y, y', p) = 0$ or mass-matrix form $M \frac{dy}{dt} = f(t, y, p)$.
 */
export interface DAEProblem<P = Record<string, number> | number[]> {
  /**
   * Residual function: F(t, y, y', p) = 0,
   * OR right-hand side f(t, y, p) when massMatrix is provided.
   */
  f: (t: number, y: number[], yp?: number[], p?: P) => number[];
  /** Initial state vector y(t0) */
  y0: number[];
  /** Initial derivative vector y'(t0) */
  yp0?: number[] | undefined;
  /** Time span [t0, tEnd] */
  tSpan: [number, number];
  /** Optional mass matrix M: M * dy/dt = f(t, y) */
  massMatrix?: number[][] | undefined;
  /** Optional boolean mask indicating which variables are algebraic vs differential */
  differentialVars?: boolean[] | undefined;
  /** Optional parameter object or vector */
  p?: P | undefined;
  /** Optional analytical Jacobian */
  jac?: ((t: number, y: number[], p?: P) => number[][]) | undefined;
  /** Optional streaming Signal Temporal Logic (STL) robustness monitors */
  stlMonitors?: STLOnlineMonitor[] | undefined;
}

// ── 3. SDE Problem ──

/** Structure of the diffusion term $g(t, y, p)\,dW_t$ in a stochastic differential equation. */
export type SDENoiseType = "diagonal" | "scalar" | "matrix";

/**
 * Itô / Stratonovich Stochastic Differential Equation (SDE) initial value problem:
 * $$dy = f(t, y, p)\,dt + g(t, y, p)\,dW_t, \quad y(t_0) = y_0$$
 */
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
  noiseType?: SDENoiseType | undefined;
  /** Number of Brownian motion paths / noise channels m (default: y0.length for diagonal) */
  mBrownian?: number | undefined;
  /** Optional parameter object or vector */
  p?: P | undefined;
  /** Optional PRNG seed */
  seed?: number | undefined;
}

/** Result of a single stochastic trajectory realization for an {@link SDEProblem}. */
export interface SDESimulationResult extends CommonSolverResult {
  /** Realization seed used */
  seed?: number | undefined;
}

/** Aggregated statistical moments and quantiles from an ensemble of Monte Carlo SDE realizations. */
export interface SDEEnsembleResult {
  /** Common evaluation time grid $t_k$. */
  times: number[];
  /** Mean trajectory E[y(t)] */
  mean: number[][];
  /** Variance trajectory Var(y(t)) */
  variance: number[][];
  /** Lower quantile (e.g. 5%) */
  quantile05?: number[][] | undefined;
  /** Median trajectory (50%) */
  median?: number[][] | undefined;
  /** Upper quantile (e.g. 95%) */
  quantile95?: number[][] | undefined;
  /** Sample trajectories (first few realizations) */
  samples?: number[][][] | undefined;
  /** Total number of realizations */
  numTrajectories: number;
}

// ── 4. DDE Problem ──

/**
 * Delay Differential Equation (DDE) initial value problem with constant or state-dependent delays:
 * $$\frac{dy}{dt} = f(t, y(t), y(t - \tau_1), \dots, p)$$
 */
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
  constantDelays?: number[] | undefined;
  /** Optional parameter object or vector */
  p?: P | undefined;
}

// ── 5. BVP Problem ──

/**
 * Two-point Boundary Value Problem (BVP):
 * $$\frac{dy}{dt} = f(t, y, p), \quad g(y(t_0), y(t_f), p) = 0$$
 */
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
  p?: P | undefined;
}

// ── 6. Flowpipe Reachability Problem ──

/** Formal safety bound specification checked against reachable Taylor-model flowpipes. */
export interface FlowpipeRequirementSpec {
  /** Zero-based index of the state variable to monitor. */
  stateIndex: number;
  /** Optional human-readable name of the monitored state variable. */
  stateName?: string | undefined;
  /** Relational comparison operator defining the safe region. */
  operator: "<=" | ">=" | "<" | ">";
  /** Scalar threshold value for the relational safety constraint. */
  limitValue: number;
}

/** Closed interval $[lo, hi]$ bounding an uncertain initial state or parameter dimension. */
export interface FlowpipeIntervalEnclosure {
  /** Lower bound of the interval enclosure. */
  lo: number;
  /** Upper bound of the interval enclosure. */
  hi: number;
}

/**
 * Continuous Taylor-Model flowpipe reachability problem for formal safety verification
 * under uncertain initial state enclosures.
 */
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
  order?: number | undefined;
  /** Safety requirements to formally verify against flowpipe */
  requirements?: FlowpipeRequirementSpec[] | undefined;
  /** Optional parameter object or vector */
  p?: P | undefined;
}

// ── 7. Hybrid Flowpipe Reachability Problem ──

/** Continuous operating mode in a hybrid automaton reachability problem. */
export interface HybridFlowpipeMode<P = Record<string, number> | number[]> {
  /** Unique identifier of the discrete mode. */
  id: string;
  /** Optional descriptive display name for the mode. */
  name?: string | undefined;
  /** Continuous dynamics vector field dy/dt = f(t, y, p) */
  f: (t: number, y: number[], p?: P) => number[];
  /** Invariants: state bounds that must hold while active in this mode */
  invariants?: { stateIndex: number; min?: number | undefined; max?: number | undefined }[] | undefined;
}

/** Guarded discrete transition with optional state reset map between two hybrid modes. */
export interface HybridTransitionSpec {
  /** Unique identifier of the transition edge. */
  id: string;
  /** Identifier of the originating discrete mode. */
  sourceModeId: string;
  /** Identifier of the destination discrete mode. */
  targetModeId: string;
  /** Guard condition scalar function g(y) <= 0 or zero crossing */
  guard: (y: number[]) => number;
  /** State reset map: y_post = reset(y_pre) */
  reset?: ((pre: number[]) => number[]) | undefined;
  /** Optional human-readable transition label. */
  label?: string | undefined;
}

/**
 * Hybrid automaton flowpipe reachability problem combining continuous Taylor-model
 * integration with discrete guard intersections and state reset maps.
 */
export interface HybridFlowpipeProblem<P = Record<string, number> | number[]> {
  /** List of discrete modes and their continuous vector fields. */
  modes: HybridFlowpipeMode<P>[];
  /** Directed guard transitions connecting discrete modes. */
  transitions: HybridTransitionSpec[];
  /** Identifier of the active mode at $t_0$. */
  initialModeId: string;
  /** Interval uncertainty enclosure for the initial state vector at $t_0$. */
  initialEnclosure: FlowpipeIntervalEnclosure[];
  /** Nominal center point of the initial state vector at $t_0$. */
  nominalInitial: number[];
  /** Time horizon $[t_0, t_{\text{end}}]$. */
  tSpan: [number, number];
  /** Nominal integration time step for flowpipe construction. */
  dt: number;
  /** Taylor model polynomial truncation order (default: 2). */
  order?: number | undefined;
  /** Whether to adaptively adjust step size during reachability propagation. */
  adaptive?: boolean | undefined;
  /** Local truncation tolerance for adaptive step control. */
  tol?: number | undefined;
  /** Whether to apply QR preconditioning to suppress wrapping effect growth. */
  useQrPreconditioning?: boolean | undefined;
  /** Formal safety requirements to verify across all reachable modes and steps. */
  requirements?: FlowpipeRequirementSpec[] | undefined;
  /** Maximum number of discrete mode transitions allowed along a reachability branch. */
  maxJumps?: number | undefined;
  /** Optional parameter object or vector passed to mode dynamics. */
  p?: P | undefined;
}

/** Verification result and violation diagnostics from hybrid flowpipe reachability analysis. */
export interface HybridFlowpipeResult {
  /** True if all reachable flowpipe enclosures satisfy every specified safety requirement. */
  isCertifiedSafe: boolean;
  /** Total number of continuous flowpipe integration steps computed. */
  totalSteps: number;
  /** Total number of discrete mode switches taken during reachability analysis. */
  jumpCount: number;
  /** Detailed list of safety requirement violations encountered. */
  violations: {
    /** Integration step index at which the violation occurred. */
    stepIndex: number;
    /** Simulation time at which the violation occurred. */
    time: number;
    /** Index of the state variable that breached the requirement. */
    stateIndex: number;
    /** Relational operator of the violated requirement. */
    operator: string;
    /** Worst-case enclosure bound value that triggered the violation. */
    worstCaseValue: number;
    /** Threshold limit value of the violated requirement. */
    limitValue: number;
    /** Human-readable explanation of the violation. */
    reason: string;
  }[];
  /** Human-readable summary of the verification outcome. */
  summary: string;
}
