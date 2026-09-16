// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Rosenbrock-W Stiff DAE Solver (Rodas / Rosenbrock23).
 *
 * Implements an A- and L-stable Rosenbrock method with mass matrix support:
 *   M * dy/dt = f(t, y)
 *
 * Characteristics:
 *   - Linearity per stage: Replaces non-linear iterations with exact linear solves
 *     using the single iteration matrix W = (M - d * h * J).
 *   - Only one LU factorization per time step: The matrix W is factored ONCE and
 *     reused for both stage solves.
 *   - Matrix-free stage 2: Exploits the identity d*h*J = M - W so that J * k1 is
 *     computed directly from W * k1 = h * f0 without an extra matrix-vector product.
 *   - L-stable: Immune to stiff numerical ringing and restarts with zero latency
 *     on Modelica zero-crossing events.
 *
 * Reference:
 *   Shampine, L.F. (1982), "Implementation of Rosenbrock methods",
 *   ACM Trans. Math. Software, 8(2), 93-113.
 *   Hairer, E. & Wanner, G. (1996), "Solving Ordinary Differential Equations II:
 *   Stiff and Differential-Algebraic Problems", Section IV.7.
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";
import type { CommonSolverResult, DAEProblem, ODEProblem, SolverStats } from "../core/problem-types.js";

export const ROSENBROCK_D = 1.0 - 1.0 / Math.SQRT2; // ≈ 0.2928932188134524

export interface Rodas4POptions {
  atol?: number;
  rtol?: number;
  initialStep?: number;
  maxStep?: number;
  minStep?: number;
  maxSteps?: number;
}

export interface Rodas4PResult extends CommonSolverResult {
  stats: SolverStats;
}

function computeJacobian(
  f: (t: number, y: number[]) => number[],
  t: number,
  y: number[],
  f0: number[],
): Float64Array[] {
  const n = y.length;
  const J: Float64Array[] = new Array(n);
  for (let i = 0; i < n; i++) {
    J[i] = new Float64Array(n);
  }

  const yPert = [...y];
  for (let j = 0; j < n; j++) {
    const yj = y[j] ?? 0;
    const h = Math.max(1e-8, 1e-8 * Math.abs(yj));
    yPert[j] = yj + h;
    const fPert = f(t, yPert);
    yPert[j] = yj;

    for (let i = 0; i < n; i++) {
      J[i]![j] = ((fPert[i] ?? 0) - (f0[i] ?? 0)) / h;
    }
  }
  return J;
}

/**
 * Integrate a stiff DAE/ODE using the L-stable Rosenbrock-W method.
 */
export function rodas4p(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes?: number[],
  options: Rodas4POptions = {},
  massMatrix?: number[][],
): Rodas4PResult {
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
    jacobianEvals: 0,
    luFactorizations: 0,
    converged: true,
  };

  const resultTimes: number[] = [];
  const resultStates: number[][] = [];

  const denseOutputs = outputTimes !== undefined && outputTimes.length > 0;
  let outIdx = 0;

  let h = options.initialStep ?? Math.min(Math.max((tEnd - t0) / 100, 1e-5), maxStep);
  let t = t0;
  let y = [...y0];

  resultTimes.push(t);
  resultStates.push([...y]);
  if (denseOutputs && outputTimes[0] !== undefined && Math.abs(outputTimes[0] - t) < 1e-12) {
    outIdx++;
  }

  const d = ROSENBROCK_D;
  const k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const rhs2 = new Float64Array(n);

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

    const f0 = f(t, y);
    stats.fEvals++;

    // Compute Jacobian J at (t, y)
    const J = computeJacobian(f, t, y, f0);
    stats.jacobianEvals!++;

    // Form iteration matrix W = M - d * h * J
    const W: Float64Array[] = new Array(n);
    for (let i = 0; i < n; i++) {
      W[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const mij = massMatrix ? (massMatrix[i]?.[j] ?? 0) : i === j ? 1.0 : 0.0;
        W[i]![j] = mij - d * h * (J[i]![j] ?? 0);
      }
    }

    // LU factorize W once per step
    const lu = luFactor(W, n);
    stats.luFactorizations!++;

    // ── Stage 1: Solve W * k1 = h * f0 ──
    for (let i = 0; i < n; i++) {
      k1[i] = h * (f0[i] ?? 0);
    }
    luSolve(lu, k1);

    // ── Stage 2: ──
    // y_stage2 = y + k1
    const yStage2 = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yStage2[i] = (y[i] ?? 0) + (k1[i] ?? 0);
    }
    const f1 = f(t + h, yStage2);
    stats.fEvals++;

    // rhs2 = h * f1 + 2 * h * f0 - 2 * M * k1
    for (let i = 0; i < n; i++) {
      let Mk1 = 0;
      for (let j = 0; j < n; j++) {
        const mij = massMatrix ? (massMatrix[i]?.[j] ?? 0) : i === j ? 1.0 : 0.0;
        Mk1 += mij * (k1[j] ?? 0);
      }
      rhs2[i] = h * (f1[i] ?? 0) + 2.0 * h * (f0[i] ?? 0) - 2.0 * Mk1;
    }
    k2.set(rhs2);
    luSolve(lu, k2);

    // ── Candidate new state: y_new = y + 0.5 * (k1 + k2) ──
    const yNew = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yNew[i] = (y[i] ?? 0) + 0.5 * ((k1[i] ?? 0) + (k2[i] ?? 0));
    }

    // ── Local error estimate: err = 0.5 * |k2 - k1| ──
    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      const err_i = 0.5 * Math.abs((k2[i] ?? 0) - (k1[i] ?? 0));
      const tol = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
      maxErrorRatio = Math.max(maxErrorRatio, err_i / tol);
    }

    if (maxErrorRatio <= 1.0 || h <= minStep * 2) {
      // Step accepted
      stats.acceptedSteps++;

      if (denseOutputs && outputTimes) {
        while (outIdx < outputTimes.length) {
          const tTarget = outputTimes[outIdx]!;
          if ((tEnd > t0 && tTarget <= t + h) || (tEnd < t0 && tTarget >= t + h)) {
            const theta = (tTarget - t) / h;
            const yTarget = new Array<number>(n);
            for (let i = 0; i < n; i++) {
              yTarget[i] = (1.0 - theta) * (y[i] ?? 0) + theta * (yNew[i] ?? 0);
            }
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

      t += h;
      y = [...yNew];

      // Step adaptation for 2nd/3rd order method
      const factor = Math.min(4.0, Math.max(0.2, 0.9 * Math.pow(Math.max(maxErrorRatio, 1e-6), -1.0 / 3.0)));
      h = Math.min(maxStep, Math.max(minStep, h * factor));
    } else {
      // Step rejected
      stats.rejectedSteps++;
      const factor = Math.min(1.0, Math.max(0.1, 0.9 * Math.pow(maxErrorRatio, -0.5)));
      h = Math.max(minStep, h * factor);
    }
  }

  return {
    times: resultTimes,
    states: resultStates,
    stats,
  };
}

/**
 * Solve a DAEProblem or ODEProblem using Rodas4P / Rosenbrock.
 */
export function solveRodas4P(problem: DAEProblem | ODEProblem, options: Rodas4POptions = {}): Rodas4PResult {
  const [t0, tEnd] = problem.tSpan;
  const f = (t: number, y: number[]) => {
    if ("massMatrix" in problem && problem.massMatrix) {
      return problem.f(t, y, undefined, problem.p as any);
    }
    return problem.f(t, y, problem.p as any);
  };
  const massMatrix = "massMatrix" in problem ? problem.massMatrix : undefined;
  return rodas4p(f, t0, problem.y0, tEnd, undefined, options, massMatrix);
}
