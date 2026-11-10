// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Binary ASL .nl Reader (Gay 1997 b3 Standard) & Binary .sol Reader.
 *
 * Ingests binary AMPL Solver Library .nl format files (`b3`) and binary .sol solution files,
 * extracting problem dimensions, decision variables, bounds, sparse Jacobians, and solution vectors.
 */

import type {
  AmplVarType,
  FlatAffineTerm,
  InstantiatedProblem,
} from "../types.js";
import type { SolFileResult } from "./nl-reader.js";

export class BinaryStreamReader {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;
  private isLittleEndian: boolean;

  constructor(buffer: Uint8Array, littleEndian = true) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    this.isLittleEndian = littleEndian;
  }

  public getOffset(): number {
    return this.offset;
  }

  public setOffset(pos: number): void {
    this.offset = pos;
  }

  public isAtEnd(): boolean {
    return this.offset >= this.buffer.length;
  }

  public readByte(): number {
    if (this.offset >= this.buffer.length) throw new Error("Unexpected end of binary stream.");
    return this.buffer[this.offset++]!;
  }

  public readInt32(): number {
    if (this.offset + 4 > this.buffer.length) throw new Error("Unexpected end of binary stream.");
    const val = this.view.getInt32(this.offset, this.isLittleEndian);
    this.offset += 4;
    return val;
  }

  public readFloat64(): number {
    if (this.offset + 8 > this.buffer.length) throw new Error("Unexpected end of binary stream.");
    const val = this.view.getFloat64(this.offset, this.isLittleEndian);
    this.offset += 8;
    return val;
  }

  public readAsciiLine(): string {
    const start = this.offset;
    while (this.offset < this.buffer.length && this.buffer[this.offset] !== 0x0a) {
      this.offset++;
    }
    const end = this.offset;
    if (this.offset < this.buffer.length && this.buffer[this.offset] === 0x0a) {
      this.offset++; // skip \n
    }
    let line = "";
    for (let i = start; i < end; i++) {
      const b = this.buffer[i]!;
      if (b !== 0x0d) line += String.fromCharCode(b); // skip \r
    }
    return line;
  }
}

function skipBinaryAslExpr(reader: BinaryStreamReader): void {
  if (reader.isAtEnd()) return;
  const tag = reader.readByte();
  if (tag === 0x6e) {
    // 'n'
    reader.readFloat64();
  } else if (tag === 0x76) {
    // 'v'
    reader.readInt32();
  } else if (tag === 0x6f) {
    // 'o'
    const op = reader.readInt32();
    if (op === 11 || op === 12) {
      // min / max n-ary
      const nargs = reader.readInt32();
      for (let k = 0; k < nargs; k++) {
        skipBinaryAslExpr(reader);
      }
    } else if (op === 35) {
      // if-then-else
      skipBinaryAslExpr(reader);
      skipBinaryAslExpr(reader);
      skipBinaryAslExpr(reader);
    } else if (
      op === 16 || // unary minus
      op === 13 || // floor
      op === 14 || // ceil
      op === 43 || // abs
      op === 44 || // neg
      op === 37 || // sqrt
      op === 38 || // exp
      op === 39 || // log
      op === 40 || // log10
      op === 41 || // sin
      op === 42 || // cos
      op === 45 || // tan
      op === 46 || // asin
      op === 47 || // round
      op === 48 || // trunc
      op === 49 || // acos
      op === 50 || // atan
      op === 51 || // sinh
      op === 52 || // cosh
      op === 53    // tanh
    ) {
      skipBinaryAslExpr(reader);
    } else {
      // binary op
      skipBinaryAslExpr(reader);
      skipBinaryAslExpr(reader);
    }
  }
}

/**
 * Parses an instantiated problem from Gay (1997) ASL binary format (`b3`).
 */
export function readBinaryNlProblem(buffer: Uint8Array): InstantiatedProblem {
  const reader = new BinaryStreamReader(buffer, true);

  // Line 1: b3 <m_kind> 1 0
  const line1 = reader.readAsciiLine();
  if (!line1.startsWith("b3")) {
    throw new Error(`Expected binary ASL header 'b3', got: '${line1}'`);
  }

  // Line 2: nVars nConstraints nObj nRanges nEq 0
  const l2 = reader.readAsciiLine().split(/\s+/).map(Number);
  const nVars = l2[0] ?? 0;
  const nConstraints = l2[1] ?? 0;

  // Line 3: nlc nlo 0 0 0 0
  const l3 = reader.readAsciiLine().split(/\s+/).map(Number);
  const nlc = l3[0] ?? 0;
  const nlo = l3[1] ?? 0;

  // Line 4: network
  reader.readAsciiLine();

  // Line 5: nlvc nlvo nlvb 0 0
  reader.readAsciiLine();

  // Line 6: 0 0 nNzJacobian objGradLen
  reader.readAsciiLine();

  // Line 7: nbv niv
  const l7 = reader.readAsciiLine().split(/\s+/).map(Number);
  const nbv = l7[0] ?? 0;
  const niv = l7[1] ?? 0;

  // Setup problem structures
  const varNames: string[] = [];
  const varNameMap = new Map<string, number>();
  for (let j = 0; j < nVars; j++) {
    const vName = `x${j + 1}`;
    varNames.push(vName);
    varNameMap.set(vName, j);
  }

  const variables: InstantiatedProblem["variables"] = varNames.map((name, idx) => {
    let type: AmplVarType = "continuous";
    if (idx >= nVars - nbv) type = "binary";
    else if (idx >= nVars - nbv - niv) type = "integer";
    return {
      id: idx,
      name,
      baseName: name,
      indices: [],
      type,
      lb: 0,
      ub: Number.POSITIVE_INFINITY,
      initVal: 0,
    };
  });

  const constraints: InstantiatedProblem["constraints"] = [];
  for (let i = 0; i < nConstraints; i++) {
    constraints.push({
      id: i,
      name: `c${i + 1}`,
      expr: {
        constant: 0,
        linearTerms: [],
      },
      lb: Number.NEGATIVE_INFINITY,
      ub: 0,
    });
  }

  let objDirection: "minimize" | "maximize" = "minimize";
  let objConstant = 0;
  const objLinearTerms: FlatAffineTerm[] = [];

  // Parse segments
  while (!reader.isAtEnd()) {
    const segLine = reader.readAsciiLine();
    if (!segLine) continue;

    if (segLine.startsWith("C")) {
      skipBinaryAslExpr(reader);
      continue;
    }

    if (segLine.startsWith("O")) {
      const parts = segLine.split(/\s+/);
      const dirFlag = Number(parts[1] ?? 0);
      objDirection = dirFlag === 1 ? "maximize" : "minimize";
      skipBinaryAslExpr(reader);
      continue;
    }

    if (segLine === "r") {
      // Constraint bounds
      for (let i = 0; i < nConstraints; i++) {
        const flag = reader.readInt32();
        const c = constraints[i]!;
        switch (flag) {
          case 0:
            c.lb = reader.readFloat64();
            c.ub = reader.readFloat64();
            break;
          case 1:
            c.lb = Number.NEGATIVE_INFINITY;
            c.ub = reader.readFloat64();
            break;
          case 2:
            c.lb = reader.readFloat64();
            c.ub = Number.POSITIVE_INFINITY;
            break;
          case 3:
            c.lb = Number.NEGATIVE_INFINITY;
            c.ub = Number.POSITIVE_INFINITY;
            break;
          case 4: {
            const v = reader.readFloat64();
            c.lb = v;
            c.ub = v;
            break;
          }
        }
      }
      continue;
    }

    if (segLine === "b") {
      // Variable bounds
      for (let j = 0; j < nVars; j++) {
        const flag = reader.readInt32();
        const v = variables[j]!;
        switch (flag) {
          case 0:
            v.lb = reader.readFloat64();
            v.ub = reader.readFloat64();
            break;
          case 1:
            v.lb = Number.NEGATIVE_INFINITY;
            v.ub = reader.readFloat64();
            break;
          case 2:
            v.lb = reader.readFloat64();
            v.ub = Number.POSITIVE_INFINITY;
            break;
          case 3:
            v.lb = Number.NEGATIVE_INFINITY;
            v.ub = Number.POSITIVE_INFINITY;
            break;
          case 4: {
            const val = reader.readFloat64();
            v.lb = val;
            v.ub = val;
            break;
          }
        }
      }
      continue;
    }

    if (segLine.startsWith("k")) {
      // Cumulative Jacobian column offsets
      for (let c = 0; c < nVars - 1; c++) {
        reader.readInt32();
      }
      continue;
    }

    if (segLine.startsWith("J")) {
      const parts = segLine.split(/\s+/);
      const conIdx = Number(parts[0]!.slice(1));
      const len = Number(parts[1] ?? 0);
      const targetCon = constraints[conIdx];
      for (let k = 0; k < len; k++) {
        const varId = reader.readInt32();
        const coeff = reader.readFloat64();
        if (targetCon) {
          targetCon.expr.linearTerms.push({ varId, coeff });
        }
      }
      continue;
    }

    if (segLine.startsWith("G0")) {
      const parts = segLine.split(/\s+/);
      const len = Number(parts[1] ?? 0);
      for (let k = 0; k < len; k++) {
        const varId = reader.readInt32();
        const coeff = reader.readFloat64();
        objLinearTerms.push({ varId, coeff });
      }
      continue;
    }

    if (segLine.startsWith("S")) {
      const parts = segLine.split(/\s+/);
      const kind = Number(parts[0]!.slice(1));
      const len = Number(parts[1] ?? 0);
      const sufName = parts[2] ?? "";
      for (let k = 0; k < len; k++) {
        const itemLine = reader.readAsciiLine();
        const [idStr, valStr] = itemLine.split(/\s+/);
        const id = Number(idStr);
        const val = Number(valStr);
        if (kind === 0 || kind === 2) {
          const v = variables[id];
          if (v) {
            if (!v.customSuffixes) v.customSuffixes = new Map();
            v.customSuffixes.set(sufName, val);
          }
        } else if (kind === 1 || kind === 3) {
          const c = constraints[id];
          if (c) {
            if (!c.customSuffixes) c.customSuffixes = new Map();
            c.customSuffixes.set(sufName, val);
          }
        }
      }
      continue;
    }
  }

  let problemClass: InstantiatedProblem["problemClass"] = "LP";
  if (nlc > 0 || nlo > 0) {
    problemClass = nbv > 0 || niv > 0 ? "MINLP" : "NLP";
  } else if (nbv > 0 || niv > 0) {
    problemClass = "MILP";
  }

  return {
    name: "binary_asl_model",
    problemClass,
    variables,
    constraints,
    objective: {
      name: "obj",
      direction: objDirection,
      expr: {
        constant: objConstant,
        linearTerms: objLinearTerms,
      },
    },
    varNameMap,
  };
}

/**
 * Parses a binary .sol solution file into primal/dual vectors.
 */
export function readBinarySolResult(
  buffer: Uint8Array,
  nVars?: number,
  nConstraints?: number,
): SolFileResult {
  const reader = new BinaryStreamReader(buffer, true);
  const message = reader.readAsciiLine();

  const numbers: number[] = [];
  while (!reader.isAtEnd()) {
    try {
      numbers.push(reader.readFloat64());
    } catch {
      break;
    }
  }

  if (
    nVars !== undefined &&
    nConstraints !== undefined &&
    nConstraints > 0 &&
    numbers.length >= nConstraints + nVars
  ) {
    const offset = numbers.length - (nConstraints + nVars);
    const dualValues = numbers.slice(offset, offset + nConstraints);
    const primalValues = numbers.slice(offset + nConstraints, offset + nConstraints + nVars);
    return { message, options: {}, primalValues, dualValues };
  }

  return { message, options: {}, primalValues: numbers, dualValues: [] };
}
