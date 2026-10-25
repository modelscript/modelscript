// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  DaeBuilder,
  ExprKind,
  BinOp,
  UnaryOp,
  Variability,
  EqKind,
  BuiltinMathFunc,
} from "./builder";
import {
  VarType,
  VarAttrKind,
  VAR_STRIDE,
  VAR_FLAGS,
  FLAG_VAR_FINAL,
  EXPR_STRIDE,
  EQ_STRIDE,
  EQ_KIND,
  EQ_LHS,
  EQ_RHS,
} from "./types";
import { ExprAccessor, EqAccessor, VarAccessor } from "./accessors";
import { cas_getRealValue, cas_isZero, cas_isOne, cas_isConstant } from "./cas";

export { BuiltinMathFunc };

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

@inline
function daeUsesVarIds(dae: DaeBuilder): bool {
  for (let i: u32 = 0; i < dae.exprCount; i++) {
    let e = ExprAccessor.at(dae.getExprData(), i);
    if (e.kind == ExprKind.Name) {
      let id = e.data1u;
      if (id < dae.varCount && dae.lookupVariableByName(id) < 0) {
        return true;
      }
    }
  }
  return false;
}

@inline
function resolveNameExprToVarId(dae: DaeBuilder, data1u: u32, useVarIds: bool): i32 {
  if (useVarIds) {
    return data1u < dae.varCount ? (data1u as i32) : dae.lookupVariableByName(data1u);
  }
  let lookedUp = dae.lookupVariableByName(data1u);
  if (lookedUp >= 0) return lookedUp;
  return data1u < dae.varCount ? (data1u as i32) : -1;
}

@inline
export function isLiteralMinusOne(dae: DaeBuilder, exprId: u32): bool {
  if (exprId >= dae.exprCount) return false;
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  if (e.kind == ExprKind.IntLiteral)  return e.intValue == -1;
  if (e.kind == ExprKind.RealLiteral) return e.realValue == -1.0;
  return false;
}

@inline
export function isLiteralTrue(dae: DaeBuilder, exprId: u32): bool {
  if (exprId >= dae.exprCount) return false;
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  if (e.kind == ExprKind.BoolLiteral || e.kind == ExprKind.IntLiteral) return e.intValue != 0;
  if (e.kind == ExprKind.RealLiteral) return e.realValue != 0.0;
  return false;
}

@inline
export function isLiteralFalse(dae: DaeBuilder, exprId: u32): bool {
  if (exprId >= dae.exprCount) return false;
  let e = ExprAccessor.at(dae.getExprData(), exprId);
  if (e.kind == ExprKind.BoolLiteral || e.kind == ExprKind.IntLiteral) return e.intValue == 0;
  if (e.kind == ExprKind.RealLiteral) return e.realValue == 0.0;
  return false;
}

/**
 * Evaluates an expression node in linear memory to a constant scalar if possible.
 * Uses ExprAccessor and VarAccessor for all field access — no raw SoA arithmetic.
 */
export function evalConstantExpr(dae: DaeBuilder, exprId: u32, visitedDepth: i32 = 0, useVarIds: i32 = -1): EvalResult {
  if (exprId >= dae.exprCount || visitedDepth > 100) {
    staticResult.isConstant = false;
    return staticResult;
  }
  if (useVarIds < 0) {
    useVarIds = daeUsesVarIds(dae) ? 1 : 0;
  }

  let e = ExprAccessor.at(dae.getExprData(), exprId);
  let kind = e.kind;
  let data1u = e.data1u;
  let left = e.left;
  let right = e.right;
  let unaryOp = e.unaryOp;
  let binOp = e.binOp;
  let funcId = e.funcId as i32;

  if (kind == ExprKind.RealLiteral) {
    staticResult.isConstant = true;
    staticResult.valReal    = e.realValue;
    staticResult.valInt     = staticResult.valReal as i32;
    staticResult.valBool    = staticResult.valReal != 0.0;
    staticResult.valType    = 0;
    return staticResult;
  }

  if (kind == ExprKind.IntLiteral) {
    staticResult.isConstant = true;
    staticResult.valInt     = e.intValue;
    staticResult.valReal    = staticResult.valInt as f64;
    staticResult.valBool    = staticResult.valInt != 0;
    staticResult.valType    = 1;
    return staticResult;
  }

  if (kind == ExprKind.BoolLiteral) {
    staticResult.isConstant = true;
    staticResult.valBool    = e.intValue != 0;
    staticResult.valInt     = staticResult.valBool ? 1 : 0;
    staticResult.valReal    = staticResult.valBool ? 1.0 : 0.0;
    staticResult.valType    = 2;
    return staticResult;
  }

  if (kind == ExprKind.Name) {
    let resolved = resolveNameExprToVarId(dae, data1u, useVarIds != 0);
    if (resolved >= 0 && (resolved as u32) < dae.varCount) {
      let varId = resolved as u32;
      let v = VarAccessor.at(dae.getVarData(), varId);
      if (v.variability == Variability.Constant || v.variability == Variability.Parameter) {
        let startVal = dae.getVarStartValue(varId);
        // If startVal is still 0.0, check if an explicit binding expression is present
        if (startVal == 0.0 && visitedDepth < 50) {
          let bindingExpr = dae.getVarAttrExpr(varId, VarAttrKind.Binding as u32);
          if (bindingExpr == 0xffffffff) {
            bindingExpr = dae.getVarAttrExpr(varId, VarAttrKind.Start as u32);
          }
          if (bindingExpr != 0xffffffff && bindingExpr != exprId) {
            let bRes = evalConstantExpr(dae, bindingExpr, visitedDepth + 1, useVarIds);
            if (bRes.isConstant) {
              dae.setVarStartValue(varId, bRes.valReal);
              return bRes;
            }
          }
        }
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

  if (kind == ExprKind.Negate) {
    let res = evalConstantExpr(dae, left, visitedDepth + 1, useVarIds);
    if (!res.isConstant) return res;
    staticResult.isConstant = true;
    staticResult.valReal    = -res.valReal;
    staticResult.valInt     = -res.valInt;
    staticResult.valBool    = res.valBool;
    staticResult.valType    = res.valType;
    return staticResult;
  }

  if (kind == ExprKind.Unary) {
    let res = evalConstantExpr(dae, left, visitedDepth + 1, useVarIds);
    if (!res.isConstant) return res;

    if (unaryOp == UnaryOp.Not) {
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

  if (kind == ExprKind.Binary) {
    let op = binOp;

    let resLeft = evalConstantExpr(dae, left, visitedDepth + 1, useVarIds);
    if (!resLeft.isConstant) { staticResult.isConstant = false; return staticResult; }
    let vL_Real = resLeft.valReal;
    let vL_Int  = resLeft.valInt;
    let vL_Bool = resLeft.valBool;
    let vL_Type = resLeft.valType;

    let resRight = evalConstantExpr(dae, right, visitedDepth + 1, useVarIds);
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

  if (kind == ExprKind.IfElse) {
    let condRes = evalConstantExpr(dae, data1u, visitedDepth + 1, useVarIds);
    if (condRes.isConstant) {
      let branchId = condRes.valBool ? left : right;
      return evalConstantExpr(dae, branchId, visitedDepth + 1, useVarIds);
    }
  }

  if (kind == ExprKind.Der) {
    let argRes = evalConstantExpr(dae, left != 0xffffffff ? left : data1u, visitedDepth + 1, useVarIds);
    if (argRes.isConstant) {
      staticResult.isConstant = true;
      staticResult.valReal    = 0.0;
      staticResult.valInt     = 0;
      staticResult.valBool    = false;
      staticResult.valType    = 0;
      return staticResult;
    }
  }

  if (kind == ExprKind.Pre) {
    return evalConstantExpr(dae, left != 0xffffffff ? left : data1u, visitedDepth + 1, useVarIds);
  }

  if (kind == ExprKind.Call) {
    funcId = dae.resolveBuiltinMathFunc(funcId);
    if (funcId < 0) {
      staticResult.isConstant = false;
      return staticResult;
    }
    let firstArgId = left;
    let argCount   = right;

    if (argCount >= 1) {
      let res1 = evalConstantExpr(dae, firstArgId, visitedDepth + 1, useVarIds);
      if (res1.isConstant) {
        let arg1_val: f64 = res1.valReal;
        let res2_val: f64 = 0.0;
        if (argCount >= 2) {
          let secondArgId = dae.getCallArgExprId(exprId, 1);
          let res2 = evalConstantExpr(dae, secondArgId, visitedDepth + 1, useVarIds);
          if (!res2.isConstant) { staticResult.isConstant = false; return staticResult; }
          res2_val = res2.valReal;
        }
        staticResult.isConstant = true;
        if (funcId == BuiltinMathFunc.NoEvent || funcId == BuiltinMathFunc.Homotopy) {
          staticResult.valReal = arg1_val;
        } else if (funcId == BuiltinMathFunc.Smooth) {
          staticResult.valReal = res2_val;
        } else {
          staticResult.valReal = evalMathBuiltin(funcId, arg1_val, res2_val);
        }
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
// Algebraic Simplification & Identity Reductions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively simplifies an algebraic expression in the arena using constant folding,
 * parameter substitution, branch pruning for IfElse, and identity rewrite rules.
 */
export function simplifyAlgebraicExpr(dae: DaeBuilder, exprId: u32, onlyConstants: bool = true, depth: i32 = 0): u32 {
  if (exprId >= dae.exprCount || depth > 100) return exprId;

  let e = ExprAccessor.at(dae.getExprData(), exprId);
  let kind = e.kind;

  // 1. Literal nodes are already maximally simplified
  if (e.isLiteral) return exprId;

  // 2. Fast-path: try constant evaluation on the whole subexpression
  let constRes = evalConstantExpr(dae, exprId, depth);
  if (constRes.isConstant) {
    if (constRes.valType == 1) return dae.addIntLiteral(constRes.valInt);
    if (constRes.valType == 2) return dae.addBoolLiteral(constRes.valBool);
    return dae.addRealLiteral(constRes.valReal);
  }

  // 3. Name expression substitution
  if (kind == ExprKind.Name) {
    let resolved = resolveNameExprToVarId(dae, e.data1u, daeUsesVarIds(dae));
    if (resolved >= 0 && (resolved as u32) < dae.varCount) {
      let varId = resolved as u32;
      let v = VarAccessor.at(dae.getVarData(), varId);
      let canSubstitute = (v.variability == Variability.Constant);
      if (!canSubstitute && !onlyConstants) {
        canSubstitute = (v.variability == Variability.Parameter);
      }
      if (!canSubstitute && (dae.getVarData().get(varId * VAR_STRIDE + VAR_FLAGS) & FLAG_VAR_FINAL) != 0) {
        canSubstitute = (v.variability == Variability.Parameter);
      }
      if (canSubstitute) {
        let val = dae.getVarStartValue(varId);
        if (v.varType == VarType.Integer) return dae.addIntLiteral(val as i32);
        if (v.varType == VarType.Boolean) return dae.addBoolLiteral(val != 0.0);
        return dae.addRealLiteral(val);
      }
    }
    return exprId;
  }

  // 4. Negate / Unary Negate
  if (kind == ExprKind.Negate || (kind == ExprKind.Unary && e.unaryOp == UnaryOp.Negate)) {
    let leftSub = simplifyAlgebraicExpr(dae, e.left, onlyConstants, depth + 1);
    if (cas_isConstant(dae, leftSub)) {
      return dae.addRealLiteral(-cas_getRealValue(dae, leftSub));
    }
    let leftAcc = ExprAccessor.at(dae.getExprData(), leftSub);
    if (leftAcc.kind == ExprKind.Negate || (leftAcc.kind == ExprKind.Unary && leftAcc.unaryOp == UnaryOp.Negate)) {
      return leftAcc.left; // -(-x) -> x
    }
    if (leftSub != e.left) {
      return dae.addExpression(ExprKind.Negate, 0, leftSub, 0xffffffff);
    }
    return exprId;
  }

  // 5. Unary Not
  if (kind == ExprKind.Unary && e.unaryOp == UnaryOp.Not) {
    let leftSub = simplifyAlgebraicExpr(dae, e.left, onlyConstants, depth + 1);
    let leftAcc = ExprAccessor.at(dae.getExprData(), leftSub);
    if (leftAcc.kind == ExprKind.BoolLiteral) {
      return dae.addBoolLiteral(leftAcc.intValue == 0);
    }
    if (leftAcc.kind == ExprKind.Unary && leftAcc.unaryOp == UnaryOp.Not) {
      return leftAcc.left; // not not x -> x
    }
    if (leftSub != e.left) {
      return dae.addExpression(ExprKind.Unary, UnaryOp.Not, leftSub, 0xffffffff);
    }
    return exprId;
  }

  // 6. Binary Operators
  if (kind == ExprKind.Binary) {
    let op = e.binOp;
    let leftSub = simplifyAlgebraicExpr(dae, e.left, onlyConstants, depth + 1);
    let rightSub = simplifyAlgebraicExpr(dae, e.right, onlyConstants, depth + 1);

    let lAcc = ExprAccessor.at(dae.getExprData(), leftSub);
    let rAcc = ExprAccessor.at(dae.getExprData(), rightSub);

    // Constant folding if both are constants
    if (cas_isConstant(dae, leftSub) && cas_isConstant(dae, rightSub)) {
      let isInt = (lAcc.kind == ExprKind.IntLiteral && rAcc.kind == ExprKind.IntLiteral);
      if (isInt && op != BinOp.Div && op != BinOp.Pow) {
        let iL = lAcc.intValue;
        let iR = rAcc.intValue;
        if (op == BinOp.Add) return dae.addIntLiteral(iL + iR);
        if (op == BinOp.Sub) return dae.addIntLiteral(iL - iR);
        if (op == BinOp.Mul) return dae.addIntLiteral(iL * iR);
        if (op == BinOp.Eq)  return dae.addBoolLiteral(iL == iR);
        if (op == BinOp.Neq) return dae.addBoolLiteral(iL != iR);
        if (op == BinOp.Lt)  return dae.addBoolLiteral(iL < iR);
        if (op == BinOp.Lte) return dae.addBoolLiteral(iL <= iR);
        if (op == BinOp.Gt)  return dae.addBoolLiteral(iL > iR);
        if (op == BinOp.Gte) return dae.addBoolLiteral(iL >= iR);
      } else {
        let vL = cas_getRealValue(dae, leftSub);
        let vR = cas_getRealValue(dae, rightSub);
        if (op == BinOp.Add) return dae.addRealLiteral(vL + vR);
        if (op == BinOp.Sub) return dae.addRealLiteral(vL - vR);
        if (op == BinOp.Mul) return dae.addRealLiteral(vL * vR);
        if (op == BinOp.Div && vR != 0.0) return dae.addRealLiteral(vL / vR);
        if (op == BinOp.Pow) return dae.addRealLiteral(Math.pow(vL, vR));
        if (op == BinOp.Eq)  return dae.addBoolLiteral(vL == vR);
        if (op == BinOp.Neq) return dae.addBoolLiteral(vL != vR);
        if (op == BinOp.Lt)  return dae.addBoolLiteral(vL < vR);
        if (op == BinOp.Lte) return dae.addBoolLiteral(vL <= vR);
        if (op == BinOp.Gt)  return dae.addBoolLiteral(vL > vR);
        if (op == BinOp.Gte) return dae.addBoolLiteral(vL >= vR);
      }
    }

    if (lAcc.kind == ExprKind.BoolLiteral && rAcc.kind == ExprKind.BoolLiteral) {
      let bL = lAcc.intValue != 0;
      let bR = rAcc.intValue != 0;
      if (op == BinOp.And) return dae.addBoolLiteral(bL && bR);
      if (op == BinOp.Or)  return dae.addBoolLiteral(bL || bR);
      if (op == BinOp.Eq)  return dae.addBoolLiteral(bL == bR);
      if (op == BinOp.Neq) return dae.addBoolLiteral(bL != bR);
    }

    // Algebraic identity reductions
    if (op == BinOp.Mul) {
      if (cas_isZero(dae, leftSub) || cas_isZero(dae, rightSub)) {
        return (lAcc.kind == ExprKind.IntLiteral && rAcc.kind == ExprKind.IntLiteral)
          ? dae.addIntLiteral(0)
          : dae.addRealLiteral(0.0);
      }
      if (cas_isOne(dae, leftSub))  return rightSub;
      if (cas_isOne(dae, rightSub)) return leftSub;
      if (isLiteralMinusOne(dae, leftSub))  return dae.addExpression(ExprKind.Negate, 0, rightSub, 0xffffffff);
      if (isLiteralMinusOne(dae, rightSub)) return dae.addExpression(ExprKind.Negate, 0, leftSub, 0xffffffff);
    } else if (op == BinOp.Add) {
      if (cas_isZero(dae, leftSub))  return rightSub;
      if (cas_isZero(dae, rightSub)) return leftSub;
      if (lAcc.kind == ExprKind.Negate || (lAcc.kind == ExprKind.Unary && lAcc.unaryOp == UnaryOp.Negate)) {
        return dae.addBinaryExpr(BinOp.Sub as u16, rightSub, lAcc.left);
      }
      if (rAcc.kind == ExprKind.Negate || (rAcc.kind == ExprKind.Unary && rAcc.unaryOp == UnaryOp.Negate)) {
        return dae.addBinaryExpr(BinOp.Sub as u16, leftSub, rAcc.left);
      }
    } else if (op == BinOp.Sub) {
      if (cas_isZero(dae, rightSub)) return leftSub;
      if (cas_isZero(dae, leftSub))  return dae.addExpression(ExprKind.Negate, 0, rightSub, 0xffffffff);
      if (leftSub == rightSub)       return dae.addRealLiteral(0.0);
    } else if (op == BinOp.Div) {
      if (cas_isZero(dae, leftSub))  return dae.addRealLiteral(0.0);
      if (cas_isOne(dae, rightSub))  return leftSub;
      if (leftSub == rightSub)       return dae.addRealLiteral(1.0);
    } else if (op == BinOp.Pow) {
      if (cas_isZero(dae, rightSub)) return dae.addRealLiteral(1.0);
      if (cas_isOne(dae, rightSub))  return leftSub;
    } else if (op == BinOp.And) {
      if (isLiteralFalse(dae, leftSub) || isLiteralFalse(dae, rightSub)) return dae.addBoolLiteral(false);
      if (isLiteralTrue(dae, leftSub))  return rightSub;
      if (isLiteralTrue(dae, rightSub)) return leftSub;
    } else if (op == BinOp.Or) {
      if (isLiteralTrue(dae, leftSub) || isLiteralTrue(dae, rightSub)) return dae.addBoolLiteral(true);
      if (isLiteralFalse(dae, leftSub))  return rightSub;
      if (isLiteralFalse(dae, rightSub)) return leftSub;
    }

    if (leftSub != e.left || rightSub != e.right) {
      return dae.addBinaryExpr(op as u16, leftSub, rightSub);
    }
    return exprId;
  }

  // 7. IfElse condition pruning
  if (kind == ExprKind.IfElse) {
    let condSub = simplifyAlgebraicExpr(dae, e.data1u, onlyConstants, depth + 1);
    let cAcc = ExprAccessor.at(dae.getExprData(), condSub);
    if (cAcc.kind == ExprKind.BoolLiteral || cAcc.kind == ExprKind.IntLiteral) {
      let takeThen = cAcc.intValue != 0;
      return simplifyAlgebraicExpr(dae, takeThen ? e.left : e.right, onlyConstants, depth + 1);
    }
    let thenSub = simplifyAlgebraicExpr(dae, e.left, onlyConstants, depth + 1);
    let elseSub = simplifyAlgebraicExpr(dae, e.right, onlyConstants, depth + 1);
    if (thenSub == elseSub) return thenSub;
    if (condSub != e.data1u || thenSub != e.left || elseSub != e.right) {
      return dae.addIfElse(condSub, thenSub, elseSub);
    }
    return exprId;
  }

  // 8. Der(c) -> 0.0
  if (kind == ExprKind.Der) {
    let argId = e.left != 0xffffffff ? e.left : e.data1u;
    let argSub = simplifyAlgebraicExpr(dae, argId, onlyConstants, depth + 1);
    let aAcc = ExprAccessor.at(dae.getExprData(), argSub);
    if (aAcc.isNumericLiteral) return dae.addRealLiteral(0.0);
    if (aAcc.kind == ExprKind.Name) {
      let resolved = resolveNameExprToVarId(dae, aAcc.data1u, daeUsesVarIds(dae));
      if (resolved >= 0 && (resolved as u32) < dae.varCount) {
        let v = VarAccessor.at(dae.getVarData(), resolved as u32);
        if (v.variability == Variability.Constant || v.variability == Variability.Parameter) {
          return dae.addRealLiteral(0.0);
        }
      }
    }
    if (argSub != argId) return dae.addDerExpr(argSub);
    return exprId;
  }

  // 9. Pre(c)
  if (kind == ExprKind.Pre) {
    let argId = e.left != 0xffffffff ? e.left : e.data1u;
    let argSub = simplifyAlgebraicExpr(dae, argId, onlyConstants, depth + 1);
    if (argSub != argId) return dae.addPreExpr(argSub);
    return exprId;
  }

  // 10. Call: simplify arguments
  if (kind == ExprKind.Call) {
    let argCount = e.right;
    if (argCount == 1) {
      let arg0 = dae.getCallArgExprId(exprId, 0);
      let simpArg0 = simplifyAlgebraicExpr(dae, arg0, onlyConstants, depth + 1);
      if (simpArg0 != arg0) {
        return dae.addCall(e.data1, simpArg0, 1);
      }
    }
    return exprId;
  }

  return exprId;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAE-level Constant Folding & Simplification Pass
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Iteratively folds constant and parameter expressions across the entire DAE.
 * Continues until a fixed point is reached or maximum iterations are exceeded.
 * Uses VarAccessor and EqAccessor to eliminate raw SoA arithmetic.
 */
export function foldDaeConstants(dae: DaeBuilder, maxIterations: u32 = 100, omcCompatibility: bool = false): u32 {
  let changed    = true;
  let iterations: u32 = 0;
  let useVarIds  = daeUsesVarIds(dae);
  let useVarIdsFlag: i32 = useVarIds ? 1 : 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Pass 1: Propagate constant/parameter start values from binding attributes
    for (let varIdx: u32 = 0; varIdx < dae.varCount; varIdx++) {
      if (dae.isVarRemoved(varIdx)) continue;
      let v = VarAccessor.at(dae.getVarData(), varIdx);
      if (v.variability != Variability.Constant && v.variability != Variability.Parameter) continue;

      let bindingExpr = dae.getVarAttrExpr(varIdx, VarAttrKind.Binding as u32);
      if (bindingExpr == 0xffffffff) {
        bindingExpr = dae.getVarAttrExpr(varIdx, VarAttrKind.Start as u32);
      }
      if (bindingExpr != 0xffffffff && bindingExpr < dae.exprCount) {
        let evalRes = evalConstantExpr(dae, bindingExpr, 0, useVarIdsFlag);
        if (evalRes.isConstant) {
          let oldStart = dae.getVarStartValue(varIdx);
          if (oldStart != evalRes.valReal) {
            dae.setVarStartValue(varIdx, evalRes.valReal);
            changed = true;
          }
          let litId: u32 = evalRes.valType == 1
            ? dae.addIntLiteral(evalRes.valInt)
            : evalRes.valType == 2
              ? dae.addBoolLiteral(evalRes.valBool)
              : dae.addRealLiteral(evalRes.valReal);
          if (litId != bindingExpr) {
            dae.setVarAttrExpr(varIdx, VarAttrKind.Binding as u32, litId);
            dae.setVarAttrExpr(varIdx, VarAttrKind.Start as u32, litId);
            changed = true;
          }
        }
      }
    }

    // Pass 2: Propagate constant/parameter start values from simple binding equations
    for (let eqIdx: u32 = 0; eqIdx < dae.eqCount; eqIdx++) {
      let eq = EqAccessor.at(dae.getEqData(), eqIdx);
      if (!eq.isSimple) continue;

      let lhsId = eq.lhs;
      let rhsId = eq.rhs;
      if (lhsId < dae.exprCount) {
        let lhsExpr = ExprAccessor.at(dae.getExprData(), lhsId);
        if (lhsExpr.isName) {
          let targetVar = resolveNameExprToVarId(dae, lhsExpr.varId, useVarIds);
          if (targetVar >= 0 && (targetVar as u32) < dae.varCount) {
            let vIdx = targetVar as u32;
            let v = VarAccessor.at(dae.getVarData(), vIdx);
            if (v.variability == Variability.Constant || v.variability == Variability.Parameter) {
              let evalRes = evalConstantExpr(dae, rhsId, 0, useVarIdsFlag);
              if (evalRes.isConstant) {
                let oldStart = dae.getVarStartValue(vIdx);
                if (oldStart != evalRes.valReal) {
                  dae.setVarStartValue(vIdx, evalRes.valReal);
                  changed = true;
                }
              }
            }
          }
        }
      }
    }
  }

  // Pass 3: Once parameter and constant values have converged, simplify all equations
  let onlyConstants = omcCompatibility;
  for (let eqIdx: u32 = 0; eqIdx < dae.eqCount; eqIdx++) {
    if (dae.isEqRemoved(eqIdx)) continue;
    let eq = EqAccessor.at(dae.getEqData(), eqIdx);
    if (!eq.isSimple && eq.kind != EqKind.InitialSimple && eq.kind != EqKind.Array) continue;

    let lhsId = eq.lhs;
    let rhsId = eq.rhs;

    if (rhsId < dae.exprCount) {
      let simpRhs = simplifyAlgebraicExpr(dae, rhsId, onlyConstants);
      if (simpRhs != rhsId) {
        EqAccessor.at(dae.getEqData(), eqIdx).rhs = simpRhs;
      }
    }

    if (lhsId < dae.exprCount) {
      let simpLhs = simplifyAlgebraicExpr(dae, lhsId, onlyConstants);
      if (simpLhs != lhsId) {
        EqAccessor.at(dae.getEqData(), eqIdx).lhs = simpLhs;
      }
    }

    // Remove trivial self-equations (x = x) introduced by constant folding
    if (!dae.isEqInitial(eqIdx) && eq.isSimple) {
      let curLhs = eq.lhs;
      let curRhs = eq.rhs;
      if (curLhs == curRhs) {
        dae.setEqRemoved(eqIdx, true);
      }
    }
  }

  return iterations;
}

// ─────────────────────────────────────────────────────────────────────────────
// WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function dae_foldConstants(daePtr: u32, maxIterations: u32): u32 {
  return foldDaeConstants(changetype<DaeBuilder>(daePtr), maxIterations, false);
}

export function dae_foldConstantsEx(daePtr: u32, maxIterations: u32, omcCompatibility: bool): u32 {
  return foldDaeConstants(changetype<DaeBuilder>(daePtr), maxIterations, omcCompatibility);
}

export function dae_simplifyAlgebraicExpr(daePtr: u32, exprId: u32, onlyConstants: bool): u32 {
  return simplifyAlgebraicExpr(changetype<DaeBuilder>(daePtr), exprId, onlyConstants);
}

export function dae_evalExpressionAsReal(daePtr: u32, exprId: u32): f64 {
  let res = evalConstantExpr(changetype<DaeBuilder>(daePtr), exprId);
  return res.isConstant ? res.valReal : 0.0;
}

export function dae_evalExpressionAsInt(daePtr: u32, exprId: u32): i32 {
  let res = evalConstantExpr(changetype<DaeBuilder>(daePtr), exprId);
  return res.isConstant ? res.valInt : 0;
}
