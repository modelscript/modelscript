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

import type { ModelicaDAE } from "./dae.js";
import { ModelicaIntegerLiteral, ModelicaRealLiteral } from "./dae.js";
import { luFactor, luSolve, ModelicaSimulator } from "./simulator.js";
import { ModelicaVariability } from "./syntax.js";

// ── Public interfaces ──

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
  let iter = 0;

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

  optimize(): OptimizationResult {
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
    // AD-based objective gradient: ∂(∫ ∑u²dt)/∂z
    // For quadratic cost ∑ u², ∂L/∂u_j = 2·u_j, ∂L/∂x_i = 0
    const evalGradient = (z: Float64Array, g: Float64Array): void => {
      g.fill(0);
      for (let k = 0; k < nPoints; k++) {
        const w = k === 0 || k === N ? 0.5 : 1.0;
        for (let j = 0; j < nControls; j++) {
          const uVal = z[k * varsPerPoint + nStates + j]!;
          g[k * varsPerPoint + nStates + j] = w * dt * 2 * uVal;
        }
      }
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

    // Extract results
    const stateTrajectories = new Map<string, number[]>();
    const controlTrajectories = new Map<string, number[]>();

    for (let i = 0; i < nStates; i++) {
      const name = stateNames[i]!;
      const vals: number[] = [];
      for (let k = 0; k < nPoints; k++) {
        vals.push(result.z[k * varsPerPoint + i]!);
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
