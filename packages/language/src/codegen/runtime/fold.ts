// SPDX-License-Identifier: AGPL-3.0-or-later
// @ts-nocheck
import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  Variability,
  VarType,
  EXPR_STRIDE,
  EXPR_KIND,
  EXPR_DATA1,
  EXPR_LEFT,
  EXPR_RIGHT,
  VAR_STRIDE,
  VAR_NAME,
  VAR_TYPE,
  VAR_VARIABILITY,
  VAR_START_HI,
  VAR_START_LO,
  VAR_FLAGS,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
  EqKind
} from "./dae";
import { cas_getRealValue, cas_isZero, cas_isOne, cas_isConstant } from "./cas";

/**
 * Built-in Math Functions for constant evaluation.
 */
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
  Pow = 21
}

/**
 * Evaluates an elementary math function on constant real inputs.
 */
@inline
export function evalMathBuiltin(funcId: i32, arg1: f64, arg2: f64 = 0.0): f64 {
  if (funcId == BuiltinMathFunc.Sin) return Math.sin(arg1);
  if (funcId == BuiltinMathFunc.Cos) return Math.cos(arg1);
  if (funcId == BuiltinMathFunc.Tan) return Math.tan(arg1);
  if (funcId == BuiltinMathFunc.Asin) return Math.asin(arg1);
  if (funcId == BuiltinMathFunc.Acos) return Math.acos(arg1);
  if (funcId == BuiltinMathFunc.Atan) return Math.atan(arg1);
  if (funcId == BuiltinMathFunc.Atan2) return Math.atan2(arg1, arg2);
  if (funcId == BuiltinMathFunc.Sinh) return Math.sinh(arg1);
  if (funcId == BuiltinMathFunc.Cosh) return Math.cosh(arg1);
  if (funcId == BuiltinMathFunc.Tanh) return Math.tanh(arg1);
  if (funcId == BuiltinMathFunc.Exp) return Math.exp(arg1);
  if (funcId == BuiltinMathFunc.Log) return arg1 > 0.0 ? Math.log(arg1) : 0.0;
  if (funcId == BuiltinMathFunc.Log10) return arg1 > 0.0 ? Math.log10(arg1) : 0.0;
  if (funcId == BuiltinMathFunc.Sqrt) return arg1 >= 0.0 ? Math.sqrt(arg1) : 0.0;
  if (funcId == BuiltinMathFunc.Abs) return Math.abs(arg1);
  if (funcId == BuiltinMathFunc.Sign) return arg1 > 0.0 ? 1.0 : arg1 < 0.0 ? -1.0 : 0.0;
  if (funcId == BuiltinMathFunc.Min) return Math.min(arg1, arg2);
  if (funcId == BuiltinMathFunc.Max) return Math.max(arg1, arg2);
  if (funcId == BuiltinMathFunc.Floor) return Math.floor(arg1);
  if (funcId == BuiltinMathFunc.Ceil) return Math.ceil(arg1);
  if (funcId == BuiltinMathFunc.Fmod) return arg2 != 0.0 ? arg1 % arg2 : 0.0;
  if (funcId == BuiltinMathFunc.Pow) return Math.pow(arg1, arg2);
  return 0.0;
}

/**
 * Result structure for constant expression evaluation.
 * Returns whether evaluation succeeded and the computed value / type.
 */
export class EvalResult {
  isConstant: bool;
  valReal: f64;
  valInt: i32;
  valBool: bool;
  valType: i32; // 0 = Real, 1 = Int, 2 = Bool
}

let staticResult: EvalResult = new EvalResult();

/**
 * Evaluates an expression node in linear memory to a constant scalar if possible.
 */
export function evalConstantExpr(dae: DaeBuilder, exprId: u32, visitedDepth: i32 = 0): EvalResult {
  if (exprId >= dae.exprCount || visitedDepth > 100) {
    staticResult.isConstant = false;
    return staticResult;
  }

  let offset = exprId * EXPR_STRIDE;
  let kind = dae.getExprData().get(offset + EXPR_KIND);

  if (kind == ExprKind.RealLiteral) {
    staticResult.isConstant = true;
    staticResult.valReal = cas_getRealValue(dae, exprId);
    staticResult.valInt = staticResult.valReal as i32;
    staticResult.valBool = staticResult.valReal != 0.0;
    staticResult.valType = 0;
    return staticResult;
  }

  if (kind == ExprKind.IntLiteral) {
    staticResult.isConstant = true;
    staticResult.valInt = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    staticResult.valReal = staticResult.valInt as f64;
    staticResult.valBool = staticResult.valInt != 0;
    staticResult.valType = 1;
    return staticResult;
  }

  if (kind == ExprKind.BoolLiteral) {
    staticResult.isConstant = true;
    staticResult.valBool = (dae.getExprData().get(offset + EXPR_DATA1) as i32) != 0;
    staticResult.valInt = staticResult.valBool ? 1 : 0;
    staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
    staticResult.valType = 2;
    return staticResult;
  }

  if (kind == ExprKind.Name) {
    let varId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    if (varId < dae.varCount) {
      let varOffset = varId * VAR_STRIDE;
      let variability = dae.getVarData().get(varOffset + VAR_VARIABILITY);
      if (variability == Variability.Constant || variability == Variability.Parameter) {
        let vType = dae.getVarData().get(varOffset + VAR_TYPE);
        let startVal = dae.getVarStartValue(varId);
        staticResult.isConstant = true;
        staticResult.valReal = startVal;
        staticResult.valInt = startVal as i32;
        staticResult.valBool = startVal != 0.0;
        staticResult.valType = vType;
        return staticResult;
      }
    }
    staticResult.isConstant = false;
    return staticResult;
  }

  if (kind == ExprKind.Negate) {
    let childId = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let res = evalConstantExpr(dae, childId, visitedDepth + 1);
    if (!res.isConstant) return res;

    staticResult.isConstant = true;
    staticResult.valReal = -res.valReal;
    staticResult.valInt = -res.valInt;
    staticResult.valBool = res.valBool;
    staticResult.valType = res.valType;
    return staticResult;
  }

  if (kind == ExprKind.Unary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    let childId = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let res = evalConstantExpr(dae, childId, visitedDepth + 1);
    if (!res.isConstant) return res;

    if (op == UnaryOp.Not) {
      staticResult.isConstant = true;
      staticResult.valBool = !res.valBool;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == UnaryOp.Negate) {
      staticResult.isConstant = true;
      staticResult.valReal = -res.valReal;
      staticResult.valInt = -res.valInt;
      staticResult.valBool = res.valBool;
      staticResult.valType = res.valType;
      return staticResult;
    }
  }

  if (kind == ExprKind.Binary) {
    let op = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    let leftId = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let rightId = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    let resLeft = evalConstantExpr(dae, leftId, visitedDepth + 1);
    if (!resLeft.isConstant) {
      staticResult.isConstant = false;
      return staticResult;
    }
    let vL_Real = resLeft.valReal;
    let vL_Int = resLeft.valInt;
    let vL_Bool = resLeft.valBool;
    let vL_Type = resLeft.valType;

    let resRight = evalConstantExpr(dae, rightId, visitedDepth + 1);
    if (!resRight.isConstant) {
      staticResult.isConstant = false;
      return staticResult;
    }
    let vR_Real = resRight.valReal;
    let vR_Int = resRight.valInt;
    let vR_Bool = resRight.valBool;

    staticResult.isConstant = true;
    let isRealContext = (vL_Type == 0 || resRight.valType == 0);

    if (op == BinOp.Add) {
      if (isRealContext) {
        staticResult.valReal = vL_Real + vR_Real;
        staticResult.valInt = staticResult.valReal as i32;
        staticResult.valType = 0;
      } else {
        staticResult.valInt = vL_Int + vR_Int;
        staticResult.valReal = staticResult.valInt as f64;
        staticResult.valType = 1;
      }
      return staticResult;
    } else if (op == BinOp.Sub) {
      if (isRealContext) {
        staticResult.valReal = vL_Real - vR_Real;
        staticResult.valInt = staticResult.valReal as i32;
        staticResult.valType = 0;
      } else {
        staticResult.valInt = vL_Int - vR_Int;
        staticResult.valReal = staticResult.valInt as f64;
        staticResult.valType = 1;
      }
      return staticResult;
    } else if (op == BinOp.Mul) {
      if (isRealContext) {
        staticResult.valReal = vL_Real * vR_Real;
        staticResult.valInt = staticResult.valReal as i32;
        staticResult.valType = 0;
      } else {
        staticResult.valInt = vL_Int * vR_Int;
        staticResult.valReal = staticResult.valInt as f64;
        staticResult.valType = 1;
      }
      return staticResult;
    } else if (op == BinOp.Div) {
      if (vR_Real != 0.0) {
        staticResult.valReal = vL_Real / vR_Real;
        staticResult.valInt = staticResult.valReal as i32;
        staticResult.valType = 0;
      } else {
        staticResult.valReal = 0.0;
        staticResult.valInt = 0;
        staticResult.valType = 0;
      }
      return staticResult;
    } else if (op == BinOp.Pow) {
      staticResult.valReal = Math.pow(vL_Real, vR_Real);
      staticResult.valInt = staticResult.valReal as i32;
      staticResult.valType = 0;
      return staticResult;
    } else if (op == BinOp.Eq) {
      staticResult.valBool = isRealContext ? (vL_Real == vR_Real) : (vL_Int == vR_Int);
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.Neq) {
      staticResult.valBool = isRealContext ? (vL_Real != vR_Real) : (vL_Int != vR_Int);
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.Lt) {
      staticResult.valBool = vL_Real < vR_Real;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.Lte) {
      staticResult.valBool = vL_Real <= vR_Real;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.Gt) {
      staticResult.valBool = vL_Real > vR_Real;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.Gte) {
      staticResult.valBool = vL_Real >= vR_Real;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.And) {
      staticResult.valBool = vL_Bool && vR_Bool;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    } else if (op == BinOp.Or) {
      staticResult.valBool = vL_Bool || vR_Bool;
      staticResult.valInt = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    }
  }

  if (kind == ExprKind.IfElse) {
    let condId = dae.getExprData().get(offset + EXPR_DATA1) as u32;
    let condRes = evalConstantExpr(dae, condId, visitedDepth + 1);
    if (condRes.isConstant) {
      let isTrue = condRes.valBool;
      let branchId = isTrue
        ? (dae.getExprData().get(offset + EXPR_LEFT) as u32)
        : (dae.getExprData().get(offset + EXPR_RIGHT) as u32);
      return evalConstantExpr(dae, branchId, visitedDepth + 1);
    }
  }

  if (kind == ExprKind.Call) {
    let funcId = dae.getExprData().get(offset + EXPR_DATA1) as i32;
    let firstArgId = dae.getExprData().get(offset + EXPR_LEFT) as u32;
    let argCount = dae.getExprData().get(offset + EXPR_RIGHT) as u32;

    if (argCount >= 1) {
      let res1 = evalConstantExpr(dae, firstArgId, visitedDepth + 1);
      if (res1.isConstant) {
        let res2_val: f64 = 0.0;
        if (argCount >= 2) {
          let res2 = evalConstantExpr(dae, firstArgId + 1, visitedDepth + 1);
          if (!res2.isConstant) {
            staticResult.isConstant = false;
            return staticResult;
          }
          res2_val = res2.valReal;
        }

        staticResult.isConstant = true;
        staticResult.valReal = evalMathBuiltin(funcId, res1.valReal, res2_val);
        staticResult.valInt = staticResult.valReal as i32;
        staticResult.valBool = staticResult.valReal != 0.0;
        staticResult.valType = 0;
        return staticResult;
      }
    }
  }

  staticResult.isConstant = false;
  return staticResult;
}

/**
 * Iteratively folds constant and parameter expressions across the entire DAE.
 * Continues until a fixed point is reached or maximum iterations are exceeded.
 */
export function foldDaeConstants(dae: DaeBuilder, maxIterations: u32 = 100): u32 {
  let changed = true;
  let iterations: u32 = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // 1. Fold all constant and parameter variables
    for (let i: u32 = 0; i < dae.varCount; i++) {
      let varOffset = i * VAR_STRIDE;
      let variability = dae.getVarData().get(varOffset + VAR_VARIABILITY);
      if (variability != Variability.Constant && variability != Variability.Parameter) continue;

      let nameId = dae.getVarData().get(varOffset + VAR_NAME) as u32;

      // Find binding expression if variable has an equation definition (e.g. parameter Real R = 100)
      for (let eq: u32 = 0; eq < dae.eqCount; eq++) {
        let eqOffset = eq * EQ_STRIDE;
        if (dae.getEqData().get(eqOffset + EQ_KIND) != EqKind.Simple) continue;

        let lhsExpr = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
        if (lhsExpr < dae.exprCount && dae.getExprData().get(lhsExpr * EXPR_STRIDE + EXPR_KIND) == ExprKind.Name) {
          let targetVarId = dae.getExprData().get(lhsExpr * EXPR_STRIDE + EXPR_DATA1) as u32;
          if (targetVarId == i) {
            let rhsExpr = dae.getEqData().get(eqOffset + EQ_RHS) as u32;
            let evalRes = evalConstantExpr(dae, rhsExpr);
            if (evalRes.isConstant) {
              let oldStart = dae.getVarStartValue(i);
              if (oldStart != evalRes.valReal) {
                dae.setVarStartValue(i, evalRes.valReal);
                changed = true;
              }
            }
          }
        }
      }
    }

    // 2. Fold expressions inside equations
    for (let eq: u32 = 0; eq < dae.eqCount; eq++) {
      let eqOffset = eq * EQ_STRIDE;
      if (dae.getEqData().get(eqOffset + EQ_KIND) != EqKind.Simple) continue;

      let lhsExpr = dae.getEqData().get(eqOffset + EQ_LHS) as u32;
      let rhsExpr = dae.getEqData().get(eqOffset + EQ_RHS) as u32;

      if (rhsExpr < dae.exprCount) {
        let evalRhs = evalConstantExpr(dae, rhsExpr);
        if (evalRhs.isConstant) {
          let newRhs = evalRhs.valType == 1
            ? dae.addIntLiteral(evalRhs.valInt)
            : dae.addRealLiteral(evalRhs.valReal);
          if (newRhs != rhsExpr) {
            dae.getEqData().set(eqOffset + EQ_RHS, newRhs);
            changed = true;
          }
        }
      }
    }
  }

  return iterations;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported C/WASM Bridge Functions
// ─────────────────────────────────────────────────────────────────────────────

export function dae_foldConstants(daePtr: u32, maxIterations: u32): u32 {
  return foldDaeConstants(changetype<DaeBuilder>(daePtr), maxIterations);
}

export function dae_evalExpressionAsReal(daePtr: u32, exprId: u32): f64 {
  let res = evalConstantExpr(changetype<DaeBuilder>(daePtr), exprId);
  return res.isConstant ? res.valReal : 0.0;
}

export function dae_evalExpressionAsInt(daePtr: u32, exprId: u32): i32 {
  let res = evalConstantExpr(changetype<DaeBuilder>(daePtr), exprId);
  return res.isConstant ? res.valInt : 0;
}
