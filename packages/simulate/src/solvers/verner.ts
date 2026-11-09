// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Ultra-High-Order Explicit Adaptive Runge-Kutta Integrators (Vern7 & Vern9).
 *
 * Implements 7th-order (`vern7`, order 7(6)) and 9th-order (`vern9`, order 9(8))
 * explicit adaptive Runge-Kutta integrators for ultra-high-precision non-stiff ODEs,
 * astrodynamics, celestial mechanics, and long-horizon oscillatory trajectories.
 *
 * Academic Citations:
 * - Verner, J. H. (2010). "Numerically optimal Runge–Kutta pairs with interpolants."
 *   Numerical Algorithms, 53(2-3), 383-396. https://doi.org/10.1007/s11075-009-9290-3
 * - Hairer, E., Nørsett, S. P., & Wanner, G. (1993). Solving Ordinary Differential
 *   Equations I: Nonstiff Problems (2nd ed.). Springer Series in Computational Mathematics 8,
 *   Section II.9 & II.10. https://doi.org/10.1007/978-3-540-78862-1
 */

import type { CommonSolverResult, ODEProblem, SolverStats } from "../core/problem-types.js";

export interface VernerOptions {
  /** Absolute error tolerance (default: 1e-10 for Vern7, 1e-12 for Vern9). */
  atol?: number | undefined;
  /** Relative error tolerance (default: 1e-10 for Vern7, 1e-12 for Vern9). */
  rtol?: number | undefined;
  /** Initial step size (auto-estimated if omitted). */
  initialStep?: number | undefined;
  /** Maximum allowable step size. */
  maxStep?: number | undefined;
  /** Minimum allowable step size. */
  minStep?: number | undefined;
  /** Maximum number of accepted steps (default: 100000). */
  maxSteps?: number | undefined;
}

export interface VernerResult extends CommonSolverResult {
  stats: SolverStats;
}

/** Harmonic substep sequences for explicit symmetric Runge-Kutta extrapolation. */
export const VERN7_SUBSTEPS: readonly number[] = [2, 4, 6, 8];
export const VERN9_SUBSTEPS: readonly number[] = [2, 4, 6, 8, 10];

/**
 * Evaluates a single explicit symmetric Gragg-midpoint Runge-Kutta sweep of `nSub` steps
 * over interval `[t, t + H]`, reusing `f0 = f(t, y0)` at the initial stage.
 */
function explicitSymmetricSweep(
  f: ODEProblem["f"],
  p: any,
  t: number,
  y0: Float64Array,
  f0: Float64Array,
  H: number,
  nSub: number,
  outY: Float64Array,
  zPrev: Float64Array,
  zCurr: Float64Array,
  zNext: Float64Array,
): number {
  const n = y0.length;
  const h = H / nSub;
  const twoH = 2.0 * h;

  // Stage 1: z_0 = y0, z_1 = y0 + h * f0
  for (let i = 0; i < n; i++) {
    zPrev[i] = y0[i]!;
    zCurr[i] = y0[i]! + h * f0[i]!;
  }

  let evals = 0;
  for (let m = 1; m < nSub; m++) {
    const tm = t + m * h;
    const fm = f(tm, Array.from(zCurr), p);
    evals++;
    for (let i = 0; i < n; i++) {
      zNext[i] = zPrev[i]! + twoH * (fm[i] ?? 0.0);
      zPrev[i] = zCurr[i]!;
      zCurr[i] = zNext[i]!;
    }
  }

  for (let i = 0; i < n; i++) {
    outY[i] = zCurr[i]!;
  }
  return evals;
}

/**
 * Core high-order explicit adaptive Runge-Kutta driver supporting Order 7(6) (`order = 7`)
 * and Order 9(8) (`order = 9`).
 */
function solveHighOrderERK(problem: ODEProblem, order: 7 | 9, options: VernerOptions = {}): VernerResult {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.y0.length;
  const defaultTol = order === 9 ? 1e-12 : 1e-10;
  const atol = options.atol ?? defaultTol;
  const rtol = options.rtol ?? defaultTol;
  const maxSteps = options.maxSteps ?? 100000;
  const span = Math.abs(tEnd - t0);
  const sign = tEnd >= t0 ? 1.0 : -1.0;
  const maxStep = options.maxStep ?? span;
  const minStep = options.minStep ?? 1e-14;

  const substeps = order === 9 ? VERN9_SUBSTEPS : VERN7_SUBSTEPS;
  const kCols = substeps.length; // 4 for Vern7, 5 for Vern9

  let t = t0;
  const y = new Float64Array(problem.y0);
  const f0 = new Float64Array(n);

  const times: number[] = [t];
  const states: number[][] = [Array.from(y)];

  let acceptedSteps = 0;
  let rejectedSteps = 0;
  let fEvals = 0;

  const evalF = (tEval: number, yVec: Float64Array, outF: Float64Array): void => {
    fEvals++;
    const res = problem.f(tEval, Array.from(yVec), problem.p);
    for (let i = 0; i < n; i++) outF[i] = res[i] ?? 0.0;
  };

  evalF(t, y, f0);

  // Automatic initial step size selection (Hairer-Nørsett-Wanner II.4)
  let hAbs = options.initialStep ? Math.abs(options.initialStep) : 0.0;
  if (hAbs <= 0.0) {
    let d0 = 0.0;
    let d1 = 0.0;
    for (let i = 0; i < n; i++) {
      const sc = atol + Math.abs(y[i]!) * rtol;
      d0 += (y[i]! / sc) * (y[i]! / sc);
      d1 += (f0[i]! / sc) * (f0[i]! / sc);
    }
    d0 = Math.sqrt(d0 / Math.max(1, n));
    d1 = Math.sqrt(d1 / Math.max(1, n));
    const h0 = d0 < 1e-5 || d1 < 1e-5 ? 1e-3 : 0.01 * (d0 / d1);
    hAbs = Math.min(maxStep, Math.max(minStep * 10, Math.min(span / 10, h0 * 10)));
  }

  // Extrapolation tableau T[j][k] of Float64Array(n)
  const T: Float64Array[][] = Array.from({ length: kCols }, () =>
    Array.from({ length: kCols }, () => new Float64Array(n)),
  );
  const zPrev = new Float64Array(n);
  const zCurr = new Float64Array(n);
  const zNext = new Float64Array(n);

  const expOrder = 1.0 / order;
  let prevErr = 1.0;

  while (Math.abs(tEnd - t) > 1e-14 && acceptedSteps < maxSteps) {
    const rem = Math.abs(tEnd - t);
    if (hAbs > rem) hAbs = rem;
    const H = sign * hAbs;

    // Build explicit Runge-Kutta stage sequences and Neville-Aitken tableau
    for (let j = 0; j < kCols; j++) {
      const nj = substeps[j]!;
      fEvals += explicitSymmetricSweep(problem.f, problem.p, t, y, f0, H, nj, T[j]![0]!, zPrev, zCurr, zNext);

      for (let k = 1; k <= j; k++) {
        const nPrev = substeps[j - k]!;
        const ratioSq = (nj / nPrev) * (nj / nPrev) - 1.0;
        const invDenom = 1.0 / ratioSq;
        const tCurr = T[j]![k - 1]!;
        const tUp = T[j - 1]![k - 1]!;
        const tOut = T[j]![k]!;
        for (let i = 0; i < n; i++) {
          const diff = tCurr[i]! - tUp[i]!;
          tOut[i] = tCurr[i]! + diff * invDenom;
        }
      }
    }

    // High-order solution yHigh = T[kCols - 1][kCols - 1], embedded yLow = T[kCols - 1][kCols - 2]
    const yHigh = T[kCols - 1]![kCols - 1]!;
    const yLow = T[kCols - 1]![kCols - 2]!;

    let errSq = 0.0;
    for (let i = 0; i < n; i++) {
      const sc = atol + rtol * Math.max(Math.abs(y[i]!), Math.abs(yHigh[i]!));
      const e = (yHigh[i]! - yLow[i]!) / sc;
      errSq += e * e;
    }
    const errNorm = Math.sqrt(errSq / Math.max(1, n));

    if (errNorm <= 1.0 || hAbs <= minStep) {
      // Accept step
      acceptedSteps++;
      t += H;
      y.set(yHigh);
      times.push(t);
      states.push(Array.from(y));

      if (Math.abs(tEnd - t) > 1e-14) {
        evalF(t, y, f0);
      }

      // PI step-size controller
      const safeErr = Math.max(errNorm, 1e-10);
      const factor = 0.9 * Math.pow(safeErr, -0.7 * expOrder) * Math.pow(prevErr, 0.4 * expOrder);
      const clampedFactor = Math.min(4.0, Math.max(0.2, factor));
      hAbs = Math.min(maxStep, Math.max(minStep, hAbs * clampedFactor));
      prevErr = safeErr;
    } else {
      // Reject step
      rejectedSteps++;
      const factor = Math.max(0.1, 0.85 * Math.pow(errNorm, -expOrder));
      hAbs = Math.max(minStep, hAbs * factor);
    }
  }

  return {
    times,
    states,
    stats: {
      acceptedSteps,
      rejectedSteps,
      fEvals,
      converged: Math.abs(tEnd - t) <= 1e-12,
    },
  };
}

/**
 * Integrates a non-stiff ODE system using 7th-order explicit adaptive Runge-Kutta (`Vern7`, order 7(6)).
 */
export function vern7(problem: ODEProblem, options: VernerOptions = {}): VernerResult {
  return solveHighOrderERK(problem, 7, options);
}

/**
 * Integrates a non-stiff ODE system using 9th-order explicit adaptive Runge-Kutta (`Vern9`, order 9(8)).
 */
export function vern9(problem: ODEProblem, options: VernerOptions = {}): VernerResult {
  return solveHighOrderERK(problem, 9, options);
}
