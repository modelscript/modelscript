// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Symbolic differentiation routines and built-in `ModelScript.CAS` package source.
 */

import type { WasmDaeEquations } from "./equations.js";
import { getNumericLiteralValue } from "./simplify.js";
import { BinOp, ExprKind, UnaryOp } from "./types.js";

/**
 * Symbolically differentiates an arena expression (`exprId`) with respect to a single variable
 * (name string or interned `StringId`) or computes the total time derivative with respect to a
 * set of time-varying variable `StringId`s.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID to differentiate.
 * @param wrt - Variable name, interned `StringId`, or set of time-varying `StringId`s.
 * @returns Differentiated expression arena ID.
 */
export function differentiateArenaExpression(
  arena: WasmDaeEquations,
  exprId: number,
  wrt: string | number | Set<number>,
): number {
  if (typeof wrt === "string") {
    return differentiateArenaExpressionWrt(arena, exprId, arena.interner.intern(wrt));
  } else if (typeof wrt === "number") {
    return differentiateArenaExpressionWrt(arena, exprId, wrt);
  } else {
    return differentiateArenaExpressionWrtSet(arena, exprId, wrt);
  }
}

/**
 * Retrieves the expression arena ID of the second argument of a function call node (`exprId`).
 */
function getCallSecondArgId(arena: WasmDaeEquations, exprId: number, firstArgId: number): number {
  if (exprId + 1 < arena.exprCount && arena.getExprKind(exprId + 1) === ExprKind.Tuple) {
    return arena.getExprLeft(exprId + 1);
  }
  const right = arena.getExprRight(exprId);
  if (right >= 0 && right < exprId && !(right === 2 && exprId === firstArgId + 2)) {
    return right;
  }
  return firstArgId + 1 < arena.exprCount ? firstArgId + 1 : right;
}

/**
 * Retrieves the expression arena ID of the third argument of a function call node (`exprId`).
 */
function getCallThirdArgId(arena: WasmDaeEquations, exprId: number, firstArgId: number): number {
  if (exprId + 2 < arena.exprCount && arena.getExprKind(exprId + 2) === ExprKind.Tuple) {
    return arena.getExprLeft(exprId + 2);
  }
  return firstArgId + 2 < arena.exprCount ? firstArgId + 2 : arena.getExprLeft(exprId + 2);
}

/**
 * Reconstructs the canonical string name and intermediate interned `StringId`s for a `Name`,
 * `Subscript`, or `Der` expression node during symbolic differentiation.
 */
function formatArenaDerOrSubscriptName(
  arena: WasmDaeEquations,
  exprId: number,
): { fullName: string; baseNameId: number; intermediateNameIds: number[] } | null {
  if (exprId < 0 || exprId >= arena.exprCount) return null;
  const kind = arena.getExprKind(exprId);
  if (kind === ExprKind.Name) {
    const nameId = arena.getExprData1(exprId);
    const name = arena.interner.resolve(nameId);
    if (!name) return null;
    return { fullName: name, baseNameId: nameId, intermediateNameIds: [nameId] };
  }
  if (kind === ExprKind.Subscript) {
    const baseId = arena.getExprData1(exprId);
    const subCount = arena.getExprRight(exprId);
    const baseInfo = formatArenaDerOrSubscriptName(arena, baseId);
    if (!baseInfo) return null;
    const subStrs: string[] = [];
    for (let i = 0; i < subCount; i++) {
      const sId = i === 0 ? arena.getExprLeft(exprId) : arena.getExprLeft(exprId + i);
      if (sId < 0) continue;
      const sk = arena.getExprKind(sId);
      if (sk === ExprKind.IntLiteral) {
        subStrs.push(String(arena.getExprData1(sId)));
      } else if (sk === ExprKind.RealLiteral) {
        subStrs.push(String(arena.getExprRealValue(sId)));
      } else if (sk === ExprKind.Name) {
        subStrs.push(arena.interner.resolve(arena.getExprData1(sId)) ?? "");
      } else {
        const subInfo = formatArenaDerOrSubscriptName(arena, sId);
        if (subInfo) subStrs.push(subInfo.fullName);
      }
    }
    const subName = `${baseInfo.fullName}[${subStrs.join(",")}]`;
    const subNameId = arena.interner.intern(subName);
    const ids = [...baseInfo.intermediateNameIds, subNameId];
    if (subStrs.length > 1) {
      ids.push(arena.interner.intern(`${baseInfo.fullName}[${subStrs.join(", ")}]`));
    }
    return { fullName: subName, baseNameId: baseInfo.baseNameId, intermediateNameIds: ids };
  }
  if (kind === ExprKind.Der) {
    const innerId = arena.getExprData1(exprId);
    const innerInfo = formatArenaDerOrSubscriptName(arena, innerId);
    if (!innerInfo) return null;
    const derName = `der(${innerInfo.fullName})`;
    const derNameId = arena.interner.intern(derName);
    return {
      fullName: derName,
      baseNameId: innerInfo.baseNameId,
      intermediateNameIds: [...innerInfo.intermediateNameIds, derNameId],
    };
  }
  return null;
}

function isZeroLiteral(arena: WasmDaeEquations, exprId: number): boolean {
  const val = getNumericLiteralValue(arena, exprId);
  return val === 0;
}

/**
 * Applies the chain rule to differentiate a built-in mathematical or Modelica intrinsic
 * function call node (`exprId`) using the provided recursive child differentiation callback `diffFn`.
 */
function differentiateCallCommon(arena: WasmDaeEquations, exprId: number, diffFn: (childId: number) => number): number {
  const rawName = arena.getExprFuncName(exprId);
  const funcName = rawName.replace(/^(Modelica\.(Math|ComplexMath)\.|Math\.)/, "");
  const argCount = arena.getExprRight(exprId);
  const firstArgId = arena.getExprLeft(exprId);

  if (
    (funcName === "noEvent" ||
      funcName === "/*Real*/" ||
      funcName === "/*Integer*/" ||
      funcName === "/*Boolean*/" ||
      funcName === "Real") &&
    argCount >= 1
  ) {
    return diffFn(firstArgId);
  }
  if (
    funcName === "sign" ||
    funcName === "floor" ||
    funcName === "ceil" ||
    funcName === "integer" ||
    funcName === "Integer" ||
    funcName === "div"
  ) {
    return arena.addRealLiteral(0.0);
  }
  if ((funcName === "mod" || funcName === "rem" || funcName === "fmod") && argCount >= 1) {
    const dx = diffFn(firstArgId);
    if (argCount >= 2) {
      const yId = getCallSecondArgId(arena, exprId, firstArgId);
      const dy = diffFn(yId);
      if (!isZeroLiteral(arena, dy)) {
        const floorXY = arena.addCallExpr("floor", [arena.addBinaryExpr(BinOp.Div, firstArgId, yId)]);
        return arena.addBinaryExpr(BinOp.Sub, dx, arena.addBinaryExpr(BinOp.Mul, floorXY, dy));
      }
    }
    return dx;
  }
  if (funcName === "smooth" && argCount >= 2) {
    return diffFn(getCallSecondArgId(arena, exprId, firstArgId));
  }
  if (funcName === "homotopy" && argCount >= 2) {
    const dActual = diffFn(firstArgId);
    const secondArgId = getCallSecondArgId(arena, exprId, firstArgId);
    const dSimplified = diffFn(secondArgId);
    return arena.addCallExpr("homotopy", [dActual, dSimplified]);
  }
  if (funcName === "min" && argCount >= 2) {
    const aId = firstArgId;
    const bId = getCallSecondArgId(arena, exprId, firstArgId);
    const da = diffFn(aId);
    const db = diffFn(bId);
    const cond = arena.addBinaryExpr(BinOp.Lt, aId, bId);
    return arena.addIfElse(cond, da, db);
  }
  if (funcName === "max" && argCount >= 2) {
    const aId = firstArgId;
    const bId = getCallSecondArgId(arena, exprId, firstArgId);
    const da = diffFn(aId);
    const db = diffFn(bId);
    const cond = arena.addBinaryExpr(BinOp.Gt, aId, bId);
    return arena.addIfElse(cond, da, db);
  }
  if (funcName === "semiLinear" && argCount >= 3) {
    const xId = firstArgId;
    const kPosId = getCallSecondArgId(arena, exprId, firstArgId);
    const kNegId = getCallThirdArgId(arena, exprId, firstArgId);
    const dx = diffFn(xId);
    const dkPos = diffFn(kPosId);
    const dkNeg = diffFn(kNegId);
    const cond = arena.addBinaryExpr(BinOp.Gte, xId, arena.addRealLiteral(0.0));
    let posBranch = arena.addBinaryExpr(BinOp.Mul, kPosId, dx);
    if (!isZeroLiteral(arena, dkPos)) {
      posBranch = arena.addBinaryExpr(BinOp.Add, posBranch, arena.addBinaryExpr(BinOp.Mul, xId, dkPos));
    }
    let negBranch = arena.addBinaryExpr(BinOp.Mul, kNegId, dx);
    if (!isZeroLiteral(arena, dkNeg)) {
      negBranch = arena.addBinaryExpr(BinOp.Add, negBranch, arena.addBinaryExpr(BinOp.Mul, xId, dkNeg));
    }
    return arena.addIfElse(cond, posBranch, negBranch);
  }
  if (funcName === "pow" && argCount >= 2) {
    const left = firstArgId;
    const right = getCallSecondArgId(arena, exprId, firstArgId);
    const dLeft = diffFn(left);
    const dRight = diffFn(right);
    const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
    const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
    const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
    const term1 = arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
    if (arena.getExprKind(dRight) === ExprKind.RealLiteral && arena.getExprRealValue(dRight) === 0) {
      return term1;
    }
    const u_pow_v = arena.addBinaryExpr(BinOp.Pow, left, right);
    const ln_u = arena.addCallExpr("log", [left]);
    const term2 = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, u_pow_v, ln_u), dRight);
    return arena.addBinaryExpr(BinOp.Add, term1, term2);
  }
  if (funcName === "sin" && argCount === 1) {
    const du = diffFn(firstArgId);
    const cosU = arena.addCallExpr("cos", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, cosU, du);
  }
  if (funcName === "cos" && argCount === 1) {
    const du = diffFn(firstArgId);
    const sinU = arena.addCallExpr("sin", [firstArgId]);
    const negSinU = arena.addExpression(ExprKind.Negate, 0, sinU);
    return arena.addBinaryExpr(BinOp.Mul, negSinU, du);
  }
  if (funcName === "tan" && argCount === 1) {
    const du = diffFn(firstArgId);
    const cosU = arena.addCallExpr("cos", [firstArgId]);
    const cos2U = arena.addBinaryExpr(BinOp.Mul, cosU, cosU);
    return arena.addBinaryExpr(BinOp.Div, du, cos2U);
  }
  if (funcName === "asin" && argCount === 1) {
    const du = diffFn(firstArgId);
    const u2 = arena.addBinaryExpr(BinOp.Mul, firstArgId, firstArgId);
    const oneMinusU2 = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), u2);
    const denom = arena.addCallExpr("sqrt", [oneMinusU2]);
    return arena.addBinaryExpr(BinOp.Div, du, denom);
  }
  if (funcName === "acos" && argCount === 1) {
    const du = diffFn(firstArgId);
    const u2 = arena.addBinaryExpr(BinOp.Mul, firstArgId, firstArgId);
    const oneMinusU2 = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), u2);
    const denom = arena.addCallExpr("sqrt", [oneMinusU2]);
    return arena.addExpression(ExprKind.Negate, 0, arena.addBinaryExpr(BinOp.Div, du, denom));
  }
  if (funcName === "atan" && argCount === 1) {
    const du = diffFn(firstArgId);
    const u2 = arena.addBinaryExpr(BinOp.Mul, firstArgId, firstArgId);
    const denom = arena.addBinaryExpr(BinOp.Add, arena.addRealLiteral(1.0), u2);
    return arena.addBinaryExpr(BinOp.Div, du, denom);
  }
  if (funcName === "atan2" && argCount >= 2) {
    const yId = firstArgId;
    const xId = getCallSecondArgId(arena, exprId, firstArgId);
    const dy = diffFn(yId);
    const dx = diffFn(xId);
    const xDy = arena.addBinaryExpr(BinOp.Mul, xId, dy);
    const yDx = arena.addBinaryExpr(BinOp.Mul, yId, dx);
    const num = arena.addBinaryExpr(BinOp.Sub, xDy, yDx);
    const x2 = arena.addBinaryExpr(BinOp.Mul, xId, xId);
    const y2 = arena.addBinaryExpr(BinOp.Mul, yId, yId);
    const denom = arena.addBinaryExpr(BinOp.Add, x2, y2);
    return arena.addBinaryExpr(BinOp.Div, num, denom);
  }
  if (funcName === "sinh" && argCount === 1) {
    const du = diffFn(firstArgId);
    const coshU = arena.addCallExpr("cosh", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, coshU, du);
  }
  if (funcName === "cosh" && argCount === 1) {
    const du = diffFn(firstArgId);
    const sinhU = arena.addCallExpr("sinh", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, sinhU, du);
  }
  if (funcName === "tanh" && argCount === 1) {
    const du = diffFn(firstArgId);
    const tanhU = arena.addCallExpr("tanh", [firstArgId]);
    const tanh2U = arena.addBinaryExpr(BinOp.Mul, tanhU, tanhU);
    const sech2U = arena.addBinaryExpr(BinOp.Sub, arena.addRealLiteral(1.0), tanh2U);
    return arena.addBinaryExpr(BinOp.Mul, sech2U, du);
  }
  if (funcName === "exp" && argCount === 1) {
    const du = diffFn(firstArgId);
    const expU = arena.addCallExpr("exp", [firstArgId]);
    return arena.addBinaryExpr(BinOp.Mul, expU, du);
  }
  if (funcName === "log" && argCount === 1) {
    const du = diffFn(firstArgId);
    return arena.addBinaryExpr(BinOp.Div, du, firstArgId);
  }
  if (funcName === "log10" && argCount === 1) {
    const du = diffFn(firstArgId);
    const denom = arena.addBinaryExpr(BinOp.Mul, firstArgId, arena.addRealLiteral(Math.LN10));
    return arena.addBinaryExpr(BinOp.Div, du, denom);
  }
  if (funcName === "sqrt" && argCount === 1) {
    const du = diffFn(firstArgId);
    const twoSqrtU = arena.addBinaryExpr(BinOp.Mul, arena.addRealLiteral(2.0), arena.addCallExpr("sqrt", [firstArgId]));
    return arena.addBinaryExpr(BinOp.Div, du, twoSqrtU);
  }
  if (funcName === "abs" && argCount === 1) {
    const du = diffFn(firstArgId);
    const cond = arena.addBinaryExpr(BinOp.Gte, firstArgId, arena.addRealLiteral(0.0));
    const negDu = arena.addExpression(ExprKind.Negate, 0, du);
    return arena.addIfElse(cond, du, negDu);
  }
  return arena.addRealLiteral(0.0);
}

/**
 * Computes the partial derivative $\frac{\partial(\text{exprId})}{\partial(\text{wrtVarId})}$ of an arena
 * expression with respect to a single variable's interned `StringId`.
 *
 * @param arena - Target DAE arena.
 * @param exprId - Root expression arena ID to differentiate.
 * @param wrtVarId - Interned `StringId` of the variable to differentiate with respect to.
 * @returns Differentiated expression arena ID.
 */
export function differentiateArenaExpressionWrt(arena: WasmDaeEquations, exprId: number, wrtVarId: number): number {
  if (exprId < 0) return arena.addRealLiteral(0.0);
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
      return arena.addRealLiteral(0.0);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (nameId === wrtVarId) {
        return arena.addRealLiteral(1.0);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Subscript: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info) {
        const fullNameId = arena.interner.intern(info.fullName);
        if (fullNameId === wrtVarId) {
          return arena.addRealLiteral(1.0);
        }
        const baseName = arena.interner.resolve(info.baseNameId);
        const isScalarizedElemPresent =
          arena.lookupVariable(fullNameId) >= 0 || (baseName ? arena.hasArrayElements(baseName) : false);
        if (!isScalarizedElemPresent && info.baseNameId === wrtVarId) {
          return arena.addRealLiteral(1.0);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info && arena.interner.intern(info.fullName) === wrtVarId) {
        return arena.addRealLiteral(1.0);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrt(arena, operand, wrtVarId));
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      if (op === UnaryOp.Negate) {
        const operand = arena.getExprLeft(exprId);
        return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrt(arena, operand, wrtVarId));
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
        case BinOp.Sub:
        case BinOp.ElemSub: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul:
        case BinOp.ElemMul: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div:
        case BinOp.ElemDiv: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow:
        case BinOp.ElemPow: {
          const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
          const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          const term1 = arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
          if (arena.getExprKind(dRight) === ExprKind.RealLiteral && arena.getExprRealValue(dRight) === 0) {
            return term1;
          }
          const u_pow_v = arena.addBinaryExpr(BinOp.Pow, left, right);
          const ln_u = arena.addCallExpr("log", [left]);
          const term2 = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, u_pow_v, ln_u), dRight);
          return arena.addBinaryExpr(BinOp.Add, term1, term2);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const trueBranch = arena.getExprLeft(exprId);
      const falseBranch = arena.getExprRight(exprId);
      const dTrue = differentiateArenaExpressionWrt(arena, trueBranch, wrtVarId);
      const dFalse = differentiateArenaExpressionWrt(arena, falseBranch, wrtVarId);
      return arena.addIfElse(cond, dTrue, dFalse);
    }

    case ExprKind.Call:
      return differentiateCallCommon(arena, exprId, (childId) =>
        differentiateArenaExpressionWrt(arena, childId, wrtVarId),
      );

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(exprId), wrtVarId));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(baseId + i), wrtVarId));
      }
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(exprId), wrtVarId));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrt(arena, arena.getExprLeft(exprId + i), wrtVarId));
      }
      return arena.addTupleExpr(elems);
    }

    case ExprKind.TensorSlice: {
      const base = arena.getExprData1(exprId);
      const slice = arena.getExprLeft(exprId);
      const axis = arena.getExprRight(exprId);
      const dBase = differentiateArenaExpressionWrt(arena, base, wrtVarId);
      return arena.addTensorSlice(dBase, slice, axis);
    }

    case ExprKind.TensorBroadcast: {
      const op = arena.getExprLeft(exprId);
      const axis = arena.getExprData1(exprId);
      const shape = arena.getExprTensorShape(exprId) ?? [];
      const dOp = differentiateArenaExpressionWrt(arena, op, wrtVarId);
      return arena.addTensorBroadcast(dOp, shape, axis);
    }

    case ExprKind.TensorMatMul: {
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      const flags = arena.getExprData1(exprId);
      const dLeft = differentiateArenaExpressionWrt(arena, left, wrtVarId);
      const dRight = differentiateArenaExpressionWrt(arena, right, wrtVarId);
      const term1 = arena.addTensorMatMul(dLeft, right, flags);
      const term2 = arena.addTensorMatMul(left, dRight, flags);
      return arena.addBinaryExpr(BinOp.Add, term1, term2);
    }

    case ExprKind.TensorReduce: {
      const op = arena.getExprLeft(exprId);
      const redOp = arena.getExprData1(exprId);
      const axis = arena.getExprRight(exprId);
      const dOp = differentiateArenaExpressionWrt(arena, op, wrtVarId);
      return arena.addTensorReduce(dOp, redOp, axis);
    }

    case ExprKind.TensorMap: {
      const op = arena.getExprLeft(exprId);
      const opId = arena.getExprData1(exprId);
      const aux = arena.getExprRight(exprId);
      const dOp = differentiateArenaExpressionWrt(arena, op, wrtVarId);
      return arena.addTensorMap(dOp, opId, aux);
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

/**
 * Total time derivative d(expr)/dt given the set of time-varying state/variable StringIds `wrtVarIds`.
 * By the chain rule, d/dt(x) = der(x) for every x in `wrtVarIds`, and d/dt(time) = 1.0.
 */
function differentiateArenaExpressionWrtSet(arena: WasmDaeEquations, exprId: number, wrtVarIds: Set<number>): number {
  if (exprId < 0) return arena.addRealLiteral(0.0);
  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.IntLiteral:
    case ExprKind.RealLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.StringLiteral:
      return arena.addRealLiteral(0.0);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      const name = arena.interner.resolve(nameId);
      if (name === "time") {
        return arena.addRealLiteral(1.0);
      }
      if (wrtVarIds.has(nameId)) {
        return arena.addDerExpr(exprId);
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Subscript: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info) {
        const fullNameId = arena.interner.intern(info.fullName);
        if (wrtVarIds.has(fullNameId)) {
          return arena.addDerExpr(exprId);
        }
        const baseName = arena.interner.resolve(info.baseNameId);
        const isScalarizedElemPresent =
          arena.lookupVariable(fullNameId) >= 0 || (baseName ? arena.hasArrayElements(baseName) : false);
        if (!isScalarizedElemPresent && info.intermediateNameIds.some((id) => wrtVarIds.has(id))) {
          return arena.addDerExpr(exprId);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Der: {
      const info = formatArenaDerOrSubscriptName(arena, exprId);
      if (info && info.intermediateNameIds.some((id) => wrtVarIds.has(id))) {
        return arena.addDerExpr(exprId);
      }
      const argId = arena.getExprData1(exprId);
      if (argId >= 0) {
        const dArg = differentiateArenaExpressionWrtSet(arena, argId, wrtVarIds);
        if (arena.getExprKind(dArg) !== ExprKind.RealLiteral || arena.getExprRealValue(dArg) !== 0.0) {
          return arena.addDerExpr(exprId);
        }
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Negate: {
      const operand = arena.getExprLeft(exprId);
      return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrtSet(arena, operand, wrtVarIds));
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      if (op === UnaryOp.Negate) {
        const operand = arena.getExprLeft(exprId);
        return arena.addExpression(ExprKind.Negate, 0, differentiateArenaExpressionWrtSet(arena, operand, wrtVarIds));
      }
      return arena.addRealLiteral(0.0);
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
        case BinOp.Sub:
        case BinOp.ElemSub: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          return arena.addBinaryExpr(op, dLeft, dRight);
        }
        case BinOp.Mul:
        case BinOp.ElemMul: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          return arena.addBinaryExpr(BinOp.Add, u_dv, v_du);
        }
        case BinOp.Div:
        case BinOp.ElemDiv: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const v_du = arena.addBinaryExpr(BinOp.Mul, right, dLeft);
          const u_dv = arena.addBinaryExpr(BinOp.Mul, left, dRight);
          const num = arena.addBinaryExpr(BinOp.Sub, v_du, u_dv);
          const den = arena.addBinaryExpr(BinOp.Mul, right, right);
          return arena.addBinaryExpr(BinOp.Div, num, den);
        }
        case BinOp.Pow:
        case BinOp.ElemPow: {
          const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
          const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
          const v_minus_1 = arena.addBinaryExpr(BinOp.Sub, right, arena.addRealLiteral(1.0));
          const u_pow_v_minus_1 = arena.addBinaryExpr(BinOp.Pow, left, v_minus_1);
          const v_mul_u_pow = arena.addBinaryExpr(BinOp.Mul, right, u_pow_v_minus_1);
          const term1 = arena.addBinaryExpr(BinOp.Mul, v_mul_u_pow, dLeft);
          if (arena.getExprKind(dRight) === ExprKind.RealLiteral && arena.getExprRealValue(dRight) === 0) {
            return term1;
          }
          const u_pow_v = arena.addBinaryExpr(BinOp.Pow, left, right);
          const ln_u = arena.addCallExpr("log", [left]);
          const term2 = arena.addBinaryExpr(BinOp.Mul, arena.addBinaryExpr(BinOp.Mul, u_pow_v, ln_u), dRight);
          return arena.addBinaryExpr(BinOp.Add, term1, term2);
        }
        default:
          return arena.addRealLiteral(0.0);
      }
    }

    case ExprKind.IfElse: {
      const cond = arena.getExprData1(exprId);
      const trueBranch = arena.getExprLeft(exprId);
      const falseBranch = arena.getExprRight(exprId);
      const dTrue = differentiateArenaExpressionWrtSet(arena, trueBranch, wrtVarIds);
      const dFalse = differentiateArenaExpressionWrtSet(arena, falseBranch, wrtVarIds);
      return arena.addIfElse(cond, dTrue, dFalse);
    }

    case ExprKind.Call:
      return differentiateCallCommon(arena, exprId, (childId) =>
        differentiateArenaExpressionWrtSet(arena, childId, wrtVarIds),
      );

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const redirect = arena.getExprRight(exprId);
      const baseId = redirect >= 0 && redirect !== 0xffffffff ? redirect : exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(exprId), wrtVarIds));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(baseId + i), wrtVarIds));
      }
      return arena.addArrayCtorExpr(elems);
    }

    case ExprKind.Tuple: {
      const count = arena.getExprData1(exprId);
      if (count <= 0) return exprId;
      const elems: number[] = [];
      elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(exprId), wrtVarIds));
      for (let i = 1; i < count; i++) {
        elems.push(differentiateArenaExpressionWrtSet(arena, arena.getExprLeft(exprId + i), wrtVarIds));
      }
      return arena.addTupleExpr(elems);
    }

    case ExprKind.TensorSlice: {
      const base = arena.getExprData1(exprId);
      const slice = arena.getExprLeft(exprId);
      const axis = arena.getExprRight(exprId);
      const dBase = differentiateArenaExpressionWrtSet(arena, base, wrtVarIds);
      return arena.addTensorSlice(dBase, slice, axis);
    }

    case ExprKind.TensorBroadcast: {
      const op = arena.getExprLeft(exprId);
      const axis = arena.getExprData1(exprId);
      const shape = arena.getExprTensorShape(exprId) ?? [];
      const dOp = differentiateArenaExpressionWrtSet(arena, op, wrtVarIds);
      return arena.addTensorBroadcast(dOp, shape, axis);
    }

    case ExprKind.TensorMatMul: {
      const left = arena.getExprLeft(exprId);
      const right = arena.getExprRight(exprId);
      const flags = arena.getExprData1(exprId);
      const dLeft = differentiateArenaExpressionWrtSet(arena, left, wrtVarIds);
      const dRight = differentiateArenaExpressionWrtSet(arena, right, wrtVarIds);
      const term1 = arena.addTensorMatMul(dLeft, right, flags);
      const term2 = arena.addTensorMatMul(left, dRight, flags);
      return arena.addBinaryExpr(BinOp.Add, term1, term2);
    }

    case ExprKind.TensorReduce: {
      const op = arena.getExprLeft(exprId);
      const redOp = arena.getExprData1(exprId);
      const axis = arena.getExprRight(exprId);
      const dOp = differentiateArenaExpressionWrtSet(arena, op, wrtVarIds);
      return arena.addTensorReduce(dOp, redOp, axis);
    }

    case ExprKind.TensorMap: {
      const op = arena.getExprLeft(exprId);
      const opId = arena.getExprData1(exprId);
      const aux = arena.getExprRight(exprId);
      const dOp = differentiateArenaExpressionWrtSet(arena, op, wrtVarIds);
      return arena.addTensorMap(dOp, opId, aux);
    }

    default:
      return arena.addRealLiteral(0.0);
  }
}

/**
 * The Modelica source for the ModelScript.CAS package.
 */
export const MODELSCRIPT_CAS_PACKAGE = `
package ModelScript
  package CAS "Computer Algebra System"

    function simplify "Simplify an expression using E-Graph equality saturation"
      input Expression expr;
      output Expression result;
      external "builtin";
    end simplify;

    function expand "Expand polynomial expressions (distribute multiplication)"
      input Expression expr;
      output Expression result;
      external "builtin";
    end expand;

    function normalize "Normalize to canonical form via E-Graph"
      input Expression expr;
      output Expression result;
      external "builtin";
    end normalize;

    function trigSimplify "Simplify using trigonometric identities"
      input Expression expr;
      output Expression result;
      external "builtin";
    end trigSimplify;

    function trigExpand "Expand trig expressions using addition formulas"
      input Expression expr;
      output Expression result;
      external "builtin";
    end trigExpand;

    function diff "Symbolic differentiation"
      input Expression expr;
      input Expression var "Variable to differentiate with respect to (as an expression node)";
      input Integer n = 1 "Order of derivative";
      output Expression result;
      external "builtin";
    end diff;

    function integrate "Symbolic anti-differentiation"
      input Expression expr;
      input Expression var "Variable to integrate with respect to";
      output Expression result;
      external "builtin";
    end integrate;

    function solve "Solve expr = 0 for var (returns first solution)"
      input Expression expr;
      input Expression var "Variable to solve for";
      output Expression result;
      external "builtin";
    end solve;

    function solveAll "Solve expr = 0 for var (returns all solutions)"
      input Expression expr;
      input Expression var "Variable to solve for";
      output Expression[:] result;
      external "builtin";
    end solveAll;

    function factor "Factor a quadratic polynomial"
      input Expression expr;
      input Expression var;
      output Expression result;
      external "builtin";
    end factor;

    function taylor "Taylor series expansion"
      input Expression expr;
      input Expression var;
      input Real point;
      input Integer order;
      output Expression result;
      external "builtin";
    end taylor;

    function limit "Evaluate limit of expr as var -> point"
      input Expression expr;
      input Expression var;
      input Real point;
      output Expression result;
      external "builtin";
    end limit;

    function degree "Get polynomial degree of expr in var"
      input Expression expr;
      input Expression var;
      output Integer result;
      external "builtin";
    end degree;

    function roots "Find rational roots of polynomial expr in var (returns numeric roots)"
      input Expression expr;
      input Expression var;
      output Real[:] result;
      external "builtin";
    end roots;

  end CAS;
end ModelScript;
`;
