// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion, no-case-declarations */
/**
 * Static Tape (Wengert List) for Algorithmic Differentiation.
 *
 * This tape uses a pure Data-Oriented Design (DoD) layout.
 * Operations are packed into parallel typed arrays (`Int32Array` and `Float64Array`),
 * eliminating object allocations and pointer chasing.
 */

import type { DAEArenaBuilder } from "../dae-arena.js";
import { BinOp, ExprKind, UnaryOp } from "../dae-arena.js";
import { StringInterner } from "../interner.js";

export enum TapeOpKind {
  Const = 0,
  Var = 1,
  Add = 2,
  Sub = 3,
  Mul = 4,
  Div = 5,
  Pow = 6,
  Neg = 7,
  Sin = 8,
  Cos = 9,
  Tan = 10,
  Exp = 11,
  Log = 12,
  Sqrt = 13,
  // ── Vector ops: SIMD-style operations on contiguous blocks ──
  VecVar = 14,
  VecConst = 15,
  VecAdd = 16,
  VecSub = 17,
  VecMul = 18,
  VecNeg = 19,
  VecSubscript = 20,
  Nop = 21,
}

export const TAPE_STRIDE = 4;
export const TAPE_OP_KIND = 0;
export const TAPE_DATA1 = 1;
export const TAPE_DATA2 = 2;
export const TAPE_DATA3 = 3;

export function formatCDouble(v: number): string {
  if (!isFinite(v)) return v === Infinity ? "INFINITY" : v === -Infinity ? "(-INFINITY)" : "NAN";
  const s = v.toString();
  return !s.includes(".") && !s.includes("e") && !s.includes("E") ? s + ".0" : s;
}

export class StaticTapeBuilder {
  public capacity = 1024;
  public opData = new Int32Array(this.capacity * TAPE_STRIDE);
  public valData = new Float64Array(this.capacity);
  public length = 0;
  private cache = new Map<string, number>();

  constructor(public interner = new StringInterner()) {}

  private ensureCapacity(size: number) {
    if (this.length + size > this.capacity) {
      this.capacity = Math.max(this.capacity * 2, this.length + size);
      const newOpData = new Int32Array(this.capacity * TAPE_STRIDE);
      newOpData.set(this.opData);
      this.opData = newOpData;
      const newValData = new Float64Array(this.capacity);
      newValData.set(this.valData);
      this.valData = newValData;
    }
  }

  public pushScalarOp(kind: TapeOpKind, data1 = 0, data2 = 0, data3 = 0, val = 0): number {
    const key = `${kind}:${data1}:${data2}:${data3}:${val}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached; // Deduplicate shared expressions

    this.ensureCapacity(1);
    const idx = this.length++;
    const offset = idx * TAPE_STRIDE;
    this.opData[offset + TAPE_OP_KIND] = kind;
    this.opData[offset + TAPE_DATA1] = data1;
    this.opData[offset + TAPE_DATA2] = data2;
    this.opData[offset + TAPE_DATA3] = data3;
    if (kind === TapeOpKind.Const) {
      this.valData[idx] = val;
    }

    this.cache.set(key, idx);
    return idx;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public pushVecOp(kind: TapeOpKind, size: number, data1 = 0, _data2 = 0, data3 = 0, vals?: number[]): number {
    this.ensureCapacity(size);
    const idx = this.length;
    const offset = idx * TAPE_STRIDE;
    this.opData[offset + TAPE_OP_KIND] = kind;
    this.opData[offset + TAPE_DATA1] = data1;
    this.opData[offset + TAPE_DATA2] = size;
    this.opData[offset + TAPE_DATA3] = data3;

    if (kind === TapeOpKind.VecConst && vals) {
      for (let i = 0; i < size; i++) {
        this.valData[idx + i] = vals[i] ?? 0;
      }
    }

    for (let i = 1; i < size; i++) {
      this.opData[(idx + i) * TAPE_STRIDE + TAPE_OP_KIND] = TapeOpKind.Nop;
    }
    this.length += size;
    return idx;
  }

  public addExpression(exprId: number, arena: DAEArenaBuilder): number {
    if (exprId < 0) return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);

    const kind = arena.getExprKind(exprId);

    switch (kind) {
      case ExprKind.RealLiteral:
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, arena.getExprRealValue(exprId));
      case ExprKind.IntLiteral:
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, arena.getExprData1(exprId));
      case ExprKind.BoolLiteral:
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, arena.getExprData1(exprId));
      case ExprKind.Name:
        return this.pushScalarOp(TapeOpKind.Var, arena.getExprData1(exprId));
      case ExprKind.Unary:
        const uop = arena.getExprData1(exprId);
        const operand = this.addExpression(arena.getExprLeft(exprId), arena);
        if (uop === UnaryOp.Negate) {
          return this.pushScalarOp(TapeOpKind.Neg, operand);
        }
        return operand;
      case ExprKind.Negate:
        return this.pushScalarOp(TapeOpKind.Neg, this.addExpression(arena.getExprLeft(exprId), arena));
      case ExprKind.Binary:
        const bop = arena.getExprData1(exprId);
        const lhs = this.addExpression(arena.getExprLeft(exprId), arena);
        const rhs = this.addExpression(arena.getExprRight(exprId), arena);
        switch (bop) {
          case BinOp.Add:
          case BinOp.ElemAdd:
            return this.pushScalarOp(TapeOpKind.Add, lhs, rhs);
          case BinOp.Sub:
          case BinOp.ElemSub:
            return this.pushScalarOp(TapeOpKind.Sub, lhs, rhs);
          case BinOp.Mul:
          case BinOp.ElemMul:
            return this.pushScalarOp(TapeOpKind.Mul, lhs, rhs);
          case BinOp.Div:
          case BinOp.ElemDiv:
            return this.pushScalarOp(TapeOpKind.Div, lhs, rhs);
          case BinOp.Pow:
          case BinOp.ElemPow:
            return this.pushScalarOp(TapeOpKind.Pow, lhs, rhs);
          default:
            return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);
        }
      case ExprKind.Call:
        const funcNameId = arena.getExprData1(exprId);
        const funcName = this.interner.resolve(funcNameId);
        const argCount = arena.getExprRight(exprId);
        if (argCount === 1) {
          const arg = this.addExpression(arena.getExprLeft(exprId), arena);
          switch (funcName) {
            case "sin":
            case "Modelica.Math.sin":
              return this.pushScalarOp(TapeOpKind.Sin, arg);
            case "cos":
            case "Modelica.Math.cos":
              return this.pushScalarOp(TapeOpKind.Cos, arg);
            case "tan":
            case "Modelica.Math.tan":
              return this.pushScalarOp(TapeOpKind.Tan, arg);
            case "exp":
            case "Modelica.Math.exp":
              return this.pushScalarOp(TapeOpKind.Exp, arg);
            case "log":
            case "Modelica.Math.log":
              return this.pushScalarOp(TapeOpKind.Log, arg);
            case "sqrt":
            case "Modelica.Math.sqrt":
              return this.pushScalarOp(TapeOpKind.Sqrt, arg);
          }
        }
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);
      case ExprKind.ArrayCtor:
      case ExprKind.Tuple:
        const count = arena.getExprData1(exprId);
        const firstElemId = arena.getExprLeft(exprId);
        let lastIdx = this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);
        for (let i = 0; i < count; i++) {
          const elemExprId = arena.getExprLeft(firstElemId + i);
          lastIdx = this.addExpression(elemExprId, arena);
        }
        return lastIdx;
      case ExprKind.Subscript:
        const baseId = arena.getExprData1(exprId);
        const firstIdx = arena.getExprLeft(exprId);
        const indexCount = arena.getExprRight(exprId);

        if (indexCount === 1) {
          const subExprId = arena.getExprLeft(firstIdx); // Tuple element
          if (arena.getExprKind(subExprId) === ExprKind.IntLiteral) {
            const subVal = arena.getExprData1(subExprId);
            if (arena.getExprKind(baseId) === ExprKind.Name) {
              const baseName = this.interner.resolve(arena.getExprData1(baseId)) || "";
              return this.pushScalarOp(TapeOpKind.Var, this.interner.intern(`${baseName}[${subVal}]`));
            }
          }
        }
        if (arena.getExprKind(baseId) === ExprKind.Name) {
          return this.pushScalarOp(TapeOpKind.Var, arena.getExprData1(baseId));
        }
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);

      default:
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);
    }
  }

  public addArrayExpression(exprId: number, arena: DAEArenaBuilder): number[] {
    const kind = arena.getExprKind(exprId);
    if (kind === ExprKind.ArrayCtor || kind === ExprKind.Tuple) {
      const count = arena.getExprData1(exprId);
      const firstElemId = arena.getExprLeft(exprId);
      const indices: number[] = [];
      for (let i = 0; i < count; i++) {
        const elemExprId = arena.getExprLeft(firstElemId + i);
        indices.push(this.addExpression(elemExprId, arena));
      }
      return indices;
    }
    return [this.addExpression(exprId, arena)];
  }

  public walkArrayVectorized(exprId: number, arena: DAEArenaBuilder): { startIdx: number; size: number } {
    const kind = arena.getExprKind(exprId);
    if (kind !== ExprKind.ArrayCtor && kind !== ExprKind.Tuple) {
      return { startIdx: this.addExpression(exprId, arena), size: 1 };
    }

    const count = arena.getExprData1(exprId);
    if (count === 0) return { startIdx: this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0), size: 1 };

    const firstElemId = arena.getExprLeft(exprId);
    const flatElems = [];
    for (let i = 0; i < count; i++) {
      flatElems.push(arena.getExprLeft(firstElemId + i));
    }

    const allConst = flatElems.every((e) => {
      const k = arena.getExprKind(e);
      return k === ExprKind.RealLiteral || k === ExprKind.IntLiteral;
    });

    if (allConst && count > 1) {
      const vals = flatElems.map((e) => {
        const k = arena.getExprKind(e);
        return k === ExprKind.RealLiteral ? arena.getExprRealValue(e) : arena.getExprData1(e);
      });
      return { startIdx: this.pushVecOp(TapeOpKind.VecConst, count, 0, 0, 0, vals), size: count };
    }

    const allNamed = flatElems.every((e) => arena.getExprKind(e) === ExprKind.Name);
    if (allNamed && count > 1) {
      const firstName = this.interner.resolve(arena.getExprData1(flatElems[0]!)) || "";
      const bracketPos = firstName.indexOf("[");
      const baseName = bracketPos >= 0 ? firstName.substring(0, bracketPos) : firstName;
      return { startIdx: this.pushVecOp(TapeOpKind.VecVar, count, this.interner.intern(baseName)), size: count };
    }

    const startIdx = this.length;
    for (const elem of flatElems) {
      this.addExpression(elem, arena);
    }
    return { startIdx, size: count };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public pushOp(op: any): number {
    switch (op.type) {
      case "const":
        return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, op.val);
      case "var":
        return this.pushScalarOp(TapeOpKind.Var, this.interner.intern(op.name));
      case "add":
        return this.pushScalarOp(TapeOpKind.Add, op.a, op.b);
      case "sub":
        return this.pushScalarOp(TapeOpKind.Sub, op.a, op.b);
      case "mul":
        return this.pushScalarOp(TapeOpKind.Mul, op.a, op.b);
      case "div":
        return this.pushScalarOp(TapeOpKind.Div, op.a, op.b);
      case "pow":
        return this.pushScalarOp(TapeOpKind.Pow, op.a, op.b);
      case "neg":
        return this.pushScalarOp(TapeOpKind.Neg, op.a);
      case "sin":
        return this.pushScalarOp(TapeOpKind.Sin, op.a);
      case "cos":
        return this.pushScalarOp(TapeOpKind.Cos, op.a);
      case "tan":
        return this.pushScalarOp(TapeOpKind.Tan, op.a);
      case "exp":
        return this.pushScalarOp(TapeOpKind.Exp, op.a);
      case "log":
        return this.pushScalarOp(TapeOpKind.Log, op.a);
      case "sqrt":
        return this.pushScalarOp(TapeOpKind.Sqrt, op.a);
      case "vec_var":
        return this.pushVecOp(TapeOpKind.VecVar, op.size, this.interner.intern(op.baseName));
      case "vec_const":
        return this.pushVecOp(TapeOpKind.VecConst, op.size, 0, 0, 0, op.vals);
      case "vec_add":
        return this.pushVecOp(TapeOpKind.VecAdd, op.size, op.a, 0, op.b);
      case "vec_sub":
        return this.pushVecOp(TapeOpKind.VecSub, op.size, op.a, 0, op.b);
      case "vec_mul":
        return this.pushVecOp(TapeOpKind.VecMul, op.size, op.a, 0, op.b);
      case "vec_neg":
        return this.pushVecOp(TapeOpKind.VecNeg, op.size, op.a);
      case "vec_subscript":
        return this.pushScalarOp(TapeOpKind.VecSubscript, op.a, 0, op.offset);
    }
    return this.pushScalarOp(TapeOpKind.Nop, 0, 0, 0, 0);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public walk(expr: any): number {
    if (typeof expr === "number") return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, expr);
    if (!expr) return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);

    if ("value" in expr && typeof expr.value === "number") {
      return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, expr.value);
    }
    if ("value" in expr && typeof expr.value === "boolean") {
      return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, expr.value ? 1 : 0);
    }
    if (expr.type === "ModelicaNameExpression" || expr.name) {
      return this.pushScalarOp(TapeOpKind.Var, this.interner.intern(expr.name));
    }
    if ("operator" in expr && "operand" in expr) {
      const a = this.walk(expr.operand);
      return this.pushScalarOp(TapeOpKind.Neg, a);
    }
    if ("operator" in expr && "operand1" in expr && "operand2" in expr) {
      const a = this.walk(expr.operand1);
      const b = this.walk(expr.operand2);
      if (expr.operator <= 1) return this.pushScalarOp(TapeOpKind.Add, a, b);
      if (expr.operator <= 3) return this.pushScalarOp(TapeOpKind.Sub, a, b);
      if (expr.operator <= 5) return this.pushScalarOp(TapeOpKind.Mul, a, b);
      if (expr.operator <= 7) return this.pushScalarOp(TapeOpKind.Div, a, b);
      if (expr.operator <= 9) return this.pushScalarOp(TapeOpKind.Pow, a, b);
      return this.pushScalarOp(TapeOpKind.Add, a, b);
    }
    if (expr.functionName) {
      const a = this.walk(expr.args[0]);
      switch (expr.functionName) {
        case "sin":
        case "Modelica.Math.sin":
          return this.pushScalarOp(TapeOpKind.Sin, a);
        case "cos":
        case "Modelica.Math.cos":
          return this.pushScalarOp(TapeOpKind.Cos, a);
        case "tan":
        case "Modelica.Math.tan":
          return this.pushScalarOp(TapeOpKind.Tan, a);
        case "exp":
        case "Modelica.Math.exp":
          return this.pushScalarOp(TapeOpKind.Exp, a);
        case "log":
        case "Modelica.Math.log":
          return this.pushScalarOp(TapeOpKind.Log, a);
        case "sqrt":
          return this.pushScalarOp(TapeOpKind.Sqrt, a);
      }
    }

    // Arrays / Tuples
    if (expr.elements || expr.flatElements) {
      const elems = expr.elements || expr.flatElements;
      let lastIdx = 0;
      for (const e of elems) lastIdx = this.walk(e);
      return lastIdx;
    }

    // Subscripts
    if (expr.subscripts && expr.base) {
      return this.pushScalarOp(
        TapeOpKind.Var,
        this.interner.intern((expr.base.name || "") + "[" + (expr.subscripts[0]?.value || 0) + "]"),
      );
    }

    return this.pushScalarOp(TapeOpKind.Const, 0, 0, 0, 0);
  }

  public getDependencies(outputIndex: number): Set<string> {
    const deps = new Set<string>();
    if (outputIndex < 0 || outputIndex >= this.length) return deps;

    const visited = new Set<number>();
    const stack = [outputIndex];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);

      const offset = idx * TAPE_STRIDE;
      const kind = this.opData[offset + TAPE_OP_KIND]!;
      const a = this.opData[offset + TAPE_DATA1]!;
      const b = this.opData[offset + TAPE_DATA2]!;

      if (kind === TapeOpKind.Var || kind === TapeOpKind.VecVar) {
        deps.add(this.interner.resolve(a) || "");
      }

      switch (kind) {
        case TapeOpKind.Add:
        case TapeOpKind.Sub:
        case TapeOpKind.Mul:
        case TapeOpKind.Div:
        case TapeOpKind.Pow:
          stack.push(a);
          stack.push(b);
          break;
        case TapeOpKind.Neg:
        case TapeOpKind.Sin:
        case TapeOpKind.Cos:
        case TapeOpKind.Tan:
        case TapeOpKind.Exp:
        case TapeOpKind.Log:
        case TapeOpKind.Sqrt:
          stack.push(a);
          break;
      }
    }
    return deps;
  }

  public emitForwardC(varResolver: (name: string) => string): string[] {
    const lines: string[] = [];
    if (this.length === 0) return lines;
    lines.push(`  double t[${this.length}];`);

    for (let i = 0; i < this.length; i++) {
      const offset = i * TAPE_STRIDE;
      const kind = this.opData[offset + TAPE_OP_KIND]!;
      const a = this.opData[offset + TAPE_DATA1]!;
      const b = this.opData[offset + TAPE_DATA2]!;
      const c = this.opData[offset + TAPE_DATA3]!;

      let rhs = "0.0";
      switch (kind) {
        case TapeOpKind.Const:
          rhs = formatCDouble(this.valData[i]!);
          break;
        case TapeOpKind.Var:
          rhs = varResolver(this.interner.resolve(a) || "");
          break;
        case TapeOpKind.Add:
          rhs = `t[${a}] + t[${b}]`;
          break;
        case TapeOpKind.Sub:
          rhs = `t[${a}] - t[${b}]`;
          break;
        case TapeOpKind.Mul:
          rhs = `t[${a}] * t[${b}]`;
          break;
        case TapeOpKind.Div:
          rhs = `t[${a}] / t[${b}]`;
          break;
        case TapeOpKind.Pow:
          rhs = `pow(t[${a}], t[${b}])`;
          break;
        case TapeOpKind.Neg:
          rhs = `-t[${a}]`;
          break;
        case TapeOpKind.Sin:
          rhs = `sin(t[${a}])`;
          break;
        case TapeOpKind.Cos:
          rhs = `cos(t[${a}])`;
          break;
        case TapeOpKind.Tan:
          rhs = `tan(t[${a}])`;
          break;
        case TapeOpKind.Exp:
          rhs = `exp(t[${a}])`;
          break;
        case TapeOpKind.Log:
          rhs = `log(t[${a}])`;
          break;
        case TapeOpKind.Sqrt:
          rhs = `sqrt(t[${a}])`;
          break;
        case TapeOpKind.VecVar:
          const baseName = this.interner.resolve(a) || "";
          lines.push(`  for (int _k = 0; _k < ${b}; _k++) t[${i}+_k] = ${varResolver(`${baseName}[_k+1]`)};`);
          continue;
        case TapeOpKind.VecConst:
          for (let k = 0; k < b; k++) {
            lines.push(`  t[${i + k}] = ${formatCDouble(this.valData[i + k]!)};`);
          }
          continue;
        case TapeOpKind.VecAdd:
          lines.push(`  for (int _k = 0; _k < ${b}; _k++) t[${i}+_k] = t[${a}+_k] + t[${c}+_k];`);
          continue;
        case TapeOpKind.VecSub:
          lines.push(`  for (int _k = 0; _k < ${b}; _k++) t[${i}+_k] = t[${a}+_k] - t[${c}+_k];`);
          continue;
        case TapeOpKind.VecMul:
          lines.push(`  for (int _k = 0; _k < ${b}; _k++) t[${i}+_k] = t[${a}+_k] * t[${c}+_k];`);
          continue;
        case TapeOpKind.VecNeg:
          lines.push(`  for (int _k = 0; _k < ${b}; _k++) t[${i}+_k] = -t[${a}+_k];`);
          continue;
        case TapeOpKind.VecSubscript:
          rhs = `t[${a + c}]`;
          break;
        case TapeOpKind.Nop:
          continue;
      }
      lines.push(`  t[${i}] = ${rhs};`);
    }
    return lines;
  }

  public emitForwardDirectionalC(): string[] {
    const lines: string[] = [];
    if (this.length === 0) return lines;

    for (let i = 0; i < this.length; i++) {
      const offset = i * TAPE_STRIDE;
      const kind = this.opData[offset + TAPE_OP_KIND]!;
      const a = this.opData[offset + TAPE_DATA1]!;
      const b = this.opData[offset + TAPE_DATA2]!;

      if (kind === TapeOpKind.Const || kind === TapeOpKind.Var || kind === TapeOpKind.Nop || kind >= TapeOpKind.VecVar)
        continue;

      let rhs = "0.0";
      switch (kind) {
        case TapeOpKind.Add:
          rhs = `dot_t[${a}] + dot_t[${b}]`;
          break;
        case TapeOpKind.Sub:
          rhs = `dot_t[${a}] - dot_t[${b}]`;
          break;
        case TapeOpKind.Mul:
          rhs = `dot_t[${a}] * t[${b}] + t[${a}] * dot_t[${b}]`;
          break;
        case TapeOpKind.Div:
          rhs = `(dot_t[${a}] * t[${b}] - t[${a}] * dot_t[${b}]) / (t[${b}] * t[${b}])`;
          break;
        case TapeOpKind.Pow:
          rhs = `t[${i}] * (dot_t[${b}] * log(t[${a}]) + t[${b}] * dot_t[${a}] / t[${a}])`;
          break;
        case TapeOpKind.Neg:
          rhs = `-dot_t[${a}]`;
          break;
        case TapeOpKind.Sin:
          rhs = `dot_t[${a}] * cos(t[${a}])`;
          break;
        case TapeOpKind.Cos:
          rhs = `-dot_t[${a}] * sin(t[${a}])`;
          break;
        case TapeOpKind.Tan:
          rhs = `dot_t[${a}] * (1.0 + t[${i}] * t[${i}])`;
          break;
        case TapeOpKind.Exp:
          rhs = `dot_t[${a}] * t[${i}]`;
          break;
        case TapeOpKind.Log:
          rhs = `dot_t[${a}] / t[${a}]`;
          break;
        case TapeOpKind.Sqrt:
          rhs = `dot_t[${a}] / (2.0 * t[${i}])`;
          break;
      }
      lines.push(`  dot_t[${i}] = ${rhs};`);
    }
    return lines;
  }

  public emitReverseDirectionalC(outputIndex: number): string[] {
    const lines: string[] = [];
    if (this.length === 0 || outputIndex < 0 || outputIndex >= this.length) return lines;

    for (let i = this.length - 1; i >= 0; i--) {
      const offset = i * TAPE_STRIDE;
      const kind = this.opData[offset + TAPE_OP_KIND]!;
      const a = this.opData[offset + TAPE_DATA1]!;
      const b = this.opData[offset + TAPE_DATA2]!;

      if (kind === TapeOpKind.Const || kind === TapeOpKind.Var || kind === TapeOpKind.Nop || kind >= TapeOpKind.VecVar)
        continue;

      lines.push(`  if (dt[${i}] != 0.0 || dot_dt[${i}] != 0.0) {`);
      switch (kind) {
        case TapeOpKind.Add:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}];`);
          lines.push(`    dot_dt[${b}] += dot_dt[${i}];`);
          break;
        case TapeOpKind.Sub:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}];`);
          lines.push(`    dot_dt[${b}] -= dot_dt[${i}];`);
          break;
        case TapeOpKind.Mul:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}] * t[${b}] + dt[${i}] * dot_t[${b}];`);
          lines.push(`    dot_dt[${b}] += dot_dt[${i}] * t[${a}] + dt[${i}] * dot_t[${a}];`);
          break;
        case TapeOpKind.Div:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}] / t[${b}] - dt[${i}] * dot_t[${b}] / (t[${b}] * t[${b}]);`);
          lines.push(
            `    dot_dt[${b}] -= (dot_dt[${i}] * t[${a}] + dt[${i}] * dot_t[${a}]) / (t[${b}] * t[${b}]) - 2.0 * t[${a}] * dt[${i}] * dot_t[${b}] / (t[${b}] * t[${b}] * t[${b}]);`,
          );
          break;
        case TapeOpKind.Pow:
          lines.push(
            `    dot_dt[${a}] += dot_dt[${i}] * t[${b}] * t[${i}] / t[${a}] + dt[${i}] * (dot_t[${b}] * t[${i}] / t[${a}] + t[${b}] * dot_t[${i}] / t[${a}] - t[${b}] * t[${i}] * dot_t[${a}] / (t[${a}] * t[${a}]));`,
          );
          lines.push(
            `    dot_dt[${b}] += dot_dt[${i}] * t[${i}] * log(t[${a}]) + dt[${i}] * (dot_t[${i}] * log(t[${a}]) + t[${i}] * dot_t[${a}] / t[${a}]);`,
          );
          break;
        case TapeOpKind.Neg:
          lines.push(`    dot_dt[${a}] -= dot_dt[${i}];`);
          break;
        case TapeOpKind.Sin:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}] * cos(t[${a}]) - dt[${i}] * dot_t[${a}] * sin(t[${a}]);`);
          break;
        case TapeOpKind.Cos:
          lines.push(`    dot_dt[${a}] -= dot_dt[${i}] * sin(t[${a}]) + dt[${i}] * dot_t[${a}] * cos(t[${a}]);`);
          break;
        case TapeOpKind.Tan:
          lines.push(
            `    dot_dt[${a}] += dot_dt[${i}] * (1.0 + t[${i}] * t[${i}]) + dt[${i}] * 2.0 * t[${i}] * dot_t[${i}];`,
          );
          break;
        case TapeOpKind.Exp:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}] * t[${i}] + dt[${i}] * dot_t[${i}];`);
          break;
        case TapeOpKind.Log:
          lines.push(`    dot_dt[${a}] += dot_dt[${i}] / t[${a}] - dt[${i}] * dot_t[${a}] / (t[${a}] * t[${a}]);`);
          break;
        case TapeOpKind.Sqrt:
          lines.push(
            `    dot_dt[${a}] += dot_dt[${i}] / (2.0 * t[${i}]) - dt[${i}] * dot_t[${i}] / (2.0 * t[${i}] * t[${i}]);`,
          );
          break;
      }
      lines.push(`  }`);
    }
    return lines;
  }
}
