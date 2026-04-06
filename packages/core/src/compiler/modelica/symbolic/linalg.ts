// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic linear algebra.
 *
 * Provides symbolic Gaussian elimination, determinant computation,
 * and linear system solving on ModelicaExpression matrices.
 */

import type { ModelicaExpression } from "../dae.js";
import { ModelicaNameExpression, ModelicaRealLiteral } from "../dae.js";
import { add, div, isZero, mul, ONE, sub, ZERO } from "../symbolic-diff.js";
import { egraphSimplify } from "./egraph.js";
import { collectTerms, expandExpr, getLiteralValue } from "./expand.js";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/** A symbolic matrix is a 2D array of ModelicaExpressions. */
export type SymMatrix = ModelicaExpression[][];

/** A symbolic vector is a 1D array of ModelicaExpressions. */
export type SymVector = ModelicaExpression[];

// ─────────────────────────────────────────────────────────────────────
// Gaussian Elimination
// ─────────────────────────────────────────────────────────────────────

/**
 * Solve the linear system Ax = b using symbolic Gaussian elimination
 * with partial pivoting (selecting the most "definite" non-zero pivot).
 *
 * @returns Solution vector x, or null if the system is singular.
 */
export function gaussianElimination(A: SymMatrix, b: SymVector): SymVector | null {
  const n = A.length;
  if (n === 0) return [];

  // Create augmented matrix [A|b]
  const aug: ModelicaExpression[][] = A.map((row, i) => [...row.map(cloneExpr), cloneExpr(b[i] ?? ZERO)]);

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find best pivot (prefer literal non-zero values)
    let bestRow = -1;
    let bestScore = -1;
    for (let row = col; row < n; row++) {
      const elem = aug[row]?.[col];
      if (!elem || isZero(elem)) continue;
      const val = getLiteralValue(elem);
      const score = val !== null ? Math.abs(val) + 1000 : 1; // Prefer known values
      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    }

    if (bestRow === -1) return null; // Singular

    // Swap rows
    if (bestRow !== col) {
      const temp = aug[col];
      aug[col] = aug[bestRow] ?? [];
      aug[bestRow] = temp ?? [];
    }

    const pivotRow = aug[col];
    if (!pivotRow) return null;
    const pivot = pivotRow[col];
    if (!pivot || isZero(pivot)) return null;

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const currentRow = aug[row];
      if (!currentRow) continue;
      const factor = egraphSimplify(div(currentRow[col] ?? ZERO, pivot));
      for (let j = col; j <= n; j++) {
        currentRow[j] = egraphSimplify(sub(currentRow[j] ?? ZERO, mul(factor, pivotRow[j] ?? ZERO)));
      }
    }
  }

  // Back substitution
  const x: SymVector = new Array(n).fill(ZERO);
  for (let row = n - 1; row >= 0; row--) {
    const currentRow = aug[row];
    if (!currentRow) return null;
    let sum: ModelicaExpression = currentRow[n] ?? ZERO;
    for (let col = row + 1; col < n; col++) {
      sum = sub(sum, mul(currentRow[col] ?? ZERO, x[col] ?? ZERO));
    }
    const pivot = currentRow[row];
    if (!pivot || isZero(pivot)) return null;
    x[row] = egraphSimplify(div(sum, pivot));
  }

  return x;
}

// ─────────────────────────────────────────────────────────────────────
// Determinant
// ─────────────────────────────────────────────────────────────────────

/**
 * Compute the symbolic determinant of a square matrix.
 *
 * Uses cofactor expansion for small matrices (n ≤ 3) and LU decomposition
 * for larger ones.
 */
export function determinant(A: SymMatrix): ModelicaExpression {
  const n = A.length;
  if (n === 0) return ONE;
  if (n === 1) return A[0]?.[0] ?? ZERO;
  if (n === 2) {
    return egraphSimplify(sub(mul(A[0]?.[0] ?? ZERO, A[1]?.[1] ?? ZERO), mul(A[0]?.[1] ?? ZERO, A[1]?.[0] ?? ZERO)));
  }
  if (n === 3) {
    return determinant3x3(A);
  }
  // Larger: cofactor expansion along first row
  return cofactorExpansion(A);
}

function determinant3x3(A: SymMatrix): ModelicaExpression {
  const get = (r: number, c: number) => A[r]?.[c] ?? ZERO;
  // Sarrus' rule
  const pos = add(
    add(mul(mul(get(0, 0), get(1, 1)), get(2, 2)), mul(mul(get(0, 1), get(1, 2)), get(2, 0))),
    mul(mul(get(0, 2), get(1, 0)), get(2, 1)),
  );
  const neg = add(
    add(mul(mul(get(0, 2), get(1, 1)), get(2, 0)), mul(mul(get(0, 1), get(1, 0)), get(2, 2))),
    mul(mul(get(0, 0), get(1, 2)), get(2, 1)),
  );
  return egraphSimplify(sub(pos, neg));
}

function cofactorExpansion(A: SymMatrix): ModelicaExpression {
  const n = A.length;
  let det: ModelicaExpression = ZERO;
  for (let j = 0; j < n; j++) {
    const elem = A[0]?.[j] ?? ZERO;
    if (isZero(elem)) continue;
    const minor = submatrix(A, 0, j);
    const cofactor = j % 2 === 0 ? determinant(minor) : negate(determinant(minor));
    det = add(det, mul(elem, cofactor));
  }
  return egraphSimplify(det);
}

function submatrix(A: SymMatrix, skipRow: number, skipCol: number): SymMatrix {
  return A.filter((_, i) => i !== skipRow).map((row) => row.filter((_, j) => j !== skipCol));
}

// ─────────────────────────────────────────────────────────────────────
// Linear System Solver
// ─────────────────────────────────────────────────────────────────────

/**
 * Solve a system of linear equations for a set of variables.
 *
 * Each equation is `expr = 0`. Extracts the coefficient matrix A and
 * constant vector b, then solves via Gaussian elimination.
 *
 * @param equations Array of expressions (each set equal to zero)
 * @param variables Array of variable names to solve for
 * @returns Map from variable name to solution expression, or null if unsolvable
 */
export function solveLinearSystem(
  equations: ModelicaExpression[],
  variables: string[],
): Map<string, ModelicaExpression> | null {
  const n = variables.length;
  if (equations.length < n) return null; // Under-determined

  // Extract coefficient matrix A and constant vector b
  const A: SymMatrix = [];
  const b: SymVector = [];

  for (let i = 0; i < n; i++) {
    const eq = equations[i];
    if (!eq) return null;
    const expanded = expandExpr(eq);
    const row: ModelicaExpression[] = [];

    for (const varName of variables) {
      const terms = collectTerms(expanded, varName);
      const coeff = terms.get(1) ?? ZERO;
      row.push(coeff);
    }

    // b[i] = -constant term (expr - sum(a_j * x_j) evaluated at x_j=0)
    let constant: ModelicaExpression = expanded;
    for (const varName of variables) {
      constant = substituteZero(constant, varName);
    }
    b.push(egraphSimplify(negate(constant)));
    A.push(row);
  }

  const solution = gaussianElimination(A, b);
  if (!solution) return null;

  const result = new Map<string, ModelicaExpression>();
  for (let i = 0; i < n; i++) {
    const v = variables[i];
    const s = solution[i];
    if (v && s) {
      result.set(v, s);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────

import { ModelicaUnaryOperator } from "@modelscript/modelica-ast";
import { ModelicaBinaryExpression, ModelicaFunctionCallExpression, ModelicaUnaryExpression } from "../dae.js";

function negate(expr: ModelicaExpression): ModelicaExpression {
  const val = getLiteralValue(expr);
  if (val !== null) return new ModelicaRealLiteral(-val);
  if (isZero(expr)) return ZERO;
  return new ModelicaUnaryExpression(ModelicaUnaryOperator.UNARY_MINUS, expr);
}

function cloneExpr(expr: ModelicaExpression): ModelicaExpression {
  // Expressions are immutable value objects — sharing is safe
  return expr;
}

/**
 * Substitute a variable with zero in an expression.
 */
function substituteZero(expr: ModelicaExpression, varName: string): ModelicaExpression {
  if (expr instanceof ModelicaNameExpression && expr.name === varName) {
    return ZERO;
  }
  if (expr instanceof ModelicaUnaryExpression) {
    const op = substituteZero(expr.operand, varName);
    return new ModelicaUnaryExpression(expr.operator, op);
  }
  if (expr instanceof ModelicaBinaryExpression) {
    return new ModelicaBinaryExpression(
      expr.operator,
      substituteZero(expr.operand1, varName),
      substituteZero(expr.operand2, varName),
    );
  }
  if (expr instanceof ModelicaFunctionCallExpression) {
    const args = (expr.args as ModelicaExpression[]).map((a) => substituteZero(a, varName));
    return new ModelicaFunctionCallExpression(expr.functionName, args);
  }
  return expr;
}
