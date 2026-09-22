// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  Variability,
  EqKind,
} from "./builder";
import { ExprAccessor, EqAccessor, VarAccessor } from "./accessors";
import { cas_getRealValue, cas_isZero, cas_isOne, cas_isConstant } from "./cas";

/**
 * Built-in Math Functions for constant evaluation.
 * Must stay in sync with the funcId dispatch table in eval.ts.
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
  if (funcId == BuiltinMathFunc.Sin)   return Math.sin(arg1);
  if (funcId == BuiltinMathFunc.Cos)   return Math.cos(arg1);
  if (funcId == BuiltinMathFunc.Tan)   return Math.tan(arg1);
  if (funcId == BuiltinMathFunc.Asin)  return Math.asin(arg1);
  if (funcId == BuiltinMathFunc.Acos)  return Math.acos(arg1);
  if (funcId == BuiltinMathFunc.Atan)  return Math.atan(arg1);
  if (funcId == BuiltinMathFunc.Atan2) return Math.atan2(arg1, arg2);
  if (funcId == BuiltinMathFunc.Sinh)  return Math.sinh(arg1);
  if (funcId == BuiltinMathFunc.Cosh)  return Math.cosh(arg1);
  if (funcId == BuiltinMathFunc.Tanh)  return Math.tanh(arg1);
  if (funcId == BuiltinMathFunc.Exp)   return Math.exp(arg1);
  if (funcId == BuiltinMathFunc.Log)   return arg1 > 0.0 ? Math.log(arg1)   : 0.0;
  if (funcId == BuiltinMathFunc.Log10) return arg1 > 0.0 ? Math.log10(arg1) : 0.0;
  if (funcId == BuiltinMathFunc.Sqrt)  return arg1 >= 0.0 ? Math.sqrt(arg1) : 0.0;
  if (funcId == BuiltinMathFunc.Abs)   return Math.abs(arg1);
  if (funcId == BuiltinMathFunc.Sign)  return arg1 > 0.0 ? 1.0 : arg1 < 0.0 ? -1.0 : 0.0;
  if (funcId == BuiltinMathFunc.Min)   return Math.min(arg1, arg2);
  if (funcId == BuiltinMathFunc.Max)   return Math.max(arg1, arg2);
  if (funcId == BuiltinMathFunc.Floor) return Math.floor(arg1);
  if (funcId == BuiltinMathFunc.Ceil)  return Math.ceil(arg1);
  if (funcId == BuiltinMathFunc.Fmod)  return arg2 != 0.0 ? arg1 % arg2 : 0.0;
  if (funcId == BuiltinMathFunc.Pow)   return Math.pow(arg1, arg2);
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
 * Uses ExprAccessor and VarAccessor for all field access — no raw SoA arithmetic.
 */
export function evalConstantExpr(dae: DaeBuilder, exprId: u32, visitedDepth: i32 = 0): EvalResult {
  if (exprId >= dae.exprCount || visitedDepth > 100) {
    staticResult.isConstant = false;
    return staticResult;
  }

  let e = ExprAccessor.at(dae.getExprData(), exprId);

  if (e.kind == ExprKind.RealLiteral) {
    staticResult.isConstant = true;
    staticResult.valReal    = e.realValue;
    staticResult.valInt     = staticResult.valReal as i32;
    staticResult.valBool    = staticResult.valReal != 0.0;
    staticResult.valType    = 0;
    return staticResult;
  }

  if (e.kind == ExprKind.IntLiteral) {
    staticResult.isConstant = true;
    staticResult.valInt     = e.intValue;
    staticResult.valReal    = staticResult.valInt as f64;
    staticResult.valBool    = staticResult.valInt != 0;
    staticResult.valType    = 1;
    return staticResult;
  }

  if (e.kind == ExprKind.BoolLiteral) {
    staticResult.isConstant = true;
    staticResult.valBool    = e.intValue != 0;
    staticResult.valInt     = staticResult.valBool ? 1 : 0;
    staticResult.valReal    = staticResult.valBool ? 1.0 : 0.0;
    staticResult.valType    = 2;
    return staticResult;
  }

  if (e.kind == ExprKind.Name) {
    let varId = e.varId;
    if (varId < dae.varCount) {
      let v = VarAccessor.at(dae.getVarData(), varId);
      if (v.variability == Variability.Constant || v.variability == Variability.Parameter) {
        let startVal = dae.getVarStartValue(varId);
        staticResult.isConstant = true;
        staticResult.valReal    = startVal;
        staticResult.valInt     = startVal as i32;
        staticResult.valBool    = startVal != 0.0;
        staticResult.valType    = v.varType as i32;
        return staticResult;
      }
    }
    staticResult.isConstant = false;
    return staticResult;
  }

  if (e.kind == ExprKind.Negate) {
    let res = evalConstantExpr(dae, e.left, visitedDepth + 1);
    if (!res.isConstant) return res;
    staticResult.isConstant = true;
    staticResult.valReal    = -res.valReal;
    staticResult.valInt     = -res.valInt;
    staticResult.valBool    = res.valBool;
    staticResult.valType    = res.valType;
    return staticResult;
  }

  if (e.kind == ExprKind.Unary) {
    let res = evalConstantExpr(dae, e.left, visitedDepth + 1);
    if (!res.isConstant) return res;

    if (e.unaryOp == UnaryOp.Not) {
      staticResult.isConstant = true;
      staticResult.valBool    = !res.valBool;
      staticResult.valInt     = staticResult.valBool ? 1 : 0;
      staticResult.valReal    = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType    = 2;
    } else { // UnaryOp.Negate
      staticResult.isConstant = true;
      staticResult.valReal    = -res.valReal;
      staticResult.valInt     = -res.valInt;
      staticResult.valBool    = res.valBool;
      staticResult.valType    = res.valType;
    }
    return staticResult;
  }

  if (e.kind == ExprKind.Binary) {
    let op = e.binOp;
    let left = e.left;
    let right = e.right;

    let resLeft = evalConstantExpr(dae, left, visitedDepth + 1);
    if (!resLeft.isConstant) { staticResult.isConstant = false; return staticResult; }
    let vL_Real = resLeft.valReal;
    let vL_Int  = resLeft.valInt;
    let vL_Bool = resLeft.valBool;
    let vL_Type = resLeft.valType;

    let resRight = evalConstantExpr(dae, right, visitedDepth + 1);
    if (!resRight.isConstant) { staticResult.isConstant = false; return staticResult; }
    let vR_Real = resRight.valReal;
    let vR_Int  = resRight.valInt;
    let vR_Bool = resRight.valBool;

    staticResult.isConstant = true;
    let isRealContext = (vL_Type == 0 || resRight.valType == 0);

    if (op == BinOp.Add) {
      if (isRealContext) { staticResult.valReal = vL_Real + vR_Real; staticResult.valInt = staticResult.valReal as i32; staticResult.valType = 0; }
      else               { staticResult.valInt  = vL_Int  + vR_Int;  staticResult.valReal = staticResult.valInt as f64; staticResult.valType = 1; }
      return staticResult;
    } else if (op == BinOp.Sub) {
      if (isRealContext) { staticResult.valReal = vL_Real - vR_Real; staticResult.valInt = staticResult.valReal as i32; staticResult.valType = 0; }
      else               { staticResult.valInt  = vL_Int  - vR_Int;  staticResult.valReal = staticResult.valInt as f64; staticResult.valType = 1; }
      return staticResult;
    } else if (op == BinOp.Mul) {
      if (isRealContext) { staticResult.valReal = vL_Real * vR_Real; staticResult.valInt = staticResult.valReal as i32; staticResult.valType = 0; }
      else               { staticResult.valInt  = vL_Int  * vR_Int;  staticResult.valReal = staticResult.valInt as f64; staticResult.valType = 1; }
      return staticResult;
    } else if (op == BinOp.Div) {
      if (vR_Real != 0.0) { staticResult.valReal = vL_Real / vR_Real; staticResult.valInt = staticResult.valReal as i32; staticResult.valType = 0; }
      else                { staticResult.valReal = 0.0; staticResult.valInt = 0; staticResult.valType = 0; }
      return staticResult;
    } else if (op == BinOp.Pow) {
      staticResult.valReal = Math.pow(vL_Real, vR_Real); staticResult.valInt = staticResult.valReal as i32; staticResult.valType = 0;
      return staticResult;
    } else if (op == BinOp.Eq) {
      staticResult.valBool = isRealContext ? (vL_Real == vR_Real) : (vL_Int == vR_Int);
    } else if (op == BinOp.Neq) {
      staticResult.valBool = isRealContext ? (vL_Real != vR_Real) : (vL_Int != vR_Int);
    } else if (op == BinOp.Lt)  { staticResult.valBool = vL_Real <  vR_Real; }
    else if (op == BinOp.Lte)   { staticResult.valBool = vL_Real <= vR_Real; }
    else if (op == BinOp.Gt)    { staticResult.valBool = vL_Real >  vR_Real; }
    else if (op == BinOp.Gte)   { staticResult.valBool = vL_Real >= vR_Real; }
    else if (op == BinOp.And)   { staticResult.valBool = vL_Bool && vR_Bool; }
    else if (op == BinOp.Or)    { staticResult.valBool = vL_Bool || vR_Bool; }

    // All relational/logical operators set valBool above, then fall through here
    if (op == BinOp.Eq || op == BinOp.Neq || op == BinOp.Lt || op == BinOp.Lte ||
        op == BinOp.Gt || op == BinOp.Gte || op == BinOp.And || op == BinOp.Or) {
      staticResult.valInt  = staticResult.valBool ? 1 : 0;
      staticResult.valReal = staticResult.valBool ? 1.0 : 0.0;
      staticResult.valType = 2;
      return staticResult;
    }
  }

  if (e.kind == ExprKind.IfElse) {
    let condRes = evalConstantExpr(dae, e.data1u, visitedDepth + 1);
    if (condRes.isConstant) {
      return evalConstantExpr(dae, condRes.valBool ? e.left : e.right, visitedDepth + 1);
    }
  }

  if (e.kind == ExprKind.Call) {
    let funcId     = e.funcId as i32;
    let firstArgId = e.left;
    let argCount   = e.right;

    if (argCount >= 1) {
      let res1 = evalConstantExpr(dae, firstArgId, visitedDepth + 1);
      if (res1.isConstant) {
        let res2_val: f64 = 0.0;
        if (argCount >= 2) {
          let res2 = evalConstantExpr(dae, firstArgId + 1, visitedDepth + 1);
          if (!res2.isConstant) { staticResult.isConstant = false; return staticResult; }
          res2_val = res2.valReal;
        }
        staticResult.isConstant = true;
        staticResult.valReal    = evalMathBuiltin(funcId, res1.valReal, res2_val);
        staticResult.valInt     = staticResult.valReal as i32;
        staticResult.valBool    = staticResult.valReal != 0.0;
        staticResult.valType    = 0;
        return staticResult;
      }
    }
  }

  staticResult.isConstant = false;
  return staticResult;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAE-level Constant Folding Pass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Iteratively folds constant and parameter expressions across the entire DAE.
 * Continues until a fixed point is reached or maximum iterations are exceeded.
 * Uses VarAccessor and EqAccessor to eliminate raw SoA arithmetic.
 */
export function foldDaeConstants(dae: DaeBuilder, maxIterations: u32 = 100): u32 {
  let changed    = true;
  let iterations: u32 = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Pass 1: Propagate constant/parameter start values from binding equations
    for (let i: u32 = 0; i < dae.varCount; i++) {
      let v = VarAccessor.at(dae.getVarData(), i);
      if (v.variability != Variability.Constant && v.variability != Variability.Parameter) continue;

      for (let eqIdx: u32 = 0; eqIdx < dae.eqCount; eqIdx++) {
        let eq = EqAccessor.at(dae.getEqData(), eqIdx);
        if (!eq.isSimple) continue;

        let lhsId = eq.lhs;
        if (lhsId < dae.exprCount) {
          let lhsExpr = ExprAccessor.at(dae.getExprData(), lhsId);
          if (lhsExpr.isName && lhsExpr.varId == i) {
            let evalRes = evalConstantExpr(dae, eq.rhs);
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

    // Pass 2: Fold constant subexpressions in RHS of simple equations
    for (let eqIdx: u32 = 0; eqIdx < dae.eqCount; eqIdx++) {
      let eq = EqAccessor.at(dae.getEqData(), eqIdx);
      if (!eq.isSimple) continue;

      let rhsId = eq.rhs;
      if (rhsId < dae.exprCount) {
        let evalRhs = evalConstantExpr(dae, rhsId);
        if (evalRhs.isConstant) {
          let newRhs = evalRhs.valType == 1
            ? dae.addIntLiteral(evalRhs.valInt)
            : dae.addRealLiteral(evalRhs.valReal);
          if (newRhs != rhsId) {
            eq.rhs = newRhs;
            changed = true;
          }
        }
      }
    }
  }

  return iterations;
}

// ─────────────────────────────────────────────────────────────────────────────
// WASM Bridge Exports
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
