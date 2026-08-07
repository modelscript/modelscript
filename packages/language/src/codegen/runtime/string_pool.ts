import { ChunkedUint8Array, createChunkedUint8Array, ChunkedUint32Array, createChunkedUint32Array } from "./array";

/**
 * High-performance string pool for interning string paths (e.g. "motor.resistor.v") in linear memory.
 */
@unmanaged
export class ArenaStringPool {
  charBuffer: ChunkedUint8Array;
  charOffset: u32;

  stringOffsets: ChunkedUint32Array;
  stringLengths: ChunkedUint32Array;
  stringCount: u32;

  init(): void {
    this.charBuffer = createChunkedUint8Array(64 * 1024);
    this.charOffset = 0;
    this.stringOffsets = createChunkedUint32Array(1024);
    this.stringLengths = createChunkedUint32Array(1024);
    this.stringCount = 0;
  }

  intern(srcPtr: usize, len: u32): u32 {
    let id = this.stringCount++;
    let start = this.charOffset;
    this.stringOffsets.set(id, start);
    this.stringLengths.set(id, len);

    for (let i: u32 = 0; i < len; i++) {
      let b = load<u8>(srcPtr + i);
      this.charBuffer.set(start + i, b);
    }
    this.charOffset += len;
    return id;
  }

  concat(prefixId: u32, suffixPtr: usize, suffixLen: u32): u32 {
    let prefLen = prefixId < this.stringCount ? this.stringLengths.get(prefixId) : 0;
    let prefStart = prefixId < this.stringCount ? this.stringOffsets.get(prefixId) : 0;
    let totalLen = prefLen + 1 + suffixLen; // prefix + "." + suffix

    let id = this.stringCount++;
    let start = this.charOffset;
    this.stringOffsets.set(id, start);
    this.stringLengths.set(id, totalLen);

    for (let i: u32 = 0; i < prefLen; i++) {
      this.charBuffer.set(start + i, this.charBuffer.get(prefStart + i));
    }
    this.charBuffer.set(start + prefLen, 46); // '.' ASCII 46

    for (let i: u32 = 0; i < suffixLen; i++) {
      let b = load<u8>(suffixPtr + i);
      this.charBuffer.set(start + prefLen + 1 + i, b);
    }
    this.charOffset += totalLen;
    return id;
  }

  getLength(id: u32): u32 {
    return id < this.stringCount ? this.stringLengths.get(id) : 0;
  }

  getOffset(id: u32): u32 {
    return id < this.stringCount ? this.stringOffsets.get(id) : 0;
  }
}
