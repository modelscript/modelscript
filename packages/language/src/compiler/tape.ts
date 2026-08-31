// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion, no-case-declarations */
/**
 * Static Tape (Wengert List) for Algorithmic Differentiation.
 *
 * This tape uses a pure Data-Oriented Design (DoD) layout.
 * Operations are packed into parallel typed arrays (`Int32Array` and `Float64Array`),
 * eliminating object allocations and pointer chasing.
 */

import type { ArenaDAEBuilder } from "../runtime/wasm_dae.js";
import { BinOp, ExprKind, UnaryOp } from "../runtime/wasm_dae.js";
import { StringInterner } from "./interner.js";

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
  public get nodeCount(): number {
    return this.length;
  }
  private cache = new Map<string, number>();

  public getOpKind(idx: number): TapeOpKind {
    return this.opData[idx * TAPE_STRIDE + TAPE_OP_KIND] as TapeOpKind;
  }
  public getData1(idx: number): number {
    return this.opData[idx * TAPE_STRIDE + TAPE_DATA1]!;
  }
  public getData2(idx: number): number {
    return this.opData[idx * TAPE_STRIDE + TAPE_DATA2]!;
  }
  public getData3(idx: number): number {
    return this.opData[idx * TAPE_STRIDE + TAPE_DATA3]!;
  }
  public getConstValue(idx: number): number {
    return this.valData[idx] ?? 0;
  }
  public getVarName(idx: number): string {
    const id = this.getData1(idx);
    return this.interner.resolve(id) ?? "";
  }

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

  public addExpression(exprId: number, arena: ArenaDAEBuilder): number {
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

  public addArrayExpression(exprId: number, arena: ArenaDAEBuilder): number[] {
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

  public walkArrayVectorized(exprId: number, arena: ArenaDAEBuilder): { startIdx: number; size: number } {
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

  public emitReverseC(outputIndex: number): { code: string[]; gradients: Map<string, number> } {
    const lines: string[] = [];
    if (this.length === 0 || outputIndex < 0 || outputIndex >= this.length) {
      return { code: [], gradients: new Map() };
    }

    lines.push(`  double dt[${this.length}];`);
    lines.push(`  memset(dt, 0, ${this.length} * sizeof(double));`);
    lines.push(`  dt[${outputIndex}] = 1.0; /* Seed the gradient */`);

    // Reverse topological traversal
    for (let i = this.length - 1; i >= 0; i--) {
      const offset = i * TAPE_STRIDE;
      const kind = this.opData[offset + TAPE_OP_KIND]!;
      const a = this.opData[offset + TAPE_DATA1]!;
      const b = this.opData[offset + TAPE_DATA2]!;
      const c = this.opData[offset + TAPE_DATA3]!;

      if (
        kind === TapeOpKind.Const ||
        kind === TapeOpKind.Var ||
        kind === TapeOpKind.VecVar ||
        kind === TapeOpKind.VecConst ||
        kind === TapeOpKind.Nop
      ) {
        continue;
      }

      // Optimization: if dt is 0, skip branching
      lines.push(`  if (dt[${i}] != 0.0) {`);
      switch (kind) {
        case TapeOpKind.Add:
          lines.push(`    dt[${a}] += dt[${i}];`);
          lines.push(`    dt[${b}] += dt[${i}];`);
          break;
        case TapeOpKind.Sub:
          lines.push(`    dt[${a}] += dt[${i}];`);
          lines.push(`    dt[${b}] -= dt[${i}];`);
          break;
        case TapeOpKind.Mul:
          lines.push(`    dt[${a}] += dt[${i}] * t[${b}];`);
          lines.push(`    dt[${b}] += dt[${i}] * t[${a}];`);
          break;
        case TapeOpKind.Div:
          lines.push(`    dt[${a}] += dt[${i}] / t[${b}];`);
          lines.push(`    dt[${b}] -= dt[${i}] * t[${a}] / (t[${b}] * t[${b}]);`);
          break;
        case TapeOpKind.Pow:
          lines.push(`    dt[${a}] += dt[${i}] * t[${b}] * pow(t[${a}], t[${b}] - 1.0);`);
          lines.push(`    dt[${b}] += dt[${i}] * t[${i}] * log(t[${a}]);`); // t[i] is a^b
          break;
        case TapeOpKind.Neg:
          lines.push(`    dt[${a}] -= dt[${i}];`);
          break;
        case TapeOpKind.Sin:
          lines.push(`    dt[${a}] += dt[${i}] * cos(t[${a}]);`);
          break;
        case TapeOpKind.Cos:
          lines.push(`    dt[${a}] -= dt[${i}] * sin(t[${a}]);`);
          break;
        case TapeOpKind.Tan:
          lines.push(`    dt[${a}] += dt[${i}] * (1.0 + t[${i}] * t[${i}]);`); // 1 + tan²x
          break;
        case TapeOpKind.Exp:
          lines.push(`    dt[${a}] += dt[${i}] * t[${i}];`);
          break;
        case TapeOpKind.Log:
          lines.push(`    dt[${a}] += dt[${i}] / t[${a}];`);
          break;
        case TapeOpKind.Sqrt:
          lines.push(`    dt[${a}] += dt[${i}] / (2.0 * t[${i}]);`);
          break;
        // ── Vector ops ──
        case TapeOpKind.VecAdd:
          lines.push(`    for (int _k = 0; _k < ${b}; _k++) {`);
          lines.push(`      dt[${a}+_k] += dt[${i}+_k]; dt[${c}+_k] += dt[${i}+_k];`);
          lines.push(`    }`);
          break;
        case TapeOpKind.VecSub:
          lines.push(`    for (int _k = 0; _k < ${b}; _k++) {`);
          lines.push(`      dt[${a}+_k] += dt[${i}+_k]; dt[${c}+_k] -= dt[${i}+_k];`);
          lines.push(`    }`);
          break;
        case TapeOpKind.VecMul:
          lines.push(`    for (int _k = 0; _k < ${b}; _k++) {`);
          lines.push(`      dt[${a}+_k] += dt[${i}+_k] * t[${c}+_k];`);
          lines.push(`      dt[${c}+_k] += dt[${i}+_k] * t[${a}+_k];`);
          lines.push(`    }`);
          break;
        case TapeOpKind.VecNeg:
          lines.push(`    for (int _k = 0; _k < ${b}; _k++) dt[${a}+_k] -= dt[${i}+_k];`);
          break;
        case TapeOpKind.VecSubscript:
          lines.push(`    dt[${a + c}] += dt[${i}];`);
          break;
      }
      lines.push(`  }`);
    }

    // Extract gradients mapping
    const gradients = new Map<string, number>();
    for (let i = 0; i < this.length; i++) {
      const offset = i * TAPE_STRIDE;
      const kind = this.opData[offset + TAPE_OP_KIND]!;
      const a = this.opData[offset + TAPE_DATA1]!;
      const b = this.opData[offset + TAPE_DATA2]!;
      if (kind === TapeOpKind.Var) {
        gradients.set(this.interner.resolve(a) || "", i);
      } else if (kind === TapeOpKind.VecVar) {
        const baseName = this.interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          gradients.set(`${baseName}[${k + 1}]`, i + k);
        }
      }
    }

    return { code: lines, gradients };
  }

  evaluateForward(varValues: Map<string, number>): Float64Array {
    return evaluateTapeForward(this, varValues);
  }

  evaluateReverse(t: Float64Array, outputIndex: number): Map<string, number> {
    return evaluateTapeReverse(this, t, outputIndex);
  }
}

/** Extract derivative name from expression like der(x). */
function extractDer(arena: ArenaDAEBuilder, exprId: number): string | null {
  if (exprId < 0) return null;
  if (arena.getExprKind(exprId) === ExprKind.Der) {
    const argId = arena.getExprData1(exprId);
    if (arena.getExprKind(argId) === ExprKind.Name) {
      return arena.interner.resolve(arena.getExprData1(argId)) || null;
    }
  }
  return null;
}

/**
 * Evaluate a tape forward pass at runtime, returning the value array.
 */
export function evaluateTapeForward(builder: StaticTapeBuilder, varValues: Map<string, number>): Float64Array {
  const t = new Float64Array(builder.length);
  const { opData, valData, interner } = builder;
  const TAPE_STRIDE = 4;

  for (let i = 0; i < builder.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset] as TapeOpKind;
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    switch (kind) {
      case TapeOpKind.Const:
        t[i] = valData[i]!;
        break;
      case TapeOpKind.Var:
        t[i] = varValues.get(interner.resolve(a) || "") ?? 0;
        break;
      case TapeOpKind.Add:
        t[i] = (t[a] ?? 0) + (t[b] ?? 0);
        break;
      case TapeOpKind.Sub:
        t[i] = (t[a] ?? 0) - (t[b] ?? 0);
        break;
      case TapeOpKind.Mul:
        t[i] = (t[a] ?? 0) * (t[b] ?? 0);
        break;
      case TapeOpKind.Div:
        t[i] = (t[a] ?? 0) / (t[b] ?? 0);
        break;
      case TapeOpKind.Pow:
        t[i] = Math.pow(t[a] ?? 0, t[b] ?? 0);
        break;
      case TapeOpKind.Neg:
        t[i] = -(t[a] ?? 0);
        break;
      case TapeOpKind.Sin:
        t[i] = Math.sin(t[a] ?? 0);
        break;
      case TapeOpKind.Cos:
        t[i] = Math.cos(t[a] ?? 0);
        break;
      case TapeOpKind.Tan:
        t[i] = Math.tan(t[a] ?? 0);
        break;
      case TapeOpKind.Exp:
        t[i] = Math.exp(t[a] ?? 0);
        break;
      case TapeOpKind.Log:
        t[i] = Math.log(t[a] ?? 0);
        break;
      case TapeOpKind.Sqrt:
        t[i] = Math.sqrt(t[a] ?? 0);
        break;
      // ── Vector ops ──
      case TapeOpKind.VecVar: {
        const baseName = interner.resolve(a) || "";
        for (let k = 0; k < b; k++) {
          t[i + k] = varValues.get(`${baseName}[${k + 1}]`) ?? 0;
        }
        break;
      }
      case TapeOpKind.VecConst:
        for (let k = 0; k < b; k++) {
          t[i + k] = valData[i + k] ?? 0;
        }
        break;
      case TapeOpKind.VecAdd:
        for (let k = 0; k < b; k++) {
          t[i + k] = (t[a + k] ?? 0) + (t[c + k] ?? 0);
        }
        break;
      case TapeOpKind.VecSub:
        for (let k = 0; k < b; k++) {
          t[i + k] = (t[a + k] ?? 0) - (t[c + k] ?? 0);
        }
        break;
      case TapeOpKind.VecMul:
        for (let k = 0; k < b; k++) {
          t[i + k] = (t[a + k] ?? 0) * (t[c + k] ?? 0);
        }
        break;
      case TapeOpKind.VecNeg:
        for (let k = 0; k < b; k++) {
          t[i + k] = -(t[a + k] ?? 0);
        }
        break;
      case TapeOpKind.VecSubscript:
        t[i] = t[a + c] ?? 0;
        break;
      case TapeOpKind.Nop:
        break;
    }
  }
  return t;
}

/**
 * Evaluate the reverse-mode AD sweep on a tape, returning gradients for all variables.
 */
export function evaluateTapeReverse(
  builder: StaticTapeBuilder,
  t: Float64Array,
  outputIndex: number,
): Map<string, number> {
  const dt = new Float64Array(builder.length);
  dt[outputIndex] = 1.0;

  const { opData, interner } = builder;
  const TAPE_STRIDE = 4;

  for (let i = builder.length - 1; i >= 0; i--) {
    if (dt[i] === 0) continue;

    const offset = i * TAPE_STRIDE;
    const kind = opData[offset] as TapeOpKind;
    const a = opData[offset + 1]!;
    const b = opData[offset + 2]!;
    const c = opData[offset + 3]!;

    const dti = dt[i] ?? 0;

    switch (kind) {
      case TapeOpKind.Add:
        dt[a] = (dt[a] ?? 0) + dti;
        dt[b] = (dt[b] ?? 0) + dti;
        break;
      case TapeOpKind.Sub:
        dt[a] = (dt[a] ?? 0) + dti;
        dt[b] = (dt[b] ?? 0) - dti;
        break;
      case TapeOpKind.Mul:
        dt[a] = (dt[a] ?? 0) + dti * (t[b] ?? 0);
        dt[b] = (dt[b] ?? 0) + dti * (t[a] ?? 0);
        break;
      case TapeOpKind.Div:
        dt[a] = (dt[a] ?? 0) + dti / (t[b] ?? 1);
        dt[b] = (dt[b] ?? 0) - (dti * (t[a] ?? 0)) / ((t[b] ?? 1) * (t[b] ?? 1));
        break;
      case TapeOpKind.Pow: {
        const base = t[a] ?? 0;
        const exp = t[b] ?? 0;
        dt[a] = (dt[a] ?? 0) + dti * exp * Math.pow(base, exp - 1);
        dt[b] = (dt[b] ?? 0) + dti * (t[i] ?? 0) * Math.log(base);
        break;
      }
      case TapeOpKind.Neg:
        dt[a] = (dt[a] ?? 0) - dti;
        break;
      case TapeOpKind.Sin:
        dt[a] = (dt[a] ?? 0) + dti * Math.cos(t[a] ?? 0);
        break;
      case TapeOpKind.Cos:
        dt[a] = (dt[a] ?? 0) - dti * Math.sin(t[a] ?? 0);
        break;
      case TapeOpKind.Tan:
        dt[a] = (dt[a] ?? 0) + dti * (1 + (t[i] ?? 0) * (t[i] ?? 0));
        break;
      case TapeOpKind.Exp:
        dt[a] = (dt[a] ?? 0) + dti * (t[i] ?? 0);
        break;
      case TapeOpKind.Log:
        dt[a] = (dt[a] ?? 0) + dti / (t[a] ?? 1);
        break;
      case TapeOpKind.Sqrt:
        dt[a] = (dt[a] ?? 0) + dti / (2 * (t[i] ?? 1));
        break;
      // ── Vector ops reverse ──
      case TapeOpKind.VecAdd:
        for (let k = 0; k < b; k++) {
          const dk = dt[i + k] ?? 0;
          dt[a + k] = (dt[a + k] ?? 0) + dk;
          dt[c + k] = (dt[c + k] ?? 0) + dk;
        }
        break;
      case TapeOpKind.VecSub:
        for (let k = 0; k < b; k++) {
          const dk = dt[i + k] ?? 0;
          dt[a + k] = (dt[a + k] ?? 0) + dk;
          dt[c + k] = (dt[c + k] ?? 0) - dk;
        }
        break;
      case TapeOpKind.VecMul:
        for (let k = 0; k < b; k++) {
          const dk = dt[i + k] ?? 0;
          dt[a + k] = (dt[a + k] ?? 0) + dk * (t[c + k] ?? 0);
          dt[c + k] = (dt[c + k] ?? 0) + dk * (t[a + k] ?? 0);
        }
        break;
      case TapeOpKind.VecNeg:
        for (let k = 0; k < b; k++) {
          dt[a + k] = (dt[a + k] ?? 0) - (dt[i + k] ?? 0);
        }
        break;
      case TapeOpKind.VecSubscript:
        dt[a + c] = (dt[a + c] ?? 0) + dti;
        break;
      case TapeOpKind.Nop:
      case TapeOpKind.Const:
      case TapeOpKind.Var:
      case TapeOpKind.VecConst:
      case TapeOpKind.VecVar:
        break;
    }
  }

  // Collect variable gradients
  const gradients = new Map<string, number>();
  for (let i = 0; i < builder.length; i++) {
    const offset = i * TAPE_STRIDE;
    const kind = opData[offset] as TapeOpKind;
    if (kind === TapeOpKind.Var) {
      const a = opData[offset + 1]!;
      const name = interner.resolve(a) || "";
      gradients.set(name, (gradients.get(name) ?? 0) + (dt[i] ?? 0));
    } else if (kind === TapeOpKind.VecVar) {
      const a = opData[offset + 1]!;
      const b = opData[offset + 2]!;
      const baseName = interner.resolve(a) || "";
      for (let k = 0; k < b; k++) {
        const name = `${baseName}[${k + 1}]`;
        gradients.set(name, (gradients.get(name) ?? 0) + (dt[i + k] ?? 0));
      }
    }
  }
  return gradients;
}

/**
 * Build a runtime AD Jacobian evaluator from a DAE.
 *
 * Returns a function `(t: number, y: number[]) => number[][]` that computes
 * the exact Jacobian of the derivative equations w.r.t. the state variables.
 */
export function buildAdJacobian(dae: ArenaDAEBuilder): ((t: number, y: number[]) => number[][]) | null {
  // Gather derivative equations: der(x) = f(x, u)
  const derEqs: { state: string; rhsExprId: number }[] = [];

  for (let i = 0; i < dae.eqCount; i++) {
    const kind = dae.getEqKind(i);
    // EqKind.Simple or EqKind.Array
    if (kind !== 0 && kind !== 4) continue;

    const lhsId = dae.getEqLhs(i);
    const rhsId = dae.getEqRhs(i);

    const ld = extractDer(dae, lhsId);
    const rd = extractDer(dae, rhsId);

    if (kind === 4) {
      // EqKind.Array
      const baseName = ld || rd;
      if (!baseName) continue;
      const rhs = ld ? rhsId : lhsId;

      const vIdx = dae.getVarIdxByName(baseName);
      const dims = vIdx >= 0 ? dae.getVarShape(vIdx) : [];
      const size = dims && dims.length > 0 ? dims.reduce((a: number, b: number) => a * b, 1) : 1;

      for (let j = 0; j < size; j++) {
        derEqs.push({ state: `${baseName}[${j + 1}]`, rhsExprId: rhs });
      }
      continue;
    }

    if (ld) derEqs.push({ state: ld, rhsExprId: rhsId });
    else if (rd) derEqs.push({ state: rd, rhsExprId: lhsId });
  }

  if (derEqs.length === 0) return null;

  const stateNames = derEqs.map((eq) => eq.state);
  const n = stateNames.length;

  const tapeData: { ops: StaticTapeBuilder; outputIndex: number }[] = [];
  for (const eq of derEqs) {
    const tape = new StaticTapeBuilder();
    const outIdx = tape.addExpression(eq.rhsExprId, dae);
    tapeData.push({ ops: tape, outputIndex: outIdx });
  }

  return (time: number, y: number[]): number[][] => {
    const varValues = new Map<string, number>();
    varValues.set("time", time);
    for (let i = 0; i < n; i++) {
      const name = stateNames[i];
      if (name) varValues.set(name, y[i] ?? 0);
    }
    for (let i = 0; i < dae.varCount; i++) {
      const name = dae.getVarName(i);
      if (!varValues.has(name) && dae.getVarExpression(i) !== undefined) {
        varValues.set(name, dae.getVarStartValue(i));
      }
    }

    const J: number[][] = [];
    for (let i = 0; i < n; i++) {
      J[i] = new Array(n).fill(0) as number[];
    }

    for (let row = 0; row < n; row++) {
      const td = tapeData[row];
      if (!td) continue;

      const t = evaluateTapeForward(td.ops, varValues);
      const grads = evaluateTapeReverse(td.ops, t, td.outputIndex);

      const jRow = J[row];
      if (!jRow) continue;
      for (let col = 0; col < n; col++) {
        const stateName = stateNames[col];
        if (stateName) {
          jRow[col] = grads.get(stateName) ?? 0;
        }
      }
    }

    return J;
  };
}
