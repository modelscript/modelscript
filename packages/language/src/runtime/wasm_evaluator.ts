// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM Evaluator runtime module.
 * Provides high-performance expression evaluation and forward-mode Automatic Differentiation (AD)
 * over the ArenaDAEBuilder AST.
 */

import { ArenaDAEBuilder, BinOp, ExprKind, UnaryOp } from "../compiler/index.js";

/**
 * Dual numbers for forward-mode automatic differentiation.
 * A dual number `(val, dot)` represents a value `val` along with its
 * derivative `dot` with respect to a seed variable.
 */
export class Dual {
  constructor(
    public readonly val: number,
    public readonly dot: number,
  ) {}

  static constant(v: number): Dual {
    return new Dual(v, 0);
  }

  static variable(v: number): Dual {
    return new Dual(v, 1);
  }

  add(b: Dual): Dual {
    return new Dual(this.val + b.val, this.dot + b.dot);
  }

  sub(b: Dual): Dual {
    return new Dual(this.val - b.val, this.dot - b.dot);
  }

  mul(b: Dual): Dual {
    return new Dual(this.val * b.val, this.val * b.dot + this.dot * b.val);
  }

  div(b: Dual): Dual {
    const b2 = b.val * b.val;
    return new Dual(this.val / b.val, (this.dot * b.val - this.val * b.dot) / b2);
  }

  pow(b: Dual): Dual {
    if (b.dot === 0) {
      const v = this.val ** b.val;
      return new Dual(v, b.val * this.val ** (b.val - 1) * this.dot);
    }
    if (this.dot === 0) {
      const v = this.val ** b.val;
      return new Dual(v, v * Math.log(this.val) * b.dot);
    }
    const v = this.val ** b.val;
    const d = v * ((b.val * this.dot) / this.val + b.dot * Math.log(this.val));
    return new Dual(v, d);
  }

  neg(): Dual {
    return new Dual(-this.val, -this.dot);
  }

  static sin(d: Dual): Dual {
    return new Dual(Math.sin(d.val), d.dot * Math.cos(d.val));
  }

  static cos(d: Dual): Dual {
    return new Dual(Math.cos(d.val), -d.dot * Math.sin(d.val));
  }

  static tan(d: Dual): Dual {
    const t = Math.tan(d.val);
    return new Dual(t, d.dot * (1 + t * t));
  }

  static asin(d: Dual): Dual {
    return new Dual(Math.asin(d.val), d.dot / Math.sqrt(1 - d.val * d.val));
  }

  static acos(d: Dual): Dual {
    return new Dual(Math.acos(d.val), -d.dot / Math.sqrt(1 - d.val * d.val));
  }

  static atan(d: Dual): Dual {
    return new Dual(Math.atan(d.val), d.dot / (1 + d.val * d.val));
  }

  static atan2(y: Dual, x: Dual): Dual {
    const r2 = x.val * x.val + y.val * y.val;
    return new Dual(Math.atan2(y.val, x.val), (x.val * y.dot - y.val * x.dot) / r2);
  }

  static exp(d: Dual): Dual {
    const ev = Math.exp(d.val);
    return new Dual(ev, d.dot * ev);
  }

  static log(d: Dual): Dual {
    return new Dual(Math.log(d.val), d.dot / d.val);
  }

  static log10(d: Dual): Dual {
    return new Dual(Math.log10(d.val), d.dot / (d.val * Math.LN10));
  }

  static sqrt(d: Dual): Dual {
    const sv = Math.sqrt(d.val);
    return new Dual(sv, d.dot / (2 * sv));
  }

  static abs(d: Dual): Dual {
    const sign = d.val > 0 ? 1 : d.val < 0 ? -1 : 0;
    return new Dual(Math.abs(d.val), d.dot * sign);
  }

  static sign(d: Dual): Dual {
    const s = d.val > 0 ? 1 : d.val < 0 ? -1 : 0;
    return new Dual(s, 0);
  }

  static sinh(d: Dual): Dual {
    return new Dual(Math.sinh(d.val), d.dot * Math.cosh(d.val));
  }

  static cosh(d: Dual): Dual {
    return new Dual(Math.cosh(d.val), d.dot * Math.sinh(d.val));
  }

  static tanh(d: Dual): Dual {
    const th = Math.tanh(d.val);
    return new Dual(th, d.dot * (1 - th * th));
  }

  static min(a: Dual, b: Dual): Dual {
    return a.val <= b.val ? a : b;
  }

  static max(a: Dual, b: Dual): Dual {
    return a.val >= b.val ? a : b;
  }

  static floor(d: Dual): Dual {
    return new Dual(Math.floor(d.val), 0);
  }

  static ceil(d: Dual): Dual {
    return new Dual(Math.ceil(d.val), 0);
  }
}

function collectArgIds(arena: ArenaDAEBuilder, baseExprId: number, firstElem: number, count: number): number[] {
  if (count === 0) return [];
  const ids = [firstElem];
  for (let i = 1; i < count; i++) {
    ids.push(arena.getExprLeft(baseExprId + i));
  }
  return ids;
}

/**
 * Expression evaluator using dual numbers for forward-mode automatic differentiation.
 */
export function evaluateArenaDualExpression(
  arena: ArenaDAEBuilder,
  exprId: number,
  dualVarsByStringId: Map<number, Dual> | (Dual | undefined)[],
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
      }
      return null;
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

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const funcName = arena.interner.resolve(funcNameId);
      const argCount = arena.getExprRight(exprId);
      const firstArgId = arena.getExprLeft(exprId);

      if (
        funcName === "noEvent" ||
        funcName === "/*Real*/" ||
        funcName === "/*Integer*/" ||
        funcName === "/*Boolean*/"
      ) {
        return argCount > 0 ? evaluateArenaDualExpression(arena, firstArgId, dualVarsByStringId) : Dual.constant(0);
      }
      if (funcName === "smooth") {
        if (argCount > 1) {
          const secondArgId = arena.getExprLeft(exprId + 1);
          return evaluateArenaDualExpression(arena, secondArgId, dualVarsByStringId);
        }
        return argCount > 0 ? evaluateArenaDualExpression(arena, firstArgId, dualVarsByStringId) : Dual.constant(0);
      }

      if (argCount === 1) {
        const arg = evaluateArenaDualExpression(arena, firstArgId, dualVarsByStringId);
        if (arg === null) return null;
        switch (funcName) {
          case "sin":
            return Dual.sin(arg);
          case "cos":
            return Dual.cos(arg);
          case "tan":
            return Dual.tan(arg);
          case "asin":
            return Dual.asin(arg);
          case "acos":
            return Dual.acos(arg);
          case "atan":
            return Dual.atan(arg);
          case "sinh":
            return Dual.sinh(arg);
          case "cosh":
            return Dual.cosh(arg);
          case "tanh":
            return Dual.tanh(arg);
          case "exp":
            return Dual.exp(arg);
          case "log":
            return Dual.log(arg);
          case "log10":
            return Dual.log10(arg);
          case "sqrt":
            return Dual.sqrt(arg);
          case "abs":
            return Dual.abs(arg);
          case "sign":
            return Dual.sign(arg);
          case "ceil":
            return Dual.ceil(arg);
          case "floor":
            return Dual.floor(arg);
          case "Real":
          case "Integer":
          case "Boolean":
          case "max":
          case "min":
            return arg;
        }
      }

      if (argCount === 2) {
        const arg0 = evaluateArenaDualExpression(arena, firstArgId, dualVarsByStringId);
        const secondArgId = arena.getExprLeft(exprId + 1);
        const arg1 = evaluateArenaDualExpression(arena, secondArgId, dualVarsByStringId);
        if (arg0 === null || arg1 === null) return null;
        switch (funcName) {
          case "atan2":
            return Dual.atan2(arg0, arg1);
          case "max":
            return Dual.max(arg0, arg1);
          case "min":
            return Dual.min(arg0, arg1);
          case "pow":
            return arg0.pow(arg1);
        }
      }

      return Dual.constant(0);
    }
  }

  return null;
}

/**
 * Highly optimized, zero-garbage runtime evaluator.
 * Evaluates an arena expression using a dense, flat Float64Array for variable lookups.
 */
export function evaluateArenaRuntime(
  arena: ArenaDAEBuilder,
  exprId: number,
  valuesByStringId: Float64Array,
  preValuesByStringId?: Float64Array,
): number {
  if (exprId < 0) return 0;

  const kind = arena.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
      return arena.getExprRealValue(exprId);

    case ExprKind.IntLiteral:
    case ExprKind.BoolLiteral:
    case ExprKind.EnumLiteral:
      return arena.getExprData1(exprId);

    case ExprKind.StringLiteral:
      return 0;

    case ExprKind.Name: {
      const nameId = arena.getExprData1(exprId);
      return valuesByStringId[nameId] ?? 0;
    }

    case ExprKind.Der: {
      const argId = arena.getExprData1(exprId);
      if (arena.getExprKind(argId) === ExprKind.Name) {
        const innerNameId = arena.getExprData1(argId);
        const innerName = arena.interner.resolve(innerNameId);
        const derNameId = arena.interner.intern(`der(${innerName})`);
        return valuesByStringId[derNameId] ?? 0;
      }
      return 0;
    }

    case ExprKind.Pre: {
      const argId = arena.getExprData1(exprId);
      const snapshotEnv = preValuesByStringId ?? valuesByStringId;
      return evaluateArenaRuntime(arena, argId, snapshotEnv, snapshotEnv);
    }

    case ExprKind.Negate: {
      return -evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId, preValuesByStringId);
    }

    case ExprKind.Unary: {
      const op = arena.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId, preValuesByStringId);
      if (op === UnaryOp.Negate) return -operand;
      if (op === UnaryOp.Not) return operand === 0 ? 1 : 0;
      return 0;
    }

    case ExprKind.Binary: {
      const op = arena.getExprData1(exprId) as BinOp;
      const left = evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId, preValuesByStringId);
      const right = evaluateArenaRuntime(arena, arena.getExprRight(exprId), valuesByStringId, preValuesByStringId);

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
      const cond = evaluateArenaRuntime(arena, arena.getExprData1(exprId), valuesByStringId, preValuesByStringId);
      if (cond !== 0) {
        return evaluateArenaRuntime(arena, arena.getExprLeft(exprId), valuesByStringId, preValuesByStringId);
      } else {
        return evaluateArenaRuntime(arena, arena.getExprRight(exprId), valuesByStringId, preValuesByStringId);
      }
    }

    case ExprKind.Subscript: {
      const baseId = arena.getExprData1(exprId);
      const indexCount = arena.getExprRight(exprId);
      const firstIndexId = arena.getExprLeft(exprId);

      if (arena.getExprKind(baseId) === ExprKind.Name) {
        const baseName = arena.interner.resolve(arena.getExprData1(baseId));
        if (indexCount === 1) {
          const idx = evaluateArenaRuntime(arena, firstIndexId, valuesByStringId, preValuesByStringId);
          const subscriptedNameId = arena.interner.intern(`${baseName}[${Math.round(idx)}]`);
          return valuesByStringId[subscriptedNameId] ?? 0;
        }
        const indexIds = collectArgIds(arena, exprId, firstIndexId, indexCount);
        const indices = indexIds.map((id) =>
          Math.round(evaluateArenaRuntime(arena, id, valuesByStringId, preValuesByStringId)),
        );
        const subscriptedNameId = arena.interner.intern(`${baseName}[${indices.join(",")}]`);
        return valuesByStringId[subscriptedNameId] ?? 0;
      }
      return 0;
    }

    case ExprKind.ArrayCtor: {
      const count = arena.getExprData1(exprId);
      const firstElem = arena.getExprLeft(exprId);
      if (count > 0) {
        return evaluateArenaRuntime(arena, firstElem, valuesByStringId, preValuesByStringId);
      }
      return 0;
    }

    case ExprKind.Range: {
      const startId = arena.getExprData1(exprId);
      return evaluateArenaRuntime(arena, startId, valuesByStringId, preValuesByStringId);
    }

    case ExprKind.Colon:
    case ExprKind.Comprehension:
      return 0;

    case ExprKind.Call: {
      const funcNameId = arena.getExprData1(exprId);
      const funcName = arena.interner.resolve(funcNameId);
      const argCount = arena.getExprRight(exprId);
      const firstArgId = arena.getExprLeft(exprId);

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
          return argCount > 0 ? evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId) : 0;
        case "smooth":
          if (argCount > 1) {
            const secondArgId = arena.getExprLeft(exprId + 1);
            return evaluateArenaRuntime(arena, secondArgId, valuesByStringId, preValuesByStringId);
          }
          return argCount > 0 ? evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId) : 0;
        case "homotopy":
          return argCount > 0 ? evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId) : 0;
      }

      if (argCount === 1) {
        const arg = evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId);
        switch (funcName) {
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
          case "sinh":
            return Math.sinh(arg);
          case "cosh":
            return Math.cosh(arg);
          case "tanh":
            return Math.tanh(arg);
          case "exp":
            return Math.exp(arg);
          case "log":
            return Math.log(arg);
          case "log10":
            return Math.log10(arg);
          case "sqrt":
            return Math.sqrt(arg);
          case "abs":
            return Math.abs(arg);
          case "sign":
            return Math.sign(arg);
          case "ceil":
            return Math.ceil(arg);
          case "floor":
          case "integer":
            return Math.floor(arg);
          case "round":
            return Math.round(arg);
          case "Real":
          case "Integer":
          case "Boolean":
          case "max":
          case "min":
            return arg;
          case "der": {
            if (arena.getExprKind(firstArgId) === ExprKind.Name) {
              const varNameId = arena.getExprData1(firstArgId);
              const varName = arena.interner.resolve(varNameId);
              const derNameId = arena.interner.intern(`der(${varName ?? ""})`);
              return valuesByStringId[derNameId] ?? 0;
            }
            return 0;
          }
          case "pre":
            return arg;
        }
      }

      if (argCount === 2) {
        const arg0 = evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId);
        const secondArgId = arena.getExprLeft(exprId + 1);
        const arg1 = evaluateArenaRuntime(arena, secondArgId, valuesByStringId, preValuesByStringId);
        switch (funcName) {
          case "atan2":
            return Math.atan2(arg0, arg1);
          case "max":
            return Math.max(arg0, arg1);
          case "min":
            return Math.min(arg0, arg1);
          case "mod":
            return arg1 !== 0 ? arg0 - Math.floor(arg0 / arg1) * arg1 : 0;
          case "rem":
            return arg1 !== 0 ? arg0 - Math.trunc(arg0 / arg1) * arg1 : 0;
          case "div":
            return arg1 !== 0 ? Math.trunc(arg0 / arg1) : 0;
          case "pow":
            return Math.pow(arg0, arg1);
          case "cross":
            return 0;
        }
      }

      if (funcName === "max" || funcName === "min") {
        if (argCount > 0) {
          const argIds = collectArgIds(arena, exprId, firstArgId, argCount);
          let result = evaluateArenaRuntime(arena, argIds[0] as number, valuesByStringId, preValuesByStringId);
          for (let a = 1; a < argCount; a++) {
            const val = evaluateArenaRuntime(arena, argIds[a] as number, valuesByStringId, preValuesByStringId);
            result = funcName === "max" ? Math.max(result, val) : Math.min(result, val);
          }
          return result;
        }
      }

      if (funcName === "cat" && argCount > 1) {
        const argIds = collectArgIds(arena, exprId, firstArgId, argCount);
        let result = 0;
        for (let a = 1; a < argIds.length; a++) {
          result += evaluateArenaRuntime(arena, argIds[a] as number, valuesByStringId, preValuesByStringId);
        }
        return result;
      }

      if (funcName === "fill" && argCount > 0) {
        return evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId);
      }

      if (funcName === "zeros") return 0;
      if (funcName === "ones") return 1;
      if (funcName === "identity" || funcName === "diagonal") return 0;
      if (funcName === "size" || funcName === "ndims") return 0;

      if ((funcName === "transpose" || funcName === "symmetric") && argCount > 0) {
        return evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId);
      }

      if ((funcName === "sum" || funcName === "product") && argCount > 0) {
        if (argCount === 1) {
          return evaluateArenaRuntime(arena, firstArgId, valuesByStringId, preValuesByStringId);
        }
        const argIds = collectArgIds(arena, exprId, firstArgId, argCount);
        let result = funcName === "product" ? 1 : 0;
        for (const id of argIds) {
          const val = evaluateArenaRuntime(arena, id, valuesByStringId, preValuesByStringId);
          result = funcName === "product" ? result * val : result + val;
        }
        return result;
      }

      return 0;
    }
  }

  return 0;
}
