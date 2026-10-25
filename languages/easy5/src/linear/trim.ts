// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Easy5Model } from "../types.js";
import { buildModelEvaluator } from "./jacobian.js";

export interface TrimResult {
  converged: boolean;
  iterations: number;
  residualNorm: number;
  trimmedStates: Record<string, number>;
  trimmedInputs: Record<string, number>;
  trimmedOutputs: Record<string, number>;
}

/**
 * Solves for the equilibrium operating point (dx/dt = 0) of an EASY5 model.
 */
export function trimEasy5(
  model: Easy5Model,
  options?: {
    maxIterations?: number | undefined;
    tolerance?: number | undefined;
    initialStates?: Record<string, number> | undefined;
    initialInputs?: Record<string, number> | undefined;
  },
): TrimResult {
  const ctx = buildModelEvaluator(model);
  const n = ctx.stateNames.length;

  const maxIter = options?.maxIterations ?? 50;
  const tol = options?.tolerance ?? 1e-6;

  // Initialize state and input vectors
  const x: number[] = ctx.stateNames.map((name) => options?.initialStates?.[name] ?? 0.0);
  const u: number[] = ctx.inputNames.map((name) => options?.initialInputs?.[name] ?? 0.0);

  if (n === 0) {
    // Purely algebraic system
    const res = ctx.evalModel(x, u);
    const trimmedOutputs: Record<string, number> = {};
    for (let i = 0; i < ctx.outputNames.length; i++) {
      trimmedOutputs[ctx.outputNames[i]!] = res.y[i] ?? 0.0;
    }
    return {
      converged: true,
      iterations: 0,
      residualNorm: 0.0,
      trimmedStates: {},
      trimmedInputs: {},
      trimmedOutputs,
    };
  }

  let iter = 0;
  let residualNorm = Infinity;
  const eps = 1e-6;

  for (iter = 0; iter < maxIter; iter++) {
    const cur = ctx.evalModel(x, u);
    residualNorm = Math.sqrt(cur.dx.reduce((sum, val) => sum + val * val, 0));

    if (residualNorm < tol) {
      break;
    }

    // Compute Jacobian J = d(dx)/dx (n x n)
    const J: number[][] = Array.from({ length: n }, () => new Array(n).fill(0.0));
    for (let j = 0; j < n; j++) {
      const xP = [...x];
      const xM = [...x];
      const curP = xP[j];
      const curM = xM[j];
      if (curP !== undefined) xP[j] = curP + eps;
      if (curM !== undefined) xM[j] = curM - eps;
      const resP = ctx.evalModel(xP, u);
      const resM = ctx.evalModel(xM, u);
      for (let i = 0; i < n; i++) {
        J[i]![j] = (resP.dx[i]! - resM.dx[i]!) / (2.0 * eps);
      }
    }

    // Solve J * deltaX = -dx with Levenberg-Marquardt damping: (J^T J + lambda I) deltaX = -J^T dx
    const lambda = 1e-4 * Math.max(1.0, residualNorm);
    const JT = transpose(J);
    const JTJ = matMul(JT, J);
    for (let i = 0; i < n; i++) {
      const row = JTJ[i];
      if (row) {
        const curVal = row[i];
        if (curVal !== undefined) row[i] = curVal + lambda;
      }
    }

    const negJTdx = matVecMul(
      JT,
      cur.dx.map((v) => -v),
    );
    const deltaX = solveLinearSystem(JTJ, negJTdx);

    if (!deltaX) {
      // Damped gradient step fallback
      for (let i = 0; i < n; i++) {
        const xi = x[i];
        const dxi = cur.dx[i];
        if (xi !== undefined && dxi !== undefined) x[i] = xi - 0.1 * dxi;
      }
    } else {
      // Line search / update
      for (let i = 0; i < n; i++) {
        const xi = x[i];
        const dxi = deltaX[i];
        if (xi !== undefined && dxi !== undefined) x[i] = xi + dxi;
      }
    }
  }

  const finalRes = ctx.evalModel(x, u);
  const trimmedStates: Record<string, number> = {};
  for (let i = 0; i < ctx.stateNames.length; i++) trimmedStates[ctx.stateNames[i]!] = x[i]!;

  const trimmedInputs: Record<string, number> = {};
  for (let i = 0; i < ctx.inputNames.length; i++) trimmedInputs[ctx.inputNames[i]!] = u[i]!;

  const trimmedOutputs: Record<string, number> = {};
  for (let i = 0; i < ctx.outputNames.length; i++) trimmedOutputs[ctx.outputNames[i]!] = finalRes.y[i]!;

  return {
    converged: residualNorm < tol * 10,
    iterations: iter,
    residualNorm,
    trimmedStates,
    trimmedInputs,
    trimmedOutputs,
  };
}

function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0] ? A[0].length : 0;
  const res: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0.0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      res[c]![r] = A[r]![c]!;
    }
  }
  return res;
}

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = B[0] ? B[0].length : 0;
  const inner = B.length;
  const res: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0.0));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0.0;
      for (let k = 0; k < inner; k++) sum += A[r]![k]! * B[k]![c]!;
      res[r]![c] = sum;
    }
  }
  return res;
}

function matVecMul(A: number[][], v: number[]): number[] {
  const rows = A.length;
  const res = new Array(rows).fill(0.0);
  for (let r = 0; r < rows; r++) {
    let sum = 0.0;
    for (let c = 0; c < v.length; c++) sum += A[r]![c]! * v[c]!;
    res[r] = sum;
  }
  return res;
}

/**
 * Solves M * x = b via Gaussian elimination with partial pivoting.
 */
function solveLinearSystem(M: number[][], b: number[]): number[] | null {
  const n = M.length;
  const A = M.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(A[col]![col]!);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(A[row]![col]!);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) return null; // Singular

    // Swap rows
    const temp = A[col]!;
    A[col] = A[maxRow]!;
    A[maxRow] = temp;

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const rowA = A[row];
      const colA = A[col];
      const diagVal = colA ? colA[col] : undefined;
      const curRowVal = rowA ? rowA[col] : undefined;
      if (!rowA || !colA || diagVal === undefined || curRowVal === undefined) continue;
      const factor = curRowVal / diagVal;
      for (let k = col; k <= n; k++) {
        const rVal = rowA[k];
        const cVal = colA[k];
        if (rVal !== undefined && cVal !== undefined) {
          rowA[k] = rVal - factor * cVal;
        }
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0.0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = A[row]![n]!;
    for (let col = row + 1; col < n; col++) {
      sum -= A[row]![col]! * x[col]!;
    }
    x[row] = sum / A[row]![row]!;
  }
  return x;
}
