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
  nominal?: number;
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
  requirementName?: string;
}

export interface FalsificationOptions {
  /** Maximum number of falsification iterations (default: 50) */
  maxIterations?: number;
  /** Learning rate for gradient descent step (default: 0.1) */
  learningRate?: number;
  /** Numerical finite difference perturbation epsilon (default: 1e-4) */
  epsilon?: number;
  /** Number of random restart attempts if gradient stalls (default: 3) */
  randomRestarts?: number;
  /** Early exit as soon as any violation rho < 0 is discovered (default: true) */
  earlyExit?: boolean;
}

export interface FalsificationResult {
  /** Whether a falsifying parameter vector was successfully discovered */
  isFalsified: boolean;
  /** Counterexample parameter vector p* */
  counterexampleParams?: Record<string, number>;
  /** Worst-case robustness degree rho(p*) */
  minRobustness: number;
  /** Simulation timestamp where violation occurred */
  violationTime?: number;
  /** Total number of simulation trajectory evaluations */
  evaluations: number;
  /** Iteration history: [iteration, rho, params] */
  history: { iteration: number; robustness: number; params: Record<string, number> }[];
  /** Trajectory that violates requirement */
  falsifyingTrajectory?: {
    times: number[];
    states: number[][];
  };
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
    violationTime?: number;
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
  public computeRobustnessGradient(p: Record<string, number>, eps = 1e-4): Record<string, number> {
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

        // Compute downhill gradient: ∇_p rho
        const grad = this.computeRobustnessGradient(curParams, eps);
        evaluations += 2 * this.problem.parameters.length;

        // Gradient norm
        let normSq = 0;
        for (const k in grad) {
          normSq += (grad[k] ?? 0) ** 2;
        }
        const norm = Math.sqrt(normSq);

        if (norm < 1e-8) {
          // Plateau reached, break to next restart
          break;
        }

        // Gradient descent step: p = p - lr * grad / norm * (param_range)
        const nextParams: Record<string, number> = {};
        for (const b of this.problem.parameters) {
          const range = Math.max(1e-6, b.max - b.min);
          const stepSize = lr * range * ((grad[b.name] ?? 0) / norm);
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
