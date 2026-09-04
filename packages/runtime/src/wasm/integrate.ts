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
} from "./dae";
import {
  cas_simplify,
  cas_differentiate,
  cas_isZero,
  cas_isOne,
  cas_isConstant,
  cas_getRealValue,
  BuiltinMathFunc,
} from "./cas";
import { symbolicContainsVar } from "./linalg";

/**
 * Substitutes a real scalar value for a variable ID in an expression.
 */
export function symbolicSubstituteVal(dae: DaeBuilder, exprId: u32, targetVar: u32, val: f64): u32 {
  if (exprId >= dae.exprCount) return exprId;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1);
    if (varId == targetVar) {
      return dae.addRealLiteral(val);
    }
    return exprId;
  }

  if (
    kind == ExprKind.IntLiteral ||
    kind == ExprKind.RealLiteral ||
    kind == ExprKind.BoolLiteral ||
    kind == ExprKind.StringLiteral ||
    kind == ExprKind.EnumLiteral
  ) {
    return exprId;
  }

  if (kind == ExprKind.Negate || kind == ExprKind.Unary) {
    let operand = exprData.get(offset + EXPR_LEFT);
    let subOp = symbolicSubstituteVal(dae, operand, targetVar, val);
    let neg = dae.addExpression(ExprKind.Negate, 0, subOp, 0xffffffff);
    return cas_simplify(dae, neg);
  }

  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let left = exprData.get(offset + EXPR_LEFT);
    let right = exprData.get(offset + EXPR_RIGHT);
    let subLeft = symbolicSubstituteVal(dae, left, targetVar, val);
    let subRight = symbolicSubstituteVal(dae, right, targetVar, val);
    let bin = dae.addExpression(ExprKind.Binary, op, subLeft, subRight);
    return cas_simplify(dae, bin);
  }

  if (kind == ExprKind.Call) {
    let funcId = exprData.get(offset + EXPR_DATA1);
    let u = exprData.get(offset + EXPR_LEFT);
    let subU = symbolicSubstituteVal(dae, u, targetVar, val);
    let call = dae.addExpression(ExprKind.Call, funcId, subU, 1);
    return cas_simplify(dae, call);
  }

  if (kind == ExprKind.IfElse) {
    let cond = exprData.get(offset + EXPR_DATA1);
    let thenExpr = exprData.get(offset + EXPR_LEFT);
    let elseExpr = exprData.get(offset + EXPR_RIGHT);
    let subThen = symbolicSubstituteVal(dae, thenExpr, targetVar, val);
    let subElse = symbolicSubstituteVal(dae, elseExpr, targetVar, val);
    let ife = dae.addExpression(ExprKind.IfElse, cond, subThen, subElse);
    return cas_simplify(dae, ife);
  }

  return exprId;
}

/**
 * Indefinite symbolic integration (anti-differentiation) of an expression w.r.t. targetVar.
 * Returns the integrated expression ID or 0xffffffff if no analytical anti-derivative rule matches.
 */
export function symbolicIntegrate(dae: DaeBuilder, exprId: u32, targetVar: u32): u32 {
  if (exprId >= dae.exprCount) return 0xffffffff;
  let exprData = dae.getExprData();
  let offset = exprId * EXPR_STRIDE;
  let kind = exprData.get(offset + EXPR_KIND);

  let varExpr = dae.addName(targetVar);

  // 1. Literals: ∫ c dx = c * x
  if (
    kind == ExprKind.IntLiteral ||
    kind == ExprKind.RealLiteral ||
    kind == ExprKind.BoolLiteral ||
    kind == ExprKind.StringLiteral ||
    kind == ExprKind.EnumLiteral
  ) {
    let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, varExpr);
    return cas_simplify(dae, mul);
  }

  // 2. Variable reference
  if (kind == ExprKind.Name) {
    let varId = exprData.get(offset + EXPR_DATA1);
    if (varId == targetVar) {
      // ∫ x dx = x^2 / 2
      let xSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, varExpr, varExpr);
      let div = dae.addExpression(ExprKind.Binary, BinOp.Div, xSq, dae.addRealLiteral(2.0));
      return cas_simplify(dae, div);
    }
    // ∫ y dx = y * x
    let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, varExpr);
    return cas_simplify(dae, mul);
  }

  // 3. Unary negation: ∫ -f dx = -∫ f dx
  if (kind == ExprKind.Negate || kind == ExprKind.Unary) {
    let operand = exprData.get(offset + EXPR_LEFT);
    let intOp = symbolicIntegrate(dae, operand, targetVar);
    if (intOp == 0xffffffff) return 0xffffffff;
    let neg = dae.addExpression(ExprKind.Negate, 0, intOp, 0xffffffff);
    return cas_simplify(dae, neg);
  }

  // 4. Binary expressions
  if (kind == ExprKind.Binary) {
    let op = exprData.get(offset + EXPR_DATA1);
    let u = exprData.get(offset + EXPR_LEFT);
    let v = exprData.get(offset + EXPR_RIGHT);

    // Linear combinations: ∫ (u ± v) dx = ∫ u dx ± ∫ v dx
    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      let intU = symbolicIntegrate(dae, u, targetVar);
      let intV = symbolicIntegrate(dae, v, targetVar);
      if (intU == 0xffffffff || intV == 0xffffffff) return 0xffffffff;
      let add = dae.addExpression(ExprKind.Binary, BinOp.Add, intU, intV);
      return cas_simplify(dae, add);
    }

    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      let intU = symbolicIntegrate(dae, u, targetVar);
      let intV = symbolicIntegrate(dae, v, targetVar);
      if (intU == 0xffffffff || intV == 0xffffffff) return 0xffffffff;
      let sub = dae.addExpression(ExprKind.Binary, BinOp.Sub, intU, intV);
      return cas_simplify(dae, sub);
    }

    // Multiplication: check for constant factors
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      let uHasX = symbolicContainsVar(dae, u, targetVar);
      let vHasX = symbolicContainsVar(dae, v, targetVar);

      if (!uHasX) {
        // ∫ c * v dx = c * ∫ v dx
        let intV = symbolicIntegrate(dae, v, targetVar);
        if (intV == 0xffffffff) return 0xffffffff;
        let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, intV);
        return cas_simplify(dae, mul);
      }
      if (!vHasX) {
        // ∫ u * c dx = c * ∫ u dx
        let intU = symbolicIntegrate(dae, u, targetVar);
        if (intU == 0xffffffff) return 0xffffffff;
        let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, intU);
        return cas_simplify(dae, mul);
      }
    }

    // Division: check for constant divisor or 1/x
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      let vHasX = symbolicContainsVar(dae, v, targetVar);
      if (!vHasX) {
        // ∫ (u / c) dx = (1/c) * ∫ u dx
        let intU = symbolicIntegrate(dae, u, targetVar);
        if (intU == 0xffffffff) return 0xffffffff;
        let div = dae.addExpression(ExprKind.Binary, BinOp.Div, intU, v);
        return cas_simplify(dae, div);
      }

      // ∫ (c / x) dx = c * ln(x)
      let uHasX = symbolicContainsVar(dae, u, targetVar);
      if (!uHasX) {
        let vOffset = v * EXPR_STRIDE;
        let vKind = exprData.get(vOffset + EXPR_KIND);
        if (vKind == ExprKind.Name && exprData.get(vOffset + EXPR_DATA1) == targetVar) {
          let logX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, varExpr, 1);
          let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, logX);
          return cas_simplify(dae, mul);
        }
      }
    }

    // Power rule: ∫ x^n dx = x^(n+1) / (n+1)
    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      let uOffset = u * EXPR_STRIDE;
      let uKind = exprData.get(uOffset + EXPR_KIND);
      let vHasX = symbolicContainsVar(dae, v, targetVar);

      if (uKind == ExprKind.Name && exprData.get(uOffset + EXPR_DATA1) == targetVar && !vHasX) {
        if (cas_isConstant(dae, v)) {
          let nVal = cas_getRealValue(dae, v);
          if (Math.abs(nVal - (-1.0)) < 1e-12) {
            // ∫ x^(-1) dx = ln(x)
            let logX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, varExpr, 1);
            return cas_simplify(dae, logX);
          }
          let nPlus1 = dae.addRealLiteral(nVal + 1.0);
          let powExpr = dae.addExpression(ExprKind.Binary, BinOp.Pow, varExpr, nPlus1);
          let divExpr = dae.addExpression(ExprKind.Binary, BinOp.Div, powExpr, nPlus1);
          return cas_simplify(dae, divExpr);
        }
      }
    }
  }

  // 5. Function calls: ∫ f(x) dx
  if (kind == ExprKind.Call) {
    let funcId = exprData.get(offset + EXPR_DATA1);
    let u = exprData.get(offset + EXPR_LEFT);

    let uOffset = u * EXPR_STRIDE;
    let uKind = exprData.get(uOffset + EXPR_KIND);

    if (uKind == ExprKind.Name && exprData.get(uOffset + EXPR_DATA1) == targetVar) {
      if (funcId == BuiltinMathFunc.Sin) {
        // ∫ sin(x) dx = -cos(x)
        let cosX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cos, varExpr, 1);
        let neg = dae.addExpression(ExprKind.Negate, 0, cosX, 0xffffffff);
        return cas_simplify(dae, neg);
      }
      if (funcId == BuiltinMathFunc.Cos) {
        // ∫ cos(x) dx = sin(x)
        let sinX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sin, varExpr, 1);
        return cas_simplify(dae, sinX);
      }
      if (funcId == BuiltinMathFunc.Exp) {
        // ∫ exp(x) dx = exp(x)
        let expX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Exp, varExpr, 1);
        return cas_simplify(dae, expX);
      }
      if (funcId == BuiltinMathFunc.Sinh) {
        // ∫ sinh(x) dx = cosh(x)
        let coshX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cosh, varExpr, 1);
        return cas_simplify(dae, coshX);
      }
      if (funcId == BuiltinMathFunc.Cosh) {
        // ∫ cosh(x) dx = sinh(x)
        let sinhX = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sinh, varExpr, 1);
        return cas_simplify(dae, sinhX);
      }
      if (funcId == BuiltinMathFunc.Sqrt) {
        // ∫ sqrt(x) dx = (2/3) * x^(3/2)
        let threeHalves = dae.addRealLiteral(1.5);
        let xPow = dae.addExpression(ExprKind.Binary, BinOp.Pow, varExpr, threeHalves);
        let coeff = dae.addRealLiteral(2.0 / 3.0);
        let mul = dae.addExpression(ExprKind.Binary, BinOp.Mul, coeff, xPow);
        return cas_simplify(dae, mul);
      }
    }
  }

  return 0xffffffff;
}

/**
 * Computes the n-th order symbolic derivative of an expression w.r.t. targetVar.
 */
export function symbolicNthDerivative(dae: DaeBuilder, exprId: u32, targetVar: u32, n: u32): u32 {
  let curr = exprId;
  for (let i: u32 = 0; i < n; i++) {
    curr = cas_differentiate(dae, curr, targetVar);
    if (cas_isZero(dae, curr)) return dae.addRealLiteral(0.0);
  }
  return curr;
}

/**
 * Constructs an analytical Taylor series polynomial around x0:
 * T_order(x) = sum_{k=0}^{order} (f^(k)(x0) / k!) * (x - x0)^k
 */
export function symbolicTaylorSeries(
  dae: DaeBuilder,
  exprId: u32,
  targetVar: u32,
  point: f64,
  order: u32
): u32 {
  let varExpr = dae.addName(targetVar);
  let xMinusX0 = varExpr;
  if (Math.abs(point) > 1e-12) {
    let pointExpr = dae.addRealLiteral(point);
    xMinusX0 = dae.addExpression(ExprKind.Binary, BinOp.Sub, varExpr, pointExpr);
    xMinusX0 = cas_simplify(dae, xMinusX0);
  }

  let resultExpr = dae.addRealLiteral(0.0);
  let currentDer = exprId;
  let factorial: f64 = 1.0;

  for (let k: u32 = 0; k <= order; k++) {
    if (k > 0) {
      factorial *= (k as f64);
      currentDer = cas_differentiate(dae, currentDer, targetVar);
    }

    if (cas_isZero(dae, currentDer)) break;

    // Evaluate f^(k)(x0)
    let evaluatedExpr = symbolicSubstituteVal(dae, currentDer, targetVar, point);
    if (cas_isZero(dae, evaluatedExpr)) continue;

    // Coeff = f^(k)(x0) / k!
    let coeffExpr = evaluatedExpr;
    if (factorial != 1.0) {
      let factExpr = dae.addRealLiteral(factorial);
      coeffExpr = dae.addExpression(ExprKind.Binary, BinOp.Div, evaluatedExpr, factExpr);
      coeffExpr = cas_simplify(dae, coeffExpr);
    }

    // Term = coeff * (x - x0)^k
    let termExpr = coeffExpr;
    if (k == 1) {
      termExpr = dae.addExpression(ExprKind.Binary, BinOp.Mul, coeffExpr, xMinusX0);
      termExpr = cas_simplify(dae, termExpr);
    } else if (k > 1) {
      let kExpr = dae.addRealLiteral(k as f64);
      let powExpr = dae.addExpression(ExprKind.Binary, BinOp.Pow, xMinusX0, kExpr);
      powExpr = cas_simplify(dae, powExpr);
      termExpr = dae.addExpression(ExprKind.Binary, BinOp.Mul, coeffExpr, powExpr);
      termExpr = cas_simplify(dae, termExpr);
    }

    let addExpr = dae.addExpression(ExprKind.Binary, BinOp.Add, resultExpr, termExpr);
    resultExpr = cas_simplify(dae, addExpr);
  }

  return resultExpr;
}

/**
 * Symbolically evaluates the limit lim_{x -> point} expr.
 */
export function symbolicLimit(dae: DaeBuilder, exprId: u32, targetVar: u32, point: f64): u32 {
  // Direct evaluation
  let directVal = symbolicSubstituteVal(dae, exprId, targetVar, point);
  if (cas_isConstant(dae, directVal)) {
    return directVal;
  }

  // Taylor expansion fallback for removable singularities
  let taylor = symbolicTaylorSeries(dae, exprId, targetVar, point, 4);
  return symbolicSubstituteVal(dae, taylor, targetVar, point);
}

// ─────────────────────────────────────────────────────────────────────────────
// C/WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function integrate_expr(daePtr: u32, exprId: u32, targetVar: u32): u32 {
  if (daePtr == 0) return 0xffffffff;
  return symbolicIntegrate(changetype<DaeBuilder>(daePtr), exprId, targetVar);
}

export function taylor_series(
  daePtr: u32,
  exprId: u32,
  targetVar: u32,
  point: f64,
  order: u32
): u32 {
  if (daePtr == 0) return 0xffffffff;
  return symbolicTaylorSeries(changetype<DaeBuilder>(daePtr), exprId, targetVar, point, order);
}

export function limit_expr(daePtr: u32, exprId: u32, targetVar: u32, point: f64): u32 {
  if (daePtr == 0) return 0xffffffff;
  return symbolicLimit(changetype<DaeBuilder>(daePtr), exprId, targetVar, point);
}

export function nth_derivative(daePtr: u32, exprId: u32, targetVar: u32, n: u32): u32 {
  if (daePtr == 0) return 0xffffffff;
  return symbolicNthDerivative(changetype<DaeBuilder>(daePtr), exprId, targetVar, n);
}
