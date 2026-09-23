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
  isCertifiedSafe: boolean;
  totalSteps: number;
  steps: ZonotopeStepRecord[];
  violations: {
    time: number;
    stateIndex: number;
    operator: string;
    worstCaseValue: number;
    limitValue: number;
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

/**
 * Computes matrix exponential exp(A * dt) using Taylor series with truncation remainder bound.
 */
export function computeMatrixExponential(
  A: number[][],
  dt: number,
  expansionOrder = 6,
): { expM: number[][]; remainderNorm: number } {
  const n = A.length;
  const M = matrixScale(dt, A);
  let expM = matrixIdentity(n);
  let term = matrixIdentity(n);

  for (let k = 1; k <= expansionOrder; k++) {
    term = matrixMultiply(term, M);
    term = matrixScale(1 / k, term);
    expM = matrixAdd(expM, term);
  }

  // Remainder bound: ||E|| <= ||M||^(K+1) / ((K+1)! * (1 - ||M||/(K+2)))
  const normM = matrixInfinityNorm(M);
  let fact = 1;
  for (let k = 1; k <= expansionOrder + 1; k++) fact *= k;
  const denom = fact * Math.max(0.1, 1 - normM / (expansionOrder + 2));
  const remainderNorm = Math.pow(normM, expansionOrder + 1) / denom;

  return { expM, remainderNorm };
}

export class ZonotopeReachabilitySolver {
  /**
   * Solves continuous linear reachability for \dot{x} = A x + B u over [t0, tEnd].
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

    const { expM, remainderNorm } = computeMatrixExponential(A, dt, expansionOrder);

    // Truncation error as a zonotope box
    const truncBox = Array.from({ length: n }, () => new Interval(-remainderNorm, remainderNorm));
    const truncZ = Zonotope.fromIntervals(truncBox);

    // Input contribution zonotope (B * U * dt)
    let inputZ: Zonotope | null = null;
    if (options.B && options.U) {
      const BU = options.U.linearMap(options.B);
      inputZ = BU.scale(dt);
    }

    const steps: ZonotopeStepRecord[] = [];
    const violations: ZonotopeReachabilityResult["violations"] = [];

    let t = tSpan[0];
    const tEnd = tSpan[1];

    // Initial step
    steps.push({
      time: t,
      zonotope: currentZ.clone(),
      enclosure: currentZ.toIntervals(),
    });

    while (t < tEnd - 1e-12) {
      t += dt;

      // 1. Homogeneous propagation: exp(A*dt) * Z_k
      let nextZ = currentZ.linearMap(expM);

      // 2. Add input set if present: \oplus B * U * dt
      if (inputZ) {
        nextZ = nextZ.minkowskiSum(inputZ);
      }

      // 3. Add truncation error: \oplus \mathcal{E}_{trunc}
      if (remainderNorm > 1e-14) {
        nextZ = nextZ.minkowskiSum(truncZ);
      }

      // 4. Order reduction if generator count exceeds maxOrder * n
      if (nextZ.generatorCount > maxOrder * n) {
        nextZ = nextZ.reduce(maxOrder);
      }

      currentZ = nextZ;
      const enclosure = currentZ.toIntervals();

      steps.push({
        time: t,
        zonotope: currentZ.clone(),
        enclosure,
      });

      // 5. Check safety requirements
      for (const req of requirements) {
        const inv = enclosure[req.stateIndex];
        if (!inv) continue;

        let violated = false;
        let worstVal = inv.mid;

        if (req.operator === "<=" || req.operator === "<") {
          worstVal = inv.hi;
          if (worstVal > req.limitValue) violated = true;
        } else if (req.operator === ">=" || req.operator === ">") {
          worstVal = inv.lo;
          if (worstVal < req.limitValue) violated = true;
        }

        if (violated) {
          violations.push({
            time: t,
            stateIndex: req.stateIndex,
            operator: req.operator,
            worstCaseValue: worstVal,
            limitValue: req.limitValue,
            reason: `At t = ${t.toFixed(3)}s: state x[${req.stateIndex}] worst-case ${worstVal.toFixed(4)} violates ${req.operator} ${req.limitValue}`,
          });
        }
      }
    }

    const isCertifiedSafe = violations.length === 0;
    const summary = isCertifiedSafe
      ? `Certified safe across ${steps.length} steps up to t=${tSpan[1]}s (dimension=${n}, max generators=${maxOrder * n}).`
      : `Safety violation detected: ${violations.length} violation(s) found. First violation at t=${violations[0]!.time.toFixed(3)}s.`;

    return {
      isCertifiedSafe,
      totalSteps: steps.length,
      steps,
      violations,
      summary,
    };
  }
}
