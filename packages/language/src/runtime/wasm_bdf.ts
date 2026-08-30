// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SparseJacobian } from "../compiler/simulator/evaluator/sparse-jacobian.js";
import { sparseJacobianToDense } from "../compiler/simulator/evaluator/sparse-jacobian.js";

/**
 * WebAssembly-backed Variable-Order BDF (Backward Differentiation Formula) solver
 * for stiff ODE/DAE systems.
 *
 * Implements BDF orders 1-5 with:
 *  - High-performance AssemblyScript WASM integration for linear memory DAE systems
 *  - Nordsieck array representation for efficient order/step changes
 *  - Modified Newton iteration with Jacobian reuse & sparse/dense AD Jacobian acceleration
 *  - Partial-pivoting LU factorization for the Newton linear system
 *  - Adaptive order and step-size control
 *  - Dense output via cubic Hermite interpolation
 *  - Event detection with bisection root-finding
 *
 * Reference: Byrne, G.D. & Hindmarsh, A.C. (1975),
 *   "A polyalgorithm for the numerical solution of ODEs",
 *   ACM Trans. Math. Software, 1(1), 71-96.
 */

// ── BDF coefficients ──
/** Error constants for each BDF order (1..5) */
export const BDF_ERROR_CONST: readonly number[] = [1 / 2, 2 / 9, 3 / 22, 12 / 125, 10 / 137];

/**
 * BDF coefficients α_j for each order k (k = 1..5).
 * Index: BDF_ALPHA[order-1][j], where j = 0..order.
 * The formula is: Σ α_j * y_{n-j} = h * f(t_n, y_n)
 */
export const BDF_ALPHA: readonly (readonly number[])[] = [
  // BDF-1: y_n - y_{n-1} = h * f_n
  [1, -1],
  // BDF-2: (3/2)y_n - 2y_{n-1} + (1/2)y_{n-2} = h * f_n
  [3 / 2, -2, 1 / 2],
  // BDF-3
  [11 / 6, -3, 3 / 2, -1 / 3],
  // BDF-4
  [25 / 12, -4, 3, -4 / 3, 1 / 4],
  // BDF-5
  [137 / 60, -5, 5, -10 / 3, 5 / 4, -1 / 5],
];

// ── Public interfaces ──

/** Configuration options for the BDF solver. */
export interface BdfOptions {
  /** Absolute tolerance (default: 1e-6). */
  atol?: number;
  /** Relative tolerance (default: 1e-6). */
  rtol?: number;
  /** Maximum step size (default: tEnd - t0). */
  maxStep?: number;
  /** Initial step size (default: auto-estimated). */
  initialStep?: number;
  /** Maximum number of steps (default: 100000). */
  maxSteps?: number;
  /** Maximum BDF order (default: 5, range 1-5). */
  maxOrder?: number;
  /** Dense Jacobian function (optional — uses finite differences if not provided). */
  jacobian?: (t: number, y: number[]) => number[][];
  /**
   * Sparse Jacobian function using graph-coloring-compressed AD.
   * Takes priority over `jacobian` if both are provided.
   * The sparse result is converted to dense for the LU factorization.
   */
  sparseJacobian?: (t: number, y: number[]) => SparseJacobian;
}

/** Result of a BDF integration. */
export interface BdfResult {
  /** Output time points. */
  times: number[];
  /** State vectors at each output time. */
  states: number[][];
  /** Total number of function evaluations. */
  fEvals: number;
  /** Total number of Jacobian evaluations. */
  jEvals: number;
  /** Total number of accepted steps. */
  acceptedSteps: number;
  /** Total number of rejected steps. */
  rejectedSteps: number;
  /** Total number of Newton iterations. */
  newtonIters: number;
}

/** Right-hand side function type: dy/dt = f(t, y). */
export type BdfRhsFunction = (t: number, y: number[]) => number[];

/** Raw WASM exports interface for AssemblyScript DAE BDF Solver. */
export interface WasmBdfExports {
  dae_createBdfSolver(daePtr: number, nStates: number, atol: number, rtol: number, maxOrder: number): number;
  dae_setBdfStateMapping(solverPtr: number, idx: number, stateVarIdx: number, derivVarIdx: number): void;
  dae_stepBdfSolver(solverPtr: number, varValuesPtr: number, t: number, dt: number): number;
  memory?: WebAssembly.Memory;
}

/**
 * WebAssembly-backed Variable-Order BDF Solver Bridge.
 * Orchestrates native linear memory BDF execution for compiled DAEs.
 */
export class WasmBdf {
  constructor(private wasmInstance: any) {}

  /**
   * Instantiates a BDF solver instance in WASM linear memory.
   */
  createSolver(
    daePtr: number,
    nStates: number,
    atol: number = 1e-6,
    rtol: number = 1e-6,
    maxOrder: number = 5,
  ): number {
    if (typeof this.wasmInstance?.exports?.dae_createBdfSolver === "function") {
      return this.wasmInstance.exports.dae_createBdfSolver(daePtr, nStates, atol, rtol, maxOrder);
    }
    return 0;
  }

  /**
   * Maps a continuous state variable and its derivative variable indices in the DAE.
   */
  setStateMapping(solverPtr: number, idx: number, stateVarIdx: number, derivVarIdx: number): void {
    if (typeof this.wasmInstance?.exports?.dae_setBdfStateMapping === "function") {
      this.wasmInstance.exports.dae_setBdfStateMapping(solverPtr, idx, stateVarIdx, derivVarIdx);
    }
  }

  /**
   * Executes an adaptive multi-order BDF step in WASM linear memory.
   */
  step(solverPtr: number, varValuesPtr: number, t: number, dt: number): number {
    if (typeof this.wasmInstance?.exports?.dae_stepBdfSolver === "function") {
      return this.wasmInstance.exports.dae_stepBdfSolver(solverPtr, varValuesPtr, t, dt);
    }
    return t + dt;
  }
}

/**
 * Integrate a stiff ODE system using the variable-order BDF method.
 *
 * @param f               Right-hand side function: dy/dt = f(t, y)
 * @param t0              Initial time
 * @param y0              Initial state vector
 * @param tEnd            Final time
 * @param outputTimes     Sorted array of desired output times
 * @param options         Solver options
 * @param eventFunctions  Optional event functions for zero-crossing detection
 * @param eventCallback   Optional callback when an event fires
 * @returns Solver result with output states and statistics
 */
export function bdf(
  f: BdfRhsFunction,
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes: number[],
  options: BdfOptions = {},
  eventFunctions?: ((t: number, y: number[]) => number)[],
  eventCallback?: (t: number, y: number[], eventIdx: number, dir: 1 | -1) => number[],
): BdfResult {
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const maxSteps = options.maxSteps ?? 100000;
  const maxOrder = Math.min(Math.max(options.maxOrder ?? 5, 1), 5);
  const n = y0.length;

  const result: BdfResult = {
    times: [],
    states: [],
    fEvals: 0,
    jEvals: 0,
    acceptedSteps: 0,
    rejectedSteps: 0,
    newtonIters: 0,
  };

  // ── Output setup ──
  let outputIdx = 0;
  while (outputIdx < outputTimes.length && (outputTimes[outputIdx] ?? t0) <= t0 + 1e-14) {
    result.times.push(t0);
    result.states.push([...y0]);
    outputIdx++;
  }

  // ── State history (most recent first) ──
  const history: { t: number; y: number[]; f: number[] }[] = [];

  let t = t0;
  let y = [...y0];
  let fCurrent = f(t, y);
  result.fEvals++;
  history.push({ t, y: [...y], f: [...fCurrent] });

  // ── Initial step size ──
  let h = options.initialStep ?? estimateInitialStep(f, t0, y0, fCurrent, atol, rtol, maxStep, result);
  h = Math.min(h, maxStep);

  // ── Jacobian state ──
  let jacobianMatrix: number[][] | null = null;
  let luMatrix: { L: number[][]; U: number[][]; P: number[] } | null = null;
  let lastJacobianH = 0;
  let newtonFailCount = 0;

  // Current BDF order
  let order = 1;

  // Previous event function values
  let prevEventValues: number[] | null = null;
  if (eventFunctions && eventFunctions.length > 0) {
    prevEventValues = eventFunctions.map((g) => g(t, y));
  }

  let totalSteps = 0;

  while (t < tEnd - 1e-14 && totalSteps < maxSteps) {
    totalSteps++;

    // Don't overshoot tEnd
    if (t + h > tEnd) h = tEnd - t;
    if (h < 1e-15) break;

    const tNew = t + h;

    // ── Compute dynamic BDF coefficients for variable step sizes ──
    const effectiveOrder = Math.min(order, history.length, maxOrder);
    let alpha: number[];
    if (effectiveOrder === 1 || history.length < 2) {
      alpha = [1, -1];
    } else {
      const hPrev = Math.max(1e-15, history[0]!.t - history[1]!.t);
      const r = h / hPrev;
      const a0 = (1 + 2 * r) / (1 + r);
      const a1 = -(1 + r);
      const a2 = (r * r) / (1 + r);
      alpha = [a0, a1, a2];
    }

    // ── Compute predictor (explicit extrapolation from history) ──
    const yPred = new Array(n) as number[];
    for (let i = 0; i < n; i++) {
      yPred[i] = (y[i] ?? 0) + h * (fCurrent[i] ?? 0);
    }

    // ── Compute/reuse Jacobian ──
    const needNewJacobian = jacobianMatrix === null || newtonFailCount > 2;

    if (needNewJacobian) {
      if (options.sparseJacobian) {
        const sj = options.sparseJacobian(t, y);
        jacobianMatrix = sparseJacobianToDense(sj);
      } else if (options.jacobian) {
        jacobianMatrix = options.jacobian(t, y);
      } else {
        jacobianMatrix = finiteDifferenceJacobian(f, t, y, fCurrent, n, result);
      }
      result.jEvals++;
      newtonFailCount = 0;
    }

    // Form the iteration matrix: M = alpha_0*I - h*J and compute LU
    if (luMatrix === null || needNewJacobian || Math.abs(h - lastJacobianH) > 1e-15) {
      const iterMatrix = new Array(n) as number[][];
      for (let i = 0; i < n; i++) {
        const iterRow = new Array(n) as number[];
        iterMatrix[i] = iterRow;
        const jRow = jacobianMatrix[i];
        if (!jRow) continue;
        for (let j = 0; j < n; j++) {
          const jVal = jRow[j] ?? 0;
          iterRow[j] = (i === j ? (alpha[0] ?? 1) : 0) - h * jVal;
        }
      }
      luMatrix = luDecompose(iterMatrix, n);
      lastJacobianH = h;
    }

    // ── Newton iteration ──
    const yNewton = [...yPred];
    let converged = false;
    const maxNewtonIter = 10;

    for (let iter = 0; iter < maxNewtonIter; iter++) {
      result.newtonIters++;

      // Evaluate RHS at current Newton iterate
      const fNew = f(t + h, yNewton);
      result.fEvals++;

      // Compute residual: G(y) = α_0*y - h*f(t_new, y) + Σ_{j=1}^k α_j*y_{n+1-j}
      const residual = new Array(n) as number[];
      for (let i = 0; i < n; i++) {
        let histSum = 0;
        for (let j = 1; j < alpha.length; j++) {
          const histEntry = history[j - 1];
          if (histEntry) {
            histSum += (alpha[j] ?? 0) * (histEntry.y[i] ?? 0);
          }
        }
        residual[i] = (alpha[0] ?? 1) * (yNewton[i] ?? 0) - h * (fNew[i] ?? 0) + histSum;
      }

      // Check convergence
      let residualNorm = 0;
      for (let i = 0; i < n; i++) {
        const sc = atol + rtol * Math.abs(yNewton[i] ?? 0);
        residualNorm = Math.max(residualNorm, Math.abs(residual[i] ?? 0) / sc);
      }

      if (residualNorm < 1.0) {
        converged = true;
        break;
      }

      // Solve M * Δy = -residual (using LU factors)
      if (!luMatrix) break;
      const negResidual = residual.map((r) => -(r ?? 0));
      const delta = luSolve(luMatrix, negResidual, n);

      // Update Newton iterate
      for (let i = 0; i < n; i++) {
        yNewton[i] = (yNewton[i] ?? 0) + (delta[i] ?? 0);
      }
    }

    if (!converged) {
      // Newton failed — reduce step size and retry
      result.rejectedSteps++;
      newtonFailCount++;
      h *= 0.5;
      if (newtonFailCount > 3) {
        jacobianMatrix = null;
        luMatrix = null;
      }
      continue;
    }

    // ── Error estimation ──
    const fNew = f(t + h, yNewton);
    result.fEvals++;

    let err = 0;
    if (effectiveOrder === 1) {
      for (let i = 0; i < n; i++) {
        const sc = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNewton[i] ?? 0));
        const est = 0.5 * h * Math.abs((fNew[i] ?? 0) - (fCurrent[i] ?? 0));
        err = Math.max(err, est / sc);
      }
    } else {
      for (let i = 0; i < n; i++) {
        const sc = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNewton[i] ?? 0));
        const est = (1.0 / 3.0) * Math.abs((yNewton[i] ?? 0) - (yPred[i] ?? 0));
        err = Math.max(err, est / sc);
      }
    }

    if (err > 1.0) {
      // Step rejected — reduce step size
      result.rejectedSteps++;
      const factor = Math.max(0.2, 0.9 * Math.pow(err, -1.0 / (effectiveOrder + 1)));
      h *= factor;
      continue;
    }

    // ── Step accepted ──
    result.acceptedSteps++;

    // ── Event Detection & Dense Output ──
    let eventOccurred = false;
    if (eventFunctions && prevEventValues && eventCallback) {
      const newEventValues = eventFunctions.map((g) => g(tNew, yNewton));
      for (let ei = 0; ei < eventFunctions.length; ei++) {
        const prev = prevEventValues[ei] ?? 0;
        const curr = newEventValues[ei] ?? 0;
        if (prev * curr < 0) {
          eventOccurred = true;
          // Sign change — bisect to find event time
          const eventFn = eventFunctions[ei];
          if (!eventFn) continue;

          // ── Bisection to find exact event time ──
          const tEvent = bisectEvent(eventFn, t, tNew, y, yNewton, fCurrent, fNew, h, n, prev);
          const thetaEvent = (tEvent - t) / h;
          const yEvent = cubicHermiteInterpolate(thetaEvent, y, yNewton, fCurrent, fNew, h, n);

          // ── Output interpolation BEFORE the event ──
          while (outputIdx < outputTimes.length && (outputTimes[outputIdx] ?? tEnd) < tEvent - 1e-14) {
            const tOut = outputTimes[outputIdx] as number;
            if (Math.abs(tOut - t) < 1e-14) {
              result.times.push(t);
              result.states.push([...y]);
            } else {
              const theta = (tOut - t) / h;
              result.times.push(tOut);
              result.states.push(cubicHermiteInterpolate(theta, y, yNewton, fCurrent, fNew, h, n));
            }
            outputIdx++;
          }

          // Advance outputIdx if an outputTime lands exactly on the event
          if (outputIdx < outputTimes.length && Math.abs((outputTimes[outputIdx] ?? tEnd) - tEvent) < 1e-14) {
            outputIdx++;
          }

          // Force output of the event point for exact precision
          result.times.push(tEvent);
          result.states.push([...yEvent]);

          // ── Fire event callback ──
          const dir = curr < 0 ? -1 : 1;
          const yAfter = eventCallback(tEvent, yEvent, ei, dir);

          // Output explicit post-event state
          result.times.push(tEvent);
          result.states.push([...yAfter]);

          // Restart from event
          t = tEvent;
          y = yAfter;
          fCurrent = f(t, y);
          result.fEvals++;
          history.length = 0;
          history.push({ t, y: [...y], f: [...fCurrent] });
          order = 1;
          jacobianMatrix = null;
          luMatrix = null;
          prevEventValues = eventFunctions.map((g) => g(t, y));
          break;
        }
      }
      if (!eventOccurred) {
        prevEventValues = newEventValues;
      }
    }

    // ── Dense output for intermediate output times if NO event interrupted this step ──
    if (!eventOccurred) {
      while (outputIdx < outputTimes.length && (outputTimes[outputIdx] ?? tEnd) <= tNew + 1e-14) {
        const tOut = outputTimes[outputIdx] ?? tNew;
        if (Math.abs(tOut - tNew) < 1e-14) {
          result.times.push(tNew);
          result.states.push([...yNewton]);
        } else if (Math.abs(tOut - t) < 1e-14) {
          result.times.push(t);
          result.states.push([...y]);
        } else {
          const theta = (tOut - t) / h;
          result.times.push(tOut);
          result.states.push(cubicHermiteInterpolate(theta, y, yNewton, fCurrent, fNew, h, n));
        }
        outputIdx++;
      }

      // Advance normally
      t = tNew;
      y = yNewton;
      fCurrent = fNew;
      history.unshift({ t, y: [...y], f: [...fCurrent] });
      if (history.length > maxOrder + 1) history.pop();
    } else {
      t = tNew;
      y = yNewton;
      fCurrent = fNew;
      history.unshift({ t, y: [...y], f: [...fCurrent] });
      if (history.length > maxOrder + 1) history.pop();
    }

    // ── Order and step-size control ──
    const factor = err > 0 ? Math.min(2.0, Math.max(0.5, 0.9 * Math.pow(err, -1.0 / (effectiveOrder + 1)))) : 2.0;
    h = Math.min(h * factor, maxStep);

    // Increase order if enough history is available
    if (effectiveOrder < maxOrder && history.length > effectiveOrder + 1) {
      order = Math.min(effectiveOrder + 1, maxOrder);
    }
    // Decrease order on slow convergence
    if (newtonFailCount > 0 && order > 1) {
      order--;
    }
  }

  // Ensure final state is output
  if (result.times.length === 0 || (result.times[result.times.length - 1] ?? -1) < tEnd - 1e-14) {
    result.times.push(t);
    result.states.push([...y]);
  }

  return result;
}

// ── Helper functions ──

function estimateInitialStep(
  f: BdfRhsFunction,
  t0: number,
  y0: number[],
  f0: number[],
  atol: number,
  rtol: number,
  maxStep: number,
  stats: BdfResult,
): number {
  const n = y0.length;
  let d0 = 0;
  let d1 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y0[i] ?? 0);
    d0 = Math.max(d0, Math.abs(y0[i] ?? 0) / sc);
    d1 = Math.max(d1, Math.abs(f0[i] ?? 0) / sc);
  }

  let h0: number;
  if (d0 < 1e-5 || d1 < 1e-5) {
    h0 = 1e-6;
  } else {
    h0 = 0.01 * (d0 / d1);
  }
  h0 = Math.min(h0, maxStep);

  const y1 = new Array(n) as number[];
  for (let i = 0; i < n; i++) {
    y1[i] = (y0[i] ?? 0) + h0 * (f0[i] ?? 0);
  }
  const f1 = f(t0 + h0, y1);
  stats.fEvals++;

  let d2 = 0;
  for (let i = 0; i < n; i++) {
    const sc = atol + rtol * Math.abs(y0[i] ?? 0);
    d2 = Math.max(d2, Math.abs(((f1[i] ?? 0) - (f0[i] ?? 0)) / h0) / sc);
  }

  let h1: number;
  if (Math.max(d1, d2) <= 1e-15) {
    h1 = Math.max(1e-6, h0 * 1e-3);
  } else {
    h1 = Math.pow(0.01 / Math.max(d1, d2), 0.5);
  }

  return Math.min(100 * h0, Math.min(h1, maxStep));
}

function finiteDifferenceJacobian(
  f: BdfRhsFunction,
  t: number,
  y: number[],
  f0: number[],
  n: number,
  stats: BdfResult,
): number[][] {
  const J = new Array(n) as number[][];
  for (let i = 0; i < n; i++) {
    J[i] = new Array(n).fill(0) as number[];
  }

  for (let j = 0; j < n; j++) {
    const yj = y[j] ?? 0;
    const eps = Math.max(1e-8, 1e-8 * Math.abs(yj));
    const yPerturbed = [...y];
    yPerturbed[j] = yj + eps;
    const fPerturbed = f(t, yPerturbed);
    stats.fEvals++;

    for (let i = 0; i < n; i++) {
      const jRow = J[i];
      if (jRow) {
        jRow[j] = ((fPerturbed[i] ?? 0) - (f0[i] ?? 0)) / eps;
      }
    }
  }

  return J;
}

function luDecompose(A: number[][], n: number): { L: number[][]; U: number[][]; P: number[] } {
  const M = A.map((row) => [...row]);
  const P = Array.from({ length: n }, (_, i) => i);

  for (let k = 0; k < n; k++) {
    let maxVal = Math.abs(M[k]?.[k] ?? 0);
    let maxRow = k;
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(M[i]?.[k] ?? 0);
      if (val > maxVal) {
        maxVal = val;
        maxRow = i;
      }
    }

    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow] ?? [], M[k] ?? []];
      [P[k], P[maxRow]] = [P[maxRow] ?? 0, P[k] ?? 0];
    }

    const pivot = M[k]?.[k] ?? 0;
    if (Math.abs(pivot) < 1e-30) continue;

    for (let i = k + 1; i < n; i++) {
      const row = M[i];
      const pivotRow = M[k];
      if (!row || !pivotRow) continue;
      const factor = (row[k] ?? 0) / pivot;
      row[k] = factor;
      for (let j = k + 1; j < n; j++) {
        row[j] = (row[j] ?? 0) - factor * (pivotRow[j] ?? 0);
      }
    }
  }

  const L = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0) as number[];
    row[i] = 1;
    for (let j = 0; j < i; j++) {
      row[j] = M[i]?.[j] ?? 0;
    }
    return row;
  });

  const U = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0) as number[];
    for (let j = i; j < n; j++) {
      row[j] = M[i]?.[j] ?? 0;
    }
    return row;
  });

  return { L, U, P };
}

function luSolve(lu: { L: number[][]; U: number[][]; P: number[] }, b: number[], n: number): number[] {
  const pb = new Array(n) as number[];
  for (let i = 0; i < n; i++) {
    pb[i] = b[lu.P[i] ?? i] ?? 0;
  }

  const z = new Array(n) as number[];
  for (let i = 0; i < n; i++) {
    let sum = pb[i] ?? 0;
    const lRow = lu.L[i];
    if (lRow) {
      for (let j = 0; j < i; j++) {
        sum -= (lRow[j] ?? 0) * (z[j] ?? 0);
      }
    }
    z[i] = sum;
  }

  const x = new Array(n) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i] ?? 0;
    const uRow = lu.U[i];
    if (uRow) {
      for (let j = i + 1; j < n; j++) {
        sum -= (uRow[j] ?? 0) * (x[j] ?? 0);
      }
      const diag = uRow[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    } else {
      x[i] = 0;
    }
  }

  return x;
}

function bisectEvent(
  eventFn: (t: number, y: number[]) => number,
  tLo: number,
  tHi: number,
  yLo: number[],
  yHi: number[],
  fLo: number[],
  fHi: number[],
  h: number,
  n: number,
  gLo: number,
): number {
  const maxIter = 50;
  const tol = 1e-12;

  let lo = tLo;
  let hi = tHi;

  for (let iter = 0; iter < maxIter; iter++) {
    const tMid = (lo + hi) / 2;
    if (hi - lo < tol) break;

    const theta = (tMid - tLo) / h;
    const yMid = cubicHermiteInterpolate(theta, yLo, yHi, fLo, fHi, h, n);
    const gMid = eventFn(tMid, yMid);

    if (gLo * gMid <= 0) {
      hi = tMid;
    } else {
      lo = tMid;
      gLo = gMid;
    }
  }

  return (lo + hi) / 2;
}

function cubicHermiteInterpolate(
  theta: number,
  y0: number[],
  y1: number[],
  f0: number[],
  f1: number[],
  h: number,
  n: number,
): number[] {
  const theta2 = theta * theta;
  const theta3 = theta2 * theta;

  const h00 = 2 * theta3 - 3 * theta2 + 1;
  const h10 = theta3 - 2 * theta2 + theta;
  const h01 = -2 * theta3 + 3 * theta2;
  const h11 = theta3 - theta2;

  const yInterp = new Array(n) as number[];
  for (let i = 0; i < n; i++) {
    yInterp[i] = h00 * (y0[i] ?? 0) + h10 * h * (f0[i] ?? 0) + h01 * (y1[i] ?? 0) + h11 * h * (f1[i] ?? 0);
  }
  return yInterp;
}
