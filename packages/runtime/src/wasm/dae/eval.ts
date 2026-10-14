// SPDX-License-Identifier: AGPL-3.0-or-later

import { DaeBuilder, ExprKind, BinOp, UnaryOp, BuiltinMathFunc } from "./builder";
import { ExprAccessor, EqAccessor } from "./accessors";
import { UnmanagedFloat64Array } from "../core/array";

/**
 * Evaluates an expression tree in the DaeBuilder given a buffer of variable values.
 * Returns f64 result.
 */
export function evalExpr(exprId: u32, dae: DaeBuilder, varValuesPtr: usize): f64 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0.0;

  let e = ExprAccessor.at(dae.getExprData(), exprId);
  let kind = e.kind;

  if (kind == ExprKind.RealLiteral) {
    return e.realValue;
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.EnumLiteral) {
    return e.intValue as f64;
  }

  if (kind == ExprKind.Name) {
    let varId = e.varId;
    if (varId == 0xffffffff) return 0.0;
    if (varId >= dae.varCount) {
      let lookedUp = dae.lookupVariableByName(varId);
      if (lookedUp < 0) return 0.0;
      varId = lookedUp as u32;
    }
    return changetype<UnmanagedFloat64Array>(varValuesPtr)[varId];
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let isNot = kind == ExprKind.Unary && e.unaryOp == UnaryOp.Not;
    let left = e.left;
    let val = evalExpr(left, dae, varValuesPtr);
    if (isNot) {
      return val == 0.0 ? 1.0 : 0.0;
    }
    return -val;
  }

  if (kind == ExprKind.Binary) {
    let op = e.binOp;
    let left = e.left;
    let right = e.right;
    let lVal = evalExpr(left, dae, varValuesPtr);
    let rVal = evalExpr(right, dae, varValuesPtr);

    if (op == BinOp.Add || op == BinOp.ElemAdd) return lVal + rVal;
    if (op == BinOp.Sub || op == BinOp.ElemSub) return lVal - rVal;
    if (op == BinOp.Mul || op == BinOp.ElemMul) return lVal * rVal;
    if (op == BinOp.Div || op == BinOp.ElemDiv) return lVal / rVal;
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

  if (kind == ExprKind.IfElse) {
    let cond = e.data1u;
    let left = e.left;
    let right = e.right;
    let condVal = evalExpr(cond, dae, varValuesPtr);
    return condVal != 0.0
      ? evalExpr(left,  dae, varValuesPtr)
      : evalExpr(right, dae, varValuesPtr);
  }

  if (kind == ExprKind.Call) {
    let left = e.left;
    let right = e.right;
    let funcId = e.funcId as i32;
    let v1 = evalExpr(left, dae, varValuesPtr);

    if (funcId == BuiltinMathFunc.Sin)   return Math.sin(v1);
    if (funcId == BuiltinMathFunc.Cos)   return Math.cos(v1);
    if (funcId == BuiltinMathFunc.Tan)   return Math.tan(v1);
    if (funcId == BuiltinMathFunc.Asin)  return Math.asin(v1);
    if (funcId == BuiltinMathFunc.Acos)  return Math.acos(v1);
    if (funcId == BuiltinMathFunc.Atan)  return Math.atan(v1);
    if (funcId == BuiltinMathFunc.Sinh)  return Math.sinh(v1);
    if (funcId == BuiltinMathFunc.Cosh)  return Math.cosh(v1);
    if (funcId == BuiltinMathFunc.Tanh)  return Math.tanh(v1);
    if (funcId == BuiltinMathFunc.Exp)   return Math.exp(v1);
    if (funcId == BuiltinMathFunc.Log)   return Math.log(v1);
    if (funcId == BuiltinMathFunc.Log10) return Math.log10(v1);
    if (funcId == BuiltinMathFunc.Sqrt)  return Math.sqrt(v1);
    if (funcId == BuiltinMathFunc.Abs)   return Math.abs(v1);
    if (funcId == BuiltinMathFunc.Sign)  return v1 > 0.0 ? 1.0 : v1 < 0.0 ? -1.0 : 0.0;
    if (funcId == BuiltinMathFunc.Floor) return Math.floor(v1);
    if (funcId == BuiltinMathFunc.Ceil)  return Math.ceil(v1);

    if (
      funcId == BuiltinMathFunc.Atan2 ||
      funcId == BuiltinMathFunc.Min ||
      funcId == BuiltinMathFunc.Max ||
      funcId == BuiltinMathFunc.Fmod ||
      funcId == BuiltinMathFunc.Pow
    ) {
      let secondArgId = right;
      if (exprId + 1 < dae.exprCount) {
        let nextAcc = ExprAccessor.at(dae.getExprData(), exprId + 1);
        if (nextAcc.kind == ExprKind.Tuple) {
          secondArgId = nextAcc.left;
        }
      }
      if (secondArgId >= dae.exprCount && left + 1 < dae.exprCount) {
        secondArgId = left + 1;
      }
      let v2 = evalExpr(secondArgId, dae, varValuesPtr);
      if (funcId == BuiltinMathFunc.Atan2) return Math.atan2(v1, v2);
      if (funcId == BuiltinMathFunc.Min)   return Math.min(v1, v2);
      if (funcId == BuiltinMathFunc.Max)   return Math.max(v1, v2);
      if (funcId == BuiltinMathFunc.Fmod)  return v2 != 0.0 ? v1 % v2 : 0.0;
      if (funcId == BuiltinMathFunc.Pow)   return Math.pow(v1, v2);
    }
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
