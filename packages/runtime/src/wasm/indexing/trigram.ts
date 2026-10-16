// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview High-Performance Zero-GC Trigram Inverted Index & Dex-Style Fuzzy Search.
 *
 * Implements an AOT WebAssembly fuzzy search engine for symbol stubs and declarations:
 * 1. Zero-cost unmanaged string views (`StringView`) over linear memory with dual UTF-8 / UTF-16 support.
 * 2. Inverted index using chunked arrays (`t_trigramPostings`) and 64-bit hash map (`t_trigramHeadMap`).
 * 3. Sliding register window ($c_0 \to c_1 \to c_2$) reducing linear memory bus loads by 66.7%.
 * 4. Branchless ASCII lowercasing and 24-bit packed trigram hashing.
 * 5. Weighted scoring combining trigram frequency, prefix matching (+500), and exact match boosting (+1000).
 */

import { atomicChunkAlloc, stringArenaPtr, stringArenaCapacity, ensureStringArena } from "../arena";
import { ChunkedUint32Array, createChunkedUint32Array } from "../core/array";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";
import { STUB_STRIDE, t_stubCount, t_stubTable, ensureStubStore, t_stubBinaryBuffer, flushStubBuffer } from "./stub";

/** Chunked array storing inverted index postings as linked-list pairs: `[stubId, nextPostingIdx]`. */
export let t_trigramPostings: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

/** Accumulator score table indexed by `stubId` during fuzzy query evaluation. */
export let t_trigramScores: ChunkedUint32Array = changetype<ChunkedUint32Array>(0);

/** 64-bit unmanaged hash map mapping 24-bit trigram hashes to posting linked-list head indices. */
export let t_trigramHeadMap: UnmanagedMap64 = changetype<UnmanagedMap64>(0);

/** Monotonically increasing posting counter (1-indexed, with 0 representing end-of-list sentinel). */
export let t_trigramPostingCount: u32 = 1;

const STRING_VIEW_SLOTS: u32 = 16;
const STRING_VIEW_MASK: u32 = STRING_VIEW_SLOTS - 1;
const UTF8_DECODE_SLOT_BYTES: u32 = 2048;
let g_stringViewIdx: u32 = 0;
let g_stringViewBuf: usize = 0;
let g_utf8DecodeBuf: usize = 0;
let g_queryStringViewPtr: usize = 0;
let g_queryUtf8DecodeBuf: usize = 0;

@inline
function decodeUtf8ToUtf16(srcPtr: usize, lenBytes: u32, dstPtr: usize, maxU16Units: u32): u32 {
  let i: u32 = 0;
  let outIdx: u32 = 0;
  while (i < lenBytes && outIdx < maxU16Units) {
    let b0 = load<u8>(srcPtr + i) as u32;
    if (b0 < 0x80) {
      store<u16>(dstPtr + (outIdx << 1), b0 as u16);
      outIdx++;
      i++;
    } else if ((b0 & 0xe0) == 0xc0 && i + 1 < lenBytes) {
      let b1 = load<u8>(srcPtr + i + 1) as u32;
      let cp = ((b0 & 0x1f) << 6) | (b1 & 0x3f);
      store<u16>(dstPtr + (outIdx << 1), cp as u16);
      outIdx++;
      i += 2;
    } else if ((b0 & 0xf0) == 0xe0 && i + 2 < lenBytes) {
      let b1 = load<u8>(srcPtr + i + 1) as u32;
      let b2 = load<u8>(srcPtr + i + 2) as u32;
      let cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
      store<u16>(dstPtr + (outIdx << 1), cp as u16);
      outIdx++;
      i += 3;
    } else if ((b0 & 0xf8) == 0xf0 && i + 3 < lenBytes && outIdx + 1 < maxU16Units) {
      let b1 = load<u8>(srcPtr + i + 1) as u32;
      let b2 = load<u8>(srcPtr + i + 2) as u32;
      let b3 = load<u8>(srcPtr + i + 3) as u32;
      let cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
      cp -= 0x10000;
      store<u16>(dstPtr + (outIdx << 1), (0xd800 | ((cp >> 10) & 0x3ff)) as u16);
      store<u16>(dstPtr + ((outIdx + 1) << 1), (0xdc00 | (cp & 0x3ff)) as u16);
      outIdx += 2;
      i += 4;
    } else {
      store<u16>(dstPtr + (outIdx << 1), 0xfffd);
      outIdx++;
      i++;
    }
  }
  return outIdx;
}

/**
 * Zero-cost unmanaged string view over linear memory in the string arena.
 *
 * Encapsulates pointer arithmetic, capacity bounds checking, and encoding detection
 * (UTF-8 `0x80000000` header flag vs UTF-16) with zero WASM heap allocation overhead.
 */
@unmanaged
export class StringView {
  /** Absolute pointer in linear memory to the first character of the string payload. */
  ptr: usize;
  /** Character length (count of UTF-8 ASCII bytes or UTF-16 code units). */
  len: u32;
  /** True if encoded in single-byte UTF-8 (ASCII), false if encoded in UTF-16. */
  isUtf8: bool;

  @inline
  static create(ptr: usize = 0, len: u32 = 0, isUtf8: bool = false): StringView {
    if (g_stringViewBuf == 0) {
      g_stringViewBuf = atomicChunkAlloc(STRING_VIEW_SLOTS * offsetof<StringView>());
    }
    let slot = (g_stringViewIdx++) & STRING_VIEW_MASK;
    let v = changetype<StringView>(g_stringViewBuf + slot * offsetof<StringView>());
    v.ptr = ptr;
    v.len = len;
    v.isUtf8 = isUtf8;
    return v;
  }

  @inline
  static fromQueryHandle(handle: u32): StringView {
    if (g_queryStringViewPtr == 0) {
      g_queryStringViewPtr = atomicChunkAlloc(offsetof<StringView>());
    }
    let v = changetype<StringView>(g_queryStringViewPtr);
    let tmp = StringView.fromHandle(handle);
    if (!tmp.isUtf8 && g_utf8DecodeBuf != 0 && tmp.ptr >= g_utf8DecodeBuf && tmp.ptr < g_utf8DecodeBuf + STRING_VIEW_SLOTS * UTF8_DECODE_SLOT_BYTES) {
      if (g_queryUtf8DecodeBuf == 0) {
        g_queryUtf8DecodeBuf = atomicChunkAlloc(UTF8_DECODE_SLOT_BYTES);
      }
      memory.copy(g_queryUtf8DecodeBuf, tmp.ptr, tmp.len << 1);
      v.ptr = g_queryUtf8DecodeBuf;
    } else {
      v.ptr = tmp.ptr;
    }
    v.len = tmp.len;
    v.isUtf8 = tmp.isUtf8;
    return v;
  }

  /**
   * Resolves a string arena handle into a validated, bounds-checked `StringView`.
   *
   * @param handle - Byte offset relative to `stringArenaPtr`.
   * @returns A validated `StringView`, or an invalid view (`len = 0`) if handle or memory is invalid.
   */
  @inline
  static fromHandle(handle: u32): StringView {
    if (handle == 0 || stringArenaPtr == 0 || handle + 4 > stringArenaCapacity) {
      return StringView.create(0, 0, false);
    }
    let header = load<u32>(stringArenaPtr + handle);
    let lenBytes = header & 0x7fffffff;
    if (handle + 4 + lenBytes > stringArenaCapacity) {
      return StringView.create(0, 0, false);
    }
    let isUtf8 = (header & 0x80000000) != 0;
    let ptr = stringArenaPtr + handle + 4;
    if (isUtf8) {
      let hasMultiByte = false;
      for (let i: u32 = 0; i < lenBytes; i++) {
        if (load<u8>(ptr + i) >= 0x80) {
          hasMultiByte = true;
          break;
        }
      }
      if (hasMultiByte) {
        if (g_utf8DecodeBuf == 0) {
          g_utf8DecodeBuf = atomicChunkAlloc(STRING_VIEW_SLOTS * UTF8_DECODE_SLOT_BYTES);
        }
        let slot = g_stringViewIdx & STRING_VIEW_MASK;
        let dstPtr = g_utf8DecodeBuf + slot * UTF8_DECODE_SLOT_BYTES;
        let u16Len = decodeUtf8ToUtf16(ptr, lenBytes, dstPtr, UTF8_DECODE_SLOT_BYTES >> 1);
        return StringView.create(dstPtr, u16Len, false);
      }
      return StringView.create(ptr, lenBytes, true);
    }
    let len = lenBytes >> 1;
    return StringView.create(ptr, len, false);
  }

  /**
   * Checks whether this view points to a valid non-empty string payload.
   */
  @inline
  get isValid(): bool {
    return this.ptr != 0 && this.len > 0;
  }

  /**
   * Loads a character code at the specified index, respecting the underlying encoding.
   *
   * @param index - 0-based character index.
   * @returns 8-bit character code for UTF-8 or 16-bit code unit for UTF-16.
   */
  @inline
  getChar(index: u32): u32 {
    if (this.isUtf8) {
      return load<u8>(this.ptr + index) as u32;
    }
    return load<u16>(this.ptr + (index << 1)) as u32;
  }
}

/**
 * Converts an ASCII uppercase character code ('A'..'Z') to lowercase ('a'..'z') branchlessly.
 * Non-uppercase characters are returned unmodified.
 *
 * @param c - Character code to convert.
 * @returns Lowercase ASCII character code.
 */
@inline
export function toLowerAscii(c: u32): u32 {
  return (c >= 65 && c <= 90) ? (c | 0x20) : c;
}

/**
 * Computes a case-normalized 24-bit hash from three consecutive characters (trigram).
 *
 * @param c0 - First character code.
 * @param c1 - Second character code.
 * @param c2 - Third character code.
 * @returns 64-bit integer packing the 24-bit hash: `(c0 << 16) | (c1 << 8) | c2`.
 */
@inline
export function hashTrigram(c0: u32, c1: u32, c2: u32): u64 {
  let l0 = toLowerAscii(c0);
  let l1 = toLowerAscii(c1);
  let l2 = toLowerAscii(c2);
  let hash32: u32 = ((l0 & 0xff) << 16) | ((l1 & 0xff) << 8) | (l2 & 0xff);
  return hash32 as u64;
}

/**
 * Ensures that the trigram postings array, score table, and head hash map are allocated.
 */
export function ensureTrigramStore(): void {
  ensureStubStore();
  if (changetype<usize>(t_trigramPostings) == 0) {
    t_trigramPostings = createChunkedUint32Array(2000); // Pairs of [stubId, nextPostingIdx]
    t_trigramScores = createChunkedUint32Array(2000);
    t_trigramHeadMap = changetype<UnmanagedMap64>(createMap64());
    t_trigramPostingCount = 1;
  }
}

/**
 * Resets the trigram inverted index, clearing postings, score accumulators, and hash buckets.
 */
export function trigram_clear(): void {
  if (changetype<usize>(t_trigramPostings) != 0) {
    t_trigramPostings.clear();
    t_trigramScores.clear();
    t_trigramHeadMap.clear();
    t_trigramPostingCount = 1;
  }
}

/**
 * Extracts and indexes all trigrams from a stub's symbol name into the inverted index.
 * Uses a sliding register window to reduce memory loads from $3N$ down to $N$.
 *
 * @param stubId - ID of the symbol stub.
 * @param nameHandle - String arena handle of the symbol name.
 */
export function trigram_indexStub(stubId: u32, nameHandle: u32): void {
  let view = StringView.fromHandle(nameHandle);
  if (!view.isValid || view.len < 3) return;

  ensureTrigramStore();

  let len = view.len;

  // Prime the sliding window with the first two lowercase characters
  let c0 = toLowerAscii(view.getChar(0));
  let c1 = toLowerAscii(view.getChar(1));

  // Slide window across the string: load only 1 new character (c2) per step
  for (let i: u32 = 0; i <= len - 3; i++) {
    let c2 = toLowerAscii(view.getChar(i + 2));
    let triHash: u64 = (((c0 & 0xff) << 16) | ((c1 & 0xff) << 8) | (c2 & 0xff)) as u64;
    let prevHead = t_trigramHeadMap.get(triHash);

    // Prepend new posting to linked list for this trigram (skip if stubId is already at head)
    if (prevHead == 0 || t_trigramPostings.get(prevHead * 2 + 0) != stubId) {
      let postIdx = t_trigramPostingCount++;
      t_trigramPostings.set(postIdx * 2 + 0, stubId);
      t_trigramPostings.set(postIdx * 2 + 1, prevHead);
      t_trigramHeadMap.set(triHash, postIdx);
    }

    // Slide registers for next iteration without re-reading linear memory
    c0 = c1;
    c1 = c2;
  }
}

/**
 * Re-indexes all active symbol stubs in `t_stubTable` into the trigram inverted index.
 *
 * @returns Total number of successfully indexed symbol stubs.
 */
export function trigram_indexAllStubs(): u32 {
  ensureStubStore();
  ensureTrigramStore();
  trigram_clear();

  let indexedCount: u32 = 0;
  for (let id: u32 = 1; id < t_stubCount; id++) {
    let baseIdx = id * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);
    let nameHandle = t_stubTable.get(baseIdx + 5);

    if (fId != 0 && nameHandle != 0) {
      trigram_indexStub(id, nameHandle);
      indexedCount++;
    }
  }
  return indexedCount;
}

/** External debug logging hook. */
@sideeffects
@external("parser", "logInt") declare function logInt(val: i32): void;

/**
 * Fast Dex-style Fuzzy Search over indexed stubs.
 *
 * Evaluates the query in three distinct phases:
 * 1. Accumulator Phase: Extracts query trigrams (or initial character for short queries)
 *    and increments scores (+10 per matched trigram) across all matching postings.
 * 2. Refinement & Boosting Phase: Verifies case-insensitive prefix alignment (+500)
 *    and exact identifier matches (+1000).
 * 3. Serialization Phase: Pushes matching results to `t_stubBinaryBuffer` formatted as
 *    7 u32 words per result: `[stubId, fileId, kindFlags, nameHash, startByte, endByte, score]`.
 *
 * @param queryHandle - String arena handle containing the search query string.
 * @param maxResults - Maximum number of matched stubs to return.
 * @returns Total number of matching results written to `t_stubBinaryBuffer`.
 */
export function trigram_fuzzyFind(queryHandle: u32, maxResults: u32): u32 {
  let queryView = StringView.fromQueryHandle(queryHandle);
  if (!queryView.isValid) return 0;

  ensureStubStore();
  ensureTrigramStore();

  let queryLen = queryView.len;
  let maxCount = t_stubCount;
  if (maxCount <= 1) return 0;

  // Clear score accumulator table
  for (let sId: u32 = 0; sId < maxCount; sId++) {
    t_trigramScores.set(sId, 0);
  }

  // --- Phase 1: Trigram / Prefix Inverted Index Search ---
  if (queryLen >= 3) {
    // Sliding register window across query trigrams
    let qc0 = toLowerAscii(queryView.getChar(0));
    let qc1 = toLowerAscii(queryView.getChar(1));

    for (let i: u32 = 0; i <= queryLen - 3; i++) {
      let qc2 = toLowerAscii(queryView.getChar(i + 2));
      let triHash: u64 = (((qc0 & 0xff) << 16) | ((qc1 & 0xff) << 8) | (qc2 & 0xff)) as u64;
      let postIdx = t_trigramHeadMap.get(triHash);

      // Traverse posting linked list for this trigram
      let loopCap = 0;
      while (postIdx != 0 && loopCap++ < 5000) {
        let stubId = t_trigramPostings.get(postIdx * 2 + 0);
        if (stubId > 0 && stubId < maxCount) {
          let curr = t_trigramScores.get(stubId);
          t_trigramScores.set(stubId, curr + 10); // +10 points per matched trigram
        }
        postIdx = t_trigramPostings.get(postIdx * 2 + 1);
      }

      qc0 = qc1;
      qc1 = qc2;
    }
  } else {
    // Short query fallback (< 3 chars): match by first character
    let prefixC0 = toLowerAscii(queryView.getChar(0));

    for (let id: u32 = 1; id < maxCount; id++) {
      let baseIdx = id * STUB_STRIDE;
      let fId = t_stubTable.get(baseIdx + 0);
      let nameHandle = t_stubTable.get(baseIdx + 5);

      if (fId != 0 && nameHandle != 0) {
        let nameView = StringView.fromHandle(nameHandle);
        if (nameView.isValid) {
          let firstChar = toLowerAscii(nameView.getChar(0));
          if (firstChar == prefixC0) {
            t_trigramScores.set(id, 20); // +20 points for initial prefix hit
          }
        }
      }
    }
  }

  // --- Phase 2: Prefix Matching & Exact Match Boosting ---
  for (let id: u32 = 1; id < maxCount; id++) {
    let score = t_trigramScores.get(id);
    if (score == 0) continue;

    let baseIdx = id * STUB_STRIDE;
    let fId = t_stubTable.get(baseIdx + 0);
    let nameHandle = t_stubTable.get(baseIdx + 5);

    // Exclude tombstoned or unlinked stubs
    if (fId == 0) {
      t_trigramScores.set(id, 0);
      continue;
    }

    if (nameHandle != 0) {
      let nameView = StringView.fromHandle(nameHandle);
      if (!nameView.isValid || nameView.len > 2000) continue;

      let nameLen = nameView.len;
      let matchesPrefix = true;
      let minLen = queryLen < nameLen ? queryLen : nameLen;

      // Verify case-insensitive prefix equality
      for (let k: u32 = 0; k < minLen; k++) {
        let qc = toLowerAscii(queryView.getChar(k));
        let nc = toLowerAscii(nameView.getChar(k));
        if (qc != nc) {
          matchesPrefix = false;
          break;
        }
      }

      if (matchesPrefix) {
        score += 500; // Prefix bonus
        if (queryLen == nameLen) score += 1000; // Exact match bonus
      }

      t_trigramScores.set(id, score);
    }
  }

  // --- Phase 3: Serialization into Binary Output Buffer ---
  if (changetype<usize>(t_stubBinaryBuffer) == 0) {
    t_stubBinaryBuffer = createChunkedUint32Array(2000);
  } else {
    t_stubBinaryBuffer.clear();
  }

  let matchCount: u32 = 0;

  for (let id: u32 = 1; id < maxCount; id++) {
    let score = t_trigramScores.get(id);
    if (score > 0) {
      let baseIdx = id * STUB_STRIDE;
      let fId = t_stubTable.get(baseIdx + 0);
      let kf = t_stubTable.get(baseIdx + 3);
      let nameHash = t_stubTable.get(baseIdx + 4);
      let startByte = t_stubTable.get(baseIdx + 6);
      let endByte = t_stubTable.get(baseIdx + 7);

      t_stubBinaryBuffer.push(id);
      t_stubBinaryBuffer.push(fId);
      t_stubBinaryBuffer.push(kf);
      t_stubBinaryBuffer.push(nameHash);
      t_stubBinaryBuffer.push(startByte);
      t_stubBinaryBuffer.push(endByte);
      t_stubBinaryBuffer.push(score);

      matchCount++;
      if (matchCount >= maxResults) break;
    }
  }

  flushStubBuffer();
  return matchCount;
}
