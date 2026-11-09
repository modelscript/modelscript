// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Kennedy-Carpenter 4th-Order 6-Stage Additive IMEX Runge-Kutta Solver (`KenCarp4`).
 *
 * Implements the `ARK4(3)6L[2]SA` Implicit-Explicit (IMEX) Additive Runge-Kutta integrator
 * for split stiff/non-stiff ODE and PDE systems:
 *   $\dot{y} = f_{\text{stiff}}(t, y) + f_{\text{nonstiff}}(t, y)$
 *
 * Pairs a 6-stage, 4th-order, L-stable, stiffly accurate ESDIRK implicit tableau ($\gamma = 1/4$)
 * for stiff diffusive/reactive terms with a matching 6-stage, 4th-order explicit ERK tableau
 * for non-stiff convective/advective terms, sharing abscissae $c$ and quadrature weights $b, \hat{b}$.
 *
 * Academic Citations:
 * - Kennedy, C. A., & Carpenter, M. H. (2003). "Additive Runge–Kutta schemes for
 *   convection–diffusion–reaction equations." Applied Numerical Mathematics, 44(1-2), 139-181.
 *   Table A.7 (`ARK4(3)6L[2]SA`). https://doi.org/10.1016/S0168-9274(02)00138-1
 */

import { luFactor, luSolve } from "@modelscript/runtime/wasm_gaussian.js";
import type { CommonSolverResult, ODEProblem, SolverStats } from "../core/problem-types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Public Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface IMEXODEProblem {
  /** Integration interval `[t0, tEnd]`. */
  tSpan: [number, number];
  /** Initial state vector `y(t0)`. */
  y0: number[];
  /** Stiff right-hand side operator `f_stiff(t, y, p)` (treated implicitly via ESDIRK). */
  fStiff: (t: number, y: number[], p?: unknown) => number[];
  /** Non-stiff right-hand side operator `f_nonstiff(t, y, p)` (treated explicitly via ERK). */
  fNonStiff?: ((t: number, y: number[], p?: unknown) => number[]) | undefined;
  /** Optional analytical Jacobian of `fStiff` with respect to `y`. */
  jacStiff?: ((t: number, y: number[], p?: unknown) => number[][]) | undefined;
  /** Optional parameter vector/object passed to `fStiff` and `fNonStiff`. */
  p?: unknown;
}

export interface KenCarp4Options {
  /** Absolute error tolerance (default: 1e-7). */
  atol?: number | undefined;
  /** Relative error tolerance (default: 1e-6). */
  rtol?: number | undefined;
  /** Initial step size. */
  initialStep?: number | undefined;
  /** Minimum allowable step size (default: 1e-13). */
  minStep?: number | undefined;
  /** Maximum allowable step size. */
  maxStep?: number | undefined;
  /** Maximum number of accepted steps (default: 100000). */
  maxSteps?: number | undefined;
  /** Maximum Modified Newton iterations per implicit stage (default: 12). */
  maxNewtonIter?: number | undefined;
  /** Optional explicit non-stiff RHS when passing a standard `ODEProblem` as the primary problem. */
  fNonStiff?: ((t: number, y: number[], p?: unknown) => number[]) | undefined;
}

export interface KenCarp4Result extends CommonSolverResult {
  stats: SolverStats;
}

// ─────────────────────────────────────────────────────────────────────────────
// Kennedy-Carpenter ARK4(3)6L[2]SA Butcher Tableaus (Table A.7)
// ─────────────────────────────────────────────────────────────────────────────

export const KENCARP4_GAMMA = 0.25;

export const KENCARP4_C: readonly number[] = [0.0, 1.0 / 2.0, 83.0 / 250.0, 31.0 / 50.0, 17.0 / 20.0, 1.0];

/** Implicit ESDIRK lower-triangular Butcher tableau A_imp (diagonal entries i=1..5 equal gamma = 1/4). */
export const KENCARP4_A_IMP: readonly (readonly number[])[] = [
  [0.0],
  [1.0 / 4.0, 1.0 / 4.0],
  [8611.0 / 62500.0, -1743.0 / 31250.0, 1.0 / 4.0],
  [5012029.0 / 34652500.0, -654441.0 / 2922500.0, 174375.0 / 388108.0, 1.0 / 4.0],
  [
    15267082809.0 / 155376265600.0,
    -71443401.0 / 120774400.0,
    730878875.0 / 902184768.0,
    2285395.0 / 8070912.0,
    1.0 / 4.0,
  ],
  [82889.0 / 524892.0, 0.0, 15625.0 / 83664.0, 69875.0 / 102672.0, -2260.0 / 8211.0, 1.0 / 4.0],
];

/** Explicit ERK strictly lower-triangular Butcher tableau A_exp. */
export const KENCARP4_A_EXP: readonly (readonly number[])[] = [
  [],
  [1.0 / 2.0],
  [13861.0 / 62500.0, 6889.0 / 62500.0],
  [-116923316275.0 / 2393684061468.0, -2731218467317.0 / 15368042101831.0, 9408046702089.0 / 11113171139209.0],
  [
    -451086348788.0 / 2902428689909.0,
    -2682348792572.0 / 7519795681897.0,
    12662868775082.0 / 11960479115383.0,
    3355817975965.0 / 11060851509271.0,
  ],
  [
    647845179188.0 / 3216320057751.0,
    73281519250.0 / 8382639484533.0,
    552539513391.0 / 3454668386233.0,
    3354512671639.0 / 8306763924573.0,
    4040.0 / 17871.0,
  ],
];

/** 4th-order propagation weights b (shared by implicit and explicit tableaus). */
export const KENCARP4_B: readonly number[] = [
  82889.0 / 524892.0,
  0.0,
  15625.0 / 83664.0,
  69875.0 / 102672.0,
  -2260.0 / 8211.0,
  1.0 / 4.0,
];

/** 3rd-order embedded weights b_hat for adaptive step-size error estimation. */
export const KENCARP4_BHAT: readonly number[] = [
  4586570599.0 / 29645900160.0,
  0.0,
  178811875.0 / 945068544.0,
  814220225.0 / 1159782912.0,
  -3700637.0 / 11593932.0,
  61727.0 / 225920.0,
];

// ─────────────────────────────────────────────────────────────────────────────
// KenCarp4 Solver Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Integrates an Additive IMEX ODE system $\dot{y} = f_{\text{stiff}}(t, y) + f_{\text{nonstiff}}(t, y)$
 * (or standard stiff `ODEProblem`) using the 4th-order 6-stage `KenCarp4` scheme.
 */
export function kencarp4(problem: IMEXODEProblem | ODEProblem, options: KenCarp4Options = {}): KenCarp4Result {
  const [t0, tEnd] = problem.tSpan;
  const n = problem.y0.length;
  const atol = options.atol ?? 1e-7;
  const rtol = options.rtol ?? 1e-6;
  const maxSteps = options.maxSteps ?? 100000;
  const maxNewtonIter = options.maxNewtonIter ?? 12;
  const span = Math.abs(tEnd - t0);
  const sign = tEnd >= t0 ? 1.0 : -1.0;
  const minStep = options.minStep ?? 1e-13;
  const maxStep = options.maxStep ?? span;

  const isImex = "fStiff" in problem;
  const fStiffFn = isImex ? problem.fStiff : problem.f;
  const fNonStiffFn = isImex ? problem.fNonStiff : options.fNonStiff;
  const jacStiffFn = isImex ? problem.jacStiff : problem.jac;
  const param = problem.p as any;

  let t = t0;
  const y = new Float64Array(problem.y0);

  const times: number[] = [t];
  const states: number[][] = [Array.from(y)];

  let acceptedSteps = 0;
  let rejectedSteps = 0;
  let fEvals = 0;
  let jacobianEvals = 0;
  let luFactorizations = 0;

  const evalStiff = (tEval: number, yVec: Float64Array, out: Float64Array): void => {
    fEvals++;
    const res = fStiffFn(tEval, Array.from(yVec), param);
    for (let i = 0; i < n; i++) out[i] = res[i] ?? 0.0;
  };

  const evalNonStiff = (tEval: number, yVec: Float64Array, out: Float64Array): void => {
    if (!fNonStiffFn) {
      out.fill(0.0);
      return;
    }
    fEvals++;
    const res = fNonStiffFn(tEval, Array.from(yVec), param);
    for (let i = 0; i < n; i++) out[i] = res[i] ?? 0.0;
  };

  const evalJacStiff = (tEval: number, yVec: Float64Array, outJ: Float64Array): void => {
    jacobianEvals++;
    if (jacStiffFn) {
      const Jmat = jacStiffFn(tEval, Array.from(yVec), param);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          outJ[i * n + j] = Jmat[i]?.[j] ?? 0.0;
        }
      }
      return;
    }
    const f0 = new Float64Array(n);
    evalStiff(tEval, yVec, f0);
    const yPert = new Float64Array(yVec);
    const fPert = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const yj = yVec[j]!;
      const eps = 1e-8 * Math.max(1.0, Math.abs(yj));
      yPert[j] = yj + eps;
      evalStiff(tEval, yPert, fPert);
      yPert[j] = yj;
      const invEps = 1.0 / eps;
      for (let i = 0; i < n; i++) {
        outJ[i * n + j] = (fPert[i]! - f0[i]!) * invEps;
      }
    }
  };

  let hAbs = options.initialStep ? Math.abs(options.initialStep) : Math.min(0.01, span / 100.0);
  hAbs = Math.min(maxStep, Math.max(minStep, hAbs));

  // Stage derivatives kImp[0..5] and kExp[0..5]
  const kImp: Float64Array[] = Array.from({ length: 6 }, () => new Float64Array(n));
  const kExp: Float64Array[] = Array.from({ length: 6 }, () => new Float64Array(n));
  const rhsKnown = new Float64Array(n);
  const uStage = new Float64Array(n);
  const fStage = new Float64Array(n);
  const resVec = new Float64Array(n);
  const J = new Float64Array(n * n);
  const W = new Float64Array(n * n);
  const yNew = new Float64Array(n);
  const yHat = new Float64Array(n);

  let prevErr = 1.0;

  while (Math.abs(tEnd - t) > 1e-13 && acceptedSteps < maxSteps) {
    const rem = Math.abs(tEnd - t);
    if (hAbs > rem) hAbs = rem;
    const h = sign * hAbs;

    // Stage 0 (explicit for both tableaus since c_0 = 0, a^imp_{0,0} = 0)
    evalStiff(t, y, kImp[0]!);
    evalNonStiff(t, y, kExp[0]!);

    // Evaluate Jacobian and factorize W = I - h * gamma * J_stiff once per step
    evalJacStiff(t, y, J);
    const hGamma = h * KENCARP4_GAMMA;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        W[i * n + j] = (i === j ? 1.0 : 0.0) - hGamma * J[i * n + j]!;
      }
    }

    let fact: ReturnType<typeof luFactor> | null = null;
    try {
      fact = luFactor(W, n);
      luFactorizations++;
    } catch {
      rejectedSteps++;
      hAbs *= 0.5;
      if (hAbs < minStep) {
        throw new Error(`KenCarp4 failed: singular iteration matrix at t = ${t}`);
      }
      continue;
    }

    let stagesConverged = true;

    // Stages s = 1 .. 5
    for (let s = 1; s < 6; s++) {
      const ts = t + KENCARP4_C[s]! * h;
      const aImpRow = KENCARP4_A_IMP[s]!;
      const aExpRow = KENCARP4_A_EXP[s]!;

      // Known explicit + prior-stage implicit combination:
      // rhsKnown = y + h * sum_{j=0}^{s-1} (aImp[s][j] * kImp[j] + aExp[s][j] * kExp[j])
      for (let i = 0; i < n; i++) {
        let sum = 0.0;
        for (let j = 0; j < s; j++) {
          sum += aImpRow[j]! * kImp[j]![i]! + aExpRow[j]! * kExp[j]![i]!;
        }
        rhsKnown[i] = y[i]! + h * sum;
        // Predictor guess for stage state uStage
        uStage[i] = rhsKnown[i]! + hGamma * kImp[s - 1]![i]!;
      }

      // Solve uStage - h * gamma * fStiff(ts, uStage) - rhsKnown = 0 via Modified Newton
      let stageOk = false;
      for (let iter = 0; iter < maxNewtonIter; iter++) {
        evalStiff(ts, uStage, fStage);
        let maxR = 0.0;
        for (let i = 0; i < n; i++) {
          const r = uStage[i]! - hGamma * fStage[i]! - rhsKnown[i]!;
          resVec[i] = -r;
          const absR = Math.abs(r);
          if (absR > maxR) maxR = absR;
        }

        if (maxR <= atol * 0.1) {
          stageOk = true;
          break;
        }

        luSolve(fact, resVec);

        let maxDelta = 0.0;
        for (let i = 0; i < n; i++) {
          uStage[i] = uStage[i]! + resVec[i]!;
          const sc = atol + rtol * Math.abs(uStage[i]!);
          const dNorm = Math.abs(resVec[i]!) / sc;
          if (dNorm > maxDelta) maxDelta = dNorm;
        }

        if (maxDelta <= 0.1) {
          evalStiff(ts, uStage, fStage);
          stageOk = true;
          break;
        }
      }

      if (!stageOk) {
        stagesConverged = false;
        break;
      }

      kImp[s]!.set(fStage);
      evalNonStiff(ts, uStage, kExp[s]!);
    }

    if (!stagesConverged) {
      rejectedSteps++;
      hAbs *= 0.5;
      if (hAbs < minStep) {
        throw new Error(`KenCarp4 Newton stage failed to converge at t = ${t}`);
      }
      continue;
    }

    // Compute 4th-order solution yNew and 3rd-order embedded solution yHat
    let errSq = 0.0;
    for (let i = 0; i < n; i++) {
      let sumB = 0.0;
      let sumBHat = 0.0;
      for (let s = 0; s < 6; s++) {
        const kTot = kImp[s]![i]! + kExp[s]![i]!;
        sumB += KENCARP4_B[s]! * kTot;
        sumBHat += KENCARP4_BHAT[s]! * kTot;
      }
      yNew[i] = y[i]! + h * sumB;
      yHat[i] = y[i]! + h * sumBHat;

      const sc = atol + rtol * Math.max(Math.abs(y[i]!), Math.abs(yNew[i]!));
      const err = (yNew[i]! - yHat[i]!) / sc;
      errSq += err * err;
    }

    const errNorm = Math.sqrt(errSq / Math.max(1, n));

    if (errNorm <= 1.0 || hAbs <= minStep) {
      acceptedSteps++;
      t += h;
      y.set(yNew);
      times.push(t);
      states.push(Array.from(y));

      const safeErr = Math.max(errNorm, 1e-8);
      const factor = 0.9 * Math.pow(safeErr, -0.7 / 4.0) * Math.pow(prevErr, 0.4 / 4.0);
      const clamped = Math.min(3.0, Math.max(0.2, factor));
      hAbs = Math.min(maxStep, Math.max(minStep, hAbs * clamped));
      prevErr = safeErr;
    } else {
      rejectedSteps++;
      const factor = Math.max(0.2, 0.85 * Math.pow(errNorm, -0.25));
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
      jacobianEvals,
      luFactorizations,
      converged: Math.abs(tEnd - t) <= 1e-11,
    },
  };
}
