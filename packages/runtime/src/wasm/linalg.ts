// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import {
  DaeBuilder,
  BinOp,
  UnaryOp,
  ExprKind,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  EQ_STRIDE,
  EQ_LHS,
  EQ_RHS,
} from "./dae";
import { cas_simplify, cas_differentiate, cas_isZero, cas_isOne, cas_isConstant, cas_getRealValue } from "./cas";

/**
 * Checks if a symbolic expression contains a specific variable ID.
 */
export function symbolicContainsVar(dae: DaeBuilder, exprId: u32, targetVar: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1);
    return varId == targetVar;
  }

  if (kind == ExprKind.Binary) {
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);
    return symbolicContainsVar(dae, left, targetVar) || symbolicContainsVar(dae, right, targetVar);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate || kind == ExprKind.Der || kind == ExprKind.Pre) {
    let operand = exprData.get(offset + EXPR_LEFT);
    return symbolicContainsVar(dae, operand, targetVar);
  }

  if (kind == ExprKind.IfElse) {
    let cond = exprData.get(offset + EXPR_DATA1);
    let thenExpr = exprData.get(offset + EXPR_LEFT);
    let elseExpr = exprData.get(offset + EXPR_RIGHT);
    return (
      symbolicContainsVar(dae, cond, targetVar) ||
      symbolicContainsVar(dae, thenExpr, targetVar) ||
      symbolicContainsVar(dae, elseExpr, targetVar)
    );
  }

  return false;
}

/**
 * Checks if a symbolic expression contains any variable from the provided list.
 */
export function symbolicContainsAnyVar(dae: DaeBuilder, exprId: u32, varIdxs: Int32Array): boolean {
  for (let i = 0; i < varIdxs.length; i++) {
    if (symbolicContainsVar(dae, exprId, varIdxs[i] as u32)) {
      return true;
    }
  }
  return false;
}

/**
 * Substitutes 0 for a specific variable ID in an expression.
 */
export function symbolicSubstituteZero(dae: DaeBuilder, exprId: u32, targetVar: u32): u32 {
  if (exprId >= dae.exprCount) return exprId;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1);
    if (varId == targetVar) {
      return dae.addRealLiteral(0.0);
    }
    return exprId;
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.StringLiteral || kind == ExprKind.EnumLiteral) {
    return exprId;
  }

  if (kind == ExprKind.Negate) {
    let operand = exprData.get(offset + EXPR_LEFT);
    let subOperand = symbolicSubstituteZero(dae, operand, targetVar);
    if (subOperand == operand) return exprId;
    let neg = dae.addExpression(ExprKind.Negate, 0, subOperand, 0xffffffff);
    return cas_simplify(dae, neg);
  }

  if (kind == ExprKind.Unary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let operand = exprData.get(offset + EXPR_LEFT);
    let subOperand = symbolicSubstituteZero(dae, operand, targetVar);
    if (subOperand == operand) return exprId;
    let un = dae.addExpression(ExprKind.Unary, op, subOperand, 0xffffffff);
    return cas_simplify(dae, un);
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);
    let subLeft = symbolicSubstituteZero(dae, left, targetVar);
    let subRight = symbolicSubstituteZero(dae, right, targetVar);
    if (subLeft == left && subRight == right) return exprId;
    let bin = dae.addExpression(ExprKind.Binary, op, subLeft, subRight);
    return cas_simplify(dae, bin);
  }

  if (kind == ExprKind.IfElse) {
    let cond = exprData.get(offset + EXPR_DATA1);
    let thenExpr = exprData.get(offset + EXPR_LEFT);
    let elseExpr = exprData.get(offset + EXPR_RIGHT);
    let subCond = symbolicSubstituteZero(dae, cond, targetVar);
    let subThen = symbolicSubstituteZero(dae, thenExpr, targetVar);
    let subElse = symbolicSubstituteZero(dae, elseExpr, targetVar);
    if (subCond == cond && subThen == thenExpr && subElse == elseExpr) return exprId;
    let ife = dae.addExpression(ExprKind.IfElse, subCond, subThen, subElse);
    return cas_simplify(dae, ife);
  }

  return exprId;
}

/**
 * Substitutes 0 for all variables in varIdxs in an expression.
 */
export function symbolicSubstituteZeros(dae: DaeBuilder, exprId: u32, varIdxs: Int32Array): u32 {
  let curr = exprId;
  for (let i = 0; i < varIdxs.length; i++) {
    curr = symbolicSubstituteZero(dae, curr, varIdxs[i] as u32);
  }
  return curr;
}

/**
 * Solves a symbolic linear system via Gaussian elimination.
 *
 * @param dae The DaeBuilder
 * @param aug Augmented matrix of size n x (n + 1), stored flat (stride = n + 1)
 * @param n Matrix dimension
 * @returns Solution array of length n (ExprIds), or null if singular
 */
export function symbolicGaussianElimination(dae: DaeBuilder, aug: Uint32Array, n: u32): Uint32Array | null {
  if (n == 0) return new Uint32Array(0);
  let stride = n + 1;

  for (let col: u32 = 0; col < n; col++) {
    // Find best pivot (prefer literal non-zero values)
    let bestRow: i32 = -1;
    let bestScore: f64 = -1.0;

    for (let row: u32 = col; row < n; row++) {
      let elem = aug[row * stride + col];
      if (cas_isZero(dae, elem)) continue;

      let score: f64 = 1.0;
      if (cas_isConstant(dae, elem)) {
        score = Math.abs(cas_getRealValue(dae, elem)) + 1000.0;
      }
      if (score > bestScore) {
        bestScore = score;
        bestRow = row as i32;
      }
    }

    if (bestRow == -1) {
      return null; // Singular matrix
    }

    // Swap current row with best row if needed
    if ((bestRow as u32) != col) {
      for (let j: u32 = 0; j < stride; j++) {
        let tmp = aug[col * stride + j];
        aug[col * stride + j] = aug[(bestRow as u32) * stride + j];
        aug[(bestRow as u32) * stride + j] = tmp;
      }
    }

    let pivot = aug[col * stride + col];
    if (cas_isZero(dae, pivot)) return null;

    // Eliminate entries below pivot
    for (let row: u32 = col + 1; row < n; row++) {
      let currentElem = aug[row * stride + col];
      if (cas_isZero(dae, currentElem)) continue;

      let factorExpr = dae.addExpression(ExprKind.Binary, BinOp.Div, currentElem, pivot);
      let factor = cas_simplify(dae, factorExpr);

      for (let j: u32 = col; j < stride; j++) {
        let currentVal = aug[row * stride + j];
        let pivotVal = aug[col * stride + j];

        let termExpr = dae.addExpression(ExprKind.Binary, BinOp.Mul, factor, pivotVal);
        let subExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, currentVal, termExpr);
        aug[row * stride + j] = cas_simplify(dae, subExpr);
      }
    }
  }

  // Back substitution
  let x = new Uint32Array(n);
  for (let r: i32 = (n as i32) - 1; r >= 0; r--) {
    let row = r as u32;
    let sum = aug[row * stride + n]; // Constant term b[row]

    for (let col = row + 1; col < n; col++) {
      let currentVal = aug[row * stride + col];
      let solvedVal = x[col];

      let termExpr = dae.addExpression(ExprKind.Binary, BinOp.Mul, currentVal, solvedVal);
      let subExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, sum, termExpr);
      sum = cas_simplify(dae, subExpr);
    }

    let pivot = aug[row * stride + row];
    if (cas_isZero(dae, pivot)) return null;

    let divExpr = dae.addExpression(ExprKind.Binary, BinOp.Div, sum, pivot);
    x[row] = cas_simplify(dae, divExpr);
  }

  return x;
}

/**
 * Computes symbolic determinant of an n x n matrix of ExprIds (flat array, stride = n).
 */
export function symbolicDeterminant(dae: DaeBuilder, A: Uint32Array, n: u32): u32 {
  if (n == 0) return dae.addRealLiteral(1.0);
  if (n == 1) return A[0];

  if (n == 2) {
    let a00 = A[0];
    let a01 = A[1];
    let a10 = A[2];
    let a11 = A[3];

    let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a00, a11);
    let t2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a01, a10);
    let sub = dae.addExpression(ExprKind.Binary, BinOp.Sub, t1, t2);
    return cas_simplify(dae, sub);
  }

  if (n == 3) {
    let a00 = A[0], a01 = A[1], a02 = A[2];
    let a10 = A[3], a11 = A[4], a12 = A[5];
    let a20 = A[6], a21 = A[7], a22 = A[8];

    let p1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a00, dae.addExpression(ExprKind.Binary, BinOp.Mul, a11, a22));
    let p2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a01, dae.addExpression(ExprKind.Binary, BinOp.Mul, a12, a20));
    let p3 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a02, dae.addExpression(ExprKind.Binary, BinOp.Mul, a10, a21));
    let pos = dae.addExpression(ExprKind.Binary, BinOp.Add, dae.addExpression(ExprKind.Binary, BinOp.Add, p1, p2), p3);

    let n1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a02, dae.addExpression(ExprKind.Binary, BinOp.Mul, a11, a20));
    let n2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a01, dae.addExpression(ExprKind.Binary, BinOp.Mul, a10, a22));
    let n3 = dae.addExpression(ExprKind.Binary, BinOp.Mul, a00, dae.addExpression(ExprKind.Binary, BinOp.Mul, a12, a21));
    let neg = dae.addExpression(ExprKind.Binary, BinOp.Add, dae.addExpression(ExprKind.Binary, BinOp.Add, n1, n2), n3);

    let sub = dae.addExpression(ExprKind.Binary, BinOp.Sub, pos, neg);
    return cas_simplify(dae, sub);
  }

  // Laplace cofactor expansion along row 0
  let det = dae.addRealLiteral(0.0);
  let subN = n - 1;
  let minor = new Uint32Array(subN * subN);

  for (let j: u32 = 0; j < n; j++) {
    let elem = A[j];
    if (cas_isZero(dae, elem)) continue;

    // Fill minor matrix (skip row 0, skip col j)
    for (let r: u32 = 1; r < n; r++) {
      let minorCol: u32 = 0;
      for (let c: u32 = 0; c < n; c++) {
        if (c == j) continue;
        minor[(r - 1) * subN + minorCol] = A[r * n + c];
        minorCol++;
      }
    }

    let minorDet = symbolicDeterminant(dae, minor, subN);
    let cofactor = minorDet;
    if ((j & 1) == 1) {
      cofactor = cas_simplify(dae, dae.addExpression(ExprKind.Negate, 0, minorDet, 0xffffffff));
    }

    let term = dae.addExpression(ExprKind.Binary, BinOp.Mul, elem, cofactor);
    det = cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Add, det, term));
  }

  return det;
}

/**
 * Solves a linear system of equations symbolically and rewrites the DAE algebraic loop.
 */
export function symbolicSolveLinearSystem(
  dae: DaeBuilder,
  eqIdxs: Int32Array,
  varIdxs: Int32Array
): boolean {
  let n = varIdxs.length;
  if (eqIdxs.length < n || n == 0) return false;

  let stride = n + 1;
  let aug = new Uint32Array(n * stride);

  for (let i = 0; i < n; i++) {
    let eqIdx = eqIdxs[i] as u32;
    let offset = eqIdx * EQ_STRIDE;
    let lhsId = dae.getEqData().get(offset + EQ_LHS) as u32;
    let rhsId = dae.getEqData().get(offset + EQ_RHS) as u32;

    // eq = lhs - rhs (= 0)
    let eqExpr = dae.addExpression(ExprKind.Binary, BinOp.Sub, lhsId, rhsId);
    let eq = cas_simplify(dae, eqExpr);

    // Extract Jacobian coefficients: A[i, j] = d(eq) / d(varIdxs[j])
    for (let j = 0; j < n; j++) {
      let targetVar = varIdxs[j] as u32;
      let coeff = cas_differentiate(dae, eq, targetVar);

      // Linearity check: coefficient must not contain any target variables
      if (symbolicContainsAnyVar(dae, coeff, varIdxs)) {
        return false; // Non-linear in target variables
      }
      aug[i * stride + j] = coeff;
    }

    // Constant term: eq with all target variables set to 0
    let constTerm = symbolicSubstituteZeros(dae, eq, varIdxs);
    if (symbolicContainsAnyVar(dae, constTerm, varIdxs)) {
      return false; // Non-linear constant term
    }

    // b[i] = -constTerm
    let negConst = dae.addExpression(ExprKind.Negate, 0, constTerm, 0xffffffff);
    aug[i * stride + n] = cas_simplify(dae, negConst);
  }

  let solution = symbolicGaussianElimination(dae, aug, n as u32);
  if (!solution) return false;

  // Rewrite the equations to explicit assignments: varIdxs[i] = solution[i]
  for (let i = 0; i < n; i++) {
    let eqIdx = eqIdxs[i] as u32;
    let targetVar = varIdxs[i] as u32;
    let lhsVarExpr = dae.addName(targetVar);
    let rhsSolvedExpr = solution[i];

    let eqOffset = eqIdx * EQ_STRIDE;
    dae.getEqData().set(eqOffset + EQ_LHS, lhsVarExpr);
    dae.getEqData().set(eqOffset + EQ_RHS, rhsSolvedExpr);
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Export Wrappers
// ─────────────────────────────────────────────────────────────────────────────

export function linalg_solve_system(
  daePtr: u32,
  eqIdxsPtr: usize,
  nEqs: u32,
  varIdxsPtr: usize,
  nVars: u32
): boolean {
  if (daePtr == 0 || nEqs == 0 || nVars == 0) return false;
  let dae = changetype<DaeBuilder>(daePtr);

  let eqIdxs = new Int32Array(nEqs);
  for (let i: u32 = 0; i < nEqs; i++) {
    eqIdxs[i] = load<i32>(eqIdxsPtr + (i << 2));
  }

  let varIdxs = new Int32Array(nVars);
  for (let i: u32 = 0; i < nVars; i++) {
    varIdxs[i] = load<i32>(varIdxsPtr + (i << 2));
  }

  return symbolicSolveLinearSystem(dae, eqIdxs, varIdxs);
}

export function linalg_determinant(daePtr: u32, matrixPtr: usize, n: u32): u32 {
  if (daePtr == 0 || n == 0) return 0;
  let dae = changetype<DaeBuilder>(daePtr);
  let total = n * n;
  let matrix = new Uint32Array(total);
  for (let i: u32 = 0; i < total; i++) {
    matrix[i] = load<u32>(matrixPtr + (i << 2));
  }
  return symbolicDeterminant(dae, matrix, n);
}
