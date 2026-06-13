// SPDX-License-Identifier: AGPL-3.0-or-later

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "@modelscript/compiler";

/**
 * Collect argument ExprIds from a Call or Subscript expression that uses
 * the Tuple-chaining convention. The first element is stored in `left`;
 * subsequent elements are stored as Tuple entries at consecutive expression
 * indices after `baseExprId`.
 */
function collectArgIds(arena: ArenaDAEBuilder, baseExprId: number, firstElem: number, count: number): number[] {
  if (count === 0) return [];
  const ids = [firstElem];
  for (let i = 1; i < count; i++) {
    // Tuple entries are stored at baseExprId + i, with the child in the `left` field
    ids.push(arena.getExprLeft(baseExprId + i));
  }
  return ids;
}

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

    case ExprKind.StringLiteral:
      // Strings have no numeric representation; return 0 in numeric context
      return 0;

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      // O(1) array access without string materialization or hashing
      const val = valuesByStringId[nameId] ?? 0;
      if (Number.isNaN(val)) {
        console.error("Name returned NaN! nameId:", nameId, "name:", arena.interner.resolve(nameId));
      }
      return val;
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

      if (Number.isNaN(left) || Number.isNaN(right)) {
        console.error("Binary op operand is NaN! left:", left, "right:", right, "op:", op, "exprId:", exprId);
      }

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
      // x[i]: data1 = base ExprId, left = first index ExprId, right = index count
      // In the arena, array variables are stored as separate scalar variables
      // with names like "x[1]", "x[2]", etc. If the base is a Name and the
      // indices are evaluable, we construct the subscripted name and look it up.
      const baseId = arena.getExprData1(exprId);
      const indexCount = arena.getExprRight(exprId);
      const firstIndexId = arena.getExprLeft(exprId);

      if (arena.getExprKind(baseId) === ExprKind.Name) {
        const baseName = arena.interner.resolve(arena.getExprData1(baseId));
        if (indexCount === 1) {
          // Single subscript (most common case — fast path)
          const idx = evaluateArenaRuntime(arena, firstIndexId, valuesByStringId);
          const subscriptedNameId = arena.interner.intern(`${baseName}[${Math.round(idx)}]`);
          return valuesByStringId[subscriptedNameId] ?? 0;
        }
        // Multi-subscript: x[i,j] → "x[i,j]"
        const indexIds = collectArgIds(arena, exprId, firstIndexId, indexCount);
        const indices = indexIds.map((id) => Math.round(evaluateArenaRuntime(arena, id, valuesByStringId)));
        const subscriptedNameId = arena.interner.intern(`${baseName}[${indices.join(",")}]`);
        return valuesByStringId[subscriptedNameId] ?? 0;
      }
      return 0;
    }

    case ExprKind.ArrayCtor: {
      // Array constructors in a scalar runtime context: return the first element
      // (full array semantics require a vector evaluator, which is outside the
      // scope of the scalar runtime path).
      const count = arena.getExprData1(exprId);
      const firstElem = arena.getExprLeft(exprId);
      if (count > 0) {
        return evaluateArenaRuntime(arena, firstElem, valuesByStringId);
      }
      return 0;
    }

    case ExprKind.Range: {
      // Range in scalar context: return the start value.
      // Full range expansion is handled at compile time by the flattener.
      const startId = arena.getExprData1(exprId);
      return evaluateArenaRuntime(arena, startId, valuesByStringId);
    }

    case ExprKind.Colon:
      // Whole-dimension slice — no scalar value
      return 0;

    case ExprKind.Comprehension: {
      // Reduction expressions like sum(f(i) for i in 1:n)
      // data1 = StringId of reduction function name, left = body ExprId, right = iterator count
      // At runtime with unrolled for-equations, these should already have been expanded
      // by the flattener. Return 0 as a fallback.
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
          // smooth(order, expr) → just evaluate expr (second arg)
          if (argCount > 1) {
            const secondArgId = arena.getExprLeft(exprId + 1);
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
          case "round":
            return Math.round(arg);
          // Type conversion
          case "Real":
          case "Integer":
          case "Boolean":
            return arg;
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
          // Modelica scalar max/min with single argument
          case "max":
          case "min":
            return arg;
        }
      }

      // ── Two-argument functions ──
      if (argCount === 2) {
        const arg0 = evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
        // Second argument is in the Tuple entry at exprId + 1
        const secondArgId = arena.getExprLeft(exprId + 1);
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
          case "cross":
            // cross product requires 3D vectors; scalar context returns 0
            return 0;
        }
      }

      // ── N-argument functions ──
      if (funcName === "max" || funcName === "min") {
        if (argCount > 0) {
          const argIds = collectArgIds(arena, exprId, firstArgId, argCount);
          let result = evaluateArenaRuntime(arena, argIds[0] as number, valuesByStringId);
          for (let a = 1; a < argCount; a++) {
            const val = evaluateArenaRuntime(arena, argIds[a] as number, valuesByStringId);
            result = funcName === "max" ? Math.max(result, val) : Math.min(result, val);
          }
          return result;
        }
      }

      // ── cat(dim, A, B, ...) — concatenation in scalar context: sum elements ──
      if (funcName === "cat" && argCount > 1) {
        // Skip first arg (dimension), evaluate remaining
        const argIds = collectArgIds(arena, exprId, firstArgId, argCount);
        let result = 0;
        for (let a = 1; a < argIds.length; a++) {
          result += evaluateArenaRuntime(arena, argIds[a] as number, valuesByStringId);
        }
        return result;
      }

      // ── fill(val, n1, n2, ...) — returns scalar fill value ──
      if (funcName === "fill" && argCount > 0) {
        return evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
      }

      // ── zeros(n) / ones(n) ──
      if (funcName === "zeros") return 0;
      if (funcName === "ones") return 1;

      // ── identity(n) / diagonal(v) — matrix ops, no scalar representation ──
      if (funcName === "identity" || funcName === "diagonal") return 0;

      // ── size(A, dim) ──
      if (funcName === "size") return 0; // Cannot determine at runtime without array metadata

      // ── ndims(A) ──
      if (funcName === "ndims") return 0;

      // ── transpose(A) / symmetric(A) — pass through first arg ──
      if ((funcName === "transpose" || funcName === "symmetric") && argCount > 0) {
        return evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
      }

      // ── sum / product reductions ──
      if ((funcName === "sum" || funcName === "product") && argCount > 0) {
        if (argCount === 1) {
          return evaluateArenaRuntime(arena, firstArgId, valuesByStringId);
        }
        const argIds = collectArgIds(arena, exprId, firstArgId, argCount);
        let result = funcName === "product" ? 1 : 0;
        for (const id of argIds) {
          const val = evaluateArenaRuntime(arena, id, valuesByStringId);
          result = funcName === "product" ? result * val : result + val;
        }
        return result;
      }

      // ── User-defined function: execute via the arena statement executor ──
      // This is handled by the simulator layer, not the raw evaluator.
      // Return 0 for unrecognized functions.
      return 0;
    }
  }

  return 0;
}
