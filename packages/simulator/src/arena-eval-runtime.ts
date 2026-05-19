// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "@modelscript/compiler";

/**
 * Highly optimized, zero-garbage runtime evaluator.
 * Evaluates an arena expression using a dense, flat Float64Array for variable lookups.
 * The array is indexed by the variable's StringId.
 *
 * This must have full parity with the legacy ExpressionEvaluator for all
 * built-in functions and ExprKinds used during simulation.
 */
export function evaluateArenaRuntime(arena: ArenaDAEBuilder, exprId: number, valuesByStringId: Float64Array): number {
  if (exprId < 0) return 0;

  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(exprId);

    case ExprKind.IntLiteral:
      return arena.getExprData1(exprId);

    case ExprKind.BoolLiteral:
      return arena.getExprData1(exprId);

    case ExprKind.EnumLiteral:
      return arena.getExprData1(exprId);

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      // O(1) array access without string materialization or hashing
      return valuesByStringId[nameId] ?? 0;
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      // der(x) → look up the variable named "der(x)" in the environment.
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerNameId = arena.getExprData1(argId);
        const innerName = arena.interner.resolve(innerNameId);
        const derNameId = arena.interner.intern(`der(${innerName})`);
        return valuesByStringId[derNameId] ?? 0;
      }
      return 0;
    }

    case ExprKind.Pre: {
      // pre(x) → at runtime, returns the previous-step value of x.
      // In a continuous simulation loop this is typically the same as the current value
      // (the simulator updates pre-values between steps). Just evaluate the argument.
      const argId = arena.getExprData1(exprId);
      return evaluateArenaRuntime(arena, argId, valuesByStringId);
    }

    case ExprKind.Negate: {
      return -evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
      if (op === UnaryOp.Negate) return -operand;
      if (op === UnaryOp.Not) return operand === 0 ? 1 : 0;
      return 0;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId);
      const right = evaluateArenaRuntime(arena, arena.getExprRight(exprId), valuesByStringId);

      switch (op) {
        case BinOp.Add:
        case BinOp.ElemAdd:
          return left + right;
        case BinOp.Sub:
        case BinOp.ElemSub:
          return left - right;
        case BinOp.Mul:
        case BinOp.ElemMul:
          return left * right;
        case BinOp.Div:
        case BinOp.ElemDiv:
          return left / right;
        case BinOp.Pow:
        case BinOp.ElemPow:
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

    case ExprKind.Subscript: {
      // x[i]: data1 = base ExprId, left = index ExprId, right = index count
      // For a single subscript into a flat array variable:
      // In the arena, array variables are stored as separate scalar variables
      // with names like "x[1]", "x[2]", etc. If the base is a Name and the
      // index is evaluable, we construct the subscripted name and look it up.
      const baseId = arena.getExprData1(exprId);
      const indexId = arena.getExprLeft(exprId);
      if (arena.getExprKind(baseId) === ExprKind.Name) {
        const baseName = arena.interner.resolve(arena.getExprData1(baseId));
        const idx = evaluateArenaRuntime(arena, indexId, valuesByStringId);
        const subscriptedNameId = arena.interner.intern(`${baseName}[${Math.round(idx)}]`);
        return valuesByStringId[subscriptedNameId] ?? 0;
      }
      return 0;
    }

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const funcName = arena.interner.resolve(funcNameId);
      const argCount = arena.getExprRight(exprId);
      const firstArgId = arena.getExprLeft(exprId);

      // ── Event operators — return 0 or pass-through ──
      switch (funcName) {
        case "edge":
        case "change":
        case "sample":
        case "initial":
        case "terminal":
          return 0;
        case "noEvent":
        case "/*Real*/":
        case "/*Integer*/":
        case "/*Boolean*/":
          return argCount > 0 ? evaluateArenaRuntime(arena, firstArgId, valuesByStringId) : 0;
        case "smooth":
          // smooth(order, expr) → just evaluate expr
          if (argCount > 1) {
            const secondArgId = arena.getExprLeft(firstArgId + 1);
            return evaluateArenaRuntime(arena, secondArgId, valuesByStringId);
          }
          return argCount > 0 ? evaluateArenaRuntime(arena, firstArgId, valuesByStringId) : 0;
        case "homotopy":
          // homotopy(actual, simplified) → use actual
          return argCount > 0 ? evaluateArenaRuntime(arena, firstArgId, valuesByStringId) : 0;
      }

      // ── Single-argument functions ──
      if (argCount === 1) {
        const arg = evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
        switch (funcName) {
          // Trigonometric
          case "sin":
            return Math.sin(arg);
          case "cos":
            return Math.cos(arg);
          case "tan":
            return Math.tan(arg);
          case "asin":
            return Math.asin(arg);
          case "acos":
            return Math.acos(arg);
          case "atan":
            return Math.atan(arg);
          // Hyperbolic
          case "sinh":
            return Math.sinh(arg);
          case "cosh":
            return Math.cosh(arg);
          case "tanh":
            return Math.tanh(arg);
          // Exponential / Logarithmic
          case "exp":
            return Math.exp(arg);
          case "log":
            return Math.log(arg);
          case "log10":
            return Math.log10(arg);
          case "sqrt":
            return Math.sqrt(arg);
          // Rounding / Sign
          case "abs":
            return Math.abs(arg);
          case "sign":
            return Math.sign(arg);
          case "ceil":
            return Math.ceil(arg);
          case "floor":
            return Math.floor(arg);
          case "integer":
            return Math.floor(arg);
          // der(x) as a function call
          case "der": {
            if (arena.getExprKind(firstArgId) === ExprKind.Name) {
              const varNameId = arena.getExprData1(firstArgId);
              const varName = arena.interner.resolve(varNameId);
              const derNameId = arena.interner.intern(`der(${varName ?? ""})`);
              return valuesByStringId[derNameId] ?? 0;
            }
            return 0;
          }
          // pre(x) as a function call
          case "pre":
            return arg; // Returns the argument value (pre-values updated between steps)
        }
      }

      // ── Two-argument functions ──
      if (argCount === 2) {
        const arg0 = evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
        const secondArgId = arena.getExprLeft(firstArgId + 1);
        const arg1 = evaluateArenaRuntime(arena, secondArgId, valuesByStringId);
        switch (funcName) {
          case "atan2":
            return Math.atan2(arg0, arg1);
          case "max":
            return Math.max(arg0, arg1);
          case "min":
            return Math.min(arg0, arg1);
          case "mod":
            // Modelica mod(a, b) = a - floor(a/b) * b
            return arg1 !== 0 ? arg0 - Math.floor(arg0 / arg1) * arg1 : 0;
          case "rem":
            // Modelica rem(a, b) = a - trunc(a/b) * b
            return arg1 !== 0 ? arg0 - Math.trunc(arg0 / arg1) * arg1 : 0;
          case "div":
            // Modelica div(a, b) = trunc(a / b)
            return arg1 !== 0 ? Math.trunc(arg0 / arg1) : 0;
          case "pow":
            return Math.pow(arg0, arg1);
        }
      }

      // ── N-argument functions ──
      if (funcName === "max" || funcName === "min") {
        if (argCount > 0) {
          let result = evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
          for (let a = 1; a < argCount; a++) {
            const argId = arena.getExprLeft(firstArgId + a);
            const val = evaluateArenaRuntime(arena, argId, valuesByStringId);
            result = funcName === "max" ? Math.max(result, val) : Math.min(result, val);
          }
          return result;
        }
      }

      return 0;
    }
  }

  return 0;
}
