// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  atomicChunkAlloc,
  ChunkedUint32Array,
  createChunkedUint32Array,
} from "./array";

export const CONTAINER_ARRAY: u16 = 1;
export const CONTAINER_BITMAP: u16 = 2;
export const BITMAP_WORDS: u32 = 1024;
export const BITMAP_BYTES: u32 = 8192;
export const ARRAY_MAX_SIZE: u32 = 4096;
export const CHUNK_DESC_SIZE: u32 = 12;

/**
 * Zero-GC, Ultra-Compact Unmanaged Roaring Bitmap for WebAssembly.
 * Represents compressed 32-bit integer sets partitioned into 16-bit chunks.
 *
 * Employs a dense 12-byte ChunkDescriptor layout:
 *   [offset 0..3] key (u16) | containerType (u16 << 16)
 *   [offset 4..7] container pointer (u32)
 *   [offset 8..9] count / cardinality (u16)
 *   [offset 10..11] capacity (u16)
 *
 * Each RoaringBitmap instance is only 8 bytes on heap + initial 24 bytes descriptor buffer = 32 bytes total.
 * Replaces heavy 80KB multi-ChunkedArray overhead with zero-overhead flat memory blocks.
 */
@unmanaged
export class RoaringBitmap {
  chunks: usize; // pointer to array of 12-byte descriptors
  numChunks: u16;
  chunkCapacity: u16;

  init(initialCapacity: u16 = 2): void {
    if (initialCapacity < 2) initialCapacity = 2;
    this.chunkCapacity = initialCapacity;
    this.numChunks = 0;
    this.chunks = atomicChunkAlloc((this.chunkCapacity as u32) * CHUNK_DESC_SIZE) as usize;
  }

  @inline
  getChunkKey(idx: u32): u16 {
    let offset = this.chunks + ((idx as usize) * 12);
    return (load<u32>(offset) & 0xffff) as u16;
  }

  @inline
  getContainerType(idx: u32): u16 {
    let offset = this.chunks + ((idx as usize) * 12);
    return ((load<u32>(offset) >> 16) & 0xffff) as u16;
  }

  @inline
  setChunkKeyAndType(idx: u32, key: u16, type: u16): void {
    let offset = this.chunks + ((idx as usize) * 12);
    store<u32>(offset, (key as u32) | ((type as u32) << 16));
  }

  @inline
  getChunkPointer(idx: u32): usize {
    let offset = this.chunks + ((idx as usize) * 12) + 4;
    return load<u32>(offset) as usize;
  }

  @inline
  setChunkPointer(idx: u32, ptr: usize): void {
    let offset = this.chunks + ((idx as usize) * 12) + 4;
    store<u32>(offset, ptr as u32);
  }

  @inline
  getChunkCount(idx: u32): u16 {
    let offset = this.chunks + ((idx as usize) * 12) + 8;
    return load<u16>(offset);
  }

  @inline
  setChunkCount(idx: u32, count: u16): void {
    let offset = this.chunks + ((idx as usize) * 12) + 8;
    store<u16>(offset, count);
  }

  @inline
  getChunkCapacity(idx: u32): u16 {
    let offset = this.chunks + ((idx as usize) * 12) + 10;
    return load<u16>(offset);
  }

  @inline
  setChunkCapacity(idx: u32, cap: u16): void {
    let offset = this.chunks + ((idx as usize) * 12) + 10;
    store<u16>(offset, cap);
  }

  /**
   * Binary search to find the chunk index for a given 16-bit key.
   * Returns index if found, or bitwise complement (~insertionIndex) if not found.
   */
  binarySearchChunk(key: u16): i32 {
    let low: i32 = 0;
    let high: i32 = (this.numChunks as i32) - 1;

    while (low <= high) {
      let mid = (low + high) >> 1;
      let midKey = this.getChunkKey(mid as u32);
      if (midKey < key) {
        low = mid + 1;
      } else if (midKey > key) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return ~low;
  }

  /**
   * Adds a 32-bit integer to the bitmap.
   */
  add(x: u32): void {
    let key = (x >> 16) as u16;
    let val = (x & 0xffff) as u16;

    let idx = this.binarySearchChunk(key);
    if (idx >= 0) {
      this._addToChunk(idx as u32, val);
    } else {
      let insertIdx = (~idx) as u32;
      this._insertNewChunk(insertIdx, key, val);
    }
  }

  /**
   * Checks if the 32-bit integer is in the bitmap.
   */
  has(x: u32): bool {
    let key = (x >> 16) as u16;
    let val = (x & 0xffff) as u16;

    let idx = this.binarySearchChunk(key);
    if (idx < 0) return false;

    let cIdx = idx as u32;
    let type = this.getContainerType(cIdx);
    let ptr = this.getChunkPointer(cIdx);

    if (type == CONTAINER_BITMAP) {
      let wIdx = (val as u32) >> 6;
      let bIdx = (val as u32) & 63;
      let word = load<u64>(ptr + ((wIdx as usize) << 3));
      return (word & ((1 as u64) << bIdx)) != 0;
    } else {
      let count = this.getChunkCount(cIdx) as u32;
      return this._binarySearchArray(ptr, count, val) >= 0;
    }
  }

  /**
   * Removes a 32-bit integer from the bitmap.
   */
  remove(x: u32): void {
    let key = (x >> 16) as u16;
    let val = (x & 0xffff) as u16;

    let idx = this.binarySearchChunk(key);
    if (idx < 0) return;

    let cIdx = idx as u32;
    let type = this.getContainerType(cIdx);
    let ptr = this.getChunkPointer(cIdx);
    let count = this.getChunkCount(cIdx);

    if (type == CONTAINER_BITMAP) {
      let wIdx = (val as u32) >> 6;
      let bIdx = (val as u32) & 63;
      let word = load<u64>(ptr + ((wIdx as usize) << 3));
      if ((word & ((1 as u64) << bIdx)) != 0) {
        store<u64>(ptr + ((wIdx as usize) << 3), word & ~((1 as u64) << bIdx));
        this.setChunkCount(cIdx, count - 1);
      }
    } else {
      let aIdx = this._binarySearchArray(ptr, count as u32, val);
      if (aIdx >= 0) {
        for (let i = aIdx as u32; i < (count as u32) - 1; i++) {
          let nextVal = load<u16>(ptr + (((i + 1) as usize) << 1));
          store<u16>(ptr + ((i as usize) << 1), nextVal);
        }
        this.setChunkCount(cIdx, count - 1);
      }
    }
  }

  /**
   * Returns total number of set bits (cardinality).
   */
  cardinality(): u32 {
    let total: u32 = 0;
    for (let i: u32 = 0; i < (this.numChunks as u32); i++) {
      total += this.getChunkCount(i) as u32;
    }
    return total;
  }

  @inline
  isEmpty(): bool {
    return this.numChunks == 0;
  }

  clear(): void {
    this.numChunks = 0;
  }

  /**
   * Computes the intersection (this AND other) and stores the result in outBm.
   */
  and(other: RoaringBitmap, outBm: RoaringBitmap): void {
    outBm.clear();
    let i1: u32 = 0;
    let i2: u32 = 0;

    while (i1 < (this.numChunks as u32) && i2 < (other.numChunks as u32)) {
      let k1 = this.getChunkKey(i1);
      let k2 = other.getChunkKey(i2);

      if (k1 == k2) {
        this._intersectChunk(i1, other, i2, k1, outBm);
        i1++;
        i2++;
      } else if (k1 < k2) {
        i1++;
      } else {
        i2++;
      }
    }
  }

  /**
   * Computes the union (this OR other) and stores the result in outBm.
   */
  or(other: RoaringBitmap, outBm: RoaringBitmap): void {
    outBm.clear();
    this.copyTo(outBm);
    let tempBuf = createChunkedUint32Array(256);
    other.toArray(tempBuf);
    for (let i: u32 = 0; i < tempBuf.length; i++) {
      outBm.add(tempBuf.get(i));
    }
  }

  /**
   * Deep copies all chunks to another RoaringBitmap.
   */
  copyTo(target: RoaringBitmap): void {
    target.clear();
    for (let i: u32 = 0; i < (this.numChunks as u32); i++) {
      let key = this.getChunkKey(i);
      let type = this.getContainerType(i);
      let count = this.getChunkCount(i);
      let ptr = this.getChunkPointer(i);

      let newPtr: usize = 0;
      let cap: u16 = 0;
      if (type == CONTAINER_BITMAP) {
        newPtr = atomicChunkAlloc(BITMAP_BYTES) as usize;
        memory.copy(newPtr, ptr, BITMAP_BYTES);
        cap = BITMAP_WORDS as u16;
      } else {
        cap = count > 4 ? count : 4;
        newPtr = atomicChunkAlloc((cap as u32) * sizeof<u16>()) as usize;
        memory.copy(newPtr, ptr, (count as usize) * sizeof<u16>());
      }

      if (target.numChunks >= target.chunkCapacity) {
        let newCap: u16 = target.chunkCapacity == 0 ? 4 : (target.chunkCapacity * 2);
        let newChunkPtr = atomicChunkAlloc((newCap as u32) * CHUNK_DESC_SIZE) as usize;
        if (target.chunks != 0 && target.numChunks > 0) {
          memory.copy(newChunkPtr, target.chunks, (target.numChunks as usize) * 12);
        }
        target.chunks = newChunkPtr;
        target.chunkCapacity = newCap;
      }

      let cIdx = (target.numChunks++) as u32;
      target.setChunkKeyAndType(cIdx, key, type);
      target.setChunkPointer(cIdx, newPtr);
      target.setChunkCount(cIdx, count);
      target.setChunkCapacity(cIdx, cap);
    }
  }

  /**
   * Dumps all 32-bit values into an output ChunkedUint32Array.
   */
  toArray(outBuffer: ChunkedUint32Array): u32 {
    let initialLen = outBuffer.length;

    for (let c: u32 = 0; c < (this.numChunks as u32); c++) {
      let key = (this.getChunkKey(c) as u32) << 16;
      let type = this.getContainerType(c);
      let count = this.getChunkCount(c) as u32;
      let ptr = this.getChunkPointer(c);

      if (type == CONTAINER_BITMAP) {
        for (let w: u32 = 0; w < BITMAP_WORDS; w++) {
          let word = load<u64>(ptr + ((w as usize) << 3));
          let baseVal = key | (w << 6);
          while (word != 0) {
            let bitIdx = ctz<u64>(word) as u32;
            outBuffer.push(baseVal | bitIdx);
            word &= word - 1; // Clear lowest set bit
          }
        }
      } else {
        for (let i: u32 = 0; i < count; i++) {
          let val = load<u16>(ptr + ((i as usize) << 1)) as u32;
          outBuffer.push(key | val);
        }
      }
    }

    return outBuffer.length - initialLen;
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  private _addToChunk(cIdx: u32, val: u16): void {
    let type = this.getContainerType(cIdx);
    let ptr = this.getChunkPointer(cIdx);
    let count = this.getChunkCount(cIdx);

    if (type == CONTAINER_BITMAP) {
      let wIdx = (val as u32) >> 6;
      let bIdx = (val as u32) & 63;
      let word = load<u64>(ptr + ((wIdx as usize) << 3));
      if ((word & ((1 as u64) << bIdx)) == 0) {
        store<u64>(ptr + ((wIdx as usize) << 3), word | ((1 as u64) << bIdx));
        this.setChunkCount(cIdx, count + 1);
      }
    } else {
      let aIdx = this._binarySearchArray(ptr, count as u32, val);
      if (aIdx >= 0) return; // Value already present

      if ((count as u32) >= ARRAY_MAX_SIZE) {
        this._convertArrayToBitmap(cIdx);
        this._addToChunk(cIdx, val);
        return;
      }

      let insertIdx = (~aIdx) as u32;
      let cap = this.getChunkCapacity(cIdx);
      if (count >= cap) {
        let newCap: u16 = cap == 0 ? 4 : (cap < 2048 ? (cap * 2) : (ARRAY_MAX_SIZE as u16));
        let newPtr = atomicChunkAlloc((newCap as u32) * sizeof<u16>()) as usize;
        if (ptr != 0 && count > 0) {
          memory.copy(newPtr, ptr, (count as usize) * sizeof<u16>());
        }
        ptr = newPtr;
        this.setChunkPointer(cIdx, ptr);
        this.setChunkCapacity(cIdx, newCap);
      }

      for (let i = (count as u32); i > insertIdx; i--) {
        let prevVal = load<u16>(ptr + (((i - 1) as usize) << 1));
        store<u16>(ptr + ((i as usize) << 1), prevVal);
      }
      store<u16>(ptr + ((insertIdx as usize) << 1), val);
      this.setChunkCount(cIdx, count + 1);
    }
  }

  private _insertNewChunk(insertIdx: u32, key: u16, val: u16): void {
    if (this.numChunks >= this.chunkCapacity) {
      let newCap: u16 = this.chunkCapacity == 0 ? 4 : (this.chunkCapacity * 2);
      let newPtr = atomicChunkAlloc((newCap as u32) * CHUNK_DESC_SIZE) as usize;
      if (this.chunks != 0 && this.numChunks > 0) {
        memory.copy(newPtr, this.chunks, (this.numChunks as usize) * 12);
      }
      this.chunks = newPtr;
      this.chunkCapacity = newCap;
    }

    let initialCap: u16 = 4;
    let ptr = atomicChunkAlloc((initialCap as u32) * sizeof<u16>()) as usize;
    store<u16>(ptr, val);

    for (let i = (this.numChunks as u32); i > insertIdx; i--) {
      memory.copy(this.chunks + ((i as usize) * 12), this.chunks + (((i - 1) as usize) * 12), 12);
    }

    this.setChunkKeyAndType(insertIdx, key, CONTAINER_ARRAY);
    this.setChunkPointer(insertIdx, ptr);
    this.setChunkCount(insertIdx, 1);
    this.setChunkCapacity(insertIdx, initialCap);
    this.numChunks++;
  }

  private _convertArrayToBitmap(cIdx: u32): void {
    let oldPtr = this.getChunkPointer(cIdx);
    let count = this.getChunkCount(cIdx) as u32;

    let bmPtr = atomicChunkAlloc(BITMAP_BYTES) as usize;
    memory.fill(bmPtr, 0, BITMAP_BYTES);

    for (let i: u32 = 0; i < count; i++) {
      let v = load<u16>(oldPtr + ((i as usize) << 1)) as u32;
      let wIdx = v >> 6;
      let bIdx = v & 63;
      let word = load<u64>(bmPtr + ((wIdx as usize) << 3));
      store<u64>(bmPtr + ((wIdx as usize) << 3), word | ((1 as u64) << bIdx));
    }

    let key = this.getChunkKey(cIdx);
    this.setChunkKeyAndType(cIdx, key, CONTAINER_BITMAP);
    this.setChunkPointer(cIdx, bmPtr);
    this.setChunkCapacity(cIdx, BITMAP_WORDS as u16);
  }

  private _binarySearchArray(ptr: usize, count: u32, val: u16): i32 {
    let low: i32 = 0;
    let high: i32 = (count as i32) - 1;

    while (low <= high) {
      let mid = (low + high) >> 1;
      let midVal = load<u16>(ptr + ((mid as usize) << 1));
      if (midVal < val) {
        low = mid + 1;
      } else if (midVal > val) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return ~low;
  }

  private _intersectChunk(
    i1: u32,
    other: RoaringBitmap,
    i2: u32,
    key: u16,
    outBm: RoaringBitmap
  ): void {
    let t1 = this.getContainerType(i1);
    let t2 = other.getContainerType(i2);
    let p1 = this.getChunkPointer(i1);
    let p2 = other.getChunkPointer(i2);
    let c1 = this.getChunkCount(i1) as u32;
    let c2 = other.getChunkCount(i2) as u32;

    if (t1 == CONTAINER_BITMAP && t2 == CONTAINER_BITMAP) {
      let outPtr = atomicChunkAlloc(BITMAP_BYTES) as usize;
      let matchCount: u32 = 0;

      for (let w: u32 = 0; w < BITMAP_WORDS; w++) {
        let w1 = load<u64>(p1 + ((w as usize) << 3));
        let w2 = load<u64>(p2 + ((w as usize) << 3));
        let wAnd = w1 & w2;
        store<u64>(outPtr + ((w as usize) << 3), wAnd);
        matchCount += popcnt<u64>(wAnd) as u32;
      }

      if (matchCount > 0) {
        if (outBm.numChunks >= outBm.chunkCapacity) {
          let newCap: u16 = outBm.chunkCapacity == 0 ? 4 : (outBm.chunkCapacity * 2);
          let newChunkPtr = atomicChunkAlloc((newCap as u32) * CHUNK_DESC_SIZE) as usize;
          if (outBm.chunks != 0 && outBm.numChunks > 0) {
            memory.copy(newChunkPtr, outBm.chunks, (outBm.numChunks as usize) * 12);
          }
          outBm.chunks = newChunkPtr;
          outBm.chunkCapacity = newCap;
        }
        let outIdx = (outBm.numChunks++) as u32;
        outBm.setChunkKeyAndType(outIdx, key, CONTAINER_BITMAP);
        outBm.setChunkPointer(outIdx, outPtr);
        outBm.setChunkCount(outIdx, matchCount as u16);
        outBm.setChunkCapacity(outIdx, BITMAP_WORDS as u16);
      }
    } else if (t1 == CONTAINER_ARRAY && t2 == CONTAINER_BITMAP) {
      this._intersectArrayAndBitmap(p1, c1, p2, key, outBm);
    } else if (t1 == CONTAINER_BITMAP && t2 == CONTAINER_ARRAY) {
      this._intersectArrayAndBitmap(p2, c2, p1, key, outBm);
    } else {
      let maxLen = c1 < c2 ? c1 : c2;
      let outPtr = atomicChunkAlloc(maxLen * sizeof<u16>()) as usize;
      let outCount: u32 = 0;
      let a: u32 = 0;
      let b: u32 = 0;

      while (a < c1 && b < c2) {
        let va = load<u16>(p1 + ((a as usize) << 1));
        let vb = load<u16>(p2 + ((b as usize) << 1));
        if (va == vb) {
          store<u16>(outPtr + ((outCount as usize) << 1), va);
          outCount++;
          a++;
          b++;
        } else if (va < vb) {
          a++;
        } else {
          b++;
        }
      }

      if (outCount > 0) {
        if (outBm.numChunks >= outBm.chunkCapacity) {
          let newCap: u16 = outBm.chunkCapacity == 0 ? 4 : (outBm.chunkCapacity * 2);
          let newChunkPtr = atomicChunkAlloc((newCap as u32) * CHUNK_DESC_SIZE) as usize;
          if (outBm.chunks != 0 && outBm.numChunks > 0) {
            memory.copy(newChunkPtr, outBm.chunks, (outBm.numChunks as usize) * 12);
          }
          outBm.chunks = newChunkPtr;
          outBm.chunkCapacity = newCap;
        }
        let outIdx = (outBm.numChunks++) as u32;
        outBm.setChunkKeyAndType(outIdx, key, CONTAINER_ARRAY);
        outBm.setChunkPointer(outIdx, outPtr);
        outBm.setChunkCount(outIdx, outCount as u16);
        outBm.setChunkCapacity(outIdx, maxLen as u16);
      }
    }
  }

  private _intersectArrayAndBitmap(
    arrPtr: usize,
    arrCount: u32,
    bmPtr: usize,
    key: u16,
    outBm: RoaringBitmap
  ): void {
    let outPtr = atomicChunkAlloc(arrCount * sizeof<u16>()) as usize;
    let outCount: u32 = 0;

    for (let i: u32 = 0; i < arrCount; i++) {
      let val = load<u16>(arrPtr + ((i as usize) << 1));
      let wIdx = (val as u32) >> 6;
      let bIdx = (val as u32) & 63;
      let word = load<u64>(bmPtr + ((wIdx as usize) << 3));
      if ((word & ((1 as u64) << bIdx)) != 0) {
        store<u16>(outPtr + ((outCount as usize) << 1), val);
        outCount++;
      }
    }

    if (outCount > 0) {
      if (outBm.numChunks >= outBm.chunkCapacity) {
        let newCap: u16 = outBm.chunkCapacity == 0 ? 4 : (outBm.chunkCapacity * 2);
        let newChunkPtr = atomicChunkAlloc((newCap as u32) * CHUNK_DESC_SIZE) as usize;
        if (outBm.chunks != 0 && outBm.numChunks > 0) {
          memory.copy(newChunkPtr, outBm.chunks, (outBm.numChunks as usize) * 12);
        }
        outBm.chunks = newChunkPtr;
        outBm.chunkCapacity = newCap;
      }
      let outIdx = (outBm.numChunks++) as u32;
      outBm.setChunkKeyAndType(outIdx, key, CONTAINER_ARRAY);
      outBm.setChunkPointer(outIdx, outPtr);
      outBm.setChunkCount(outIdx, outCount as u16);
      outBm.setChunkCapacity(outIdx, arrCount as u16);
    }
  }
}

/**
 * Factory to create an unmanaged RoaringBitmap in WASM linear memory.
 */
export function createRoaringBitmap(initialCapacity: u16 = 2): RoaringBitmap {
  let ptr = atomicChunkAlloc(sizeof<RoaringBitmap>()) as usize;
  let bm = changetype<RoaringBitmap>(ptr);
  bm.init(initialCapacity);
  return bm;
}
