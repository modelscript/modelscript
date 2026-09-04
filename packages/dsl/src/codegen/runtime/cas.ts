/* eslint-disable */
// @ts-nocheck
import { DaeBuilder, ExprKind, BinOp, UnaryOp, EXPR_STRIDE, EXPR_KIND, EXPR_DATA1, EXPR_LEFT, EXPR_RIGHT } from "./dae";

/**
 * Computer Algebra System (CAS) & Symbolic Simplification Engine in WASM.
 * Implements algebraic rewrite rules, constant folding, and symbolic differentiation over DaeBuilder arena expressions.
 */

export function cas_getRealValue(dae: DaeBuilder, exprId: u32): f64 {
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let lo = (exprData.get(offset + EXPR_DATA1) as u64) & 0xffffffff;
  let hi = (exprData.get(offset + EXPR_LEFT) as u64) & 0xffffffff;
  let bits = (hi << 32) | lo;
  return f64.reinterpret_i64(bits as i64);
}

export function cas_isZero(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (exprData.get(offset + EXPR_DATA1) as i32) == 0;
  }
  if (kind == ExprKind.RealLiteral) {
    return cas_getRealValue(dae, exprId) == 0.0;
  }
  return false;
}

export function cas_isOne(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);
  if (kind == ExprKind.IntLiteral) {
    return (exprData.get(offset + EXPR_DATA1) as i32) == 1;
  }
  if (kind == ExprKind.RealLiteral) {
    return cas_getRealValue(dae, exprId) == 1.0;
  }
  return false;
}

export function cas_isConstant(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);
  return kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral;
}

/**
 * Recursively simplifies an algebraic expression using rewrite rules.
 */
export function cas_simplify(dae: DaeBuilder, exprId: u32): u32 {
  if (exprId >= dae.exprCount) return exprId;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let left = cas_simplify(dae, exprData.get(offset + EXPR_LEFT));
    let right = cas_simplify(dae, exprData.get(offset + EXPR_RIGHT));

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
    let sub = cas_simplify(dae, exprData.get(offset + EXPR_LEFT));
    if (cas_isConstant(dae, sub)) {
      let val = cas_getRealValue(dae, sub);
      return dae.addRealLiteral(-val);
    }
    // -(-x) -> x
    let subOffset = sub * EXPR_STRIDE;
    let subKind = exprData.get(subOffset + EXPR_KIND);
    if (subKind == ExprKind.Negate || subKind == ExprKind.Unary) {
      return exprData.get(subOffset + EXPR_LEFT);
    }
    return dae.addExpression(ExprKind.Negate, 0, sub, 0xffffffff);
  }

  return exprId;
}

export enum BuiltinMathFunc {
  Sin = 0,
  Cos = 1,
  Tan = 2,
  Asin = 3,
  Acos = 4,
  Atan = 5,
  Atan2 = 6,
  Sinh = 7,
  Cosh = 8,
  Tanh = 9,
  Exp = 10,
  Log = 11,
  Log10 = 12,
  Sqrt = 13,
  Abs = 14,
  Sign = 15,
  Min = 16,
  Max = 17,
  Floor = 18,
  Ceil = 19,
  Fmod = 20,
  Pow = 21,
}

/**
 * Computes exact symbolic derivative of an expression with respect to a variable ID: d(expr) / d(varId).
 */
export function cas_differentiate(dae: DaeBuilder, exprId: u32, targetVarId: u32): u32 {
  if (exprId >= dae.exprCount) return dae.addRealLiteral(0.0);
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1);
    // d(x) / dx = 1, d(y) / dx = 0
    return varId == targetVarId ? dae.addRealLiteral(1.0) : dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.IntLiteral || kind == ExprKind.RealLiteral || kind == ExprKind.BoolLiteral || kind == ExprKind.StringLiteral || kind == ExprKind.EnumLiteral) {
    // d(const) / dx = 0
    return dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let u = exprData.get(offset + EXPR_LEFT);
    let v = exprData.get(offset + EXPR_RIGHT);
    let du = cas_differentiate(dae, u, targetVarId);
    let dv = cas_differentiate(dae, v, targetVarId);

    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      // d(u + v) = du + dv
      let add = dae.addExpression(ExprKind.Binary, BinOp.Add, du, dv);
      return cas_simplify(dae, add);
    }
    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      // d(u - v) = du - dv
      let sub = dae.addExpression(ExprKind.Binary, BinOp.Sub, du, dv);
      return cas_simplify(dae, sub);
    }
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      // Product rule: d(u * v) = du * v + u * dv
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, du, v);
      let t2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
      let add = dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2);
      return cas_simplify(dae, add);
    }
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      // Quotient rule: d(u / v) = (du * v - u * dv) / (v ^ 2)
      let num1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, du, v);
      let num2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
      let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, num1, num2);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, v);
      let div = dae.addExpression(ExprKind.Binary, BinOp.Div, num, den);
      return cas_simplify(dae, div);
    }
    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      if (cas_isZero(dae, dv)) {
        // v is constant: d(u^v) = v * u^(v-1) * du
        let vMinus1 = dae.addExpression(ExprKind.Binary, BinOp.Sub, v, dae.addRealLiteral(1.0));
        let uPow = dae.addExpression(ExprKind.Binary, BinOp.Pow, u, cas_simplify(dae, vMinus1));
        let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, uPow);
        let res = dae.addExpression(ExprKind.Binary, BinOp.Mul, t1, du);
        return cas_simplify(dae, res);
      }
      if (cas_isZero(dae, du)) {
        // u is constant: d(u^v) = u^v * ln(u) * dv
        let logU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, u, 1);
        let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, logU);
        let res = dae.addExpression(ExprKind.Binary, BinOp.Mul, t1, dv);
        return cas_simplify(dae, res);
      }
      // General: u^v * (dv * ln(u) + v * du / u)
      let logU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, u, 1);
      let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, dv, logU);
      let vDu = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, du);
      let vDuOverU = dae.addExpression(ExprKind.Binary, BinOp.Div, vDu, u);
      let sum = dae.addExpression(ExprKind.Binary, BinOp.Add, t1, vDuOverU);
      let res = dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, sum);
      return cas_simplify(dae, res);
    }
  }

  if (kind == ExprKind.Call) {
    let funcId = exprData.get(offset + EXPR_DATA1);
    let u = exprData.get(offset + EXPR_LEFT);
    let du = cas_differentiate(dae, u, targetVarId);
    if (cas_isZero(dae, du)) return dae.addRealLiteral(0.0);

    let dOuter: u32 = 0xffffffff;
    if (funcId == BuiltinMathFunc.Sin) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cos, u, 1);
    } else if (funcId == BuiltinMathFunc.Cos) {
      let sinU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sin, u, 1);
      dOuter = dae.addExpression(ExprKind.Negate, 0, sinU, 0xffffffff);
    } else if (funcId == BuiltinMathFunc.Tan) {
      // 1 + tan^2(u)
      let tanU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Tan, u, 1);
      let tanSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, tanU, tanU);
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Add, dae.addRealLiteral(1.0), tanSq);
    } else if (funcId == BuiltinMathFunc.Exp) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Exp, u, 1);
    } else if (funcId == BuiltinMathFunc.Log) {
      // 1 / u
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), u);
    } else if (funcId == BuiltinMathFunc.Log10) {
      // 1 / (u * ln(10))
      let ln10 = dae.addRealLiteral(2.302585092994046);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, ln10);
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Sqrt) {
      // 1 / (2 * sqrt(u))
      let sqrtU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, u, 1);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Mul, dae.addRealLiteral(2.0), sqrtU);
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Sinh) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cosh, u, 1);
    } else if (funcId == BuiltinMathFunc.Cosh) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sinh, u, 1);
    } else if (funcId == BuiltinMathFunc.Tanh) {
      // 1 - tanh^2(u)
      let tanhU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Tanh, u, 1);
      let tanhSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, tanhU, tanhU);
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Sub, dae.addRealLiteral(1.0), tanhSq);
    } else if (funcId == BuiltinMathFunc.Asin) {
      // 1 / sqrt(1 - u^2)
      let uSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
      let oneMinusUSq = dae.addExpression(ExprKind.Binary, BinOp.Sub, dae.addRealLiteral(1.0), uSq);
      let den = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, oneMinusUSq, 1);
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Acos) {
      // -1 / sqrt(1 - u^2)
      let uSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
      let oneMinusUSq = dae.addExpression(ExprKind.Binary, BinOp.Sub, dae.addRealLiteral(1.0), uSq);
      let den = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, oneMinusUSq, 1);
      let pos = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
      dOuter = dae.addExpression(ExprKind.Negate, 0, pos, 0xffffffff);
    } else if (funcId == BuiltinMathFunc.Atan) {
      // 1 / (1 + u^2)
      let uSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Add, dae.addRealLiteral(1.0), uSq);
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Abs) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sign, u, 1);
    } else if (funcId == BuiltinMathFunc.Sign) {
      return dae.addRealLiteral(0.0);
    }

    if (dOuter != 0xffffffff) {
      let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, dOuter, du);
      return cas_simplify(dae, mul);
    }
  }

  if (kind == ExprKind.IfElse) {
    let cond = exprData.get(offset + EXPR_DATA1);
    let thenExpr = exprData.get(offset + EXPR_LEFT);
    let elseExpr = exprData.get(offset + EXPR_RIGHT);
    let dThen = cas_differentiate(dae, thenExpr, targetVarId);
    let dElse = cas_differentiate(dae, elseExpr, targetVarId);
    let ife = dae.addExpression(ExprKind.IfElse, cond, dThen, dElse);
    return cas_simplify(dae, ife);
  }

  if (kind == ExprKind.Negate || kind == ExprKind.Unary) {
    let u = exprData.get(offset + EXPR_LEFT);
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

