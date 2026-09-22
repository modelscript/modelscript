// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * TR-BDF2: Composite Trapezoidal - Backward Differentiation Formula 2.
 *
 * An L-stable, one-step, 2nd-order implicit Singly Diagonally Implicit Runge-Kutta
 * (SDIRK) method designed specifically for stiff and differential-algebraic equations.
 *
 * Characteristics:
 *   - L-stable: Damps out stiff high-frequency numerical oscillations that plague Trapezoidal/Crank-Nicolson.
 *   - Identical diagonal coefficient d = 1 - 1/√2 on both stages:
 *     Only a SINGLE LU factorization of (I - d*h*J) is computed and reused for both stage solves!
 *   - One-step composite: Resets cleanly on events without multistep order-reduction penalties.
 *
 * Reference:
 *   Bank, R.E., Coughran, W.M., Fichtner, W., Grosse, E.H., Rose, D.J., Smith, R.K. (1985),
 *   "Transient simulation of silicon devices and circuits", IEEE Trans. CAD, 4(4), 436-446.
 */

import type { CommonSolverResult, DAEProblem, ODEProblem, SolverStats } from "../core/problem-types.js";
import { factorizeLinearMatrix } from "./sparse-solver-bridge.js";

export const TRBDF2_GAMMA = 2.0 - Math.SQRT2; // ≈ 0.585786437626905
export const TRBDF2_D = TRBDF2_GAMMA / 2.0; // = 1 - 1/√2 ≈ 0.2928932188134524

export interface TrBdf2Options {
  atol?: number;
  rtol?: number;
  initialStep?: number;
  maxStep?: number;
  minStep?: number;
  maxSteps?: number;
  maxNewtonIters?: number;
  linearSolver?: "auto" | "dense" | "sparse";
}

export interface TrBdf2Result extends CommonSolverResult {
  stats: SolverStats;
}

/**
 * Compute numerical finite-difference Jacobian if analytical is not provided.
 */
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
 * Integrate a stiff ODE/DAE using the TR-BDF2 method.
 */
export function trbdf2(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes?: number[],
  options: TrBdf2Options = {},
  massMatrix?: number[][],
): TrBdf2Result {
  const atol = options.atol ?? 1e-6;
  const rtol = options.rtol ?? 1e-6;
  const maxStep = options.maxStep ?? Math.abs(tEnd - t0);
  const minStep = options.minStep ?? 1e-15;
  const maxSteps = options.maxSteps ?? 100000;
  const maxNewtonIters = options.maxNewtonIters ?? 15;
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

  const gamma = TRBDF2_GAMMA;
  const d = TRBDF2_D;
  const w = Math.SQRT2 / 4.0; // weighting for error estimation

  const delta = new Float64Array(n);

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

    // LU factorize W (sparse or dense according to dimension/option)
    const solver = factorizeLinearMatrix(W, n, { linearSolver: options.linearSolver });
    stats.luFactorizations!++;

    // ── Stage 1: Trapezoidal rule at t + gamma * h ──
    // y_gamma - y0 = (gamma * h / 2) * (f(t, y0) + f(t + gamma*h, y_gamma))
    const tGamma = t + gamma * h;
    let yGamma = [...y]; // initial guess

    let stage1Converged = false;
    for (let iter = 0; iter < maxNewtonIters; iter++) {
      const fGamma = f(tGamma, yGamma);
      stats.fEvals++;

      // Residual R1 = (M * (yGamma - y0)) - (gamma * h / 2) * (f0 + fGamma)
      for (let i = 0; i < n; i++) {
        let My = 0;
        for (let j = 0; j < n; j++) {
          const mij = massMatrix ? (massMatrix[i]?.[j] ?? 0) : i === j ? 1.0 : 0.0;
          My += mij * ((yGamma[j] ?? 0) - (y[j] ?? 0));
        }
        delta[i] = -(My - d * h * ((f0[i] ?? 0) + (fGamma[i] ?? 0)));
      }

      solver.solve(delta);

      let maxDelta = 0;
      for (let i = 0; i < n; i++) {
        const di = delta[i] ?? 0;
        yGamma[i] = (yGamma[i] ?? 0) + di;
        const tol = atol + rtol * Math.abs(yGamma[i] ?? 0);
        maxDelta = Math.max(maxDelta, Math.abs(di) / tol);
      }

      if (maxDelta < 1.0) {
        stage1Converged = true;
        break;
      }
    }

    if (!stage1Converged) {
      // Newton failed, shrink step
      stats.rejectedSteps++;
      h = Math.max(minStep, h * 0.5);
      continue;
    }

    // ── Stage 2: BDF-2 at t + h ──
    // y_new - (1 / (gamma*(2-gamma))) * yGamma + ((1-gamma)^2 / (gamma*(2-gamma))) * y0 = d * h * f(t+h, y_new)
    const tNew = t + h;
    const cGamma = 1.0 / (gamma * (2.0 - gamma));
    const c0 = Math.pow(1.0 - gamma, 2) / (gamma * (2.0 - gamma));

    let yNew = [...yGamma]; // initial guess from stage 1

    let stage2Converged = false;
    for (let iter = 0; iter < maxNewtonIters; iter++) {
      const fNew = f(tNew, yNew);
      stats.fEvals++;

      // Residual R2 = M * (yNew - cGamma * yGamma + c0 * y0) - d * h * fNew
      for (let i = 0; i < n; i++) {
        let My = 0;
        for (let j = 0; j < n; j++) {
          const mij = massMatrix ? (massMatrix[i]?.[j] ?? 0) : i === j ? 1.0 : 0.0;
          My += mij * ((yNew[j] ?? 0) - cGamma * (yGamma[j] ?? 0) + c0 * (y[j] ?? 0));
        }
        delta[i] = -(My - d * h * (fNew[i] ?? 0));
      }

      solver.solve(delta);

      let maxDelta = 0;
      for (let i = 0; i < n; i++) {
        const di = delta[i] ?? 0;
        yNew[i] = (yNew[i] ?? 0) + di;
        const tol = atol + rtol * Math.abs(yNew[i] ?? 0);
        maxDelta = Math.max(maxDelta, Math.abs(di) / tol);
      }

      if (maxDelta < 1.0) {
        stage2Converged = true;
        break;
      }
    }

    if (!stage2Converged) {
      stats.rejectedSteps++;
      h = Math.max(minStep, h * 0.5);
      continue;
    }

    // ── Local Error Estimation ──
    // Error est = 2 * w * (d * f0 - (1/gamma)*fGamma + (1/(2-gamma))*fNew) * h
    const fGammaFinal = f(tGamma, yGamma);
    const fNewFinal = f(tNew, yNew);
    stats.fEvals += 2;

    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      const err_i =
        2.0 *
        w *
        h *
        Math.abs(
          d * (f0[i] ?? 0) - (1.0 / gamma) * (fGammaFinal[i] ?? 0) + (1.0 / (2.0 - gamma)) * (fNewFinal[i] ?? 0),
        );
      const tol = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
      maxErrorRatio = Math.max(maxErrorRatio, err_i / tol);
    }

    if (maxErrorRatio <= 1.0 || h <= minStep * 2) {
      // Step accepted
      stats.acceptedSteps++;

      // Output recording
      if (denseOutputs && outputTimes) {
        while (outIdx < outputTimes.length) {
          const tTarget = outputTimes[outIdx]!;
          if ((tEnd > t0 && tTarget <= tNew) || (tEnd < t0 && tTarget >= tNew)) {
            // Linear/Quadratic interpolation between y, yGamma, and yNew
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
        resultTimes.push(tNew);
        resultStates.push([...yNew]);
      }

      t = tNew;
      y = [...yNew];

      // Step adaptation for 2nd-order method (factor ~ (1/err)^(1/3))
      const factor = Math.min(4.0, Math.max(0.2, 0.9 * Math.pow(Math.max(maxErrorRatio, 1e-6), -1.0 / 3.0)));
      h = Math.min(maxStep, Math.max(minStep, h * factor));
    } else {
      // Step rejected based on truncation error
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
 * Solve a DAEProblem or ODEProblem using TR-BDF2.
 */
export function solveTrBdf2(problem: DAEProblem | ODEProblem, options: TrBdf2Options = {}): TrBdf2Result {
  const [t0, tEnd] = problem.tSpan;
  const f = (t: number, y: number[]) => {
    if ("massMatrix" in problem && problem.massMatrix) {
      return problem.f(t, y, undefined, problem.p as any);
    }
    return problem.f(t, y, problem.p as any);
  };
  const massMatrix = "massMatrix" in problem ? problem.massMatrix : undefined;
  return trbdf2(f, t0, problem.y0, tEnd, undefined, options, massMatrix);
}
