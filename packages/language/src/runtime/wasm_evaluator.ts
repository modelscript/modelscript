// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM Evaluator runtime module.
 * Provides high-performance expression evaluation and forward-mode Automatic Differentiation (AD)
 * over the DAEBuilder AST.
 */

import type { QueryDB, SymbolEntry, SymbolId } from "./runtime.js";
import { BinOp, DAEBuilder, ExprKind, UnaryOp, Variability } from "./wasm_dae.js";

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

function collectArgIds(arena: DAEBuilder, baseExprId: number, firstElem: number, count: number): number[] {
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
  arena: DAEBuilder,
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
  arena: DAEBuilder,
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

// ─────────────────────────────────────────────────────────────────────────────
// Symbolic & Compile-Time Evaluation Support
// ─────────────────────────────────────────────────────────────────────────────

/** A record/object value produced by evaluating an ExprKind.Object expression. */
export interface ArenaObjectValue {
  readonly __kind: "object";
  readonly fields: Map<string, ArenaValue>;
}

export type ArenaValue = number | boolean | string | ArenaValue[] | ArenaObjectValue;

/** Type guard: is this ArenaValue a record/object? */
export function isArenaObject(v: ArenaValue): v is ArenaObjectValue {
  return typeof v === "object" && v !== null && !Array.isArray(v) && (v as ArenaObjectValue).__kind === "object";
}

export function getSequenceElements(
  dae: DAEBuilder,
  baseExprId: number,
  count: number,
  firstElement: number,
): number[] {
  if (count === 0) return [];
  const elements = [firstElement];
  const kind = dae.getExprKind(baseExprId);
  const redirect = dae.getExprRight(baseExprId);
  const usesRedirect = kind === ExprKind.Call || kind === ExprKind.Range || kind === ExprKind.ArrayCtor;
  const actualBase = usesRedirect && redirect >= 0 ? redirect : baseExprId;
  for (let i = 1; i < count; i++) {
    const tupleId = actualBase + i;
    elements.push(dae.getExprLeft(tupleId));
  }
  return elements;
}

export function evaluateBuiltinMathFunction(funcName: string, args: ArenaValue[]): ArenaValue | null | undefined {
  if (funcName === "sin" && typeof args[0] === "number") return Math.sin(args[0]);
  if (funcName === "cos" && typeof args[0] === "number") return Math.cos(args[0]);
  if (funcName === "tan" && typeof args[0] === "number") return Math.tan(args[0]);
  if (funcName === "asin" && typeof args[0] === "number") return Math.asin(args[0]);
  if (funcName === "acos" && typeof args[0] === "number") return Math.acos(args[0]);
  if (funcName === "atan" && typeof args[0] === "number") return Math.atan(args[0]);
  if (funcName === "atan2" && typeof args[0] === "number" && typeof args[1] === "number")
    return Math.atan2(args[0], args[1]);
  if (funcName === "sinh" && typeof args[0] === "number") return Math.sinh(args[0]);
  if (funcName === "cosh" && typeof args[0] === "number") return Math.cosh(args[0]);
  if (funcName === "tanh" && typeof args[0] === "number") return Math.tanh(args[0]);
  if (funcName === "exp" && typeof args[0] === "number") return Math.exp(args[0]);
  if (funcName === "log" && typeof args[0] === "number") return Math.log(args[0]);
  if (funcName === "log10" && typeof args[0] === "number") return Math.log10(args[0]);
  if (funcName === "abs" && typeof args[0] === "number") return Math.abs(args[0]);
  if (funcName === "sqrt" && typeof args[0] === "number") return Math.sqrt(args[0]);
  if (funcName === "sign" && typeof args[0] === "number") return Math.sign(args[0]);
  if (funcName === "floor" && typeof args[0] === "number") return Math.floor(args[0]);
  if (funcName === "ceil" && typeof args[0] === "number") return Math.ceil(args[0]);
  if (funcName === "integer" && typeof args[0] === "number") return Math.floor(args[0]);
  if (funcName === "mod" && typeof args[0] === "number" && typeof args[1] === "number") {
    const b = args[1];
    return b !== 0 ? args[0] - Math.floor(args[0] / b) * b : null;
  }
  return undefined;
}

/** Flatten a nested ArenaValue array into a 1D list of leaf values. */
export function flattenArenaArray(val: ArenaValue): ArenaValue[] {
  if (!Array.isArray(val)) return [val];
  const result: ArenaValue[] = [];
  for (const el of val) result.push(...flattenArenaArray(el));
  return result;
}

/** Get the shape (dimension extents) of a nested ArenaValue array. */
export function getArenaArrayShape(val: ArenaValue): number[] {
  if (!Array.isArray(val)) return [];
  const shape = [val.length];
  if (val.length > 0 && Array.isArray(val[0])) {
    shape.push(...getArenaArrayShape(val[0]));
  }
  return shape;
}

/** Build a filled array with the given shape and fill value. */
export function buildArenaFilledArray(shape: number[], value: ArenaValue): ArenaValue[] {
  if (shape.length === 0) return [];
  const n = shape[0];
  if (n === undefined || n < 0 || n > 1_000_000 || !Number.isInteger(n)) return [];
  if (shape.length === 1) {
    return Array(n).fill(value) as ArenaValue[];
  }
  const rest = shape.slice(1);
  const result: ArenaValue[] = [];
  for (let i = 0; i < n; i++) result.push(buildArenaFilledArray(rest, value));
  return result;
}

/**
 * Evaluate a Modelica built-in array function at compile time.
 * Returns `undefined` if the function is not a recognized array built-in.
 */
export function evaluateArrayBuiltin(funcName: string, args: ArenaValue[]): ArenaValue | null | undefined {
  switch (funcName) {
    case "fill":
      return evalFill(args);
    case "zeros":
      return evalZerosOnes(args, 0);
    case "ones":
      return evalZerosOnes(args, 1);
    case "linspace":
      return evalLinspace(args);
    case "identity":
      return evalIdentity(args);
    case "diagonal":
      return evalDiagonal(args);
    case "transpose":
      return evalTranspose(args);
    case "symmetric":
      return evalSymmetric(args);
    case "cross":
      return evalCross(args);
    case "skew":
      return evalSkew(args);
    case "cat":
      return evalCat(args);
    case "size":
      return evalSize(args);
    case "ndims":
      return evalNdims(args);
    case "scalar":
      return evalScalar(args);
    case "vector":
      return evalVector(args);
    case "matrix":
      return evalMatrix(args);
    case "array":
      return evalArrayFunc(args);
    case "outerProduct":
      return evalOuterProduct(args);
    case "promote":
      return evalPromote(args);
    case "sum":
      return evalReduction(args, "sum");
    case "product":
      return evalReduction(args, "product");
    case "min":
      return evalReduction(args, "min");
    case "max":
      return evalReduction(args, "max");
    default:
      return undefined;
  }
}

function evalFill(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2) return null;
  const value = args[0];
  if (value === undefined) return null;
  const shape: number[] = [];
  for (let i = 1; i < args.length; i++) {
    if (typeof args[i] !== "number") return null;
    shape.push(args[i] as number);
  }
  const result = buildArenaFilledArray(shape, value);
  return result.length > 0 || shape.every((d) => d === 0) ? result : null;
}

function evalZerosOnes(args: ArenaValue[], fillVal: number): ArenaValue | null {
  const shape: number[] = [];
  for (const arg of args) {
    if (typeof arg !== "number") return null;
    shape.push(arg);
  }
  if (shape.length === 0) return null;
  return buildArenaFilledArray(shape, fillVal);
}

function evalLinspace(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 3) return null;
  const x1 = args[0],
    x2 = args[1],
    n = args[2];
  if (typeof x1 !== "number" || typeof x2 !== "number" || typeof n !== "number") return null;
  if (n < 2 || !Number.isInteger(n)) return null;
  const result: number[] = [];
  for (let i = 0; i < n; i++) result.push(x1 + ((x2 - x1) * i) / (n - 1));
  return result;
}

function evalIdentity(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || typeof args[0] !== "number") return null;
  const n = args[0];
  if (n < 0 || !Number.isInteger(n)) return null;
  const rows: ArenaValue[] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    rows.push(row);
  }
  return rows;
}

function evalDiagonal(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || !Array.isArray(args[0])) return null;
  const v = args[0] as ArenaValue[];
  const n = v.length;
  const rows: ArenaValue[] = [];
  for (let i = 0; i < n; i++) {
    const row: ArenaValue[] = [];
    for (let j = 0; j < n; j++) {
      const val = v[i];
      row.push(i === j ? (val !== undefined ? val : 0) : 0);
    }
    rows.push(row);
  }
  return rows;
}

function evalTranspose(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || !Array.isArray(args[0])) return null;
  const A = args[0] as ArenaValue[][];
  const shape = getArenaArrayShape(A);
  if (shape.length !== 2) return null;
  const [nRows, nCols] = shape;
  if (nRows == null || nCols == null) return null;
  const rows: ArenaValue[] = [];
  for (let j = 0; j < nCols; j++) {
    const row: ArenaValue[] = [];
    for (let i = 0; i < nRows; i++) {
      const r = A[i];
      const val = Array.isArray(r) ? r[j] : undefined;
      row.push(val !== undefined ? val : 0);
    }
    rows.push(row);
  }
  return rows;
}

function evalSymmetric(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1 || !Array.isArray(args[0])) return null;
  const A = args[0] as ArenaValue[][];
  const shape = getArenaArrayShape(A);
  if (shape.length !== 2 || shape[0] !== shape[1]) return null;
  const n = shape[0];
  if (n === undefined) return null;
  const rows: ArenaValue[] = [];
  for (let i = 0; i < n; i++) {
    const row: ArenaValue[] = [];
    for (let j = 0; j < n; j++) {
      const src = j >= i ? A[i] : A[j];
      const idx = j >= i ? j : i;
      const val = Array.isArray(src) ? src[idx] : undefined;
      row.push(val !== undefined ? val : 0);
    }
    rows.push(row);
  }
  return rows;
}

function evalCross(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2) return null;
  const x = args[0],
    y = args[1];
  if (!Array.isArray(x) || !Array.isArray(y) || x.length !== 3 || y.length !== 3) return null;
  const x1 = x[0],
    x2 = x[1],
    x3 = x[2];
  const y1 = y[0],
    y2 = y[1],
    y3 = y[2];
  if (
    typeof x1 !== "number" ||
    typeof x2 !== "number" ||
    typeof x3 !== "number" ||
    typeof y1 !== "number" ||
    typeof y2 !== "number" ||
    typeof y3 !== "number"
  )
    return null;
  return [x2 * y3 - x3 * y2, x3 * y1 - x1 * y3, x1 * y2 - x2 * y1];
}

function evalSkew(args: ArenaValue[]): ArenaValue | null {
  const vec = args[0];
  if (!Array.isArray(vec) || vec.length !== 3) return null;
  const x1 = vec[0],
    x2 = vec[1],
    x3 = vec[2];
  if (typeof x1 !== "number" || typeof x2 !== "number" || typeof x3 !== "number") return null;
  return [
    [0, -x3, x2],
    [x3, 0, -x1],
    [-x2, x1, 0],
  ];
}

function evalCat(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2 || typeof args[0] !== "number") return null;
  const dim = args[0];
  if (dim === 1) {
    const result: ArenaValue[] = [];
    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if (Array.isArray(a)) result.push(...a);
      else if (a != null) result.push(a);
    }
    return result;
  }
  return null;
}

function evalSize(args: ArenaValue[]): ArenaValue | null {
  const A = args[0];
  if (A === undefined) return null;
  const shape = getArenaArrayShape(A);
  if (shape.length === 0) return null;
  if (args.length >= 2 && typeof args[1] === "number") {
    const dimIndex = args[1] - 1;
    const sizeAtDim = shape[dimIndex];
    return dimIndex >= 0 && dimIndex < shape.length && sizeAtDim !== undefined ? sizeAtDim : null;
  }
  return shape;
}

function evalNdims(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const arg = args[0];
  if (arg === undefined) return null;
  return getArenaArrayShape(arg).length;
}

function evalScalar(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  const flat = flattenArenaArray(firstArg);
  const firstElem = flat[0];
  return flat.length === 1 && firstElem !== undefined ? firstElem : null;
}

function evalVector(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  return flattenArenaArray(firstArg);
}

function evalMatrix(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 1) return null;
  const A = args[0];
  if (A === undefined) return null;
  const shape = getArenaArrayShape(A);
  if (shape.length === 0) return [[A]];
  if (shape.length === 1) return [A];
  if (shape.length === 2) return A;
  return null;
}

function evalArrayFunc(args: ArenaValue[]): ArenaValue | null {
  return args.length > 0 ? args : null;
}

function evalOuterProduct(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2) return null;
  const x = args[0],
    y = args[1];
  if (!Array.isArray(x) || !Array.isArray(y)) return null;
  const rows: ArenaValue[] = [];
  for (const xi of x) {
    if (typeof xi !== "number") return null;
    const row: ArenaValue[] = [];
    for (const yj of y) {
      if (typeof yj !== "number") return null;
      row.push(xi * yj);
    }
    rows.push(row);
  }
  return rows;
}

function evalPromote(args: ArenaValue[]): ArenaValue | null {
  if (args.length < 2 || typeof args[1] !== "number") return null;
  const targetNdims = args[1];
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  let result = firstArg;
  const currentNdims = getArenaArrayShape(result).length;
  if (targetNdims <= currentNdims) return result;
  for (let i = currentNdims; i < targetNdims; i++) result = [result];
  return result;
}

function evalReduction(args: ArenaValue[], op: "sum" | "product" | "min" | "max"): ArenaValue | null {
  if (
    (op === "min" || op === "max") &&
    args.length === 2 &&
    typeof args[0] === "number" &&
    typeof args[1] === "number"
  ) {
    return op === "min" ? Math.min(args[0], args[1]) : Math.max(args[0], args[1]);
  }
  if (args.length !== 1) return null;
  const firstArg = args[0];
  if (firstArg === undefined) return null;
  const flat = flattenArenaArray(firstArg);
  if (flat.length === 0) return null;
  if (!flat.every((v) => typeof v === "number")) return null;
  const nums = flat as number[];
  switch (op) {
    case "sum":
      return nums.reduce((a, b) => a + b, 0);
    case "product":
      return nums.reduce((a, b) => a * b, 1);
    case "min":
      return Math.min(...nums);
    case "max":
      return Math.max(...nums);
  }
}

/**
 * Evaluates an expression tree stored in an DAEBuilder symbolically.
 */
export function evaluateArenaExpression(
  dae: DAEBuilder,
  exprId: number,
  parameters = new Map<string, ArenaValue>(),
  db?: QueryDB,
  scopeId?: SymbolId,
  visitedVars = new Set<number>(),
  onlyConstants = false,
  functionLookup?: (funcNameId: number, args: ArenaValue[]) => ArenaValue | null,
): ArenaValue | null {
  if (exprId < 0) return null;

  const kind = dae.getExprKind(exprId);

  switch (kind) {
    case ExprKind.RealLiteral:
      return dae.getExprRealValue(exprId);

    case ExprKind.IntLiteral:
      return dae.getExprData1(exprId);

    case ExprKind.BoolLiteral:
      return dae.getExprData1(exprId) !== 0;

    case ExprKind.StringLiteral:
      return dae.interner.resolve(dae.getExprData1(exprId)) ?? "";

    case ExprKind.EnumLiteral:
      return dae.getExprData1(exprId);

    case ExprKind.Name: {
      const name = dae.interner.resolve(dae.getExprData1(exprId));
      if (!name) return null;
      const paramVal = parameters.get(name);
      if (paramVal !== undefined) return paramVal;

      const match = name.match(/^([^[\]]+)\[([\d,]+)\]$/);
      if (match && match[1] && match[2]) {
        const root = match[1];
        const indices = match[2].split(",").map(Number);
        const rootVal = parameters.get(root);
        if (rootVal !== undefined && Array.isArray(rootVal)) {
          let current: ArenaValue = rootVal;
          let ok = true;
          for (const idx of indices) {
            if (Array.isArray(current) && idx >= 1 && idx <= current.length) {
              current = current[idx - 1] as ArenaValue;
            } else {
              ok = false;
              break;
            }
          }
          if (ok) return current;
        }
      }

      const dotIdx = name.indexOf(".");
      if (dotIdx > 0) {
        const root = name.substring(0, dotIdx);
        const rest = name.substring(dotIdx + 1);
        let obj: ArenaValue | null = parameters.get(root) ?? null;
        if (obj === null) {
          const rootIdx = dae.getVarIdxByName(root);
          if (rootIdx >= 0) {
            const bindExpr = dae.getVarExpression(rootIdx);
            if (typeof bindExpr === "number" && bindExpr >= 0) {
              if (visitedVars.has(rootIdx)) return null;
              visitedVars.add(rootIdx);
              try {
                obj = evaluateArenaExpression(dae, bindExpr, parameters, db, scopeId, visitedVars, onlyConstants);
              } finally {
                visitedVars.delete(rootIdx);
              }
            }
          }
        }
        if (obj !== null && isArenaObject(obj)) {
          const segments = rest.split(".");
          let current: ArenaValue | undefined = obj;
          for (const seg of segments) {
            if (!isArenaObject(current)) return null;
            current = current.fields.get(seg);
            if (current === undefined) return null;
          }
          return current ?? null;
        }
      }

      const vIdx = dae.getVarIdxByName(name);
      if (vIdx < 0 && dae.hasArrayElements(name)) {
        const elements = dae.getArrayElementIndices(name);
        const result: any[] = [];
        for (const idx of elements) {
          if (dae.isVarFixed(idx)) {
            result.push(dae.getVarStartValue(idx));
          } else {
            const variability = dae.getVarVariability(idx);
            if (variability === Variability.Constant || (!onlyConstants && variability === Variability.Parameter)) {
              const bindingExprId = dae.getVarExpression(idx);
              if (typeof bindingExprId === "number" && bindingExprId >= 0) {
                if (!visitedVars.has(idx)) {
                  visitedVars.add(idx);
                  try {
                    result.push(
                      evaluateArenaExpression(
                        dae,
                        bindingExprId,
                        parameters,
                        db,
                        scopeId,
                        visitedVars,
                        onlyConstants,
                        functionLookup,
                      ),
                    );
                  } finally {
                    visitedVars.delete(idx);
                  }
                } else {
                  result.push(null);
                }
              } else {
                result.push(dae.getVarStartValue(idx));
              }
            } else {
              result.push(null);
            }
          }
        }
        return result;
      }

      if (vIdx >= 0) {
        if (dae.isVarFixed(vIdx)) {
          return dae.getVarStartValue(vIdx);
        }
        const variability = dae.getVarVariability(vIdx);
        if (variability === Variability.Constant || (!onlyConstants && variability === Variability.Parameter)) {
          const bindingExprId = dae.getVarExpression(vIdx);
          if (typeof bindingExprId === "number" && bindingExprId >= 0) {
            if (visitedVars.has(vIdx)) return null;
            visitedVars.add(vIdx);
            try {
              return evaluateArenaExpression(
                dae,
                bindingExprId,
                parameters,
                db,
                scopeId,
                visitedVars,
                onlyConstants,
                functionLookup,
              );
            } finally {
              visitedVars.delete(vIdx);
            }
          }
          return dae.getVarStartValue(vIdx);
        }
      }

      if (db && scopeId !== undefined) {
        const resolveName = db.query<(q: string) => SymbolEntry | null>("resolveName", scopeId);
        if (resolveName) {
          const resolved = resolveName(name);
          if (resolved) {
            if (resolved.kind === "Component") {
              if (resolved.metadata) {
                const csvValue = resolved.metadata.csvValue;
                if (csvValue !== undefined) {
                  return csvValue as ArenaValue;
                }
              }
              const mod = db.query<any | null>("effectiveModification", resolved.id);
              if (mod && mod.bindingExpression) {
                const variability = resolved.metadata?.variability;
                if (variability === "constant" || (!onlyConstants && variability === "parameter")) {
                  const val = db.evaluate(mod.bindingExpression, resolved.parentId);
                  if (val !== null && val !== undefined) {
                    return val as ArenaValue;
                  }
                }
              }
            }
          }
        }
      }

      return null;
    }

    case ExprKind.Unary: {
      const op = dae.getExprData1(exprId) as UnaryOp;
      const operand = evaluateArenaExpression(
        dae,
        dae.getExprLeft(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
      );
      if (operand === null) return null;

      if (op === UnaryOp.Negate && typeof operand === "number") return -operand;
      if (op === UnaryOp.Not && typeof operand === "boolean") return !operand;
      return null;
    }

    case ExprKind.Binary: {
      const op = dae.getExprData1(exprId) as BinOp;
      const left = evaluateArenaExpression(
        dae,
        dae.getExprLeft(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      const right = evaluateArenaExpression(
        dae,
        dae.getExprRight(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      if (left === null || right === null) return null;

      if (Array.isArray(left) || Array.isArray(right) || (typeof left === "number" && typeof right === "number")) {
        const applyBinOp = (a: ArenaValue, b: ArenaValue, op: BinOp): ArenaValue | null => {
          if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return null;
            const res = a.map((val, idx) => {
              const bVal = b[idx];
              if (bVal === undefined) return null;
              return applyBinOp(val, bVal, op);
            });
            if (res.includes(null)) return null;
            return res as ArenaValue;
          } else if (Array.isArray(a)) {
            const res = a.map((val) => applyBinOp(val, b, op));
            if (res.includes(null)) return null;
            return res as ArenaValue;
          } else if (Array.isArray(b)) {
            const res = b.map((val) => applyBinOp(a, val, op));
            if (res.includes(null)) return null;
            return res as ArenaValue;
          }

          if (typeof a === "number" && typeof b === "number") {
            switch (op) {
              case BinOp.Add:
              case BinOp.ElemAdd:
                return a + b;
              case BinOp.Sub:
              case BinOp.ElemSub:
                return a - b;
              case BinOp.Mul:
              case BinOp.ElemMul:
                return a * b;
              case BinOp.Div:
              case BinOp.ElemDiv:
                return a / b;
              case BinOp.Pow:
              case BinOp.ElemPow:
                return Math.pow(a, b);
              case BinOp.Eq:
                return a === b;
              case BinOp.Neq:
                return a !== b;
              case BinOp.Lt:
                return a < b;
              case BinOp.Lte:
                return a <= b;
              case BinOp.Gt:
                return a > b;
              case BinOp.Gte:
                return a >= b;
            }
          }
          return null;
        };
        const res = applyBinOp(left, right, op);
        if (res !== null) return res;
      }

      if (typeof left === "boolean" && typeof right === "boolean") {
        switch (op) {
          case BinOp.And:
            return left && right;
          case BinOp.Or:
            return left || right;
          case BinOp.Eq:
            return left === right;
          case BinOp.Neq:
            return left !== right;
        }
      }
      return null;
    }

    case ExprKind.IfElse: {
      const cond = evaluateArenaExpression(
        dae,
        dae.getExprData1(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      if (typeof cond === "boolean") {
        return cond
          ? evaluateArenaExpression(
              dae,
              dae.getExprLeft(exprId),
              parameters,
              db,
              scopeId,
              visitedVars,
              onlyConstants,
              functionLookup,
            )
          : evaluateArenaExpression(
              dae,
              dae.getExprRight(exprId),
              parameters,
              db,
              scopeId,
              visitedVars,
              onlyConstants,
              functionLookup,
            );
      }
      return null;
    }

    case ExprKind.Call: {
      const funcName = dae.interner.resolve(dae.getExprData1(exprId));
      if (!funcName) return null;
      const argCount = dae.getExprRight(exprId);
      const firstArg = dae.getExprLeft(exprId);
      const argIds = getSequenceElements(dae, exprId, argCount, firstArg);

      if ((funcName === "/*Real*/" || funcName === "/*Integer*/") && argCount === 1) {
        const firstArgId = argIds[0];
        if (firstArgId !== undefined) {
          return evaluateArenaExpression(
            dae,
            firstArgId,
            parameters,
            db,
            scopeId,
            visitedVars,
            onlyConstants,
            functionLookup,
          );
        }
      }

      if ((funcName === "size" || funcName === "ndims") && argCount >= 1) {
        const firstArgId = argIds[0];
        if (firstArgId !== undefined && dae.getExprKind(firstArgId) === ExprKind.Name) {
          const varName = dae.interner.resolve(dae.getExprData1(firstArgId));
          if (varName) {
            let shape: number[] | null = null;
            const varIdx = dae.getVarIdxByName(varName);
            if (varIdx >= 0) {
              const varShape = dae.getVarShape(varIdx);
              if (varShape && varShape.length > 0 && !varShape.includes(0)) shape = varShape;
            } else if (dae.hasArrayElements(varName)) {
              const elements = dae.getArrayElementIndices(varName);
              if (elements.length > 0) {
                const lastIdx = elements[elements.length - 1];
                if (lastIdx !== undefined) {
                  const lastElemName = dae.getVarName(lastIdx);
                  const match = lastElemName.match(/\[([\d,]+)\]$/);
                  if (match && match[1]) {
                    shape = match[1].split(",").map(Number);
                  }
                }
              }
            }
            if (shape && shape.length > 0 && !shape.includes(0)) {
              if (funcName === "ndims") return shape.length;
              if (funcName === "size") {
                if (argCount === 1) return shape;
                const dimArgId = argIds[1];
                if (dimArgId !== undefined) {
                  const dim = evaluateArenaExpression(
                    dae,
                    dimArgId,
                    parameters,
                    db,
                    scopeId,
                    visitedVars,
                    onlyConstants,
                    functionLookup,
                  );
                  if (typeof dim === "number" && dim >= 1 && dim <= shape.length) {
                    return shape[dim - 1] ?? null;
                  }
                }
              }
            }
          }
        } else if (firstArgId !== undefined && dae.getExprKind(firstArgId) === ExprKind.Call) {
          const callFuncNameId = dae.getExprData1(firstArgId);
          const fnDae = dae.functions.get(callFuncNameId);
          if (fnDae) {
            let shape: number[] | null = null;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === 2 /* Output */) {
                const varShape = fnDae.getVarShape(i);
                if (varShape && varShape.length > 0 && !varShape.includes(0)) shape = varShape;
                break;
              }
            }
            if (shape && shape.length > 0 && !shape.includes(0)) {
              if (funcName === "ndims") return shape.length;
              if (funcName === "size") {
                if (argCount === 1) return shape;
                const dimArgId = argIds[1];
                if (dimArgId !== undefined) {
                  const dim = evaluateArenaExpression(
                    dae,
                    dimArgId,
                    parameters,
                    db,
                    scopeId,
                    visitedVars,
                    onlyConstants,
                    functionLookup,
                  );
                  if (typeof dim === "number" && dim >= 1 && dim <= shape.length) {
                    return shape[dim - 1] ?? null;
                  }
                }
              }
            }
          }
        } else if (firstArgId !== undefined && dae.getExprKind(firstArgId) === ExprKind.ArrayCtor) {
          const elementsCount = dae.getExprData1(firstArgId);
          const shape = [elementsCount];
          const firstElementId = dae.getExprLeft(firstArgId);
          if (firstElementId >= 0 && dae.getExprKind(firstElementId) === ExprKind.ArrayCtor) {
            shape.push(dae.getExprData1(firstElementId));
          }
          if (funcName === "ndims") return shape.length;
          if (funcName === "size") {
            if (argCount === 1) return shape;
            const dimArgId = argIds[1];
            if (dimArgId !== undefined) {
              const dim = evaluateArenaExpression(
                dae,
                dimArgId,
                parameters,
                db,
                scopeId,
                visitedVars,
                onlyConstants,
                functionLookup,
              );
              if (typeof dim === "number" && dim >= 1 && dim <= shape.length) {
                return shape[dim - 1] ?? null;
              }
            }
          }
        }
      }

      const args = argIds.map((id) =>
        evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars, onlyConstants, functionLookup),
      );
      if (args.some((a) => a === null)) return null;

      const mathRes = evaluateBuiltinMathFunction(funcName, args as ArenaValue[]);
      if (mathRes !== undefined) return mathRes;
      if (funcName === "rem" && typeof args[0] === "number" && typeof args[1] === "number") {
        const b = args[1];
        return b !== 0 ? args[0] - Math.trunc(args[0] / b) * b : null;
      }
      if (funcName === "div" && typeof args[0] === "number" && typeof args[1] === "number") {
        return args[1] !== 0 ? Math.trunc(args[0] / args[1]) : null;
      }
      if (funcName === "String") return String(args[0]);
      if (funcName === "noEvent" && args.length === 1) return args[0];
      if (funcName === "Real" && args.length === 1) return args[0];
      if (funcName === "Integer" && args.length === 1) {
        if (typeof args[0] === "number") return Math.floor(args[0]);
        return args[0];
      }
      if (funcName === "homotopy" && args.length >= 1) return args[0];
      if (funcName === "smooth" && args.length >= 2) return args[1];

      const arrayResult = evaluateArrayBuiltin(funcName, args as ArenaValue[]);
      if (arrayResult !== undefined) return arrayResult;

      if (functionLookup) {
        const funcNameId = dae.getExprData1(exprId);
        const userFuncResult = functionLookup(funcNameId, args as ArenaValue[]);
        if (userFuncResult !== null) {
          const fnDae = dae.functions.get(funcNameId);
          if (fnDae && Array.isArray(userFuncResult)) {
            let outCount = 0;
            for (let i = 0; i < fnDae.varCount; i++) {
              if (fnDae.getVarCausality(i) === 2 /* Output */) outCount++;
            }
            if (outCount > 1 && userFuncResult.length > 0) {
              return userFuncResult[0] as ArenaValue;
            }
          }
          return userFuncResult;
        }
      }

      return null;
    }

    case ExprKind.Der:
    case ExprKind.Pre:
      return null;

    case ExprKind.ArrayCtor: {
      const count = dae.getExprData1(exprId);
      const firstElem = dae.getExprLeft(exprId);
      const elemIds = getSequenceElements(dae, exprId, count, firstElem);
      const elements = elemIds.map((id) =>
        evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars, onlyConstants, functionLookup),
      );
      if (elements.some((e) => e === null)) return null;
      return elements as ArenaValue[];
    }

    case ExprKind.Range: {
      const start = evaluateArenaExpression(
        dae,
        dae.getExprData1(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
        functionLookup,
      );
      const stepId = dae.getExprLeft(exprId);
      const step =
        stepId >= 0 ? evaluateArenaExpression(dae, stepId, parameters, db, scopeId, visitedVars, onlyConstants) : 1;
      const stop = evaluateArenaExpression(
        dae,
        dae.getExprRight(exprId),
        parameters,
        db,
        scopeId,
        visitedVars,
        onlyConstants,
      );

      if (typeof start === "number" && typeof step === "number" && typeof stop === "number") {
        const arr: number[] = [];
        if (step > 0) {
          for (let i = start; i <= stop; i += step) arr.push(i);
        } else if (step < 0) {
          for (let i = start; i >= stop; i += step) arr.push(i);
        }
        return arr;
      }
      return null;
    }

    case ExprKind.Subscript: {
      const baseId = dae.getExprData1(exprId);
      const base = evaluateArenaExpression(dae, baseId, parameters, db, scopeId, visitedVars, onlyConstants);
      if (!Array.isArray(base)) {
        return null;
      }

      const idxCount = dae.getExprRight(exprId);
      const firstIdx = dae.getExprLeft(exprId);
      const idxIds = getSequenceElements(dae, exprId, idxCount, firstIdx);

      let current: ArenaValue = base;
      for (const id of idxIds) {
        if (!Array.isArray(current)) {
          return null;
        }
        const idx = evaluateArenaExpression(dae, id, parameters, db, scopeId, visitedVars, onlyConstants);
        if (typeof idx !== "number" || idx < 1 || idx > current.length) {
          return null;
        }
        current = current[idx - 1] as ArenaValue;
      }
      return current;
    }

    case ExprKind.Object: {
      const fieldCount = dae.getExprData1(exprId);
      const fields = new Map<string, ArenaValue>();
      if (fieldCount > 0) {
        const firstName = dae.interner.resolve(dae.getExprRight(exprId));
        const firstVal = evaluateArenaExpression(
          dae,
          dae.getExprLeft(exprId),
          parameters,
          db,
          scopeId,
          visitedVars,
          onlyConstants,
        );
        if (firstName && firstVal !== null) fields.set(firstName, firstVal);
        for (let i = 1; i < fieldCount; i++) {
          const fieldName = dae.interner.resolve(dae.getExprData1(exprId + i));
          const fieldVal = evaluateArenaExpression(
            dae,
            dae.getExprLeft(exprId + i),
            parameters,
            db,
            scopeId,
            visitedVars,
            onlyConstants,
          );
          if (fieldName && fieldVal !== null) fields.set(fieldName, fieldVal);
        }
      }
      return { __kind: "object" as const, fields };
    }
  }

  return null;
}
