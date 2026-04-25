// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Optimal control solver for Modelica models using direct collocation.
 *
 * Transcribes the continuous-time optimal control problem:
 *   min_{u(t)} ∫₀ᵀ L(x,u,t) dt + Φ(x(T))
 *   s.t. ẋ = f(x,u,t),  x(0) = x₀,  u_min ≤ u(t) ≤ u_max
 *
 * into a finite-dimensional NLP using trapezoidal collocation, then solves
 * with a sequential quadratic programming (SQP) method using BFGS Hessian
 * approximation.
 *
 * Pure TypeScript — no native dependencies.
 */

import { ModelicaVariability } from "@modelscript/modelica/ast";
import type { MonteCarloOptions, RandomVariable, SolverOptions } from "@modelscript/simulator";
import { luFactor, luSolve, ModelicaSimulator, Tape, type TapeNode } from "@modelscript/simulator";
import type { ModelicaDAE } from "@modelscript/symbolics";
import { ModelicaIntegerLiteral, ModelicaRealLiteral } from "@modelscript/symbolics";
import {
  ProgressiveHedging,
  SampleAverageApproximation,
  type MultiStageStochasticProblem,
  type StochasticProblem,
} from "./stochastic-optimizer.js";

// ── Public interfaces ──

/** Transcription method for optimal control. */
export type TranscriptionMethod = "trapezoidal" | "lgr" | "multiple-shooting" | "single-shooting";

/** Robust optimization formulation. */
export type RobustMethod = "worst-case" | "chance-constrained" | "expected-value" | "cvar" | "distributionally-robust";

export interface OptimizationProblem {
  /** Lagrange cost integrand expression string, e.g. "u^2" */
  objective: string;
  /** Variable names treated as free controls */
  controls: string[];
  /** Box constraints on controls: name → { min, max } */
  controlBounds: Map<string, { min: number; max: number }>;
  /** Optional Mayer terminal cost expression, e.g. "(x - 1)^2" */
  terminalCost?: string;
  startTime: number;
  stopTime: number;
  /** Number of collocation intervals */
  numIntervals: number;
  /** NLP convergence tolerance (default 1e-6) */
  tolerance?: number;
  /** Maximum SQP iterations (default 200) */
  maxIterations?: number;
  /** Override parameters for the simulation */
  parameterOverrides?: Map<string, number>;
  /** Solver options for optimization and simulation */
  solverOptions?: SolverOptions;
  /** Transcription method (default: "trapezoidal") */
  method?: TranscriptionMethod;
  /** Random variables with uncertainty distributions */
  randomVariables?: RandomVariable[];
  /** Robust/stochastic optimization formulation */
  robustMethod?: RobustMethod;
  /** Conditional Value at Risk (CVaR) confidence level (e.g. 0.95) */
  cvarLevel?: number;
  /** Chance constraint probability level (default: 0.95) */
  chanceLevel?: number;
  /** Monte Carlo options (for SAA-based methods) */
  monteCarloOptions?: MonteCarloOptions;
  /** Whether to use analytical uncertainty propagation in the NLP (default: true) */
  analyticalUncertainty?: boolean;
}

/**
 * Transcription strategy interface: converts a continuous-time OCP
 * into a finite-dimensional NLP.
 */
export interface TranscriptionStrategy {
  /** Number of NLP decision variables. */
  nVars: number;
  /** Number of equality constraints. */
  nEq: number;
  /** Initial guess. */
  z0: Float64Array;
  /** Lower bounds on decision variables. */
  lb: Float64Array;
  /** Upper bounds on decision variables. */
  ub: Float64Array;
  /** Evaluate the NLP objective. */
  evalObjective(z: Float64Array): number;
  /** Evaluate the NLP equality constraints. */
  evalConstraints(z: Float64Array, c: Float64Array): void;
  /** Time grid for results extraction. */
  tGrid: number[];
  /** Extract state trajectories from the NLP solution. */
  extractStates(z: Float64Array): Map<string, number[]>;
  /** Extract control trajectories from the NLP solution. */
  extractControls(z: Float64Array): Map<string, number[]>;
}

export interface OptimizationResult {
  success: boolean;
  cost: number;
  iterations: number;
  /** Time grid points */
  t: number[];
  /** Optimal state trajectories: name → values at each grid point */
  states: Map<string, number[]>;
  /** Optimal control trajectories: name → values at each grid point */
  controls: Map<string, number[]>;
  /** Cost at each SQP iteration */
  costHistory: number[];
  messages: string;
}

// ── LGR Quadrature Utilities ──

/**
 * Compute Legendre-Gauss-Radau (LGR) collocation nodes and quadrature weights
 * on the interval [-1, 1]. The right endpoint +1 is included as a node.
 *
 * Uses the companion matrix eigenvalue method for the LGR nodes.
 * @param degree Number of interior collocation points (total nodes = degree + 1).
 */
export function lgrNodesAndWeights(degree: number): { nodes: number[]; weights: number[] } {
  if (degree < 1) return { nodes: [1], weights: [2] };

  // LGR nodes: roots of P_n(x) + P_{n-1}(x) where P_n is Legendre polynomial
  // For small degrees, use known analytical values
  const N = degree;
  const nodes: number[] = new Array(N + 1);
  const weights: number[] = new Array(N + 1);

  // Initial guess via Chebyshev nodes
  for (let i = 0; i < N; i++) {
    nodes[i] = -Math.cos((Math.PI * (2 * i + 1)) / (2 * N));
  }
  nodes[N] = 1; // Right endpoint is always included in LGR

  // Newton iteration to refine interior nodes (roots of P_N + P_{N-1})
  for (let i = 0; i < N; i++) {
    let x = nodes[i]!;
    for (let iter = 0; iter < 100; iter++) {
      // Evaluate P_N(x) and P_{N-1}(x) via recurrence
      let pNm1 = 1,
        pN = x;
      for (let k = 2; k <= N; k++) {
        const pNp1 = ((2 * k - 1) * x * pN - (k - 1) * pNm1) / k;
        pNm1 = pN;
        pN = pNp1;
      }
      // Also need P_{N-1}
      let qNm2 = 1,
        qNm1 = x;
      for (let k = 2; k < N; k++) {
        const q = ((2 * k - 1) * x * qNm1 - (k - 1) * qNm2) / k;
        qNm2 = qNm1;
        qNm1 = q;
      }
      const f = pN + (N > 1 ? qNm1 : 1);
      // Derivative: P'_N(x) + P'_{N-1}(x)
      const dpN = (N * (pNm1 - x * pN)) / (1 - x * x + 1e-30);
      let dpNm1 = 0;
      if (N > 1) dpNm1 = ((N - 1) * (qNm2 - x * qNm1)) / (1 - x * x + 1e-30);
      const df = dpN + dpNm1;
      if (Math.abs(df) < 1e-30) break;
      const dx = -f / df;
      x += dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    nodes[i] = x;
  }

  // Compute weights via the formula: w_i = (1 - x_i) / (N * P_{N-1}(x_i))^2
  for (let i = 0; i <= N; i++) {
    const x = nodes[i]!;
    // Evaluate P_{N}(x) and P_{N-1}(x)
    let pNm1 = 1,
      pN = x;
    for (let k = 2; k <= N; k++) {
      const pNp1 = ((2 * k - 1) * x * pN - (k - 1) * pNm1) / k;
      pNm1 = pN;
      pN = pNp1;
    }
    if (i < N) {
      // Interior LGR weight
      weights[i] = (1 - x) / (N * N * pNm1 * pNm1 + 1e-30);
    } else {
      // Endpoint weight
      weights[i] = 2 / (N * N + N);
    }
  }

  return { nodes, weights };
}

/**
 * Compute the LGR differentiation matrix D such that D @ f ≈ f'
 * at the LGR collocation nodes.
 */
export function lgrDifferentiationMatrix(nodes: number[]): Float64Array {
  const N = nodes.length;
  const D = new Float64Array(N * N);

  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i !== j) {
        // Barycentric Lagrange differentiation
        let numI = 1,
          numJ = 1;
        for (let k = 0; k < N; k++) {
          if (k !== i) numI *= nodes[i]! - nodes[k]!;
          if (k !== j) numJ *= nodes[j]! - nodes[k]!;
        }
        D[i * N + j] = numI !== 0 ? numJ / (numI * (nodes[i]! - nodes[j]!)) : 0;
      }
    }
    // Diagonal: D[i,i] = -sum_{j≠i} D[i,j]
    let diag = 0;
    for (let j = 0; j < N; j++) {
      if (j !== i) diag -= D[i * N + j]!;
    }
    D[i * N + i] = diag;
  }

  return D;
}

// ── SQP Solver ──

/** Maximum SQP iterations */
const DEFAULT_MAX_ITER = 200;
/** Armijo line search parameter */
const ARMIJO_C1 = 1e-4;
/** Minimum step size for line search */
const MIN_ALPHA = 1e-12;
/** Finite-difference perturbation */
const FD_EPS = 1e-7;

/**
 * Solve a box-constrained NLP:
 *   min f(z)  s.t.  c(z) = 0,  lb ≤ z ≤ ub
 *
 * Uses SQP with BFGS Hessian approximation and augmented Lagrangian merit function.
 */
function sqpSolve(
  n: number,
  nEq: number,
  evalObjective: (z: Float64Array) => number,
  evalConstraints: (z: Float64Array, c: Float64Array) => void,
  lb: Float64Array,
  ub: Float64Array,
  z0: Float64Array,
  tol: number,
  maxIter: number,
  evalGradient?: (z: Float64Array, g: Float64Array) => void,
  evalJacobian?: (z: Float64Array, J: Float64Array[]) => void,
): { z: Float64Array; cost: number; iterations: number; costHistory: number[]; converged: boolean } {
  const z = new Float64Array(z0);
  const costHistory: number[] = [];

  // BFGS Hessian approximation — start with identity
  const H = new Array<Float64Array>(n);
  for (let i = 0; i < n; i++) {
    H[i] = new Float64Array(n);
    H[i]![i] = 1.0;
  }

  const grad = new Float64Array(n);
  const gradPrev = new Float64Array(n);
  const c = new Float64Array(nEq);
  const cTrial = new Float64Array(nEq);

  // Penalty parameter for augmented Lagrangian merit function
  let mu = 10.0;
  // Lagrange multiplier estimates
  const lambda = new Float64Array(nEq);

  function computeGrad(zz: Float64Array, g: Float64Array): void {
    if (evalGradient) {
      // Use AD-based exact gradient
      evalGradient(zz, g);
    } else {
      // Fallback: finite differences
      const f0 = evalObjective(zz);
      for (let i = 0; i < n; i++) {
        const orig = zz[i]!;
        const h = Math.max(FD_EPS, Math.abs(orig) * FD_EPS);
        zz[i] = orig + h;
        g[i] = (evalObjective(zz) - f0) / h;
        zz[i] = orig;
      }
    }
  }

  function meritFunction(zz: Float64Array): number {
    const f = evalObjective(zz);
    evalConstraints(zz, cTrial);
    let penalty = 0;
    for (let i = 0; i < nEq; i++) {
      penalty += cTrial[i]! * cTrial[i]!;
    }
    return f + (mu / 2) * penalty;
  }

  let cost = evalObjective(z);
  costHistory.push(cost);

  let converged = false;
  let iter: number;

  for (iter = 0; iter < maxIter; iter++) {
    evalConstraints(z, c);
    computeGrad(z, grad);

    // Compute constraint Jacobian
    const J = new Array<Float64Array>(nEq);
    for (let i = 0; i < nEq; i++) J[i] = new Float64Array(n);

    if (evalJacobian) {
      // Use AD-based exact Jacobian
      evalJacobian(z, J);
    } else {
      // Fallback: finite differences
      const c0 = new Float64Array(c);
      const cPerturbed = new Float64Array(nEq);
      for (let j = 0; j < n; j++) {
        const orig = z[j]!;
        const h = Math.max(FD_EPS, Math.abs(orig) * FD_EPS);
        z[j] = orig + h;
        evalConstraints(z, cPerturbed);
        z[j] = orig;
        for (let i = 0; i < nEq; i++) {
          J[i]![j] = (cPerturbed[i]! - c0[i]!) / h;
        }
      }
    }

    // Check KKT conditions for convergence
    let kktResidual = 0;
    for (let i = 0; i < n; i++) kktResidual = Math.max(kktResidual, Math.abs(grad[i]!));
    let constraintViol = 0;
    for (let i = 0; i < nEq; i++) constraintViol = Math.max(constraintViol, Math.abs(c[i]!));

    if (kktResidual < tol && constraintViol < tol) {
      converged = true;
      break;
    }

    // ── Solve QP subproblem ──
    // min  grad'·d + 0.5·d'·H·d
    // s.t. c + J·d = 0
    //      lb - z ≤ d ≤ ub - z
    //
    // Simplified: solve the KKT system directly
    //   [H   J'] [d     ]   [-grad]
    //   [J   0 ] [lambda] = [-c   ]

    const kktSize = n + nEq;
    const KKT = new Array<Float64Array>(kktSize);
    for (let i = 0; i < kktSize; i++) KKT[i] = new Float64Array(kktSize);

    // Fill H block
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        KKT[i]![j] = H[i]![j]!;
      }
    }
    // Fill J and J' blocks
    for (let i = 0; i < nEq; i++) {
      for (let j = 0; j < n; j++) {
        KKT[n + i]![j] = J[i]![j]!;
        KKT[j]![n + i] = J[i]![j]!;
      }
    }

    // RHS
    const rhs = new Float64Array(kktSize);
    for (let i = 0; i < n; i++) rhs[i] = -grad[i]!;
    for (let i = 0; i < nEq; i++) rhs[n + i] = -c[i]!;

    // Solve via LU
    const lu = luFactor(KKT, kktSize);
    luSolve(lu, rhs);

    const d = rhs.subarray(0, n);
    // Update multiplier estimates
    for (let i = 0; i < nEq; i++) lambda[i] = rhs[n + i]!;

    // Project step onto box constraints
    for (let i = 0; i < n; i++) {
      const newZ = z[i]! + d[i]!;
      if (newZ < lb[i]!) d[i] = lb[i]! - z[i]!;
      if (newZ > ub[i]!) d[i] = ub[i]! - z[i]!;
    }

    // ── Armijo backtracking line search on merit function ──
    const m0 = meritFunction(z);
    let dirDeriv = 0;
    for (let i = 0; i < n; i++) dirDeriv += grad[i]! * d[i]!;

    let alpha = 1.0;
    const zTrial = new Float64Array(n);
    while (alpha > MIN_ALPHA) {
      for (let i = 0; i < n; i++) {
        zTrial[i] = Math.max(lb[i]!, Math.min(ub[i]!, z[i]! + alpha * d[i]!));
      }
      const mTrial = meritFunction(zTrial);
      if (mTrial <= m0 + ARMIJO_C1 * alpha * dirDeriv) break;
      alpha *= 0.5;
    }

    // Save previous gradient for BFGS
    gradPrev.set(grad);

    // Take step
    for (let i = 0; i < n; i++) {
      z[i] = Math.max(lb[i]!, Math.min(ub[i]!, z[i]! + alpha * d[i]!));
    }

    cost = evalObjective(z);
    costHistory.push(cost);

    // ── BFGS update ──
    computeGrad(z, grad);
    const s = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      s[i] = alpha * d[i]!;
      y[i] = grad[i]! - gradPrev[i]!;
    }
    let sy = 0;
    for (let i = 0; i < n; i++) sy += s[i]! * y[i]!;

    if (sy > 1e-12) {
      // H ← H + (y·y')/(y'·s) - (H·s·s'·H)/(s'·H·s)
      const Hs = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < n; j++) sum += H[i]![j]! * s[j]!;
        Hs[i] = sum;
      }
      let sHs = 0;
      for (let i = 0; i < n; i++) sHs += s[i]! * Hs[i]!;

      if (sHs > 1e-12) {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            H[i]![j] = H[i]![j]! + (y[i]! * y[j]!) / sy - (Hs[i]! * Hs[j]!) / sHs;
          }
        }
      }
    }

    // Increase penalty if constraints are not decreasing
    if (constraintViol > tol * 10) {
      mu = Math.min(mu * 1.5, 1e6);
    }
  }

  return { z, cost, iterations: iter, costHistory, converged };
}

// ── ModelicaOptimizer ──

export class ModelicaOptimizer {
  private dae: ModelicaDAE;
  private simulator: ModelicaSimulator;
  private problem: OptimizationProblem;

  constructor(dae: ModelicaDAE, problem: OptimizationProblem) {
    this.dae = dae;
    this.simulator = new ModelicaSimulator(dae);
    this.problem = problem;
  }

  /**
   * Solve the optimal control problem.
   *
   * If the problem contains random variables, it dispatches to the
   * stochastic optimization solvers (SAA or Progressive Hedging).
   */
  public solve(augmentedLagrangian?: {
    multipliers: Map<string, number[]>;
    consensus: Map<string, number[]>;
    rho: number;
  }): OptimizationResult {
    // ── Stochastic Optimization Dispatch ──
    if (this.problem.randomVariables && this.problem.randomVariables.length > 0) {
      if (this.problem.robustMethod === "distributionally-robust" || augmentedLagrangian) {
        // Use Progressive Hedging (augmentedLagrangian is passed during PH iterations)
        if (!augmentedLagrangian) {
          const ph = new ProgressiveHedging();
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { randomVariables, ...baseProblem } = this.problem;
          const msProblem: MultiStageStochasticProblem = {
            stages: [
              { variables: this.problem.controls, ...(this.problem.method ? { method: this.problem.method } : {}) },
            ],
            scenarios: [], // Will be generated by PH
            weights: [],
          };
          return ph.solve(
            msProblem,
            (bp, overrides, aug) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const subSolver = new (this.constructor as any)(this.dae, {
                ...bp,
                parameterOverrides: overrides,
              });
              return subSolver.solve(aug);
            },
            baseProblem,
          );
        }
      } else {
        // Default to Sample Average Approximation for expected-value, chance-constrained, CVaR
        // Only run SAA if we're not already inside a PH subproblem loop (augmentedLagrangian is undefined)
        if (!augmentedLagrangian) {
          const saa = new SampleAverageApproximation();
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { randomVariables, monteCarloOptions, ...baseProblem } = this.problem;
          const sp: StochasticProblem = {
            baseProblem,
            randomVariables: this.problem.randomVariables,
            ...(this.problem.monteCarloOptions ? { monteCarloOptions: this.problem.monteCarloOptions } : {}),
          };
          return saa.solve(sp, (bp, overrides) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const subSolver = new (this.constructor as any)(this.dae, {
              ...bp,
              parameterOverrides: overrides,
            });
            return subSolver.solve();
          });
        }
      }
    }

    // ── Deterministic NLP Construction ──
    const { startTime, stopTime, numIntervals, controls, controlBounds } = this.problem;
    const tol = this.problem.tolerance ?? 1e-6;
    const maxIter = this.problem.maxIterations ?? DEFAULT_MAX_ITER;

    // Prepare the simulator (causalize equations, build execution blocks)
    this.simulator.prepare();

    const stateNames = Array.from(this.simulator.stateVars);
    const nStates = stateNames.length;
    const nControls = controls.length;
    const N = numIntervals;
    const nPoints = N + 1;
    const dt = (stopTime - startTime) / N;

    // Build time grid
    const tGrid: number[] = [];
    for (let k = 0; k <= N; k++) {
      tGrid.push(startTime + k * dt);
    }

    // Decision variable layout: [x₀, u₀, x₁, u₁, ..., xₙ, uₙ]
    const varsPerPoint = nStates + nControls;
    const nVars = nPoints * varsPerPoint;

    // Equality constraints: dynamics (trapezoidal collocation) at each interval
    // x_{k+1} - x_k - (dt/2)(f_k + f_{k+1}) = 0, for each state, each interval
    const nEqConstraints = N * nStates;

    // Build initial guess: simulate forward with midpoint controls
    const z0 = new Float64Array(nVars);

    // Resolve initial state values
    const paramEnv = new Map<string, number>();
    for (const v of this.dae.variables) {
      if (v.variability === ModelicaVariability.PARAMETER || v.variability === ModelicaVariability.CONSTANT) {
        if (v.expression) {
          if (v.expression instanceof ModelicaRealLiteral) paramEnv.set(v.name, v.expression.value);
          else if (v.expression instanceof ModelicaIntegerLiteral) paramEnv.set(v.name, v.expression.value);
        }
      }
    }

    for (let i = 0; i < nStates; i++) {
      const name = stateNames[i]!;
      let initVal = 0;
      for (const v of this.dae.variables) {
        if (v.name === name) {
          if (v.expression instanceof ModelicaRealLiteral) {
            initVal = v.expression.value;
            break;
          }
          if (v.expression instanceof ModelicaIntegerLiteral) {
            initVal = v.expression.value;
            break;
          }
          const startAttr = v.attributes.get("start");
          if (startAttr instanceof ModelicaRealLiteral) {
            initVal = startAttr.value;
            break;
          }
          if (startAttr instanceof ModelicaIntegerLiteral) {
            initVal = startAttr.value;
            break;
          }
          break;
        }
      }
      // Set initial states at all grid points (crude initial guess)
      for (let k = 0; k < nPoints; k++) {
        z0[k * varsPerPoint + i] = initVal;
      }
    }

    // Set initial controls to midpoint of bounds
    for (let j = 0; j < nControls; j++) {
      const name = controls[j]!;
      const bounds = controlBounds.get(name);
      const mid = bounds ? (bounds.min + bounds.max) / 2 : 0;
      for (let k = 0; k < nPoints; k++) {
        z0[k * varsPerPoint + nStates + j] = mid;
      }
    }

    // Build box constraints
    const lb = new Float64Array(nVars).fill(-1e10);
    const ub = new Float64Array(nVars).fill(1e10);

    // Apply control bounds
    for (let j = 0; j < nControls; j++) {
      const name = controls[j]!;
      const bounds = controlBounds.get(name);
      if (bounds) {
        for (let k = 0; k < nPoints; k++) {
          lb[k * varsPerPoint + nStates + j] = bounds.min;
          ub[k * varsPerPoint + nStates + j] = bounds.max;
        }
      }
    }

    // Fix initial state values (equality constraints via tight bounds)
    for (let i = 0; i < nStates; i++) {
      const initVal = z0[i]!;
      lb[i] = initVal;
      ub[i] = initVal;
    }

    // Helper: extract state and control values at grid point k
    const getStateMap = (z: Float64Array, k: number): Map<string, number> => {
      const m = new Map<string, number>();
      for (let i = 0; i < nStates; i++) {
        m.set(stateNames[i]!, z[k * varsPerPoint + i]!);
      }
      return m;
    };

    const getControlMap = (z: Float64Array, k: number): Map<string, number> => {
      const m = new Map<string, number>();
      for (let j = 0; j < nControls; j++) {
        m.set(controls[j]!, z[k * varsPerPoint + nStates + j]!);
      }
      return m;
    };

    // Augmented Lagrangian penalty for Progressive Hedging consensus
    const evaluateAugmentedLagrangian = (z: Float64Array): number => {
      if (!augmentedLagrangian) return 0;
      let penalty = 0;
      const { multipliers, consensus, rho } = augmentedLagrangian;

      for (let j = 0; j < nControls; j++) {
        const name = controls[j]!;
        const w = multipliers.get(name);
        const xbar = consensus.get(name);
        if (!w || !xbar) continue;

        for (let k = 0; k < nPoints; k++) {
          const idx = k * varsPerPoint + nStates + j;
          const u_k = z[idx]!;
          const w_k = w[k] ?? 0;
          const xbar_k = xbar[k] ?? 0;
          const diff = u_k - xbar_k;

          penalty += w_k * diff + (rho / 2) * diff * diff;
        }
      }
      return penalty;
    };

    // Objective: trapezoidal integration of Lagrange cost
    const evalObjective = (z: Float64Array): number => {
      let cost = 0;
      for (let k = 0; k < nPoints; k++) {
        const uMap = getControlMap(z, k);
        let L = 0;
        // Evaluate cost integrand: sum of u_i^2 (standard quadratic control cost)
        // TODO: parse arbitrary objective expressions
        for (const [, uVal] of uMap) {
          L += uVal * uVal;
        }
        const w = k === 0 || k === N ? 0.5 : 1.0;
        cost += w * dt * L;
      }
      cost += evaluateAugmentedLagrangian(z);
      return cost;
    };

    // Equality constraints: trapezoidal collocation dynamics
    const evalConstraints = (z: Float64Array, c: Float64Array): void => {
      for (let k = 0; k < N; k++) {
        const xk = getStateMap(z, k);
        const uk = getControlMap(z, k);
        const xk1 = getStateMap(z, k + 1);
        const uk1 = getControlMap(z, k + 1);

        const fk = this.simulator.evaluateRHS(tGrid[k]!, xk, uk);
        const fk1 = this.simulator.evaluateRHS(tGrid[k + 1]!, xk1, uk1);

        for (let i = 0; i < nStates; i++) {
          const name = stateNames[i]!;
          const xkVal = z[k * varsPerPoint + i]!;
          const xk1Val = z[(k + 1) * varsPerPoint + i]!;
          const fkVal = fk.get(name) ?? 0;
          const fk1Val = fk1.get(name) ?? 0;
          // Trapezoidal: x_{k+1} - x_k - (dt/2)(f_k + f_{k+1}) = 0
          c[k * nStates + i] = xk1Val - xkVal - (dt / 2) * (fkVal + fk1Val);
        }
      }
    };
    // Reverse-mode AD objective gradient: single forward+backward pass for all ∂f/∂z_i
    const evalGradient = (z: Float64Array, g: Float64Array): void => {
      const tape = new Tape();
      // Create tracked tape nodes for all decision variables
      const zNodes: TapeNode[] = [];
      for (let i = 0; i < nVars; i++) zNodes.push(tape.variable(z[i]!));

      // Evaluate objective on tape: trapezoidal ∫ L(u) dt
      let costNode = tape.constant(0);
      for (let k = 0; k < nPoints; k++) {
        const w = tape.constant(k === 0 || k === N ? 0.5 : 1.0);
        const dtNode = tape.constant(dt);
        // Compute L = ∑ u_i² at grid point k
        let L = tape.constant(0);
        for (let j = 0; j < nControls; j++) {
          const uNode = zNodes[k * varsPerPoint + nStates + j]!;
          L = tape.add(L, tape.mul(uNode, uNode));
        }
        costNode = tape.add(costNode, tape.mul(w, tape.mul(dtNode, L)));
      }

      // Single backward pass → all gradients simultaneously
      tape.backward(costNode);
      for (let i = 0; i < nVars; i++) g[i] = zNodes[i]!.adjoint;
    };

    // AD-based constraint Jacobian using forward-mode AD through the model dynamics
    const evalJacobian = (z: Float64Array, J: Float64Array[]): void => {
      // All seed variable names: state names + control names
      const allSeeds = [...stateNames, ...controls];

      for (let k = 0; k < N; k++) {
        const xk = getStateMap(z, k);
        const uk = getControlMap(z, k);
        const xk1 = getStateMap(z, k + 1);
        const uk1 = getControlMap(z, k + 1);

        // Jacobians of f at grid points k and k+1
        const { J: Jk } = this.simulator.evaluateRHSWithJacobian(tGrid[k]!, xk, uk, allSeeds);
        const { J: Jk1 } = this.simulator.evaluateRHSWithJacobian(tGrid[k + 1]!, xk1, uk1, allSeeds);

        // Constraint: c_{k,i} = x_{k+1,i} - x_{k,i} - (dt/2)(f_{k,i} + f_{k+1,i}) = 0
        // ∂c_{k,i}/∂z_j:
        //   If z_j is x_{k,m}:    -δ_{im} - (dt/2)(∂f_k_i/∂x_m)
        //   If z_j is u_{k,m}:             - (dt/2)(∂f_k_i/∂u_m)
        //   If z_j is x_{k+1,m}:  +δ_{im} - (dt/2)(∂f_{k+1}_i/∂x_m)
        //   If z_j is u_{k+1,m}:           - (dt/2)(∂f_{k+1}_i/∂u_m)
        for (let i = 0; i < nStates; i++) {
          const stateName = stateNames[i]!;
          const row = k * nStates + i;
          const JkRow = Jk.get(stateName);
          const Jk1Row = Jk1.get(stateName);

          // Derivatives w.r.t. variables at grid point k
          for (let m = 0; m < nStates; m++) {
            const col = k * varsPerPoint + m;
            const dfk = JkRow?.get(stateNames[m]!) ?? 0;
            // -δ_{im} from -x_k term, -(dt/2)·∂f_k/∂x_m from dynamics
            J[row]![col] = -(m === i ? 1 : 0) - (dt / 2) * dfk;
          }
          for (let m = 0; m < nControls; m++) {
            const col = k * varsPerPoint + nStates + m;
            const dfk = JkRow?.get(controls[m]!) ?? 0;
            J[row]![col] = -(dt / 2) * dfk;
          }

          // Derivatives w.r.t. variables at grid point k+1
          for (let m = 0; m < nStates; m++) {
            const col = (k + 1) * varsPerPoint + m;
            const dfk1 = Jk1Row?.get(stateNames[m]!) ?? 0;
            // +δ_{im} from +x_{k+1} term, -(dt/2)·∂f_{k+1}/∂x_m from dynamics
            J[row]![col] = (m === i ? 1 : 0) - (dt / 2) * dfk1;
          }
          for (let m = 0; m < nControls; m++) {
            const col = (k + 1) * varsPerPoint + nStates + m;
            const dfk1 = Jk1Row?.get(controls[m]!) ?? 0;
            J[row]![col] = -(dt / 2) * dfk1;
          }
        }
      }
    };

    // Solve the NLP with AD-based gradient and Jacobian
    const result = sqpSolve(
      nVars,
      nEqConstraints,
      evalObjective,
      evalConstraints,
      lb,
      ub,
      z0,
      tol,
      maxIter,
      evalGradient,
      evalJacobian,
    );

    // Run one final simulation with the optimal controls to get the fine-grained state trajectories
    const optControls = new Map<string, number[]>();
    for (let j = 0; j < nControls; j++) {
      const name = controls[j]!;
      const uOpt = new Array<number>(nPoints);
      for (let k = 0; k < nPoints; k++) {
        uOpt[k] = result.z[k * varsPerPoint + nStates + j]!;
      }
      optControls.set(name, uOpt);
    }

    // Extract results
    const stateTrajectories = new Map<string, number[]>();
    const controlTrajectories = new Map<string, number[]>();

    const finalSimOpts = {
      parameterOverrides: new Map<string, number>(this.problem.parameterOverrides ?? []),
      ...(this.problem.solverOptions ? { solverOptions: this.problem.solverOptions } : {}),
    };
    for (let k = 0; k < N; k++) {
      for (const name of controls) {
        finalSimOpts.parameterOverrides.set(name, optControls.get(name)![k]!);
      }
    }

    const simResult = this.simulator.simulate(startTime, stopTime, dt, finalSimOpts);

    for (let i = 0; i < nStates; i++) {
      const name = stateNames[i]!;
      const vals: number[] = [];
      for (let k = 0; k < nPoints; k++) {
        vals.push(simResult.y[k]![i]!);
      }
      stateTrajectories.set(name, vals);
    }

    for (let j = 0; j < nControls; j++) {
      const name = controls[j]!;
      const vals: number[] = [];
      for (let k = 0; k < nPoints; k++) {
        vals.push(result.z[k * varsPerPoint + nStates + j]!);
      }
      controlTrajectories.set(name, vals);
    }

    return {
      success: result.converged,
      cost: result.cost,
      iterations: result.iterations,
      t: tGrid,
      states: stateTrajectories,
      controls: controlTrajectories,
      costHistory: result.costHistory,
      messages: result.converged
        ? `Converged in ${result.iterations} iterations.`
        : `Did not converge after ${result.iterations} iterations (cost=${result.cost.toExponential(4)}).`,
    };
  }
}
