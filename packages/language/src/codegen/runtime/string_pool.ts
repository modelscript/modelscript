import { ChunkedUint8Array, createChunkedUint8Array, ChunkedUint32Array, createChunkedUint32Array } from "./array";
import { globalAstRoot, lsp_findNodeOffset, lsp_getNodeLeadingPad } from "./lsp";
import { getNodeByteLength, getEncodingStep, getInputBuffer } from "./parser";

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
    this.stringCount = 1; // 0 reserved for null / empty
  }

  internAstNode(nodeId: u32): u32 {
    if (nodeId == 0) return 0;
    let offset = lsp_findNodeOffset(globalAstRoot, nodeId);
    if (offset < 0) return 0;
    let len: u32 = getNodeByteLength(nodeId);
    let step: u32 = getEncodingStep();
    let pad: u32 = lsp_getNodeLeadingPad(nodeId);
    let actualOffset: u32 = (offset as u32) + pad * step;
    let buffer: usize = getInputBuffer();

    while (true) {
      let ch = step == 2 ? load<u16>(buffer + actualOffset) : load<u8>(buffer + actualOffset);
      if (ch == 32 || ch == 9 || ch == 10 || ch == 13) {
        actualOffset += step;
        if (len >= step) len -= step;
      } else {
        break;
      }
    }

    let charLen: u32 = len / step;
    let id = this.stringCount++;
    let start = this.charOffset;
    this.stringOffsets.set(id, start);
    this.stringLengths.set(id, charLen);

    for (let i: u32 = 0; i < charLen; i++) {
      let b = step == 2 ? (load<u16>(buffer + actualOffset + (i << 1)) as u8) : load<u8>(buffer + actualOffset + i);
      this.charBuffer.set(start + i, b);
    }
    this.charOffset += charLen;
    return id;
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

  concatIds(prefixId: u32, suffixId: u32): u32 {
    if (prefixId == 0) return suffixId;
    if (suffixId == 0) return prefixId;
    let prefLen = prefixId < this.stringCount ? this.stringLengths.get(prefixId) : 0;
    let prefStart = prefixId < this.stringCount ? this.stringOffsets.get(prefixId) : 0;
    let suffLen = suffixId < this.stringCount ? this.stringLengths.get(suffixId) : 0;
    let suffStart = suffixId < this.stringCount ? this.stringOffsets.get(suffixId) : 0;
    let totalLen = prefLen + 1 + suffLen; // prefix + "." + suffix

    let id = this.stringCount++;
    let start = this.charOffset;
    this.stringOffsets.set(id, start);
    this.stringLengths.set(id, totalLen);

    for (let i: u32 = 0; i < prefLen; i++) {
      this.charBuffer.set(start + i, this.charBuffer.get(prefStart + i));
    }
    this.charBuffer.set(start + prefLen, 46); // '.' ASCII 46

    for (let i: u32 = 0; i < suffLen; i++) {
      this.charBuffer.set(start + prefLen + 1 + i, this.charBuffer.get(suffStart + i));
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
}
