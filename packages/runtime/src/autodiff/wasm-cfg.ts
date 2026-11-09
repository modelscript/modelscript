// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview WebAssembly Binary Decoder, Encoder, and Control Flow Graph (CFG) Engine.
 *
 * Provides low-level, zero-dependency parsing and manipulation of WebAssembly (.wasm)
 * bytecode binaries for compiler-level automatic differentiation (AD).
 *
 * Academic Citations:
 * - Haas, A., et al. (2017). "Bringing the web up to speed with WebAssembly."
 *   ACM SIGPLAN Notices, 52(6), pp. 185-200. https://doi.org/10.1145/3062341.3062363
 * - Moses, V., & Churavy, V. (2020). "Instead of rewriting everything, combine differentiable
 *   programming with existing code (Enzyme)." Advances in Neural Information Processing Systems, 33, 12472-12485.
 */

// ── WASM Section IDs ──
export const SEC_CUSTOM = 0;
export const SEC_TYPE = 1;
export const SEC_IMPORT = 2;
export const SEC_FUNCTION = 3;
export const SEC_TABLE = 4;
export const SEC_MEMORY = 5;
export const SEC_GLOBAL = 6;
export const SEC_EXPORT = 7;
export const SEC_START = 8;
export const SEC_ELEMENT = 9;
export const SEC_CODE = 10;
export const SEC_DATA = 11;

// ── WASM Type Tags ──
export const TYPE_I32 = 0x7f;
export const TYPE_I64 = 0x7e;
export const TYPE_F32 = 0x7d;
export const TYPE_F64 = 0x7c;
export const TYPE_VOID = 0x40;
export const TYPE_FUNC = 0x60;

// ── Core Opcodes ──
export const OP_UNREACHABLE = 0x00;
export const OP_NOP = 0x01;
export const OP_BLOCK = 0x02;
export const OP_LOOP = 0x03;
export const OP_IF = 0x04;
export const OP_ELSE = 0x05;
export const OP_END = 0x0b;
export const OP_BR = 0x0c;
export const OP_BR_IF = 0x0d;
export const OP_RETURN = 0x0f;
export const OP_CALL = 0x10;

export const OP_DROP = 0x1a;
export const OP_SELECT = 0x1b;

export const OP_LOCAL_GET = 0x20;
export const OP_LOCAL_SET = 0x21;
export const OP_LOCAL_TEE = 0x22;
export const OP_GLOBAL_GET = 0x23;
export const OP_GLOBAL_SET = 0x24;

export const OP_I32_CONST = 0x41;
export const OP_F64_CONST = 0x44;

export const OP_I32_EQZ = 0x45;
export const OP_I32_EQ = 0x46;
export const OP_I32_NE = 0x47;
export const OP_I32_LT_S = 0x48;
export const OP_I32_GT_S = 0x4a;
export const OP_I32_LE_S = 0x4c;
export const OP_I32_GE_S = 0x4e;
export const OP_I32_ADD = 0x6a;
export const OP_I32_SUB = 0x6b;
export const OP_I32_MUL = 0x6c;

export const OP_I32_LOAD = 0x28;
export const OP_F64_LOAD = 0x2b;
export const OP_I32_STORE = 0x36;
export const OP_F64_STORE = 0x39;

export const OP_F64_EQ = 0x61;
export const OP_F64_NE = 0x62;
export const OP_F64_LT = 0x63;
export const OP_F64_GT = 0x64;
export const OP_F64_LE = 0x65;
export const OP_F64_GE = 0x66;
export const OP_F64_ABS = 0x99;
export const OP_F64_NEG = 0x9a;
export const OP_F64_SQRT = 0xa4;
export const OP_F64_ADD = 0xa0;
export const OP_F64_SUB = 0xa1;
export const OP_F64_MUL = 0xa2;
export const OP_F64_DIV = 0xa3;

// ── AST Interfaces ──

export interface WasmType {
  params: number[];
  results: number[];
}

export interface WasmMemory {
  min: number;
  max?: number | undefined;
}

export interface WasmMemArg {
  align: number;
  offset: number;
}

export interface WasmExport {
  name: string;
  kind: number; // 0 = func, 1 = table, 2 = mem, 3 = global
  index: number;
}

export interface WasmLocalDecl {
  count: number;
  type: number;
}

export interface WasmInstruction {
  opcode: number;
  imm?: any;
}

export interface WasmFunction {
  typeIdx: number;
  locals: WasmLocalDecl[];
  instructions: WasmInstruction[];
}

export interface WasmModule {
  types: WasmType[];
  functions: number[]; // typeIdx for each function
  memories?: WasmMemory[] | undefined;
  exports: WasmExport[];
  code: WasmFunction[];
  rawSections: { id: number; bytes: Uint8Array }[];
}

// ── LEB128 Reader & Writer ──

export function readU32Leb128(bytes: Uint8Array, offset: { pos: number }): number {
  let result = 0;
  let shift = 0;
  while (true) {
    const byte = bytes[offset.pos++]!;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return result >>> 0;
}

export function writeU32Leb128(val: number): number[] {
  const res: number[] = [];
  let v = val >>> 0;
  while (true) {
    const byte = v & 0x7f;
    v >>>= 7;
    if (v === 0) {
      res.push(byte);
      break;
    } else {
      res.push(byte | 0x80);
    }
  }
  return res;
}

export function readI32Leb128(bytes: Uint8Array, offset: { pos: number }): number {
  let result = 0;
  let shift = 0;
  let byte = 0;
  while (true) {
    byte = bytes[offset.pos++]!;
    result |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
  }
  if (shift < 32 && (byte & 0x40) !== 0) {
    result |= ~0 << shift;
  }
  return result;
}

export function writeI32Leb128(val: number): number[] {
  const res: number[] = [];
  let v = val;
  let more = true;
  while (more) {
    let byte = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
      more = false;
    } else {
      byte |= 0x80;
    }
    res.push(byte);
  }
  return res;
}

export function readF64(bytes: Uint8Array, offset: { pos: number }): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset.pos, 8);
  const val = view.getFloat64(0, true);
  offset.pos += 8;
  return val;
}

export function writeF64(val: number): number[] {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, val, true);
  return Array.from(new Uint8Array(buf));
}

// ── Decoder ──

export function decodeWasmModule(bytes: Uint8Array): WasmModule {
  const offset = { pos: 0 };
  // Check magic \0asm
  if (bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d || bytes[4] !== 0x01) {
    throw new Error("decodeWasmModule: Invalid WASM binary header.");
  }
  offset.pos = 8; // skip magic and version

  const types: WasmType[] = [];
  let functions: number[] = [];
  const memories: WasmMemory[] = [];
  const exports: WasmExport[] = [];
  const code: WasmFunction[] = [];
  const rawSections: { id: number; bytes: Uint8Array }[] = [];

  while (offset.pos < bytes.length) {
    const secId = bytes[offset.pos++]!;
    const secLen = readU32Leb128(bytes, offset);
    const secStart = offset.pos;
    const secEnd = secStart + secLen;

    const secBytes = bytes.slice(secStart, secEnd);
    rawSections.push({ id: secId, bytes: secBytes });

    const secOffset = { pos: secStart };

    if (secId === SEC_TYPE) {
      const count = readU32Leb128(bytes, secOffset);
      for (let i = 0; i < count; i++) {
        const form = bytes[secOffset.pos++]!;
        if (form !== TYPE_FUNC) throw new Error(`Unsupported type form: ${form}`);
        const pCount = readU32Leb128(bytes, secOffset);
        const params: number[] = [];
        for (let p = 0; p < pCount; p++) params.push(bytes[secOffset.pos++]!);
        const rCount = readU32Leb128(bytes, secOffset);
        const results: number[] = [];
        for (let r = 0; r < rCount; r++) results.push(bytes[secOffset.pos++]!);
        types.push({ params, results });
      }
    } else if (secId === SEC_FUNCTION) {
      const count = readU32Leb128(bytes, secOffset);
      for (let i = 0; i < count; i++) {
        functions.push(readU32Leb128(bytes, secOffset));
      }
    } else if (secId === SEC_MEMORY) {
      const count = readU32Leb128(bytes, secOffset);
      for (let i = 0; i < count; i++) {
        const flags = readU32Leb128(bytes, secOffset);
        const min = readU32Leb128(bytes, secOffset);
        const max = (flags & 0x01) !== 0 ? readU32Leb128(bytes, secOffset) : undefined;
        memories.push({ min, max });
      }
    } else if (secId === SEC_EXPORT) {
      const count = readU32Leb128(bytes, secOffset);
      for (let i = 0; i < count; i++) {
        const strLen = readU32Leb128(bytes, secOffset);
        let name = "";
        for (let c = 0; c < strLen; c++) {
          name += String.fromCharCode(bytes[secOffset.pos++]!);
        }
        const kind = bytes[secOffset.pos++]!;
        const index = readU32Leb128(bytes, secOffset);
        exports.push({ name, kind, index });
      }
    } else if (secId === SEC_CODE) {
      const count = readU32Leb128(bytes, secOffset);
      for (let i = 0; i < count; i++) {
        const bodySize = readU32Leb128(bytes, secOffset);
        const bodyEnd = secOffset.pos + bodySize;

        const localCount = readU32Leb128(bytes, secOffset);
        const locals: WasmLocalDecl[] = [];
        for (let l = 0; l < localCount; l++) {
          const lCnt = readU32Leb128(bytes, secOffset);
          const lType = bytes[secOffset.pos++]!;
          locals.push({ count: lCnt, type: lType });
        }

        const instructions: WasmInstruction[] = [];
        while (secOffset.pos < bodyEnd) {
          const op = bytes[secOffset.pos++]!;
          let imm: any = undefined;

          if (op === OP_BLOCK || op === OP_LOOP || op === OP_IF) {
            imm = bytes[secOffset.pos++]!; // blocktype
          } else if (op === OP_BR || op === OP_BR_IF) {
            imm = readU32Leb128(bytes, secOffset);
          } else if (op === OP_CALL) {
            imm = readU32Leb128(bytes, secOffset);
          } else if (
            op === OP_LOCAL_GET ||
            op === OP_LOCAL_SET ||
            op === OP_LOCAL_TEE ||
            op === OP_GLOBAL_GET ||
            op === OP_GLOBAL_SET
          ) {
            imm = readU32Leb128(bytes, secOffset);
          } else if (op === OP_I32_LOAD || op === OP_F64_LOAD || op === OP_I32_STORE || op === OP_F64_STORE) {
            const align = readU32Leb128(bytes, secOffset);
            const memOffset = readU32Leb128(bytes, secOffset);
            imm = { align, offset: memOffset } satisfies WasmMemArg;
          } else if (op === OP_I32_CONST) {
            imm = readI32Leb128(bytes, secOffset);
          } else if (op === OP_F64_CONST) {
            imm = readF64(bytes, secOffset);
          }

          instructions.push({ opcode: op, imm });
        }

        code.push({
          typeIdx: functions[i] ?? 0,
          locals,
          instructions,
        });
      }
    }

    offset.pos = secEnd;
  }

  return {
    types,
    functions,
    memories: memories.length > 0 ? memories : undefined,
    exports,
    code,
    rawSections,
  };
}

// ── Encoder ──

export function encodeWasmModule(module: WasmModule): Uint8Array {
  const out: number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  // Helper to emit section
  function emitSection(id: number, payload: number[]): void {
    out.push(id);
    out.push(...writeU32Leb128(payload.length));
    out.push(...payload);
  }

  // 1. Type Section
  const typePayload: number[] = [...writeU32Leb128(module.types.length)];
  for (const t of module.types) {
    typePayload.push(TYPE_FUNC);
    typePayload.push(...writeU32Leb128(t.params.length));
    for (const p of t.params) typePayload.push(p);
    typePayload.push(...writeU32Leb128(t.results.length));
    for (const r of t.results) typePayload.push(r);
  }
  emitSection(SEC_TYPE, typePayload);

  // 3. Function Section
  const funcPayload: number[] = [...writeU32Leb128(module.functions.length)];
  for (const f of module.functions) {
    funcPayload.push(...writeU32Leb128(f));
  }
  emitSection(SEC_FUNCTION, funcPayload);

  // 5. Memory Section (optional)
  if (module.memories && module.memories.length > 0) {
    const memPayload: number[] = [...writeU32Leb128(module.memories.length)];
    for (const m of module.memories) {
      if (m.max !== undefined) {
        memPayload.push(0x01);
        memPayload.push(...writeU32Leb128(m.min));
        memPayload.push(...writeU32Leb128(m.max));
      } else {
        memPayload.push(0x00);
        memPayload.push(...writeU32Leb128(m.min));
      }
    }
    emitSection(SEC_MEMORY, memPayload);
  }

  // 7. Export Section
  const expPayload: number[] = [...writeU32Leb128(module.exports.length)];
  for (const exp of module.exports) {
    const nameBytes = Array.from(new TextEncoder().encode(exp.name));
    expPayload.push(...writeU32Leb128(nameBytes.length));
    expPayload.push(...nameBytes);
    expPayload.push(exp.kind);
    expPayload.push(...writeU32Leb128(exp.index));
  }
  emitSection(SEC_EXPORT, expPayload);

  // 10. Code Section
  const codePayload: number[] = [...writeU32Leb128(module.code.length)];
  for (const fn of module.code) {
    const bodyBytes: number[] = [];

    // Locals
    bodyBytes.push(...writeU32Leb128(fn.locals.length));
    for (const loc of fn.locals) {
      bodyBytes.push(...writeU32Leb128(loc.count));
      bodyBytes.push(loc.type);
    }

    // Instructions
    for (const inst of fn.instructions) {
      bodyBytes.push(inst.opcode);
      if (inst.opcode === OP_BLOCK || inst.opcode === OP_LOOP || inst.opcode === OP_IF) {
        bodyBytes.push(inst.imm);
      } else if (inst.opcode === OP_BR || inst.opcode === OP_BR_IF) {
        bodyBytes.push(...writeU32Leb128(inst.imm));
      } else if (inst.opcode === OP_CALL) {
        bodyBytes.push(...writeU32Leb128(inst.imm));
      } else if (
        inst.opcode === OP_LOCAL_GET ||
        inst.opcode === OP_LOCAL_SET ||
        inst.opcode === OP_LOCAL_TEE ||
        inst.opcode === OP_GLOBAL_GET ||
        inst.opcode === OP_GLOBAL_SET
      ) {
        bodyBytes.push(...writeU32Leb128(inst.imm));
      } else if (
        inst.opcode === OP_I32_LOAD ||
        inst.opcode === OP_F64_LOAD ||
        inst.opcode === OP_I32_STORE ||
        inst.opcode === OP_F64_STORE
      ) {
        const align = inst.imm?.align ?? 3;
        const memOffset = inst.imm?.offset ?? 0;
        bodyBytes.push(...writeU32Leb128(align));
        bodyBytes.push(...writeU32Leb128(memOffset));
      } else if (inst.opcode === OP_I32_CONST) {
        bodyBytes.push(...writeI32Leb128(inst.imm));
      } else if (inst.opcode === OP_F64_CONST) {
        bodyBytes.push(...writeF64(inst.imm));
      }
    }

    codePayload.push(...writeU32Leb128(bodyBytes.length));
    codePayload.push(...bodyBytes);
  }
  emitSection(SEC_CODE, codePayload);

  return new Uint8Array(out);
}
