/* eslint-disable */
// @ts-nocheck
import { DaeBuilder, ExprKind, BinOp, UnaryOp, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT } from "./dae";

/**
 * Computer Algebra System (CAS) & Symbolic Simplification Engine in WASM.
 * Implements algebraic rewrite rules, constant folding, and symbolic differentiation over DaeBuilder arena expressions.
 */

export function cas_getRealValue(dae: DaeBuilder, exprId: u32): f64 {
  let offset = exprId * EXPR_STRIDE;
  let lo = dae.exprData.get(offset + EXPR_DATA1) as u32;
  let hi = dae.exprData.get(offset + EXPR_LEFT) as u32;
  let bits = ((hi as u64) << 32) | (lo as u64);
  return reinterpret<f64>(bits);
}

export function cas_isZero(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (dae.exprData.get(offset + EXPR_DATA1) as i32) == 0;
  }
  if (kind == ExprKind.RealLiteral) {
    return cas_getRealValue(dae, exprId) == 0.0;
  }
  return false;
}

export function cas_isOne(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (dae.exprData.get(offset + EXPR_DATA1) as i32) == 1;
  }
  if (kind == ExprKind.RealLiteral) {
    return cas_getRealValue(dae, exprId) == 1.0;
  }
  return false;
}

export function cas_isConstant(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);
  return kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral;
}

/**
 * Recursively simplifies an algebraic expression using rewrite rules.
 */
export function cas_simplify(dae: DaeBuilder, exprId: u32): u32 {
  if (exprId >= dae.exprCount) return exprId;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Binary) {
    let op = dae.exprData.get(offset + EXPR_DATA1);
    let left = cas_simplify(dae, dae.exprData.get(offset + EXPR_LEFT));
    let right = cas_simplify(dae, dae.exprData.get(offset + EXPR_RIGHT));

    // Constant folding if both operands are numeric constants
    if (cas_isConstant(dae, left) && cas_isConstant(dae, right)) {
      let vLeft = cas_getRealValue(dae, left);
      let vRight = cas_getRealValue(dae, right);
      if (op == BinOp.Add) return dae.addRealLiteral(vLeft + vRight);
      if (op == BinOp.Sub) return dae.addRealLiteral(vLeft - vRight);
      if (op == BinOp.Mul) return dae.addRealLiteral(vLeft * vRight);
      if (op == BinOp.Div && vRight != 0.0) return dae.addRealLiteral(vLeft / vRight);
      if (op == BinOp.Pow) return dae.addRealLiteral(Math.pow(vLeft, vRight));
    }

    // Algebraic Rewrite Rules:
    if (op == BinOp.Add) {
      // x + 0 -> x
      if (cas_isZero(dae, right)) return left;
      // 0 + x -> x
      if (cas_isZero(dae, left)) return right;
    } else if (op == BinOp.Sub) {
      // x - 0 -> x
      if (cas_isZero(dae, right)) return left;
      // x - x -> 0
      if (left == right) return dae.addRealLiteral(0.0);
    } else if (op == BinOp.Mul) {
      // x * 0 -> 0 or 0 * x -> 0
      if (cas_isZero(dae, left) || cas_isZero(dae, right)) return dae.addRealLiteral(0.0);
      // x * 1 -> x
      if (cas_isOne(dae, right)) return left;
      // 1 * x -> x
      if (cas_isOne(dae, left)) return right;
    } else if (op == BinOp.Div) {
      // 0 / x -> 0
      if (cas_isZero(dae, left)) return dae.addRealLiteral(0.0);
      // x / 1 -> x
      if (cas_isOne(dae, right)) return left;
      // x / x -> 1 (when x != 0)
      if (left == right) return dae.addRealLiteral(1.0);
    } else if (op == BinOp.Pow) {
      // x ^ 0 -> 1
      if (cas_isZero(dae, right)) return dae.addRealLiteral(1.0);
      // x ^ 1 -> x
      if (cas_isOne(dae, right)) return left;
    }

    return dae.addExpression(ExprKind.Binary, op, left, right);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let sub = cas_simplify(dae, dae.exprData.get(offset + EXPR_LEFT));
    if (cas_isConstant(dae, sub)) {
      let val = cas_getRealValue(dae, sub);
      return dae.addRealLiteral(-val);
    }
    // -(-x) -> x
    let subOffset = sub * EXPR_STRIDE;
    let subKind = dae.exprData.get(subOffset + EXPR_KIND);
    if (subKind == ExprKind.Negate || subKind == ExprKind.Unary) {
      return dae.exprData.get(subOffset + EXPR_LEFT);
    }
    return dae.addExpression(ExprKind.Negate, 0, sub, 0xffffffff);
  }

  return exprId;
}

/**
 * Computes exact symbolic derivative of an expression with respect to a variable ID: d(expr) / d(varId).
 */
export function cas_differentiate(dae: DaeBuilder, exprId: u32, targetVarId: u32): u32 {
  if (exprId >= dae.exprCount) return dae.addRealLiteral(0.0);
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    let varId = dae.exprData.get(offset + EXPR_DATA1);
    // d(x) / dx = 1, d(y) / dx = 0
    return varId == targetVarId ? dae.addRealLiteral(1.0) : dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral) {
    // d(const) / dx = 0
    return dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.Binary) {
    let op = dae.exprData.get(offset + EXPR_DATA1);
    let u = dae.exprData.get(offset + EXPR_LEFT);
    let v = dae.exprData.get(offset + EXPR_RIGHT);
    let du = cas_differentiate(dae, u, targetVarId);
    let dv = cas_differentiate(dae, v, targetVarId);

    if (op == BinOp.Add) {
      // d(u + v) = du + dv
      let add = dae.addExpression(ExprKind.Binary, BinOp.Add, du, dv);
      return cas_simplify(dae, add);
    }
    if (op == BinOp.Sub) {
      // d(u - v) = du - dv
      let sub = dae.addExpression(ExprKind.Binary, BinOp.Sub, du, dv);
      return cas_simplify(dae, sub);
    }
    if (op == BinOp.Mul) {
      // Product rule: d(u * v) = du * v + u * dv
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, du, v);
      let t2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
      let add = dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2);
      return cas_simplify(dae, add);
    }
    if (op == BinOp.Div) {
      // Quotient rule: d(u / v) = (du * v - u * dv) / (v ^ 2)
      let num1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, du, v);
      let num2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
      let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, num1, num2);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, v);
      let div = dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
      return cas_simplify(dae, div);
    }
  }

  if (kind == ExprKind.Negate || kind == ExprKind.Unary) {
    let u = dae.exprData.get(offset + EXPR_LEFT);
    let du = cas_differentiate(dae, u, targetVarId);
    let neg = dae.addExpression(ExprKind.Negate, 0, du, 0xffffffff);
    return cas_simplify(dae, neg);
  }

  return dae.addRealLiteral(0.0);
}

// ----------------------------------------------------------------------------
// Standalone WASM Exports
// ----------------------------------------------------------------------------

export function cas_export_simplify(daePtr: u32, exprId: u32): u32 {
  if (daePtr == 0) return exprId;
  return cas_simplify(changetype<DaeBuilder>(daePtr), exprId);
}

export function cas_export_differentiate(daePtr: u32, exprId: u32, targetVarId: u32): u32 {
  if (daePtr == 0) return 0;
  return cas_differentiate(changetype<DaeBuilder>(daePtr), exprId, targetVarId);
}
