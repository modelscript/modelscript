// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  Variability,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EQ_AUX,
  EqKind,
  VAR_STRIDE,
  VAR_NAME,
  VAR_TYPE,
  VAR_VARIABILITY,
  VAR_CAUSALITY,
  VAR_FLAGS,
  FLAG_TEARING_VAR,
  FLAG_VAR_STATE,
  FLAG_VAR_STATE_DER,
  FLAG_VAR_FIXED,
  FLAG_EQ_INITIAL,
  FLAG_HIGH_INDEX_EQ,
} from "../dae/builder";
import { BltEngine } from "./blt";
import { BuiltinMathFunc } from "../dae/cas";
import { simplifyAst } from "../parser";
import {
  ChunkedInt32Array,
  ChunkedUint8Array,
  createChunkedInt32Array,
  createChunkedUint8Array,
} from "../core/array";
import { atomicChunkAlloc, debugLog } from "../arena";

/**
 * Checks if an expression evaluates structurally to zero literal.
 */
@inline
export function isZeroExpr(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as i32) == 0;
  }
  if (kind == ExprKind.RealLiteral) {
    let lo = (dae.getExprData().get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (dae.getExprData().get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    return val == 0.0;
  }
  return false;
}

/**
 * Checks if an expression evaluates structurally to one literal.
 */
@inline
export function isOneExpr(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff) return false;
  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (dae.getExprData().get(offset + EXPR_DATA1) as i32) == 1;
  }
  if (kind == ExprKind.RealLiteral) {
    let lo = (dae.getExprData().get(offset + EXPR_DATA1) as u64) & 0xffffffff;
    let hi = (dae.getExprData().get(offset + EXPR_LEFT) as u64) & 0xffffffff;
    let bits = (hi << 32) | lo;
    let val = f64.reinterpret_i64(bits as i64);
    return val == 1.0;
  }
  return false;
}

/**
 * Checks if an expression contains a derivative operator (recursing across all AST nodes).
 */
export function containsDerivative(exprId: u32, dae: DaeBuilder): boolean {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return false;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);
  if (kind == ExprKind.Der) return true;

  if (kind == ExprKind.Binary || kind == ExprKind.Range) {
    let data1 = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (kind == ExprKind.Range && data1 != 0xffffffff && containsDerivative(data1, dae)) return true;
    if (left != 0xffffffff && containsDerivative(left, dae)) return true;
    if (right != 0xffffffff && containsDerivative(right, dae)) return true;
    return false;
  }

  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let thenBranch = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let elseBranch = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (cond != 0xffffffff && containsDerivative(cond, dae)) return true;
    if (thenBranch != 0xffffffff && containsDerivative(thenBranch, dae)) return true;
    if (elseBranch != 0xffffffff && containsDerivative(elseBranch, dae)) return true;
    return false;
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    return left != 0xffffffff && containsDerivative(left, dae);
  }

  if (kind == ExprKind.Pre) {
    let data1 = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    if (data1 != 0xffffffff && data1 < dae.exprCount && containsDerivative(data1, dae)) return true;
    if (left != 0xffffffff && left < dae.exprCount && containsDerivative(left, dae)) return true;
    return false;
  }

  if (kind == ExprKind.Subscript || kind == ExprKind.Call || kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
    if (kind == ExprKind.Subscript) {
      let baseExpr = dae.getExprData().get(offset + EXPR_DATA1) as u32;
      if (baseExpr != 0xffffffff && containsDerivative(baseExpr, dae)) return true;
    }
    let rightVal = u32(dae.getExprData().get(offset + EXPR_RIGHT));
    let data1Val = u32(dae.getExprData().get(offset + EXPR_DATA1));
    let count: u32 =
      kind == ExprKind.Call || kind == ExprKind.Subscript
        ? rightVal
        : rightVal > 0 && rightVal != 0xffffffff
          ? rightVal
          : data1Val;
    let first: u32 = u32(dae.getExprData().get(offset + EXPR_LEFT));
    if (count > 0 && count != 0xffffffff && first != 0xffffffff) {
      if (containsDerivative(first, dae)) return true;
      for (let j: u32 = 1; j < count; j++) {
        let slotIdx = exprId + j;
        if (slotIdx < dae.exprCount) {
          let slotOffset = slotIdx * EXPR_STRIDE;
          let slotKind = dae.getExprData().get(slotOffset + EXPR_KIND);
          let argExpr = slotKind == ExprKind.Tuple
            ? (dae.getExprData().get(slotOffset + EXPR_LEFT) as u32)
            : first + j;
          if (argExpr != 0xffffffff && containsDerivative(argExpr, dae)) return true;
        }
      }
    }
    return false;
  }

  return false;
}

/**
 * Resolves the AST expression ID for the `idx`-th argument of a multi-argument function call in the DAE arena.
 */
@inline
function getCallSubArgPantelides(dae: DaeBuilder, callExprId: u32, firstArg: u32, idx: u32): u32 {
  if (idx == 0) return firstArg;
  let slotIdx = callExprId + idx;
  if (slotIdx < dae.exprCount) {
    let slotOffset = slotIdx * EXPR_STRIDE;
    if (dae.getExprData().get(slotOffset + EXPR_KIND) == ExprKind.Tuple) {
      return dae.getExprData().get(slotOffset + EXPR_LEFT) as u32;
    }
  }
  return firstArg + idx;
}

/**
 * Symbolic Differentiator for expressions in the DAE Builder.
 * Differentiates an expression tree with respect to continuous time t.
 */
export function differentiateExpr(exprId: u32, dae: DaeBuilder, stateVars: ChunkedInt32Array): u32 {
  if (exprId == 0xffffffff || exprId >= dae.exprCount) return 0xffffffff;

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  // Constants & Literals -> d/dt (c) = 0.0
  if (
    kind == ExprKind.IntLiteral ||
    kind == ExprKind.RealLiteral ||
    kind == ExprKind.BoolLiteral ||
    kind == ExprKind.StringLiteral ||
    kind == ExprKind.EnumLiteral
  ) {
    return dae.addRealLiteral(0.0);
  }

  // Variable Reference
  if (kind == ExprKind.Name) {
    let rawId: u32 = u32(dae.getExprData().get(offset + EXPR_DATA1));
    if (dae.getStringPool().isTime(rawId as i32)) {
      return dae.addRealLiteral(1.0);
    }
    let resolvedVarId: i32 = rawId < dae.varCount ? (rawId as i32) : dae.lookupVariableByName(rawId);
    if (resolvedVarId >= 0 && (resolvedVarId as u32) < dae.varCount) {
      let varId = resolvedVarId as u32;
      let varNameId = dae.getVarData().get(varId * VAR_STRIDE + VAR_NAME) as i32;
      if (dae.getStringPool().isTime(varNameId)) {
        return dae.addRealLiteral(1.0);
      }
      let variability = dae.getVarData().get(varId * VAR_STRIDE + VAR_VARIABILITY);
      if (
        variability == Variability.Parameter ||
        variability == Variability.Constant ||
        variability == Variability.Discrete
      ) {
        return dae.addRealLiteral(0.0);
      }
      if (stateVars.length > 0) {
        let isState = false;
        for (let s: u32 = 0; s < stateVars.length; s++) {
          let sv = stateVars.get(s);
          if (sv == (varId as i32) || sv == (rawId as i32)) {
            isState = true;
            break;
          }
        }
        if (!isState) {
          return dae.addRealLiteral(0.0);
        }
      }
      return dae.addExpression(ExprKind.Der, exprId);
    }
    if (stateVars.length > 0) {
      let isState = false;
      for (let s: u32 = 0; s < stateVars.length; s++) {
        if (stateVars.get(s) == (rawId as i32)) {
          isState = true;
          break;
        }
      }
      if (!isState) {
        return dae.addRealLiteral(0.0);
      }
    }
    return dae.addExpression(ExprKind.Der, exprId);
  }

  // Subscript: d/dt(x[i]) -> der(x[i]) (or 0.0 if base is parameter/constant/discrete)
  if (kind == ExprKind.Subscript) {
    let baseExpr = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (baseExpr != 0xffffffff && baseExpr < dae.exprCount) {
      let bOff = baseExpr * EXPR_STRIDE;
      if (dae.getExprData().get(bOff + EXPR_KIND) == ExprKind.Name) {
        let rawId = dae.getExprData().get(bOff + EXPR_DATA1) as u32;
        let resolvedVarId: i32 = rawId < dae.varCount ? (rawId as i32) : dae.lookupVariableByName(rawId);
        if (resolvedVarId >= 0 && (resolvedVarId as u32) < dae.varCount) {
          let variability = dae.getVarData().get((resolvedVarId as u32) * VAR_STRIDE + VAR_VARIABILITY);
          if (
            variability == Variability.Parameter ||
            variability == Variability.Constant ||
            variability == Variability.Discrete
          ) {
            return dae.addRealLiteral(0.0);
          }
        }
      }
    }
    return dae.addExpression(ExprKind.Der, exprId);
  }

  // Pre operator: discrete history has zero time derivative
  if (kind == ExprKind.Pre) {
    return dae.addRealLiteral(0.0);
  }

  // Derivative: der(x) -> der(der(x))
  if (kind == ExprKind.Der) {
    return dae.addExpression(ExprKind.Der, exprId);
  }

  // Unary Negation: d(-u) = -(du)
  if (kind == ExprKind.Negate) {
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let dLeft = differentiateExpr(left, dae, stateVars);
    if (isZeroExpr(dLeft, dae)) return dLeft;
    return dae.addExpression(ExprKind.Negate, 0, dLeft);
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let dLeft = differentiateExpr(left, dae, stateVars);
    if (op == UnaryOp.Negate) {
      if (isZeroExpr(dLeft, dae)) return dLeft;
      return dae.addExpression(ExprKind.Negate, 0, dLeft);
    }
    return dae.addRealLiteral(0.0);
  }

  // Conditional Expression: d(if c then u else v) = if c then du else dv
  if (kind == ExprKind.IfElse) {
    let cond = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let thenBranch = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let elseBranch = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    let dThen = differentiateExpr(thenBranch, dae, stateVars);
    let dElse = differentiateExpr(elseBranch, dae, stateVars);
    return dae.addExpression(ExprKind.IfElse, cond, dThen, dElse);
  }

  // Elementary Function Call: Chain Rule d(f(u))/dt = f'(u) * du/dt
  if (kind == ExprKind.Call) {
    let rawFuncId = dae.getExprData().get(offset + EXPR_DATA1);
    let funcId = dae.resolveBuiltinMathFunc(rawFuncId);
    let arg = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let argCount = dae.getExprData().get(offset + EXPR_RIGHT) as u32;
    if (arg == 0xffffffff || argCount == 0) return dae.addRealLiteral(0.0);

    if (funcId == BuiltinMathFunc.NoEvent || funcId == BuiltinMathFunc.Homotopy) {
      return differentiateExpr(arg, dae, stateVars);
    }
    if (funcId == BuiltinMathFunc.Smooth && argCount >= 2) {
      let exprArg = getCallSubArgPantelides(dae, exprId, arg, 1);
      return differentiateExpr(exprArg, dae, stateVars);
    }
    if (funcId == BuiltinMathFunc.SemiLinear && argCount >= 3) {
      let xArg = arg;
      let kPos = getCallSubArgPantelides(dae, exprId, arg, 1);
      let kNeg = getCallSubArgPantelides(dae, exprId, arg, 2);
      let dx = differentiateExpr(xArg, dae, stateVars);
      let dkPos = differentiateExpr(kPos, dae, stateVars);
      let dkNeg = differentiateExpr(kNeg, dae, stateVars);
      let posBranch = dae.addExpression(
        ExprKind.Binary,
        BinOp.Add,
        dae.addExpression(ExprKind.Binary, BinOp.Mul, kPos as i32, dx as i32) as i32,
        dae.addExpression(ExprKind.Binary, BinOp.Mul, xArg as i32, dkPos as i32) as i32,
      );
      let negBranch = dae.addExpression(
        ExprKind.Binary,
        BinOp.Add,
        dae.addExpression(ExprKind.Binary, BinOp.Mul, kNeg as i32, dx as i32) as i32,
        dae.addExpression(ExprKind.Binary, BinOp.Mul, xArg as i32, dkNeg as i32) as i32,
      );
      let cond = dae.addExpression(ExprKind.Binary, BinOp.Gte, xArg as i32, dae.addRealLiteral(0.0) as i32);
      return dae.addExpression(ExprKind.IfElse, cond as i32, posBranch as i32, negBranch as i32);
    }
    if ((funcId == BuiltinMathFunc.Min || funcId == BuiltinMathFunc.Max) && argCount >= 2) {
      let arg2 = getCallSubArgPantelides(dae, exprId, arg, 1);
      let dArg1 = differentiateExpr(arg, dae, stateVars);
      let dArg2 = differentiateExpr(arg2, dae, stateVars);
      let cmpOp = funcId == BuiltinMathFunc.Min ? BinOp.Lte : BinOp.Gte;
      let cond = dae.addExpression(ExprKind.Binary, cmpOp, arg as i32, arg2 as i32);
      return dae.addExpression(ExprKind.IfElse, cond as i32, dArg1 as i32, dArg2 as i32);
    }
    if (funcId == BuiltinMathFunc.Atan2 && argCount >= 2) {
      let xArg = getCallSubArgPantelides(dae, exprId, arg, 1);
      let dy = differentiateExpr(arg, dae, stateVars);
      let dx = differentiateExpr(xArg, dae, stateVars);
      if (isZeroExpr(dy, dae) && isZeroExpr(dx, dae)) return dae.addRealLiteral(0.0);
      let xDy = dae.addExpression(ExprKind.Binary, BinOp.Mul, xArg as i32, dy as i32);
      let yDx = dae.addExpression(ExprKind.Binary, BinOp.Mul, arg as i32, dx as i32);
      let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, xDy as i32, yDx as i32);
      let x2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, xArg as i32, xArg as i32);
      let y2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, arg as i32, arg as i32);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Add, x2 as i32, y2 as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, num as i32, den as i32);
    }
    if (funcId == BuiltinMathFunc.Pow && argCount >= 2) {
      let arg2 = getCallSubArgPantelides(dae, exprId, arg, 1);
      let powExpr = dae.addExpression(ExprKind.Binary, BinOp.Pow, arg as i32, arg2 as i32);
      return differentiateExpr(powExpr, dae, stateVars);
    }
    if (funcId == BuiltinMathFunc.Fmod || funcId == BuiltinMathFunc.Mod) {
      return differentiateExpr(arg, dae, stateVars);
    }
    if (funcId == BuiltinMathFunc.Sign || funcId == BuiltinMathFunc.Floor || funcId == BuiltinMathFunc.Ceil) {
      return dae.addRealLiteral(0.0);
    }

    let dArg = differentiateExpr(arg, dae, stateVars);
    if (isZeroExpr(dArg, dae)) return dae.addRealLiteral(0.0);

    if (funcId == BuiltinMathFunc.Sin) {
      let cosU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cos, arg as i32, 1);
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, cosU as i32, dArg as i32);
    }
    if (funcId == BuiltinMathFunc.Cos) {
      let sinU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sin, arg as i32, 1);
      let negSinU = dae.addExpression(ExprKind.Negate, 0, sinU as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, negSinU as i32, dArg as i32);
    }
    if (funcId == BuiltinMathFunc.Tan) {
      let cosU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cos, arg as i32, 1);
      let two = dae.addIntLiteral(2);
      let cos2U = dae.addExpression(ExprKind.Binary, BinOp.Pow, cosU as i32, two as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, cos2U as i32);
    }
    if (funcId == BuiltinMathFunc.Exp) {
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId as i32, dArg as i32);
    }
    if (funcId == BuiltinMathFunc.Log) {
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, arg as i32);
    }
    if (funcId == BuiltinMathFunc.Log10) {
      let ln10 = dae.addRealLiteral(Math.LN10);
      let denom = dae.addExpression(ExprKind.Binary, BinOp.Mul, arg as i32, ln10 as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, denom as i32);
    }
    if (funcId == BuiltinMathFunc.Sqrt) {
      let two = dae.addRealLiteral(2.0);
      let denom = dae.addExpression(ExprKind.Binary, BinOp.Mul, two as i32, exprId as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, denom as i32);
    }
    if (funcId == BuiltinMathFunc.Sinh) {
      let coshU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cosh, arg as i32, 1);
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, coshU as i32, dArg as i32);
    }
    if (funcId == BuiltinMathFunc.Cosh) {
      let sinhU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sinh, arg as i32, 1);
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, sinhU as i32, dArg as i32);
    }
    if (funcId == BuiltinMathFunc.Tanh) {
      let coshU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cosh, arg as i32, 1);
      let two = dae.addIntLiteral(2);
      let cosh2U = dae.addExpression(ExprKind.Binary, BinOp.Pow, coshU as i32, two as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, cosh2U as i32);
    }
    if (funcId == BuiltinMathFunc.Asin) {
      let one = dae.addRealLiteral(1.0);
      let two = dae.addIntLiteral(2);
      let u2 = dae.addExpression(ExprKind.Binary, BinOp.Pow, arg as i32, two as i32);
      let oneMinusU2 = dae.addExpression(ExprKind.Binary, BinOp.Sub, one as i32, u2 as i32);
      let denom = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, oneMinusU2 as i32, 1);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, denom as i32);
    }
    if (funcId == BuiltinMathFunc.Acos) {
      let one = dae.addRealLiteral(1.0);
      let two = dae.addIntLiteral(2);
      let u2 = dae.addExpression(ExprKind.Binary, BinOp.Pow, arg as i32, two as i32);
      let oneMinusU2 = dae.addExpression(ExprKind.Binary, BinOp.Sub, one as i32, u2 as i32);
      let denom = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, oneMinusU2 as i32, 1);
      let negDArg = dae.addExpression(ExprKind.Negate, 0, dArg as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, negDArg as i32, denom as i32);
    }
    if (funcId == BuiltinMathFunc.Atan) {
      let one = dae.addRealLiteral(1.0);
      let two = dae.addIntLiteral(2);
      let u2 = dae.addExpression(ExprKind.Binary, BinOp.Pow, arg as i32, two as i32);
      let denom = dae.addExpression(ExprKind.Binary, BinOp.Add, one as i32, u2 as i32);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, dArg as i32, denom as i32);
    }
    if (funcId == BuiltinMathFunc.Abs) {
      let cond = dae.addExpression(ExprKind.Binary, BinOp.Gte, arg as i32, dae.addRealLiteral(0.0) as i32);
      let negDu = dae.addExpression(ExprKind.Negate, 0, dArg as i32);
      return dae.addExpression(ExprKind.IfElse, cond as i32, dArg as i32, negDu as i32);
    }
    return dae.addRealLiteral(0.0);
  }

  // Binary Expression
  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1);
    let left = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let right = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    let dLeft = differentiateExpr(left, dae, stateVars);
    let dRight = differentiateExpr(right, dae, stateVars);

    let leftZero = isZeroExpr(dLeft, dae);
    let rightZero = isZeroExpr(dRight, dae);

    // Sum / Difference Rules
    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      if (leftZero && rightZero) return dLeft;
      if (leftZero) return dRight;
      if (rightZero) return dLeft;
      return dae.addExpression(ExprKind.Binary, op, dLeft, dRight);
    }

    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      if (leftZero && rightZero) return dLeft;
      if (leftZero) return dae.addExpression(ExprKind.Negate, 0, dRight);
      if (rightZero) return dLeft;
      return dae.addExpression(ExprKind.Binary, op, dLeft, dRight);
    }

    // Product Rule: d(u*v) = du*v + u*dv
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      if (leftZero && rightZero) return dae.addRealLiteral(0.0);
      if (leftZero) return dae.addExpression(ExprKind.Binary, op, left, dRight);
      if (rightZero) return dae.addExpression(ExprKind.Binary, op, dLeft, right);
      let t1 = dae.addExpression(ExprKind.Binary, op, dLeft, right);
      let t2 = dae.addExpression(ExprKind.Binary, op, left, dRight);
      return dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2);
    }

    // Quotient Rule: d(u/v) = (du*v - u*dv) / v^2
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      if (leftZero && rightZero) return dae.addRealLiteral(0.0);
      if (rightZero) {
        // d(u / c) = du / c
        return dae.addExpression(ExprKind.Binary, op, dLeft, right);
      }
      if (leftZero) {
        // d(c / v) = -c * dv / v^2
        let two = dae.addIntLiteral(2);
        let den = dae.addExpression(ExprKind.Binary, BinOp.Pow, right, two);
        let num = dae.addExpression(ExprKind.Binary, BinOp.Mul, left, dRight);
        let quot = dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
        return dae.addExpression(ExprKind.Negate, 0, quot);
      }
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, dLeft, right);
      let t2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, left, dRight);
      let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, t1, t2);
      let two = dae.addIntLiteral(2);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Pow, right, two);
      return dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
    }

    // Power Rule: d(u^v)
    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      if (leftZero && rightZero) return dae.addRealLiteral(0.0);
      if (rightZero) {
        let one = dae.addIntLiteral(1);
        let nMinus1 = dae.addExpression(ExprKind.Binary, BinOp.Sub, right, one);
        let uPowNminus1 = dae.addExpression(ExprKind.Binary, BinOp.Pow, left, nMinus1);
        let term1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, right, uPowNminus1);
        return dae.addExpression(ExprKind.Binary, BinOp.Mul, term1, dLeft);
      }
      if (leftZero) {
        // d(a^v) = a^v * ln(a) * dv
        let lnA = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, left as i32, 1);
        let aPowV = dae.addExpression(ExprKind.Binary, op, left, right);
        let term1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, aPowV, lnA);
        return dae.addExpression(ExprKind.Binary, BinOp.Mul, term1, dRight);
      }
      // General case: d(u^v) = u^v * (dv * ln(u) + v * du / u)
      let lnU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, left as i32, 1);
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, dRight, lnU);
      let vDu = dae.addExpression(ExprKind.Binary, BinOp.Mul, right, dLeft);
      let t2 = dae.addExpression(ExprKind.Binary, BinOp.Div, vDu, left);
      let sum = dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2);
      let uPowV = dae.addExpression(ExprKind.Binary, op, left, right);
      return dae.addExpression(ExprKind.Binary, BinOp.Mul, uPowV, sum);
    }

    return dae.addRealLiteral(0.0);
  }

  return dae.addRealLiteral(0.0);
}

/**
 * Pantelides Structural Index Reduction Engine.
 *
 * Implements structural index reduction for high-index Differential-Algebraic Equation (DAE)
 * systems using Pantelides algorithm and Mattsson-Söderlind dummy derivative selection.
 *
 * Academic Citations:
 *   - Pantelides, C. C. (1988). "The consistent initialization of differential-algebraic systems."
 *     SIAM Journal on Scientific and Statistical Computing, 9(2), pp. 213–231. DOI: 10.1137/0909014.
 *   - Mattsson, S. E., & Söderlind, G. (1993). "Index reduction in differential-algebraic equations
 *     using dummy derivatives." SIAM Journal on Scientific Computing, 14(3), pp. 677–692.
 *     DOI: 10.1137/0914043.
 *
 * ModelScript Architectural Rationale:
 *   Object-oriented physical models (e.g. multi-body mechanics, closed kinematic loops, incompressible
 *   fluid networks) frequently yield high-index DAEs (index >= 2). Standard numerical integrators
 *   are unstable or fail to converge on systems with differential index > 1. Pantelides algorithm
 *   identifies structurally singular subsets of equations and differentiates them analytically
 *   until an index-1 formulation is achieved. Mattsson-Söderlind dummy derivatives select a minimal
 *   set of independent state derivatives to avoid equation over-determination and drift.
 *
 * Modifications:
 *   - Implemented as an in-WASM zero-GC kernel directly inspecting `DAEBuilder` linear arrays.
 *   - Performs symbolic differentiation directly on AST expression nodes in WebAssembly linear memory.
 *   - Tracks differentiation levels and dummy derivative substitutions using flat `ChunkedInt32Array` buffers.
 *   - Seamlessly pairs with `BltEngine` for alternating augmenting path matching on highest-order variables.
 */
@unmanaged
export class PantelidesEngine {
  /** Target DAE arena containing equations, variables, and expressions. */
  dae: DaeBuilder;
  /** Companion BLT engine used for downstream block partitioning. */
  blt: BltEngine;

  // CSR Graph adjacency
  /** CSR row pointer array mapping each equation to its dependent variables slice. */
  eqDepPtrs: ChunkedInt32Array;
  /** CSR column index array storing variable IDs referenced by each equation. */
  eqDepVars: ChunkedInt32Array;

  // Bipartite matching arrays
  /** Maps each equation index to its matched highest-order variable ID (-1 if unmatched). */
  matchEqToVar: ChunkedInt32Array; // eq -> var
  /** Maps each variable ID to its matched equation index (-1 if unmatched). */
  matchVarToEq: ChunkedInt32Array; // var -> eq

  // Alternating path search markers
  /** Visited flags for equations during DFS augmenting path search (colored by equation subset). */
  visitedEq: ChunkedUint8Array;
  /** Visited flags for variables during DFS augmenting path search (colored by variable subset). */
  visitedVar: ChunkedUint8Array;

  // Differentiation tracking
  /** Tracks how many times each equation has been differentiated during Pantelides reduction. */
  eqDiffLevel: ChunkedInt32Array;
  /** Tracks the maximum differentiation order of each variable. */
  varDiffLevel: ChunkedInt32Array;
  /** Maps each variable to its immediate derivative variable ID (-1 if none). */
  varDerivativeOf: ChunkedInt32Array;

  // Mattsson-Söderlind dummy derivatives
  /** Variable IDs selected as algebraic dummy derivatives to eliminate overdetermination. */
  dummyDerivatives: ChunkedInt32Array;

  /** Total number of Pantelides differentiation rounds executed. */
  diffRounds: u32;
  /** Computed structural index of the DAE system (1 for standard index-1 systems, >1 for higher-index). */
  structuralIndex: u32;

  /**
   * Initializes the Pantelides engine and allocates unmanaged CSR, matching, and differentiation arrays.
   */
  init(dae: DaeBuilder, blt: BltEngine | null = null): void {
    this.dae = dae;
    if (blt != null) {
      this.blt = blt;
    } else {
      let bltPtr = atomicChunkAlloc(offsetof<BltEngine>());
      this.blt = changetype<BltEngine>(bltPtr);
      this.blt.init(dae);
    }

    this.eqDepPtrs = createChunkedInt32Array(1024);
    this.eqDepVars = createChunkedInt32Array(4096);
    this.matchEqToVar = createChunkedInt32Array(1024);
    this.matchVarToEq = createChunkedInt32Array(1024);
    this.visitedEq = createChunkedUint8Array(1024);
    this.visitedVar = createChunkedUint8Array(1024);
    this.eqDiffLevel = createChunkedInt32Array(1024);
    this.varDiffLevel = createChunkedInt32Array(1024);
    this.varDerivativeOf = createChunkedInt32Array(1024);
    this.dummyDerivatives = createChunkedInt32Array(256);
    this.diffRounds = 0;
    this.structuralIndex = 1;
  }

  /**
   * Phase 1: Build the CSR equation-to-variable dependency graph.
   * Identifies highest-order derivative unknowns for state variables
   * and order-0 unknowns for algebraic variables.
   * Excludes parameters and constants.
   */
  @inline
  buildDependencies(): void {
    let eqCount = this.dae.eqCount;
    let varCount = this.dae.varCount;

    this.eqDepPtrs.clear();
    this.eqDepVars.clear();

    for (let i: u32 = 0; i <= eqCount; i++) {
      this.eqDepPtrs.push(0);
    }

    // Track maximum derivative order of each variable across all equations.
    // Variables flagged as state variables start at order 1; algebraic variables start at 0.
    let maxVarOrder = createChunkedInt32Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) {
      let flags = this.dae.getVarData().get(i * VAR_STRIDE + VAR_FLAGS);
      maxVarOrder.push((flags & (FLAG_VAR_STATE | FLAG_VAR_STATE_DER)) != 0 ? 1 : 0);
    }

    let exprStack = createChunkedInt32Array(256);
    for (let i: u32 = 0; i < eqCount; i++) {
      let offset = i * EQ_STRIDE;
      if (this.dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;
      let lhsId = this.dae.getEqData().get(offset + EQ_LHS) as u32;
      let rhsId = this.dae.getEqData().get(offset + EQ_RHS) as u32;
      exprStack.clear();
      if (lhsId != 0xffffffff) exprStack.push(lhsId as i32);
      if (rhsId != 0xffffffff) exprStack.push(rhsId as i32);

      while (exprStack.length > 0) {
        let exprId = exprStack.pop() as u32;
        if (exprId == 0xffffffff || exprId >= this.dae.exprCount) continue;
        let exprOffset = exprId * EXPR_STRIDE;
        let kind = this.dae.getExprData().get(exprOffset + EXPR_KIND);
        if (kind == ExprKind.Der) {
          let depth: i32 = 1;
          let curr = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          while (curr != 0xffffffff && curr < this.dae.exprCount) {
            let cOff = curr * EXPR_STRIDE;
            let cKind = this.dae.getExprData().get(cOff + EXPR_KIND);
            if (cKind == ExprKind.Der) {
              depth++;
              curr = this.dae.getExprData().get(cOff + EXPR_DATA1) as u32;
            } else if (cKind == ExprKind.Name) {
              let rawId = this.dae.getExprData().get(cOff + EXPR_DATA1) as u32;
              let resolvedId = rawId < varCount ? (rawId as i32) : this.dae.lookupVariableByName(rawId);
              if (resolvedId >= 0 && (resolvedId as u32) < varCount) {
                let vId = resolvedId as u32;
                if (depth > maxVarOrder.get(vId)) {
                  maxVarOrder.set(vId, depth);
                }
                this.dae.setVarFlag(vId, FLAG_VAR_STATE);
                while (this.varDerivativeOf.length <= vId) this.varDerivativeOf.push(-1);
                if (this.varDerivativeOf.get(vId) == -1) {
                  this.varDerivativeOf.set(vId, vId as i32);
                }
              }
              break;
            } else {
              exprStack.push(curr as i32);
              break;
            }
          }
        } else if (kind == ExprKind.Binary || kind == ExprKind.Range) {
          let data1 = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (kind == ExprKind.Range && data1 != 0xffffffff) exprStack.push(data1 as i32);
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        } else if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (left != 0xffffffff) exprStack.push(left as i32);
        } else if (kind == ExprKind.Pre) {
          let data1 = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (data1 != 0xffffffff && data1 < this.dae.exprCount) exprStack.push(data1 as i32);
          if (left != 0xffffffff && left < this.dae.exprCount) exprStack.push(left as i32);
        } else if (kind == ExprKind.IfElse) {
          let cond = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (cond != 0xffffffff) exprStack.push(cond as i32);
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        } else if (kind == ExprKind.Subscript || kind == ExprKind.Call || kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
          if (kind == ExprKind.Subscript) {
            let baseExpr = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
            if (baseExpr != 0xffffffff) exprStack.push(baseExpr as i32);
          }
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let rightVal = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          let data1Val = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let count: u32 =
            kind == ExprKind.Call || kind == ExprKind.Subscript
              ? rightVal
              : rightVal > 0 && rightVal != 0xffffffff
                ? rightVal
                : data1Val;
          if (count > 0 && count != 0xffffffff && left != 0xffffffff) {
            exprStack.push(left as i32);
            for (let a: u32 = 1; a < count; a++) {
              let slotIdx = exprId + a;
              if (slotIdx < this.dae.exprCount) {
                let slotOffset = slotIdx * EXPR_STRIDE;
                let slotKind = this.dae.getExprData().get(slotOffset + EXPR_KIND);
                let argExpr = slotKind == ExprKind.Tuple
                  ? (this.dae.getExprData().get(slotOffset + EXPR_LEFT) as u32)
                  : left + a;
                if (argExpr != 0xffffffff) exprStack.push(argExpr as i32);
              }
            }
          }
        }
      }
    }

    let seenVars = createChunkedUint8Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) seenVars.push(0);

    for (let i: u32 = 0; i < eqCount; i++) {
      this.eqDepPtrs.set(i, this.eqDepVars.length as i32);

      let offset = i * EQ_STRIDE;
      if (this.dae.getEqData().get(offset + EQ_KIND) != EqKind.Simple) continue;

      let lhsId = this.dae.getEqData().get(offset + EQ_LHS) as u32;
      let rhsId = this.dae.getEqData().get(offset + EQ_RHS) as u32;

      exprStack.clear();
      if (lhsId != 0xffffffff) exprStack.push(lhsId as i32);
      if (rhsId != 0xffffffff) exprStack.push(rhsId as i32);

      while (exprStack.length > 0) {
        let exprId = exprStack.pop() as u32;
        if (exprId == 0xffffffff || exprId >= this.dae.exprCount) continue;

        let exprOffset = exprId * EXPR_STRIDE;
        let kind = this.dae.getExprData().get(exprOffset + EXPR_KIND);

        if (kind == ExprKind.Der) {
          let depth: i32 = 1;
          let curr = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          while (curr != 0xffffffff && curr < this.dae.exprCount) {
            let cOff = curr * EXPR_STRIDE;
            let cKind = this.dae.getExprData().get(cOff + EXPR_KIND);
            if (cKind == ExprKind.Der) {
              depth++;
              curr = this.dae.getExprData().get(cOff + EXPR_DATA1) as u32;
            } else if (cKind == ExprKind.Name) {
              let rawId = this.dae.getExprData().get(cOff + EXPR_DATA1) as u32;
              let resolvedId = rawId < varCount ? (rawId as i32) : this.dae.lookupVariableByName(rawId);
              if (resolvedId >= 0 && (resolvedId as u32) < varCount) {
                let varId = resolvedId as u32;
                if (depth == maxVarOrder.get(varId) && seenVars.get(varId) == 0) {
                  seenVars.set(varId, 1);
                  this.eqDepVars.push(varId as i32);
                }
              }
              break;
            } else {
              exprStack.push(curr as i32);
              break;
            }
          }
        } else if (kind == ExprKind.Name) {
          let rawId: u32 = u32(this.dae.getExprData().get(exprOffset + EXPR_DATA1));
          let resolvedId = rawId < varCount ? (rawId as i32) : this.dae.lookupVariableByName(rawId);
          if (resolvedId >= 0 && (resolvedId as u32) < varCount) {
            let varId = resolvedId as u32;
            let variability = this.dae.getVarData().get(varId * VAR_STRIDE + VAR_VARIABILITY);
            if (variability != Variability.Parameter && variability != Variability.Constant) {
              if (maxVarOrder.get(varId) == 0) {
                if (seenVars.get(varId) == 0) {
                  seenVars.set(varId, 1);
                  this.eqDepVars.push(varId as i32);
                }
              }
            }
          }
        } else if (kind == ExprKind.Binary || kind == ExprKind.Range) {
          let data1 = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (kind == ExprKind.Range && data1 != 0xffffffff) exprStack.push(data1 as i32);
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        } else if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (left != 0xffffffff) exprStack.push(left as i32);
        } else if (kind == ExprKind.Pre) {
          let data1 = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          if (data1 != 0xffffffff && data1 < this.dae.exprCount) exprStack.push(data1 as i32);
          if (left != 0xffffffff && left < this.dae.exprCount) exprStack.push(left as i32);
        } else if (kind == ExprKind.IfElse) {
          let cond = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let right = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          if (cond != 0xffffffff) exprStack.push(cond as i32);
          if (left != 0xffffffff) exprStack.push(left as i32);
          if (right != 0xffffffff) exprStack.push(right as i32);
        } else if (kind == ExprKind.Subscript || kind == ExprKind.Call || kind == ExprKind.ArrayCtor || kind == ExprKind.Tuple) {
          if (kind == ExprKind.Subscript) {
            let baseExpr = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
            if (baseExpr != 0xffffffff) exprStack.push(baseExpr as i32);
          }
          let left = this.dae.getExprData().get(exprOffset + EXPR_LEFT) as u32;
          let rightVal = this.dae.getExprData().get(exprOffset + EXPR_RIGHT) as u32;
          let data1Val = this.dae.getExprData().get(exprOffset + EXPR_DATA1) as u32;
          let count: u32 =
            kind == ExprKind.Call || kind == ExprKind.Subscript
              ? rightVal
              : rightVal > 0 && rightVal != 0xffffffff
                ? rightVal
                : data1Val;
          if (count > 0 && count != 0xffffffff && left != 0xffffffff) {
            exprStack.push(left as i32);
            for (let a: u32 = 1; a < count; a++) {
              let slotIdx = exprId + a;
              if (slotIdx < this.dae.exprCount) {
                let slotOffset = slotIdx * EXPR_STRIDE;
                let slotKind = this.dae.getExprData().get(slotOffset + EXPR_KIND);
                let argExpr = slotKind == ExprKind.Tuple
                  ? (this.dae.getExprData().get(slotOffset + EXPR_LEFT) as u32)
                  : left + a;
                if (argExpr != 0xffffffff) exprStack.push(argExpr as i32);
              }
            }
          }
        }
      }

      let startVars = this.eqDepPtrs.get(i) as u32;
      let endVars = this.eqDepVars.length;
      for (let j: u32 = startVars; j < endVars; j++) {
        let v = this.eqDepVars.get(j) as u32;
        if (v < varCount) seenVars.set(v, 0);
      }
    }

    this.eqDepPtrs.set(eqCount, this.eqDepVars.length as i32);
  }

  /**
   * Performs an augmenting path search from equation `eqIdx`.
   */
  private augment(eqIdx: u32): boolean {
    if (this.visitedEq.get(eqIdx) == 1) return false;
    this.visitedEq.set(eqIdx, 1);

    let start = this.eqDepPtrs.get(eqIdx) as u32;
    let end = this.eqDepPtrs.get(eqIdx + 1) as u32;

    for (let i: u32 = start; i < end; i++) {
      let varIdx = this.eqDepVars.get(i) as u32;
      if (this.visitedVar.get(varIdx) == 0) {
        this.visitedVar.set(varIdx, 1);
        let prevEq = this.matchVarToEq.get(varIdx);

        if (prevEq == -1 || this.augment(prevEq as u32)) {
          this.matchVarToEq.set(varIdx, eqIdx as i32);
          this.matchEqToVar.set(eqIdx, varIdx as i32);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Applies Pantelides structural index reduction.
   * Differentiates minimally singular equation subsets until full bipartite matching is achieved.
   * Returns the count of newly synthesized constraint equations.
   */
  @inline
  reduceIndex(stateVars: ChunkedInt32Array | null = null): u32 {
    if (stateVars == null) {
      stateVars = createChunkedInt32Array(0);
    }
    let initialEqCount = this.dae.eqCount;
    let initialVarCount = this.dae.varCount;
    if (initialEqCount == 0 || initialVarCount == 0) {
      this.structuralIndex = 1;
      return 0;
    }

    this.eqDiffLevel.clear();
    for (let i: u32 = 0; i < initialEqCount; i++) this.eqDiffLevel.push(0);

    this.varDiffLevel.clear();
    this.varDerivativeOf.clear();
    for (let i: u32 = 0; i < initialVarCount; i++) {
      this.varDiffLevel.push(0);
      let flags = this.dae.getVarData().get(i * VAR_STRIDE + VAR_FLAGS);
      this.varDerivativeOf.push((flags & (FLAG_VAR_STATE | FLAG_VAR_STATE_DER)) != 0 ? (i as i32) : -1);
    }

    let activeEqs = createChunkedInt32Array(initialEqCount);
    for (let i: u32 = 0; i < initialEqCount; i++) {
      activeEqs.push(i as i32);
    }

    this.dummyDerivatives.clear();
    this.diffRounds = 0;
    let generatedEquations: u32 = 0;
    const maxRounds: u32 = 50;

    while (this.diffRounds < maxRounds) {
      let currentEqCount = this.dae.eqCount;
      let currentVarCount = this.dae.varCount;

      this.buildDependencies();

      while (this.matchVarToEq.length < currentVarCount) this.matchVarToEq.push(-1);
      while (this.matchEqToVar.length < currentEqCount) this.matchEqToVar.push(-1);
      while (this.visitedVar.length < currentVarCount) this.visitedVar.push(0);
      while (this.visitedEq.length < currentEqCount) this.visitedEq.push(0);

      for (let i: u32 = 0; i < currentVarCount; i++) this.matchVarToEq.set(i, -1);
      for (let i: u32 = 0; i < currentEqCount; i++) this.matchEqToVar.set(i, -1);

      let allMatched = true;
      let unmatchedActive = createChunkedInt32Array(64);

      for (let a: u32 = 0; a < initialEqCount; a++) {
        let eqIdx = activeEqs.get(a) as u32;
        for (let v: u32 = 0; v < currentVarCount; v++) this.visitedVar.set(v, 0);
        for (let e: u32 = 0; e < currentEqCount; e++) this.visitedEq.set(e, 0);

        if (!this.augment(eqIdx)) {
          allMatched = false;
          unmatchedActive.push(a as i32);
        }
      }

      if (allMatched || unmatchedActive.length == 0) {
        break;
      }

      this.diffRounds++;

      // Collect all equations in the alternating search tree for unmatched active equations
      for (let v: u32 = 0; v < currentVarCount; v++) this.visitedVar.set(v, 0);
      for (let e: u32 = 0; e < currentEqCount; e++) this.visitedEq.set(e, 0);

      let queue = createChunkedInt32Array(64);
      for (let u: u32 = 0; u < unmatchedActive.length; u++) {
        let a = unmatchedActive.get(u) as u32;
        let eqIdx = activeEqs.get(a) as u32;
        this.visitedEq.set(eqIdx, 1);
        queue.push(eqIdx as i32);
      }

      let qHead: u32 = 0;
      while (qHead < queue.length) {
        let eqIdx = queue.get(qHead++) as u32;
        let start = this.eqDepPtrs.get(eqIdx) as u32;
        let end = this.eqDepPtrs.get(eqIdx + 1) as u32;

        for (let i: u32 = start; i < end; i++) {
          let varIdx = this.eqDepVars.get(i) as u32;
          if (this.visitedVar.get(varIdx) == 0) {
            this.visitedVar.set(varIdx, 1);
            let matchedEq = this.matchVarToEq.get(varIdx);
            if (matchedEq != -1 && (matchedEq as u32) < currentEqCount) {
              if (this.visitedEq.get(matchedEq as u32) == 0) {
                this.visitedEq.set(matchedEq as u32, 1);
                queue.push(matchedEq);
              }
            }
          }
        }
      }

      // Differentiate the visited active equations
      for (let a: u32 = 0; a < initialEqCount; a++) {
        let eqIdx = activeEqs.get(a) as u32;
        if (this.visitedEq.get(eqIdx) == 1) {
          let offset = eqIdx * EQ_STRIDE;
          let lhsId = this.dae.getEqData().get(offset + EQ_LHS) as u32;
          let rhsId = this.dae.getEqData().get(offset + EQ_RHS) as u32;

          // Mark the source constraint equation as a high-index constraint equation
          let srcAux = this.dae.getEqData().get(offset + EQ_AUX);
          this.dae.getEqData().set(offset + EQ_AUX, srcAux | FLAG_HIGH_INDEX_EQ | FLAG_EQ_INITIAL);

          let dLhs = differentiateExpr(lhsId, this.dae, stateVars);
          let dRhs = differentiateExpr(rhsId, this.dae, stateVars);

          let simLhs = simplifyAst(dLhs, this.dae);
          let simRhs = simplifyAst(dRhs, this.dae);

          let newEqIdx = this.dae.addEquation(EqKind.Simple, simLhs, simRhs, FLAG_HIGH_INDEX_EQ);
          let currLevel = eqIdx < this.eqDiffLevel.length ? this.eqDiffLevel.get(eqIdx) : 0;
          this.eqDiffLevel.push(currLevel + 1);

          let start = this.eqDepPtrs.get(eqIdx) as u32;
          let end = this.eqDepPtrs.get(eqIdx + 1) as u32;
          for (let j: u32 = start; j < end; j++) {
            let vIdx = this.eqDepVars.get(j) as u32;
            while (this.varDiffLevel.length <= vIdx) this.varDiffLevel.push(0);
            let vLevel = this.varDiffLevel.get(vIdx);
            if (currLevel + 1 > vLevel) {
              this.varDiffLevel.set(vIdx, currLevel + 1);
            }
          }

          activeEqs.set(a, newEqIdx as i32);
          generatedEquations++;
        }
      }
    }

    this.structuralIndex = this.diffRounds + 1;

    // Phase 4: Mattsson-Söderlind Dummy Derivative Selection
    this.selectDummyDerivatives();

    return generatedEquations;
  }

  /**
   * Selects dummy derivatives according to the Mattsson-Söderlind algorithm.
   * For each differentiated constraint equation (eqDiffLevel > 0), selects the highest-priority
   * candidate state variable (preferring non-fixed states with higher differentiation order),
   * marks the equation with FLAG_HIGH_INDEX_EQ, and demotes the selected variable (and any
   * remaining unmatched state variables) to dummy derivatives.
   */
  @inline
  selectDummyDerivatives(): void {
    if (this.diffRounds == 0) return;
    let varCount = this.dae.varCount;
    let eqCount = this.dae.eqCount;
    let chosenMask = createChunkedUint8Array(varCount);
    for (let i: u32 = 0; i < varCount; i++) chosenMask.push(0);

    // 1. For each differentiated constraint equation, pick the best candidate state variable
    for (let eqIdx: u32 = 0; eqIdx < eqCount; eqIdx++) {
      let level = eqIdx < this.eqDiffLevel.length ? this.eqDiffLevel.get(eqIdx) : 0;
      if (level <= 0) continue;

      let eqOff = eqIdx * EQ_STRIDE;
      let curAux = this.dae.getEqData().get(eqOff + EQ_AUX);
      this.dae.getEqData().set(eqOff + EQ_AUX, curAux | FLAG_HIGH_INDEX_EQ);

      let matchedVar = eqIdx < this.matchEqToVar.length ? this.matchEqToVar.get(eqIdx) : -1;
      let bestVar: i32 = -1;
      let bestScore: i32 = -0x7fffffff;

      if (eqIdx + 1 < this.eqDepPtrs.length) {
        let start = this.eqDepPtrs.get(eqIdx) as u32;
        let end = this.eqDepPtrs.get(eqIdx + 1) as u32;
        for (let j: u32 = start; j < end; j++) {
          let v = this.eqDepVars.get(j) as u32;
          if (v >= varCount || chosenMask.get(v) != 0) continue;
          let parent = v < this.varDerivativeOf.length ? this.varDerivativeOf.get(v) : -1;
          if (parent == -1 || (parent as u32) >= varCount) continue;
          let vFlags = this.dae.getVarData().get(v * VAR_STRIDE + VAR_FLAGS);
          let parentFlags = this.dae.getVarData().get((parent as u32) * VAR_STRIDE + VAR_FLAGS);
          let parentIsState = (parentFlags & (FLAG_VAR_STATE | FLAG_VAR_STATE_DER)) != 0 || parent == (v as i32);
          if (!parentIsState) continue;

          // Score: prefer matched variable, non-fixed initial state, and higher diff level
          let score: i32 = 0;
          if ((v as i32) == matchedVar) score += 100;
          if ((vFlags & FLAG_VAR_FIXED) == 0) score += 20;
          if (v < this.varDiffLevel.length) score += this.varDiffLevel.get(v) * 10;
          score += v as i32; // deterministic tie-break preferring later state variables

          if (score > bestScore) {
            bestScore = score;
            bestVar = v as i32;
          }
        }
      }

      if (bestVar == -1 && matchedVar >= 0 && (matchedVar as u32) < varCount && chosenMask.get(matchedVar as u32) == 0) {
        bestVar = matchedVar;
      }

      if (bestVar >= 0 && (bestVar as u32) < varCount) {
        let bv = bestVar as u32;
        chosenMask.set(bv, 1);
        this.dummyDerivatives.push(bestVar);
        this.dae.setVarFlag(bv, FLAG_TEARING_VAR | FLAG_VAR_STATE_DER);
      }
    }

    // 2. Also demote any remaining state variables left unmatched or matched to high-index equations
    for (let v: u32 = 0; v < varCount; v++) {
      if (chosenMask.get(v) != 0) continue;
      let parent = v < this.varDerivativeOf.length ? this.varDerivativeOf.get(v) : -1;

      if (parent != -1 && (parent as u32) < varCount) {
        let parentFlags = this.dae.getVarData().get((parent as u32) * VAR_STRIDE + VAR_FLAGS);
        let parentIsState = (parentFlags & (FLAG_VAR_STATE | FLAG_VAR_STATE_DER)) != 0 || parent == (v as i32);
        if (parentIsState) {
          let matchedEq = v < this.matchVarToEq.length ? this.matchVarToEq.get(v) : -1;
          let isDummy = false;
          if (matchedEq == -1) {
            isDummy = true;
          } else if ((matchedEq as u32) < this.eqDiffLevel.length && this.eqDiffLevel.get(matchedEq as u32) > 0) {
            isDummy = true;
          }
          if (isDummy) {
            chosenMask.set(v, 1);
            this.dummyDerivatives.push(v as i32);
            this.dae.setVarFlag(v, FLAG_TEARING_VAR | FLAG_VAR_STATE_DER);
          }
        }
      }
    }
  }

  /**
   * Dynamically swaps dynamic state variables when approaching kinematic singularities.
   */
  swapDynamicState(oldVar: u32, newVar: u32): boolean {
    if (oldVar >= this.dae.varCount || newVar >= this.dae.varCount) return false;

    let eq = this.matchVarToEq.get(oldVar);
    if (eq >= 0) {
      this.matchVarToEq.set(oldVar, -1);
      this.matchVarToEq.set(newVar, eq);
      this.matchEqToVar.set(eq, newVar as i32);
    }

    this.dae.setVarFlag(oldVar, FLAG_TEARING_VAR);
    let currFlags = this.dae.getVarData().get(newVar * VAR_STRIDE + VAR_FLAGS);
    this.dae.getVarData().set(newVar * VAR_STRIDE + VAR_FLAGS, currFlags & ~FLAG_TEARING_VAR);
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Allocates and initializes a new `PantelidesEngine` in WebAssembly linear memory.
 */
export function dae_createPantelides(daePtr: u32, bltPtr: u32): u32 {
  let pantPtr = atomicChunkAlloc(offsetof<PantelidesEngine>());
  let pant = changetype<PantelidesEngine>(pantPtr);
  let dae = changetype<DaeBuilder>(daePtr);
  let blt: BltEngine | null = null;
  if (bltPtr != 0) {
    blt = changetype<BltEngine>(bltPtr);
  }
  pant.init(dae, blt);
  return pantPtr as u32;
}

/**
 * Executes Pantelides index reduction and Mattsson-Söderlind dummy derivative selection on the engine.
 */
export function dae_runPantelides(pantPtr: u32, stateVarsPtr: u32): u32 {
  if (pantPtr == 0) return 0;
  let stateVars = stateVarsPtr != 0 ? changetype<ChunkedInt32Array>(stateVarsPtr) : changetype<PantelidesEngine>(pantPtr).dummyDerivatives;
  return changetype<PantelidesEngine>(pantPtr).reduceIndex(stateVars);
}

/**
 * Returns the computed structural DAE index after running Pantelides analysis.
 */
export function dae_getPantelidesIndex(pantPtr: u32): u32 {
  if (pantPtr == 0) return 1;
  return changetype<PantelidesEngine>(pantPtr).structuralIndex;
}

/**
 * Returns the number of variables selected as Mattsson-Söderlind dummy derivatives.
 */
export function dae_getDummyDerivativeCount(pantPtr: u32): u32 {
  if (pantPtr == 0) return 0;
  return changetype<PantelidesEngine>(pantPtr).dummyDerivatives.length;
}

/**
 * Returns the variable ID of the `idx`-th selected dummy derivative, or -1 if out of bounds.
 */
export function dae_getDummyDerivativeVar(pantPtr: u32, idx: u32): i32 {
  if (pantPtr == 0) return -1;
  let pant = changetype<PantelidesEngine>(pantPtr);
  if (idx >= pant.dummyDerivatives.length) return -1;
  return pant.dummyDerivatives.get(idx);
}

/**
 * Returns the number of times equation `eqIdx` was differentiated during index reduction.
 */
export function dae_getEqDiffLevel(pantPtr: u32, eqIdx: u32): i32 {
  if (pantPtr == 0) return 0;
  let pant = changetype<PantelidesEngine>(pantPtr);
  if (eqIdx >= pant.eqDiffLevel.length) return 0;
  return pant.eqDiffLevel.get(eqIdx);
}

/**
 * Returns the maximum differentiation order recorded for variable `varIdx`.
 */
export function dae_getVarDiffLevel(pantPtr: u32, varIdx: u32): i32 {
  if (pantPtr == 0) return 0;
  let pant = changetype<PantelidesEngine>(pantPtr);
  if (varIdx >= pant.varDiffLevel.length) return 0;
  return pant.varDiffLevel.get(varIdx);
}

/**
 * Dynamically swaps an active continuous state variable with a dummy derivative candidate at runtime.
 */
export function dae_swapDynamicState(pantPtr: u32, oldVar: u32, newVar: u32): boolean {
  if (pantPtr == 0) return false;
  return changetype<PantelidesEngine>(pantPtr).swapDynamicState(oldVar, newVar);
}


