// SPDX-License-Identifier: AGPL-3.0-or-later

import { BinOp, DAEArenaBuilder, ExprKind, UnaryOp } from "@modelscript/compiler";

/**
 * Highly optimized, zero-garbage runtime evaluator.
 * Evaluates an arena expression using a dense, flat Float64Array for variable lookups.
 * The array is indexed by the variable's StringId.
 */
export function evaluateArenaRuntime(arena: DAEArenaBuilder, exprId: number, valuesByStringId: Float64Array): number {
  if (exprId < 0) return 0;

  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
      return arena.getExprRealValue(exprId);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      // O(1) array access without string materialization or hashing
      return valuesByStringId[nameId] ?? 0;
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      // Wait: evaluateArenaRuntime expects to just evaluate it.
      // A der(x) has an associated variable. We need to evaluate the der(x) variable.
      // But der(x) is not a Name. We should evaluate it by fetching its StringId.
      // In ArenaSimulator, der(x) is assigned a variable with Name "der(x)".
      // But in ExprKind.Der, data1 is the inner expression (usually a Name).
      // We can resolve it dynamically if we assume it's der(Name).
      // But StringId for "der(x)" might be different.
      // A better way is to rely on the simulator flattening der(x) to Name("der(x)")
      // before evaluation, OR resolving it here.
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerNameId = arena.getExprData1(argId);
        const innerName = arena.interner.resolve(innerNameId);
        const derNameId = arena.interner.intern(`der(${innerName})`);
        return valuesByStringId[derNameId] ?? 0;
      }
      return 0;
    }

    case ExprKind.Negate: {
      return -evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
      if (op === UnaryOp.Negate) return -operand;
      // if (op === UnaryOp.Not) return !operand; // (ignoring boolean coercion for now)
      return 0;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
      const right = evaluateArenaRuntime(arena, arena.getExprRight(exprId), valuesByStringId);

      switch (op) {
        case BinOp.Add:
          return left + right;
        case BinOp.Sub:
          return left - right;
        case BinOp.Mul:
          return left * right;
        case BinOp.Div:
          return left / right;
        case BinOp.Pow:
          return Math.pow(left, right);
        case BinOp.Lt:
          return left < right ? 1 : 0;
        case BinOp.Lte:
          return left <= right ? 1 : 0;
        case BinOp.Gt:
          return left > right ? 1 : 0;
        case BinOp.Gte:
          return left >= right ? 1 : 0;
        case BinOp.Eq:
          return left === right ? 1 : 0;
        case BinOp.Neq:
          return left !== right ? 1 : 0;
        case BinOp.And:
          return left !== 0 && right !== 0 ? 1 : 0;
        case BinOp.Or:
          return left !== 0 || right !== 0 ? 1 : 0;
      }
      return 0;
    }

    case ExprKind.IfElse: {
      const cond = evaluateArenaRuntime(arena, arena.getExprData1(exprId), valuesByStringId);
      if (cond !== 0) {
        return evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
      } else {
        return evaluateArenaRuntime(arena, arena.getExprRight(exprId), valuesByStringId);
      }
    }

    case ExprKind.Call: {
      // Stub for math functions like sin, cos, exp
      const funcNameId = arena.getExprData1(exprId);
      const funcName = arena.interner.resolve(funcNameId);
      const argCount = arena.getExprRight(exprId);
      const firstArgId = arena.getExprLeft(exprId);

      if (argCount === 1) {
        const arg = evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
        switch (funcName) {
          case "sin":
            return Math.sin(arg);
          case "cos":
            return Math.cos(arg);
          case "tan":
            return Math.tan(arg);
          case "exp":
            return Math.exp(arg);
          case "log":
            return Math.log(arg);
          case "sqrt":
            return Math.sqrt(arg);
          case "abs":
            return Math.abs(arg);
        }
      }
      return 0;
    }
  }

  return 0;
}
