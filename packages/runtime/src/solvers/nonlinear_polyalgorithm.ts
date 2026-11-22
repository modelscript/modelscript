// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Nonlinear Root-Finding Polyalgorithm: Newton-Raphson, Powell Dogleg Trust-Region,
 * Broyden Quasi-Newton, and Matrix-Free JFNK.
 *
 * Mirrors SciML's `NonlinearSolve.jl` polyalgorithm (`NewtonRaphson` → `TrustRegion` → `Broyden` → `JFNK`)
 * operating directly on flat `Float64Array` buffers with WASM LU factorization.
 */

import { jfnkSolve } from "./krylov.js";
import { luFactorFlat, luSolveFlat } from "./wasm_gaussian.js";

export type NonlinearResidualFn = (x: Float64Array, fOut: Float64Array) => void;
export type NonlinearJacobianFn = (x: Float64Array, jOut: Float64Array) => void;

export interface NonlinearSolveOptions {
  /** Euclidean residual norm tolerance `||F(x)||_2` (default: 1e-10). */
  tol?: number | undefined;
  /** Maximum iterations per solver stage (default: 50). */
  maxIter?: number | undefined;
  /** Initial trust-region radius (default: 1.0, scaled by `||x0||_2` if > 1). */
  initialRadius?: number | undefined;
  /** Maximum trust-region radius (default: 1e4). */
  maxRadius?: number | undefined;
  /** Optional analytical Jacobian evaluator (row-major n×n flat Float64Array). */
  jacobian?: NonlinearJacobianFn | undefined;
}

export interface NonlinearSolveResult {
  x: Float64Array;
  converged: boolean;
  residualNorm: number;
  iterations: number;
  methodUsed: "newton" | "trust-region" | "broyden" | "jfnk";
}

function norm2(v: Float64Array): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  return Math.sqrt(s);
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function computeFdJacobian(
  f: NonlinearResidualFn,
  x: Float64Array,
  f0: Float64Array,
  J: Float64Array,
  xPert: Float64Array,
  fPert: Float64Array,
): void {
  const n = x.length;
  xPert.set(x);
  for (let j = 0; j < n; j++) {
    const xj = x[j]!;
    const h = Math.max(1e-7, 1e-7 * Math.abs(xj));
    xPert[j] = xj + h;
    f(xPert, fPert);
    xPert[j] = xj;
    const invH = 1.0 / h;
    for (let i = 0; i < n; i++) {
      J[i * n + j] = (fPert[i]! - f0[i]!) * invH;
    }
  }
}

/**
 * Powell Dogleg Trust-Region Nonlinear Solver.
 *
 * Minimizes `0.5 * ||F(x)||_2^2` using exact Gauss-Newton / Cauchy dogleg steps inside
 * an adaptive trust region `||p||_2 <= delta`, with Tikhonov damping when `J` is singular.
 */
export function trustRegionSolve(
  f: NonlinearResidualFn,
  x0: Float64Array,
  options: NonlinearSolveOptions = {},
): NonlinearSolveResult {
  const n = x0.length;
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 60;
  const maxRadius = options.maxRadius ?? 1e4;

  const x = new Float64Array(x0);
  const fCur = new Float64Array(n);
  const fNext = new Float64Array(n);
  const xNext = new Float64Array(n);
  const xPert = new Float64Array(n);
  const fPert = new Float64Array(n);
  const J = new Float64Array(n * n);
  const Jwork = new Float64Array(n * n);
  const g = new Float64Array(n); // J^T F
  const Jg = new Float64Array(n);
  const pN = new Float64Array(n);
  const pC = new Float64Array(n);
  const pStep = new Float64Array(n);
  const Jp = new Float64Array(n);

  f(x, fCur);
  let resNorm = norm2(fCur);
  if (resNorm <= tol) {
    return { x, converged: true, residualNorm: resNorm, iterations: 0, methodUsed: "trust-region" };
  }

  let delta = options.initialRadius ?? Math.max(1.0, norm2(x));
  let iter = 0;

  for (; iter < maxIter; iter++) {
    if (options.jacobian) {
      options.jacobian(x, J);
    } else {
      computeFdJacobian(f, x, fCur, J, xPert, fPert);
    }

    // Compute gradient g = J^T * fCur
    g.fill(0);
    for (let i = 0; i < n; i++) {
      const fi = fCur[i]!;
      const rowOff = i * n;
      for (let j = 0; j < n; j++) {
        g[j] = g[j]! + J[rowOff + j]! * fi;
      }
    }
    const gNormSq = dot(g, g);
    if (gNormSq < 1e-30) break;

    // Cauchy step: pC = -(||g||^2 / ||J g||^2) * g
    for (let i = 0; i < n; i++) {
      let s = 0;
      const rowOff = i * n;
      for (let j = 0; j < n; j++) s += J[rowOff + j]! * g[j]!;
      Jg[i] = s;
    }
    const JgNormSq = dot(Jg, Jg);
    const alphaC = JgNormSq > 1e-30 ? gNormSq / JgNormSq : 1.0;
    const gNorm = Math.sqrt(gNormSq);
    const pCNormUnclamped = alphaC * gNorm;
    const cauchyScale = pCNormUnclamped >= delta ? delta / gNorm : alphaC;
    for (let j = 0; j < n; j++) pC[j] = -cauchyScale * g[j]!;

    // Newton step: J * pN = -fCur (with damped normal-equation fallback if singular)
    Jwork.set(J);
    for (let i = 0; i < n; i++) pN[i] = -fCur[i]!;
    let newtonOk = true;
    const fact = luFactorFlat(Jwork, n);
    luSolveFlat(fact, pN);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(pN[i]!)) {
        newtonOk = false;
        break;
      }
    }

    if (!newtonOk) {
      // Damped Gauss-Newton: (J^T J + lambda I) pN = -g
      const lambda = 1e-4 * Math.max(1.0, resNorm);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          let s = i === j ? lambda : 0;
          for (let k = 0; k < n; k++) s += J[k * n + i]! * J[k * n + j]!;
          Jwork[i * n + j] = s;
        }
        pN[i] = -g[i]!;
      }
      const factD = luFactorFlat(Jwork, n);
      luSolveFlat(factD, pN);
      newtonOk = pN.every(Number.isFinite);
    }

    // Powell dogleg step selection
    if (!newtonOk || pCNormUnclamped >= delta) {
      pStep.set(pC);
    } else {
      const pNNorm = norm2(pN);
      if (pNNorm <= delta) {
        pStep.set(pN);
      } else {
        // Interpolate along pC + tau * (pN - pC) to hit ||pStep|| = delta
        let a = 0;
        let b = 0;
        let c = -delta * delta;
        for (let i = 0; i < n; i++) {
          const d = pN[i]! - pC[i]!;
          a += d * d;
          b += 2 * pC[i]! * d;
          c += pC[i]! * pC[i]!;
        }
        const disc = Math.max(0, b * b - 4 * a * c);
        const tau = a > 1e-30 ? Math.min(1, Math.max(0, (-b + Math.sqrt(disc)) / (2 * a))) : 0;
        for (let i = 0; i < n; i++) {
          pStep[i] = pC[i]! + tau * (pN[i]! - pC[i]!);
        }
      }
    }

    // Evaluate candidate step
    for (let i = 0; i < n; i++) xNext[i] = x[i]! + pStep[i]!;
    f(xNext, fNext);
    const nextNorm = norm2(fNext);

    // Predicted reduction: 0.5 * (||F||^2 - ||F + J p||^2)
    for (let i = 0; i < n; i++) {
      let s = fCur[i]!;
      const rowOff = i * n;
      for (let j = 0; j < n; j++) s += J[rowOff + j]! * pStep[j]!;
      Jp[i] = s;
    }
    const predRed = 0.5 * (resNorm * resNorm - dot(Jp, Jp));
    const actRed = 0.5 * (resNorm * resNorm - nextNorm * nextNorm);
    const rho = predRed > 1e-30 ? actRed / predRed : actRed > 0 ? 1.0 : 0.0;

    if (rho < 0.25) {
      delta = Math.max(1e-12, 0.25 * norm2(pStep));
    } else if (rho > 0.75 && Math.abs(norm2(pStep) - delta) < 1e-6 * delta) {
      delta = Math.min(maxRadius, 2.0 * delta);
    }

    if (rho > 1e-4 && Number.isFinite(nextNorm)) {
      x.set(xNext);
      fCur.set(fNext);
      resNorm = nextNorm;
      if (resNorm <= tol) {
        return { x, converged: true, residualNorm: resNorm, iterations: iter + 1, methodUsed: "trust-region" };
      }
    }

    if (delta < 1e-12) break;
  }

  return { x, converged: resNorm <= tol, residualNorm: resNorm, iterations: iter, methodUsed: "trust-region" };
}

/**
 * Good Broyden Quasi-Newton Solver (rank-1 inverse Jacobian updates, O(n^2) per step).
 */
export function broydenSolve(
  f: NonlinearResidualFn,
  x0: Float64Array,
  options: NonlinearSolveOptions = {},
): NonlinearSolveResult {
  const n = x0.length;
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 80;

  const x = new Float64Array(x0);
  const fCur = new Float64Array(n);
  const fNext = new Float64Array(n);
  const xPert = new Float64Array(n);
  const fPert = new Float64Array(n);
  const J = new Float64Array(n * n);
  const Binv = new Float64Array(n * n);

  f(x, fCur);
  let resNorm = norm2(fCur);
  if (resNorm <= tol) {
    return { x, converged: true, residualNorm: resNorm, iterations: 0, methodUsed: "broyden" };
  }

  // Initialize Binv = J(x0)^{-1} (fallback to Identity if singular)
  if (options.jacobian) {
    options.jacobian(x, J);
  } else {
    computeFdJacobian(f, x, fCur, J, xPert, fPert);
  }
  const fact = luFactorFlat(J, n);
  let invOk = true;
  const col = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    col.fill(0);
    col[j] = 1;
    luSolveFlat(fact, col);
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(col[i]!)) invOk = false;
      Binv[i * n + j] = col[i]!;
    }
  }
  if (!invOk) {
    Binv.fill(0);
    for (let i = 0; i < n; i++) Binv[i * n + i] = 1;
  }

  const s = new Float64Array(n);
  const y = new Float64Array(n);
  const BinvY = new Float64Array(n);
  const sT_Binv = new Float64Array(n);
  const xCand = new Float64Array(n);

  let iter = 0;
  for (; iter < maxIter; iter++) {
    // s = -Binv * fCur
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const rowOff = i * n;
      for (let j = 0; j < n; j++) acc += Binv[rowOff + j]! * fCur[j]!;
      s[i] = -acc;
    }

    // Simple backtracking line search
    let alpha = 1.0;
    let nextNorm = Infinity;
    for (let ls = 0; ls < 6; ls++) {
      for (let i = 0; i < n; i++) xCand[i] = x[i]! + alpha * s[i]!;
      f(xCand, fNext);
      nextNorm = norm2(fNext);
      if (Number.isFinite(nextNorm) && (nextNorm < resNorm || ls === 5)) break;
      alpha *= 0.5;
    }
    if (!Number.isFinite(nextNorm)) break;

    for (let i = 0; i < n; i++) {
      s[i] = xCand[i]! - x[i]!;
      y[i] = fNext[i]! - fCur[i]!;
      x[i] = xCand[i]!;
      fCur[i] = fNext[i]!;
    }
    resNorm = nextNorm;
    if (resNorm <= tol) {
      return { x, converged: true, residualNorm: resNorm, iterations: iter + 1, methodUsed: "broyden" };
    }

    // Sherman-Morrison update: Binv += ((s - Binv*y) * (s^T * Binv)) / (s^T * Binv * y)
    for (let i = 0; i < n; i++) {
      let acc = 0;
      const rowOff = i * n;
      for (let j = 0; j < n; j++) acc += Binv[rowOff + j]! * y[j]!;
      BinvY[i] = acc;
    }
    const denom = dot(s, BinvY);
    if (Math.abs(denom) > 1e-18) {
      for (let j = 0; j < n; j++) {
        let acc = 0;
        for (let i = 0; i < n; i++) acc += s[i]! * Binv[i * n + j]!;
        sT_Binv[j] = acc;
      }
      const invDenom = 1.0 / denom;
      for (let i = 0; i < n; i++) {
        const u = (s[i]! - BinvY[i]!) * invDenom;
        const rowOff = i * n;
        for (let j = 0; j < n; j++) {
          Binv[rowOff + j] = Binv[rowOff + j]! + u * sT_Binv[j]!;
        }
      }
    }
  }

  return { x, converged: resNorm <= tol, residualNorm: resNorm, iterations: iter, methodUsed: "broyden" };
}

/**
 * Unified Nonlinear Polyalgorithm (`TrustRegion` → `Broyden` → `JFNK`).
 *
 * Automatically escalates to more robust globalized methods if the fast local solver stalls,
 * always returning the best iterate found.
 */
export function nonlinearPolyalgorithmSolve(
  f: NonlinearResidualFn,
  x0: Float64Array,
  options: NonlinearSolveOptions = {},
): NonlinearSolveResult {
  const tol = options.tol ?? 1e-10;

  // Stage 1: Powell Dogleg Trust-Region (handles both fast Newton steps and ill-conditioned regions)
  const tr = trustRegionSolve(f, x0, options);
  if (tr.converged) return tr;

  let best: NonlinearSolveResult = tr;

  // Stage 2: Broyden Quasi-Newton starting from best iterate so far
  const br = broydenSolve(f, best.x, options);
  if (br.converged) return br;
  if (br.residualNorm < best.residualNorm) best = br;

  // Stage 3: Matrix-Free JFNK with Armijo line search
  const jfnk = jfnkSolve(f, best.x, { tol, maxNewtonIter: options.maxIter ?? 30 });
  if (jfnk.converged || jfnk.residualNorm < best.residualNorm) {
    return {
      x: jfnk.x,
      converged: jfnk.converged,
      residualNorm: jfnk.residualNorm,
      iterations: jfnk.newtonIterations,
      methodUsed: "jfnk",
    };
  }

  return best;
}
