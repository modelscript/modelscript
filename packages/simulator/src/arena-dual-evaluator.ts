// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "@modelscript/compiler";
import { Dual } from "./dual.js";

/**
 * Expression evaluator using dual numbers for forward-mode automatic differentiation.
 * Operates on the DoD Arena buffer `ArenaDAEBuilder`, propagating derivatives
 * through the computation graph via the chain rule with zero-garbage execution.
 */
export function evaluateArenaDualExpression(
  arena: ArenaDAEBuilder,
  exprId: number,
  dualVarsByStringId: Map<number, Dual> | Dual[],
): Dual | null {
  if (exprId < 0) return null;

  const kind = arena.getExprKind(exprId);
  switch (kind) {
    case ExprKind.RealLiteral:
      return Dual.constant(arena.getExprRealValue(exprId));

    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
      return Dual.constant(arena.getExprData1(exprId));

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      if (Array.isArray(dualVarsByStringId)) {
        return dualVarsByStringId[nameId] ?? null;
      } else {
        return dualVarsByStringId.get(nameId) ?? null;
      }
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaDualExpression(arena, arena.getExprLeft(exprId), dualVarsByStringId);
      if (operand === null) return null;
      switch (op) {
        case UnaryOp.Negate:
          return operand.neg();
        case UnaryOp.Not:
          return Dual.constant(operand.val === 0 ? 1 : 0);
        default:
          return null;
      }
    }

    case ExprKind.Negate: {
      const operand = evaluateArenaDualExpression(arena, arena.getExprLeft(exprId), dualVarsByStringId);
      return operand ? operand.neg() : null;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = evaluateArenaDualExpression(arena, arena.getExprLeft(exprId), dualVarsByStringId);
      const right = evaluateArenaDualExpression(arena, arena.getExprRight(exprId), dualVarsByStringId);

      if (
        (op === BinOp.Mul || op === BinOp.ElemMul) &&
        ((left !== null && left.val === 0 && left.dot === 0) || (right !== null && right.val === 0 && right.dot === 0))
      ) {
        return Dual.constant(0);
      }

      if (left === null || right === null) return null;

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
          return left.add(right);
        case BinOp.Sub:
        case BinOp.ElemSub:
          return left.sub(right);
        case BinOp.Mul:
        case BinOp.ElemMul:
          return left.mul(right);
        case BinOp.Div:
        case BinOp.ElemDiv:
          return right.val !== 0 ? left.div(right) : null;
        case BinOp.Pow:
        case BinOp.ElemPow:
          return left.pow(right);
        case BinOp.Lt:
          return Dual.constant(left.val < right.val ? 1 : 0);
        case BinOp.Lte:
          return Dual.constant(left.val <= right.val ? 1 : 0);
        case BinOp.Gt:
          return Dual.constant(left.val > right.val ? 1 : 0);
        case BinOp.Gte:
          return Dual.constant(left.val >= right.val ? 1 : 0);
        case BinOp.Eq:
          return Dual.constant(left.val === right.val ? 1 : 0);
        case BinOp.Neq:
          return Dual.constant(left.val !== right.val ? 1 : 0);
        case BinOp.And:
          return Dual.constant(left.val !== 0 && right.val !== 0 ? 1 : 0);
        case BinOp.Or:
          return Dual.constant(left.val !== 0 || right.val !== 0 ? 1 : 0);
        default:
          return null;
      }
    }

    case ExprKind.IfElse: {
      const cond = evaluateArenaDualExpression(arena, arena.getExprData1(exprId), dualVarsByStringId);
      if (cond === null) return null;
      if (cond.val !== 0) {
        return evaluateArenaDualExpression(arena, arena.getExprLeft(exprId), dualVarsByStringId);
      } else {
        return evaluateArenaDualExpression(arena, arena.getExprRight(exprId), dualVarsByStringId);
      }
    }

    case ExprKind.Pre: {
      const argId = arena.getExprData1(exprId);
      // 'pre' returns a constant, dropping the derivative
      const argVal = evaluateArenaDualExpression(arena, argId, dualVarsByStringId);
      return argVal ? Dual.constant(argVal.val) : null;
    }

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const name = arena.interner.resolve(funcNameId);
      const argCount = arena.getExprRight(exprId);
      const firstArg = arena.getExprLeft(exprId);

      const arg0 = argCount > 0 ? evaluateArenaDualExpression(arena, firstArg, dualVarsByStringId) : null;
      const arg1 =
        argCount > 1 ? evaluateArenaDualExpression(arena, arena.getExprLeft(firstArg + 1), dualVarsByStringId) : null;

      switch (name) {
        case "edge":
        case "change":
        case "sample":
        case "initial":
        case "terminal":
          return Dual.constant(0);
        case "noEvent":
        case "/*Real*/":
        case "/*Integer*/":
        case "/*Boolean*/":
          return arg0;
        case "smooth":
          return argCount > 1 ? arg1 : arg0;
      }

      if (argCount === 1 && arg0 !== null) {
        switch (name) {
          case "sin":
            return Dual.sin(arg0);
          case "cos":
            return Dual.cos(arg0);
          case "tan":
            return Dual.tan(arg0);
          case "asin":
            return Dual.asin(arg0);
          case "acos":
            return Dual.acos(arg0);
          case "atan":
            return Dual.atan(arg0);
          case "sinh":
            return Dual.sinh(arg0);
          case "cosh":
            return Dual.cosh(arg0);
          case "tanh":
            return Dual.tanh(arg0);
          case "exp":
            return Dual.exp(arg0);
          case "log":
            return arg0.val > 0 ? Dual.log(arg0) : null;
          case "log10":
            return arg0.val > 0 ? Dual.log10(arg0) : null;
          case "sqrt":
            return arg0.val >= 0 ? Dual.sqrt(arg0) : null;
          case "abs":
            return Dual.abs(arg0);
          case "sign":
            return Dual.sign(arg0);
          case "ceil":
            return Dual.ceil(arg0);
          case "floor":
          case "integer":
            return Dual.floor(arg0);
          case "der": {
            if (arena.getExprKind(firstArg) === ExprKind.Name) {
              const varNameId = arena.getExprData1(firstArg);
              const varName = arena.interner.resolve(varNameId);
              const derNameId = arena.interner.intern(`der(${varName ?? ""})`);
              if (Array.isArray(dualVarsByStringId)) {
                return dualVarsByStringId[derNameId] ?? Dual.constant(0);
              } else {
                return dualVarsByStringId.get(derNameId) ?? Dual.constant(0);
              }
            }
            return Dual.constant(0);
          }
        }
      }

      if (argCount === 2 && arg0 !== null && arg1 !== null) {
        switch (name) {
          case "atan2":
            return Dual.atan2(arg0, arg1);
          case "max":
            return Dual.max(arg0, arg1);
          case "min":
            return Dual.min(arg0, arg1);
          case "mod":
            return arg1.val !== 0 ? Dual.mod(arg0, arg1) : null;
          case "rem":
            return arg1.val !== 0 ? Dual.rem(arg0, arg1) : null;
          case "div":
            return arg1.val !== 0 ? Dual.trunc(arg0, arg1) : null;
        }
      }

      if (name === "homotopy" && arg0 !== null) {
        return arg0;
      }

      return null;
    }
  }

  return null;
}
