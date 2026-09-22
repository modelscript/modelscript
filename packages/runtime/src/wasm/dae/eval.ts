// SPDX-License-Identifier: AGPL-3.0-or-later

import { DaeBuilder, ExprKind, BinOp, UnaryOp } from "./builder";
import { ExprAccessor, EqAccessor } from "./accessors";

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values.
 * Returns f64 result.
 */
export function evalExpr(exprId: u32, dae: DaeBuilder, varValuesPtr: usize): f64 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0.0;

  let e = ExprAccessor.at(dae.getExprData(), exprId);

  if (e.kind == ExprKind.RealLiteral) {
    return e.realValue;
  }

  if (e.kind == ExprKind.IntLiteral || e.kind == ExprKind.BoolLiteral || e.kind == ExprKind.EnumLiteral) {
    return e.intValue as f64;
  }

  if (e.kind == ExprKind.Name) {
    let varId = e.varId;
    if (varId == 0xffffffff || varId >= dae.varCount) return 0.0;
    return load<f64>(varValuesPtr + (varId as usize) * 8);
  }

  if (e.kind == ExprKind.Unary || e.kind == ExprKind.Negate) {
    let isNot = e.unaryOp == UnaryOp.Not;
    let left = e.left;
    let val = evalExpr(left, dae, varValuesPtr);
    if (isNot) {
      return val == 0.0 ? 1.0 : 0.0;
    }
    return -val;
  }

  if (e.kind == ExprKind.Binary) {
    let op = e.binOp;
    let left = e.left;
    let right = e.right;
    let lVal = evalExpr(left, dae, varValuesPtr);
    let rVal = evalExpr(right, dae, varValuesPtr);

    if (op == BinOp.Add || op == BinOp.ElemAdd) return lVal + rVal;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return lVal - rVal;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return lVal * rVal;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return rVal != 0.0 ? lVal / rVal : 0.0;
    if (op == BinOp.Pow || op == BinOp.ElemPow) return Math.pow(lVal, rVal);
    if (op == BinOp.Eq)  return lVal == rVal ? 1.0 : 0.0;
    if (op == BinOp.Neq) return lVal != rVal ? 1.0 : 0.0;
    if (op == BinOp.Lt)  return lVal <  rVal ? 1.0 : 0.0;
    if (op == BinOp.Lte) return lVal <= rVal ? 1.0 : 0.0;
    if (op == BinOp.Gt)  return lVal >  rVal ? 1.0 : 0.0;
    if (op == BinOp.Gte) return lVal >= rVal ? 1.0 : 0.0;
    if (op == BinOp.And) return lVal != 0.0 && rVal != 0.0 ? 1.0 : 0.0;
    if (op == BinOp.Or)  return lVal != 0.0 || rVal != 0.0 ? 1.0 : 0.0;
  }

  if (e.kind == ExprKind.IfElse) {
    let cond = e.data1u;
    let left = e.left;
    let right = e.right;
    let condVal = evalExpr(cond, dae, varValuesPtr);
    return condVal != 0.0
      ? evalExpr(left,  dae, varValuesPtr)
      : evalExpr(right, dae, varValuesPtr);
  }

  if (e.kind == ExprKind.Call) {
    let left = e.left;
    let right = e.right;
    let funcId = e.funcId as i32;
    let v1 = evalExpr(left,  dae, varValuesPtr);
    let v2 = evalExpr(right, dae, varValuesPtr);

    if (funcId ==  1) return Math.abs(v1);
    if (funcId ==  2) return Math.sqrt(v1);
    if (funcId ==  3) return Math.sin(v1);
    if (funcId ==  4) return Math.cos(v1);
    if (funcId ==  5) return Math.exp(v1);
    if (funcId ==  6) return Math.log(v1);
    if (funcId ==  7) return Math.floor(v1);
    if (funcId ==  8) return Math.ceil(v1);
    if (funcId ==  9) return Math.min(v1, v2);
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
  let eq = EqAccessor.at(dae.getEqData(), eqId);
  let lhs = eq.lhs;
  let rhs = eq.rhs;
  let lhsVal = evalExpr(lhs, dae, varValuesPtr);
  let rhsVal = evalExpr(rhs, dae, varValuesPtr);
  return rhsVal - lhsVal;
}

export function dae_evalExpr(daePtr: u32, exprId: u32, varValuesPtr: usize): f64 {
  return evalExpr(exprId, changetype<DaeBuilder>(daePtr), varValuesPtr);
}

export function dae_evalEquationResidual(daePtr: u32, eqId: u32, varValuesPtr: usize): f64 {
  return evalEquationResidual(eqId, changetype<DaeBuilder>(daePtr), varValuesPtr);
}
