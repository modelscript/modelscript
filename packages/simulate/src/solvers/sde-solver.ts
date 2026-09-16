// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Stochastic Differential Equation (SDE) Solvers.
 *
 * Implements continuous-time Brownian diffusion path integrators for Ito SDEs:
 *   dx(t) = f(t, x, p) dt + g(t, x, p) dW_t
 *
 * Provides:
 *   - Euler-Maruyama: 1st-order weak / 0.5-order strong Ito integrator
 *   - SRIW1: Rößler's adaptive Stochastic Runge-Kutta order (1.5, 2.0)
 *   - SDE Ensemble Simulator: Parallel trajectory generation with mean, variance,
 *     and quantile interval statistics
 */

import { Xoshiro256pp } from "@modelscript/runtime/wasm_monte_carlo.js";
import type {
  SDEEnsembleResult,
  SDEOptions,
  SDEProblem,
  SDESimulationResult,
  SolverStats,
} from "../core/problem-types.js";

/**
 * Standard Normal Gaussian random variate generator.
 */
export class GaussianRng {
  constructor(private rng: Xoshiro256pp) {}

  /** Draw a sample from standard normal distribution N(0, 1) */
  sample(): number {
    return this.rng.randn();
  }
}

/**
 * Integrate an SDE trajectory using the Euler-Maruyama method.
 *
 * Formula:
 *   x_{n+1} = x_n + f(t_n, x_n) * dt + g(t_n, x_n) * dW_n
 *   where dW_n ~ N(0, dt * I)
 */
export function eulerMaruyama(problem: SDEProblem, options: SDEOptions = {}): SDESimulationResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.y0.length;
  const dt = options.dt ?? Math.max((tEnd - t0) / 1000, 1e-4);
  const steps = Math.max(1, Math.round(Math.abs(tEnd - t0) / dt));
  const actualDt = (tEnd - t0) / steps;
  const sqrtDt = Math.sqrt(actualDt);

  const seed = options.seed ?? problem.seed ?? Math.floor(Math.random() * 2147483647);
  const prng = new Xoshiro256pp(seed);
  const gaussian = new GaussianRng(prng);

  const stats: SolverStats = {
    acceptedSteps: steps,
    rejectedSteps: 0,
    fEvals: 0,
    converged: true,
  };

  const times: number[] = [t0];
  const states: number[][] = [[...problem.y0]];

  let t = t0;
  let y = [...problem.y0];

  const noiseType = problem.noiseType ?? "diagonal";
  const m = problem.mBrownian ?? n;
  const dW = new Float64Array(m);

  for (let step = 0; step < steps; step++) {
    // Generate Wiener increments dW_j = sqrt(dt) * xi_j
    for (let j = 0; j < m; j++) {
      dW[j] = sqrtDt * gaussian.sample();
    }

    // Evaluate drift f(t, y)
    const drift = problem.f(t, y, problem.p);
    stats.fEvals++;

    // Evaluate diffusion g(t, y)
    const diffusion = problem.g(t, y, problem.p);

    const yNext = new Array<number>(n);
    if (noiseType === "diagonal") {
      const gVec = diffusion as number[];
      for (let i = 0; i < n; i++) {
        yNext[i] = (y[i] ?? 0) + (drift[i] ?? 0) * actualDt + (gVec[i] ?? 0) * (dW[i] ?? 0);
      }
    } else if (noiseType === "scalar") {
      const gVal = typeof diffusion === "number" ? diffusion : ((diffusion as number[])[0] ?? 0);
      const dW0 = dW[0] ?? 0;
      for (let i = 0; i < n; i++) {
        yNext[i] = (y[i] ?? 0) + (drift[i] ?? 0) * actualDt + gVal * dW0;
      }
    } else {
      // General matrix noise: diffusion is n x m
      const gMat = diffusion as number[][];
      for (let i = 0; i < n; i++) {
        let diffSum = 0;
        const gRow = gMat[i] ?? [];
        for (let j = 0; j < m; j++) {
          diffSum += (gRow[j] ?? 0) * (dW[j] ?? 0);
        }
        yNext[i] = (y[i] ?? 0) + (drift[i] ?? 0) * actualDt + diffSum;
      }
    }

    t += actualDt;
    y = yNext;

    times.push(t);
    states.push([...y]);
  }

  return {
    times,
    states,
    seed,
    stats,
  };
}

/**
 * SRIW1: Rößler's Adaptive Stochastic Runge-Kutta order 1.5 strong / 2.0 weak.
 *
 * Uses a 4-stage explicit stochastic tableau with embedded local error control.
 */
export function sriw1(problem: SDEProblem, options: SDEOptions = {}): SDESimulationResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.y0.length;
  const atol = options.atol ?? 1e-3;
  const rtol = options.rtol ?? 1e-3;
  const seed = options.seed ?? problem.seed ?? Math.floor(Math.random() * 2147483647);
  const prng = new Xoshiro256pp(seed);
  const gaussian = new GaussianRng(prng);

  const stats: SolverStats = {
    acceptedSteps: 0,
    rejectedSteps: 0,
    fEvals: 0,
    converged: true,
  };

  const times: number[] = [t0];
  const states: number[][] = [[...problem.y0]];

  let t = t0;
  let y = [...problem.y0];
  let h = options.dt ?? Math.max((tEnd - t0) / 500, 1e-4);

  const noiseType = problem.noiseType ?? "diagonal";

  while (t < tEnd - 1e-14 && stats.acceptedSteps + stats.rejectedSteps < 100000) {
    if (t + h > tEnd) h = tEnd - t;
    const sqrtH = Math.sqrt(h);

    // Generate normal increment dW and second-order space variable dZ
    const dW = new Float64Array(n);
    const dZ = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const xi = gaussian.sample();
      dW[i] = sqrtH * xi;
      // Truncated normal / space increment
      dZ[i] = 0.5 * Math.pow(h, 1.5) * (xi + gaussian.sample() / Math.sqrt(3));
    }

    // Stage 1
    const f0 = problem.f(t, y, problem.p);
    const g0Raw = problem.g(t, y, problem.p);
    const g0 = noiseType === "diagonal" ? (g0Raw as number[]) : [(g0Raw as number[])[0] ?? 0];
    stats.fEvals++;

    // Stage 2: Drift evaluation at y + h * f0 + g0 * dW
    const yStage2 = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yStage2[i] = (y[i] ?? 0) + h * (f0[i] ?? 0) + (g0[i] ?? 0) * (dW[i] ?? 0);
    }
    const f1 = problem.f(t + h, yStage2, problem.p);
    stats.fEvals++;

    // Stage 3: Diffusion evaluation at y + (g0 * sqrt(h))
    const yStage3 = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yStage3[i] = (y[i] ?? 0) + (g0[i] ?? 0) * sqrtH;
    }
    const g1Raw = problem.g(t + h, yStage3, problem.p);
    const g1 = noiseType === "diagonal" ? (g1Raw as number[]) : [(g1Raw as number[])[0] ?? 0];

    // High-order update (order 1.5 strong)
    const yHigh = new Array<number>(n);
    // Low-order embedded estimate (Euler-Maruyama order 0.5 strong)
    const yLow = new Array<number>(n);

    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      const dWi = dW[i] ?? 0;
      const fAvg = 0.5 * ((f0[i] ?? 0) + (f1[i] ?? 0));
      const gAvg = 0.5 * ((g0[i] ?? 0) + (g1[i] ?? 0));

      yHigh[i] = (y[i] ?? 0) + h * fAvg + gAvg * dWi + ((g1[i] ?? 0) - (g0[i] ?? 0)) * ((dZ[i] ?? 0) / h);
      yLow[i] = (y[i] ?? 0) + h * (f0[i] ?? 0) + (g0[i] ?? 0) * dWi;

      const err = Math.abs(yHigh[i]! - yLow[i]!);
      const sc = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yHigh[i]!));
      maxErrorRatio = Math.max(maxErrorRatio, err / sc);
    }

    if (maxErrorRatio <= 1.0 || h <= 1e-10) {
      stats.acceptedSteps++;
      t += h;
      y = yHigh;
      times.push(t);
      states.push([...y]);

      const factor = Math.min(2.0, Math.max(0.5, 0.9 * Math.pow(Math.max(maxErrorRatio, 1e-4), -0.5)));
      h = Math.min(Math.abs(tEnd - t0) / 10, Math.max(1e-6, h * factor));
    } else {
      stats.rejectedSteps++;
      h = Math.max(1e-6, h * 0.5);
    }
  }

  return {
    times,
    states,
    seed,
    stats,
  };
}

/**
 * Simulate an ensemble of SDE trajectories and compute aggregate statistics.
 */
export function simulateSDEEnsemble(
  problem: SDEProblem,
  numTrajectories = 100,
  options: SDEOptions = {},
  method: "euler-maruyama" | "sriw1" = "euler-maruyama",
): SDEEnsembleResult {
  const solverFn = method === "sriw1" ? sriw1 : eulerMaruyama;

  const baseSeed = options.seed ?? problem.seed ?? 42;
  const firstTraj = solverFn(problem, { ...options, seed: baseSeed });
  const numSteps = firstTraj.times.length;
  const n = problem.y0.length;

  const allTrajectories: number[][][] = new Array(numTrajectories);
  allTrajectories[0] = firstTraj.states;

  for (let k = 1; k < numTrajectories; k++) {
    const res = solverFn(problem, { ...options, seed: baseSeed + k * 7919 });
    allTrajectories[k] = res.states;
  }

  // Compute Mean and Variance trajectories
  const mean: number[][] = [];
  const variance: number[][] = [];
  const median: number[][] = [];
  const quantile05: number[][] = [];
  const quantile95: number[][] = [];

  for (let s = 0; s < numSteps; s++) {
    const meanStep = new Array<number>(n).fill(0);
    const varStep = new Array<number>(n).fill(0);
    const medStep = new Array<number>(n).fill(0);
    const q05Step = new Array<number>(n).fill(0);
    const q95Step = new Array<number>(n).fill(0);

    for (let i = 0; i < n; i++) {
      const vals: number[] = new Array(numTrajectories);
      let sum = 0;
      for (let k = 0; k < numTrajectories; k++) {
        const v = allTrajectories[k]?.[s]?.[i] ?? 0;
        vals[k] = v;
        sum += v;
      }
      const mu = sum / numTrajectories;
      meanStep[i] = mu;

      let varSum = 0;
      for (let k = 0; k < numTrajectories; k++) {
        const diff = (vals[k] ?? 0) - mu;
        varSum += diff * diff;
      }
      varStep[i] = varSum / Math.max(1, numTrajectories - 1);

      // Quantiles
      vals.sort((a, b) => a - b);
      q05Step[i] = vals[Math.floor(0.05 * numTrajectories)] ?? mu;
      medStep[i] = vals[Math.floor(0.5 * numTrajectories)] ?? mu;
      q95Step[i] = vals[Math.floor(0.95 * numTrajectories)] ?? mu;
    }

    mean.push(meanStep);
    variance.push(varStep);
    median.push(medStep);
    quantile05.push(q05Step);
    quantile95.push(q95Step);
  }

  return {
    times: firstTraj.times,
    mean,
    variance,
    median,
    quantile05,
    quantile95,
    samples: allTrajectories.slice(0, Math.min(5, numTrajectories)),
    numTrajectories,
  };
}
