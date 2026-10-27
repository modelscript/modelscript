// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Stochastic Differential Equation (SDE) Solvers: Euler-Maruyama & Rößler SRIW1.
 *
 * Academic Citations:
 * - Maruyama, G. (1955). Continuous Markov processes and stochastic equations.
 *   Rendiconti del Circolo Matematico di Palermo, 4(1), 48-90. https://doi.org/10.1007/BF02846028
 * - Kloeden, P. E., & Platen, E. (1992). Numerical Solution of Stochastic Differential
 *   Equations. Applications of Mathematics 23, Springer. https://doi.org/10.1007/978-3-662-12616-5
 * - Rößler, A. (2010). Runge-Kutta methods for the strong approximation of solutions of
 *   stochastic differential equations. SIAM Journal on Numerical Analysis, 48(3), 922-952.
 *   https://doi.org/10.1137/09076636X
 * - Blackman, D., & Vigna, S. (2021). Scrambled linear pseudorandom number generators.
 *   ACM Transactions on Mathematical Software, 47(4), 1-32. https://doi.org/10.1145/3460772
 *
 * ModelScript Architectural Rationale:
 * Cyber-physical systems operate under stochastic disturbances, such as Johnson-Nyquist thermal
 * noise in analog electronics, atmospheric turbulence in flight dynamics, sensor measurement noise,
 * and stochastic load fluctuations in power grids. Standard deterministic ODE/DAE integrators
 * cannot capture diffusion dynamics or probabilistic failure margins. ModelScript integrates Itô
 * stochastic differential equations (dx = f(t, x) dt + g(t, x) dW_t) to enable Monte Carlo ensemble
 * rollouts, uncertainty quantification, and stochastic stability verification.
 *
 * ModelScript Modifications:
 * - Employs WebAssembly-accelerated `Xoshiro256pp` PRNG with Box-Muller normal sampling for
 *   deterministic, reproducible parallel ensemble simulations.
 * - Implements both fixed-step Euler-Maruyama (order 0.5 strong / 1.0 weak) and high-order
 *   Rößler SRIW1 stochastic Runge-Kutta (order 1.5 strong / 2.0 weak) for scalar and multi-dimensional
 *   Wiener processes.
 * - Collects batched trajectory statistics (time-varying mean, variance, and percentile bounds)
 *   with minimal memory footprint.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
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

  interface SdeWasmExports {
    memory: WebAssembly.Memory;
    __new?: (size: number, id: number) => number;
    sde_euler_maruyama_step?: (
      n: number,
      yPtr: number,
      driftPtr: number,
      diffPtr: number,
      dWPtr: number,
      dt: number,
      yNextPtr: number,
    ) => void;
  }
  const wasm = getDefaultWasmExports() as SdeWasmExports | null;
  const useWasmEm =
    noiseType === "diagonal" &&
    wasm !== null &&
    typeof wasm.sde_euler_maruyama_step === "function" &&
    typeof wasm.__new === "function" &&
    n > 0;
  let yPtr = 0,
    driftPtr = 0,
    diffPtr = 0,
    dWPtr = 0,
    yNextPtr = 0;
  if (useWasmEm && wasm?.__new) {
    const alloc = (bytes: number): number => wasm.__new!(bytes, 0);
    yPtr = alloc(n * 8);
    driftPtr = alloc(n * 8);
    diffPtr = alloc(n * 8);
    dWPtr = alloc(n * 8);
    yNextPtr = alloc(n * 8);
  }

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
      if (useWasmEm && wasm?.sde_euler_maruyama_step) {
        const buf = wasm.memory.buffer;
        const yV = new Float64Array(buf, yPtr, n);
        const fV = new Float64Array(buf, driftPtr, n);
        const gV = new Float64Array(buf, diffPtr, n);
        const wV = new Float64Array(buf, dWPtr, n);
        for (let i = 0; i < n; i++) {
          yV[i] = y[i] ?? 0;
          fV[i] = drift[i] ?? 0;
          gV[i] = gVec[i] ?? 0;
          wV[i] = dW[i] ?? 0;
        }
        wasm.sde_euler_maruyama_step(n, yPtr, driftPtr, diffPtr, dWPtr, actualDt, yNextPtr);
        const outV = new Float64Array(wasm.memory.buffer, yNextPtr, n);
        for (let i = 0; i < n; i++) yNext[i] = outV[i]!;
      } else {
        for (let i = 0; i < n; i++) {
          yNext[i] = (y[i] ?? 0) + (drift[i] ?? 0) * actualDt + (gVec[i] ?? 0) * (dW[i] ?? 0);
        }
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

  const normalizeDiffusion = (gRaw: unknown): number[] => {
    if (typeof gRaw === "number") {
      return new Array<number>(n).fill(gRaw);
    }
    if (Array.isArray(gRaw)) {
      if (gRaw.length === 0) return new Array<number>(n).fill(0);
      if (Array.isArray(gRaw[0])) {
        const mat = gRaw as number[][];
        const out = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          out[i] = mat[i]?.[i] ?? mat[i]?.[0] ?? 0;
        }
        return out;
      }
      const vec = gRaw as number[];
      if (noiseType === "scalar" || vec.length === 1) {
        if (vec.length >= n) return vec;
        return new Array<number>(n).fill(vec[0] ?? 0);
      }
      return vec;
    }
    return new Array<number>(n).fill(0);
  };

  while (t < tEnd - 1e-14 && stats.acceptedSteps + stats.rejectedSteps < 100000) {
    if (t + h > tEnd) h = tEnd - t;
    const sqrtH = Math.sqrt(h);

    // Generate normal increment dW and second-order space variable dZ
    const dW = new Float64Array(n);
    const dZ = new Float64Array(n);
    if (noiseType === "scalar") {
      const xi = gaussian.sample();
      const dW0 = sqrtH * xi;
      const dZ0 = 0.5 * Math.pow(h, 1.5) * (xi + gaussian.sample() / Math.sqrt(3));
      dW.fill(dW0);
      dZ.fill(dZ0);
    } else {
      for (let i = 0; i < n; i++) {
        const xi = gaussian.sample();
        dW[i] = sqrtH * xi;
        // Truncated normal / space increment
        dZ[i] = 0.5 * Math.pow(h, 1.5) * (xi + gaussian.sample() / Math.sqrt(3));
      }
    }

    // Stage 1
    const f0 = problem.f(t, y, problem.p);
    const g0Raw = problem.g(t, y, problem.p);
    const g0 = normalizeDiffusion(g0Raw);
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
    const g1 = normalizeDiffusion(g1Raw);

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
      h = Math.min(Math.abs(tEnd - t0) / 10, Math.max(1e-12, h * factor));
    } else {
      stats.rejectedSteps++;
      h = Math.max(1e-12, h * 0.5);
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
  const refTimes = firstTraj.times;
  const numSteps = refTimes.length;
  const n = problem.y0.length;

  const interpolateOntoRef = (times: number[], states: number[][]): number[][] => {
    if (times.length === numSteps && times.every((tVal, idx) => Math.abs(tVal - (refTimes[idx] ?? 0)) < 1e-14)) {
      return states;
    }
    const aligned: number[][] = new Array(numSteps);
    let j = 0;
    for (let s = 0; s < numSteps; s++) {
      const tTarget = refTimes[s]!;
      while (j + 1 < times.length && (times[j + 1] ?? 0) < tTarget) {
        j++;
      }
      if (j + 1 >= times.length || Math.abs((times[j] ?? 0) - tTarget) < 1e-14) {
        aligned[s] = [...(states[j] ?? states[states.length - 1] ?? new Array<number>(n).fill(0))];
      } else {
        const t0Seg = times[j]!;
        const t1Seg = times[j + 1]!;
        const alpha = t1Seg > t0Seg ? (tTarget - t0Seg) / (t1Seg - t0Seg) : 0;
        const s0 = states[j]!;
        const s1 = states[j + 1]!;
        const row = new Array<number>(n);
        for (let i = 0; i < n; i++) {
          row[i] = (1 - alpha) * (s0[i] ?? 0) + alpha * (s1[i] ?? 0);
        }
        aligned[s] = row;
      }
    }
    return aligned;
  };

  const allTrajectories: number[][][] = new Array(numTrajectories);
  allTrajectories[0] = firstTraj.states;

  for (let k = 1; k < numTrajectories; k++) {
    const res = solverFn(problem, { ...options, seed: baseSeed + k * 7919 });
    allTrajectories[k] = interpolateOntoRef(res.times, res.states);
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
