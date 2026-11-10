// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — High-Throughput Binary ASL .nl Writer (Gay 1997 b3 Standard).
 *
 * Emits binary AMPL Solver Library .nl format files (`b3 0 1 0`), storing floating-point
 * numbers as IEEE 754 64-bit doubles and indices as 32-bit integers.
 * Designed for high-speed serialization of large-scale mathematical programs without
 * text-conversion overhead or precision loss.
 */

import type { AmplExpr, InstantiatedProblem } from "../types.js";
import { collectNonlinearVars } from "./nl-writer.js";

const ASL_FUNCTION_OPCODES: Record<string, number> = {
  floor: 13,
  ceil: 14,
  abs: 15,
  tanh: 37,
  tan: 38,
  sqrt: 39,
  sinh: 40,
  sin: 41,
  log10: 42,
  log: 43,
  ln: 43,
  exp: 44,
  cosh: 45,
  cos: 46,
  atanh: 47,
  atan2: 48,
  atan: 49,
  asinh: 50,
  asin: 51,
  acosh: 52,
  acos: 53,
  erf: 56,
  erfc: 57,
  gamma: 58,
  lgamma: 59,
  bessel_j0: 60,
  besselj0: 60,
  bessel_j1: 61,
  besselj1: 61,
  bessel_y0: 62,
  bessely0: 62,
  bessel_y1: 63,
  bessely1: 63,
  normal01: 64,
  normal: 65,
  normal_pdf: 66,
  normalpdf: 66,
};

/**
 * Dynamically growing binary buffer stream for zero-copy binary ASL serialization.
 */
export class BinaryStreamWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;
  private readonly isLittleEndian: boolean;

  constructor(initialCapacity = 65536, littleEndian = true) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    this.isLittleEndian = littleEndian;
  }

  private ensureCapacity(extraBytes: number): void {
    if (this.offset + extraBytes <= this.buffer.length) return;
    let newCap = Math.max(this.buffer.length * 2, this.offset + extraBytes + 1024);
    const newBuf = new Uint8Array(newCap);
    newBuf.set(this.buffer.subarray(0, this.offset));
    this.buffer = newBuf;
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  }

  public writeAsciiLine(text: string): void {
    const str = text.endsWith("\n") ? text : text + "\n";
    this.ensureCapacity(str.length);
    for (let i = 0; i < str.length; i++) {
      this.buffer[this.offset++] = str.charCodeAt(i) & 0xff;
    }
  }

  public writeByte(b: number): void {
    this.ensureCapacity(1);
    this.buffer[this.offset++] = b & 0xff;
  }

  public writeInt32(val: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, this.isLittleEndian);
    this.offset += 4;
  }

  public writeFloat64(val: number): void {
    this.ensureCapacity(8);
    this.view.setFloat64(this.offset, val, this.isLittleEndian);
    this.offset += 8;
  }

  public getBytes(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }

  public byteLength(): number {
    return this.offset;
  }
}

/**
 * Recursively writes a nonlinear expression tree into a binary opcode byte stream:
 * - 'n' (0x6E) + 8-byte Float64
 * - 'v' (0x76) + 4-byte Int32
 * - 'o' (0x6F) + 4-byte Int32
 */
export function writeBinaryAslExpr(
  expr: AmplExpr,
  varNameMap: Map<string, number>,
  stream: BinaryStreamWriter,
): void {
  switch (expr.kind) {
    case "number":
      stream.writeByte(0x6e); // 'n'
      stream.writeFloat64(expr.value);
      return;

    case "identifier": {
      const id = varNameMap.get(expr.name);
      if (id !== undefined) {
        stream.writeByte(0x76); // 'v'
        stream.writeInt32(id);
      } else {
        stream.writeByte(0x6e); // 'n'
        stream.writeFloat64(0);
      }
      return;
    }

    case "subscript": {
      const idxStr = expr.indices
        .map((i) => (i.kind === "number" ? String(i.value) : i.kind === "string" ? i.value : i.kind === "identifier" ? i.name : ""))
        .join(",");
      const fullName = `${expr.name}[${idxStr}]`;
      const id = varNameMap.get(fullName);
      if (id !== undefined) {
        stream.writeByte(0x76); // 'v'
        stream.writeInt32(id);
      } else {
        stream.writeByte(0x6e); // 'n'
        stream.writeFloat64(0);
      }
      return;
    }

    case "unary":
      if (expr.op === "-") {
        stream.writeByte(0x6f); // 'o'
        stream.writeInt32(16); // unary minus
        writeBinaryAslExpr(expr.expr, varNameMap, stream);
      } else {
        writeBinaryAslExpr(expr.expr, varNameMap, stream);
      }
      return;

    case "binary":
      switch (expr.op) {
        case "+":
          stream.writeByte(0x6f);
          stream.writeInt32(0);
          break;
        case "-":
          stream.writeByte(0x6f);
          stream.writeInt32(1);
          break;
        case "*":
          stream.writeByte(0x6f);
          stream.writeInt32(2);
          break;
        case "/":
          stream.writeByte(0x6f);
          stream.writeInt32(3);
          break;
        case "^":
        case "**":
          stream.writeByte(0x6f);
          stream.writeInt32(5);
          break;
        default:
          stream.writeByte(0x6f);
          stream.writeInt32(0);
      }
      writeBinaryAslExpr(expr.left, varNameMap, stream);
      writeBinaryAslExpr(expr.right, varNameMap, stream);
      return;

    case "call": {
      const fn = expr.fn.toLowerCase();
      const op = ASL_FUNCTION_OPCODES[fn];
      if (op !== undefined) {
        stream.writeByte(0x6f);
        stream.writeInt32(op);
        for (const arg of expr.args) {
          writeBinaryAslExpr(arg, varNameMap, stream);
        }
        return;
      }
      if (fn === "min" || fn === "max") {
        stream.writeByte(0x6f);
        stream.writeInt32(fn === "min" ? 11 : 12);
        stream.writeInt32(expr.args.length);
        for (const arg of expr.args) {
          writeBinaryAslExpr(arg, varNameMap, stream);
        }
        return;
      }
      stream.writeByte(0x6e);
      stream.writeFloat64(0);
      return;
    }

    case "if_then_else":
      stream.writeByte(0x6f);
      stream.writeInt32(35); // if-then-else
      writeBinaryAslExpr(expr.condition, varNameMap, stream);
      writeBinaryAslExpr(expr.thenExpr, varNameMap, stream);
      writeBinaryAslExpr(expr.elseExpr, varNameMap, stream);
      return;

    default:
      stream.writeByte(0x6e);
      stream.writeFloat64(0);
  }
}

export interface BinaryNlWriterOptions {
  endianness?: "little" | "big" | undefined;
}

/**
 * Serializes an instantiated mathematical programming problem into Gay (1997) ASL binary format (`b3`).
 */
export function writeBinaryNlProblem(
  problem: InstantiatedProblem,
  options?: BinaryNlWriterOptions,
): Uint8Array {
  const isLittle = options?.endianness !== "big";
  const stream = new BinaryStreamWriter(65536, isLittle);

  const nVars = problem.variables.length;
  const nConstraints = problem.constraints.length;
  const nObj = 1;

  let nRanges = 0;
  let nEq = 0;
  let nlc = 0;
  const nlVarsInCon = new Set<number>();
  const nlVarsInObj = new Set<number>();

  for (const c of problem.constraints) {
    const hasLB = Number.isFinite(c.lb) && c.lb > -1e15;
    const hasUB = Number.isFinite(c.ub) && c.ub < 1e15;
    if (hasLB && hasUB && Math.abs(c.lb - c.ub) < 1e-9) {
      nEq++;
    } else if (hasLB && hasUB) {
      nRanges++;
    }
    if (c.expr.nonlinearTree) {
      nlc++;
      collectNonlinearVars(c.expr.nonlinearTree, problem.varNameMap, nlVarsInCon);
    }
  }

  let nlo = 0;
  if (problem.objective.expr.nonlinearTree) {
    nlo = 1;
    collectNonlinearVars(problem.objective.expr.nonlinearTree, problem.varNameMap, nlVarsInObj);
  }

  let nlvb = 0;
  for (const vId of nlVarsInCon) {
    if (nlVarsInObj.has(vId)) nlvb++;
  }
  const nlvc = nlVarsInCon.size;
  const nlvo = nlVarsInObj.size;

  let nbv = 0;
  let niv = 0;
  for (const v of problem.variables) {
    if (v.type === "binary") nbv++;
    else if (v.type === "integer" || v.type === "semiint") niv++;
  }

  // Build full Jacobian entries per constraint
  const conJacobians: { varId: number; coeff: number }[][] = [];
  const colCounts = new Array<number>(nVars).fill(0);
  let nNzJacobian = 0;

  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    const coeffMap = new Map<number, number>();
    for (const t of c.expr.linearTerms) {
      coeffMap.set(t.varId, (coeffMap.get(t.varId) ?? 0) + t.coeff);
    }
    if (c.expr.nonlinearTree) {
      const cNlVars = new Set<number>();
      collectNonlinearVars(c.expr.nonlinearTree, problem.varNameMap, cNlVars);
      for (const vId of cNlVars) {
        if (!coeffMap.has(vId)) coeffMap.set(vId, 0);
      }
    }
    const entries = Array.from(coeffMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([varId, coeff]) => ({ varId, coeff }));
    conJacobians.push(entries);
    nNzJacobian += entries.length;
    for (const e of entries) {
      if (e.varId >= 0 && e.varId < nVars) colCounts[e.varId]!++;
    }
  }

  // Build Objective gradient entries
  const objGradMap = new Map<number, number>();
  for (const t of problem.objective.expr.linearTerms) {
    objGradMap.set(t.varId, (objGradMap.get(t.varId) ?? 0) + t.coeff);
  }
  if (problem.objective.expr.nonlinearTree) {
    for (const vId of nlVarsInObj) {
      if (!objGradMap.has(vId)) objGradMap.set(vId, 0);
    }
  }
  const objGradEntries = Array.from(objGradMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([varId, coeff]) => ({ varId, coeff }));

  // 1. ASCII Header lines
  stream.writeAsciiLine("b3 0 1 0");
  stream.writeAsciiLine(`${nVars} ${nConstraints} ${nObj} ${nRanges} ${nEq} 0`);
  stream.writeAsciiLine(`${nlc} ${nlo} 0 0 0 0`);
  stream.writeAsciiLine("0 0");
  stream.writeAsciiLine(`${nlvc} ${nlvo} ${nlvb} 0 0`);
  stream.writeAsciiLine(`0 0 ${nNzJacobian} ${objGradEntries.length}`);
  stream.writeAsciiLine(`${nbv} ${niv}`);

  // 2. Nonlinear constraint expression trees (C<index>\n)
  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    if (c.expr.nonlinearTree) {
      stream.writeAsciiLine(`C${i}`);
      if (Math.abs(c.expr.constant) > 1e-15) {
        stream.writeByte(0x6f);
        stream.writeInt32(0);
        stream.writeByte(0x6e);
        stream.writeFloat64(c.expr.constant);
        writeBinaryAslExpr(c.expr.nonlinearTree, problem.varNameMap, stream);
      } else {
        writeBinaryAslExpr(c.expr.nonlinearTree, problem.varNameMap, stream);
      }
    } else if (nlc > 0) {
      stream.writeAsciiLine(`C${i}`);
      stream.writeByte(0x6e);
      stream.writeFloat64(c.expr.constant);
    }
  }

  // 3. Objective expression (O0 <dir>\n)
  const dirFlag = problem.objective.direction === "maximize" ? 1 : 0;
  stream.writeAsciiLine(`O0 ${dirFlag}`);
  if (problem.objective.expr.nonlinearTree) {
    if (Math.abs(problem.objective.expr.constant) > 1e-15) {
      stream.writeByte(0x6f);
      stream.writeInt32(0);
      stream.writeByte(0x6e);
      stream.writeFloat64(problem.objective.expr.constant);
      writeBinaryAslExpr(problem.objective.expr.nonlinearTree, problem.varNameMap, stream);
    } else {
      writeBinaryAslExpr(problem.objective.expr.nonlinearTree, problem.varNameMap, stream);
    }
  } else {
    stream.writeByte(0x6e);
    stream.writeFloat64(problem.objective.expr.constant);
  }

  // 4. Constraint bounds (r\n) in binary format
  if (nConstraints > 0) {
    stream.writeAsciiLine("r");
    for (let i = 0; i < nConstraints; i++) {
      const c = problem.constraints[i]!;
      const hasLB = Number.isFinite(c.lb) && c.lb > -1e15;
      const hasUB = Number.isFinite(c.ub) && c.ub < 1e15;

      if (hasLB && hasUB && Math.abs(c.lb - c.ub) < 1e-9) {
        stream.writeInt32(4);
        stream.writeFloat64(c.lb);
      } else if (hasLB && hasUB) {
        stream.writeInt32(0);
        stream.writeFloat64(c.lb);
        stream.writeFloat64(c.ub);
      } else if (hasUB) {
        stream.writeInt32(1);
        stream.writeFloat64(c.ub);
      } else if (hasLB) {
        stream.writeInt32(2);
        stream.writeFloat64(c.lb);
      } else {
        stream.writeInt32(3);
      }
    }
  }

  // 5. Variable bounds (b\n) in binary format
  if (nVars > 0) {
    stream.writeAsciiLine("b");
    for (let j = 0; j < nVars; j++) {
      const v = problem.variables[j]!;
      const hasLB = Number.isFinite(v.lb) && v.lb > -1e15;
      const hasUB = Number.isFinite(v.ub) && v.ub < 1e15;

      if (hasLB && hasUB && Math.abs(v.lb - v.ub) < 1e-9) {
        stream.writeInt32(4);
        stream.writeFloat64(v.lb);
      } else if (hasLB && hasUB) {
        stream.writeInt32(0);
        stream.writeFloat64(v.lb);
        stream.writeFloat64(v.ub);
      } else if (hasUB) {
        stream.writeInt32(1);
        stream.writeFloat64(v.ub);
      } else if (hasLB) {
        stream.writeInt32(2);
        stream.writeFloat64(v.lb);
      } else {
        stream.writeInt32(3);
      }
    }
  }

  // 6. Cumulative column counts (k<n-1>\n) in binary format
  if (nVars > 1) {
    stream.writeAsciiLine(`k${nVars - 1}`);
    let cum = 0;
    for (let c = 0; c < nVars - 1; c++) {
      cum += colCounts[c]!;
      stream.writeInt32(cum);
    }
  }

  // 7. Constraint Jacobian entries (J<i> <len>\n) in binary format
  for (let i = 0; i < nConstraints; i++) {
    const entries = conJacobians[i]!;
    if (entries.length > 0) {
      stream.writeAsciiLine(`J${i} ${entries.length}`);
      for (const e of entries) {
        stream.writeInt32(e.varId);
        stream.writeFloat64(e.coeff);
      }
    }
  }

  // 8. Objective Gradient entries (G0 <len>\n) in binary format
  if (objGradEntries.length > 0) {
    stream.writeAsciiLine(`G0 ${objGradEntries.length}`);
    for (const e of objGradEntries) {
      stream.writeInt32(e.varId);
      stream.writeFloat64(e.coeff);
    }
  }

  // 9. Suffix entries (S<kind> <count> <name>\n) in binary format (emitted as ASCII text lines)
  const varSuffixes = new Map<string, { isFloat: boolean; entries: { id: number; val: number }[] }>();
  for (let i = 0; i < nVars; i++) {
    const v = problem.variables[i]!;
    if (v.customSuffixes) {
      for (const [sufName, val] of v.customSuffixes.entries()) {
        const numVal = typeof val === "number" ? val : Number(val) || 0;
        let group = varSuffixes.get(sufName);
        if (!group) {
          group = { isFloat: !Number.isInteger(numVal), entries: [] };
          varSuffixes.set(sufName, group);
        }
        if (!Number.isInteger(numVal)) group.isFloat = true;
        group.entries.push({ id: i, val: numVal });
      }
    }
  }

  for (const [sufName, group] of varSuffixes.entries()) {
    if (group.entries.length > 0) {
      const kind = group.isFloat ? 2 : 0;
      stream.writeAsciiLine(`S${kind} ${group.entries.length} ${sufName}`);
      for (const e of group.entries) {
        stream.writeAsciiLine(`${e.id} ${e.val}`);
      }
    }
  }

  const conSuffixes = new Map<string, { isFloat: boolean; entries: { id: number; val: number }[] }>();
  for (let i = 0; i < nConstraints; i++) {
    const c = problem.constraints[i]!;
    if (c.customSuffixes) {
      for (const [sufName, val] of c.customSuffixes.entries()) {
        const numVal = typeof val === "number" ? val : Number(val) || 0;
        let group = conSuffixes.get(sufName);
        if (!group) {
          group = { isFloat: !Number.isInteger(numVal), entries: [] };
          conSuffixes.set(sufName, group);
        }
        if (!Number.isInteger(numVal)) group.isFloat = true;
        group.entries.push({ id: i, val: numVal });
      }
    }
  }

  for (const [sufName, group] of conSuffixes.entries()) {
    if (group.entries.length > 0) {
      const kind = group.isFloat ? 3 : 1;
      stream.writeAsciiLine(`S${kind} ${group.entries.length} ${sufName}`);
      for (const e of group.entries) {
        stream.writeAsciiLine(`${e.id} ${e.val}`);
      }
    }
  }

  return stream.getBytes();
}
