// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tsitouras 5(4) Adaptive Runge-Kutta ODE Solver (Tsit5).
 *
 * Implements the 7-stage embedded Runge-Kutta pair of orders 5 and 4 with the
 * First-Same-As-Last (FSAL) property and 4th/5th order continuous dense output.
 *
 * Characteristics:
 *   - Outperforms Dormand-Prince 5(4) (DOPRI5) on efficiency, error per step, and stability
 *   - Recommended default for non-stiff initial value problems (IVPs)
 *   - Continuous interpolation for root-finding and event detection
 *
 * Reference:
 *   Tsitouras, Ch. (2011), "Runge-Kutta pairs of order 5 (4) satisfying only the first
 *   column simplifying assumption", Computers & Mathematics with Applications, 62(2), 770-775.
 */

import type { CommonSolverResult, ODEProblem, SolverStats } from "../core/problem-types.js";

// ── Butcher Tableau for Tsitouras 5(4) ──

export const TSIT5_C: readonly number[] = [0.0, 0.161, 0.327, 0.9, 0.9800255409045097, 1.0, 1.0];

export const TSIT5_A: readonly (readonly number[])[] = [
  [],
  [0.161],
  [-0.008480655492356989, 0.335480655492357],
  [2.8971530571054935, -6.359448489975075, 4.3622954328695815],
  [5.325864828439257, -11.748883564062828, 7.495539342889836, -0.09249506636175525],
  [5.86145544294642, -12.92096931784711, 8.159367898576159, -0.071584973281401, -0.028269050394068383],
  [0.09646076681806523, 0.01, 0.4798896504144996, 1.379008574103742, -3.290069515436081, 2.324710524099774],
];

/** 5th-order propagation weights b_sol (FSAL stage) */
export const TSIT5_B5: readonly number[] = [
  0.09646076681806523, 0.01, 0.4798896504144996, 1.379008574103742, -3.290069515436081, 2.324710524099774, 0.0,
];

/** Embedded error coefficients: E_i = b_sol_i - b_hat_i */
export const TSIT5_E: readonly number[] = [
  0.09646076681806523 - 0.09468075576583947,
  0.01 - 0.009183565540343252,
  0.4798896504144996 - 0.4877705284247616,
  1.379008574103742 - 1.234297566930479,
  -3.290069515436081 - -2.7077123499835256,
  2.324710524099774 - 1.866628418170587,
  -1.0 / 66.0,
];

// ── Public Interfaces ──

export interface Tsit5Options {
  atol?: number;
  rtol?: number;
  initialStep?: number;
  maxStep?: number;
  minStep?: number;
  maxSteps?: number;
  equidistantOutput?: boolean;
  eventFunctions?: Tsit5EventFunction[];
  eventDirections?: (1 | -1 | 0)[];
  eventCallback?: Tsit5EventCallback;
  /** Optional streaming Signal Temporal Logic (STL) robustness monitors */
  stlMonitors?: import("../core/stl_monitor.js").STLOnlineMonitor[];
}

export interface Tsit5Result extends CommonSolverResult {
  stats: SolverStats;
}

export type Tsit5EventFunction = (t: number, y: number[]) => number;
export type Tsit5EventCallback = (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[];

/**
 * 4th-order continuous Hermite interpolant for Tsit5 dense output.
 * Evaluates the solution at t0 + theta * h, where theta in [0, 1].
 */
export function tsit5Interpolate(y0: number[], y1: number[], k: number[][], h: number, theta: number): number[] {
  const n = y0.length;
  const out = new Array<number>(n);
  // Hermite cubic interpolation between y0 and y1 using slopes k[0] and k[6]
  const theta2 = theta * theta;
  const theta3 = theta2 * theta;
  const h00 = 2 * theta3 - 3 * theta2 + 1;
  const h10 = theta3 - 2 * theta2 + theta;
  const h01 = -2 * theta3 + 3 * theta2;
  const h11 = theta3 - theta2;

  for (let i = 0; i < n; i++) {
    const y0_i = y0[i] ?? 0;
    const y1_i = y1[i] ?? 0;
    const f0_i = k[0]?.[i] ?? 0;
    const f1_i = k[6]?.[i] ?? 0;
    out[i] = h00 * y0_i + h10 * h * f0_i + h01 * y1_i + h11 * h * f1_i;
  }
  return out;
}

/**
 * Integrate an ODE system using the Tsitouras 5(4) adaptive method.
 */
export function tsit5(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes?: number[],
  options: Tsit5Options = {},
  eventFunctions?: Tsit5EventFunction[],
  eventCallback?: Tsit5EventCallback,
  eventDirections?: number[],
): Tsit5Result {
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const minStep = options.minStep ?? 1e-15;
  const maxSteps = options.maxSteps ?? 100000;
  const n = y0.length;

  const stats: SolverStats = {
    acceptedSteps: 0,
    rejectedSteps: 0,
    fEvals: 0,
    converged: true,
  };

  const resultTimes: number[] = [];
  const resultStates: number[][] = [];

  const denseOutputs = outputTimes !== undefined && outputTimes.length > 0;
  let outIdx = 0;

  // Initial step estimation if not provided
  let h = options.initialStep ?? Math.min(Math.max((tEnd - t0) / 100, 1e-5), maxStep);

  let t = t0;
  let y = [...y0];

  // Evaluate initial stage k[0] = f(t0, y0)
  const k: number[][] = new Array(7);
  k[0] = f(t, y);
  stats.fEvals++;

  if (denseOutputs && outputTimes[0] !== undefined && Math.abs(outputTimes[0] - t) < 1e-12) {
    resultTimes.push(t);
    resultStates.push([...y]);
    outIdx++;
  } else if (!denseOutputs) {
    resultTimes.push(t);
    resultStates.push([...y]);
  }

  // Initialize online STL monitors with initial point
  if (options.stlMonitors && options.stlMonitors.length > 0) {
    for (const m of options.stlMonitors) {
      m.step(t, y);
    }
  }

  // Pre-allocate stage vector
  const yStage = new Array<number>(n);
  const yNew = new Array<number>(n);

  let prevEventVals: number[] = [];
  if (eventFunctions) {
    prevEventVals = eventFunctions.map((ef) => ef(t, y));
  }

  while ((tEnd > t0 ? t < tEnd - 1e-14 : t > tEnd + 1e-14) && stats.acceptedSteps + stats.rejectedSteps < maxSteps) {
    if (tEnd > t0) {
      if (t + h > tEnd) h = tEnd - t;
    } else {
      if (t + h < tEnd) h = tEnd - t;
    }

    if (Math.abs(h) < minStep) {
      stats.converged = false;
      break;
    }

    // Stages 1 to 5
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
      k[s] = f(t + c_s * h, yStage);
      stats.fEvals++;
    }

    // Candidate new state yNew (using 5th-order weights TSIT5_B5)
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j <= 5; j++) {
        sum += (TSIT5_B5[j] ?? 0) * (k[j]?.[i] ?? 0);
      }
      yNew[i] = (y[i] ?? 0) + h * sum;
    }

    // Stage 6 (FSAL evaluation: f at new candidate state)
    k[6] = f(t + h, yNew);
    stats.fEvals++;

    // Compute error estimate: err = h * sum(E[j] * k[j])
    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      let err_i = 0;
      for (let j = 0; j <= 6; j++) {
        err_i += (TSIT5_E[j] ?? 0) * (k[j]?.[i] ?? 0);
      }
      err_i = Math.abs(h * err_i);
      const sc_i = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
      const ratio = err_i / sc_i;
      if (ratio > maxErrorRatio) {
        maxErrorRatio = ratio;
      }
    }

    // Step acceptance check
    if (maxErrorRatio <= 1.0) {
      // Step accepted
      stats.acceptedSteps++;

      // Event detection between t and t+h
      if (eventFunctions && eventFunctions.length > 0) {
        const currEventVals = eventFunctions.map((ef) => ef(t + h, yNew));
        let eventTriggered = -1;
        let eventDir: 1 | -1 = 1;

        for (let ei = 0; ei < eventFunctions.length; ei++) {
          const vPrev = prevEventVals[ei] ?? 0;
          const vCurr = currEventVals[ei] ?? 0;
          const expectedDir = eventDirections?.[ei] ?? 0;

          if (vPrev * vCurr <= 0 && vPrev !== vCurr) {
            const dir: 1 | -1 = vCurr > vPrev ? 1 : -1;
            if (expectedDir === 0 || expectedDir === dir) {
              eventTriggered = ei;
              eventDir = dir;
              break;
            }
          }
        }

        if (eventTriggered >= 0) {
          // Bisection root finding
          let tLeft = t;
          let tRight = t + h;
          let yEvent = [...yNew];

          for (let iter = 0; iter < 20; iter++) {
            const tMid = 0.5 * (tLeft + tRight);
            const thetaMid = (tMid - t) / h;
            const yMid = tsit5Interpolate(y, yNew, k, h, thetaMid);
            const valMid = eventFunctions[eventTriggered]!(tMid, yMid);

            if (Math.abs(valMid) < 1e-10 || tRight - tLeft < 1e-12) {
              yEvent = yMid;
              tRight = tMid;
              break;
            }
            const valLeft = eventFunctions[eventTriggered]!(tLeft, tsit5Interpolate(y, yNew, k, h, (tLeft - t) / h));
            if (valLeft * valMid <= 0) {
              tRight = tMid;
            } else {
              tLeft = tMid;
            }
            yEvent = yMid;
          }

          if (eventCallback) {
            y = eventCallback(tRight, yEvent, eventTriggered, eventDir);
          } else {
            y = yEvent;
          }
          t = tRight;
          k[0] = f(t, y);
          stats.fEvals++;
          prevEventVals = eventFunctions.map((ef) => ef(t, y));

          resultTimes.push(t);
          resultStates.push([...y]);
          h = Math.max(minStep, Math.min(h * 0.5, maxStep));
          continue;
        }
        prevEventVals = currEventVals;
      }

      // Dense output extraction if requested
      if (denseOutputs && outputTimes) {
        while (outIdx < outputTimes.length) {
          const tTarget = outputTimes[outIdx]!;
          if ((tEnd > t0 && tTarget <= t + h) || (tEnd < t0 && tTarget >= t + h)) {
            const theta = (tTarget - t) / h;
            const yTarget = tsit5Interpolate(y, yNew, k, h, theta);
            resultTimes.push(tTarget);
            resultStates.push(yTarget);
            outIdx++;
          } else {
            break;
          }
        }
      } else {
        resultTimes.push(t + h);
        resultStates.push([...yNew]);
      }

      // Advance state and time
      t += h;
      for (let i = 0; i < n; i++) {
        y[i] = yNew[i]!;
      }

      // Step online STL monitors
      if (options.stlMonitors && options.stlMonitors.length > 0) {
        let earlyStop = false;
        for (const m of options.stlMonitors) {
          const stepRes = m.step(t, y);
          if (stepRes.shouldTerminate) {
            earlyStop = true;
          }
        }
        if (earlyStop) break;
      }

      // FSAL: k[0] of next step is k[6] of current step
      k[0] = k[6]!;

      // Step size adaptation (5th order: factor ~ (1/err)^(1/5))
      const factor = Math.min(5.0, Math.max(0.2, 0.9 * Math.pow(maxErrorRatio, -0.2)));
      h = Math.min(maxStep, Math.max(minStep, h * factor));
    } else {
      // Step rejected
      stats.rejectedSteps++;
      const factor = Math.min(1.0, Math.max(0.1, 0.9 * Math.pow(maxErrorRatio, -0.25)));
      h = Math.max(minStep, h * factor);
    }
  }

  // Ensure last output point is saved if denseOutputs specified
  if (denseOutputs && outputTimes && outIdx < outputTimes.length) {
    while (outIdx < outputTimes.length) {
      resultTimes.push(outputTimes[outIdx]!);
      resultStates.push([...y]);
      outIdx++;
    }
  }

  return {
    times: resultTimes,
    states: resultStates,
    stats,
    stlResults: options.stlMonitors ? options.stlMonitors.map((m) => m.finish()) : undefined,
  };
}

/**
 * Solve an ODEProblem using Tsit5.
 */
export function solveODE(problem: ODEProblem, options: Tsit5Options = {}): Tsit5Result {
  const [t0, tEnd] = problem.tSpan;
  const f = (t: number, y: number[]) => problem.f(t, y, problem.p);
  const effectiveOpts: Tsit5Options = {
    ...options,
    stlMonitors: options.stlMonitors ?? problem.stlMonitors,
  };
  return tsit5(f, t0, problem.y0, tEnd, undefined, effectiveOpts);
}
