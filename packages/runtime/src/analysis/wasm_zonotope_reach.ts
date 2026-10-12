// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — High-Dimensional Linear Reachability via Zonotopes.
 *
 * Implements guaranteed continuous reachability for linear systems:
 *   \dot{x}(t) = A x(t) + B u(t),  x(0) \in Z_0, u(t) \in U
 *
 * Features:
 *  - Matrix exponential series expansion with rigorous Taylor remainder bounding
 *  - Wrapping-free linear map A * Z
 *  - Exact Minkowski sum propagation
 *  - Giroux order reduction to scale up to 50+ state dimensions without explosion
 *  - Safety certificate generation against linear hyperplane requirements
 */

import type { VerificationVerdict } from "../formal/verdict.js";
import type { DaeSystem } from "./wasm_dae_flowpipe.js";
import { Interval } from "./wasm_interval.js";
import { Zonotope } from "./wasm_zonotope.js";

export interface LinearSafetyRequirement {
  name?: string;
  stateIndex: number;
  operator: "<=" | ">=" | "<" | ">";
  limitValue: number;
}

export interface ZonotopeReachabilityOptions {
  A: number[][];
  B?: number[][];
  U?: Zonotope;
  initialSet: Zonotope | Interval[];
  nominalInitial?: number[];
  tSpan: [number, number];
  dt?: number;
  maxOrder?: number;
  expansionOrder?: number;
  requirements?: LinearSafetyRequirement[];
}

export interface ZonotopeStepRecord {
  time: number;
  zonotope: Zonotope;
  enclosure: Interval[];
}

export interface ZonotopeReachabilityResult {
  verdict: VerificationVerdict;
  isCertifiedSafe: boolean;
  totalSteps: number;
  steps: ZonotopeStepRecord[];
  continuousEnclosures?: Interval[][];
  violations: {
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
    isConcreteWitness?: boolean;
    reason: string;
  }[];
  summary: string;
}

/** Matrix multiplication C = A * B */
export function matrixMultiply(A: number[][], B: number[][]): number[][] {
  const rowsA = A.length;
  const colsA = A[0]!.length;
  const colsB = B[0]!.length;
  const C: number[][] = Array.from({ length: rowsA }, () => new Array<number>(colsB).fill(0));

  for (let i = 0; i < rowsA; i++) {
    const rowA = A[i]!;
    for (let k = 0; k < colsA; k++) {
      const aVal = rowA[k]!;
      if (aVal === 0) continue;
      const rowB = B[k]!;
      for (let j = 0; j < colsB; j++) {
        C[i]![j] += aVal * rowB[j]!;
      }
    }
  }
  return C;
}

/** Matrix addition C = A + B */
export function matrixAdd(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]!.length;
  const C: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      C[i]![j] = A[i]![j]! + B[i]![j]!;
    }
  }
  return C;
}

/** Scalar-matrix scaling C = alpha * A */
export function matrixScale(alpha: number, A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]!.length;
  const C: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      C[i]![j] = alpha * A[i]![j]!;
    }
  }
  return C;
}

/** Identity matrix of size n */
export function matrixIdentity(n: number): number[][] {
  const I: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) I[i]![i] = 1.0;
  return I;
}

/** Infinity norm of matrix A */
export function matrixInfinityNorm(A: number[][]): number {
  let maxRowSum = 0;
  for (const row of A) {
    let rowSum = 0;
    for (const val of row) rowSum += Math.abs(val);
    if (rowSum > maxRowSum) maxRowSum = rowSum;
  }
  return maxRowSum;
}

/** Matrix-vector multiplication y = A * x */
export function matrixVectorMultiply(A: number[][], x: number[]): number[] {
  const rows = A.length;
  const cols = A[0] ? A[0].length : 0;
  const y = new Array<number>(rows).fill(0);
  for (let i = 0; i < rows; i++) {
    const row = A[i]!;
    let sum = 0;
    for (let j = 0; j < cols; j++) {
      sum += row[j]! * x[j]!;
    }
    y[i] = sum;
  }
  return y;
}

/**
 * Computes both matrix exponential exp(A * dt) and integral Psi = \int_0^dt exp(A * s) ds
 * using Taylor series with rigorous truncation remainder bounds.
 */
export function computeMatrixExponentialAndIntegral(
  A: number[][],
  dt: number,
  expansionOrder = 6,
): { expM: number[][]; psiM: number[][]; remainderNorm: number; psiRemainderNorm: number } {
  const n = A.length;
  const M = matrixScale(dt, A);
  let expM = matrixIdentity(n);
  let psiM = matrixScale(dt, matrixIdentity(n));
  let term = matrixIdentity(n);

  for (let k = 1; k <= expansionOrder; k++) {
    term = matrixMultiply(term, M);
    term = matrixScale(1 / k, term);
    expM = matrixAdd(expM, term);
    psiM = matrixAdd(psiM, matrixScale(dt / (k + 1), term));
  }

  const normM = matrixInfinityNorm(M);
  let factExp = 1;
  for (let k = 1; k <= expansionOrder + 1; k++) factExp *= k;
  const denomExp = factExp * Math.max(0.1, 1 - normM / (expansionOrder + 2));
  const remainderNorm = Math.pow(normM, expansionOrder + 1) / denomExp;

  let factPsi = factExp * (expansionOrder + 2);
  const denomPsi = factPsi * Math.max(0.1, 1 - normM / (expansionOrder + 3));
  const psiRemainderNorm = (Math.abs(dt) * Math.pow(normM, expansionOrder + 1)) / denomPsi;

  return { expM, psiM, remainderNorm, psiRemainderNorm };
}

/**
 * Computes matrix exponential exp(A * dt) using Taylor series with truncation remainder bound.
 */
export function computeMatrixExponential(
  A: number[][],
  dt: number,
  expansionOrder = 6,
): { expM: number[][]; remainderNorm: number } {
  const res = computeMatrixExponentialAndIntegral(A, dt, expansionOrder);
  return { expM: res.expM, remainderNorm: res.remainderNorm };
}

export class ZonotopeReachabilitySolver {
  /**
   * Solves continuous linear reachability for \dot{x} = A x + B u over [t0, tEnd]
   * with rigorous norm-scaled truncation bounds, sound continuous input integration,
   * and time-interval curvature enclosures over each step.
   */
  public static solve(options: ZonotopeReachabilityOptions): ZonotopeReachabilityResult {
    const { A, tSpan, requirements = [] } = options;
    const n = A.length;
    const dt = options.dt ?? 0.05;
    const maxOrder = options.maxOrder ?? 5;
    const expansionOrder = options.expansionOrder ?? 6;

    // Convert initial set to Zonotope
    let currentZ =
      options.initialSet instanceof Zonotope ? options.initialSet : Zonotope.fromIntervals(options.initialSet);

    const { expM, psiM, remainderNorm, psiRemainderNorm } = computeMatrixExponentialAndIntegral(A, dt, expansionOrder);

    // Compute input set contribution: \Psi(A, dt) * (B * U) plus truncation error
    let inputZ: Zonotope | null = null;
    let normAB = 0;
    let maxUNorm = 0;
    if (options.B && options.U) {
      const BU = options.U.linearMap(options.B);
      const psiBU = BU.linearMap(psiM);
      const buIntervals = BU.toIntervals();
      let maxBUNorm = 0;
      for (const iv of buIntervals) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > maxBUNorm) maxBUNorm = m;
      }
      const uIntervals = options.U.toIntervals();
      for (const iv of uIntervals) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > maxUNorm) maxUNorm = m;
      }
      const inputTruncRadius = psiRemainderNorm * maxBUNorm;
      if (inputTruncRadius > 1e-15) {
        const inputTruncBox = Array.from({ length: n }, () => new Interval(-inputTruncRadius, inputTruncRadius));
        inputZ = psiBU.minkowskiSum(Zonotope.fromIntervals(inputTruncBox));
      } else {
        inputZ = psiBU;
      }
      const AB = matrixMultiply(A, options.B);
      normAB = matrixInfinityNorm(AB);
    }

    const normA = matrixInfinityNorm(A);
    const normB = options.B ? matrixInfinityNorm(options.B) : 0;
    const A2 = matrixMultiply(A, A);
    const normA2 = matrixInfinityNorm(A2);

    let nomX = options.nominalInitial ? [...options.nominalInitial] : [...currentZ.center];
    const nomU = options.U ? [...options.U.center] : null;

    const steps: ZonotopeStepRecord[] = [];
    const continuousEnclosures: Interval[][] = [];
    const violations: ZonotopeReachabilityResult["violations"] = [];

    let t = tSpan[0];
    const tEnd = tSpan[1];

    let currentEnc = currentZ.toIntervals();
    steps.push({
      time: t,
      zonotope: currentZ.clone(),
      enclosure: currentEnc,
    });

    let hasWitnessViolation = false;
    let hasLimitCrossing = false;

    while (t < tEnd - 1e-12) {
      const tNext = t + dt;

      // 1. Homogeneous propagation: exp(A*dt) * Z_k
      let nextZ = currentZ.linearMap(expM);

      // 2. Add input set if present: \oplus \Psi * B * U
      if (inputZ) {
        nextZ = nextZ.minkowskiSum(inputZ);
      }

      // 3. State truncation error scaled by maximum state radius R_k: ||E|| * ||x||_\infty (fixes D9)
      let rK = 0;
      for (const iv of currentEnc) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > rK) rK = m;
      }
      const stateTruncRadius = remainderNorm * rK;
      if (stateTruncRadius > 1e-15) {
        const truncBox = Array.from({ length: n }, () => new Interval(-stateTruncRadius, stateTruncRadius));
        nextZ = nextZ.minkowskiSum(Zonotope.fromIntervals(truncBox));
      }

      // 4. Order reduction if generator count exceeds maxOrder * n
      if (nextZ.generatorCount > maxOrder * n) {
        nextZ = nextZ.reduce(maxOrder);
      }

      const nextEnc = nextZ.toIntervals();

      // 5. Sound time-interval continuous enclosure R_{[t_k, t_{k+1}]}:
      // Interval hull of (Z_k, Z_{k+1}) \oplus curvature box [-curvRadius, curvRadius]^n
      let rNext = 0;
      for (const iv of nextEnc) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > rNext) rNext = m;
      }
      // Gronwall bound on |x(s)| inside the step: e^{||A|| dt} (R_k + dt ||B|| ||U||). Endpoint radii alone
      // do not bound the interior.
      const rTube = Math.max(rK, rNext, Math.exp(normA * dt) * (rK + dt * normB * maxUNorm));
      const curvRadius = ((dt * dt) / 8.0) * (normA2 * rTube + normAB * maxUNorm);

      const tube: Interval[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const lo = Math.min(currentEnc[i]!.lo, nextEnc[i]!.lo) - curvRadius;
        const hi = Math.max(currentEnc[i]!.hi, nextEnc[i]!.hi) + curvRadius;
        tube[i] = new Interval(lo, hi);
      }
      continuousEnclosures.push(tube);

      // Nominal trajectory step
      let nextNomX = matrixVectorMultiply(expM, nomX);
      if (options.B && nomU) {
        const bNomU = matrixVectorMultiply(options.B, nomU);
        const psiBNomU = matrixVectorMultiply(psiM, bNomU);
        for (let i = 0; i < n; i++) nextNomX[i] += psiBNomU[i]!;
      }

      // 6. Check safety requirements against the continuous time-interval enclosure
      for (const req of requirements) {
        const inv = tube[req.stateIndex];
        if (!inv) continue;

        let crossed = false;
        let worstVal = inv.mid;

        if (req.operator === "<=" || req.operator === "<") {
          worstVal = inv.hi;
          if (worstVal > req.limitValue) crossed = true;
        } else if (req.operator === ">=" || req.operator === ">") {
          worstVal = inv.lo;
          if (worstVal < req.limitValue) crossed = true;
        }

        if (crossed) {
          // Check if nominal trajectory provides a concrete witness
          const nomValCurrent = nomX[req.stateIndex]!;
          const nomValNext = nextNomX[req.stateIndex]!;
          let isWitness = false;
          let witnessVal = nomValNext;
          let witnessTime = tNext;

          if (req.operator === "<=" || req.operator === "<") {
            if (nomValNext > req.limitValue) {
              isWitness = true;
            } else if (nomValCurrent > req.limitValue) {
              isWitness = true;
              witnessVal = nomValCurrent;
              witnessTime = t;
            }
          } else if (req.operator === ">=" || req.operator === ">") {
            if (nomValNext < req.limitValue) {
              isWitness = true;
            } else if (nomValCurrent < req.limitValue) {
              isWitness = true;
              witnessVal = nomValCurrent;
              witnessTime = t;
            }
          }

          if (isWitness) {
            hasWitnessViolation = true;
          } else {
            hasLimitCrossing = true;
          }

          violations.push({
            time: isWitness ? witnessTime : tNext,
            stateIndex: req.stateIndex,
            operator: req.operator,
            worstCaseValue: worstVal,
            limitValue: req.limitValue,
            isConcreteWitness: isWitness,
            reason: isWitness
              ? `At t = ${witnessTime.toFixed(3)}s: nominal witness x[${req.stateIndex}]=${witnessVal.toFixed(4)} strictly violates ${req.operator} ${req.limitValue}`
              : `At t in [${t.toFixed(3)}, ${tNext.toFixed(3)}]s: continuous enclosure x[${req.stateIndex}] worst-case ${worstVal.toFixed(4)} crosses ${req.operator} ${req.limitValue}`,
          });
        }
      }

      t = tNext;
      nomX = nextNomX;
      currentZ = nextZ;
      currentEnc = nextEnc;

      steps.push({
        time: t,
        zonotope: currentZ.clone(),
        enclosure: currentEnc,
      });
    }

    const isCertifiedSafe = violations.length === 0;

    let verdict: VerificationVerdict;
    if (hasWitnessViolation) {
      const firstWitness = violations.find((v) => v.isConcreteWitness) ?? violations[0]!;
      verdict = {
        kind: "violated",
        witness: { time: firstWitness.time, state: { [firstWitness.stateIndex]: firstWitness.worstCaseValue } },
        detail: `Concrete trajectory witness violated requirement ${firstWitness.operator} ${firstWitness.limitValue}.`,
      };
    } else if (hasLimitCrossing) {
      verdict = {
        kind: "unknown",
        reason: "inconclusive-enclosure",
        detail: `Continuous reachability enclosure crossed requirement boundary across ${violations.length} step(s), but no concrete witness breach was confirmed.`,
      };
    } else {
      verdict = {
        kind: "proven",
        rigor: "float-sound",
        detail: `Certified safe across ${steps.length} steps up to t=${tSpan[1]}s with continuous time-interval curvature bounds.`,
      };
    }

    const summary = isCertifiedSafe
      ? `Certified safe (float-sound continuous enclosure) across ${steps.length} steps up to t=${tSpan[1]}s (dimension=${n}, max generators=${maxOrder * n}).`
      : hasWitnessViolation
        ? `Safety violation detected (proven): concrete witness found at t=${violations[0]!.time.toFixed(3)}s.`
        : `Safety violation detected (inconclusive / unknown): enclosure crossed requirement boundary across ${violations.length} step(s).`;

    return {
      verdict,
      isCertifiedSafe,
      totalSteps: steps.length,
      steps,
      continuousEnclosures,
      violations,
      summary,
    };
  }
}

export interface NonlinearZonotopeReachOptions {
  dae: DaeSystem;
  initialSet: Zonotope | Interval[];
  nominalInitial?: number[];
  tSpan: [number, number];
  dt?: number;
  maxOrder?: number;
  expansionOrder?: number;
  disturbanceSet?: Zonotope | Interval[];
  algebraicSet?: Interval[];
  requirements?: LinearSafetyRequirement[];
  budgetMs?: number; // default 150 ms (looser budget for keystroke tier)
}

export interface NonlinearZonotopeReachResult {
  verdict: VerificationVerdict;
  isCertifiedSafe: boolean;
  totalSteps: number;
  steps: ZonotopeStepRecord[];
  continuousEnclosures: Interval[][];
  violations: {
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
    isConcreteWitness?: boolean;
    reason: string;
  }[];
  durationMs: number;
  summary: string;
}

export class ConservativeLinearizationSolver {
  /**
   * Computes guaranteed continuous reachability for nonlinear systems \dot{x} = f(t, x, z)
   * using conservative linearization (Althoff 2008):
   *   - Center-based Jacobian linearization A_k = \nabla_x f(t_k, c_k, z_k)
   *   - Exact Mean Value Theorem Lagrange remainder bounding over the interval state box:
   *       L_{k, i} = \sum_j ([J_{ij}(B_k)] - A_{k, ij}) * (B_{k, j} - c_{k, j})
   *   - Matrix exponential and integral with Taylor truncation remainder bounds
   *   - Continuous time-interval curvature bounds over each step [t_k, t_{k+1}]
   *   - Order reduction to preserve efficiency
   *   - Keystroke budget discipline (default 150 ms)
   */
  public static solve(options: NonlinearZonotopeReachOptions): NonlinearZonotopeReachResult {
    const tStart = performance.now();
    const budgetMs = options.budgetMs ?? 150;
    const { dae, tSpan, requirements = [] } = options;
    const n = dae.numDiffStates;
    const dt = options.dt ?? 0.02;
    const maxOrder = options.maxOrder ?? 5;
    const expansionOrder = options.expansionOrder ?? 6;

    let currentZ =
      options.initialSet instanceof Zonotope ? options.initialSet : Zonotope.fromIntervals(options.initialSet);
    let nomX = options.nominalInitial ? [...options.nominalInitial] : [...currentZ.center];
    const distZ = options.disturbanceSet
      ? options.disturbanceSet instanceof Zonotope
        ? options.disturbanceSet
        : Zonotope.fromIntervals(options.disturbanceSet)
      : null;
    const algIv = options.algebraicSet ?? Array.from({ length: dae.numAlgStates }, () => new Interval(0, 0));
    const algNom = algIv.map((iv) => iv.mid);

    if (!dae.jacobianFxInterval) {
      return {
        verdict: {
          kind: "unknown",
          reason: "unsupported",
          detail: "dae.jacobianFxInterval is required for sound conservative linearization.",
        },
        isCertifiedSafe: false,
        totalSteps: 0,
        steps: [],
        continuousEnclosures: [],
        violations: [],
        durationMs: performance.now() - tStart,
        summary: "Unknown: missing interval Jacobian for conservative linearization.",
      };
    }

    let t = tSpan[0];
    const tEnd = tSpan[1];
    const steps: ZonotopeStepRecord[] = [];
    const continuousEnclosures: Interval[][] = [];
    const violations: NonlinearZonotopeReachResult["violations"] = [];

    let currentEnc = currentZ.toIntervals();
    steps.push({
      time: t,
      zonotope: currentZ.clone(),
      enclosure: currentEnc,
    });

    let hasWitnessViolation = false;
    let hasLimitCrossing = false;
    let timedOut = false;

    while (t < tEnd - 1e-12) {
      if (performance.now() - tStart > budgetMs) {
        timedOut = true;
        break;
      }

      const tNext = Math.min(t + dt, tEnd);
      const h = tNext - t;
      const c_k = currentZ.center;
      const B_k = currentEnc;

      // 1. Center evaluation f0 = f(t, c_k, z_nom)
      const f0 = dae.f(t, c_k, algNom);

      // 2. Point Jacobian A_k
      let Ak: number[][];
      if (dae.jacobianFx) {
        Ak = dae.jacobianFx(t, c_k, algNom);
      } else {
        Ak = Array.from({ length: n }, () => new Array(n).fill(0));
        const eps = 1e-7;
        for (let j = 0; j < n; j++) {
          const xPert = [...c_k];
          xPert[j] += eps;
          const fPert = dae.f(t, xPert, algNom);
          for (let i = 0; i < n; i++) {
            Ak[i]![j] = (fPert[i]! - f0[i]!) / eps;
          }
        }
      }

      // 3. Interval Jacobian J_k over B_k
      const Jk = dae.jacobianFxInterval(new Interval(t, tNext), B_k, algIv);

      // 4. Mean Value Theorem Lagrange remainder bound:
      const lambda = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sumRem = 0;
        for (let j = 0; j < n; j++) {
          const r_j = Math.max(c_k[j]! - B_k[j]!.lo, B_k[j]!.hi - c_k[j]!);
          const devLo = Math.abs(Jk[i]![j]!.lo - Ak[i]![j]!);
          const devHi = Math.abs(Jk[i]![j]!.hi - Ak[i]![j]!);
          const maxDev = Math.max(devLo, devHi);
          sumRem += maxDev * r_j;
        }
        lambda[i] = sumRem;
      }

      // 5. Affine drift term: d_k = f0 - Ak * c_k
      const Ak_ck = matrixVectorMultiply(Ak, c_k);
      const dk = new Array<number>(n);
      for (let i = 0; i < n; i++) {
        dk[i] = f0[i]! - Ak_ck[i]!;
      }

      // 6. Effective input set U_eff = Zonotope(dk, diag(lambda)) \oplus distZ
      const uG: number[][] = [];
      for (let j = 0; j < n; j++) {
        if (lambda[j] > 1e-15) {
          const col = new Array<number>(n).fill(0);
          col[j] = lambda[j];
          uG.push(col);
        }
      }
      let U_eff = new Zonotope(dk, uG);
      if (distZ) {
        U_eff = U_eff.minkowskiSum(distZ);
      }

      // 7. Matrix exponential and integral
      const { expM, psiM, remainderNorm, psiRemainderNorm } = computeMatrixExponentialAndIntegral(
        Ak,
        h,
        expansionOrder,
      );

      // 8. Homogeneous propagation + input set
      let nextZ = currentZ.linearMap(expM).minkowskiSum(U_eff.linearMap(psiM));

      // State truncation error:
      let rK = 0;
      for (const iv of currentEnc) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > rK) rK = m;
      }
      const stateTruncRadius = remainderNorm * rK;
      if (stateTruncRadius > 1e-15) {
        const truncBox = Array.from({ length: n }, () => new Interval(-stateTruncRadius, stateTruncRadius));
        nextZ = nextZ.minkowskiSum(Zonotope.fromIntervals(truncBox));
      }

      // Input truncation error:
      const uEnc = U_eff.toIntervals();
      let maxUNorm = 0;
      for (const iv of uEnc) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > maxUNorm) maxUNorm = m;
      }
      const inputTruncRadius = psiRemainderNorm * maxUNorm;
      if (inputTruncRadius > 1e-15) {
        const inputTruncBox = Array.from({ length: n }, () => new Interval(-inputTruncRadius, inputTruncRadius));
        nextZ = nextZ.minkowskiSum(Zonotope.fromIntervals(inputTruncBox));
      }

      // Order reduction
      if (nextZ.generatorCount > maxOrder * n) {
        nextZ = nextZ.reduce(maxOrder);
      }

      const nextEnc = nextZ.toIntervals();

      // 9. Continuous time-interval curvature tube over [t, tNext]:
      const normAk = matrixInfinityNorm(Ak);
      const Ak2 = matrixMultiply(Ak, Ak);
      const normAk2 = matrixInfinityNorm(Ak2);
      let rNext = 0;
      for (const iv of nextEnc) {
        const m = Math.max(Math.abs(iv.lo), Math.abs(iv.hi));
        if (m > rNext) rNext = m;
      }
      const rTube = Math.max(rK, rNext, Math.exp(normAk * h) * (rK + h * maxUNorm));
      const curvRadius = ((h * h) / 8.0) * (normAk2 * rTube + normAk * maxUNorm);

      const tube: Interval[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const lo = Math.min(currentEnc[i]!.lo, nextEnc[i]!.lo) - curvRadius;
        const hi = Math.max(currentEnc[i]!.hi, nextEnc[i]!.hi) + curvRadius;
        tube[i] = new Interval(lo, hi);
      }
      continuousEnclosures.push(tube);

      // 10. Advance nominal trajectory using RK4
      const k1 = dae.f(t, nomX, algNom);
      const xMid1 = nomX.map((xi, i) => xi + 0.5 * h * k1[i]!);
      const k2 = dae.f(t + 0.5 * h, xMid1, algNom);
      const xMid2 = nomX.map((xi, i) => xi + 0.5 * h * k2[i]!);
      const k3 = dae.f(t + 0.5 * h, xMid2, algNom);
      const xEnd = nomX.map((xi, i) => xi + h * k3[i]!);
      const k4 = dae.f(tNext, xEnd, algNom);
      const nextNomX = nomX.map((xi, i) => xi + (h / 6.0) * (k1[i]! + 2 * k2[i]! + 2 * k3[i]! + k4[i]!));

      // 11. Requirement checking
      for (const req of requirements) {
        const inv = tube[req.stateIndex];
        if (!inv) continue;

        let crossed = false;
        let worstVal = inv.mid;
        if (req.operator === "<=" || req.operator === "<") {
          worstVal = inv.hi;
          if (worstVal > req.limitValue) crossed = true;
        } else if (req.operator === ">=" || req.operator === ">") {
          worstVal = inv.lo;
          if (worstVal < req.limitValue) crossed = true;
        }

        if (crossed) {
          let isWitness = false;
          const witnessVal = nextNomX[req.stateIndex]!;
          const witnessTime = tNext;
          if (req.operator === "<=" || req.operator === "<") {
            if (witnessVal > req.limitValue) isWitness = true;
          } else if (req.operator === ">=" || req.operator === ">") {
            if (witnessVal < req.limitValue) isWitness = true;
          }

          if (isWitness) {
            hasWitnessViolation = true;
            violations.push({
              time: witnessTime,
              stateIndex: req.stateIndex,
              operator: req.operator,
              worstCaseValue: worstVal,
              limitValue: req.limitValue,
              isConcreteWitness: true,
              reason: `Concrete nominal trajectory witness breached ${req.name ?? `x[${req.stateIndex}]`} ${req.operator} ${req.limitValue} with value ${witnessVal.toFixed(4)} at t=${witnessTime.toFixed(3)}s.`,
            });
            break;
          } else {
            hasLimitCrossing = true;
            violations.push({
              time: tNext,
              stateIndex: req.stateIndex,
              operator: req.operator,
              worstCaseValue: worstVal,
              limitValue: req.limitValue,
              isConcreteWitness: false,
              reason: `Conservative continuous enclosure [${inv.lo.toFixed(4)}, ${inv.hi.toFixed(4)}] crossed boundary ${req.limitValue} at t=${tNext.toFixed(3)}s (inconclusive).`,
            });
          }
        }
      }

      currentZ = nextZ;
      currentEnc = nextEnc;
      nomX = nextNomX;
      t = tNext;
      steps.push({
        time: t,
        zonotope: currentZ.clone(),
        enclosure: currentEnc,
      });

      if (hasWitnessViolation) {
        break;
      }
    }

    const durationMs = performance.now() - tStart;
    let verdict: VerificationVerdict;
    const isCertifiedSafe = !hasWitnessViolation && !hasLimitCrossing && !timedOut;

    if (hasWitnessViolation) {
      verdict = {
        kind: "violated",
        witness: {
          time: violations[0]!.time,
          state: { [violations[0]!.stateIndex]: violations[0]!.worstCaseValue },
        },
        detail: violations[0]!.reason,
      };
    } else if (timedOut) {
      verdict = {
        kind: "unknown",
        reason: "budget",
        detail: `Keystroke budget of ${budgetMs}ms exceeded at t=${t.toFixed(3)}s across ${steps.length} steps.`,
      };
    } else if (hasLimitCrossing) {
      verdict = {
        kind: "unknown",
        reason: "inconclusive-enclosure",
        detail: `Continuous enclosure crossed requirement boundary across ${violations.length} step(s); no concrete witness found.`,
      };
    } else {
      verdict = {
        kind: "proven",
        rigor: "float-sound",
        detail: `Certified safe across ${steps.length} steps up to t=${tSpan[1]}s with conservative linearization zonotopes and continuous curvature bounds.`,
      };
    }

    const summary = isCertifiedSafe
      ? `Certified safe (float-sound continuous enclosure) across ${steps.length} steps up to t=${tSpan[1]}s (dimension=${n}, max generators=${maxOrder * n}).`
      : hasWitnessViolation
        ? `Safety violation detected (proven): concrete witness found at t=${violations[0]!.time.toFixed(3)}s.`
        : timedOut
          ? `Analysis inconclusive (out-of-budget): reached t=${t.toFixed(3)}s in ${durationMs.toFixed(1)}ms (budget: ${budgetMs}ms).`
          : `Safety violation detected (inconclusive / unknown): enclosure crossed requirement boundary across ${violations.length} step(s).`;

    return {
      verdict,
      isCertifiedSafe,
      totalSteps: steps.length,
      steps,
      continuousEnclosures,
      violations,
      durationMs,
      summary,
    };
  }
}

export interface DroneReachabilityParams {
  m?: number; // Total mass [kg] (1.2)
  A?: number; // Frontal area [m²] (0.03)
  Cd?: number; // Drag coefficient (0.80)
  rho?: number; // Air density [kg/m³] (1.225)
  z_target?: number; // Ceiling altitude target [m] (11.0)
  kz?: number; // Altitude feedback gain [N/m] (3.1)
  kv?: number; // Velocity damping gain [N/(m/s)] (1.35)
  w_max?: number; // Wind disturbance force [N] (0.50)
  v_limit?: number; // SysML v2 velocity limit [m/s] (12.0)
  tSpan?: [number, number]; // Simulation horizon [s] ([0, 5.0])
  dt?: number; // Step size [s] (0.02)
}

export interface DroneReachabilityResult {
  /**
   * Whether the (non-rigorous) linearized zonotope envelope stays below `v_limit`.
   * This is NOT a proof; see `verdict`.
   */
  envelopeWithinLimit: boolean;
  /** Soundness-aware verdict. Always `unknown(not-rigorous)` for this estimator. */
  verdict: VerificationVerdict;
  time: number[];
  nominal: number[];
  zonotopeLo: number[];
  zonotopeHi: number[];
  zonotopeMaxVelocity: number;
  intervalLo: number[];
  intervalHi: number[];
  intervalMaxVelocity: number;
  intervalBreachTime?: number;
  settlingDipVelocity: number;
  durationMs: number;
  summary: string;
}

/**
 * Fast linearized reachability *estimate* for the 2-state drone climb model (z, v).
 *
 * Propagates a zonotope and an interval box through the per-step Jacobian linearization
 * around an explicit-Euler nominal trajectory, illustrating the interval wrapping effect.
 *
 * LIMITATIONS (why the verdict is `unknown(not-rigorous)`):
 *  - the linearization (Lagrange) remainder of the nonlinear drag term is not bounded;
 *  - the nominal trajectory uses explicit Euler without a truncation-error enclosure;
 *  - enclosures are checked only at grid points, not over each time step;
 *  - floating-point rounding is not controlled.
 */
export function simulateDroneReachability(params: DroneReachabilityParams = {}): DroneReachabilityResult {
  const t0 = performance.now();
  const m = params.m ?? 1.2;
  const A = params.A ?? 0.03;
  const Cd = params.Cd ?? 0.8;
  const rho = params.rho ?? 1.225;
  const z_target = params.z_target ?? 11.0;
  const kz = params.kz ?? 3.1;
  const kv = params.kv ?? 1.35;
  const w_max = params.w_max ?? 0.5;
  const v_limit = params.v_limit ?? 12.0;

  const dt = params.dt ?? 0.02;
  const t_end = params.tSpan ? params.tSpan[1] : 5.0;
  const N = Math.round(t_end / dt) + 1;

  const time: number[] = new Array(N);
  for (let i = 0; i < N; i++) time[i] = parseFloat((i * dt).toFixed(3));

  const nom = new Float64Array(N);
  const c_z: [number, number][] = Array.from({ length: N }, () => [0.0, 0.0]);
  const z_lo = new Float64Array(N);
  const z_hi = new Float64Array(N);
  const i_lo = new Float64Array(N);
  const i_hi = new Float64Array(N);

  const delta0 = [0.05, 0.2];
  let G_z = [
    [delta0[0], 0.0],
    [0.0, delta0[1]],
  ];
  const int_rad = [delta0[0], delta0[1]];

  z_lo[0] = -delta0[1];
  z_hi[0] = delta0[1];
  i_lo[0] = -delta0[1];
  i_hi[0] = delta0[1];

  let intervalBreachTime: number | undefined;
  let zonotopeMaxV = 0.0;
  let intervalMaxV = 0.0;
  let settlingDipV = 0.0;

  for (let k = 0; k < N - 1; k++) {
    const zk = c_z[k][0];
    const vk = c_z[k][1];

    const drag = 0.5 * Cd * rho * A * vk * Math.abs(vk);
    const thrust_net = kz * (z_target - zk) - kv * vk;
    const dv = (thrust_net - drag) / m;
    const dz = vk;

    c_z[k + 1][0] = zk + dz * dt;
    c_z[k + 1][1] = vk + dv * dt;
    nom[k + 1] = c_z[k + 1][1];

    if (nom[k + 1] < settlingDipV) settlingDipV = nom[k + 1];

    const df2_dz = -kz / m;
    const df2_dv = -(kv + Cd * rho * A * Math.abs(vk)) / m;
    const A_mat = [
      [0.0, 1.0],
      [df2_dz, df2_dv],
    ];

    const A2_00 = A_mat[0][1] * A_mat[1][0];
    const A2_01 = A_mat[0][1] * A_mat[1][1];
    const A2_10 = A_mat[1][1] * A_mat[1][0];
    const A2_11 = A_mat[1][0] * A_mat[0][1] + A_mat[1][1] * A_mat[1][1];

    const Phi = [
      [1.0 + 0.5 * A2_00 * dt * dt, A_mat[0][1] * dt + 0.5 * A2_01 * dt * dt],
      [A_mat[1][0] * dt + 0.5 * A2_10 * dt * dt, 1.0 + A_mat[1][1] * dt + 0.5 * A2_11 * dt * dt],
    ];

    const w_step = (w_max / m) * dt;

    // Zonotope propagation
    const numG = G_z[0].length;
    const newG0 = new Array(numG + 2);
    const newG1 = new Array(numG + 2);
    for (let j = 0; j < numG; j++) {
      newG0[j] = Phi[0][0] * G_z[0][j] + Phi[0][1] * G_z[1][j];
      newG1[j] = Phi[1][0] * G_z[0][j] + Phi[1][1] * G_z[1][j];
    }
    newG0[numG] = 0.005;
    newG1[numG] = 0.0;
    newG0[numG + 1] = 0.0;
    newG1[numG + 1] = w_step;

    if (newG0.length > 18) {
      const scored = newG0.map((g0, idx) => ({ idx, len: Math.hypot(g0, newG1[idx]) })).sort((a, b) => b.len - a.len);
      const keep0 = [];
      const keep1 = [];
      let remSum0 = 0.0,
        remSum1 = 0.0;
      for (let i = 0; i < scored.length; i++) {
        const origIdx = scored[i].idx;
        if (i < 12) {
          keep0.push(newG0[origIdx]);
          keep1.push(newG1[origIdx]);
        } else {
          remSum0 += Math.abs(newG0[origIdx]);
          remSum1 += Math.abs(newG1[origIdx]);
        }
      }
      keep0.push(remSum0, 0.0);
      keep1.push(0.0, remSum1);
      G_z = [keep0, keep1];
    } else {
      G_z = [newG0, newG1];
    }

    let rad_v = 0.0;
    for (let j = 0; j < G_z[1].length; j++) rad_v += Math.abs(G_z[1][j]);
    z_lo[k + 1] = c_z[k + 1][1] - rad_v;
    z_hi[k + 1] = c_z[k + 1][1] + rad_v;
    if (z_hi[k + 1] > zonotopeMaxV) zonotopeMaxV = z_hi[k + 1];

    // Interval Wrapping Blowup
    const next_rad0 = Math.abs(Phi[0][0]) * int_rad[0] + Math.abs(Phi[0][1]) * int_rad[1] + 0.005;
    const next_rad1 = Math.abs(Phi[1][0]) * int_rad[0] + Math.abs(Phi[1][1]) * int_rad[1] + w_step;
    int_rad[0] = next_rad0;
    int_rad[1] = next_rad1;

    i_lo[k + 1] = c_z[k + 1][1] - int_rad[1];
    i_hi[k + 1] = c_z[k + 1][1] + int_rad[1];
    if (i_hi[k + 1] > intervalMaxV) intervalMaxV = i_hi[k + 1];

    if (intervalBreachTime === undefined && i_hi[k + 1] > v_limit) {
      intervalBreachTime = time[k + 1];
    }
  }

  const durationMs = performance.now() - t0;
  const envelopeWithinLimit = zonotopeMaxV <= v_limit;
  const verdict: VerificationVerdict = {
    kind: "unknown",
    reason: "not-rigorous",
    rigor: "heuristic",
    detail: "Linearized zonotope estimate without a bound on the linearization remainder.",
  };

  return {
    envelopeWithinLimit,
    verdict,
    time,
    nominal: Array.from(nom),
    zonotopeLo: Array.from(z_lo),
    zonotopeHi: Array.from(z_hi),
    zonotopeMaxVelocity: parseFloat(zonotopeMaxV.toFixed(2)),
    intervalLo: Array.from(i_lo),
    intervalHi: Array.from(i_hi),
    intervalMaxVelocity: parseFloat(intervalMaxV.toFixed(2)),
    intervalBreachTime,
    settlingDipVelocity: parseFloat(settlingDipV.toFixed(2)),
    durationMs: parseFloat(durationMs.toFixed(2)),
    summary: envelopeWithinLimit
      ? `Linearized zonotope estimate (non-rigorous): peak velocity ${zonotopeMaxV.toFixed(2)} m/s <= ${v_limit} m/s in ${durationMs.toFixed(2)} ms.`
      : `Linearized zonotope estimate (non-rigorous): peak velocity ${zonotopeMaxV.toFixed(2)} m/s exceeds ${v_limit} m/s.`,
  };
}
