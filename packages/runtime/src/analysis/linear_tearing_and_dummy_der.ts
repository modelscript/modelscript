// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/runtime — Symbolic Linear-Loop Elimination & Mattsson-Söderlind Dynamic Dummy Derivatives.
 *
 * Implements:
 *   1. Affine/Linear SCC Classifier (`isExprAffineInUnknowns`, `analyzeLinearSccBlock`):
 *      Statically proves whether a coupled algebraic loop (BLT SCC) is linear in its unknowns,
 *      extracts symbolic matrix entries `A_{ij}(x, p)` and RHS `b_i(x, p)`, and solves in 0 Newton
 *      iterations (closed-form for k=1,2; single LU solve for k>=3).
 *   2. Mattsson-Söderlind Dynamic State Selection (`DynamicDummyDerivativeSelector`):
 *      Monitors the constraint Jacobian `G = ∂g/∂q` of high-index DAE constraints (e.g., Cartesian
 *      pendulum `x^2 + y^2 = L^2`) and dynamically pivots the active differential state / dummy
 *      derivative partition whenever the current pivot becomes ill-conditioned.
 */

import { BinOp, DAEBuilder, ExprKind, UnaryOp, differentiateArenaExpression } from "../dae/wasm_dae.js";
import { evaluateArenaRuntime } from "../dae/wasm_evaluator.js";
import { luFactorFlat, luSolveFlat } from "../solvers/wasm_gaussian.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Symbolic Linear-Loop Classifier & Direct Eliminator
// ─────────────────────────────────────────────────────────────────────────────

function exprDependsOnUnknowns(arena: DAEBuilder, exprId: number, unknownNameIds: Set<number>): boolean {
  if (exprId === 0xffffffff) return false;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
      return false;
    case ExprKind.Name:
      return unknownNameIds.has(arena.getExprData1(exprId));
    case ExprKind.Der:
      return exprDependsOnUnknowns(arena, arena.getExprData1(exprId), unknownNameIds);
    case ExprKind.Unary:
    case ExprKind.Negate:
      return exprDependsOnUnknowns(arena, arena.getExprLeft(exprId), unknownNameIds);
    case ExprKind.Binary:
      return (
        exprDependsOnUnknowns(arena, arena.getExprLeft(exprId), unknownNameIds) ||
        exprDependsOnUnknowns(arena, arena.getExprRight(exprId), unknownNameIds)
      );
    case ExprKind.Call: {
      const firstArgId = arena.getExprLeft(exprId);
      const argCount = arena.getExprRight(exprId);
      if (argCount >= 1 && exprDependsOnUnknowns(arena, firstArgId, unknownNameIds)) return true;
      if (argCount >= 2) {
        const secondArgId =
          exprId + 1 < arena.exprCount && arena.getExprKind(exprId + 1) === ExprKind.Tuple
            ? arena.getExprLeft(exprId + 1)
            : firstArgId + 1;
        if (secondArgId < arena.exprCount && exprDependsOnUnknowns(arena, secondArgId, unknownNameIds)) return true;
      }
      return false;
    }
    default:
      return true;
  }
}

/**
 * Statically checks whether `exprId` is strictly affine (degree <= 1) in `unknownNameIds`.
 */
export function isExprAffineInUnknowns(arena: DAEBuilder, exprId: number, unknownNameIds: Set<number>): boolean {
  if (exprId === 0xffffffff) return true;
  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.Name:
      return true;
    case ExprKind.Negate:
      return isExprAffineInUnknowns(arena, arena.getExprLeft(exprId), unknownNameIds);
    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId);
      if (op === UnaryOp.Negate) {
        return isExprAffineInUnknowns(arena, arena.getExprLeft(exprId), unknownNameIds);
      }
      return !exprDependsOnUnknowns(arena, arena.getExprLeft(exprId), unknownNameIds);
    }
    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId);
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      if (op === BinOp.Add || op === BinOp.Sub) {
        return (
          isExprAffineInUnknowns(arena, left, unknownNameIds) && isExprAffineInUnknowns(arena, right, unknownNameIds)
        );
      }
      if (op === BinOp.Mul) {
        const depL = exprDependsOnUnknowns(arena, left, unknownNameIds);
        const depR = exprDependsOnUnknowns(arena, right, unknownNameIds);
        if (depL && depR) return false; // quadratic/bilinear
        if (depL) return isExprAffineInUnknowns(arena, left, unknownNameIds);
        if (depR) return isExprAffineInUnknowns(arena, right, unknownNameIds);
        return true;
      }
      if (op === BinOp.Div) {
        if (exprDependsOnUnknowns(arena, right, unknownNameIds)) return false;
        return isExprAffineInUnknowns(arena, left, unknownNameIds);
      }
      return (
        !exprDependsOnUnknowns(arena, left, unknownNameIds) && !exprDependsOnUnknowns(arena, right, unknownNameIds)
      );
    }
    default:
      return !exprDependsOnUnknowns(arena, exprId, unknownNameIds);
  }
}

export interface LinearSccPlan {
  isLinear: boolean;
  unknownVarIndices: number[];
  unknownNameIds: number[];
  eqIndices: number[];
  /** Symbolic coefficient matrix `A[i][j]` (ExprIds independent of unknowns). */
  matrixExprs: number[][];
  /** Residual expressions `res[i] = lhs_i - rhs_i` (evaluated at u = 0 to get `-b_i`). */
  residualExprs: number[];
  /** Optional closed-form explicit expressions for 1×1 or 2×2 linear loops. */
  closedFormExprs?: number[] | undefined;
}

/**
 * Analyzes a coupled SCC block `(eqIndices, unknownVarIndices)` in a `DAEBuilder`.
 * If every equation is provably affine in the unknowns, emits a `LinearSccPlan` allowing
 * exact 0-Newton-iteration elimination (including closed-form symbolic inversion for k=1,2).
 */
export function analyzeLinearSccBlock(
  arena: DAEBuilder,
  eqIndices: number[],
  unknownVarIndices: number[],
): LinearSccPlan {
  const n = unknownVarIndices.length;
  const unknownNameIds = unknownVarIndices.map((vIdx) => arena.interner.intern(arena.getVarName(vIdx)));
  const unknownSet = new Set(unknownNameIds);

  if (eqIndices.length !== n || n === 0) {
    return { isLinear: false, unknownVarIndices, unknownNameIds, eqIndices, matrixExprs: [], residualExprs: [] };
  }

  const residualExprs: number[] = [];
  for (let i = 0; i < n; i++) {
    const eqIdx = eqIndices[i]!;
    const lhs = arena.getEqLhs(eqIdx);
    const rhs = arena.getEqRhs(eqIdx);
    if (!isExprAffineInUnknowns(arena, lhs, unknownSet) || !isExprAffineInUnknowns(arena, rhs, unknownSet)) {
      return { isLinear: false, unknownVarIndices, unknownNameIds, eqIndices, matrixExprs: [], residualExprs: [] };
    }
    residualExprs.push(arena.addBinaryExpr(BinOp.Sub, lhs, rhs));
  }

  // Extract symbolic A_{ij} = ∂res_i / ∂u_j
  const matrixExprs: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      row.push(differentiateArenaExpression(arena, residualExprs[i]!, unknownNameIds[j]!));
    }
    matrixExprs.push(row);
  }

  return {
    isLinear: true,
    unknownVarIndices,
    unknownNameIds,
    eqIndices,
    matrixExprs,
    residualExprs,
  };
}

/**
 * Evaluates and solves a `LinearSccPlan` directly in 1 linear solve (0 Newton iterations),
 * writing the exact unknown values directly into `valuesByStringId`.
 */
export function solveLinearSccBlockDirect(
  arena: DAEBuilder,
  plan: LinearSccPlan,
  valuesByStringId: Float64Array,
): { solved: boolean; newtonIterations: 0 } {
  const n = plan.unknownNameIds.length;
  if (!plan.isLinear || n === 0) return { solved: false, newtonIterations: 0 };

  // Zero out unknowns to evaluate b_i = -res_i(u = 0)
  for (let j = 0; j < n; j++) {
    valuesByStringId[plan.unknownNameIds[j]!] = 0.0;
  }

  const A = new Float64Array(n * n);
  const b = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    b[i] = -evaluateArenaRuntime(arena, plan.residualExprs[i]!, valuesByStringId);
    for (let j = 0; j < n; j++) {
      A[i * n + j] = evaluateArenaRuntime(arena, plan.matrixExprs[i]![j]!, valuesByStringId);
    }
  }

  if (n === 1) {
    const a00 = A[0]!;
    if (Math.abs(a00) < 1e-15) return { solved: false, newtonIterations: 0 };
    valuesByStringId[plan.unknownNameIds[0]!] = b[0]! / a00;
    return { solved: true, newtonIterations: 0 };
  }

  if (n === 2) {
    const det = A[0]! * A[3]! - A[1]! * A[2]!;
    if (Math.abs(det) < 1e-15) return { solved: false, newtonIterations: 0 };
    valuesByStringId[plan.unknownNameIds[0]!] = (b[0]! * A[3]! - A[1]! * b[1]!) / det;
    valuesByStringId[plan.unknownNameIds[1]!] = (A[0]! * b[1]! - b[0]! * A[2]!) / det;
    return { solved: true, newtonIterations: 0 };
  }

  const fact = luFactorFlat(A, n);
  luSolveFlat(fact, b);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(b[i]!)) return { solved: false, newtonIterations: 0 };
    valuesByStringId[plan.unknownNameIds[i]!] = b[i]!;
  }
  return { solved: true, newtonIterations: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Mattsson-Söderlind Dynamic Dummy-Derivative State Selection
// ─────────────────────────────────────────────────────────────────────────────

export interface DynamicStatePartition {
  /** Indices into `candidateStates` chosen as active differential states. */
  activeStateIndices: number[];
  /** Indices into `candidateStates` whose derivatives are treated as algebraic dummy derivatives. */
  dummyDerIndices: number[];
  /** Pivot quality metric (minimum diagonal magnitude of R from column-pivoted QR). */
  minPivot: number;
  /** True if a state-partition switch occurred relative to the previous selection. */
  switched: boolean;
}

/**
 * Mattsson-Söderlind Dynamic State Selection Monitor for High-Index DAEs.
 *
 * Given `m` holonomic constraints `g(q) = 0` over `n` candidate state variables `q` (`m < n`),
 * chooses `m` dummy derivatives (leaving `n - m` dynamic states) by maximizing the conditioning
 * of the `m × m` submatrix of the constraint Jacobian `G = ∂g/∂q` via column-pivoted QR.
 * Uses hysteresis (`switchRatio`) to avoid chattering near equal-pivot boundaries.
 */
export class DynamicDummyDerivativeSelector {
  private currentDummy: number[] | null = null;
  private switchCount = 0;

  constructor(
    public readonly numCandidates: number,
    public readonly numConstraints: number,
    /** Switch only if the optimal pivot exceeds `switchRatio * currentPivot` (default: 1.5). */
    public readonly switchRatio: number = 1.5,
    /** Always switch if the current pivot falls below `minPivotFloor` (default: 0.15). */
    public readonly minPivotFloor: number = 0.15,
  ) {}

  public get totalSwitches(): number {
    return this.switchCount;
  }

  /**
   * Evaluates the `m × n` constraint Jacobian `G(q) = ∂g/∂q` and returns the optimal
   * well-conditioned partition into `(n - m)` dynamic states and `m` dummy derivatives.
   */
  public selectPartition(G: number[][]): DynamicStatePartition {
    const m = this.numConstraints;
    const n = this.numCandidates;

    // Evaluate pivot quality of a specific m-column subset via QR min-diag
    const evalSubsetPivot = (cols: number[]): number => {
      if (m === 1) {
        return Math.abs(G[0]?.[cols[0]!] ?? 0);
      }
      // Modified Gram-Schmidt on the m×m submatrix
      const work: number[][] = cols.map((c) => Array.from({ length: m }, (_, r) => G[r]?.[c] ?? 0));
      let minR = Infinity;
      for (let j = 0; j < m; j++) {
        const v = work[j]!;
        for (let k = 0; k < j; k++) {
          const qk = work[k]!;
          let dot = 0;
          for (let r = 0; r < m; r++) dot += qk[r]! * v[r]!;
          for (let r = 0; r < m; r++) v[r] = v[r]! - dot * qk[r]!;
        }
        const norm = Math.hypot(...v);
        if (norm < minR) minR = norm;
        if (norm > 1e-15) {
          for (let r = 0; r < m; r++) v[r] = v[r]! / norm;
        }
      }
      return minR;
    };

    // Column-pivoted QR over all n columns of G to find the best-conditioned m dummy columns
    const colVecs: number[][] = Array.from({ length: n }, (_, c) =>
      Array.from({ length: m }, (_, r) => G[r]?.[c] ?? 0),
    );
    const perm = Array.from({ length: n }, (_, i) => i);
    let bestMinPivot = Infinity;

    for (let k = 0; k < m; k++) {
      let bestCol = k;
      let bestNorm = -1;
      for (let j = k; j < n; j++) {
        const norm = Math.hypot(...colVecs[perm[j]!]!);
        if (norm > bestNorm) {
          bestNorm = norm;
          bestCol = j;
        }
      }
      const tmp = perm[k]!;
      perm[k] = perm[bestCol]!;
      perm[bestCol] = tmp;

      const q = colVecs[perm[k]!]!;
      if (bestNorm < bestMinPivot) bestMinPivot = bestNorm;
      if (bestNorm > 1e-15) {
        for (let r = 0; r < m; r++) q[r] = q[r]! / bestNorm;
        for (let j = k + 1; j < n; j++) {
          const v = colVecs[perm[j]!]!;
          let dot = 0;
          for (let r = 0; r < m; r++) dot += q[r]! * v[r]!;
          for (let r = 0; r < m; r++) v[r] = v[r]! - dot * q[r]!;
        }
      }
    }

    const bestDummy = perm.slice(0, m).sort((a, b) => a - b);

    // Apply hysteresis against currentDummy
    let chosenDummy = bestDummy;
    let chosenPivot = bestMinPivot;
    let switched = false;

    if (this.currentDummy !== null) {
      const curPivot = evalSubsetPivot(this.currentDummy);
      const sameSet =
        this.currentDummy.length === bestDummy.length && this.currentDummy.every((v, idx) => v === bestDummy[idx]);

      if (!sameSet) {
        if (curPivot < this.minPivotFloor || bestMinPivot > this.switchRatio * curPivot) {
          chosenDummy = bestDummy;
          chosenPivot = bestMinPivot;
          switched = true;
          this.switchCount++;
        } else {
          chosenDummy = this.currentDummy;
          chosenPivot = curPivot;
        }
      } else {
        chosenPivot = curPivot;
      }
    }

    this.currentDummy = [...chosenDummy];
    const dummySet = new Set(chosenDummy);
    const activeStateIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!dummySet.has(i)) activeStateIndices.push(i);
    }

    return {
      activeStateIndices,
      dummyDerIndices: chosenDummy,
      minPivot: chosenPivot,
      switched,
    };
  }
}
