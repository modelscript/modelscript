// SPDX-License-Identifier: AGPL-3.0-or-later

import { ChunkedUint8Array, createChunkedUint8Array, ChunkedUint32Array, createChunkedUint32Array, atomicChunkAlloc } from "./array";
import { UnmanagedMap64 } from "./hashmap";

@inline
function hashBytes64(ptr: usize, len: u32): u64 {
  let h: u64 = 0xcbf29ce484222325;
  for (let i: u32 = 0; i < len; i++) {
    h ^= load<u8>(ptr + i) as u64;
    h = h * 0x100000001b3;
  }
  return h == 0 ? 1 : h;
}

@inline
function hashChunkedBytes64(buf: ChunkedUint8Array, start: u32, len: u32): u64 {
  let h: u64 = 0xcbf29ce484222325;
  for (let i: u32 = 0; i < len; i++) {
    h ^= buf.get(start + i) as u64;
    h = h * 0x100000001b3;
  }
  return h == 0 ? 1 : h;
}

// Pre-assigned IDs for hot-path lookup
export const STRING_NULL_ID: u32 = 0;
export const STRING_REAL_ID: u32 = 1;
export const STRING_INTEGER_ID: u32 = 2;
export const STRING_BOOLEAN_ID: u32 = 3;
export const STRING_STRING_ID: u32 = 4;
export const STRING_PARAMETER_ID: u32 = 5;
export const STRING_CONSTANT_ID: u32 = 6;
export const STRING_DISCRETE_ID: u32 = 7;
export const STRING_CONTINUOUS_ID: u32 = 8;
export const STRING_INPUT_ID: u32 = 9;
export const STRING_OUTPUT_ID: u32 = 10;

/**
 * High-performance string pool for interning string paths (e.g. "motor.resistor.v") in linear memory.
 */
@unmanaged
export class ArenaStringPool {
  charBuffer: ChunkedUint8Array;
  charOffset: u32;

  stringOffsets: ChunkedUint32Array;
  stringLengths: ChunkedUint32Array;
  stringMapPtr: usize;
  pathMapPtr: usize;
  stringCount: u32;

  public static readonly NULL_ID: u32 = STRING_NULL_ID;
  public static readonly REAL: u32 = STRING_REAL_ID;
  public static readonly INTEGER: u32 = STRING_INTEGER_ID;
  public static readonly BOOLEAN: u32 = STRING_BOOLEAN_ID;
  public static readonly STRING: u32 = STRING_STRING_ID;
  public static readonly PARAMETER: u32 = STRING_PARAMETER_ID;
  public static readonly CONSTANT: u32 = STRING_CONSTANT_ID;
  public static readonly DISCRETE: u32 = STRING_DISCRETE_ID;
  public static readonly CONTINUOUS: u32 = STRING_CONTINUOUS_ID;
  public static readonly INPUT: u32 = STRING_INPUT_ID;
  public static readonly OUTPUT: u32 = STRING_OUTPUT_ID;

  @inline getStringMap(): UnmanagedMap64 {
    return changetype<UnmanagedMap64>(this.stringMapPtr);
  }

  @inline getPathMap(): UnmanagedMap64 {
    return changetype<UnmanagedMap64>(this.pathMapPtr);
  }

  init(): void {
    this.charBuffer = createChunkedUint8Array(64 * 1024);
    this.charOffset = 0;
    this.stringOffsets = createChunkedUint32Array(1024);
    this.stringLengths = createChunkedUint32Array(1024);
    this.stringCount = 1; // 0 reserved for null / empty

    let mapPtr = atomicChunkAlloc(sizeof<UnmanagedMap64>());
    this.stringMapPtr = mapPtr;
    this.getStringMap().init(1024);

    let pMapPtr = atomicChunkAlloc(sizeof<UnmanagedMap64>());
    this.pathMapPtr = pMapPtr;
    this.getPathMap().init(1024);

    // Initialize predefined keywords and built-in type symbols
    this._internPredefined("Real", STRING_REAL_ID);
    this._internPredefined("Integer", STRING_INTEGER_ID);
    this._internPredefined("Boolean", STRING_BOOLEAN_ID);
    this._internPredefined("String", STRING_STRING_ID);
    this._internPredefined("parameter", STRING_PARAMETER_ID);
    this._internPredefined("constant", STRING_CONSTANT_ID);
    this._internPredefined("discrete", STRING_DISCRETE_ID);
    this._internPredefined("continuous", STRING_CONTINUOUS_ID);
    this._internPredefined("input", STRING_INPUT_ID);
    this._internPredefined("output", STRING_OUTPUT_ID);

    this._internPredefinedKeywords();
  }

  private _internPredefined(s: string, expectedId: u32): void {
    let len: u32 = s.length;
    let id = this.stringCount++;
    let start = this.charOffset;
    this.stringOffsets.set(id, start);
    this.stringLengths.set(id, len);

    for (let i: u32 = 0; i < len; i++) {
      this.charBuffer.set(start + i, s.charCodeAt(i) as u8);
    }
    this.charOffset += len;

    let h = hashChunkedBytes64(this.charBuffer, start, len);
    this.getStringMap().set(h, id);
  }

  private _internPredefinedKeywords(): void {
    const kws: string[] = [
      "model", "record", "block", "connector", "type", "package", "function",
      "equation", "algorithm", "initial equation", "initial algorithm", "public",
      "protected", "encapsulated", "partial", "within", "extends", "import", "end",
      "annotation", "der", "time", "true", "false", "if", "then", "elseif", "else",
      "for", "while", "loop", "return", "break", "connect", "flow", "stream", "inner",
      "outer", "replaceable", "redeclare", "constrainedby", "final", "each", "pure", "impure"
    ];
    for (let i = 0; i < kws.length; i++) {
      let kw = kws[i];
      let len: u32 = kw.length;
      let start = this.charOffset;
      for (let j: u32 = 0; j < len; j++) {
        this.charBuffer.set(start + j, kw.charCodeAt(j) as u8);
      }
      let h = hashChunkedBytes64(this.charBuffer, start, len);
      if (!this.getStringMap().has(h)) {
        let id = this.stringCount++;
        this.stringOffsets.set(id, start);
        this.stringLengths.set(id, len);
        this.charOffset += len;
        this.getStringMap().set(h, id);
      }
    }
  }

  intern(srcPtr: usize, len: u32): u32 {
    if (len == 0 || srcPtr == 0) return 0;
    let h = hashBytes64(srcPtr, len);
    let existingId = this.getStringMap().get(h);
    if (existingId != 0 && this._matches(existingId, srcPtr, len)) {
      return existingId;
    }

    let id = this.stringCount++;
    let start = this.charOffset;
    this.stringOffsets.set(id, start);
    this.stringLengths.set(id, len);

    for (let i: u32 = 0; i < len; i++) {
      let b = load<u8>(srcPtr + i);
      this.charBuffer.set(start + i, b);
    }
    this.charOffset += len;
    this.getStringMap().set(h, id);
    return id;
  }

  internUtf16(srcPtr: usize, byteLen: u32): u32 {
    if (byteLen == 0 || srcPtr == 0) return 0;
    let charCount = byteLen >> 1;
    if (charCount == 0) return 0;

    let tempStart = this.charOffset;
    let outOffset = tempStart;

    for (let i: u32 = 0; i < charCount; i++) {
      let ch = load<u16>(srcPtr + ((i as usize) << 1));
      if (ch <= 0x7f) {
        this.charBuffer.set(outOffset++, ch as u8);
      } else if (ch <= 0x7ff) {
        this.charBuffer.set(outOffset++, (0xc0 | ((ch >> 6) & 0x1f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | (ch & 0x3f)) as u8);
      } else if (ch >= 0xd800 && ch <= 0xdbff && i + 1 < charCount) {
        let low = load<u16>(srcPtr + (((i + 1) as usize) << 1));
        if (low >= 0xdc00 && low <= 0xdfff) {
          let codePoint: u32 = 0x10000 + (((ch as u32 - 0xd800) << 10) | (low as u32 - 0xdc00));
          this.charBuffer.set(outOffset++, (0xf0 | ((codePoint >> 18) & 0x07)) as u8);
          this.charBuffer.set(outOffset++, (0x80 | ((codePoint >> 12) & 0x3f)) as u8);
          this.charBuffer.set(outOffset++, (0x80 | ((codePoint >> 6) & 0x3f)) as u8);
          this.charBuffer.set(outOffset++, (0x80 | (codePoint & 0x3f)) as u8);
          i++; // skip low surrogate
        } else {
          // Unpaired high surrogate
          this.charBuffer.set(outOffset++, (0xe0 | ((ch >> 12) & 0x0f)) as u8);
          this.charBuffer.set(outOffset++, (0x80 | ((ch >> 6) & 0x3f)) as u8);
          this.charBuffer.set(outOffset++, (0x80 | (ch & 0x3f)) as u8);
        }
      } else {
        this.charBuffer.set(outOffset++, (0xe0 | ((ch >> 12) & 0x0f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | ((ch >> 6) & 0x3f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | (ch & 0x3f)) as u8);
      }
    }

    let outLen = outOffset - tempStart;
    let h = hashChunkedBytes64(this.charBuffer, tempStart, outLen);
    let existingId = this.getStringMap().get(h);
    if (existingId != 0 && this._matchesChunk(existingId, tempStart, outLen)) {
      return existingId;
    }

    let id = this.stringCount++;
    this.stringOffsets.set(id, tempStart);
    this.stringLengths.set(id, outLen);
    this.charOffset += outLen;
    this.getStringMap().set(h, id);
    return id;
  }

  internUtf32(srcPtr: usize, byteLen: u32): u32 {
    if (byteLen == 0 || srcPtr == 0) return 0;
    let charCount = byteLen >> 2;
    if (charCount == 0) return 0;

    let tempStart = this.charOffset;
    let outOffset = tempStart;

    for (let i: u32 = 0; i < charCount; i++) {
      let cp = load<u32>(srcPtr + ((i as usize) << 2));
      if (cp <= 0x7f) {
        this.charBuffer.set(outOffset++, cp as u8);
      } else if (cp <= 0x7ff) {
        this.charBuffer.set(outOffset++, (0xc0 | ((cp >> 6) & 0x1f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | (cp & 0x3f)) as u8);
      } else if (cp <= 0xffff) {
        this.charBuffer.set(outOffset++, (0xe0 | ((cp >> 12) & 0x0f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | ((cp >> 6) & 0x3f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | (cp & 0x3f)) as u8);
      } else {
        this.charBuffer.set(outOffset++, (0xf0 | ((cp >> 18) & 0x07)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | ((cp >> 12) & 0x3f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | ((cp >> 6) & 0x3f)) as u8);
        this.charBuffer.set(outOffset++, (0x80 | (cp & 0x3f)) as u8);
      }
    }

    let outLen = outOffset - tempStart;
    let h = hashChunkedBytes64(this.charBuffer, tempStart, outLen);
    let existingId = this.getStringMap().get(h);
    if (existingId != 0 && this._matchesChunk(existingId, tempStart, outLen)) {
      return existingId;
    }

    let id = this.stringCount++;
    this.stringOffsets.set(id, tempStart);
    this.stringLengths.set(id, outLen);
    this.charOffset += outLen;
    this.getStringMap().set(h, id);
    return id;
  }

  lookup(srcPtr: usize, len: u32): u32 {
    if (len == 0 || srcPtr == 0) return 0;
    let h = hashBytes64(srcPtr, len);
    let existingId = this.getStringMap().get(h);
    if (existingId != 0 && this._matches(existingId, srcPtr, len)) {
      return existingId;
    }
    return 0;
  }

  tryGet(srcPtr: usize, len: u32): u32 {
    return this.lookup(srcPtr, len);
  }

  private _matches(id: u32, srcPtr: usize, len: u32): boolean {
    if (id >= this.stringCount) return false;
    let storedLen = this.stringLengths.get(id);
    if (storedLen != len) return false;
    let start = this.stringOffsets.get(id);
    for (let i: u32 = 0; i < len; i++) {
      if (this.charBuffer.get(start + i) != load<u8>(srcPtr + i)) return false;
    }
    return true;
  }

  private _matchesChunk(id: u32, startB: u32, len: u32): boolean {
    if (id >= this.stringCount) return false;
    let storedLen = this.stringLengths.get(id);
    if (storedLen != len) return false;
    let startA = this.stringOffsets.get(id);
    for (let i: u32 = 0; i < len; i++) {
      if (this.charBuffer.get(startA + i) != this.charBuffer.get(startB + i)) return false;
    }
    return true;
  }

  internChunk(start: u32, len: u32): u32 {
    if (len == 0) return 0;
    let h = hashChunkedBytes64(this.charBuffer, start, len);
    let existingId = this.getStringMap().get(h);
    if (existingId != 0 && this._matchesChunk(existingId, start, len)) {
      return existingId;
    }
    let tempStart = this.charOffset;
    for (let i: u32 = 0; i < len; i++) {
      this.charBuffer.set(tempStart + i, this.charBuffer.get(start + i));
    }
    let id = this.stringCount++;
    this.stringOffsets.set(id, tempStart);
    this.stringLengths.set(id, len);
    this.charOffset += len;
    this.getStringMap().set(h, id);
    return id;
  }

  getParentPrefix(id: u32): u32 {
    if (id == 0 || id >= this.stringCount) return 0;
    let len = this.stringLengths.get(id);
    let off = this.stringOffsets.get(id);
    let lastDot: i32 = -1;
    for (let i: i32 = (len as i32) - 1; i >= 0; i--) {
      if (this.charBuffer.get(off + i) == 46) { // '.'
        lastDot = i;
        break;
      }
    }
    if (lastDot <= 0) return 0;
    return this.internChunk(off, lastDot as u32);
  }

  concat(prefixId: u32, suffixPtr: usize, suffixLen: u32): u32 {
    if (prefixId == 0) return this.intern(suffixPtr, suffixLen);
    if (suffixLen == 0 || suffixPtr == 0) return prefixId;
    let suffixId = this.intern(suffixPtr, suffixLen);
    return this.concatIds(prefixId, suffixId);
  }

  concatIds(prefixId: u32, suffixId: u32): u32 {
    if (prefixId == 0) return suffixId;
    if (suffixId == 0) return prefixId;

    let pathKey: u64 = ((prefixId as u64) << 32) | (suffixId as u64);
    let cachedId = this.getPathMap().get(pathKey);
    if (cachedId != 0) return cachedId;

    let prefLen = prefixId < this.stringCount ? this.stringLengths.get(prefixId) : 0;
    let prefStart = prefixId < this.stringCount ? this.stringOffsets.get(prefixId) : 0;
    let suffLen = suffixId < this.stringCount ? this.stringLengths.get(suffixId) : 0;
    let suffStart = suffixId < this.stringCount ? this.stringOffsets.get(suffixId) : 0;
    let totalLen = prefLen + 1 + suffLen; // prefix + "." + suffix

    let tempStart = this.charOffset;
    for (let i: u32 = 0; i < prefLen; i++) {
      this.charBuffer.set(tempStart + i, this.charBuffer.get(prefStart + i));
    }
    this.charBuffer.set(tempStart + prefLen, 46); // '.' ASCII 46

    for (let i: u32 = 0; i < suffLen; i++) {
      this.charBuffer.set(tempStart + prefLen + 1 + i, this.charBuffer.get(suffStart + i));
    }

    let h = hashChunkedBytes64(this.charBuffer, tempStart, totalLen);
    let existingId = this.getStringMap().get(h);
    if (existingId != 0 && this._matchesChunk(existingId, tempStart, totalLen)) {
      this.getPathMap().set(pathKey, existingId);
      return existingId;
    }

    let id = this.stringCount++;
    this.stringOffsets.set(id, tempStart);
    this.stringLengths.set(id, totalLen);
    this.charOffset += totalLen;
    this.getStringMap().set(h, id);
    this.getPathMap().set(pathKey, id);
    return id;
  }

  getLength(id: u32): u32 {
    return id < this.stringCount ? this.stringLengths.get(id) : 0;
  }

  getOffset(id: u32): u32 {
    return id < this.stringCount ? this.stringOffsets.get(id) : 0;
  }

  copyOut(id: u32, targetBuf: usize): u32 {
    if (id >= this.stringCount) return 0;
    let len = this.stringLengths.get(id);
    if (targetBuf == 0) return len;
    let start = this.stringOffsets.get(id);
    for (let i: u32 = 0; i < len; i++) {
      store<u8>(targetBuf + i, this.charBuffer.get(start + i));
    }
    return len;
  }

  equals(id1: u32, id2: u32): boolean {
    if (id1 == id2) return true;
    if (id1 == 0 || id2 == 0 || id1 >= this.stringCount || id2 >= this.stringCount) return false;
    let len1 = this.stringLengths.get(id1);
    let len2 = this.stringLengths.get(id2);
    if (len1 != len2) return false;
    let off1 = this.stringOffsets.get(id1);
    let off2 = this.stringOffsets.get(id2);
    for (let i: u32 = 0; i < len1; i++) {
      if (this.charBuffer.get(off1 + i) != this.charBuffer.get(off2 + i)) return false;
    }
    return true;
  }

  hasPrefix(id: u32, prefixId: u32): boolean {
    if (id == 0 || prefixId == 0 || id >= this.stringCount || prefixId >= this.stringCount) return false;
    let len = this.stringLengths.get(id);
    let prefLen = this.stringLengths.get(prefixId);
    if (len <= prefLen) return false;
    let off = this.stringOffsets.get(id);
    let prefOff = this.stringOffsets.get(prefixId);
    for (let i: u32 = 0; i < prefLen; i++) {
      if (this.charBuffer.get(off + i) != this.charBuffer.get(prefOff + i)) return false;
    }
    return this.charBuffer.get(off + prefLen) == 46; // '.'
  }

  getSuffixAfterPrefix(id: u32, prefixId: u32): u32 {
    if (!this.hasPrefix(id, prefixId)) return 0;
    let len = this.stringLengths.get(id);
    let prefLen = this.stringLengths.get(prefixId);
    let suffLen = len - prefLen - 1;
    let suffStart = this.stringOffsets.get(id) + prefLen + 1;
    return this.internChunk(suffStart, suffLen);
  }

  isTime(id: u32): boolean {
    if (id >= this.stringCount) return false;
    if (this.stringLengths.get(id) != 4) return false;
    let off = this.stringOffsets.get(id);
    return this.charBuffer.get(off) == 116 && // 't'
           this.charBuffer.get(off + 1) == 105 && // 'i'
           this.charBuffer.get(off + 2) == 109 && // 'm'
           this.charBuffer.get(off + 3) == 101;   // 'e'
  }

  hasDot(id: u32): boolean {
    if (id >= this.stringCount) return false;
    let len = this.stringLengths.get(id);
    let off = this.stringOffsets.get(id);
    for (let i: u32 = 0; i < len; i++) {
      if (this.charBuffer.get(off + i) == 46) return true;
    }
    return false;
  }

  matchBuiltinMathFunc(id: u32): i32 {
    if (id < 11 || id >= this.stringCount) return -1;
    let len = this.stringLengths.get(id);
    let off = this.stringOffsets.get(id);
    // Strip package prefix such as "Modelica.Math." or "Math."
    let lastDot: i32 = -1;
    for (let i: u32 = 0; i < len; i++) {
      if (this.charBuffer.get(off + i) == 46) {
        lastDot = i as i32;
      }
    }
    if (lastDot >= 0) {
      let skip = (lastDot as u32) + 1;
      if (skip >= len) return -1;
      off += skip;
      len -= skip;
    }
    let c0 = len > 0 ? this.charBuffer.get(off) : 0;
    let c1 = len > 1 ? this.charBuffer.get(off + 1) : 0;
    let c2 = len > 2 ? this.charBuffer.get(off + 2) : 0;
    if (len == 3) {
      if (c0 == 115 && c1 == 105 && c2 == 110) return 0;  // "sin"
      if (c0 == 99  && c1 == 111 && c2 == 115) return 1;  // "cos"
      if (c0 == 116 && c1 == 97  && c2 == 110) return 2;  // "tan"
      if (c0 == 101 && c1 == 120 && c2 == 112) return 10; // "exp"
      if (c0 == 108 && c1 == 111 && c2 == 103) return 11; // "log"
      if (c0 == 97  && c1 == 98  && c2 == 115) return 14; // "abs"
      if (c0 == 109 && c1 == 105 && c2 == 110) return 16; // "min"
      if (c0 == 109 && c1 == 97  && c2 == 120) return 17; // "max"
      if (c0 == 109 && c1 == 111 && c2 == 100) return 20; // "mod"
      if (c0 == 114 && c1 == 101 && c2 == 109) return 20; // "rem"
      if (c0 == 112 && c1 == 111 && c2 == 119) return 21; // "pow"
      return -1;
    }
    if (len == 4) {
      let c3 = this.charBuffer.get(off + 3);
      if (c0 == 97  && c1 == 115 && c2 == 105 && c3 == 110) return 3;  // "asin"
      if (c0 == 97  && c1 == 99  && c2 == 111 && c3 == 115) return 4;  // "acos"
      if (c0 == 97  && c1 == 116 && c2 == 97  && c3 == 110) return 5;  // "atan"
      if (c0 == 115 && c1 == 105 && c2 == 110 && c3 == 104) return 7;  // "sinh"
      if (c0 == 99  && c1 == 111 && c2 == 115 && c3 == 104) return 8;  // "cosh"
      if (c0 == 116 && c1 == 97  && c2 == 110 && c3 == 104) return 9;  // "tanh"
      if (c0 == 115 && c1 == 113 && c2 == 114 && c3 == 116) return 13; // "sqrt"
      if (c0 == 115 && c1 == 105 && c2 == 103 && c3 == 110) return 15; // "sign"
      if (c0 == 99  && c1 == 101 && c2 == 105 && c3 == 108) return 19; // "ceil"
      if (c0 == 102 && c1 == 109 && c2 == 111 && c3 == 100) return 20; // "fmod"
      return -1;
    }
    if (len == 5) {
      let c3 = this.charBuffer.get(off + 3);
      let c4 = this.charBuffer.get(off + 4);
      if (c0 == 97  && c1 == 116 && c2 == 97  && c3 == 110 && c4 == 50)  return 6;  // "atan2"
      if (c0 == 108 && c1 == 111 && c2 == 103 && c3 == 49  && c4 == 48)  return 12; // "log10"
      if (c0 == 102 && c1 == 108 && c2 == 111 && c3 == 111 && c4 == 114) return 18; // "floor"
      return -1;
    }
    if (len == 6) {
      // "smooth"
      if (c0 == 115 && c1 == 109 && c2 == 111 && this.charBuffer.get(off + 3) == 111 && this.charBuffer.get(off + 4) == 116 && this.charBuffer.get(off + 5) == 104) return 23;
      return -1;
    }
    if (len == 7) {
      // "noEvent"
      if (c0 == 110 && c1 == 111 && c2 == 69 && this.charBuffer.get(off + 3) == 118 && this.charBuffer.get(off + 4) == 101 && this.charBuffer.get(off + 5) == 110 && this.charBuffer.get(off + 6) == 116) return 22;
      return -1;
    }
    if (len == 8) {
      // "homotopy"
      if (c0 == 104 && c1 == 111 && c2 == 109 && this.charBuffer.get(off + 3) == 111 && this.charBuffer.get(off + 4) == 116 && this.charBuffer.get(off + 5) == 111 && this.charBuffer.get(off + 6) == 112 && this.charBuffer.get(off + 7) == 121) return 24;
      return -1;
    }
    if (len == 10) {
      // "semiLinear"
      if (c0 == 115 && c1 == 101 && c2 == 109 && this.charBuffer.get(off + 3) == 105 && this.charBuffer.get(off + 4) == 76 && this.charBuffer.get(off + 5) == 105 && this.charBuffer.get(off + 6) == 110 && this.charBuffer.get(off + 7) == 101 && this.charBuffer.get(off + 8) == 97 && this.charBuffer.get(off + 9) == 114) return 25;
      return -1;
    }
    return -1;
  }

  resolveBuiltinMathFunc(funcId: i32): i32 {
    if (funcId >= 11 && (funcId as u32) < this.stringCount) {
      let matched = this.matchBuiltinMathFunc(funcId as u32);
      if (matched >= 0) return matched;
    }
    if (funcId >= 56 && funcId <= 81 && (funcId as u32) >= this.stringCount) {
      return funcId - 56;
    }
    if (funcId >= 0 && funcId <= 25) {
      return funcId;
    }
    return -1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// C-Style WASM Bridge Exports
// ─────────────────────────────────────────────────────────────────────────────

export function stringPool_create(): usize {
  let ptr = atomicChunkAlloc(sizeof<ArenaStringPool>());
  let pool = changetype<ArenaStringPool>(ptr);
  pool.init();
  return ptr;
}

export function stringPool_internUtf8(poolPtr: usize, strPtr: usize, len: u32): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).intern(strPtr, len);
}

export function stringPool_internUtf16(poolPtr: usize, strPtr: usize, byteLen: u32): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).internUtf16(strPtr, byteLen);
}

export function stringPool_lookupUtf8(poolPtr: usize, strPtr: usize, len: u32): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).lookup(strPtr, len);
}

export function stringPool_concatIds(poolPtr: usize, id1: u32, id2: u32): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).concatIds(id1, id2);
}

export function stringPool_getOffset(poolPtr: usize, id: u32): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).getOffset(id);
}

export function stringPool_getLength(poolPtr: usize, id: u32): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).getLength(id);
}

export function stringPool_copyOut(poolPtr: usize, id: u32, targetBuf: usize): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).copyOut(id, targetBuf);
}

export function stringPool_getSize(poolPtr: usize): u32 {
  if (poolPtr == 0) return 0;
  return changetype<ArenaStringPool>(poolPtr).stringCount;
}

