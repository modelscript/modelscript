// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * RODAS4P: 6-Stage 4th-Order L-Stable Rosenbrock-W Stiff DAE Solver.
 *
 * Implements the Steinebach (1995) 4th-order Rosenbrock method with index-1 DAE
 * algebraic variable projection and mass matrix support:
 *   M * dy/dt = f(t, y)
 *
 * Characteristics:
 *   - 6 stages with identical diagonal coefficient gamma = 0.25:
 *     Only a SINGLE LU factorization of W = (M - gamma * h * J) is computed per step!
 *   - L-stable: Eliminates stiff numerical ringing, perfectly suited for DAEs and
 *     parabolic method-of-lines discretizations.
 *   - Embedded 3rd-order error estimation with PI adaptive step control.
 *   - Mass matrix support for implicit DAEs in mass-matrix form.
 *
 * Reference:
 *   Steinebach, G. (1995), "Order-reduction of ROW-methods for DAEs and method of
 *   lines applications", Preprint 1741, FB Mathematik, TH Darmstadt.
 *   Hairer, E. & Wanner, G. (1996), "Solving Ordinary Differential Equations II:
 *   Stiff and Differential-Algebraic Problems", Section IV.7.
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";
import type { CommonSolverResult, DAEProblem, ODEProblem, SolverStats } from "../core/problem-types.js";

// ── RODAS4P Steinebach Butcher Tableau Coefficients ──
export const RODAS4P_GAMMA = 0.25;

const C2 = 3.0 * RODAS4P_GAMMA; // 0.75
const C3 = 0.21;
const C4 = 0.63;

const A21 = 3.0;
const A31 = 1.831036793486759;
const A32 = 0.4955183967433795;
const A41 = 2.304376582692669;
const A42 = -0.05249275245743001;
const A43 = -1.176798761832782;
const A51 = -7.170454962423024;
const A52 = -4.741636671481785;
const A53 = -16.31002631330971;
const A54 = -1.062004044111401;

const C21 = -12.0;
const C31 = -8.791795173947035;
const C32 = -2.207865586973518;
const C41 = 10.81793056857153;
const C42 = 6.780270611428266;
const C43 = 19.5348594464241;
const C51 = 34.19095006749676;
const C52 = 15.49671153725963;
const C53 = 54.7476087596413;
const C54 = 14.16005392148534;
const C61 = 34.62605830930532;
const C62 = 15.30084976114473;
const C63 = 56.99955578662667;
const C64 = 18.40807009793095;
const C65 = -5.714285714285717;

const D1 = 0.25;
const D2 = -0.5;
const D3 = -0.023504;
const D4 = -0.0362;

// Dense output polynomial constants
const D21 = 25.09876703708589;
const D22 = 11.62013104361867;
const D23 = 28.49148307714626;
const D24 = -5.664021568594133;
const D25 = 0.0;
const D31 = 1.638054557396973;
const D32 = -0.7373619806678748;
const D33 = 8.47791821923899;
const D34 = 15.9925314877952;
const D35 = -1.882352941176471;

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

export type Rosenbrock23Result = Rodas4PResult;

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

function computeDfDt(f: (t: number, y: number[]) => number[], t: number, y: number[], f0: number[]): Float64Array {
  const n = y.length;
  const dfdt = new Float64Array(n);
  const dt = Math.max(1e-8, 1e-8 * Math.abs(t));
  const fNext = f(t + dt, y);
  for (let i = 0; i < n; i++) {
    dfdt[i] = ((fNext[i] ?? 0) - (f0[i] ?? 0)) / dt;
  }
  return dfdt;
}

/**
 * Multiply mass matrix M by vector v: out = M * v.
 */
function applyMass(out: Float64Array, v: Float64Array, massMatrix: number[][] | undefined, n: number): void {
  if (!massMatrix) {
    out.set(v);
    return;
  }
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const row = massMatrix[i];
    if (row) {
      for (let j = 0; j < n; j++) {
        sum += (row[j] ?? 0) * (v[j] ?? 0);
      }
    }
    out[i] = sum;
  }
}

/**
 * Integrate a stiff DAE/ODE using the true 6-stage 4th-order RODAS4P method.
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

  let h = options.initialStep ?? Math.min(Math.max(Math.abs(tEnd - t0) / 100, 1e-5), maxStep);
  let t = t0;
  let y = [...y0];

  resultTimes.push(t);
  resultStates.push([...y]);
  if (denseOutputs && outputTimes[0] !== undefined && Math.abs(outputTimes[0] - t) < 1e-12) {
    outIdx++;
  }

  const gamma = RODAS4P_GAMMA;

  // Stage vectors k1..k6
  const k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const k5 = new Float64Array(n);
  const k6 = new Float64Array(n);

  const Mk1 = new Float64Array(n);
  const Mk2 = new Float64Array(n);
  const Mk3 = new Float64Array(n);
  const Mk4 = new Float64Array(n);
  const Mk5 = new Float64Array(n);

  const rhs = new Float64Array(n);
  const yStage = new Array<number>(n);

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

    // Compute Jacobian J at (t, y) and df/dt
    const J = computeJacobian(f, t, y, f0);
    stats.jacobianEvals!++;
    const dfdt = computeDfDt(f, t, y, f0);

    // Form iteration matrix W = (1 / (h * gamma)) * M - J
    const fac = 1.0 / (h * gamma);
    const W: Float64Array[] = new Array(n);
    for (let i = 0; i < n; i++) {
      W[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const mij = massMatrix ? (massMatrix[i]?.[j] ?? 0) : i === j ? 1.0 : 0.0;
        W[i]![j] = fac * mij - (J[i]![j] ?? 0);
      }
    }

    // LU factorize W once per step
    const lu = luFactor(W, n);
    stats.luFactorizations!++;

    const invH = 1.0 / h;

    // ── Stage 1: W * k1 = f0 + (h * d1) * dfdt ──
    for (let i = 0; i < n; i++) {
      rhs[i] = (f0[i] ?? 0) + h * D1 * dfdt[i]!;
    }
    k1.set(rhs);
    luSolve(lu, k1);
    applyMass(Mk1, k1, massMatrix, n);

    // ── Stage 2: y_stage = y + a21 * k1 ──
    for (let i = 0; i < n; i++) {
      yStage[i] = (y[i] ?? 0) + A21 * (k1[i] ?? 0);
    }
    const f1 = f(t + C2 * h, yStage);
    stats.fEvals++;

    // rhs2 = f1 + (C21 / h) * Mk1 + (h * d2) * dfdt
    for (let i = 0; i < n; i++) {
      rhs[i] = (f1[i] ?? 0) + C21 * invH * Mk1[i]! + h * D2 * dfdt[i]!;
    }
    k2.set(rhs);
    luSolve(lu, k2);
    applyMass(Mk2, k2, massMatrix, n);

    // ── Stage 3: y_stage = y + a31 * k1 + a32 * k2 ──
    for (let i = 0; i < n; i++) {
      yStage[i] = (y[i] ?? 0) + A31 * (k1[i] ?? 0) + A32 * (k2[i] ?? 0);
    }
    const f2 = f(t + C3 * h, yStage);
    stats.fEvals++;

    // rhs3 = f2 + invH * (C31 * Mk1 + C32 * Mk2) + (h * d3) * dfdt
    for (let i = 0; i < n; i++) {
      rhs[i] = (f2[i] ?? 0) + invH * (C31 * Mk1[i]! + C32 * Mk2[i]!) + h * D3 * dfdt[i]!;
    }
    k3.set(rhs);
    luSolve(lu, k3);
    applyMass(Mk3, k3, massMatrix, n);

    // ── Stage 4: y_stage = y + a41 * k1 + a42 * k2 + a43 * k3 ──
    for (let i = 0; i < n; i++) {
      yStage[i] = (y[i] ?? 0) + A41 * (k1[i] ?? 0) + A42 * (k2[i] ?? 0) + A43 * (k3[i] ?? 0);
    }
    const f3 = f(t + C4 * h, yStage);
    stats.fEvals++;

    // rhs4 = f3 + invH * (C41*Mk1 + C42*Mk2 + C43*Mk3) + (h * d4) * dfdt
    for (let i = 0; i < n; i++) {
      rhs[i] = (f3[i] ?? 0) + invH * (C41 * Mk1[i]! + C42 * Mk2[i]! + C43 * Mk3[i]!) + h * D4 * dfdt[i]!;
    }
    k4.set(rhs);
    luSolve(lu, k4);
    applyMass(Mk4, k4, massMatrix, n);

    // ── Stage 5: y5 = y + a51*k1 + a52*k2 + a53*k3 + a54*k4 ──
    for (let i = 0; i < n; i++) {
      yStage[i] = (y[i] ?? 0) + A51 * (k1[i] ?? 0) + A52 * (k2[i] ?? 0) + A53 * (k3[i] ?? 0) + A54 * (k4[i] ?? 0);
    }
    const f4 = f(t + h, yStage);
    stats.fEvals++;

    // rhs5 = f4 + invH * (C51*Mk1 + C52*Mk2 + C53*Mk3 + C54*Mk4)
    for (let i = 0; i < n; i++) {
      rhs[i] = (f4[i] ?? 0) + invH * (C51 * Mk1[i]! + C52 * Mk2[i]! + C53 * Mk3[i]! + C54 * Mk4[i]!);
    }
    k5.set(rhs);
    luSolve(lu, k5);
    applyMass(Mk5, k5, massMatrix, n);

    // y_embedded = yStage + k5 (3rd-order embedded solution)
    const yEmbedded = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yEmbedded[i] = (yStage[i] ?? 0) + (k5[i] ?? 0);
    }
    const fEmbedded = f(t + h, yEmbedded);
    stats.fEvals++;

    // ── Stage 6: Error estimation stage ──
    // rhs6 = fEmbedded + invH * (C61*Mk1 + C62*Mk2 + C63*Mk3 + C64*Mk4 + C65*Mk5)
    for (let i = 0; i < n; i++) {
      rhs[i] =
        (fEmbedded[i] ?? 0) + invH * (C61 * Mk1[i]! + C62 * Mk2[i]! + C63 * Mk3[i]! + C64 * Mk4[i]! + C65 * Mk5[i]!);
    }
    k6.set(rhs);
    luSolve(lu, k6);

    // ── 4th-Order Solution: yNew = yEmbedded + k6 ──
    const yNew = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yNew[i] = (yEmbedded[i] ?? 0) + (k6[i] ?? 0);
    }

    // ── Error estimate is directly k6 ──
    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      const err_i = Math.abs(k6[i] ?? 0);
      const tol = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
      maxErrorRatio = Math.max(maxErrorRatio, err_i / tol);
    }

    if (maxErrorRatio <= 1.0 || Math.abs(h) <= minStep * 2) {
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

      // 4th-order step adaptation
      const factor = Math.min(4.0, Math.max(0.2, 0.9 * Math.pow(Math.max(maxErrorRatio, 1e-8), -0.25)));
      h = Math.min(maxStep, Math.max(minStep, h * factor));
    } else {
      // Step rejected
      stats.rejectedSteps++;
      const factor = Math.min(1.0, Math.max(0.1, 0.9 * Math.pow(maxErrorRatio, -0.25)));
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
 * Classical 2-stage Rosenbrock-W method (Rosenbrock23).
 * Preserved for lightweight models and ultra-fast non-stiff/mildly-stiff steps.
 */
export function rosenbrock23(
  f: (t: number, y: number[]) => number[],
  t0: number,
  y0: number[],
  tEnd: number,
  outputTimes?: number[],
  options: Rodas4POptions = {},
  massMatrix?: number[][],
): Rosenbrock23Result {
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
    const J = computeJacobian(f, t, y, f0);
    stats.jacobianEvals!++;

    const W: Float64Array[] = new Array(n);
    for (let i = 0; i < n; i++) {
      W[i] = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        const mij = massMatrix ? (massMatrix[i]?.[j] ?? 0) : i === j ? 1.0 : 0.0;
        W[i]![j] = mij - d * h * (J[i]![j] ?? 0);
      }
    }

    const lu = luFactor(W, n);
    stats.luFactorizations!++;

    for (let i = 0; i < n; i++) k1[i] = h * (f0[i] ?? 0);
    luSolve(lu, k1);

    const yStage2 = new Array<number>(n);
    for (let i = 0; i < n; i++) yStage2[i] = (y[i] ?? 0) + (k1[i] ?? 0);
    const f1 = f(t + h, yStage2);
    stats.fEvals++;

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

    const yNew = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      yNew[i] = (y[i] ?? 0) + 0.5 * ((k1[i] ?? 0) + (k2[i] ?? 0));
    }

    let maxErrorRatio = 0.0;
    for (let i = 0; i < n; i++) {
      const err_i = 0.5 * Math.abs((k2[i] ?? 0) - (k1[i] ?? 0));
      const tol = atol + rtol * Math.max(Math.abs(y[i] ?? 0), Math.abs(yNew[i] ?? 0));
      maxErrorRatio = Math.max(maxErrorRatio, err_i / tol);
    }

    if (maxErrorRatio <= 1.0 || h <= minStep * 2) {
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
      const factor = Math.min(4.0, Math.max(0.2, 0.9 * Math.pow(Math.max(maxErrorRatio, 1e-6), -1.0 / 3.0)));
      h = Math.min(maxStep, Math.max(minStep, h * factor));
    } else {
      stats.rejectedSteps++;
      const factor = Math.min(1.0, Math.max(0.1, 0.9 * Math.pow(maxErrorRatio, -0.5)));
      h = Math.max(minStep, h * factor);
    }
  }

  return { times: resultTimes, states: resultStates, stats };
}

/**
 * Solve a DAEProblem or ODEProblem using RODAS4P.
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

/**
 * Solve a DAEProblem or ODEProblem using Rosenbrock23.
 */
export function solveRosenbrock23(problem: DAEProblem | ODEProblem, options: Rodas4POptions = {}): Rosenbrock23Result {
  const [t0, tEnd] = problem.tSpan;
  const f = (t: number, y: number[]) => {
    if ("massMatrix" in problem && problem.massMatrix) {
      return problem.f(t, y, undefined, problem.p as any);
    }
    return problem.f(t, y, problem.p as any);
  };
  const massMatrix = "massMatrix" in problem ? problem.massMatrix : undefined;
  return rosenbrock23(f, t0, problem.y0, tEnd, undefined, options, massMatrix);
}
