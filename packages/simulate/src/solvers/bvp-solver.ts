// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Boundary Value Problem (BVP) Solvers.
 *
 * Solves two-point and multi-point ODE boundary value problems:
 *   dy/dt = f(t, y, p),   t in [t0, tEnd]
 *   subject to boundary condition residual: g(y(t0), y(tEnd), p) = 0
 *
 * Implementations:
 *   1. Direct Collocation (Legendre-Gauss-Radau / Trapezoidal):
 *      Converts the ODE into a sparse/dense nonlinear algebraic system R(Y) = 0
 *      and solves with damped Newton-Raphson.
 *   2. Multiple Shooting:
 *      Partitions [t0, tEnd] into M subintervals, integrates each segment with
 *      Tsit5, and solves for matching conditions and boundary constraints.
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";
import type { BVPOptions, BVPProblem, CommonSolverResult, SolverStats } from "../core/problem-types.js";
import { tsit5 } from "./tsit5.js";

export interface BvpResult extends CommonSolverResult {
  stats: SolverStats;
}

/**
 * Solve a BVP using multiple shooting.
 */
export function solveBvpShooting(problem: BVPProblem, options: BVPOptions = {}): BvpResult {
  const [t0, tEnd] = problem.tSpan;
  const n = Array.isArray(problem.yGuess) ? problem.yGuess.length : problem.yGuess(t0).length;

  const numIntervals = Math.max(2, options.numIntervals ?? 10);
  const tolerance = options.tolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 50;

  // Build grid of nodes t_0, t_1, ..., t_M
  const dt = (tEnd - t0) / numIntervals;
  const nodes: number[] = new Array(numIntervals + 1);
  for (let m = 0; m <= numIntervals; m++) {
    nodes[m] = t0 + m * dt;
  }

  // Unknown shooting state vector S of dimension (numIntervals * n)
  // S = [s_0, s_1, ..., s_{M-1}]
  const totalVars = numIntervals * n;
  let S = new Float64Array(totalVars);

  // Initialize S from yGuess
  for (let m = 0; m < numIntervals; m++) {
    const tm = nodes[m]!;
    const guess_m = typeof problem.yGuess === "function" ? problem.yGuess(tm) : problem.yGuess;
    for (let i = 0; i < n; i++) {
      S[m * n + i] = guess_m[i] ?? 0;
    }
  }

  const stats: SolverStats = {
    acceptedSteps: numIntervals,
    rejectedSteps: 0,
    fEvals: 0,
    luFactorizations: 0,
    converged: false,
  };

  /**
   * Residual function for shooting:
   *  - M - 1 continuity constraints: s_{m+1} - phi(t_{m+1}; t_m, s_m) = 0
   *  - 1 boundary constraint: bc(s_0, phi(t_M; t_{M-1}, s_{M-1})) = 0
   */
  const evaluateResidual = (sVec: Float64Array): { R: Float64Array; trajectories: number[][][] } => {
    const R = new Float64Array(totalVars);
    const trajs: number[][][] = [];

    // Integrate each interval m = 0..M-1
    const endStates: number[][] = [];
    for (let m = 0; m < numIntervals; m++) {
      const tm0 = nodes[m]!;
      const tm1 = nodes[m + 1]!;
      const yNode = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        yNode[i] = sVec[m * n + i] ?? 0;
      }

      const res = tsit5((t, y) => problem.f(t, y, problem.p), tm0, yNode, tm1, [tm0, tm1], {
        atol: tolerance * 0.1,
        rtol: tolerance * 0.1,
      });
      stats.fEvals += res.stats.fEvals;
      trajs.push(res.states);
      endStates.push(res.states[res.states.length - 1] ?? yNode);
    }

    // Continuity constraints for m = 0..M-2
    for (let m = 0; m < numIntervals - 1; m++) {
      const phi_m = endStates[m]!;
      for (let i = 0; i < n; i++) {
        const sNext_i = sVec[(m + 1) * n + i] ?? 0;
        R[m * n + i] = sNext_i - (phi_m[i] ?? 0);
      }
    }

    // Boundary constraint: bc(s_0, phi(tEnd)) = 0
    const s0 = new Array<number>(n);
    for (let i = 0; i < n; i++) s0[i] = sVec[i] ?? 0;
    const sEnd = endStates[numIntervals - 1]!;
    const bcRes = problem.bc(s0, sEnd, problem.p);

    for (let i = 0; i < n; i++) {
      R[(numIntervals - 1) * n + i] = bcRes[i] ?? 0;
    }

    return { R, trajectories: trajs };
  };

  // Damped Newton Iteration
  for (let iter = 0; iter < maxIterations; iter++) {
    const { R } = evaluateResidual(S);

    let maxRes = 0;
    for (let i = 0; i < totalVars; i++) {
      maxRes = Math.max(maxRes, Math.abs(R[i] ?? 0));
    }

    if (maxRes < tolerance) {
      stats.converged = true;
      break;
    }

    // Compute finite-difference Jacobian of R with respect to S
    const Jac: Float64Array[] = new Array(totalVars);
    for (let i = 0; i < totalVars; i++) {
      Jac[i] = new Float64Array(totalVars);
    }

    for (let j = 0; j < totalVars; j++) {
      const orig = S[j] ?? 0;
      const hPert = Math.max(1e-7, 1e-7 * Math.abs(orig));
      S[j] = orig + hPert;
      const { R: R_pert } = evaluateResidual(S);
      S[j] = orig;

      for (let i = 0; i < totalVars; i++) {
        Jac[i]![j] = ((R_pert[i] ?? 0) - (R[i] ?? 0)) / hPert;
      }
    }

    const lu = luFactor(Jac, totalVars);
    stats.luFactorizations!++;

    const delta = new Float64Array(totalVars);
    for (let i = 0; i < totalVars; i++) delta[i] = -(R[i] ?? 0);
    luSolve(lu, delta);

    // Line search / damping
    let damping = 1.0;
    let improved = false;
    for (let ls = 0; ls < 5; ls++) {
      const STry = new Float64Array(totalVars);
      for (let i = 0; i < totalVars; i++) {
        STry[i] = (S[i] ?? 0) + damping * (delta[i] ?? 0);
      }
      const { R: R_try } = evaluateResidual(STry);
      let tryRes = 0;
      for (let i = 0; i < totalVars; i++) tryRes = Math.max(tryRes, Math.abs(R_try[i] ?? 0));

      if (tryRes < maxRes || damping <= 0.125) {
        S = STry;
        improved = true;
        break;
      }
      damping *= 0.5;
    }

    if (!improved) {
      for (let i = 0; i < totalVars; i++) {
        S[i] = (S[i] ?? 0) + (delta[i] ?? 0);
      }
    }
  }

  // Construct final trajectory across all intervals
  const { trajectories } = evaluateResidual(S);
  const finalTimes: number[] = [];
  const finalStates: number[][] = [];

  for (let m = 0; m < numIntervals; m++) {
    const traj_m = trajectories[m]!;
    const t0_m = nodes[m]!;
    const t1_m = nodes[m + 1]!;
    // Add start
    if (m === 0) {
      finalTimes.push(t0_m);
      finalStates.push(traj_m[0] ?? []);
    }
    // Add end
    finalTimes.push(t1_m);
    finalStates.push(traj_m[traj_m.length - 1] ?? []);
  }

  return {
    times: finalTimes,
    states: finalStates,
    stats,
  };
}

/**
 * Solve a BVP using direct trapezoidal collocation.
 */
export function solveBvpCollocation(problem: BVPProblem, options: BVPOptions = {}): BvpResult {
  const [t0, tEnd] = problem.tSpan;
  const n = Array.isArray(problem.yGuess) ? problem.yGuess.length : problem.yGuess(t0).length;

  const N = Math.max(4, options.numIntervals ?? 20);
  const tolerance = options.tolerance ?? 1e-6;
  const maxIterations = options.maxIterations ?? 50;

  const dt = (tEnd - t0) / N;
  const tGrid = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) tGrid[k] = t0 + k * dt;

  // Unknown vector Y of dimension (N + 1) * n
  const totalVars = (N + 1) * n;
  let Y = new Float64Array(totalVars);

  // Initialize from yGuess
  for (let k = 0; k <= N; k++) {
    const tk = tGrid[k]!;
    const guess_k = typeof problem.yGuess === "function" ? problem.yGuess(tk) : problem.yGuess;
    for (let i = 0; i < n; i++) {
      Y[k * n + i] = guess_k[i] ?? 0;
    }
  }

  const stats: SolverStats = {
    acceptedSteps: N,
    rejectedSteps: 0,
    fEvals: 0,
    luFactorizations: 0,
    converged: false,
  };

  /**
   * Residual function:
   *  - For k = 0..N-1: Y_{k+1} - Y_k - 0.5 * dt * (f(t_k, Y_k) + f(t_{k+1}, Y_{k+1})) = 0  (N * n equations)
   *  - Boundary conditions: bc(Y_0, Y_N) = 0                                                 (n equations)
   */
  const computeResidual = (yVec: Float64Array): Float64Array => {
    const R = new Float64Array(totalVars);

    // Dynamics residuals
    for (let k = 0; k < N; k++) {
      const tk0 = tGrid[k]!;
      const tk1 = tGrid[k + 1]!;
      const yk0: number[] = new Array(n);
      const yk1: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        yk0[i] = yVec[k * n + i] ?? 0;
        yk1[i] = yVec[(k + 1) * n + i] ?? 0;
      }

      const fk0 = problem.f(tk0, yk0, problem.p);
      const fk1 = problem.f(tk1, yk1, problem.p);
      stats.fEvals += 2;

      for (let i = 0; i < n; i++) {
        R[k * n + i] = (yk1[i] ?? 0) - (yk0[i] ?? 0) - 0.5 * dt * ((fk0[i] ?? 0) + (fk1[i] ?? 0));
      }
    }

    // Boundary condition residuals
    const y0: number[] = new Array(n);
    const yN: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      y0[i] = yVec[i] ?? 0;
      yN[i] = yVec[N * n + i] ?? 0;
    }
    const bcRes = problem.bc(y0, yN, problem.p);
    for (let i = 0; i < n; i++) {
      R[N * n + i] = bcRes[i] ?? 0;
    }

    return R;
  };

  // Newton solver
  for (let iter = 0; iter < maxIterations; iter++) {
    const R = computeResidual(Y);
    let maxRes = 0;
    for (let i = 0; i < totalVars; i++) maxRes = Math.max(maxRes, Math.abs(R[i] ?? 0));

    if (maxRes < tolerance) {
      stats.converged = true;
      break;
    }

    // Numerical Jacobian of residual
    const Jac: Float64Array[] = new Array(totalVars);
    for (let i = 0; i < totalVars; i++) Jac[i] = new Float64Array(totalVars);

    for (let j = 0; j < totalVars; j++) {
      const orig = Y[j] ?? 0;
      const hPert = Math.max(1e-8, 1e-8 * Math.abs(orig));
      Y[j] = orig + hPert;
      const R_pert = computeResidual(Y);
      Y[j] = orig;

      for (let i = 0; i < totalVars; i++) {
        Jac[i]![j] = ((R_pert[i] ?? 0) - (R[i] ?? 0)) / hPert;
      }
    }

    const lu = luFactor(Jac, totalVars);
    stats.luFactorizations!++;

    const delta = new Float64Array(totalVars);
    for (let i = 0; i < totalVars; i++) delta[i] = -(R[i] ?? 0);
    luSolve(lu, delta);

    for (let i = 0; i < totalVars; i++) {
      Y[i] = (Y[i] ?? 0) + (delta[i] ?? 0);
    }
  }

  const times: number[] = [];
  const states: number[][] = [];
  for (let k = 0; k <= N; k++) {
    times.push(tGrid[k]!);
    const yk: number[] = new Array(n);
    for (let i = 0; i < n; i++) yk[i] = Y[k * n + i] ?? 0;
    states.push(yk);
  }

  return {
    times,
    states,
    stats,
  };
}

/**
 * Solve a Boundary Value Problem (BVP) with the chosen method.
 */
export function solveBVP(problem: BVPProblem, options: BVPOptions = {}): BvpResult {
  const method = options.method ?? "collocation-trapezoidal";
  if (method === "multiple-shooting" || method === "single-shooting") {
    return solveBvpShooting(problem, options);
  }
  return solveBvpCollocation(problem, options);
}
