// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delay Differential Equation (DDE) Solver.
 *
 * Implements the Method of Steps (MoS) for solving system of delay differential equations:
 *   dy/dt = f(t, y(t), history(t), p)
 *   with initial history function h(t) for t <= t0.
 *
 * Characteristics:
 *   - Continuous trajectory Hermite interpolant for evaluating delayed states y(t - tau)
 *   - Breaking-point tracking: Discontinuities at t0 propagate derivative jumps at
 *     t = t0 + k * tau. The solver stops on these points to prevent step rejections.
 *   - Supports constant delays and state-dependent delays.
 *
 * Reference:
 *   Bellen, A. & Zennaro, M. (2013), "Numerical Methods for Delay Differential Equations",
 *   Oxford University Press.
 *   Hairer, E., Nørsett, S.P., Wanner, G., "Solving Ordinary Differential Equations I",
 *   Section II.17.
 */

import type { CommonSolverResult, DDEOptions, DDEProblem, SolverStats } from "../core/problem-types.js";
import { TSIT5_A, TSIT5_B5, TSIT5_C, TSIT5_E, tsit5Interpolate } from "./tsit5.js";

export interface DdeResult extends CommonSolverResult {
  stats: SolverStats;
}

/**
 * Stores integration step interpolants for historical delay evaluation.
 */
class StepHistoryStore {
  private tStarts: number[] = [];
  private tEnds: number[] = [];
  private yStarts: number[][] = [];
  private yEnds: number[][] = [];
  private kStages: number[][][] = [];
  private stepSizes: number[] = [];

  constructor(private historyFn: (t: number) => number[]) {}

  /** Record an accepted step */
  pushStep(t0: number, t1: number, y0: number[], y1: number[], k: number[][]): void {
    this.tStarts.push(t0);
    this.tEnds.push(t1);
    this.yStarts.push([...y0]);
    this.yEnds.push([...y1]);
    this.kStages.push(k.map((ki) => [...ki]));
    this.stepSizes.push(t1 - t0);
  }

  /**
   * Evaluate state at any past time tau <= current_time using cubic Hermite interpolation.
   */
  evaluate(t: number): number[] {
    if (this.tStarts.length === 0 || t <= (this.tStarts[0] ?? 0)) {
      return this.historyFn(t);
    }

    const nSteps = this.tStarts.length;
    // Binary search for step interval containing t
    let low = 0;
    let high = nSteps - 1;

    if (t >= (this.tEnds[high] ?? 0)) {
      return this.yEnds[high]!;
    }

    while (low <= high) {
      const mid = (low + high) >> 1;
      const t0 = this.tStarts[mid]!;
      const t1 = this.tEnds[mid]!;

      if (t >= t0 && t <= t1) {
        const h = this.stepSizes[mid]!;
        const theta = h > 0 ? (t - t0) / h : 0;
        return tsit5Interpolate(this.yStarts[mid]!, this.yEnds[mid]!, this.kStages[mid]!, h, theta);
      } else if (t < t0) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // Fallback: nearest end
    return this.yEnds[nSteps - 1]!;
  }
}

/**
 * Compute breaking points (discontinuity propagation) for constant delays up to tEnd.
 */
function computeBreakingPoints(t0: number, tEnd: number, constantDelays?: number[]): number[] {
  if (!constantDelays || constantDelays.length === 0) return [];

  const points = new Set<number>();
  for (const tau of constantDelays) {
    if (tau <= 0) continue;
    let curr = t0 + tau;
    while (curr < tEnd - 1e-12) {
      points.add(Math.round(curr * 1e10) / 1e10);
      curr += tau;
    }
  }

  const sorted = Array.from(points).sort((a, b) => a - b);
  return sorted;
}

/**
 * Solve a Delay Differential Equation (DDE) using the Method of Steps.
 */
export function ddeSteps(problem: DDEProblem, options: DDEOptions = {}): DdeResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.y0.length;
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const minStep = 1e-15;

  const historyStore = new StepHistoryStore((t) => problem.h(t, problem.p));

  // Identify breaking points
  const breakingPoints = computeBreakingPoints(t0, tEnd, problem.constantDelays);
  let breakingIdx = 0;

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
  let h = options.initialStep ?? Math.min(Math.max((tEnd - t0) / 100, 1e-5), maxStep);

  const k: number[][] = new Array(7);
  k[0] = problem.f(t, y, (pastT) => historyStore.evaluate(pastT), problem.p);
  stats.fEvals++;

  const yStage = new Array<number>(n);
  const yNew = new Array<number>(n);

  while (t < tEnd - 1e-14 && stats.acceptedSteps + stats.rejectedSteps < 100000) {
    // Check if next step crosses a breaking point or tEnd
    let targetT = tEnd;
    if (breakingIdx < breakingPoints.length) {
      targetT = Math.min(targetT, breakingPoints[breakingIdx]!);
    }

    if (t + h > targetT) {
      h = targetT - t;
    }

    if (Math.abs(h) < minStep) {
      // Step on breaking point
      if (breakingIdx < breakingPoints.length && Math.abs(t - breakingPoints[breakingIdx]!) < 1e-10) {
        breakingIdx++;
        h = options.initialStep ?? Math.min((tEnd - t0) / 100, maxStep);
        continue;
      }
      stats.converged = false;
      break;
    }

    // Stages 1 to 5 using Tsit5 tableau
    for (let s = 1; s <= 5; s++) {
      const a_row = TSIT5_A[s]!;
      const c_s = TSIT5_C[s]!;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j < s; j++) {
          sum += (a_row[j] ?? 0) * (k[j]?.[i] ?? 0);
        }
        yStage[i] = (y[i] ?? 0) + h * sum;
      }

      const tStage = t + c_s * h;
      k[s] = problem.f(tStage, yStage, (pastT) => historyStore.evaluate(pastT), problem.p);
      stats.fEvals++;
    }

    // Candidate new state yNew
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j <= 5; j++) {
        sum += (TSIT5_B5[j] ?? 0) * (k[j]?.[i] ?? 0);
      }
      yNew[i] = (y[i] ?? 0) + h * sum;
    }

    // Stage 6 (FSAL)
    k[6] = problem.f(t + h, yNew, (pastT) => historyStore.evaluate(pastT), problem.p);
    stats.fEvals++;

    // Error estimation
    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      let err_i = 0;
      for (let j = 0; j <= 6; j++) {
        err_i += (TSIT5_E[j] ?? 0) * (k[j]?.[i] ?? 0);
      }
      err_i = Math.abs(h * err_i);
      const sc_i = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
      maxErrorRatio = Math.max(maxErrorRatio, err_i / sc_i);
    }

    if (maxErrorRatio <= 1.0) {
      // Step accepted
      stats.acceptedSteps++;
      historyStore.pushStep(t, t + h, y, yNew, k);

      t += h;
      y = [...yNew];
      times.push(t);
      states.push([...y]);

      k[0] = k[6]!;

      if (breakingIdx < breakingPoints.length && Math.abs(t - breakingPoints[breakingIdx]!) < 1e-10) {
        breakingIdx++;
      }

      const factor = Math.min(4.0, Math.max(0.2, 0.9 * Math.pow(Math.max(maxErrorRatio, 1e-4), -0.2)));
      h = Math.min(maxStep, Math.max(minStep, h * factor));
    } else {
      // Step rejected
      stats.rejectedSteps++;
      const factor = Math.min(1.0, Math.max(0.1, 0.9 * Math.pow(maxErrorRatio, -0.25)));
      h = Math.max(minStep, h * factor);
    }
  }

  return {
    times,
    states,
    stats,
  };
}
