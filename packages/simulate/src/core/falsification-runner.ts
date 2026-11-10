// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Adjoint-Guided Requirement Falsification Engine.
 *
 * Implements active adversarial search for counterexamples violating Signal Temporal Logic (STL)
 * safety requirements. Uses trajectory sensitivity gradients ∇_p ρ(φ, w, p) to drive gradient-descent
 * and global optimization (S-TaLiRo / Breach parity).
 */

import { solveODE } from "../solvers/tsit5.js";
import { type STLFormula, OnlineSTLMonitor } from "./stl_monitor.js";

export interface ParameterBound {
  name: string;
  min: number;
  max: number;
  nominal?: number | undefined;
}

export interface FalsificationProblem {
  /** Right-hand side of ODE/DAE: (t, y, p) => dy/dt */
  f: (t: number, y: number[], p: Record<string, number>) => number[];
  /** Initial state vector: y0(p) */
  y0: number[] | ((p: Record<string, number>) => number[]);
  /** Simulation time horizon [t0, tEnd] */
  tSpan: [number, number];
  /** Parameter uncertainty search domain */
  parameters: ParameterBound[];
  /** STL safety requirement to falsify (find rho < 0) */
  requirement: STLFormula;
  /** Optional requirement label */
  requirementName?: string | undefined;
  /** Optional analytical state Jacobian: df/dy (n x n) */
  df_dy?: ((t: number, y: number[], p: Record<string, number>) => number[][]) | undefined;
  /** Optional analytical parameter Jacobian: df/dp (n x m) */
  df_dp?: ((t: number, y: number[], p: Record<string, number>) => Record<string, number[]>) | undefined;
  /** Optional robustness gradient with respect to state: d(rho)/dy at critical time */
  drho_dy?: ((t: number, y: number[], p: Record<string, number>) => number[]) | undefined;
}

export interface FalsificationOptions {
  /** Maximum number of falsification iterations (default: 50) */
  maxIterations?: number | undefined;
  /** Learning rate for gradient descent step (default: 0.1) */
  learningRate?: number | undefined;
  /** Numerical finite difference perturbation epsilon (default: 1e-4) */
  epsilon?: number | undefined;
  /** Number of random restart attempts if gradient stalls (default: 3) */
  randomRestarts?: number | undefined;
  /** Early exit as soon as any violation rho < 0 is discovered (default: true) */
  earlyExit?: boolean | undefined;
  /**
   * Sensitivity gradient calculation method:
   *   - "adjoint": Reverse-mode continuous adjoint integration (O(1) simulation pass)
   *   - "fd": Central finite differences (2 * N_params simulation passes)
   *   - "auto": Uses adjoint if parameters >= 2 or analytical Jacobians provided, else fd (default: "auto")
   */
  gradientMode?: "auto" | "adjoint" | "fd" | undefined;
}

export interface FalsificationResult {
  /** Whether a falsifying parameter vector was successfully discovered */
  isFalsified: boolean;
  /** Counterexample parameter vector p* */
  counterexampleParams?: Record<string, number> | undefined;
  /** Worst-case robustness degree rho(p*) */
  minRobustness: number;
  /** Simulation timestamp where violation occurred */
  violationTime?: number | undefined;
  /** Total number of simulation trajectory evaluations */
  evaluations: number;
  /** Iteration history: [iteration, rho, params] */
  history: { iteration: number; robustness: number; params: Record<string, number> }[];
  /** Trajectory that violates requirement */
  falsifyingTrajectory?:
    | {
        times: number[];
        states: number[][];
      }
    | undefined;
}

/**
 * Active STL Falsification Engine.
 */
export class FalsificationRunner {
  constructor(public readonly problem: FalsificationProblem) {}

  /**
   * Evaluates the simulation trajectory and STL robustness for parameter vector p.
   */
  public evaluateTrajectory(p: Record<string, number>): {
    robustness: number;
    violationTime?: number | undefined;
    times: number[];
    states: number[][];
  } {
    const { f, y0, tSpan, requirement, requirementName } = this.problem;
    const initialY = typeof y0 === "function" ? y0(p) : y0;

    const rhs = (t: number, y: number[]) => f(t, y, p);
    const simRes = solveODE({ f: rhs, y0: initialY, tSpan });

    const monitor = new OnlineSTLMonitor(requirement, { requirementName });
    for (let i = 0; i < simRes.times.length; i++) {
      monitor.step(simRes.times[i]!, simRes.states[i]!);
    }
    const verdict = monitor.finalize();

    return {
      robustness: verdict.minRobustness,
      violationTime: verdict.violationTime,
      times: simRes.times,
      states: simRes.states,
    };
  }

  /**
   * Computes the sensitivity gradient ∇_p rho(p) via central finite differences.
   */
  public computeRobustnessGradientFD(p: Record<string, number>, eps = 1e-4): Record<string, number> {
    const grad: Record<string, number> = {};
    const paramNames = this.problem.parameters.map((param) => param.name);

    for (const name of paramNames) {
      const origVal = p[name] ?? 0;
      const h = Math.max(eps, eps * Math.abs(origVal));

      const pPlus = { ...p, [name]: origVal + h };
      const pMinus = { ...p, [name]: origVal - h };

      const rPlus = this.evaluateTrajectory(pPlus).robustness;
      const rMinus = this.evaluateTrajectory(pMinus).robustness;

      grad[name] = (rPlus - rMinus) / (2 * h);
    }

    return grad;
  }

  /**
   * Computes the sensitivity gradient ∇_p rho(p) using reverse-mode continuous adjoint integration.
   * Solves:
   *   d(lambda)/dt = -[df/dy]^T * lambda,  lambda(t*) = d(rho)/dy
   *   d(rho)/dp    = int_{t0}^{t*} [df/dp]^T * lambda dt + [dy0/dp]^T * lambda(t0)
   */
  public computeRobustnessGradientAdjoint(
    p: Record<string, number>,
    eps = 1e-4,
    precomputedEval?: {
      robustness: number;
      violationTime?: number | undefined;
      times: number[];
      states: number[][];
    },
  ): Record<string, number> {
    const traj = precomputedEval ?? this.evaluateTrajectory(p);
    const { times, states, violationTime } = traj;
    if (times.length < 2) return this.computeRobustnessGradientFD(p, eps);

    const { f, y0, df_dy, df_dp, drho_dy, requirement, requirementName } = this.problem;
    const n = states[0]!.length;
    const tCrit = violationTime ?? times[times.length - 1]!;

    // Find closest trajectory index to critical violation timestamp
    let critIdx = 0;
    let minTDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i]! - tCrit);
      if (diff < minTDiff) {
        minTDiff = diff;
        critIdx = i;
      }
    }
    const tStar = times[critIdx]!;
    const yStar = states[critIdx]!;

    // 1. Evaluate terminal adjoint condition lambda(t*) = d(rho)/dy
    const lambda = new Float64Array(n);
    if (drho_dy) {
      const gradRho = drho_dy(tStar, yStar, p);
      for (let j = 0; j < n; j++) lambda[j] = gradRho[j] ?? 0;
    } else {
      for (let j = 0; j < n; j++) {
        const yPlus = [...yStar];
        const yMinus = [...yStar];
        const delta = Math.max(eps, eps * Math.abs(yStar[j]!));
        yPlus[j] = (yPlus[j] ?? 0) + delta;
        yMinus[j] = (yMinus[j] ?? 0) - delta;

        const mPlus = new OnlineSTLMonitor(requirement, { requirementName });
        mPlus.step(tStar, yPlus);
        const rhoPlus = mPlus.finalize().minRobustness;

        const mMinus = new OnlineSTLMonitor(requirement, { requirementName });
        mMinus.step(tStar, yMinus);
        const rhoMinus = mMinus.finalize().minRobustness;

        lambda[j] = (rhoPlus - rhoMinus) / (2 * delta);
      }
    }

    // Helper to evaluate instantaneous state Jacobian df/dy (n x n)
    const evalJy = (t: number, y: number[]): number[][] => {
      if (df_dy) return df_dy(t, y, p);
      const J: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let col = 0; col < n; col++) {
        const yP = [...y];
        const yM = [...y];
        const h = Math.max(eps, eps * Math.abs(y[col]!));
        yP[col] = (yP[col] ?? 0) + h;
        yM[col] = (yM[col] ?? 0) - h;
        const fP = f(t, yP, p);
        const fM = f(t, yM, p);
        for (let row = 0; row < n; row++) {
          J[row]![col] = ((fP[row] ?? 0) - (fM[row] ?? 0)) / (2 * h);
        }
      }
      return J;
    };

    // Helper to evaluate instantaneous parameter Jacobian df/dp
    const paramNames = this.problem.parameters.map((param) => param.name);
    const evalDfDp = (t: number, y: number[]): Record<string, number[]> => {
      if (df_dp) return df_dp(t, y, p);
      const res: Record<string, number[]> = {};
      for (const name of paramNames) {
        const origP = p[name] ?? 0;
        const h = Math.max(eps, eps * Math.abs(origP));
        const pP = { ...p, [name]: origP + h };
        const pM = { ...p, [name]: origP - h };
        const fP = f(t, y, pP);
        const fM = f(t, y, pM);
        const col = new Array(n);
        for (let r = 0; r < n; r++) {
          col[r] = ((fP[r] ?? 0) - (fM[r] ?? 0)) / (2 * h);
        }
        res[name] = col;
      }
      return res;
    };

    const grad: Record<string, number> = {};
    for (const name of paramNames) grad[name] = 0;

    const computeIntegrand = (lam: Float64Array, dfdpMap: Record<string, number[]>): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const name of paramNames) {
        const col = dfdpMap[name];
        let sum = 0;
        if (col) {
          for (let j = 0; j < n; j++) {
            sum += (lam[j] ?? 0) * (col[j] ?? 0);
          }
        }
        out[name] = sum;
      }
      return out;
    };

    // 2. Backward adjoint integration from tStar down to t0
    let curLambda = new Float64Array(lambda);
    let curDfDp = evalDfDp(tStar, yStar);
    let curIntegrand = computeIntegrand(curLambda, curDfDp);

    for (let k = critIdx; k > 0; k--) {
      const tNext = times[k]!;
      const tPrev = times[k - 1]!;
      const yNext = states[k]!;
      const yPrev = states[k - 1]!;
      const dt = tNext - tPrev;
      if (dt <= 0) continue;

      const JyNext = evalJy(tNext, yNext);
      const k1 = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        let sum = 0;
        for (let row = 0; row < n; row++) {
          sum += JyNext[row]![r]! * (curLambda[row] ?? 0);
        }
        k1[r] = -sum;
      }

      const lambdaTilde = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        lambdaTilde[r] = (curLambda[r] ?? 0) - dt * (k1[r] ?? 0);
      }

      const JyPrev = evalJy(tPrev, yPrev);
      const k2 = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        let sum = 0;
        for (let row = 0; row < n; row++) {
          sum += JyPrev[row]![r]! * (lambdaTilde[row] ?? 0);
        }
        k2[r] = -sum;
      }

      const prevLambda = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        prevLambda[r] = (curLambda[r] ?? 0) - 0.5 * dt * ((k1[r] ?? 0) + (k2[r] ?? 0));
      }

      const prevDfDp = evalDfDp(tPrev, yPrev);
      const prevIntegrand = computeIntegrand(prevLambda, prevDfDp);

      for (const name of paramNames) {
        grad[name] = (grad[name] ?? 0) + 0.5 * dt * ((curIntegrand[name] ?? 0) + (prevIntegrand[name] ?? 0));
      }

      curLambda = prevLambda;
      curIntegrand = prevIntegrand;
    }

    // 3. Initial state sensitivity: lambda(t0)^T * (dy0/dp)
    if (typeof y0 === "function") {
      for (const name of paramNames) {
        const origP = p[name] ?? 0;
        const h = Math.max(eps, eps * Math.abs(origP));
        const pP = { ...p, [name]: origP + h };
        const pM = { ...p, [name]: origP - h };
        const y0P = y0(pP);
        const y0M = y0(pM);
        let dy0dpSum = 0;
        for (let j = 0; j < n; j++) {
          const dy0dp = ((y0P[j] ?? 0) - (y0M[j] ?? 0)) / (2 * h);
          dy0dpSum += (curLambda[j] ?? 0) * dy0dp;
        }
        grad[name] = (grad[name] ?? 0) + dy0dpSum;
      }
    }

    return grad;
  }

  /**
   * Computes the sensitivity gradient ∇_p rho(p).
   * Dispatches between adjoint and finite-difference modes according to options.
   */
  public computeRobustnessGradient(
    p: Record<string, number>,
    eps = 1e-4,
    mode: "auto" | "adjoint" | "fd" = "auto",
    precomputedEval?: {
      robustness: number;
      violationTime?: number | undefined;
      times: number[];
      states: number[][];
    },
  ): Record<string, number> {
    if (mode === "fd") {
      return this.computeRobustnessGradientFD(p, eps);
    }
    if (mode === "adjoint" || (mode === "auto" && this.problem.parameters.length >= 2)) {
      try {
        return this.computeRobustnessGradientAdjoint(p, eps, precomputedEval);
      } catch {
        return this.computeRobustnessGradientFD(p, eps);
      }
    }
    return this.computeRobustnessGradientFD(p, eps);
  }

  /**
   * Run active adversarial falsification search.
   */
  public falsify(options: FalsificationOptions = {}): FalsificationResult {
    const maxIter = options.maxIterations ?? 50;
    const lr = options.learningRate ?? 0.1;
    const eps = options.epsilon ?? 1e-4;
    const randomRestarts = options.randomRestarts ?? 3;
    const earlyExit = options.earlyExit ?? true;

    let evaluations = 0;
    const history: FalsificationResult["history"] = [];

    let bestRho = Infinity;
    let bestParams: Record<string, number> | undefined = undefined;
    let bestViolationTime: number | undefined = undefined;
    let bestTrajectory: { times: number[]; states: number[][] } | undefined = undefined;

    // Helper to generate a random parameter vector within bounds
    const sampleRandomParams = (): Record<string, number> => {
      const res: Record<string, number> = {};
      for (const p of this.problem.parameters) {
        res[p.name] = p.min + Math.random() * (p.max - p.min);
      }
      return res;
    };

    // Helper to clamp parameters to bounds
    const clampParams = (p: Record<string, number>): Record<string, number> => {
      const clamped: Record<string, number> = {};
      for (const b of this.problem.parameters) {
        const val = p[b.name] ?? b.nominal ?? (b.min + b.max) / 2;
        clamped[b.name] = Math.max(b.min, Math.min(b.max, val));
      }
      return clamped;
    };

    for (let restart = 0; restart <= randomRestarts; restart++) {
      // Start from nominal on restart 0, otherwise sample randomly
      let curParams: Record<string, number>;
      if (restart === 0) {
        curParams = {};
        for (const b of this.problem.parameters) {
          curParams[b.name] = b.nominal ?? (b.min + b.max) / 2;
        }
      } else {
        curParams = sampleRandomParams();
      }

      for (let iter = 0; iter < maxIter; iter++) {
        evaluations++;
        const evalRes = this.evaluateTrajectory(curParams);
        const rho = evalRes.robustness;

        history.push({ iteration: evaluations, robustness: rho, params: { ...curParams } });

        if (rho < bestRho) {
          bestRho = rho;
          bestParams = { ...curParams };
          bestViolationTime = evalRes.violationTime;
          bestTrajectory = { times: evalRes.times, states: evalRes.states };
        }

        // Check if falsified (rho < 0)
        if (rho < 0 && earlyExit) {
          return {
            isFalsified: true,
            counterexampleParams: bestParams,
            minRobustness: bestRho,
            violationTime: bestViolationTime,
            evaluations,
            history,
            falsifyingTrajectory: bestTrajectory,
          };
        }

        // Compute downhill gradient: ∇_p rho in normalized unit hypercube coordinates [0, 1]^d
        const gradientMode = options.gradientMode ?? "auto";
        const rawGrad = this.computeRobustnessGradient(curParams, eps, gradientMode, evalRes);
        if (gradientMode === "fd") {
          evaluations += 2 * this.problem.parameters.length;
        }

        // Scale by parameter ranges to form normalized dimensionless gradient: d(rho)/d(p_hat)
        const normGrad: Record<string, number> = {};
        let normSq = 0;
        for (const b of this.problem.parameters) {
          const range = Math.max(1e-6, b.max - b.min);
          const scaled = (rawGrad[b.name] ?? 0) * range;
          normGrad[b.name] = scaled;
          normSq += scaled * scaled;
        }
        const norm = Math.sqrt(normSq);

        if (norm < 1e-8) {
          // Plateau reached, break to next restart
          break;
        }

        // Gradient descent step in normalized domain: p_next = p - lr * range * (normGrad / norm)
        const nextParams: Record<string, number> = {};
        for (const b of this.problem.parameters) {
          const range = Math.max(1e-6, b.max - b.min);
          const stepSize = lr * range * ((normGrad[b.name] ?? 0) / norm);
          nextParams[b.name] = (curParams[b.name] ?? 0) - stepSize;
        }

        curParams = clampParams(nextParams);
      }

      if (bestRho < 0 && earlyExit) {
        break;
      }
    }

    return {
      isFalsified: bestRho < 0,
      counterexampleParams: bestParams,
      minRobustness: bestRho,
      violationTime: bestViolationTime,
      evaluations,
      history,
      falsifyingTrajectory: bestTrajectory,
    };
  }
}
