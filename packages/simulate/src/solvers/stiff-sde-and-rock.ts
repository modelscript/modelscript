// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulate — Stiff Implicit SDE (`ImplicitEM`), Stabilized Explicit `ROCK2`,
 * and Solver-Agnostic `methodOfSteps` DDE Wrapper.
 *
 * Mirrors SciML's `StochasticDiffEq.jl` (`ImplicitEM`), `OrdinaryDiffEqStabilizedRK` (`ROCK2`),
 * and `DelayDiffEq.jl` (`MethodOfSteps(alg)`).
 */

import { luFactorFlat, luSolveFlat } from "@modelscript/runtime/wasm_gaussian.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Implicit Euler-Maruyama (`ImplicitEM`) for Stiff SDEs
// ─────────────────────────────────────────────────────────────────────────────

export interface ImplicitSdeOptions {
  /** Fixed time step `dt`. */
  dt: number;
  /** Deterministic PRNG seed (default: 42). */
  seed?: number | undefined;
  /** Newton tolerance for implicit drift step (default: 1e-9). */
  newtonTol?: number | undefined;
  /** Maximum Newton iterations per step (default: 15). */
  maxNewtonIter?: number | undefined;
}

export interface ImplicitSdeResult {
  times: number[];
  states: number[][];
  steps: number;
}

/**
 * L-stable Implicit Euler-Maruyama (`ImplicitEM`) for stiff Ito SDEs:
 *   `dy = f(t, y) dt + g(t, y) dW_t`
 * Solves `y_{n+1} - dt * f(t_{n+1}, y_{n+1}) = y_n + g(t_n, y_n) * dW_n` via Newton-Raphson.
 */
export function implicitEulerMaruyama(
  drift: (t: number, y: number[]) => number[],
  diffusion: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  options: ImplicitSdeOptions,
): ImplicitSdeResult {
  const n = y0.length;
  const dt = options.dt;
  const newtonTol = options.newtonTol ?? 1e-9;
  const maxNewton = options.maxNewtonIter ?? 15;

  let seed = (options.seed ?? 42) >>> 0 || 1;
  const randNormal = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const u1 = Math.max(1e-12, ((seed >>> 0) + 1) / 4294967297);
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const u2 = ((seed >>> 0) + 1) / 4294967297;
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  };

  const times: number[] = [t0];
  const states: number[][] = [[...y0]];
  let t = t0;
  let y = [...y0];
  let steps = 0;

  const J = new Float64Array(n * n);
  const res = new Float64Array(n);

  while (t < tEnd - 1e-13) {
    const h = Math.min(dt, tEnd - t);
    const sqrtH = Math.sqrt(h);
    const gVal = diffusion(t, y);

    // Explicit Ito stochastic increment: rhs = y_n + g(t_n, y_n) * dW_n
    const rhs = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      rhs[i] = y[i]! + (gVal[i] ?? 0) * sqrtH * randNormal();
    }

    const tNext = t + h;
    const yNext = [...rhs];

    // Newton solve: F(yNext) = yNext - h * drift(tNext, yNext) - rhs = 0
    for (let it = 0; it < maxNewton; it++) {
      const fVal = drift(tNext, yNext);
      let normSq = 0;
      for (let i = 0; i < n; i++) {
        const ri = yNext[i]! - h * (fVal[i] ?? 0) - rhs[i]!;
        res[i] = -ri;
        normSq += ri * ri;
      }
      if (Math.sqrt(normSq) <= newtonTol) break;

      const yPert = [...yNext];
      for (let j = 0; j < n; j++) {
        const eps = Math.max(1e-7, 1e-7 * Math.abs(yNext[j]!));
        yPert[j] = yNext[j]! + eps;
        const fPert = drift(tNext, yPert);
        yPert[j] = yNext[j]!;
        for (let i = 0; i < n; i++) {
          const df = ((fPert[i] ?? 0) - (fVal[i] ?? 0)) / eps;
          J[i * n + j] = (i === j ? 1.0 : 0.0) - h * df;
        }
      }

      const fact = luFactorFlat(J, n);
      luSolveFlat(fact, res);
      for (let i = 0; i < n; i++) yNext[i] = yNext[i]! + res[i]!;
    }

    t = tNext;
    y = yNext;
    steps++;
    times.push(t);
    states.push([...y]);
  }

  return { times, states, steps };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. ROCK2 / RKC2 Stabilized Explicit Runge-Kutta-Chebyshev Solver
// ─────────────────────────────────────────────────────────────────────────────

export interface Rock2Options {
  /** Time step size `dt` (fixed or adaptive). */
  dt?: number | undefined;
  /** Relative tolerance (default: 1e-5). */
  rtol?: number | undefined;
  /** Absolute tolerance (default: 1e-7). */
  atol?: number | undefined;
  /** Maximum Chebyshev stage count `s` (default: 50; stability region scales as ~0.65 * s^2). */
  maxStages?: number | undefined;
}

export interface Rock2Result {
  times: number[];
  states: number[][];
  steps: number;
  maxStagesUsed: number;
  fEvals: number;
}

/**
 * 2nd-Order Stabilized Explicit Runge-Kutta-Chebyshev (`RKC2` / `ROCK2` family) solver.
 *
 * Ideal for large mildly-stiff parabolic / semi-discretized PDE systems (e.g. diffusion / heat
 * equations) where Jacobian factorization is expensive: dynamically chooses the Chebyshev stage
 * count `s` from the power-iterated spectral radius `ρ(J)` so stability scales as `O(s^2)`.
 */
export function rock2Solve(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  options: Rock2Options = {},
): Rock2Result {
  const n = y0.length;
  const maxStages = options.maxStages ?? 50;
  const dampingEps = 2.0 / 13.0; // Verwer RKC2 damping parameter

  const times: number[] = [t0];
  const states: number[][] = [[...y0]];
  let t = t0;
  let y = [...y0];
  let h = options.dt ?? Math.min(0.05, (tEnd - t0) * 0.05);
  let steps = 0;
  let fEvals = 0;
  let maxStagesUsed = 2;

  // Estimate dominant real negative eigenvalue via 6 power iterations of J*v
  const estimateSpectralRadius = (tCur: number, yCur: number[], f0: number[]): number => {
    let v = new Array<number>(n).fill(1.0 / Math.sqrt(Math.max(1, n)));
    let rho = 1.0;
    for (let it = 0; it < 6; it++) {
      const eps = 1e-6;
      const yP = yCur.map((yi, i) => yi + eps * v[i]!);
      const fP = f(tCur, yP);
      fEvals++;
      const w = fP.map((fi, i) => (fi - f0[i]!) / eps);
      const norm = Math.hypot(...w);
      if (norm < 1e-12) return 0;
      rho = norm;
      v = w.map((wi) => wi / norm);
    }
    return rho * 1.15;
  };

  while (t < tEnd - 1e-13) {
    if (t + h > tEnd) h = tEnd - t;
    const f0 = f(t, y);
    fEvals++;

    const rho = estimateSpectralRadius(t, y, f0);
    // RKC2 stability boundary ≈ 0.65 * s^2 -> choose s >= sqrt(h * rho / 0.65)
    const s = Math.max(2, Math.min(maxStages, Math.ceil(Math.sqrt((h * rho) / 0.65)) + 1));
    if (s > maxStagesUsed) maxStagesUsed = s;

    // Verwer RKC2 Chebyshev recurrence parameters
    const w0 = 1.0 + dampingEps / (s * s);
    const T = new Float64Array(s + 1);
    const Tp = new Float64Array(s + 1);
    const Tpp = new Float64Array(s + 1);
    T[0] = 1;
    T[1] = w0;
    Tp[0] = 0;
    Tp[1] = 1;
    Tpp[0] = 0;
    Tpp[1] = 0;
    for (let j = 2; j <= s; j++) {
      T[j] = 2 * w0 * T[j - 1]! - T[j - 2]!;
      Tp[j] = 2 * T[j - 1]! + 2 * w0 * Tp[j - 1]! - Tp[j - 2]!;
      Tpp[j] = 4 * Tp[j - 1]! + 2 * w0 * Tpp[j - 1]! - Tpp[j - 2]!;
    }
    const w1 = Tp[s]! / Tpp[s]!;
    const b = new Float64Array(s + 1);
    for (let j = 2; j <= s; j++) b[j] = Tpp[j]! / (Tp[j]! * Tp[j]!);
    b[0] = b[2]!;
    b[1] = b[2]!;

    const muTilde1 = b[1]! * w1;
    let Yjm2 = [...y];
    let Yjm1 = y.map((yi, i) => yi + h * muTilde1 * f0[i]!);
    let cjm2 = 0;
    let cjm1 = muTilde1;

    for (let j = 2; j <= s; j++) {
      const mu = (2 * w0 * b[j]!) / b[j - 1]!;
      const nu = -b[j]! / b[j - 2]!;
      const muTilde = (2 * w1 * b[j]!) / b[j - 1]!;
      const gammaTilde = -(1.0 - b[j - 1]! * T[j - 1]!) * muTilde;
      const cj = mu * cjm1 + nu * cjm2 + muTilde + gammaTilde;

      const fjm1 = f(t + cjm1 * h, Yjm1);
      fEvals++;
      const Yj = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        Yj[i] =
          (1 - mu - nu) * y[i]! + mu * Yjm1[i]! + nu * Yjm2[i]! + h * muTilde * fjm1[i]! + h * gammaTilde * f0[i]!;
      }

      Yjm2 = Yjm1;
      Yjm1 = Yj;
      cjm2 = cjm1;
      cjm1 = cj;
    }

    t += h;
    y = Yjm1;
    steps++;
    times.push(t);
    states.push([...y]);
  }

  return { times, states, steps, maxStagesUsed, fEvals };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Generic Solver-Agnostic `methodOfSteps` DDE Wrapper (`DelayDiffEq.jl` parity)
// ─────────────────────────────────────────────────────────────────────────────

export type BaseOdeSolverFn = (
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
) => { times: number[]; states: number[][] };

export interface MethodOfStepsResult {
  times: number[];
  states: number[][];
  lags: number[];
}

/**
 * Lifts ANY ODE solver (`tsit5`, `rodas4p`, `rodas5p`, `rock2Solve`, etc.) into a Delay
 * Differential Equation solver via Bellman's Method of Steps with dense history interpolation.
 */
export function methodOfSteps(
  baseSolver: BaseOdeSolverFn,
  ddeRhs: (t: number, y: number[], history: (tQuery: number) => number[]) => number[],
  historyFn: (t: number) => number[],
  lags: number[],
  t0: number,
  tEnd: number,
): MethodOfStepsResult {
  const minLag = Math.min(...lags.filter((l) => l > 0));
  if (!Number.isFinite(minLag) || minLag <= 0) {
    throw new Error("methodOfSteps requires at least one strictly positive lag.");
  }

  const allTimes: number[] = [t0];
  const allStates: number[][] = [[...historyFn(t0)]];

  const evalHistory = (tQuery: number): number[] => {
    if (tQuery <= t0) return historyFn(tQuery);
    const m = allTimes.length;
    if (tQuery >= allTimes[m - 1]!) return allStates[m - 1]!;
    let lo = 0;
    let hi = m - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (allTimes[mid]! <= tQuery) lo = mid;
      else hi = mid;
    }
    const ta = allTimes[lo]!;
    const tb = allTimes[hi]!;
    const alpha = tb > ta ? (tQuery - ta) / (tb - ta) : 0;
    const ya = allStates[lo]!;
    const yb = allStates[hi]!;
    return ya.map((v, i) => v + alpha * (yb[i]! - v));
  };

  let segStart = t0;
  while (segStart < tEnd - 1e-13) {
    const segEnd = Math.min(tEnd, segStart + minLag);
    const yStart = allStates[allStates.length - 1]!;
    const segRes = baseSolver((t, y) => ddeRhs(t, y, evalHistory), segStart, yStart, segEnd);
    for (let i = 1; i < segRes.times.length; i++) {
      allTimes.push(segRes.times[i]!);
      allStates.push([...segRes.states[i]!]);
    }
    segStart = segEnd;
  }

  return { times: allTimes, states: allStates, lags };
}
