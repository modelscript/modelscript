// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, EqKind, Variability, differentiateArenaExpressionWrt } from "@modelscript/compiler";
import { evaluateArenaRuntime } from "./arena-eval-runtime.js";

/** Result of initial equation solving natively on the arena. */
export interface ArenaInitSolverResult {
  valuesByStringId: Float64Array;
  iterations: number;
  residualNorm: number;
  converged: boolean;
}

/**
 * LU decomposition with partial pivoting for the Newton linear system.
 */
function solveLU(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row) => [...row]);
  const rhs = [...b];
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
      [rhs[k], rhs[maxRow]] = [rhs[maxRow] ?? 0, rhs[k] ?? 0];
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
      rhs[i] = (rhs[i] ?? 0) - factor * (rhs[k] ?? 0);
    }
  }

  const x = new Array(n).fill(0) as number[];
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i] ?? 0;
    const row = M[i];
    if (row) {
      for (let j = i + 1; j < n; j++) {
        sum -= (row[j] ?? 0) * (x[j] ?? 0);
      }
      const diag = row[i] ?? 1;
      x[i] = Math.abs(diag) > 1e-30 ? sum / diag : 0;
    }
  }
  return x;
}

/**
 * Solve the initial equations natively on the ArenaDAEBuilder using Newton-Raphson
 * with exact symbolic analytical Jacobians computed directly on the integer arena buffer.
 *
 * @param arena The ArenaDAEBuilder containing the equations.
 * @param initialValues A Float64Array populated with start values and parameters.
 * @returns Solver result with computed initial values.
 */
export function solveInitialEquationsArena(arena: ArenaDAEBuilder, initialValues: Float64Array): ArenaInitSolverResult {
  const result: ArenaInitSolverResult = {
    valuesByStringId: new Float64Array(initialValues),
    iterations: 0,
    residualNorm: 0,
    converged: true,
  };

  const initialEqIndices: number[] = [];
  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.getEqKind(i) === EqKind.InitialSimple) {
      initialEqIndices.push(i);
    }
  }

  if (initialEqIndices.length === 0) return result;

  // Identify unknowns (StringIds that are not parameters/constants and not fixed)
  // For simplicity in this porting step, we extract state variables and their derivatives as unknowns.
  // In a full implementation, we intersect referenced variables in initialEqs with non-fixed variables.
  const unknowns = new Set<number>();

  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    // Assume we want to solve for variables that are not fixed and not parameters
    if (arena.getVarVariability(i) === Variability.Parameter || arena.getVarVariability(i) === Variability.Constant) {
      continue;
    }
    if (arena.isVarFixed(i)) {
      continue;
    }
    unknowns.add(arena.getVarNameId(i));

    // Also include der(x) as an unknown
    const derNameId = arena.interner.intern(`der(${arena.getVarName(i)})`);
    unknowns.add(derNameId);
  }

  const unknownList = Array.from(unknowns);
  const nUnknowns = unknownList.length;
  const nResiduals = initialEqIndices.length;

  if (nResiduals === 0 || nUnknowns === 0) return result;

  const nSolve = Math.min(nResiduals, nUnknowns);

  // Formulate R_i = LHS - RHS
  const residualExprIds: number[] = [];
  for (let i = 0; i < nSolve; i++) {
    const eqIdx = initialEqIndices[i] ?? -1;
    if (eqIdx === -1) continue;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);
    const residual = arena.addBinaryExpr(BinOp.Sub, lhs, rhs);
    residualExprIds.push(residual);
  }

  // Precompute symbolic analytical Jacobian ExprIds: J_ij = dR_i / dz_j
  const jacobianExprIds: number[][] = [];
  for (let i = 0; i < nSolve; i++) {
    const row: number[] = [];
    const Ri = residualExprIds[i] ?? -1;
    if (Ri === -1) continue;
    for (let j = 0; j < nSolve; j++) {
      const zj = unknownList[j] ?? -1;
      if (zj === -1) continue;
      const dRi_dzj = differentiateArenaExpressionWrt(arena, Ri, zj);
      row.push(dRi_dzj);
    }
    jacobianExprIds.push(row);
  }

  const maxIter = 50;
  const tol = 1e-10;

  for (let iter = 0; iter < maxIter; iter++) {
    result.iterations = iter + 1;

    // Evaluate Residuals and Jacobian
    const R = new Array(nSolve).fill(0) as number[];
    const J: number[][] = [];
    for (let i = 0; i < nSolve; i++) {
      J[i] = new Array(nSolve).fill(0) as number[];
    }

    for (let i = 0; i < nSolve; i++) {
      const exprId = residualExprIds[i] ?? -1;
      if (exprId !== -1) {
        R[i] = evaluateArenaRuntime(arena, exprId, result.valuesByStringId);
      }
      const Ji = J[i];
      if (Ji) {
        for (let j = 0; j < nSolve; j++) {
          const J_ij = jacobianExprIds[i]?.[j] ?? -1;
          if (J_ij !== -1) {
            Ji[j] = evaluateArenaRuntime(arena, J_ij, result.valuesByStringId);
          }
        }
      }
    }

    let norm = 0;
    for (let i = 0; i < nSolve; i++) {
      norm += Math.abs(R[i] ?? 0);
    }
    result.residualNorm = norm;

    if (norm < tol) {
      result.converged = true;
      break;
    }

    const negR = R.map((r) => -r);
    const dz = solveLU(J, negR, nSolve);

    // Apply Newton step
    for (let i = 0; i < nSolve; i++) {
      const zj = unknownList[i] ?? -1;
      if (zj !== -1) {
        result.valuesByStringId[zj] = (result.valuesByStringId[zj] ?? 0) + (dz[i] ?? 0);
      }
    }

    if (iter === maxIter - 1) {
      result.converged = false;
    }
  }

  return result;
}
