// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  ArenaDAEBuilder,
  BinOp,
  EqKind,
  ExprKind,
  Variability,
  differentiateArenaExpressionWrt,
} from "@modelscript/compiler";
import { evaluateArenaRuntime } from "../evaluator/eval-runtime.js";

/** Result of initial equation solving natively on the arena. */
export interface ArenaInitSolverResult {
  valuesByStringId: Float64Array;
  iterations: number;
  residualNorm: number;
  converged: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// LU Decomposition with Partial Pivoting
// ─────────────────────────────────────────────────────────────────────────

function solveLU(A: number[][], b: number[], n: number): number[] {
  const M = A.map((row) => [...row]);
  const rhs = [...b];

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

// ─────────────────────────────────────────────────────────────────────────
// Structural Sparsity: Collect ExprKind.Name references from an expression
// ─────────────────────────────────────────────────────────────────────────

function collectExprNameIds(arena: ArenaDAEBuilder, exprId: number, nameIds: Set<number>): void {
  if (exprId < 0) return;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    nameIds.add(arena.getExprData1(exprId));
    return;
  }
  // Recurse into children based on ExprKind layout
  const data1 = arena.getExprData1(exprId);
  const left = arena.getExprLeft(exprId);
  const right = arena.getExprRight(exprId);

  switch (kind) {
    case ExprKind.Unary:
    case ExprKind.Negate:
    case ExprKind.Der:
    case ExprKind.Pre:
      collectExprNameIds(arena, left, nameIds);
      break;
    case ExprKind.Binary:
      collectExprNameIds(arena, left, nameIds);
      collectExprNameIds(arena, right, nameIds);
      break;
    case ExprKind.IfElse:
      collectExprNameIds(arena, data1, nameIds);
      collectExprNameIds(arena, left, nameIds);
      collectExprNameIds(arena, right, nameIds);
      break;
    case ExprKind.Call: {
      // Walk arguments: first arg is in `left`, subsequent in Tuple entries at exprId+i
      const argCount = right;
      if (argCount > 0) collectExprNameIds(arena, left, nameIds);
      for (let i = 1; i < argCount; i++) {
        collectExprNameIds(arena, arena.getExprLeft(exprId + i), nameIds);
      }
      break;
    }
    case ExprKind.Subscript:
      collectExprNameIds(arena, data1, nameIds);
      collectExprNameIds(arena, left, nameIds);
      break;
    case ExprKind.ArrayCtor: {
      const count = data1;
      if (count > 0) collectExprNameIds(arena, left, nameIds);
      for (let i = 1; i < count; i++) {
        collectExprNameIds(arena, arena.getExprLeft(exprId + i), nameIds);
      }
      break;
    }
    case ExprKind.Range:
      collectExprNameIds(arena, data1, nameIds);
      if (left >= 0) collectExprNameIds(arena, left, nameIds);
      collectExprNameIds(arena, right, nameIds);
      break;
    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Core Init Solver
// ─────────────────────────────────────────────────────────────────────────

/**
 * Solve the initial equations natively on the ArenaDAEBuilder using Newton-Raphson
 * with structural sparsity, exact symbolic Jacobians, and homotopy continuation fallback.
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

  // ── Step 1: Collect initial equations ──
  const initialEqIndices: number[] = [];
  for (let i = 0; i < arena.eqCount; i++) {
    if (arena.getEqKind(i) === EqKind.InitialSimple) {
      initialEqIndices.push(i);
    }
  }
  if (initialEqIndices.length === 0) return result;

  // ── Step 2: Identify unknowns via intersection ──
  // Build set of variable StringIds that are not parameters/constants and not fixed
  const solvableVarNameIds = new Set<number>();
  for (let i = 0; i < arena.varCount; i++) {
    if (arena.isVarRemoved(i)) continue;
    const v = arena.getVarVariability(i);
    if (v === Variability.Parameter || v === Variability.Constant) continue;
    if (arena.isVarFixed(i)) continue;

    const nameId = arena.getVarNameId(i);
    solvableVarNameIds.add(nameId);

    // Also include der(x) as solvable
    const derNameId = arena.interner.intern(`der(${arena.getVarName(i)})`);
    solvableVarNameIds.add(derNameId);
  }

  // Collect all variable name IDs actually referenced in the initial equations
  const referencedNameIds = new Set<number>();
  for (const eqIdx of initialEqIndices) {
    collectExprNameIds(arena, arena.getEqLhs(eqIdx), referencedNameIds);
    collectExprNameIds(arena, arena.getEqRhs(eqIdx), referencedNameIds);
  }

  // Remove "time" from unknowns
  const timeId = arena.interner.intern("time");
  referencedNameIds.delete(timeId);

  // Unknowns = intersection of solvable variables and referenced variables
  const unknownList: number[] = [];
  for (const nameId of referencedNameIds) {
    if (solvableVarNameIds.has(nameId)) {
      unknownList.push(nameId);
    }
  }

  const nUnknowns = unknownList.length;
  const nResiduals = initialEqIndices.length;
  if (nResiduals === 0 || nUnknowns === 0) return result;
  const nSolve = Math.min(nResiduals, nUnknowns);

  // ── Step 3: Build residual expressions R_i = LHS_i - RHS_i ──
  const residualExprIds: number[] = [];
  for (let i = 0; i < nSolve; i++) {
    const eqIdx = initialEqIndices[i] ?? -1;
    if (eqIdx === -1) continue;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);
    residualExprIds.push(arena.addBinaryExpr(BinOp.Sub, lhs, rhs));
  }

  // ── Step 4: Compute structural sparsity pattern ──
  // sparsityPattern[i] = set of column indices j where ∂R_i/∂z_j may be nonzero
  const sparsityPattern: Set<number>[] = [];
  for (let i = 0; i < nSolve; i++) {
    const exprId = residualExprIds[i] ?? -1;
    const deps = new Set<number>();
    collectExprNameIds(arena, exprId, deps);

    const nonzeroColumns = new Set<number>();
    for (let j = 0; j < nSolve; j++) {
      const zj = unknownList[j] as number;
      if (deps.has(zj)) {
        nonzeroColumns.add(j);
      }
    }
    sparsityPattern.push(nonzeroColumns);
  }

  // ── Step 5: Precompute symbolic Jacobian entries (only for structurally nonzero) ──
  const jacobianExprIds: (number | -1)[][] = [];
  for (let i = 0; i < nSolve; i++) {
    const row: (number | -1)[] = new Array(nSolve).fill(-1) as (number | -1)[];
    const Ri = residualExprIds[i] ?? -1;
    if (Ri === -1) {
      jacobianExprIds.push(row);
      continue;
    }
    const pattern = sparsityPattern[i] as Set<number>;
    for (const j of pattern) {
      const zj = unknownList[j] as number;
      row[j] = differentiateArenaExpressionWrt(arena, Ri, zj);
    }
    jacobianExprIds.push(row);
  }

  // ── Step 6: Newton-Raphson iteration ──
  const maxIter = 50;
  const tol = 1e-10;

  const converged = runNewton(
    arena,
    result,
    residualExprIds,
    jacobianExprIds,
    sparsityPattern,
    unknownList,
    nSolve,
    maxIter,
    tol,
  );

  // ── Step 7: Homotopy continuation fallback ──
  if (!converged) {
    const homotopyConverged = runHomotopy(
      arena,
      result,
      residualExprIds,
      jacobianExprIds,
      sparsityPattern,
      unknownList,
      nSolve,
      tol,
      initialValues,
    );
    result.converged = homotopyConverged;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Newton-Raphson with Sparse Analytical Jacobian
// ─────────────────────────────────────────────────────────────────────────

function runNewton(
  arena: ArenaDAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  maxIter: number,
  tol: number,
): boolean {
  for (let iter = 0; iter < maxIter; iter++) {
    result.iterations = iter + 1;

    // Evaluate residuals
    const R = new Array(nSolve).fill(0) as number[];
    for (let i = 0; i < nSolve; i++) {
      const exprId = residualExprIds[i] ?? -1;
      if (exprId !== -1) {
        R[i] = evaluateArenaRuntime(arena, exprId, result.valuesByStringId);
      }
    }

    // Check convergence
    let norm = 0;
    for (let i = 0; i < nSolve; i++) norm += Math.abs(R[i] ?? 0);
    result.residualNorm = norm;

    if (norm < tol) {
      result.converged = true;
      return true;
    }

    // Evaluate Jacobian (sparse: only structurally nonzero entries)
    const J: number[][] = [];
    for (let i = 0; i < nSolve; i++) {
      const row = new Array(nSolve).fill(0) as number[];
      const pattern = sparsityPattern[i] as Set<number>;
      const jRow = jacobianExprIds[i];
      if (jRow) {
        for (const j of pattern) {
          const jExprId = jRow[j] ?? -1;
          if (jExprId !== -1) {
            row[j] = evaluateArenaRuntime(arena, jExprId, result.valuesByStringId);
          }
        }
      }
      J.push(row);
    }

    // Solve J · Δz = -R
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

  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// Homotopy Continuation
//
// Defines H(z, λ) = λ·R(z) + (1-λ)·(z - z₀) where:
//   λ = 0 → trivial solution z = z₀ (start values)
//   λ = 1 → actual system R(z) = 0
//
// Steps λ from 0 to 1 in adaptive increments, running Newton-Raphson
// with the sparse analytical Jacobian of H(z,λ) at each step.
// ─────────────────────────────────────────────────────────────────────────

function runHomotopy(
  arena: ArenaDAEBuilder,
  result: ArenaInitSolverResult,
  residualExprIds: number[],
  jacobianExprIds: (number | -1)[][],
  sparsityPattern: Set<number>[],
  unknownList: number[],
  nSolve: number,
  tol: number,
  initialValues: Float64Array,
): boolean {
  // Save start values z₀
  const z0 = new Float64Array(nSolve);
  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i] as number;
    z0[i] = initialValues[zj] ?? 0;
  }

  // Reset z to z₀
  for (let i = 0; i < nSolve; i++) {
    const zj = unknownList[i] as number;
    result.valuesByStringId[zj] = z0[i] as number;
  }

  let lambda = 0;
  let lambdaStep = 0.1;
  const maxTotalIter = 200;
  let totalIter = 0;

  while (lambda < 1.0 && totalIter < maxTotalIter) {
    const targetLambda = Math.min(lambda + lambdaStep, 1.0);

    let convergedAtLambda = false;
    const maxNewtonIter = 20;

    for (let iter = 0; iter < maxNewtonIter && totalIter < maxTotalIter; iter++) {
      totalIter++;
      result.iterations++;

      // Evaluate homotopy residuals: H_i = λ·R_i(z) + (1-λ)·(z_i - z0_i)
      const H = new Array(nSolve).fill(0) as number[];
      for (let i = 0; i < nSolve; i++) {
        const exprId = residualExprIds[i] ?? -1;
        const Ri = exprId !== -1 ? evaluateArenaRuntime(arena, exprId, result.valuesByStringId) : 0;
        const zj = unknownList[i] as number;
        const zi = result.valuesByStringId[zj] ?? 0;
        H[i] = targetLambda * Ri + (1 - targetLambda) * (zi - (z0[i] as number));
      }

      // Check convergence
      let norm = 0;
      for (let i = 0; i < nSolve; i++) norm += Math.abs(H[i] ?? 0);
      result.residualNorm = norm;

      if (norm < tol) {
        convergedAtLambda = true;
        break;
      }

      // Homotopy Jacobian: ∂H_i/∂z_j = λ·∂R_i/∂z_j + (1-λ)·δ_{ij}
      const J: number[][] = [];
      for (let i = 0; i < nSolve; i++) {
        const row = new Array(nSolve).fill(0) as number[];
        // Identity contribution: (1-λ) on diagonal
        row[i] = 1 - targetLambda;

        // λ · ∂R_i/∂z_j for structurally nonzero entries
        const pattern = sparsityPattern[i] as Set<number>;
        const jRow = jacobianExprIds[i];
        if (jRow) {
          for (const j of pattern) {
            const jExprId = jRow[j] ?? -1;
            if (jExprId !== -1) {
              row[j] = (row[j] ?? 0) + targetLambda * evaluateArenaRuntime(arena, jExprId, result.valuesByStringId);
            }
          }
        }
        J.push(row);
      }

      // Solve J · Δz = -H
      const negH = H.map((h) => -(h ?? 0));
      const dz = solveLU(J, negH, nSolve);

      for (let i = 0; i < nSolve; i++) {
        const zj = unknownList[i] as number;
        result.valuesByStringId[zj] = (result.valuesByStringId[zj] ?? 0) + (dz[i] ?? 0);
      }
    }

    if (convergedAtLambda) {
      lambda = targetLambda;
      // Increase step size on success
      lambdaStep = Math.min(lambdaStep * 1.5, 0.5);
    } else {
      // Decrease step size and retry
      lambdaStep *= 0.5;
      if (lambdaStep < 1e-6) break; // Give up
    }
  }

  return lambda >= 1.0 - 1e-10;
}
