// SPDX-License-Identifier: AGPL-3.0-or-later

import { DaeBuilder, ExprKind, BinOp, UnaryOp, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT, EQ_STRIDE, EQ_KIND, EQ_LHS, EQ_RHS } from "./dae";

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values.
 * Returns f64 result.
 */
export function evalExpr(exprId: u32, dae: DaeBuilder, varValuesPtr: usize): f64 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0.0;

  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.RealLiteral) {
    let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    return f64.reinterpret_i64(bits as i64);
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.EnumLiteral) {
    let val = exprData.get(offset + EXPR_DATA1) as i32;
    return val as f64;
  }

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1) as u32;
    if (varId == 0xffffffff || varId >= dae.varCount) return 0.0;
    return load<f64>(varValuesPtr + (varId as usize) * 8);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let left = exprData.get(offset + EXPR_LEFT);
    let val = evalExpr(left, dae, varValuesPtr);
    let op = exprData.get(offset + EXPR_DATA1);
    if (op == UnaryOp.Not) {
      return val == 0.0 ? 1.0 : 0.0;
    }
    return -val;
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);

    let lVal = evalExpr(left, dae, varValuesPtr);
    let rVal = evalExpr(right, dae, varValuesPtr);

    if (op == BinOp.Add || op == BinOp.ElemAdd) return lVal + rVal;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return lVal - rVal;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return lVal * rVal;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return rVal != 0.0 ? lVal / rVal : 0.0;
    if (op == BinOp.Pow || op == BinOp.ElemPow) return Math.pow(lVal, rVal);
    if (op == BinOp.Eq) return lVal == rVal ? 1.0 : 0.0;
    if (op == BinOp.Neq) return lVal != rVal ? 1.0 : 0.0;
    if (op == BinOp.Lt) return lVal < rVal ? 1.0 : 0.0;
    if (op == BinOp.Lte) return lVal <= rVal ? 1.0 : 0.0;
    if (op == BinOp.Gt) return lVal > rVal ? 1.0 : 0.0;
    if (op == BinOp.Gte) return lVal >= rVal ? 1.0 : 0.0;
    if (op == BinOp.And) return lVal != 0.0 && rVal != 0.0 ? 1.0 : 0.0;
    if (op == BinOp.Or) return lVal != 0.0 || rVal != 0.0 ? 1.0 : 0.0;
  }

  if (kind == ExprKind.IfElse) {
    let condId = exprData.get(offset + EXPR_DATA1);
    let thenId = exprData.get(offset + EXPR_LEFT);
    let elseId = exprData.get(offset + EXPR_RIGHT);
    let condVal = evalExpr(condId, dae, varValuesPtr);
    if (condVal != 0.0) {
      return evalExpr(thenId, dae, varValuesPtr);
    } else {
      return evalExpr(elseId, dae, varValuesPtr);
    }
  }

  if (kind == ExprKind.Call) {
    let funcId = exprData.get(offset + EXPR_DATA1);
    let arg1 = exprData.get(offset + EXPR_LEFT);
    let arg2 = exprData.get(offset + EXPR_RIGHT);

    let v1 = evalExpr(arg1, dae, varValuesPtr);
    let v2 = evalExpr(arg2, dae, varValuesPtr);

    if (funcId == 1) return Math.abs(v1);
    if (funcId == 2) return Math.sqrt(v1);
    if (funcId == 3) return Math.sin(v1);
    if (funcId == 4) return Math.cos(v1);
    if (funcId == 5) return Math.exp(v1);
    if (funcId == 6) return Math.log(v1);
    if (funcId == 7) return Math.floor(v1);
    if (funcId == 8) return Math.ceil(v1);
    if (funcId == 9) return Math.min(v1, v2);
    if (funcId == 10) return Math.max(v1, v2);
    if (funcId == 11) return Math.tan(v1);
    if (funcId == 12) return Math.asin(v1);
    if (funcId == 13) return Math.acos(v1);
    if (funcId == 14) return Math.atan(v1);
    if (funcId == 15) return Math.atan2(v1, v2);
    if (funcId == 16) return Math.sinh(v1);
    if (funcId == 17) return Math.cosh(v1);
    if (funcId == 18) return Math.tanh(v1);
    if (funcId == 19) return Math.log10(v1);
    if (funcId == 20) return v1 > 0.0 ? 1.0 : v1 < 0.0 ? -1.0 : 0.0; // sign
  }

  return 0.0;
}

/**
 * Computes equation residual: F(x) = RHS - LHS
 */
@inline
export function evalEquationResidual(eqId: u32, dae: DaeBuilder, varValuesPtr: usize): f64 {
  if (eqId >= dae.eqCount) return 0.0;
  let eqData = dae.getEqData();
  let offset = eqId * EQ_STRIDE;
  let lhsId = eqData.get(offset + EQ_LHS);
  let rhsId = eqData.get(offset + EQ_RHS);

  let lhsVal = evalExpr(lhsId, dae, varValuesPtr);
  let rhsVal = evalExpr(rhsId, dae, varValuesPtr);

  return rhsVal - lhsVal;
}

export function dae_evalExpr(daePtr: u32, exprId: u32, varValuesPtr: usize): f64 {
  return evalExpr(exprId, changetype<DaeBuilder>(daePtr), varValuesPtr);
}

export function dae_evalEquationResidual(daePtr: u32, eqId: u32, varValuesPtr: usize): f64 {
  return evalEquationResidual(eqId, changetype<DaeBuilder>(daePtr), varValuesPtr);
}
