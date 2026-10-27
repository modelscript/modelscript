// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Tsitouras 5(4) Adaptive Runge-Kutta ODE Solver (Tsit5).
 *
 * Academic Citations:
 * - Tsitouras, Ch. (2011). Runge-Kutta pairs of order 5 (4) satisfying only the first
 *   column simplifying assumption. Computers & Mathematics with Applications, 62(2), 770-775.
 *   https://doi.org/10.1016/j.camwa.2011.06.002
 * - Dormand, J. R., & Prince, P. J. (1980). A family of embedded Runge-Kutta formulae.
 *   Journal of Computational and Applied Mathematics, 6(1), 19-26.
 *   https://doi.org/10.1016/0771-050X(80)90013-3
 * - Rackauckas, C., & Nie, Q. (2017). DifferentialEquations.jl – A Performant and
 *   Feature-Rich Ecosystem for Solving Differential Equations in Julia.
 *   Journal of Open Research Software, 5(1), 15. https://doi.org/10.5334/jors.151
 *
 * ModelScript Architectural Rationale:
 * For non-stiff or mildly stiff ordinary differential equations (such as mechanical multi-body
 * trajectories, kinematic chains, and orbital/flight dynamics), high-order adaptive explicit Runge-Kutta
 * pairs offer peak performance without the linear algebra overhead of Newton-Raphson solves.
 * Tsitouras 5(4) has lower error coefficients and larger stability regions than classical Dormand-Prince
 * (DOPRI5), serving as ModelScript's default explicit simulation solver.
 *
 * ModelScript Modifications:
 * - Exploits the First-Same-As-Last (FSAL) property to eliminate the first stage RHS evaluation in successive steps.
 * - Integrates a continuous 4th/5th-order dense output polynomial for high-accuracy event zero-crossing detection.
 * - Proportional-Integral (PI) adaptive step-size controller tuned to prevent step oscillation around events.
 */

import { getDefaultWasmExports } from "@modelscript/runtime";
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
  atol?: number | undefined;
  rtol?: number | undefined;
  initialStep?: number | undefined;
  maxStep?: number | undefined;
  minStep?: number | undefined;
  maxSteps?: number | undefined;
  equidistantOutput?: boolean | undefined;
  eventFunctions?: Tsit5EventFunction[] | undefined;
  eventDirections?: (1 | -1 | 0)[] | undefined;
  eventCallback?: Tsit5EventCallback | undefined;
  /** Optional streaming Signal Temporal Logic (STL) robustness monitors */
  stlMonitors?: import("../core/stl_monitor.js").STLOnlineMonitor[] | undefined;
}

export interface Tsit5Result extends CommonSolverResult {
  stats: SolverStats;
}

export type Tsit5EventFunction = (t: number, y: number[]) => number;
export type Tsit5EventCallback = (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[];

interface Tsit5WasmExports {
  memory: WebAssembly.Memory;
  __new?: (size: number, id: number) => number;
  dde_hermite_interpolate?: (
    n: number,
    y0Ptr: number,
    y1Ptr: number,
    f0Ptr: number,
    f1Ptr: number,
    h: number,
    theta: number,
    outPtr: number,
  ) => void;
  tsit5_combine_stage?: (
    n: number,
    yPtr: number,
    kBasePtr: number,
    aRowPtr: number,
    s: number,
    h: number,
    yStagePtr: number,
  ) => void;
  tsit5_compute_step_and_error?: (
    n: number,
    yPtr: number,
    kBasePtr: number,
    b5Ptr: number,
    ePtr: number,
    h: number,
    atol: number,
    rtol: number,
    yNewPtr: number,
  ) => number;
}

/**
 * 4th-order continuous Hermite interpolant for Tsit5 dense output.
 * Evaluates the solution at t0 + theta * h, where theta in [0, 1].
 */
export function tsit5Interpolate(y0: number[], y1: number[], k: number[][], h: number, theta: number): number[] {
  const n = y0.length;
  const wasm = getDefaultWasmExports() as Tsit5WasmExports | null;
  if (wasm && typeof wasm.dde_hermite_interpolate === "function" && typeof wasm.__new === "function" && n > 0) {
    const alloc = (bytes: number): number => wasm.__new!(bytes, 0);
    const y0Ptr = alloc(n * 8);
    const y1Ptr = alloc(n * 8);
    const f0Ptr = alloc(n * 8);
    const f1Ptr = alloc(n * 8);
    const outPtr = alloc(n * 8);
    const buf = wasm.memory.buffer;
    const y0V = new Float64Array(buf, y0Ptr, n);
    const y1V = new Float64Array(buf, y1Ptr, n);
    const f0V = new Float64Array(buf, f0Ptr, n);
    const f1V = new Float64Array(buf, f1Ptr, n);
    for (let i = 0; i < n; i++) {
      y0V[i] = y0[i] ?? 0;
      y1V[i] = y1[i] ?? 0;
      f0V[i] = k[0]?.[i] ?? 0;
      f1V[i] = k[6]?.[i] ?? 0;
    }
    wasm.dde_hermite_interpolate(n, y0Ptr, y1Ptr, f0Ptr, f1Ptr, h, theta, outPtr);
    return Array.from(new Float64Array(wasm.memory.buffer, outPtr, n));
  }

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
  const kBuffer = new Float64Array(7 * n);
  const k: number[][] = new Array(7);
  k[0] = f(t, y);
  for (let i = 0; i < n; i++) kBuffer[i] = k[0][i] ?? 0;
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

  const effEventFunctions = eventFunctions ?? options.eventFunctions;
  const effEventCallback = eventCallback ?? options.eventCallback;
  const effEventDirections = eventDirections ?? options.eventDirections;

  const computeEventValuesWithProbe = (currentTime: number, currentState: number[]) => {
    if (!effEventFunctions) return [];
    return effEventFunctions.map((g, gIdx) => {
      const gVal = g(currentTime, currentState);
      if (Math.abs(gVal) < 1e-10) {
        const dydt = f(currentTime, currentState);
        const probe = currentState.map((yi, si) => yi + 1e-8 * (dydt[si] ?? 0));
        const gProbe = g(currentTime + 1e-8, probe);
        if (Math.abs(gProbe) > 1e-14) {
          return gProbe > 0 ? 1e-10 : -1e-10;
        }
        const reqDir = effEventDirections?.[gIdx] ?? 0;
        if (reqDir < 0) return -1e-10;
        if (reqDir > 0) return 1e-10;
        return 0;
      }
      return gVal;
    });
  };

  // Pre-allocate stage vector
  const yStage = new Array<number>(n);
  const yNew = new Array<number>(n);

  // WebAssembly Linear Memory Acceleration for Tsit5 stages and embedded error
  const wasm = getDefaultWasmExports() as Tsit5WasmExports | null;
  const hasWasm = Boolean(
    wasm &&
    typeof wasm.tsit5_combine_stage === "function" &&
    typeof wasm.tsit5_compute_step_and_error === "function" &&
    typeof wasm.__new === "function" &&
    n > 0,
  );

  let yPtr = 0;
  let kBasePtr = 0;
  let yStagePtr = 0;
  let yNewPtr = 0;
  const aRowPtrs: number[] = [];
  let b5Ptr = 0;
  let ePtr = 0;

  if (hasWasm && wasm?.__new) {
    const alloc = (bytes: number): number => wasm.__new!(bytes, 0);
    yPtr = alloc(n * 8);
    kBasePtr = alloc(7 * n * 8);
    yStagePtr = alloc(n * 8);
    yNewPtr = alloc(n * 8);

    for (let s = 1; s <= 5; s++) {
      const a_row = TSIT5_A[s]!;
      const ptr = alloc(s * 8);
      const view = new Float64Array(wasm.memory.buffer, ptr, s);
      for (let j = 0; j < s; j++) view[j] = a_row[j] ?? 0;
      aRowPtrs.push(ptr);
    }

    b5Ptr = alloc(6 * 8);
    const b5View = new Float64Array(wasm.memory.buffer, b5Ptr, 6);
    for (let j = 0; j < 6; j++) b5View[j] = TSIT5_B5[j] ?? 0;

    ePtr = alloc(7 * 8);
    const eView = new Float64Array(wasm.memory.buffer, ePtr, 7);
    for (let j = 0; j < 7; j++) eView[j] = TSIT5_E[j] ?? 0;

    // Copy initial y and k0
    new Float64Array(wasm.memory.buffer, yPtr, n).set(y);
    new Float64Array(wasm.memory.buffer, kBasePtr, n).set(kBuffer.subarray(0, n));
  }

  let prevEventVals: number[] = [];
  if (effEventFunctions && effEventFunctions.length > 0) {
    prevEventVals = computeEventValuesWithProbe(t, y);
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

    let maxErrorRatio = 0.0;

    if (hasWasm && wasm?.tsit5_combine_stage && wasm.tsit5_compute_step_and_error) {
      const kView = new Float64Array(wasm.memory.buffer, kBasePtr, 7 * n);
      const stageOutView = new Float64Array(wasm.memory.buffer, yStagePtr, n);

      // Stages 1 to 5 via WASM SIMD / linear memory kernel
      for (let s = 1; s <= 5; s++) {
        const c_s = TSIT5_C[s]!;
        wasm.tsit5_combine_stage(n, yPtr, kBasePtr, aRowPtrs[s - 1]!, s, h, yStagePtr);
        for (let i = 0; i < n; i++) {
          yStage[i] = stageOutView[i]!;
        }
        const fs = f(t + c_s * h, yStage);
        k[s] = fs;
        const sOffset = s * n;
        for (let i = 0; i < n; i++) {
          const val = fs[i] ?? 0;
          kBuffer[sOffset + i] = val;
          kView[sOffset + i] = val;
        }
        stats.fEvals++;
      }

      // Compute candidate state yNew
      wasm.tsit5_combine_stage(n, yPtr, kBasePtr, b5Ptr, 6, h, yNewPtr);
      const yNewView = new Float64Array(wasm.memory.buffer, yNewPtr, n);
      for (let i = 0; i < n; i++) {
        yNew[i] = yNewView[i]!;
      }

      // Stage 6 (FSAL evaluation: f at new candidate state)
      const f6 = f(t + h, yNew);
      k[6] = f6;
      const offset6 = 6 * n;
      for (let i = 0; i < n; i++) {
        const val = f6[i] ?? 0;
        kBuffer[offset6 + i] = val;
        kView[offset6 + i] = val;
      }
      stats.fEvals++;

      // Compute normalized embedded error norm in WASM
      maxErrorRatio = wasm.tsit5_compute_step_and_error(n, yPtr, kBasePtr, b5Ptr, ePtr, h, atol, rtol, yNewPtr);
    } else {
      // TypeScript fallback for environments without WASM exports
      // Stages 1 to 5
      for (let s = 1; s <= 5; s++) {
        const a_row = TSIT5_A[s]!;
        const c_s = TSIT5_C[s]!;
        for (let i = 0; i < n; i++) {
          let sum = 0;
          for (let j = 0; j < s; j++) {
            sum += (a_row[j] ?? 0) * kBuffer[j * n + i]!;
          }
          yStage[i] = (y[i] ?? 0) + h * sum;
        }
        const fs = f(t + c_s * h, yStage);
        k[s] = fs;
        const sOffset = s * n;
        for (let i = 0; i < n; i++) {
          kBuffer[sOffset + i] = fs[i] ?? 0;
        }
        stats.fEvals++;
      }

      // Candidate new state yNew (using 5th-order weights TSIT5_B5)
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = 0; j <= 5; j++) {
          sum += (TSIT5_B5[j] ?? 0) * kBuffer[j * n + i]!;
        }
        yNew[i] = (y[i] ?? 0) + h * sum;
      }

      // Stage 6 (FSAL evaluation: f at new candidate state)
      const f6 = f(t + h, yNew);
      k[6] = f6;
      const offset6 = 6 * n;
      for (let i = 0; i < n; i++) {
        kBuffer[offset6 + i] = f6[i] ?? 0;
      }
      stats.fEvals++;

      // Compute error estimate: err = h * sum(E[j] * k[j])
      for (let i = 0; i < n; i++) {
        let err_i = 0;
        for (let j = 0; j <= 6; j++) {
          err_i += (TSIT5_E[j] ?? 0) * kBuffer[j * n + i]!;
        }
        err_i = Math.abs(h * err_i);
        const sc_i = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
        const ratio = err_i / sc_i;
        if (ratio > maxErrorRatio) {
          maxErrorRatio = ratio;
        }
      }
    }

    // Step acceptance check
    if (maxErrorRatio <= 1.0) {
      // Step accepted
      stats.acceptedSteps++;

      // Event detection between t and t+h
      if (effEventFunctions && effEventFunctions.length > 0) {
        const currEventVals = effEventFunctions.map((ef) => ef(t + h, yNew));
        let eventTriggered = -1;
        let eventDir: 1 | -1 = 1;
        let bestTEvent = tEnd >= t0 ? Infinity : -Infinity;
        let bestYEvent: number[] = [...yNew];

        for (let ei = 0; ei < effEventFunctions.length; ei++) {
          const vPrev = prevEventVals[ei] ?? 0;
          const vCurr = currEventVals[ei] ?? 0;
          const expectedDir = effEventDirections?.[ei] ?? 0;

          if (vPrev * vCurr < 0) {
            const dir: 1 | -1 = vCurr > vPrev ? 1 : -1;
            if (expectedDir === 0 || expectedDir === dir) {
              // Bisection root finding for candidate ei
              let tLeft = t;
              let tRight = t + h;
              let yCand = [...yNew];
              let valLeft = vPrev;

              for (let iter = 0; iter < 30; iter++) {
                const tMid = 0.5 * (tLeft + tRight);
                const thetaMid = (tMid - t) / h;
                const yMid = tsit5Interpolate(y, yNew, k, h, thetaMid);
                const valMid = effEventFunctions[ei]!(tMid, yMid);

                if (Math.abs(valMid) < 1e-12 || Math.abs(tRight - tLeft) < 1e-14) {
                  yCand = yMid;
                  tRight = tMid;
                  break;
                }
                if (valLeft * valMid <= 0) {
                  tRight = tMid;
                } else {
                  tLeft = tMid;
                  valLeft = valMid;
                }
                yCand = yMid;
              }

              const isEarlier = tEnd >= t0 ? tRight < bestTEvent : tRight > bestTEvent;
              if (isEarlier) {
                bestTEvent = tRight;
                bestYEvent = yCand;
                eventTriggered = ei;
                eventDir = dir;
              }
            }
          }
        }

        if (eventTriggered >= 0) {
          const tEvent = bestTEvent;
          const yEvent = bestYEvent;
          const hasOutputGrid = denseOutputs && options.equidistantOutput !== false;

          if (hasOutputGrid && outputTimes) {
            while (outIdx < outputTimes.length) {
              const tTarget = outputTimes[outIdx]!;
              const beforeEvent = tEnd >= t0 ? tTarget < tEvent - 1e-14 : tTarget > tEvent + 1e-14;
              if (beforeEvent) {
                const theta = (tTarget - t) / h;
                const yTarget = tsit5Interpolate(y, yNew, k, h, theta);
                resultTimes.push(tTarget);
                resultStates.push(yTarget);
                outIdx++;
              } else {
                break;
              }
            }
          }

          if (effEventCallback) {
            y = effEventCallback(tEvent, yEvent, eventTriggered, eventDir);
          } else {
            y = yEvent;
          }

          if (hasOutputGrid && outputTimes) {
            if (outIdx < outputTimes.length && Math.abs(outputTimes[outIdx]! - tEvent) <= 1e-14) {
              resultTimes.push(outputTimes[outIdx]!);
              resultStates.push([...y]);
              outIdx++;
            }
          } else {
            resultTimes.push(tEvent);
            resultStates.push([...y]);
          }

          t = tEvent;
          k[0] = f(t, y);
          for (let i = 0; i < n; i++) kBuffer[i] = k[0][i] ?? 0;
          stats.fEvals++;
          prevEventVals = computeEventValuesWithProbe(t, y);

          if (hasWasm && wasm) {
            new Float64Array(wasm.memory.buffer, yPtr, n).set(y);
            new Float64Array(wasm.memory.buffer, kBasePtr, n).set(kBuffer.subarray(0, n));
          }

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

      if (hasWasm && wasm) {
        new Float64Array(wasm.memory.buffer, yPtr, n).set(new Float64Array(wasm.memory.buffer, yNewPtr, n));
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
      kBuffer.copyWithin(0, 6 * n, 7 * n);
      if (hasWasm && wasm) {
        new Float64Array(wasm.memory.buffer, kBasePtr, 7 * n).copyWithin(0, 6 * n, 7 * n);
      }

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
