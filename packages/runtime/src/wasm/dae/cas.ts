// SPDX-License-Identifier: AGPL-3.0-or-later
import { DaeBuilder, ExprKind, BinOp, UnaryOp, BuiltinMathFunc } from "./builder";
import { ExprAccessor } from "./accessors";

export { BuiltinMathFunc };

/**
 * Computer Algebra System (CAS) & Symbolic Simplification Engine in WASM.
 * Implements algebraic rewrite rules, constant folding, and symbolic differentiation
 * over DaeBuilder arena expressions. All hot paths use zero-overhead ExprAccessor views.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Literal Value Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function cas_getRealValue(dae: DaeBuilder, exprId: u32): f64 {
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  if (e.kind == ExprKind.IntLiteral) return e.intValue as f64;
  return e.realValue;
}

export function cas_isZero(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  if (e.kind == ExprKind.IntLiteral)  return e.intValue == 0;
  if (e.kind == ExprKind.RealLiteral) return e.realValue == 0.0;
  return false;
}

export function cas_isOne(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  if (e.kind == ExprKind.IntLiteral)  return e.intValue == 1;
  if (e.kind == ExprKind.RealLiteral) return e.realValue == 1.0;
  return false;
}

export function cas_isConstant(dae: DaeBuilder, exprId: u32): boolean {
  if (exprId >= dae.exprCount) return false;
  let k = ExprAccessor.at(dae.getExprData(), exprId).kind;
  return k == ExprKind.IntLiteral || k == ExprKind.RealLiteral;
}

// ─────────────────────────────────────────────────────────────────────────────
// Algebraic Simplification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively simplifies an algebraic expression using rewrite rules.
 */
export function cas_simplify(dae: DaeBuilder, exprId: u32): u32 {
  if (exprId >= dae.exprCount) return exprId;
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  let kind = e.kind;
  let op = e.binOp;
  let unaryOp = e.unaryOp;
  let leftId = e.left;
  let rightId = e.right;

  if (kind == ExprKind.Binary) {
    let left  = cas_simplify(dae, leftId);
    let right = cas_simplify(dae, rightId);

    // Constant folding if both operands are numeric constants
    if (cas_isConstant(dae, left) && cas_isConstant(dae, right)) {
      let vLeft  = cas_getRealValue(dae, left);
      let vRight = cas_getRealValue(dae, right);
      if (op == BinOp.Add) return dae.addRealLiteral(vLeft + vRight);
      if (op == BinOp.Sub) return dae.addRealLiteral(vLeft - vRight);
      if (op == BinOp.Mul) return dae.addRealLiteral(vLeft * vRight);
      if (op == BinOp.Div && vRight != 0.0) return dae.addRealLiteral(vLeft / vRight);
      if (op == BinOp.Pow) return dae.addRealLiteral(Math.pow(vLeft, vRight));
    }

    // Algebraic rewrite rules
    if (op == BinOp.Add) {
      if (cas_isZero(dae, right)) return left;   // x + 0 → x
      if (cas_isZero(dae, left))  return right;  // 0 + x → x
    } else if (op == BinOp.Sub) {
      if (cas_isZero(dae, right)) return left;   // x - 0 → x
      if (cas_isZero(dae, left))  return cas_simplify(dae, dae.addExpression(ExprKind.Negate, 0, right, 0xffffffff)); // 0 - x → -x
      if (left == right) return dae.addRealLiteral(0.0); // x - x → 0
    } else if (op == BinOp.Mul) {
      if (cas_isZero(dae, left) || cas_isZero(dae, right)) return dae.addRealLiteral(0.0); // x*0, 0*x → 0
      if (cas_isOne(dae, right)) return left;    // x * 1 → x
      if (cas_isOne(dae, left))  return right;   // 1 * x → x
    } else if (op == BinOp.Div) {
      if (cas_isZero(dae, left))  return dae.addRealLiteral(0.0); // 0 / x → 0
      if (cas_isOne(dae, right))  return left;   // x / 1 → x
      if (left == right)          return dae.addRealLiteral(1.0); // x / x → 1
    } else if (op == BinOp.Pow) {
      if (cas_isZero(dae, right)) return dae.addRealLiteral(1.0); // x ^ 0 → 1
      if (cas_isOne(dae, right))  return left;   // x ^ 1 → x
    }

    return dae.addExpression(ExprKind.Binary, op, left, right);
  }

  if (kind == ExprKind.Call && rightId == 1 && leftId < dae.exprCount) {
    let simpArg = cas_simplify(dae, leftId);
    if (simpArg != leftId) {
      return dae.addExpression(ExprKind.Call, e.data1, simpArg, 1);
    }
    return exprId;
  }

  if (kind == ExprKind.IfElse) {
    let simpCond = cas_simplify(dae, e.data1);
    let simpThen = cas_simplify(dae, leftId);
    let simpElse = cas_simplify(dae, rightId);
    if (simpThen == simpElse) return simpThen;
    if (simpCond != e.data1 || simpThen != leftId || simpElse != rightId) {
      return dae.addExpression(ExprKind.IfElse, simpCond, simpThen, simpElse);
    }
    return exprId;
  }

  if (kind == ExprKind.Unary && unaryOp == UnaryOp.Not) {
    let sub = cas_simplify(dae, leftId);
    let subAcc = ExprAccessor.at(dae.getExprData(), sub);
    if (subAcc.kind == ExprKind.BoolLiteral) {
      return dae.addBoolLiteral(subAcc.intValue == 0);
    }
    if (subAcc.kind == ExprKind.Unary && subAcc.unaryOp == UnaryOp.Not) {
      return subAcc.left;
    }
    return sub == leftId ? exprId : dae.addExpression(ExprKind.Unary, UnaryOp.Not, sub, 0xffffffff);
  }

  if (kind == ExprKind.Unary || kind == ExprKind.Negate) {
    let sub = cas_simplify(dae, leftId);
    if (cas_isConstant(dae, sub)) {
      return dae.addRealLiteral(-cas_getRealValue(dae, sub));
    }
    // -(-x) → x
    let subAcc = ExprAccessor.at(dae.getExprData(), sub);
    if (subAcc.kind == ExprKind.Negate || (subAcc.kind == ExprKind.Unary && subAcc.unaryOp == UnaryOp.Negate)) {
      return subAcc.left;
    }
    return dae.addExpression(ExprKind.Negate, 0, sub, 0xffffffff);
  }

  return exprId;
}

// ─────────────────────────────────────────────────────────────────────────────
// Symbolic Differentiation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the exact symbolic derivative d(expr)/d(targetVarId).
 * Applies standard calculus rules recursively over the expression arena.
 */
export function cas_differentiate(dae: DaeBuilder, exprId: u32, targetVarId: u32): u32 {
  if (exprId >= dae.exprCount) return dae.addRealLiteral(0.0);
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  let kind = e.kind;
  let data1 = e.data1;
  let left = e.left;
  let right = e.right;
  let unaryOp = e.unaryOp;
  let binOp = e.binOp;
  let funcId = e.funcId as i32;
  let varId = e.varId;

  // d(x)/dx = 1, d(y)/dx = 0
  if (kind == ExprKind.Name) {
    if (varId == targetVarId) return dae.addRealLiteral(1.0);
    if (varId >= dae.varCount) {
      let resolved = dae.lookupVariableByName(varId);
      if (resolved >= 0 && (resolved as u32) == targetVarId) return dae.addRealLiteral(1.0);
    }
    return dae.addRealLiteral(0.0);
  }

  // d(const)/dx = 0
  if (e.isLiteral) {
    return dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.Binary) {
    let op = binOp;
    let u  = left;
    let v  = right;
    let du = cas_differentiate(dae, u, targetVarId);
    let dv = cas_differentiate(dae, v, targetVarId);

    if (op == BinOp.Add || op == BinOp.ElemAdd) {
      // d(u + v) = du + dv
      return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Add, du, dv));
    }
    if (op == BinOp.Sub || op == BinOp.ElemSub) {
      // d(u - v) = du - dv
      return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Sub, du, dv));
    }
    if (op == BinOp.Mul || op == BinOp.ElemMul) {
      // Product rule: d(u*v) = du*v + u*dv
      let t1  = dae.addExpression(ExprKind.Binary, BinOp.Mul, du, v);
      let t2  = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
      return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Add, t1, t2));
    }
    if (op == BinOp.Div || op == BinOp.ElemDiv) {
      // Quotient rule: d(u/v) = (du*v - u*dv) / v²
      let num1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, du, v);
      let num2 = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
      let num  = dae.addExpression(ExprKind.Binary, BinOp.Sub, num1, num2);
      let den  = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, v);
      return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Div, num, den));
    }
    if (op == BinOp.Pow || op == BinOp.ElemPow) {
      if (cas_isZero(dae, dv)) {
        // v constant: d(u^v) = v * u^(v-1) * du
        let vMinus1 = cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Sub, v, dae.addRealLiteral(1.0)));
        let uPow = dae.addExpression(ExprKind.Binary, BinOp.Pow, u, vMinus1);
        let t1   = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, uPow);
        return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, t1, du));
      }
      if (cas_isZero(dae, du)) {
        // u constant: d(u^v) = u^v * ln(u) * dv
        let logU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, u, 1);
        let t1   = dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, logU);
        return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, t1, dv));
      }
      // General: u^v * (dv*ln(u) + v*du/u)
      let logU    = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, u, 1);
      let t1      = dae.addExpression(ExprKind.Binary, BinOp.Mul, dv, logU);
      let vDu     = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, du);
      let vDuOverU= dae.addExpression(ExprKind.Binary, BinOp.Div, vDu, u);
      let sum     = dae.addExpression(ExprKind.Binary, BinOp.Add, t1, vDuOverU);
      return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, sum));
    }
  }

  if (kind == ExprKind.Call) {
    funcId = dae.resolveBuiltinMathFunc(funcId);
    let u  = left;
    let du = cas_differentiate(dae, u, targetVarId);

    if (funcId == BuiltinMathFunc.NoEvent || funcId == BuiltinMathFunc.Homotopy || funcId == BuiltinMathFunc.Fmod) {
      return du;
    }
    if (funcId == BuiltinMathFunc.Sign || funcId == BuiltinMathFunc.Floor || funcId == BuiltinMathFunc.Ceil) {
      return dae.addRealLiteral(0.0);
    }
    if (
      funcId == BuiltinMathFunc.Smooth ||
      funcId == BuiltinMathFunc.Atan2 ||
      funcId == BuiltinMathFunc.Min ||
      funcId == BuiltinMathFunc.Max ||
      funcId == BuiltinMathFunc.Pow ||
      funcId == BuiltinMathFunc.SemiLinear
    ) {
      let v = right;
      if (exprId + 1 < dae.exprCount) {
        let nextAcc = ExprAccessor.at(dae.getExprData(), exprId + 1);
        if (nextAcc.kind == ExprKind.Tuple) {
          v = nextAcc.left;
        }
      }
      if (v >= dae.exprCount && u + 1 < dae.exprCount) {
        v = u + 1;
      }
      if (funcId == BuiltinMathFunc.Smooth) {
        return cas_differentiate(dae, v, targetVarId);
      }
      if (funcId == BuiltinMathFunc.SemiLinear) {
        if (cas_isZero(dae, du)) return dae.addRealLiteral(0.0);
        let kNeg: u32 = 0xffffffff;
        if (exprId + 2 < dae.exprCount) {
          let next2Acc = ExprAccessor.at(dae.getExprData(), exprId + 2);
          if (next2Acc.kind == ExprKind.Tuple) {
            kNeg = next2Acc.left;
          }
        }
        let cond = dae.addExpression(ExprKind.Binary, BinOp.Gte, u, dae.addRealLiteral(0.0));
        let posBranch = cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, v, du));
        let negBranch = kNeg < dae.exprCount
          ? cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, kNeg, du))
          : dae.addRealLiteral(0.0);
        return cas_simplify(dae, dae.addExpression(ExprKind.IfElse, cond, posBranch, negBranch));
      }
      let dv = cas_differentiate(dae, v, targetVarId);
      if (cas_isZero(dae, du) && cas_isZero(dae, dv)) return dae.addRealLiteral(0.0);
      if (funcId == BuiltinMathFunc.Min) {
        let cond = dae.addExpression(ExprKind.Binary, BinOp.Lt, u, v);
        return cas_simplify(dae, dae.addExpression(ExprKind.IfElse, cond, du, dv));
      }
      if (funcId == BuiltinMathFunc.Max) {
        let cond = dae.addExpression(ExprKind.Binary, BinOp.Gt, u, v);
        return cas_simplify(dae, dae.addExpression(ExprKind.IfElse, cond, du, dv));
      }
      if (funcId == BuiltinMathFunc.Atan2) {
        let vDu = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, du);
        let uDv = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, dv);
        let num = dae.addExpression(ExprKind.Binary, BinOp.Sub, vDu, uDv);
        let u2  = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
        let v2  = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, v);
        let den = dae.addExpression(ExprKind.Binary, BinOp.Add, v2, u2);
        return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Div, num, den));
      }
      if (funcId == BuiltinMathFunc.Pow) {
        if (cas_isZero(dae, dv)) {
          let vMinus1 = cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Sub, v, dae.addRealLiteral(1.0)));
          let uPow = dae.addExpression(ExprKind.Binary, BinOp.Pow, u, vMinus1);
          let t1   = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, uPow);
          return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, t1, du));
        }
        let logU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Log, u, 1);
        if (cas_isZero(dae, du)) {
          let t1 = dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, logU);
          return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, t1, dv));
        }
        let t1       = dae.addExpression(ExprKind.Binary, BinOp.Mul, dv, logU);
        let vDu      = dae.addExpression(ExprKind.Binary, BinOp.Mul, v, du);
        let vDuOverU = dae.addExpression(ExprKind.Binary, BinOp.Div, vDu, u);
        let sum      = dae.addExpression(ExprKind.Binary, BinOp.Add, t1, vDuOverU);
        return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, exprId, sum));
      }
    }

    if (cas_isZero(dae, du)) return dae.addRealLiteral(0.0);

    let dOuter: u32 = 0xffffffff;
    if (funcId == BuiltinMathFunc.Sin) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cos, u, 1);
    } else if (funcId == BuiltinMathFunc.Cos) {
      let sinU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sin, u, 1);
      dOuter   = dae.addExpression(ExprKind.Negate, 0, sinU, 0xffffffff);
    } else if (funcId == BuiltinMathFunc.Tan) {
      // d/du tan(u) = 1 + tan²(u)
      let tanU  = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Tan, u, 1);
      let tanSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, tanU, tanU);
      dOuter    = dae.addExpression(ExprKind.Binary, BinOp.Add, dae.addRealLiteral(1.0), tanSq);
    } else if (funcId == BuiltinMathFunc.Exp) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Exp, u, 1);
    } else if (funcId == BuiltinMathFunc.Log) {
      // d/du ln(u) = 1/u
      dOuter = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), u);
    } else if (funcId == BuiltinMathFunc.Log10) {
      // d/du log10(u) = 1 / (u * ln(10))
      let ln10 = dae.addRealLiteral(2.302585092994046);
      let den  = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, ln10);
      dOuter   = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Sqrt) {
      // d/du sqrt(u) = 1 / (2 * sqrt(u))
      let sqrtU = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, u, 1);
      let den   = dae.addExpression(ExprKind.Binary, BinOp.Mul, dae.addRealLiteral(2.0), sqrtU);
      dOuter    = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Sinh) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Cosh, u, 1);
    } else if (funcId == BuiltinMathFunc.Cosh) {
      dOuter = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sinh, u, 1);
    } else if (funcId == BuiltinMathFunc.Tanh) {
      // d/du tanh(u) = 1 - tanh²(u)
      let tanhU  = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Tanh, u, 1);
      let tanhSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, tanhU, tanhU);
      dOuter     = dae.addExpression(ExprKind.Binary, BinOp.Sub, dae.addRealLiteral(1.0), tanhSq);
    } else if (funcId == BuiltinMathFunc.Asin) {
      // d/du asin(u) = 1 / sqrt(1 - u²)
      let uSq        = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
      let oneMinusUSq= dae.addExpression(ExprKind.Binary, BinOp.Sub, dae.addRealLiteral(1.0), uSq);
      let den        = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, oneMinusUSq, 1);
      dOuter         = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Acos) {
      // d/du acos(u) = -1 / sqrt(1 - u²)
      let uSq        = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
      let oneMinusUSq= dae.addExpression(ExprKind.Binary, BinOp.Sub, dae.addRealLiteral(1.0), uSq);
      let den        = dae.addExpression(ExprKind.Call, BuiltinMathFunc.Sqrt, oneMinusUSq, 1);
      let pos        = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
      dOuter         = dae.addExpression(ExprKind.Negate, 0, pos, 0xffffffff);
    } else if (funcId == BuiltinMathFunc.Atan) {
      // d/du atan(u) = 1 / (1 + u²)
      let uSq = dae.addExpression(ExprKind.Binary, BinOp.Mul, u, u);
      let den = dae.addExpression(ExprKind.Binary, BinOp.Add, dae.addRealLiteral(1.0), uSq);
      dOuter  = dae.addExpression(ExprKind.Binary, BinOp.Div, dae.addRealLiteral(1.0), den);
    } else if (funcId == BuiltinMathFunc.Abs) {
      let cond  = dae.addExpression(ExprKind.Binary, BinOp.Gte, u, dae.addRealLiteral(0.0));
      let negDu = dae.addExpression(ExprKind.Negate, 0, du, 0xffffffff);
      return cas_simplify(dae, dae.addExpression(ExprKind.IfElse, cond, du, negDu));
    }

    if (dOuter != 0xffffffff) {
      return cas_simplify(dae, dae.addExpression(ExprKind.Binary, BinOp.Mul, dOuter, du));
    }
  }

  if (kind == ExprKind.IfElse) {
    // d/dx if(c, t, e) = if(c, d/dx t, d/dx e)
    let dThen = cas_differentiate(dae, left,  targetVarId);
    let dElse = cas_differentiate(dae, right, targetVarId);
    return cas_simplify(dae, dae.addExpression(ExprKind.IfElse, data1, dThen, dElse));
  }

  if (kind == ExprKind.Unary && unaryOp == UnaryOp.Not) {
    return dae.addRealLiteral(0.0);
  }

  if (kind == ExprKind.Negate || kind == ExprKind.Unary) {
    let du = cas_differentiate(dae, left, targetVarId);
    return cas_simplify(dae, dae.addExpression(ExprKind.Negate, 0, du, 0xffffffff));
  }

  return dae.addRealLiteral(0.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function cas_export_simplify(daePtr: u32, exprId: u32): u32 {
  if (daePtr == 0) return exprId;
  return cas_simplify(changetype<DaeBuilder>(daePtr), exprId);
}

export function cas_export_differentiate(daePtr: u32, exprId: u32, targetVarId: u32): u32 {
  if (daePtr == 0) return 0;
  return cas_differentiate(changetype<DaeBuilder>(daePtr), exprId, targetVarId);
}
