// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic linear algebra on the Arena DAE representation.
 *
 * Implements symbolic Gaussian elimination, determinant calculation,
 * and linear system solver using expression IDs in ArenaDAEBuilder.
 */

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../../dae-arena.js";
import { add, differentiateArenaExpr, div, isZero, mul, negate, ONE, sub, ZERO } from "../calculus/derivative.js";
import { egraphSimplify } from "../simplify/egraph.js";

export type ArenaMatrix = number[][];
export type ArenaVector = number[];

function getSequenceElements(
  arena: ArenaDAEBuilder,
  baseExprId: number,
  count: number,
  firstElement: number,
): number[] {
  if (count <= 0) return [];
  const elements = [firstElement];
  for (let i = 1; i < count; i++) {
    const tupleId = baseExprId + i;
    elements.push(arena.getExprLeft(tupleId));
  }
  return elements;
}

function getLiteralValueArena(arena: ArenaDAEBuilder, exprId: number): number | null {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.RealLiteral) return arena.getExprRealValue(exprId);
  if (kind === ExprKind.IntLiteral) return arena.getExprData1(exprId);
  return null;
}

function isZeroArena(arena: ArenaDAEBuilder, exprId: number): boolean {
  return isZero(arena, exprId);
}

function containsVarArena(arena: ArenaDAEBuilder, exprId: number, varName: string): boolean {
  if (exprId < 0) return false;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId));
    return name === varName;
  }
  if (kind === ExprKind.Binary) {
    return (
      containsVarArena(arena, arena.getExprLeft(exprId), varName) ||
      containsVarArena(arena, arena.getExprRight(exprId), varName)
    );
  }
  if (kind === ExprKind.Unary || kind === ExprKind.Negate || kind === ExprKind.Der || kind === ExprKind.Pre) {
    const operand = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    return containsVarArena(arena, operand, varName);
  }
  if (kind === ExprKind.Call) {
    const count = arena.getExprRight(exprId);
    const first = arena.getExprLeft(exprId);
    const args = getSequenceElements(arena, exprId, count, first);
    return args.some((arg) => containsVarArena(arena, arg, varName));
  }
  if (kind === ExprKind.IfElse) {
    return (
      containsVarArena(arena, arena.getExprData1(exprId), varName) ||
      containsVarArena(arena, arena.getExprLeft(exprId), varName) ||
      containsVarArena(arena, arena.getExprRight(exprId), varName)
    );
  }
  return false;
}

function containsAnyVarArena(arena: ArenaDAEBuilder, exprId: number, variables: string[]): boolean {
  return variables.some((v) => containsVarArena(arena, exprId, v));
}

function substituteZeroArena(arena: ArenaDAEBuilder, exprId: number, varName: string): number {
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const name = arena.interner.resolve(arena.getExprData1(exprId));
    if (name === varName) {
      return ZERO(arena);
    }
    return exprId;
  }
  if (
    kind === ExprKind.RealLiteral ||
    kind === ExprKind.IntLiteral ||
    kind === ExprKind.BoolLiteral ||
    kind === ExprKind.StringLiteral ||
    kind === ExprKind.EnumLiteral
  ) {
    return exprId;
  }
  if (kind === ExprKind.Negate) {
    const operand = arena.getExprLeft(exprId);
    const subOperand = substituteZeroArena(arena, operand, varName);
    if (subOperand === operand) return exprId;
    return arena.addUnaryExpr(UnaryOp.Negate, subOperand);
  }
  if (kind === ExprKind.Unary) {
    const op = arena.getExprData1(exprId) as UnaryOp;
    const operand = arena.getExprLeft(exprId);
    const subOperand = substituteZeroArena(arena, operand, varName);
    if (subOperand === operand) return exprId;
    return arena.addUnaryExpr(op, subOperand);
  }
  if (kind === ExprKind.Binary) {
    const op = arena.getExprData1(exprId) as BinOp;
    const left = arena.getExprLeft(exprId);
    const right = arena.getExprRight(exprId);
    const subLeft = substituteZeroArena(arena, left, varName);
    const subRight = substituteZeroArena(arena, right, varName);
    if (subLeft === left && subRight === right) return exprId;
    return arena.addBinaryExpr(op, subLeft, subRight);
  }
  if (kind === ExprKind.Call) {
    const fnameId = arena.getExprData1(exprId);
    const fname = arena.interner.resolve(fnameId);
    if (!fname) return exprId;
    const argCount = arena.getExprRight(exprId);
    const firstArg = arena.getExprLeft(exprId);
    const args = getSequenceElements(arena, exprId, argCount, firstArg);
    let changed = false;
    const subArgs = args.map((arg) => {
      const subArg = substituteZeroArena(arena, arg, varName);
      if (subArg !== arg) changed = true;
      return subArg;
    });
    if (!changed) return exprId;
    return arena.addCallExpr(fname, subArgs);
  }
  if (kind === ExprKind.IfElse) {
    const cond = arena.getExprData1(exprId);
    const thenExpr = arena.getExprLeft(exprId);
    const elseExpr = arena.getExprRight(exprId);
    const subCond = substituteZeroArena(arena, cond, varName);
    const subThen = substituteZeroArena(arena, thenExpr, varName);
    const subElse = substituteZeroArena(arena, elseExpr, varName);
    if (subCond === cond && subThen === thenExpr && subElse === elseExpr) return exprId;
    return arena.addIfElseExpr(subCond, subThen, subElse);
  }
  if (kind === ExprKind.Der) {
    const operand = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    const subOperand = substituteZeroArena(arena, operand, varName);
    if (subOperand === operand) return exprId;
    return arena.addDerExpr(subOperand);
  }
  if (kind === ExprKind.Pre) {
    const operand = arena.getExprLeft(exprId) >= 0 ? arena.getExprLeft(exprId) : arena.getExprData1(exprId);
    const subOperand = substituteZeroArena(arena, operand, varName);
    if (subOperand === operand) return exprId;
    return arena.addPreExpr(subOperand);
  }
  return exprId;
}

function substituteZerosArena(arena: ArenaDAEBuilder, exprId: number, variables: string[]): number {
  let current = exprId;
  for (const varName of variables) {
    current = substituteZeroArena(arena, current, varName);
  }
  return current;
}

/**
 * Solves a system of symbolic linear equations via Gaussian elimination.
 *
 * @param arena - The Arena DAE Builder
 * @param A - Coefficient matrix (size n x n) where each entry is an ExprId
 * @param b - Constant vector (size n) where each entry is an ExprId
 * @returns Solution vector of ExprIds, or null if the system is singular
 */
export function gaussianEliminationArena(arena: ArenaDAEBuilder, A: ArenaMatrix, b: ArenaVector): ArenaVector | null {
  const n = A.length;
  if (n === 0) return [];

  // Create augmented matrix [A | b]
  const aug: number[][] = A.map((row, i) => [...row, b[i] ?? ZERO(arena)]);

  for (let col = 0; col < n; col++) {
    // Find best pivot (prefer literal non-zero values)
    let bestRow = -1;
    let bestScore = -1;
    for (let row = col; row < n; row++) {
      const elem = aug[row]?.[col];
      if (elem === undefined || isZeroArena(arena, elem)) continue;
      const val = getLiteralValueArena(arena, elem);
      const score = val !== null ? Math.abs(val) + 1000 : 1; // Prefer known values
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }

    if (bestRow === -1) {
      return null; // Singular matrix
    }

    // Swap current row with best row
    if (bestRow !== col) {
      const temp = aug[col];
      aug[col] = aug[bestRow] ?? [];
      aug[bestRow] = temp ?? [];
    }

    const pivotRow = aug[col];
    if (!pivotRow) return null;
    const pivot = pivotRow[col];
    if (pivot === undefined || isZeroArena(arena, pivot)) return null;

    // Eliminate entries below pivot
    for (let row = col + 1; row < n; row++) {
      const currentRow = aug[row];
      if (!currentRow) continue;
      const currentElem = currentRow[col] ?? ZERO(arena);
      if (isZeroArena(arena, currentElem)) continue;

      const factor = egraphSimplify(arena, div(arena, currentElem, pivot));
      for (let j = col; j <= n; j++) {
        const currentVal = currentRow[j] ?? ZERO(arena);
        const pivotVal = pivotRow[j] ?? ZERO(arena);
        currentRow[j] = egraphSimplify(arena, sub(arena, currentVal, mul(arena, factor, pivotVal)));
      }
    }
  }

  // Back substitution
  const x: number[] = new Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    const currentRow = aug[row];
    if (!currentRow) return null;
    let sum: number = currentRow[n] ?? ZERO(arena);
    for (let col = row + 1; col < n; col++) {
      const currentVal = currentRow[col] ?? ZERO(arena);
      const solvedVal = x[col] ?? ZERO(arena);
      sum = sub(arena, sum, mul(arena, currentVal, solvedVal));
    }
    const pivot = currentRow[row];
    if (pivot === undefined || isZeroArena(arena, pivot)) return null;
    x[row] = egraphSimplify(arena, div(arena, sum, pivot));
  }

  return x;
}

/**
 * Computes the symbolic determinant of a matrix.
 */
export function determinantArena(arena: ArenaDAEBuilder, A: ArenaMatrix): number {
  const n = A.length;
  if (n === 0) return ONE(arena);
  if (n === 1) return A[0]?.[0] ?? ZERO(arena);
  if (n === 2) {
    const a00 = A[0]?.[0] ?? ZERO(arena);
    const a11 = A[1]?.[1] ?? ZERO(arena);
    const a01 = A[0]?.[1] ?? ZERO(arena);
    const a10 = A[1]?.[0] ?? ZERO(arena);
    return egraphSimplify(arena, sub(arena, mul(arena, a00, a11), mul(arena, a01, a10)));
  }
  if (n === 3) {
    return determinant3x3Arena(arena, A);
  }
  return cofactorExpansionArena(arena, A);
}

function determinant3x3Arena(arena: ArenaDAEBuilder, A: ArenaMatrix): number {
  const get = (r: number, c: number) => A[r]?.[c] ?? ZERO(arena);
  const pos = add(
    arena,
    add(
      arena,
      mul(arena, mul(arena, get(0, 0), get(1, 1)), get(2, 2)),
      mul(arena, mul(arena, get(0, 1), get(1, 2)), get(2, 0)),
    ),
    mul(arena, mul(arena, get(0, 2), get(1, 0)), get(2, 1)),
  );
  const neg = add(
    arena,
    add(
      arena,
      mul(arena, mul(arena, get(0, 2), get(1, 1)), get(2, 0)),
      mul(arena, mul(arena, get(0, 1), get(1, 0)), get(2, 2)),
    ),
    mul(arena, mul(arena, get(0, 0), get(1, 2)), get(2, 1)),
  );
  return egraphSimplify(arena, sub(arena, pos, neg));
}

function cofactorExpansionArena(arena: ArenaDAEBuilder, A: ArenaMatrix): number {
  const n = A.length;
  let det: number = ZERO(arena);
  for (let j = 0; j < n; j++) {
    const elem = A[0]?.[j] ?? ZERO(arena);
    if (isZeroArena(arena, elem)) continue;
    const minor = submatrix(A, 0, j);
    const minorDet = determinantArena(arena, minor);
    const cofactor = j % 2 === 0 ? minorDet : negate(arena, minorDet);
    det = add(arena, det, mul(arena, elem, cofactor));
  }
  return egraphSimplify(arena, det);
}

function submatrix(A: ArenaMatrix, skipRow: number, skipCol: number): ArenaMatrix {
  return A.filter((_, i) => i !== skipRow).map((row) => row.filter((_, j) => j !== skipCol));
}

/**
 * Symbolically solves a linear system of equations.
 *
 * @param arena - The Arena DAE Builder
 * @param equations - A list of expression IDs, each representing eq = 0
 * @param variables - A list of variable names to solve for
 * @returns Map of variable name to solved expression ID, or null if solving fails or is not linear
 */
export function solveLinearSystemArena(
  arena: ArenaDAEBuilder,
  equations: number[],
  variables: string[],
): Map<string, number> | null {
  const n = variables.length;
  if (equations.length < n) return null; // Under-determined

  const A: ArenaMatrix = [];
  const b: ArenaVector = [];

  for (let i = 0; i < n; i++) {
    const eq = equations[i];
    if (eq === undefined) return null;

    const row: number[] = [];
    for (const varName of variables) {
      // Coeff is the partial derivative of eq w.r.t varName
      const coeff = egraphSimplify(arena, differentiateArenaExpr(arena, eq, varName));
      // linearity check: coeff must not contain any target variables
      if (containsAnyVarArena(arena, coeff, variables)) {
        return null;
      }
      row.push(coeff);
    }

    // Constant term is eq with all variables set to 0
    const constant = egraphSimplify(arena, substituteZerosArena(arena, eq, variables));
    // linearity check: constant must not contain any target variables
    if (containsAnyVarArena(arena, constant, variables)) {
      return null;
    }

    // b[i] = -constant
    b.push(egraphSimplify(arena, negate(arena, constant)));
    A.push(row);
  }

  const solution = gaussianEliminationArena(arena, A, b);
  if (!solution) return null;

  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const v = variables[i];
    const s = solution[i];
    if (v !== undefined && s !== undefined) {
      result.set(v, s);
    }
  }
  return result;
}
