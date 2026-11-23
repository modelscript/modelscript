// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1364 4-State (`0`, `1`, `X`, `Z`) Logic Vector Arithmetic & Gate Primitives.
 *
 * Bits are stored LSB-first (`bits[0]` is bit 0, `bits[width - 1]` is MSB).
 */

import type { LogicVal, VerilogGateType } from "../types.js";

export class LogicVector {
  readonly bits: LogicVal[];

  constructor(bits: LogicVal[]) {
    this.bits = bits.length > 0 ? bits : ["0"];
  }

  get width(): number {
    return this.bits.length;
  }

  static filled(width: number, val: LogicVal): LogicVector {
    const w = Math.max(1, width);
    return new LogicVector(Array.from({ length: w }, () => val));
  }

  static fromInt(value: number, width: number = 32): LogicVector {
    const w = Math.max(1, width);
    const bits: LogicVal[] = new Array<LogicVal>(w);
    const unsigned = Math.trunc(value);
    for (let i = 0; i < w; i++) {
      // Support >32-bit cleanly via BigInt
      bits[i] = ((BigInt(unsigned) >> BigInt(i)) & 1n) === 1n ? "1" : "0";
    }
    return new LogicVector(bits);
  }

  static fromBitString(str: string, width?: number): LogicVector {
    const clean = str.replace(/_/g, "").toUpperCase();
    const targetW = width ?? Math.max(1, clean.length);
    const bits: LogicVal[] = new Array<LogicVal>(targetW);
    const msbChar = clean[0] ?? "0";
    const padChar: LogicVal = msbChar === "X" || msbChar === "Z" ? msbChar : "0";
    for (let i = 0; i < targetW; i++) {
      const srcIdx = clean.length - 1 - i;
      if (srcIdx >= 0) {
        const ch = clean[srcIdx]!;
        bits[i] = ch === "1" ? "1" : ch === "0" ? "0" : ch === "Z" || ch === "?" ? "Z" : "X";
      } else {
        bits[i] = padChar;
      }
    }
    return new LogicVector(bits);
  }

  static fromSizedLiteral(base: "b" | "o" | "d" | "h", digits: string, width?: number): LogicVector {
    const clean = digits.replace(/_/g, "").toUpperCase();
    if (base === "b") {
      return LogicVector.fromBitString(clean, width);
    }
    if (base === "d") {
      if (clean === "X") return LogicVector.filled(width ?? 32, "X");
      if (clean === "Z" || clean === "?") return LogicVector.filled(width ?? 32, "Z");
      const num = Number.parseInt(clean, 10);
      if (!Number.isFinite(num)) return LogicVector.filled(width ?? 32, "X");
      return LogicVector.fromInt(num, width ?? 32);
    }
    const bitsPerDigit = base === "h" ? 4 : 3;
    let expanded = "";
    for (const ch of clean) {
      if (ch === "X") {
        expanded += "X".repeat(bitsPerDigit);
      } else if (ch === "Z" || ch === "?") {
        expanded += "Z".repeat(bitsPerDigit);
      } else {
        const val = Number.parseInt(ch, base === "h" ? 16 : 8);
        expanded += Number.isFinite(val) ? val.toString(2).padStart(bitsPerDigit, "0") : "X".repeat(bitsPerDigit);
      }
    }
    return LogicVector.fromBitString(expanded, width);
  }

  resize(newWidth: number): LogicVector {
    const w = Math.max(1, newWidth);
    if (w === this.width) return new LogicVector([...this.bits]);
    const out: LogicVal[] = new Array<LogicVal>(w);
    for (let i = 0; i < w; i++) {
      out[i] = i < this.width ? this.bits[i]! : "0";
    }
    return new LogicVector(out);
  }

  hasUnknown(): boolean {
    return this.bits.some((b) => b === "X" || b === "Z");
  }

  toUnsignedInt(): number | undefined {
    if (this.hasUnknown()) return undefined;
    let acc = 0n;
    for (let i = this.bits.length - 1; i >= 0; i--) {
      acc = (acc << 1n) | (this.bits[i] === "1" ? 1n : 0n);
    }
    return Number(acc);
  }

  toBitString(): string {
    return [...this.bits].reverse().join("");
  }

  isTruthy(): boolean {
    return this.bits.some((b) => b === "1");
  }

  equalsExact(other: LogicVector): boolean {
    if (this.width !== other.width) return false;
    for (let i = 0; i < this.width; i++) {
      if (this.bits[i] !== other.bits[i]) return false;
    }
    return true;
  }

  bitAt(index: number): LogicVal {
    if (index < 0 || index >= this.width) return "X";
    return this.bits[index]!;
  }

  slice(msb: number, lsb: number): LogicVector {
    const hi = Math.max(msb, lsb);
    const lo = Math.min(msb, lsb);
    const out: LogicVal[] = [];
    for (let i = lo; i <= hi; i++) {
      out.push(this.bitAt(i));
    }
    return new LogicVector(out);
  }
}

// ── IEEE 1364 4-state scalar truth tables ──────────────────────────────────

export function bitNot(a: LogicVal): LogicVal {
  if (a === "0") return "1";
  if (a === "1") return "0";
  return "X";
}

export function bitBuf(a: LogicVal): LogicVal {
  if (a === "0" || a === "1") return a;
  return "X";
}

export function bitAnd(a: LogicVal, b: LogicVal): LogicVal {
  if (a === "0" || b === "0") return "0";
  if (a === "1" && b === "1") return "1";
  return "X";
}

export function bitOr(a: LogicVal, b: LogicVal): LogicVal {
  if (a === "1" || b === "1") return "1";
  if (a === "0" && b === "0") return "0";
  return "X";
}

export function bitXor(a: LogicVal, b: LogicVal): LogicVal {
  if (a === "X" || a === "Z" || b === "X" || b === "Z") return "X";
  return a === b ? "0" : "1";
}

export function bitResolveWire(a: LogicVal, b: LogicVal): LogicVal {
  if (a === "Z") return b;
  if (b === "Z") return a;
  if (a === b) return a;
  return "X";
}

export function evalGatePrimitive(gateType: VerilogGateType, inputs: LogicVal[]): LogicVal {
  if (inputs.length === 0) return "X";
  switch (gateType) {
    case "and":
      return inputs.reduce((acc, v) => bitAnd(acc, v), "1" as LogicVal);
    case "nand":
      return bitNot(inputs.reduce((acc, v) => bitAnd(acc, v), "1" as LogicVal));
    case "or":
      return inputs.reduce((acc, v) => bitOr(acc, v), "0" as LogicVal);
    case "nor":
      return bitNot(inputs.reduce((acc, v) => bitOr(acc, v), "0" as LogicVal));
    case "xor":
      return inputs.reduce((acc, v) => bitXor(acc, v), "0" as LogicVal);
    case "xnor":
      return bitNot(inputs.reduce((acc, v) => bitXor(acc, v), "0" as LogicVal));
    case "buf":
      return bitBuf(inputs[0]!);
    case "not":
      return bitNot(inputs[0]!);
    case "bufif0": {
      const data = inputs[0]!;
      const ctrl = inputs[1] ?? "X";
      if (ctrl === "1") return "Z";
      if (ctrl === "0") return bitBuf(data);
      return "X";
    }
    case "bufif1": {
      const data = inputs[0]!;
      const ctrl = inputs[1] ?? "X";
      if (ctrl === "0") return "Z";
      if (ctrl === "1") return bitBuf(data);
      return "X";
    }
    case "notif0": {
      const data = inputs[0]!;
      const ctrl = inputs[1] ?? "X";
      if (ctrl === "1") return "Z";
      if (ctrl === "0") return bitNot(data);
      return "X";
    }
    case "notif1": {
      const data = inputs[0]!;
      const ctrl = inputs[1] ?? "X";
      if (ctrl === "0") return "Z";
      if (ctrl === "1") return bitNot(data);
      return "X";
    }
  }
}

// ── Vector operators ───────────────────────────────────────────────────────

export function vecBitwise(op: "&" | "|" | "^" | "~^" | "^~", a: LogicVector, b: LogicVector): LogicVector {
  const w = Math.max(a.width, b.width);
  const la = a.resize(w);
  const lb = b.resize(w);
  const out: LogicVal[] = new Array<LogicVal>(w);
  for (let i = 0; i < w; i++) {
    const ba = la.bits[i]!;
    const bb = lb.bits[i]!;
    if (op === "&") out[i] = bitAnd(ba, bb);
    else if (op === "|") out[i] = bitOr(ba, bb);
    else if (op === "^") out[i] = bitXor(ba, bb);
    else out[i] = bitNot(bitXor(ba, bb));
  }
  return new LogicVector(out);
}

export function vecNot(a: LogicVector): LogicVector {
  return new LogicVector(a.bits.map(bitNot));
}

export function vecLogicalNot(a: LogicVector): LogicVector {
  if (a.bits.some((b) => b === "1")) return new LogicVector(["0"]);
  if (a.hasUnknown()) return new LogicVector(["X"]);
  return new LogicVector(["1"]);
}

export function vecConcat(vectors: LogicVector[]): LogicVector {
  // Verilog concatenation {msb, ..., lsb}: first element is MSB, last is LSB
  const bits: LogicVal[] = [];
  for (let i = vectors.length - 1; i >= 0; i--) {
    bits.push(...vectors[i]!.bits);
  }
  return new LogicVector(bits);
}

export function vecAdd(a: LogicVector, b: LogicVector): LogicVector {
  const w = Math.max(a.width, b.width);
  const va = a.toUnsignedInt();
  const vb = b.toUnsignedInt();
  if (va === undefined || vb === undefined) return LogicVector.filled(w, "X");
  return LogicVector.fromInt(va + vb, w);
}

export function vecSub(a: LogicVector, b: LogicVector): LogicVector {
  const w = Math.max(a.width, b.width);
  const va = a.toUnsignedInt();
  const vb = b.toUnsignedInt();
  if (va === undefined || vb === undefined) return LogicVector.filled(w, "X");
  return LogicVector.fromInt(va - vb, w);
}

export function vecMul(a: LogicVector, b: LogicVector): LogicVector {
  const w = Math.max(a.width, b.width);
  const va = a.toUnsignedInt();
  const vb = b.toUnsignedInt();
  if (va === undefined || vb === undefined) return LogicVector.filled(w, "X");
  return LogicVector.fromInt(va * vb, w);
}

export function vecShiftLeft(a: LogicVector, shift: LogicVector): LogicVector {
  const s = shift.toUnsignedInt();
  if (s === undefined) return LogicVector.filled(a.width, "X");
  const out: LogicVal[] = new Array<LogicVal>(a.width);
  for (let i = 0; i < a.width; i++) {
    out[i] = i - s >= 0 ? a.bits[i - s]! : "0";
  }
  return new LogicVector(out);
}

export function vecShiftRight(a: LogicVector, shift: LogicVector): LogicVector {
  const s = shift.toUnsignedInt();
  if (s === undefined) return LogicVector.filled(a.width, "X");
  const out: LogicVal[] = new Array<LogicVal>(a.width);
  for (let i = 0; i < a.width; i++) {
    out[i] = i + s < a.width ? a.bits[i + s]! : "0";
  }
  return new LogicVector(out);
}

export function vecEqual(a: LogicVector, b: LogicVector, caseEquality: boolean): LogicVector {
  const w = Math.max(a.width, b.width);
  const la = a.resize(w);
  const lb = b.resize(w);
  if (caseEquality) {
    return new LogicVector([la.equalsExact(lb) ? "1" : "0"]);
  }
  let hasX = false;
  for (let i = 0; i < w; i++) {
    const ba = la.bits[i]!;
    const bb = lb.bits[i]!;
    if (ba === "X" || ba === "Z" || bb === "X" || bb === "Z") {
      hasX = true;
    } else if (ba !== bb) {
      return new LogicVector(["0"]);
    }
  }
  return new LogicVector([hasX ? "X" : "1"]);
}

export function vecCompare(op: "<" | "<=" | ">" | ">=", a: LogicVector, b: LogicVector): LogicVector {
  const va = a.toUnsignedInt();
  const vb = b.toUnsignedInt();
  if (va === undefined || vb === undefined) return new LogicVector(["X"]);
  let res = false;
  if (op === "<") res = va < vb;
  else if (op === "<=") res = va <= vb;
  else if (op === ">") res = va > vb;
  else res = va >= vb;
  return new LogicVector([res ? "1" : "0"]);
}
