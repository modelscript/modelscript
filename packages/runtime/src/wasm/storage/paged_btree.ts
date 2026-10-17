// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  atomicChunkAlloc,
  ChunkedUint32Array,
  createChunkedUint32Array,
} from "../core/array";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";

export const PAGE_SIZE: u32 = 4096;
export const PAGE_HEADER_SIZE: u32 = 32;
export const ENTRY_SIZE: u32 = 16;
export const MAX_ENTRIES_PER_LEAF: u32 = (PAGE_SIZE - PAGE_HEADER_SIZE) / ENTRY_SIZE; // 254 entries
export const MAX_ENTRIES_PER_INTERNAL: u32 = (PAGE_SIZE - PAGE_HEADER_SIZE) / ENTRY_SIZE; // 254 entries

export const PAGE_TYPE_LEAF: u16 = 1;
export const PAGE_TYPE_INTERNAL: u16 = 2;

export const TREE_SPO: u8 = 0;
export const TREE_POS: u8 = 1;
export const TREE_OSP: u8 = 2;

/**
 * Slotted 4KB B+Tree Page Header Layout (32 bytes):
 *   [0..3]   pageId: u32
 *   [4..5]   pageType: u16 (1 = Leaf, 2 = Internal)
 *   [6..7]   itemCount: u16
 *   [8..11]  prevPage: u32 (doubly-linked leaf chain for range scans, or child[0] for internal nodes)
 *   [12..15] nextPage: u32
 *   [16..19] parentPage: u32
 *   [20..23] flags: u32
 *   [24..31] lsn: u64 (Transaction Generation / Log Sequence Number for Generation-Tagged CoW MVCC)
 *
 * Entry Layout (16 bytes):
 *   Leaf Entry:
 *     [0..3]   k1: u32 (SPO: sId, POS: pId, OSP: oId)
 *     [4..7]   k2: u32 (SPO: pId, POS: oId, OSP: sId)
 *     [8..11]  k3: u32 (SPO: oId, POS: sId, OSP: pId)
 *     [12..13] axiomType: u16
 *     [14..15] flags: u16
 *
 *   Internal Entry:
 *     [0..3]   k1: u32
 *     [4..7]   k2: u32
 *     [8..11]  k3: u32
 *     [12..15] childPageId: u32
 *
 * Academic Citations:
 *   - Bayer, R., & McCreight, E. (1972). "Organization and maintenance of large ordered indexes."
 *     Acta Informatica, 1(3), pp. 173–189. DOI: 10.1007/BF00288683.
 *   - Comer, D. (1979). "The ubiquitous B-tree." ACM Computing Surveys, 11(2), pp. 121–137.
 *     DOI: 10.1145/356770.356776.
 *   - Mohan, C., Haderle, D., Lindsay, B., Pirahesh, H., & Schwarz, P. (1992). "ARIES: A transaction
 *     recovery method supporting fine-granularity locking and partial rollbacks using write-ahead logging."
 *     ACM Transactions on Database Systems, 17(1), pp. 94–162. (Slotted Page Architecture & LSNs)
 *   - Neumann, T., & Weikum, G. (2008). "RDF-3X: A RISC-style engine for RDF."
 *     Proceedings of the VLDB Endowment, 1(1), pp. 647–659. (Multi-Permutation SPO/POS/OSP Indexing)
 *   - Rodeh, O. (2008). "B-trees, shadowing, and clones." ACM Transactions on Storage, 3(4), Article 2.
 *     (Generation-Tagged Copy-on-Write B+Trees & MVCC Snapshot Isolation)
 */
@unmanaged
export class BTreePage {
  @inline static getPageId(pagePtr: usize): u32 { return load<u32>(pagePtr); }
  @inline static setPageId(pagePtr: usize, val: u32): void { store<u32>(pagePtr, val); }

  @inline static getPageType(pagePtr: usize): u16 { return load<u16>(pagePtr + 4); }
  @inline static setPageType(pagePtr: usize, val: u16): void { store<u16>(pagePtr + 4, val); }

  @inline static getItemCount(pagePtr: usize): u16 { return load<u16>(pagePtr + 6); }
  @inline static setItemCount(pagePtr: usize, val: u16): void { store<u16>(pagePtr + 6, val); }

  @inline static getPrevPage(pagePtr: usize): u32 { return load<u32>(pagePtr + 8); }
  @inline static setPrevPage(pagePtr: usize, val: u32): void { store<u32>(pagePtr + 8, val); }

  @inline static getNextPage(pagePtr: usize): u32 { return load<u32>(pagePtr + 12); }
  @inline static setNextPage(pagePtr: usize, val: u32): void { store<u32>(pagePtr + 12, val); }

  @inline static getParentPage(pagePtr: usize): u32 { return load<u32>(pagePtr + 16); }
  @inline static setParentPage(pagePtr: usize, val: u32): void { store<u32>(pagePtr + 16, val); }

  @inline static getFlags(pagePtr: usize): u32 { return load<u32>(pagePtr + 20); }
  @inline static setFlags(pagePtr: usize, val: u32): void { store<u32>(pagePtr + 20, val); }

  @inline static getLSN(pagePtr: usize): u64 { return load<u64>(pagePtr + 24); }
  @inline static setLSN(pagePtr: usize, val: u64): void { store<u64>(pagePtr + 24, val); }

  // ---------------------------------------------------------------------------
  // Entry Accessors
  // ---------------------------------------------------------------------------

  @inline static getEntryOffset(entryIdx: u32): usize {
    return PAGE_HEADER_SIZE + (entryIdx * ENTRY_SIZE);
  }

  @inline static getEntryS(pagePtr: usize, entryIdx: u32): u32 {
    return load<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx));
  }
  @inline static setEntryS(pagePtr: usize, entryIdx: u32, val: u32): void {
    store<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx), val);
  }

  @inline static getEntryP(pagePtr: usize, entryIdx: u32): u32 {
    return load<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 4);
  }
  @inline static setEntryP(pagePtr: usize, entryIdx: u32, val: u32): void {
    store<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 4, val);
  }

  @inline static getEntryO(pagePtr: usize, entryIdx: u32): u32 {
    return load<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 8);
  }
  @inline static setEntryO(pagePtr: usize, entryIdx: u32, val: u32): void {
    store<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 8, val);
  }

  // Leaf Entry Extras: axiomType and flags
  @inline static getEntryType(pagePtr: usize, entryIdx: u32): u16 {
    return load<u16>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 12);
  }
  @inline static setEntryType(pagePtr: usize, entryIdx: u32, val: u16): void {
    store<u16>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 12, val);
  }

  @inline static getEntryFlags(pagePtr: usize, entryIdx: u32): u16 {
    return load<u16>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 14);
  }
  @inline static setEntryFlags(pagePtr: usize, entryIdx: u32, val: u16): void {
    store<u16>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 14, val);
  }

  // Internal Entry Extra: childPageId
  @inline static getChildPageId(pagePtr: usize, entryIdx: u32): u32 {
    return load<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 12);
  }
  @inline static setChildPageId(pagePtr: usize, entryIdx: u32, val: u32): void {
    store<u32>(pagePtr + BTreePage.getEntryOffset(entryIdx) + 12, val);
  }

  /**
   * Compares an entry at entryIdx with key (k1, k2, k3).
   * Returns:
   *   -1 if entry < key
   *    0 if entry == key
   *    1 if entry > key
   */
  @inline static compareKey(pagePtr: usize, entryIdx: u32, k1: u32, k2: u32, k3: u32): i32 {
    let ek1 = BTreePage.getEntryS(pagePtr, entryIdx);
    if (ek1 < k1) return -1;
    if (ek1 > k1) return 1;

    let ek2 = BTreePage.getEntryP(pagePtr, entryIdx);
    if (ek2 < k2) return -1;
    if (ek2 > k2) return 1;

    let ek3 = BTreePage.getEntryO(pagePtr, entryIdx);
    if (ek3 < k3) return -1;
    if (ek3 > k3) return 1;

    return 0;
  }

  /**
   * Hybrid Binary + Linear search for key (k1, k2, k3) within a page.
   * Includes an O(1) rightmost-key fast-path for monotonic/sequential insertions.
   * Returns exact index if found, or bitwise complement (~insertIdx) if not found.
   */
  static binarySearch(pagePtr: usize, k1: u32, k2: u32, k3: u32): i32 {
    let count = BTreePage.getItemCount(pagePtr) as i32;
    if (count == 0) return ~0;

    let high: i32 = count - 1;
    // Fast-path for sequential/monotonic insertions: check rightmost entry in O(1)
    let lastCmp = BTreePage.compareKey(pagePtr, high as u32, k1, k2, k3);
    if (lastCmp < 0) return ~count;
    if (lastCmp == 0) return high;

    let low: i32 = 0;
    high--;

    // Binary search until range narrows to <= 6 elements
    while (high - low > 6) {
      let mid = (low + high) >> 1;
      let cmp = BTreePage.compareKey(pagePtr, mid as u32, k1, k2, k3);
      if (cmp < 0) {
        low = mid + 1;
      } else if (cmp > 0) {
        high = mid - 1;
      } else {
        return mid;
      }
    }

    // Branch-minimal linear scan over the remaining <= 6 elements
    while (low <= high) {
      let cmp = BTreePage.compareKey(pagePtr, low as u32, k1, k2, k3);
      if (cmp == 0) return low;
      if (cmp > 0) return ~low;
      low++;
    }
    return ~low;
  }

  /**
   * Prefix-delta compresses a 4KB slotted leaf page using Sorted Tuple Prefix-Delta +
   * Byte-Tag Encoding across `(k1, k2, k3, axiomType, flags)`.
   * Reduces 16-byte entries to 2-5 bytes per entry across SPO, POS, and OSP trees
   * (typically 3.0x - 5.5x compression).
   * Returns the compressed byte size written to `dstBufPtr`.
   */
  static compressPagePrefixRuns(srcPagePtr: usize, dstBufPtr: usize): u32 {
    memory.copy(dstBufPtr, srcPagePtr, PAGE_HEADER_SIZE);
    let count = BTreePage.getItemCount(srcPagePtr) as u32;
    if (count == 0) return PAGE_HEADER_SIZE;

    let outOffset: u32 = PAGE_HEADER_SIZE;
    let prevK1: u32 = 0;
    let prevK2: u32 = 0;
    let prevK3: u32 = 0;
    let prevType: u16 = 0;
    let prevFlags: u16 = 0;

    for (let i: u32 = 0; i < count; i++) {
      let k1 = BTreePage.getEntryS(srcPagePtr, i);
      let k2 = BTreePage.getEntryP(srcPagePtr, i);
      let k3 = BTreePage.getEntryO(srcPagePtr, i);
      let aType = BTreePage.getEntryType(srcPagePtr, i);
      let aFlags = BTreePage.getEntryFlags(srcPagePtr, i);

      let dk1 = k1 - prevK1;
      let dk2 = k2 - prevK2;
      let dk3 = k3 - prevK3;

      let k1Mode: u8 = dk1 == 0 ? 0 : dk1 <= 0xff ? 1 : dk1 <= 0xffff ? 2 : 3;
      let k2Mode: u8 = dk2 == 0 ? 0 : dk2 <= 0xff ? 1 : dk2 <= 0xffff ? 2 : 3;
      let k3Mode: u8 = dk3 == 0 ? 0 : dk3 <= 0xff ? 1 : dk3 <= 0xffff ? 2 : 3;
      let metaChanged: u8 = aType != prevType || aFlags != prevFlags ? 1 : 0;

      let ctrl: u8 = k1Mode | (k2Mode << 2) | (k3Mode << 4) | (metaChanged << 6);
      store<u8>(dstBufPtr + outOffset, ctrl);
      outOffset += 1;

      if (k1Mode == 1) {
        store<u8>(dstBufPtr + outOffset, dk1 as u8);
        outOffset += 1;
      } else if (k1Mode == 2) {
        store<u16>(dstBufPtr + outOffset, dk1 as u16);
        outOffset += 2;
      } else if (k1Mode == 3) {
        store<u32>(dstBufPtr + outOffset, k1);
        outOffset += 4;
      }

      if (k2Mode == 1) {
        store<u8>(dstBufPtr + outOffset, dk2 as u8);
        outOffset += 1;
      } else if (k2Mode == 2) {
        store<u16>(dstBufPtr + outOffset, dk2 as u16);
        outOffset += 2;
      } else if (k2Mode == 3) {
        store<u32>(dstBufPtr + outOffset, k2);
        outOffset += 4;
      }

      if (k3Mode == 1) {
        store<u8>(dstBufPtr + outOffset, dk3 as u8);
        outOffset += 1;
      } else if (k3Mode == 2) {
        store<u16>(dstBufPtr + outOffset, dk3 as u16);
        outOffset += 2;
      } else if (k3Mode == 3) {
        store<u32>(dstBufPtr + outOffset, k3);
        outOffset += 4;
      }

      if (metaChanged != 0) {
        store<u16>(dstBufPtr + outOffset, aType);
        store<u16>(dstBufPtr + outOffset + 2, aFlags);
        outOffset += 4;
      }

      prevK1 = k1;
      prevK2 = k2;
      prevK3 = k3;
      prevType = aType;
      prevFlags = aFlags;
    }

    return outOffset;
  }

  /**
   * Decompresses a prefix-delta compressed leaf buffer from `srcBufPtr` back into a standard
   * 4KB slotted leaf page at `dstPagePtr`. Returns the unpacked item count.
   */
  static decompressPagePrefixRuns(srcBufPtr: usize, dstPagePtr: usize): u32 {
    memory.fill(dstPagePtr, 0, PAGE_SIZE);
    memory.copy(dstPagePtr, srcBufPtr, PAGE_HEADER_SIZE);
    let totalCount = BTreePage.getItemCount(srcBufPtr) as u32;
    if (totalCount == 0) return 0;

    let inOffset: u32 = PAGE_HEADER_SIZE;
    let k1: u32 = 0;
    let k2: u32 = 0;
    let k3: u32 = 0;
    let aType: u16 = 0;
    let aFlags: u16 = 0;

    for (let outIdx: u32 = 0; outIdx < totalCount; outIdx++) {
      let ctrl = load<u8>(srcBufPtr + inOffset);
      inOffset += 1;

      let k1Mode = ctrl & 3;
      let k2Mode = (ctrl >> 2) & 3;
      let k3Mode = (ctrl >> 4) & 3;
      let metaChanged = (ctrl >> 6) & 1;

      if (k1Mode == 1) {
        k1 += load<u8>(srcBufPtr + inOffset) as u32;
        inOffset += 1;
      } else if (k1Mode == 2) {
        k1 += load<u16>(srcBufPtr + inOffset) as u32;
        inOffset += 2;
      } else if (k1Mode == 3) {
        k1 = load<u32>(srcBufPtr + inOffset);
        inOffset += 4;
      }

      if (k2Mode == 1) {
        k2 += load<u8>(srcBufPtr + inOffset) as u32;
        inOffset += 1;
      } else if (k2Mode == 2) {
        k2 += load<u16>(srcBufPtr + inOffset) as u32;
        inOffset += 2;
      } else if (k2Mode == 3) {
        k2 = load<u32>(srcBufPtr + inOffset);
        inOffset += 4;
      }

      if (k3Mode == 1) {
        k3 += load<u8>(srcBufPtr + inOffset) as u32;
        inOffset += 1;
      } else if (k3Mode == 2) {
        k3 += load<u16>(srcBufPtr + inOffset) as u32;
        inOffset += 2;
      } else if (k3Mode == 3) {
        k3 = load<u32>(srcBufPtr + inOffset);
        inOffset += 4;
      }

      if (metaChanged != 0) {
        aType = load<u16>(srcBufPtr + inOffset);
        aFlags = load<u16>(srcBufPtr + inOffset + 2);
        inOffset += 4;
      }

      BTreePage.setEntryS(dstPagePtr, outIdx, k1);
      BTreePage.setEntryP(dstPagePtr, outIdx, k2);
      BTreePage.setEntryO(dstPagePtr, outIdx, k3);
      BTreePage.setEntryType(dstPagePtr, outIdx, aType);
      BTreePage.setEntryFlags(dstPagePtr, outIdx, aFlags);
    }

    return totalCount;
  }

  /**
   * Initializes a brand-new page.
   */
  static initPage(pagePtr: usize, pageId: u32, pageType: u16, txId: u64 = 1): void {
    memory.fill(pagePtr, 0, PAGE_SIZE);
    BTreePage.setPageId(pagePtr, pageId);
    BTreePage.setPageType(pagePtr, pageType);
    BTreePage.setItemCount(pagePtr, 0);
    BTreePage.setPrevPage(pagePtr, 0);
    BTreePage.setNextPage(pagePtr, 0);
    BTreePage.setParentPage(pagePtr, 0);
    BTreePage.setLSN(pagePtr, txId);
  }
}

@unmanaged
export class FrameDesc {
  ptr: usize;       // +0  (4 bytes): pointer to 4KB frame memory
  pageId: u32;      // +4  (4 bytes): pageId loaded in this frame
  pin: u16;         // +8  (2 bytes): pin count
  dirty: u8;        // +10 (1 byte):  dirty flag (1 = dirty)
  ref: u8;          // +11 (1 byte):  second-chance reference bit
  _reserved: u32;   // +12 (4 bytes): 16-byte alignment padding
}

/**
 * Clock-Eviction Buffer Pool managing fixed-size 4KB frames in linear memory.
 * Backed by either in-WASM virtual disk pages or host OPFS/NVMe storage.
 */
@unmanaged
export class BufferPool {
  frames: usize; // pointer to array of FrameDesc [numFrames] (16 bytes each)
  pageToFrameArr: usize; // direct O(1) lookup table: pageId -> u32 (frameIdx + 1, 0 = not in pool)

  numFrames: u32;
  nextUnusedFrame: u32;
  clockHand: u32;

  // Virtual In-Memory Backing Disk
  virtualDiskPages: usize; // pointer to array of usize [virtualDiskCapacity]
  virtualDiskCapacity: u32;
  nextAllocPageId: u32;

  // Exchange buffer for Host I/O
  exchangeBuffer: usize;
  isHostIOEnabled: bool;

  // Metrics
  cacheHits: u64;
  cacheMisses: u64;

  init(numFrames: u32 = 256): void {
    if (numFrames < 16) numFrames = 16;
    this.numFrames = numFrames;
    this.nextUnusedFrame = 0;
    this.clockHand = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.nextAllocPageId = 1; // 1-indexed (0 reserved for null)
    this.isHostIOEnabled = false;

    this.frames = atomicChunkAlloc(numFrames * 16) as usize;

    this.virtualDiskCapacity = 2048;
    this.virtualDiskPages = atomicChunkAlloc(this.virtualDiskCapacity * sizeof<usize>()) as usize;
    this.pageToFrameArr = atomicChunkAlloc(this.virtualDiskCapacity * sizeof<u32>()) as usize;
    this.exchangeBuffer = atomicChunkAlloc(PAGE_SIZE) as usize;
  }

  @inline
  private _ensurePageCapacity(pageId: u32): void {
    if (pageId >= 0x7fffffff) return;
    if (pageId >= this.virtualDiskCapacity) {
      let newCap = this.virtualDiskCapacity * 2;
      while (newCap <= pageId) newCap *= 2;

      let newDiskPtr = atomicChunkAlloc(newCap * sizeof<usize>()) as usize;
      if (newDiskPtr != 0) {
        memory.copy(newDiskPtr, this.virtualDiskPages, this.virtualDiskCapacity * sizeof<usize>());
        this.virtualDiskPages = newDiskPtr;
      }

      let newMapPtr = atomicChunkAlloc(newCap * sizeof<u32>()) as usize;
      if (newMapPtr != 0) {
        memory.copy(newMapPtr, this.pageToFrameArr, this.virtualDiskCapacity * sizeof<u32>());
        this.pageToFrameArr = newMapPtr;
      }

      this.virtualDiskCapacity = newCap;
    }
  }

  @inline getPageFrameVal(pageId: u32): u32 {
    if (pageId >= this.virtualDiskCapacity) return 0;
    return load<u32>(this.pageToFrameArr + ((pageId as usize) << 2));
  }

  @inline setPageFrameVal(pageId: u32, val: u32): void {
    this._ensurePageCapacity(pageId);
    if (pageId < this.virtualDiskCapacity) {
      store<u32>(this.pageToFrameArr + ((pageId as usize) << 2), val);
    }
  }

  @inline getFramePointer(frameIdx: u32): usize {
    return load<usize>(this.frames + (frameIdx << 4));
  }
  @inline setFramePointer(frameIdx: u32, ptr: usize): void {
    store<usize>(this.frames + (frameIdx << 4), ptr);
  }

  @inline getFramePageId(frameIdx: u32): u32 {
    return load<u32>(this.frames + (frameIdx << 4) + 4);
  }
  @inline setFramePageId(frameIdx: u32, pageId: u32): void {
    store<u32>(this.frames + (frameIdx << 4) + 4, pageId);
  }

  @inline getFramePin(frameIdx: u32): u16 {
    return load<u16>(this.frames + (frameIdx << 4) + 8);
  }
  @inline setFramePin(frameIdx: u32, pin: u16): void {
    store<u16>(this.frames + (frameIdx << 4) + 8, pin);
  }

  @inline getFrameDirty(frameIdx: u32): u8 {
    return load<u8>(this.frames + (frameIdx << 4) + 10);
  }
  @inline setFrameDirty(frameIdx: u32, dirty: u8): void {
    store<u8>(this.frames + (frameIdx << 4) + 10, dirty);
  }

  @inline getFrameRef(frameIdx: u32): u8 {
    return load<u8>(this.frames + (frameIdx << 4) + 11);
  }
  @inline setFrameRef(frameIdx: u32, ref: u8): void {
    store<u8>(this.frames + (frameIdx << 4) + 11, ref);
  }

  @inline pinPage(pageId: u32): void {
    if (pageId == 0) return;
    let val = this.getPageFrameVal(pageId);
    if (val > 0) {
      let fIdx = val - 1;
      if (fIdx < this.numFrames) {
        let p = this.getFramePin(fIdx);
        this.setFramePin(fIdx, p + 1);
      }
    }
  }

  @inline unpinPage(pageId: u32): void {
    if (pageId == 0) return;
    let val = this.getPageFrameVal(pageId);
    if (val > 0) {
      let fIdx = val - 1;
      if (fIdx < this.numFrames) {
        let p = this.getFramePin(fIdx);
        if (p > 0) this.setFramePin(fIdx, p - 1);
      }
    }
  }

  @inline getVirtualDiskPage(pageId: u32): usize {
    if (pageId >= this.virtualDiskCapacity) return 0;
    return load<usize>(this.virtualDiskPages + (pageId * sizeof<usize>()));
  }

  @inline setVirtualDiskPage(pageId: u32, ptr: usize): void {
    this._ensurePageCapacity(pageId);
    if (pageId < this.virtualDiskCapacity) {
      store<usize>(this.virtualDiskPages + (pageId * sizeof<usize>()), ptr);
    }
  }

  @inline ensureVirtualDiskPage(pageId: u32): usize {
    let diskPtr = this.getVirtualDiskPage(pageId);
    if (diskPtr == 0) {
      diskPtr = atomicChunkAlloc(PAGE_SIZE) as usize;
      this.setVirtualDiskPage(pageId, diskPtr);
    }
    return diskPtr;
  }

  @inline
  getFramePtr(frameIdx: u32): usize {
    let ptr = this.getFramePointer(frameIdx);
    if (ptr == 0) {
      ptr = atomicChunkAlloc(PAGE_SIZE) as usize;
      this.setFramePointer(frameIdx, ptr);
    }
    return ptr;
  }

  /**
   * Allocates a new unique pageId (or reuses one) and initializes a fresh page in the buffer pool.
   */
  allocateNewPage(pageType: u16, txId: u64 = 1, reusePageId: u32 = 0): u32 {
    let pageId = reusePageId != 0 ? reusePageId : this.nextAllocPageId++;
    if (pageId >= this.nextAllocPageId) {
      this.nextAllocPageId = pageId + 1;
    }
    let frameIdx = this._findVictimFrame();
    this._loadNewPageIntoFrame(frameIdx, pageId, pageType, txId);
    return pageId;
  }

  /**
   * Overwrites a page in both virtual disk and any active buffer pool frame (used by CoW abort & disk page-in).
   */
  overwritePage(pageId: u32, srcPtr: usize): void {
    if (pageId == 0 || srcPtr == 0) return;
    let diskPtr = this.ensureVirtualDiskPage(pageId);
    memory.copy(diskPtr, srcPtr, PAGE_SIZE);

    let val = this.getPageFrameVal(pageId);
    if (val > 0) {
      let fIdx = val - 1;
      if (fIdx < this.numFrames) {
        let framePtr = this.getFramePtr(fIdx);
        memory.copy(framePtr, srcPtr, PAGE_SIZE);
        this.setFrameDirty(fIdx, 0);
      }
    }
  }

  /**
   * Evicts a page from the buffer pool without flushing it, and zeroes its virtual disk slot.
   */
  evictAndClearPage(pageId: u32): void {
    if (pageId == 0) return;
    let val = this.getPageFrameVal(pageId);
    if (val > 0) {
      let fIdx = val - 1;
      if (fIdx < this.numFrames) {
        this.setFramePageId(fIdx, 0);
        this.setFrameDirty(fIdx, 0);
        this.setFramePin(fIdx, 0);
        this.setFrameRef(fIdx, 0);
      }
      this.setPageFrameVal(pageId, 0);
    }
    let diskPtr = this.getVirtualDiskPage(pageId);
    if (diskPtr != 0) {
      memory.fill(diskPtr, 0, PAGE_SIZE);
    }
  }

  /**
   * Fetches a page into the buffer pool. Marks it active and returns its memory address.
   */
  @inline
  fetchPage(pageId: u32): usize {
    if (pageId == 0) return 0;

    // 1. Direct O(1) array lookup if page is already cached in buffer pool
    let val = this.getPageFrameVal(pageId);
    if (val > 0) {
      let fIdx = val - 1;
      this.setFrameRef(fIdx, 1);
      this.cacheHits++;
      return this.getFramePointer(fIdx);
    }

    // 2. Cache miss: find a victim frame to evict
    this.cacheMisses++;
    let victimIdx = this._findVictimFrame();
    this._readDiskPageIntoFrame(victimIdx, pageId);
    return this.getFramePointer(victimIdx);
  }

  /**
   * Marks a page as dirty so it will be flushed to disk upon eviction.
   */
  @inline
  markDirty(pageId: u32): void {
    let val = this.getPageFrameVal(pageId);
    if (val > 0) {
      this.setFrameDirty(val - 1, 1);
    }
  }

  /**
   * Flushes all dirty frames to backing storage.
   */
  flushAll(): u32 {
    let flushedCount: u32 = 0;
    let limit = this.nextUnusedFrame < this.numFrames ? this.nextUnusedFrame : this.numFrames;
    for (let f: u32 = 0; f < limit; f++) {
      if (this.getFrameDirty(f) != 0) {
        let pId = this.getFramePageId(f);
        if (pId != 0 && pId < 0x7fffffff) {
          this._writeFrameToDisk(f, pId);
          this.setFrameDirty(f, 0);
          flushedCount++;
        }
      }
    }
    return flushedCount;
  }

  getHitRate(): f32 {
    let total = this.cacheHits + this.cacheMisses;
    if (total == 0) return 1.0;
    return (this.cacheHits as f32) / (total as f32);
  }

  // ---------------------------------------------------------------------------
  // Internal Clock Eviction & Disk I/O
  // ---------------------------------------------------------------------------

  private _findVictimFrame(): u32 {
    // Fast path: claim an unused frame directly in O(1) before sweeping Clock hand
    if (this.nextUnusedFrame < this.numFrames) {
      let f = this.nextUnusedFrame++;
      this.getFramePtr(f);
      return f;
    }

    let count: u32 = 0;
    let maxSweeps = this.numFrames * 2;

    while (count < maxSweeps) {
      let f = this.clockHand;
      let nextHand = f + 1;
      this.clockHand = nextHand < this.numFrames ? nextHand : 0;

      let pins = this.getFramePin(f);
      if (pins == 0) {
        let ref = this.getFrameRef(f);
        if (ref == 1) {
          this.setFrameRef(f, 0); // Give second chance
        } else {
          // Victim found: evict dirty page if necessary
          let oldPageId = this.getFramePageId(f);
          if (oldPageId != 0 && oldPageId < 0x7fffffff) {
            if (this.getFrameDirty(f) != 0) {
              this._writeFrameToDisk(f, oldPageId);
              this.setFrameDirty(f, 0);
            }
            this.setPageFrameVal(oldPageId, 0);
          }
          return f;
        }
      }
      count++;
    }

    return 0; // Fallback to frame 0 if all are pinned
  }

  private _loadNewPageIntoFrame(fIdx: u32, pageId: u32, pageType: u16, txId: u64 = 1): void {
    let ptr = this.getFramePtr(fIdx);
    BTreePage.initPage(ptr, pageId, pageType, txId);

    this.setFramePageId(fIdx, pageId);
    this.setFrameDirty(fIdx, 1);
    this.setFramePin(fIdx, 0);
    this.setFrameRef(fIdx, 1);
    this.setPageFrameVal(pageId, fIdx + 1);
  }

  private _readDiskPageIntoFrame(fIdx: u32, pageId: u32): void {
    let framePtr = this.getFramePtr(fIdx);

    // Read from Virtual Disk
    let diskPtr = this.getVirtualDiskPage(pageId);
    if (diskPtr != 0) {
      memory.copy(framePtr, diskPtr, PAGE_SIZE);
    } else {
      // Unallocated page: initialize as empty leaf
      BTreePage.initPage(framePtr, pageId, PAGE_TYPE_LEAF, 1);
    }

    this.setFramePageId(fIdx, pageId);
    this.setFrameDirty(fIdx, 0);
    this.setFramePin(fIdx, 0);
    this.setFrameRef(fIdx, 1);
    this.setPageFrameVal(pageId, fIdx + 1);
  }

  private _writeFrameToDisk(fIdx: u32, pageId: u32): void {
    if (pageId == 0 || pageId >= 0x7fffffff || fIdx >= this.numFrames) return;
    let framePtr = this.getFramePtr(fIdx);

    let diskPtr = this.ensureVirtualDiskPage(pageId);
    if (diskPtr != 0 && framePtr != 0) {
      memory.copy(diskPtr, framePtr, PAGE_SIZE);
    }

    // If host I/O is active, also copy to exchange buffer
    if (this.isHostIOEnabled && this.exchangeBuffer != 0 && framePtr != 0) {
      memory.copy(this.exchangeBuffer, framePtr, PAGE_SIZE);
    }
  }
}

/**
 * Paged 4KB Slotted B+Tree Triple Store in WebAssembly linear memory.
 * Features:
 *   1. Three covering B+Tree index permutations (SPO, POS, OSP) for O(log N + K) range scans on any pattern.
 *   2. Generation-Tagged Copy-on-Write (CoW) MVCC transactions with O(1) snapshot isolation and rollback.
 *   3. Epoch freelist page reclamation for bounded storage footprint across transactions.
 *   4. B+Tree deletion with empty leaf unlinking and root collapse.
 */
@unmanaged
export class PagedBTreeStore {
  bufferPool: BufferPool;
  rootPageId: u32;      // Mirror of spoRootPageId
  spoRootPageId: u32;
  posRootPageId: u32;
  ospRootPageId: u32;
  totalTriples: u32;

  // MVCC & Generation-Tagged CoW State
  currentTxId: u64;
  inTransaction: bool;
  committedTxId: u64;
  committedSpoRoot: u32;
  committedPosRoot: u32;
  committedOspRoot: u32;
  committedTotalTriples: u32;
  cowClonesCount: u32;

  // Active transaction shadow tracking & Epoch Freelist
  txShadowMap: UnmanagedMap64;
  txShadowedLogicIds: ChunkedUint32Array;
  txShadowPhysicalIds: ChunkedUint32Array;
  txAllocatedPages: ChunkedUint32Array;
  txRetireOnCommitPages: ChunkedUint32Array;
  freePages: ChunkedUint32Array;

  init(numFrames: u32 = 256): void {
    let bpPtr = atomicChunkAlloc(offsetof<BufferPool>()) as usize;
    this.bufferPool = changetype<BufferPool>(bpPtr);
    this.bufferPool.init(numFrames);

    this.currentTxId = 1;
    this.inTransaction = false;
    this.cowClonesCount = 0;

    this.txShadowMap = changetype<UnmanagedMap64>(createMap64(64));
    this.txShadowedLogicIds = createChunkedUint32Array(64);
    this.txShadowPhysicalIds = createChunkedUint32Array(64);
    this.txAllocatedPages = createChunkedUint32Array(64);
    this.txRetireOnCommitPages = createChunkedUint32Array(64);
    this.freePages = createChunkedUint32Array(64);

    // Create root leaf pages for SPO (Page 1), POS (Page 2), OSP (Page 3)
    this.spoRootPageId = this.bufferPool.allocateNewPage(PAGE_TYPE_LEAF, this.currentTxId);
    this.posRootPageId = this.bufferPool.allocateNewPage(PAGE_TYPE_LEAF, this.currentTxId);
    this.ospRootPageId = this.bufferPool.allocateNewPage(PAGE_TYPE_LEAF, this.currentTxId);
    this.rootPageId = this.spoRootPageId;
    this.totalTriples = 0;

    this.committedTxId = this.currentTxId;
    this.committedSpoRoot = this.spoRootPageId;
    this.committedPosRoot = this.posRootPageId;
    this.committedOspRoot = this.ospRootPageId;
    this.committedTotalTriples = 0;
  }

  @inline
  getTreeRoot(treeId: u8, committed: bool = false): u32 {
    if (committed && this.inTransaction) {
      if (treeId == TREE_SPO) return this.committedSpoRoot;
      if (treeId == TREE_POS) return this.committedPosRoot;
      return this.committedOspRoot;
    }
    if (treeId == TREE_SPO) return this.spoRootPageId;
    if (treeId == TREE_POS) return this.posRootPageId;
    return this.ospRootPageId;
  }

  @inline
  setTreeRoot(treeId: u8, newRootId: u32): void {
    if (treeId == TREE_SPO) {
      this.spoRootPageId = newRootId;
      this.rootPageId = newRootId;
    } else if (treeId == TREE_POS) {
      this.posRootPageId = newRootId;
    } else {
      this.ospRootPageId = newRootId;
    }
  }

  // ---------------------------------------------------------------------------
  // MVCC Transaction Lifecycle & Generation-Tagged Copy-on-Write
  // ---------------------------------------------------------------------------

  beginTransaction(): u64 {
    if (this.inTransaction) {
      return this.currentTxId;
    }
    this.bufferPool.flushAll();
    this.committedTxId = this.currentTxId;
    this.committedSpoRoot = this.spoRootPageId;
    this.committedPosRoot = this.posRootPageId;
    this.committedOspRoot = this.ospRootPageId;
    this.committedTotalTriples = this.totalTriples;

    this.currentTxId++;
    this.inTransaction = true;
    this.txShadowMap.clear();
    this.txShadowedLogicIds.clear();
    this.txShadowPhysicalIds.clear();
    this.txAllocatedPages.clear();
    this.txRetireOnCommitPages.clear();
    return this.currentTxId;
  }

  commitTransaction(): u32 {
    if (!this.inTransaction) return 0;
    this.bufferPool.flushAll();

    // Reclaim shadowed pre-transaction physical pages into the epoch freelist
    let shadowCount = this.txShadowPhysicalIds.length;
    for (let i: u32 = 0; i < shadowCount; i++) {
      let shadowId = this.txShadowPhysicalIds.get(i);
      this.freePages.push(shadowId);
    }

    // Reclaim any empty pages unlinked during delete() in this transaction
    let retireCount = this.txRetireOnCommitPages.length;
    for (let i: u32 = 0; i < retireCount; i++) {
      let retId = this.txRetireOnCommitPages.get(i);
      this.bufferPool.evictAndClearPage(retId);
      this.freePages.push(retId);
    }

    this.committedTxId = this.currentTxId;
    this.committedSpoRoot = this.spoRootPageId;
    this.committedPosRoot = this.posRootPageId;
    this.committedOspRoot = this.ospRootPageId;
    this.committedTotalTriples = this.totalTriples;
    this.rootPageId = this.spoRootPageId;

    this.txShadowMap.clear();
    this.txShadowedLogicIds.clear();
    this.txShadowPhysicalIds.clear();
    this.txAllocatedPages.clear();
    this.txRetireOnCommitPages.clear();
    this.inTransaction = false;
    return 1;
  }

  abortTransaction(): u32 {
    if (!this.inTransaction) return 0;

    // 1. Restore all CoW-shadowed pages from their untouched pre-transaction 4KB clones
    let shadowCount = this.txShadowedLogicIds.length;
    for (let i: u32 = 0; i < shadowCount; i++) {
      let logicId = this.txShadowedLogicIds.get(i);
      let shadowId = this.txShadowPhysicalIds.get(i);
      let shadowDiskPtr = this.bufferPool.getVirtualDiskPage(shadowId);
      if (shadowDiskPtr != 0) {
        this.bufferPool.overwritePage(logicId, shadowDiskPtr);
      }
      this.freePages.push(shadowId);
    }

    // 2. Reclaim all pages newly allocated during the aborted transaction
    let allocCount = this.txAllocatedPages.length;
    for (let i: u32 = 0; i < allocCount; i++) {
      let allocId = this.txAllocatedPages.get(i);
      this.bufferPool.evictAndClearPage(allocId);
      this.freePages.push(allocId);
    }

    // 3. Restore committed superblock state
    this.spoRootPageId = this.committedSpoRoot;
    this.posRootPageId = this.committedPosRoot;
    this.ospRootPageId = this.committedOspRoot;
    this.rootPageId = this.committedSpoRoot;
    this.totalTriples = this.committedTotalTriples;
    this.currentTxId = this.committedTxId;

    this.txShadowMap.clear();
    this.txShadowedLogicIds.clear();
    this.txShadowPhysicalIds.clear();
    this.txAllocatedPages.clear();
    this.txRetireOnCommitPages.clear();
    this.inTransaction = false;
    return 1;
  }

  @inline
  private _allocRawPageId(): u32 {
    if (this.freePages.length > 0) {
      return this.freePages.pop();
    }
    return this.bufferPool.nextAllocPageId++;
  }

  @inline
  private _allocTreePage(pageType: u16): u32 {
    let reuseId: u32 = 0;
    if (this.freePages.length > 0) {
      reuseId = this.freePages.pop();
    }
    let pageId = this.bufferPool.allocateNewPage(pageType, this.currentTxId, reuseId);
    if (this.inTransaction) {
      this.txAllocatedPages.push(pageId);
    }
    return pageId;
  }

  @inline
  private _retireTreePage(pageId: u32): void {
    if (pageId == 0) return;
    if (this.inTransaction) {
      this.txRetireOnCommitPages.push(pageId);
    } else {
      this.bufferPool.evictAndClearPage(pageId);
      this.freePages.push(pageId);
    }
  }

  /**
   * Generation-Tagged Copy-on-Write (CoW) page barrier.
   * Clones a page's pre-transaction 4KB buffer ONLY the first time it is dirtied
   * in `currentTxId` (`pageLsn < currentTxId`). Subsequent mutations in the same
   * transaction execute in-place with zero allocation or copy overhead.
   */
  @inline
  private _touchPage(pageId: u32, pagePtr: usize): void {
    let pageLsn = BTreePage.getLSN(pagePtr);
    if (pageLsn < this.currentTxId) {
      if (this.inTransaction && pageLsn > 0) {
        if (this.txShadowMap.get(pageId as u64) == 0) {
          let shadowPageId = this._allocRawPageId();
          let shadowDiskPtr = this.bufferPool.ensureVirtualDiskPage(shadowPageId);
          memory.copy(shadowDiskPtr, pagePtr, PAGE_SIZE);
          this.txShadowMap.set(pageId as u64, shadowPageId);
          this.txShadowedLogicIds.push(pageId);
          this.txShadowPhysicalIds.push(shadowPageId);
          this.cowClonesCount++;
        }
      }
      BTreePage.setLSN(pagePtr, this.currentTxId);
    }
    this.bufferPool.markDirty(pageId);
  }

  @inline
  private _fetchPageForRead(pageId: u32, committedSnapshot: bool): usize {
    if (committedSnapshot && this.inTransaction) {
      let shadowId = this.txShadowMap.get(pageId as u64);
      if (shadowId != 0) {
        let shadowPtr = this.bufferPool.getVirtualDiskPage(shadowId);
        if (shadowPtr != 0) return shadowPtr;
      }
    }
    return this.bufferPool.fetchPage(pageId);
  }

  // ---------------------------------------------------------------------------
  // Public Triple Store Operations (Insert, Delete, Find, Snapshot Find)
  // ---------------------------------------------------------------------------

  /**
   * Inserts an asserted or inferred triple into all three covering B+Trees (SPO, POS, OSP).
   */
  insert(s: u32, p: u32, o: u32, axiomType: u16 = 0, flags: u16 = 0): u32 {
    let status = this._insertIntoTree(TREE_SPO, s, p, o, axiomType, flags);
    this._insertIntoTree(TREE_POS, p, o, s, axiomType, flags);
    this._insertIntoTree(TREE_OSP, o, s, p, axiomType, flags);

    if (status == 1) {
      this.totalTriples++;
      if (!this.inTransaction) {
        this.committedTotalTriples = this.totalTriples;
        this.committedSpoRoot = this.spoRootPageId;
        this.committedPosRoot = this.posRootPageId;
        this.committedOspRoot = this.ospRootPageId;
      }
    }
    return 1;
  }

  /**
   * Deletes a triple (s, p, o) from all three covering B+Trees (SPO, POS, OSP).
   * Returns 1 if the triple existed and was deleted, 0 otherwise.
   */
  delete(s: u32, p: u32, o: u32): u32 {
    let deletedSpo = this._deleteFromTree(TREE_SPO, s, p, o);
    if (deletedSpo == 0) return 0;

    this._deleteFromTree(TREE_POS, p, o, s);
    this._deleteFromTree(TREE_OSP, o, s, p);

    if (this.totalTriples > 0) {
      this.totalTriples--;
    }
    if (!this.inTransaction) {
      this.committedTotalTriples = this.totalTriples;
      this.committedSpoRoot = this.spoRootPageId;
      this.committedPosRoot = this.posRootPageId;
      this.committedOspRoot = this.ospRootPageId;
    }
    return 1;
  }

  /**
   * Finds matching triples in the optimal B+Tree index (SPO, POS, or OSP) and writes them to outBuffer.
   * Wildcards are represented by 0 or 0xffffffff.
   */
  find(s: u32, p: u32, o: u32, outBuffer: ChunkedUint32Array): u32 {
    return this._findInternal(s, p, o, outBuffer, false);
  }

  /**
   * Finds matching triples against the last committed MVCC snapshot, isolated from uncommitted writes.
   */
  findCommitted(s: u32, p: u32, o: u32, outBuffer: ChunkedUint32Array): u32 {
    return this._findInternal(s, p, o, outBuffer, true);
  }

  private _findInternal(
    s: u32,
    p: u32,
    o: u32,
    outBuffer: ChunkedUint32Array,
    committedSnapshot: bool,
  ): u32 {
    let sWild = s == 0 || s == 0xffffffff;
    let pWild = p == 0 || p == 0xffffffff;
    let oWild = o == 0 || o == 0xffffffff;

    // Select the optimal covering index permutation so every bound pattern
    // executes as a contiguous prefix range scan in O(log N + K):
    //   1. (S, P, O), (S, P, ?), (S, ?, ?) -> TREE_SPO (k1=S, k2=P, k3=O)
    //   2. (S, ?, O)                       -> TREE_OSP (k1=O, k2=S)
    //   3. (?, P, O), (?, P, ?)            -> TREE_POS (k1=P, k2=O)
    //   4. (?, ?, O)                       -> TREE_OSP (k1=O)
    //   5. (?, ?, ?)                       -> TREE_SPO full leaf scan
    let treeId: u8 = TREE_SPO;
    let b1: u32 = 0;
    let b1Bound: bool = false;
    let b2: u32 = 0;
    let b2Bound: bool = false;
    let b3: u32 = 0;
    let b3Bound: bool = false;

    if (!sWild) {
      if (pWild && !oWild) {
        // Pattern (S, ?, O) is a contiguous 2-key prefix (O, S) inOSP!
        treeId = TREE_OSP;
        b1 = o;
        b1Bound = true;
        b2 = s;
        b2Bound = true;
      } else {
        // Patterns (S, P, O), (S, P, ?), (S, ?, ?) use SPO
        treeId = TREE_SPO;
        b1 = s;
        b1Bound = true;
        if (!pWild) {
          b2 = p;
          b2Bound = true;
          if (!oWild) {
            b3 = o;
            b3Bound = true;
          }
        }
      }
    } else if (!pWild) {
      // Patterns (?, P, O) and (?, P, ?) use POS
      treeId = TREE_POS;
      b1 = p;
      b1Bound = true;
      if (!oWild) {
        b2 = o;
        b2Bound = true;
      }
    } else if (!oWild) {
      // Pattern (?, ?, O) uses OSP
      treeId = TREE_OSP;
      b1 = o;
      b1Bound = true;
    }

    let rootId = this.getTreeRoot(treeId, committedSnapshot);
    let currPageId: u32 = 0;

    if (!b1Bound) {
      // Unbound full scan: descend to leftmost leaf of SPO
      let currId = rootId;
      while (currId != 0) {
        let pagePtr = this._fetchPageForRead(currId, committedSnapshot);
        if (BTreePage.getPageType(pagePtr) == PAGE_TYPE_LEAF) {
          currPageId = currId;
          break;
        }
        currId = BTreePage.getPrevPage(pagePtr);
      }
    } else {
      currPageId = this._findLeafPageForRead(
        rootId,
        b1,
        b2Bound ? b2 : 0,
        b3Bound ? b3 : 0,
        committedSnapshot,
      );
    }

    let matchCount: u32 = 0;
    let isFirstLeaf: bool = true;

    while (currPageId != 0) {
      let pagePtr = this._fetchPageForRead(currPageId, committedSnapshot);
      if (!committedSnapshot) {
        this.bufferPool.pinPage(currPageId);
      }
      let count = BTreePage.getItemCount(pagePtr) as u32;

      let startIdx: u32 = 0;
      if (isFirstLeaf && b1Bound && count > 0) {
        let bs = BTreePage.binarySearch(pagePtr, b1, b2Bound ? b2 : 0, b3Bound ? b3 : 0);
        startIdx = bs >= 0 ? (bs as u32) : ((~bs) as u32);
      }
      isFirstLeaf = false;

      for (let i: u32 = startIdx; i < count; i++) {
        let ek1 = BTreePage.getEntryS(pagePtr, i);
        let ek2 = BTreePage.getEntryP(pagePtr, i);
        let ek3 = BTreePage.getEntryO(pagePtr, i);

        if (b1Bound) {
          if (ek1 > b1) {
            if (!committedSnapshot) this.bufferPool.unpinPage(currPageId);
            return matchCount;
          }
          if (ek1 < b1) continue;

          if (b2Bound) {
            if (ek2 > b2) {
              if (!committedSnapshot) this.bufferPool.unpinPage(currPageId);
              return matchCount;
            }
            if (ek2 < b2) continue;

            if (b3Bound) {
              if (ek3 > b3) {
                if (!committedSnapshot) this.bufferPool.unpinPage(currPageId);
                return matchCount;
              }
              if (ek3 < b3) continue;
            }
          }
        }

        // Unpack (s, p, o) from permutation (ek1, ek2, ek3)
        let outS: u32;
        let outP: u32;
        let outO: u32;
        if (treeId == TREE_SPO) {
          outS = ek1;
          outP = ek2;
          outO = ek3;
        } else if (treeId == TREE_POS) {
          outP = ek1;
          outO = ek2;
          outS = ek3;
        } else {
          outO = ek1;
          outS = ek2;
          outP = ek3;
        }

        outBuffer.push(outS);
        outBuffer.push(outP);
        outBuffer.push(outO);
        outBuffer.push(BTreePage.getEntryType(pagePtr, i) as u32);
        outBuffer.push(BTreePage.getEntryFlags(pagePtr, i) as u32);
        matchCount++;
      }

      let next = BTreePage.getNextPage(pagePtr);
      if (!committedSnapshot) {
        this.bufferPool.unpinPage(currPageId);
      }
      currPageId = next;
    }

    return matchCount;
  }

  // ---------------------------------------------------------------------------
  // Internal Per-Tree Insert, Delete, Traversal & Node Splitting
  // ---------------------------------------------------------------------------

  /**
   * Inserts (k1, k2, k3, axiomType, flags) into the specified B+Tree index.
   * Returns 1 if newly inserted, 2 if updated existing entry.
   */
  private _insertIntoTree(
    treeId: u8,
    k1: u32,
    k2: u32,
    k3: u32,
    axiomType: u16,
    flags: u16,
  ): u32 {
    let rootId = this.getTreeRoot(treeId, false);
    let leafPageId = this._findLeafPage(rootId, k1, k2, k3);
    let leafPtr = this.bufferPool.fetchPage(leafPageId);
    this.bufferPool.pinPage(leafPageId);

    let idx = BTreePage.binarySearch(leafPtr, k1, k2, k3);
    if (idx >= 0) {
      // Entry already present: update axiomType and flags
      this._touchPage(leafPageId, leafPtr);
      BTreePage.setEntryType(leafPtr, idx as u32, axiomType);
      BTreePage.setEntryFlags(leafPtr, idx as u32, flags);
      this.bufferPool.unpinPage(leafPageId);
      return 2;
    }

    let insertIdx = (~idx) as u32;
    let count = BTreePage.getItemCount(leafPtr);

    if ((count as u32) < MAX_ENTRIES_PER_LEAF) {
      this._touchPage(leafPageId, leafPtr);
      for (let i = (count as u32); i > insertIdx; i--) {
        let srcOffset = BTreePage.getEntryOffset(i - 1);
        let dstOffset = BTreePage.getEntryOffset(i);
        memory.copy(leafPtr + dstOffset, leafPtr + srcOffset, ENTRY_SIZE);
      }

      BTreePage.setEntryS(leafPtr, insertIdx, k1);
      BTreePage.setEntryP(leafPtr, insertIdx, k2);
      BTreePage.setEntryO(leafPtr, insertIdx, k3);
      BTreePage.setEntryType(leafPtr, insertIdx, axiomType);
      BTreePage.setEntryFlags(leafPtr, insertIdx, flags);
      BTreePage.setItemCount(leafPtr, count + 1);

      this.bufferPool.unpinPage(leafPageId);
      return 1;
    }

    // Leaf page is full: split leaf page
    this._splitLeafPage(treeId, leafPageId, leafPtr, k1, k2, k3, axiomType, flags);
    this.bufferPool.unpinPage(leafPageId);
    return 1;
  }

  /**
   * Deletes (k1, k2, k3) from the specified B+Tree index.
   * Returns 1 if found and removed, 0 otherwise.
   */
  private _deleteFromTree(treeId: u8, k1: u32, k2: u32, k3: u32): u32 {
    let rootId = this.getTreeRoot(treeId, false);
    let leafPageId = this._findLeafPage(rootId, k1, k2, k3);
    let leafPtr = this.bufferPool.fetchPage(leafPageId);
    this.bufferPool.pinPage(leafPageId);

    let idx = BTreePage.binarySearch(leafPtr, k1, k2, k3);
    if (idx < 0) {
      this.bufferPool.unpinPage(leafPageId);
      return 0;
    }

    this._touchPage(leafPageId, leafPtr);
    let count = BTreePage.getItemCount(leafPtr) as u32;
    let delIdx = idx as u32;

    for (let i = delIdx; i + 1 < count; i++) {
      let srcOffset = BTreePage.getEntryOffset(i + 1);
      let dstOffset = BTreePage.getEntryOffset(i);
      memory.copy(leafPtr + dstOffset, leafPtr + srcOffset, ENTRY_SIZE);
    }

    let newCount = (count - 1) as u16;
    BTreePage.setItemCount(leafPtr, newCount);

    // Handle empty non-root leaf page by unlinking from parent and sibling chain
    if (newCount == 0 && leafPageId != rootId) {
      let parentId = BTreePage.getParentPage(leafPtr);
      if (parentId != 0) {
        let parentPtr = this.bufferPool.fetchPage(parentId);
        this.bufferPool.pinPage(parentId);
        let pCount = BTreePage.getItemCount(parentPtr) as u32;

        // Only unlink if parent has at least 1 pivot entry (so >= 2 children exist before removal)
        if (pCount >= 1) {
          let removedFromParent = false;
          if (BTreePage.getPrevPage(parentPtr) == leafPageId) {
            this._touchPage(parentId, parentPtr);
            let newChild0 = BTreePage.getChildPageId(parentPtr, 0);
            BTreePage.setPrevPage(parentPtr, newChild0);
            for (let i: u32 = 0; i + 1 < pCount; i++) {
              memory.copy(
                parentPtr + BTreePage.getEntryOffset(i),
                parentPtr + BTreePage.getEntryOffset(i + 1),
                ENTRY_SIZE,
              );
            }
            BTreePage.setItemCount(parentPtr, (pCount - 1) as u16);
            removedFromParent = true;
          } else {
            for (let i: u32 = 0; i < pCount; i++) {
              if (BTreePage.getChildPageId(parentPtr, i) == leafPageId) {
                this._touchPage(parentId, parentPtr);
                for (let j: u32 = i; j + 1 < pCount; j++) {
                  memory.copy(
                    parentPtr + BTreePage.getEntryOffset(j),
                    parentPtr + BTreePage.getEntryOffset(j + 1),
                    ENTRY_SIZE,
                  );
                }
                BTreePage.setItemCount(parentPtr, (pCount - 1) as u16);
                removedFromParent = true;
                break;
              }
            }
          }

          if (removedFromParent) {
            // Unlink leaf from doubly-linked leaf chain
            let prevId = BTreePage.getPrevPage(leafPtr);
            let nextId = BTreePage.getNextPage(leafPtr);
            if (prevId != 0) {
              let prevPtr = this.bufferPool.fetchPage(prevId);
              this.bufferPool.pinPage(prevId);
              this._touchPage(prevId, prevPtr);
              BTreePage.setNextPage(prevPtr, nextId);
              this.bufferPool.unpinPage(prevId);
            }
            if (nextId != 0) {
              let nextPtr = this.bufferPool.fetchPage(nextId);
              this.bufferPool.pinPage(nextId);
              this._touchPage(nextId, nextPtr);
              BTreePage.setPrevPage(nextPtr, prevId);
              this.bufferPool.unpinPage(nextId);
            }

            // If parent is root and now has 0 pivot keys (only prevPage child left), collapse root
            if (parentId == rootId && BTreePage.getItemCount(parentPtr) == 0) {
              let soleChildId = BTreePage.getPrevPage(parentPtr);
              if (soleChildId != 0) {
                let soleChildPtr = this.bufferPool.fetchPage(soleChildId);
                this._touchPage(soleChildId, soleChildPtr);
                BTreePage.setParentPage(soleChildPtr, 0);
                this.setTreeRoot(treeId, soleChildId);
                this.bufferPool.unpinPage(parentId);
                this._retireTreePage(parentId);
                this.bufferPool.unpinPage(leafPageId);
                this._retireTreePage(leafPageId);
                return 1;
              }
            }

            this.bufferPool.unpinPage(parentId);
            this.bufferPool.unpinPage(leafPageId);
            this._retireTreePage(leafPageId);
            return 1;
          }
        }
        this.bufferPool.unpinPage(parentId);
      }
    }

    this.bufferPool.unpinPage(leafPageId);
    return 1;
  }

  private _findLeafPage(pageId: u32, k1: u32, k2: u32, k3: u32): u32 {
    let currId = pageId;

    while (currId != 0) {
      let pagePtr = this.bufferPool.fetchPage(currId);
      let pType = BTreePage.getPageType(pagePtr);

      if (pType == PAGE_TYPE_LEAF) {
        return currId;
      }

      let idx = BTreePage.binarySearch(pagePtr, k1, k2, k3);
      if (idx >= 0) {
        currId = BTreePage.getChildPageId(pagePtr, idx as u32);
      } else {
        let insertIdx = (~idx) as u32;
        if (insertIdx == 0) {
          currId = BTreePage.getPrevPage(pagePtr);
        } else {
          currId = BTreePage.getChildPageId(pagePtr, insertIdx - 1);
        }
      }
    }

    return pageId;
  }

  private _findLeafPageForRead(
    pageId: u32,
    k1: u32,
    k2: u32,
    k3: u32,
    committedSnapshot: bool,
  ): u32 {
    let currId = pageId;

    while (currId != 0) {
      let pagePtr = this._fetchPageForRead(currId, committedSnapshot);
      let pType = BTreePage.getPageType(pagePtr);

      if (pType == PAGE_TYPE_LEAF) {
        return currId;
      }

      let idx = BTreePage.binarySearch(pagePtr, k1, k2, k3);
      if (idx >= 0) {
        currId = BTreePage.getChildPageId(pagePtr, idx as u32);
      } else {
        let insertIdx = (~idx) as u32;
        if (insertIdx == 0) {
          currId = BTreePage.getPrevPage(pagePtr);
        } else {
          currId = BTreePage.getChildPageId(pagePtr, insertIdx - 1);
        }
      }
    }

    return pageId;
  }

  private _splitLeafPage(
    treeId: u8,
    leafPageId: u32,
    leafPtr: usize,
    k1: u32,
    k2: u32,
    k3: u32,
    axiomType: u16,
    flags: u16,
  ): void {
    this._touchPage(leafPageId, leafPtr);

    let newLeafId = this._allocTreePage(PAGE_TYPE_LEAF);
    this.bufferPool.pinPage(newLeafId);
    let newLeafPtr = this.bufferPool.fetchPage(newLeafId);
    BTreePage.setParentPage(newLeafPtr, BTreePage.getParentPage(leafPtr));

    let oldCount = BTreePage.getItemCount(leafPtr);
    let mid = oldCount >> 1;

    // Copy upper half (from mid to oldCount) to new leaf
    let newCount: u16 = 0;
    for (let i = mid; i < oldCount; i++) {
      let srcOffset = BTreePage.getEntryOffset(i as u32);
      let dstOffset = BTreePage.getEntryOffset(newCount as u32);
      memory.copy(newLeafPtr + dstOffset, leafPtr + srcOffset, ENTRY_SIZE);
      newCount++;
    }

    BTreePage.setItemCount(leafPtr, mid);
    BTreePage.setItemCount(newLeafPtr, newCount);

    // Update doubly-linked leaf pointers
    let oldNext = BTreePage.getNextPage(leafPtr);
    BTreePage.setNextPage(leafPtr, newLeafId);
    BTreePage.setPrevPage(newLeafPtr, leafPageId);
    BTreePage.setNextPage(newLeafPtr, oldNext);
    if (oldNext != 0) {
      let nextPtr = this.bufferPool.fetchPage(oldNext);
      this.bufferPool.pinPage(oldNext);
      this._touchPage(oldNext, nextPtr);
      BTreePage.setPrevPage(nextPtr, newLeafId);
      this.bufferPool.unpinPage(oldNext);
    }

    // Insert pending triple into appropriate split leaf
    let firstNewK1 = BTreePage.getEntryS(newLeafPtr, 0);
    let firstNewK2 = BTreePage.getEntryP(newLeafPtr, 0);
    let firstNewK3 = BTreePage.getEntryO(newLeafPtr, 0);

    let goLeft =
      k1 < firstNewK1 ||
      (k1 == firstNewK1 && k2 < firstNewK2) ||
      (k1 == firstNewK1 && k2 == firstNewK2 && k3 < firstNewK3);
    let targetPageId = goLeft ? leafPageId : newLeafId;

    let targetPtr = this.bufferPool.fetchPage(targetPageId);
    let tIdx = BTreePage.binarySearch(targetPtr, k1, k2, k3);
    let insertIdx = (~tIdx) as u32;
    let tCount = BTreePage.getItemCount(targetPtr);

    for (let i = (tCount as u32); i > insertIdx; i--) {
      let srcOffset = BTreePage.getEntryOffset(i - 1);
      let dstOffset = BTreePage.getEntryOffset(i);
      memory.copy(targetPtr + dstOffset, targetPtr + srcOffset, ENTRY_SIZE);
    }
    BTreePage.setEntryS(targetPtr, insertIdx, k1);
    BTreePage.setEntryP(targetPtr, insertIdx, k2);
    BTreePage.setEntryO(targetPtr, insertIdx, k3);
    BTreePage.setEntryType(targetPtr, insertIdx, axiomType);
    BTreePage.setEntryFlags(targetPtr, insertIdx, flags);
    BTreePage.setItemCount(targetPtr, tCount + 1);

    this.bufferPool.markDirty(leafPageId);
    this.bufferPool.markDirty(newLeafId);

    // Promote first key of right leaf into parent
    let pivotK1 = BTreePage.getEntryS(newLeafPtr, 0);
    let pivotK2 = BTreePage.getEntryP(newLeafPtr, 0);
    let pivotK3 = BTreePage.getEntryO(newLeafPtr, 0);
    this._insertIntoParent(treeId, leafPageId, pivotK1, pivotK2, pivotK3, newLeafId);

    this.bufferPool.unpinPage(newLeafId);
  }

  private _insertIntoParent(
    treeId: u8,
    leftPageId: u32,
    pivotK1: u32,
    pivotK2: u32,
    pivotK3: u32,
    rightPageId: u32,
  ): void {
    let leftPtr = this.bufferPool.fetchPage(leftPageId);
    let parentId = BTreePage.getParentPage(leftPtr);

    if (parentId == 0) {
      // Left was root: allocate new internal root for this tree
      let newRootId = this._allocTreePage(PAGE_TYPE_INTERNAL);
      this.bufferPool.pinPage(newRootId);
      let newRootPtr = this.bufferPool.fetchPage(newRootId);

      BTreePage.setEntryS(newRootPtr, 0, pivotK1);
      BTreePage.setEntryP(newRootPtr, 0, pivotK2);
      BTreePage.setEntryO(newRootPtr, 0, pivotK3);
      BTreePage.setPrevPage(newRootPtr, leftPageId); // child 0
      BTreePage.setChildPageId(newRootPtr, 0, rightPageId); // child 1
      BTreePage.setItemCount(newRootPtr, 1);

      this._touchPage(leftPageId, leftPtr);
      BTreePage.setParentPage(leftPtr, newRootId);
      let rightPtr = this.bufferPool.fetchPage(rightPageId);
      this._touchPage(rightPageId, rightPtr);
      BTreePage.setParentPage(rightPtr, newRootId);

      this.setTreeRoot(treeId, newRootId);
      this.bufferPool.markDirty(newRootId);
      this.bufferPool.unpinPage(newRootId);
      return;
    }

    // Insert into existing parent
    let parentPtr = this.bufferPool.fetchPage(parentId);
    this.bufferPool.pinPage(parentId);
    let count = BTreePage.getItemCount(parentPtr) as u32;

    if (count < MAX_ENTRIES_PER_INTERNAL) {
      this._touchPage(parentId, parentPtr);
      let idx = BTreePage.binarySearch(parentPtr, pivotK1, pivotK2, pivotK3);
      let insIdx = (idx >= 0 ? idx + 1 : ~idx) as u32;

      for (let i = count; i > insIdx; i--) {
        let srcOffset = BTreePage.getEntryOffset(i - 1);
        let dstOffset = BTreePage.getEntryOffset(i);
        memory.copy(parentPtr + dstOffset, parentPtr + srcOffset, ENTRY_SIZE);
      }

      BTreePage.setEntryS(parentPtr, insIdx, pivotK1);
      BTreePage.setEntryP(parentPtr, insIdx, pivotK2);
      BTreePage.setEntryO(parentPtr, insIdx, pivotK3);
      BTreePage.setChildPageId(parentPtr, insIdx, rightPageId);
      BTreePage.setItemCount(parentPtr, (count + 1) as u16);

      let rightPtr = this.bufferPool.fetchPage(rightPageId);
      this._touchPage(rightPageId, rightPtr);
      BTreePage.setParentPage(rightPtr, parentId);

      this.bufferPool.unpinPage(parentId);
      return;
    }

    // Parent is full: split internal node
    this._splitInternalPage(treeId, parentId, parentPtr, pivotK1, pivotK2, pivotK3, rightPageId);
    this.bufferPool.unpinPage(parentId);
  }

  private _splitInternalPage(
    treeId: u8,
    parentPageId: u32,
    parentPtr: usize,
    pivotK1: u32,
    pivotK2: u32,
    pivotK3: u32,
    rightChildId: u32,
  ): void {
    this._touchPage(parentPageId, parentPtr);

    let newInternalId = this._allocTreePage(PAGE_TYPE_INTERNAL);
    this.bufferPool.pinPage(newInternalId);
    let newInternalPtr = this.bufferPool.fetchPage(newInternalId);
    BTreePage.setParentPage(newInternalPtr, BTreePage.getParentPage(parentPtr));

    let count = BTreePage.getItemCount(parentPtr) as u32;
    let mid = count >> 1;

    let promotedK1 = BTreePage.getEntryS(parentPtr, mid);
    let promotedK2 = BTreePage.getEntryP(parentPtr, mid);
    let promotedK3 = BTreePage.getEntryO(parentPtr, mid);
    let newChild0 = BTreePage.getChildPageId(parentPtr, mid);
    BTreePage.setPrevPage(newInternalPtr, newChild0);

    let newCount: u16 = 0;
    for (let i = mid + 1; i < count; i++) {
      let srcOffset = BTreePage.getEntryOffset(i);
      let dstOffset = BTreePage.getEntryOffset(newCount as u32);
      memory.copy(newInternalPtr + dstOffset, parentPtr + srcOffset, ENTRY_SIZE);
      let cId = BTreePage.getChildPageId(newInternalPtr, newCount as u32);
      let cPtr = this.bufferPool.fetchPage(cId);
      this.bufferPool.pinPage(cId);
      this._touchPage(cId, cPtr);
      BTreePage.setParentPage(cPtr, newInternalId);
      this.bufferPool.unpinPage(cId);
      newCount++;
    }

    let c0Ptr = this.bufferPool.fetchPage(newChild0);
    this.bufferPool.pinPage(newChild0);
    this._touchPage(newChild0, c0Ptr);
    BTreePage.setParentPage(c0Ptr, newInternalId);
    this.bufferPool.unpinPage(newChild0);

    BTreePage.setItemCount(parentPtr, mid as u16);
    BTreePage.setItemCount(newInternalPtr, newCount);

    let isLeft =
      pivotK1 < promotedK1 ||
      (pivotK1 == promotedK1 && pivotK2 < promotedK2) ||
      (pivotK1 == promotedK1 && pivotK2 == promotedK2 && pivotK3 < promotedK3);
    let targetPageId = isLeft ? parentPageId : newInternalId;
    let targetPtr = isLeft ? parentPtr : newInternalPtr;
    let tCount = BTreePage.getItemCount(targetPtr) as u32;
    let idx = BTreePage.binarySearch(targetPtr, pivotK1, pivotK2, pivotK3);
    let insIdx = (idx >= 0 ? idx + 1 : ~idx) as u32;

    for (let i = tCount; i > insIdx; i--) {
      let srcOffset = BTreePage.getEntryOffset(i - 1);
      let dstOffset = BTreePage.getEntryOffset(i);
      memory.copy(targetPtr + dstOffset, targetPtr + srcOffset, ENTRY_SIZE);
    }
    BTreePage.setEntryS(targetPtr, insIdx, pivotK1);
    BTreePage.setEntryP(targetPtr, insIdx, pivotK2);
    BTreePage.setEntryO(targetPtr, insIdx, pivotK3);
    BTreePage.setChildPageId(targetPtr, insIdx, rightChildId);
    BTreePage.setItemCount(targetPtr, (tCount + 1) as u16);

    let rcPtr = this.bufferPool.fetchPage(rightChildId);
    this.bufferPool.pinPage(rightChildId);
    this._touchPage(rightChildId, rcPtr);
    BTreePage.setParentPage(rcPtr, targetPageId);
    this.bufferPool.unpinPage(rightChildId);

    this.bufferPool.markDirty(parentPageId);
    this.bufferPool.markDirty(newInternalId);
    this.bufferPool.unpinPage(newInternalId);

    this._insertIntoParent(
      treeId,
      parentPageId,
      promotedK1,
      promotedK2,
      promotedK3,
      newInternalId,
    );
  }

  // ---------------------------------------------------------------------------
  // Prefix-Compressed Slotted Leaf Inspection & Worst-Case Optimal Join (WCOJ)
  // ---------------------------------------------------------------------------

  /**
   * Computes the total byte size of all active pages if leaf pages are serialized
   * using shared (k1, k2) Prefix Run-Length Compression.
   */
  getPrefixCompressedSize(): u32 {
    let maxPageId = this.bufferPool.nextAllocPageId;
    let totalBytes: u32 = 0;
    let scratchPtr = this.bufferPool.exchangeBuffer;

    for (let pageId: u32 = 1; pageId < maxPageId; pageId++) {
      let pagePtr = this.bufferPool.fetchPage(pageId);
      if (pagePtr == 0) continue;
      let itemCount = BTreePage.getItemCount(pagePtr);
      if (itemCount == 0 && pageId > 3) continue;
      let pType = BTreePage.getPageType(pagePtr);
      if (pType == PAGE_TYPE_LEAF) {
        totalBytes += BTreePage.compressPagePrefixRuns(pagePtr, scratchPtr);
      } else {
        totalBytes += PAGE_HEADER_SIZE + (itemCount as u32) * ENTRY_SIZE;
      }
    }
    return totalBytes;
  }

  /**
   * Worst-Case Optimal Join (Leapfrog Triejoin) for cyclic 3-pattern triangle queries:
   *   (?x, p1, ?y) /\ (?y, p2, ?z) /\ (?z, p3, ?x)
   *
   * Executes directly over the sorted B+Tree leaf chains of TREE_POS and TREE_SPO
   * with zero intermediate hash tables or tuple materializations:
   *   1. Scans (k1 = p1, k2 = y, k3 = x) in TREE_POS (grouped by y).
   *   2. For each distinct y, locates the starting leaf cursor for (k1 = y, k2 = p2) in TREE_SPO
   *      which yields candidate zA values in ascending sorted order. If empty, skips all x for y.
   *   3. For each (y, x), locates the starting leaf cursor for (k1 = p3, k2 = x, k3 >= first_zA)
   *      in TREE_POS which yields candidate zB values in ascending sorted order.
   *   4. Leapfrogs the two sorted leaf iterators (zA in SPO vs zB in POS), emitting (x, y, z)
   *      to outBuffer whenever zA == zB.
   */
  leapfrogJoinTriangle(p1: u32, p2: u32, p3: u32, outBuffer: ChunkedUint32Array): u32 {
    let posRoot = this.posRootPageId;
    let spoRoot = this.spoRootPageId;
    let matchCount: u32 = 0;

    // 1. Seek TREE_POS to the first entry for (k1 = p1, k2 = 0, k3 = 0)
    let outerPageId = this._findLeafPage(posRoot, p1, 0, 0);
    if (outerPageId == 0) return 0;

    let outerPagePtr = this.bufferPool.fetchPage(outerPageId);
    this.bufferPool.pinPage(outerPageId);
    let outerCount = BTreePage.getItemCount(outerPagePtr) as u32;
    let outerIdx: u32 = 0;
    if (outerCount > 0) {
      let bs = BTreePage.binarySearch(outerPagePtr, p1, 0, 0);
      outerIdx = bs >= 0 ? (bs as u32) : ((~bs) as u32);
    }

    // Cached SPO cursor for the current y under (k1 = y, k2 = p2)
    let cachedY: u32 = 0xffffffff;
    let cachedYHasZ: bool = false;
    let cachedSpoLeafId: u32 = 0;
    let cachedSpoStartIdx: u32 = 0;
    let cachedFirstZ: u32 = 0;

    while (outerPageId != 0) {
      while (outerIdx < outerCount) {
        let ek1 = BTreePage.getEntryS(outerPagePtr, outerIdx); // P = p1
        if (ek1 > p1) {
          this.bufferPool.unpinPage(outerPageId);
          return matchCount;
        }
        if (ek1 < p1) {
          outerIdx++;
          continue;
        }

        let y = BTreePage.getEntryP(outerPagePtr, outerIdx); // O = y
        let x = BTreePage.getEntryO(outerPagePtr, outerIdx); // S = x
        outerIdx++;

        // Resolve (y, p2, ?z) start cursor in TREE_SPO once per distinct y
        if (y != cachedY) {
          cachedY = y;
          cachedYHasZ = false;
          let spoLeafId = this._findLeafPage(spoRoot, y, p2, 0);
          if (spoLeafId != 0) {
            let spoPtr = this.bufferPool.fetchPage(spoLeafId);
            let sCount = BTreePage.getItemCount(spoPtr) as u32;
            let sIdx: u32 = 0;
            if (sCount > 0) {
              let sBs = BTreePage.binarySearch(spoPtr, y, p2, 0);
              sIdx = sBs >= 0 ? (sBs as u32) : ((~sBs) as u32);
            }
            if (sIdx >= sCount) {
              let nextSpoId = BTreePage.getNextPage(spoPtr);
              if (nextSpoId != 0) {
                spoLeafId = nextSpoId;
                spoPtr = this.bufferPool.fetchPage(spoLeafId);
                sCount = BTreePage.getItemCount(spoPtr) as u32;
                sIdx = 0;
              }
            }
            if (
              sIdx < sCount &&
              BTreePage.getEntryS(spoPtr, sIdx) == y &&
              BTreePage.getEntryP(spoPtr, sIdx) == p2
            ) {
              cachedYHasZ = true;
              cachedSpoLeafId = spoLeafId;
              cachedSpoStartIdx = sIdx;
              cachedFirstZ = BTreePage.getEntryO(spoPtr, sIdx);
            }
          }
        }

        if (!cachedYHasZ) {
          continue;
        }

        // Seek TREE_POS for (k1 = p3, k2 = x, k3 >= cachedFirstZ)
        let bLeafId = this._findLeafPage(posRoot, p3, x, cachedFirstZ);
        if (bLeafId == 0) continue;
        let bPtr = this.bufferPool.fetchPage(bLeafId);
        let bCount = BTreePage.getItemCount(bPtr) as u32;
        let bIdx: u32 = 0;
        if (bCount > 0) {
          let bBs = BTreePage.binarySearch(bPtr, p3, x, cachedFirstZ);
          bIdx = bBs >= 0 ? (bBs as u32) : ((~bBs) as u32);
        }
        if (bIdx >= bCount) {
          let nextBId = BTreePage.getNextPage(bPtr);
          if (nextBId != 0) {
            bLeafId = nextBId;
            bPtr = this.bufferPool.fetchPage(bLeafId);
            bCount = BTreePage.getItemCount(bPtr) as u32;
            bIdx = 0;
          }
        }
        if (
          bIdx >= bCount ||
          BTreePage.getEntryS(bPtr, bIdx) != p3 ||
          BTreePage.getEntryP(bPtr, bIdx) != x
        ) {
          continue;
        }

        // Leapfrog Intersection over ?z between Stream A (SPO: y, p2, zA) and Stream B (POS: p3, x, zB)
        let aLeafId = cachedSpoLeafId;
        let aIdx = cachedSpoStartIdx;
        let aPtr = this.bufferPool.fetchPage(aLeafId);
        let aCount = BTreePage.getItemCount(aPtr) as u32;

        this.bufferPool.pinPage(aLeafId);
        this.bufferPool.pinPage(bLeafId);

        let zA = BTreePage.getEntryO(aPtr, aIdx);
        let zB = BTreePage.getEntryO(bPtr, bIdx);

        while (true) {
          if (zA == zB) {
            outBuffer.push(x);
            outBuffer.push(y);
            outBuffer.push(zA);
            matchCount++;

            // Advance Stream A
            aIdx++;
            if (aIdx >= aCount) {
              let nextA = BTreePage.getNextPage(aPtr);
              this.bufferPool.unpinPage(aLeafId);
              if (nextA == 0) {
                aLeafId = 0;
                break;
              }
              aLeafId = nextA;
              aPtr = this.bufferPool.fetchPage(aLeafId);
              this.bufferPool.pinPage(aLeafId);
              aCount = BTreePage.getItemCount(aPtr) as u32;
              aIdx = 0;
            }
            if (
              aIdx >= aCount ||
              BTreePage.getEntryS(aPtr, aIdx) != y ||
              BTreePage.getEntryP(aPtr, aIdx) != p2
            ) {
              break;
            }
            zA = BTreePage.getEntryO(aPtr, aIdx);

            // Advance Stream B
            bIdx++;
            if (bIdx >= bCount) {
              let nextB = BTreePage.getNextPage(bPtr);
              this.bufferPool.unpinPage(bLeafId);
              if (nextB == 0) {
                bLeafId = 0;
                break;
              }
              bLeafId = nextB;
              bPtr = this.bufferPool.fetchPage(bLeafId);
              this.bufferPool.pinPage(bLeafId);
              bCount = BTreePage.getItemCount(bPtr) as u32;
              bIdx = 0;
            }
            if (
              bIdx >= bCount ||
              BTreePage.getEntryS(bPtr, bIdx) != p3 ||
              BTreePage.getEntryP(bPtr, bIdx) != x
            ) {
              break;
            }
            zB = BTreePage.getEntryO(bPtr, bIdx);
          } else if (zA < zB) {
            // Advance Stream A to first entry >= zB
            aIdx++;
            while (true) {
              if (aIdx >= aCount) {
                let nextA = BTreePage.getNextPage(aPtr);
                this.bufferPool.unpinPage(aLeafId);
                if (nextA == 0) {
                  aLeafId = 0;
                  break;
                }
                aLeafId = nextA;
                aPtr = this.bufferPool.fetchPage(aLeafId);
                this.bufferPool.pinPage(aLeafId);
                aCount = BTreePage.getItemCount(aPtr) as u32;
                aIdx = 0;
              }
              if (
                aIdx >= aCount ||
                BTreePage.getEntryS(aPtr, aIdx) != y ||
                BTreePage.getEntryP(aPtr, aIdx) != p2
              ) {
                this.bufferPool.unpinPage(aLeafId);
                aLeafId = 0;
                break;
              }
              zA = BTreePage.getEntryO(aPtr, aIdx);
              if (zA >= zB) break;
              aIdx++;
            }
            if (aLeafId == 0) break;
          } else {
            // zB < zA: Advance Stream B to first entry >= zA
            bIdx++;
            while (true) {
              if (bIdx >= bCount) {
                let nextB = BTreePage.getNextPage(bPtr);
                this.bufferPool.unpinPage(bLeafId);
                if (nextB == 0) {
                  bLeafId = 0;
                  break;
                }
                bLeafId = nextB;
                bPtr = this.bufferPool.fetchPage(bLeafId);
                this.bufferPool.pinPage(bLeafId);
                bCount = BTreePage.getItemCount(bPtr) as u32;
                bIdx = 0;
              }
              if (
                bIdx >= bCount ||
                BTreePage.getEntryS(bPtr, bIdx) != p3 ||
                BTreePage.getEntryP(bPtr, bIdx) != x
              ) {
                this.bufferPool.unpinPage(bLeafId);
                bLeafId = 0;
                break;
              }
              zB = BTreePage.getEntryO(bPtr, bIdx);
              if (zB >= zA) break;
              bIdx++;
            }
            if (bLeafId == 0) break;
          }
        }

        if (aLeafId != 0) this.bufferPool.unpinPage(aLeafId);
        if (bLeafId != 0) this.bufferPool.unpinPage(bLeafId);

        // Re-fetch outerPagePtr in case buffer pool frame moved (though outerPageId is pinned)
        outerPagePtr = this.bufferPool.fetchPage(outerPageId);
      }

      let nextOuter = BTreePage.getNextPage(outerPagePtr);
      this.bufferPool.unpinPage(outerPageId);
      outerPageId = nextOuter;
      if (outerPageId != 0) {
        outerPagePtr = this.bufferPool.fetchPage(outerPageId);
        this.bufferPool.pinPage(outerPageId);
        outerCount = BTreePage.getItemCount(outerPagePtr) as u32;
        outerIdx = 0;
      }
    }

    return matchCount;
  }
}

// ----------------------------------------------------------------------------
// Global Singleton & Exported WASM API
// ----------------------------------------------------------------------------

let g_pagedStore: PagedBTreeStore | null = null;
let g_pagedQueryBuf: ChunkedUint32Array | null = null;
let g_pagedQueryFlatPtr: usize = 0;
let g_pagedQueryFlatCap: u32 = 0;

function ensurePagedStore(): void {
  if (g_pagedStore == null) {
    let ptr = atomicChunkAlloc(offsetof<PagedBTreeStore>()) as usize;
    let store = changetype<PagedBTreeStore>(ptr);
    store.init(512); // Default 512 frames = 2 MB buffer pool
    g_pagedStore = store;
    g_pagedQueryBuf = createChunkedUint32Array(512);
  }
}

export function paged_init(bufferPoolFrames: u32 = 512): void {
  let ptr = atomicChunkAlloc(offsetof<PagedBTreeStore>()) as usize;
  let store = changetype<PagedBTreeStore>(ptr);
  store.init(bufferPoolFrames);
  g_pagedStore = store;
  g_pagedQueryBuf = createChunkedUint32Array(512);
}

export function paged_insertTriple(s: u32, p: u32, o: u32, axiomType: u32, flags: u32): u32 {
  ensurePagedStore();
  return g_pagedStore!.insert(s, p, o, axiomType as u16, flags as u16);
}

export function paged_deleteTriple(s: u32, p: u32, o: u32): u32 {
  ensurePagedStore();
  return g_pagedStore!.delete(s, p, o);
}

export function paged_findTriples(s: u32, p: u32, o: u32): u32 {
  ensurePagedStore();
  g_pagedQueryBuf!.clear();
  let count = g_pagedStore!.find(s, p, o, g_pagedQueryBuf!);

  let totalWords = count * 5; // 5 words per triple: s, p, o, type, flags
  if (totalWords > g_pagedQueryFlatCap) {
    g_pagedQueryFlatCap = totalWords + 256;
    g_pagedQueryFlatPtr = atomicChunkAlloc(g_pagedQueryFlatCap * sizeof<u32>()) as usize;
  }

  g_pagedQueryBuf!.copyToFlat(g_pagedQueryFlatPtr);
  return count;
}

export function paged_findTriplesCommitted(s: u32, p: u32, o: u32): u32 {
  ensurePagedStore();
  g_pagedQueryBuf!.clear();
  let count = g_pagedStore!.findCommitted(s, p, o, g_pagedQueryBuf!);

  let totalWords = count * 5;
  if (totalWords > g_pagedQueryFlatCap) {
    g_pagedQueryFlatCap = totalWords + 256;
    g_pagedQueryFlatPtr = atomicChunkAlloc(g_pagedQueryFlatCap * sizeof<u32>()) as usize;
  }

  g_pagedQueryBuf!.copyToFlat(g_pagedQueryFlatPtr);
  return count;
}

export function paged_leapfrogJoinTriangle(p1: u32, p2: u32, p3: u32): u32 {
  ensurePagedStore();
  g_pagedQueryBuf!.clear();
  let count = g_pagedStore!.leapfrogJoinTriangle(p1, p2, p3, g_pagedQueryBuf!);

  let totalWords = count * 3; // 3 words per triangle match: x, y, z
  if (totalWords > g_pagedQueryFlatCap) {
    g_pagedQueryFlatCap = totalWords + 256;
    g_pagedQueryFlatPtr = atomicChunkAlloc(g_pagedQueryFlatCap * sizeof<u32>()) as usize;
  }

  g_pagedQueryBuf!.copyToFlat(g_pagedQueryFlatPtr);
  return count;
}

export function paged_getPrefixCompressedSize(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.getPrefixCompressedSize();
}

export function paged_compressPageToExchange(pageId: u32): u32 {
  ensurePagedStore();
  let ptr = g_pagedStore!.bufferPool.fetchPage(pageId);
  if (ptr == 0) return 0;
  return BTreePage.compressPagePrefixRuns(ptr, g_pagedStore!.bufferPool.exchangeBuffer);
}

export function paged_decompressExchangeToPage(pageId: u32): u32 {
  ensurePagedStore();
  if (pageId == 0) return 0;
  let exPtr = g_pagedStore!.bufferPool.exchangeBuffer;
  if (exPtr == 0) return 0;
  let framePtr = g_pagedStore!.bufferPool.fetchPage(pageId);
  if (framePtr == 0) return 0;
  let count = BTreePage.decompressPagePrefixRuns(exPtr, framePtr);
  g_pagedStore!.bufferPool.overwritePage(pageId, framePtr);
  if (pageId >= g_pagedStore!.bufferPool.nextAllocPageId) {
    g_pagedStore!.bufferPool.nextAllocPageId = pageId + 1;
  }
  return count;
}

export function paged_beginTx(): u32 {
  ensurePagedStore();
  return g_pagedStore!.beginTransaction() as u32;
}

export function paged_commitTx(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.commitTransaction();
}

export function paged_abortTx(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.abortTransaction();
}

export function paged_getTxId(): u32 {
  if (g_pagedStore == null) return 1;
  return g_pagedStore!.currentTxId as u32;
}

export function paged_getCommittedTxId(): u32 {
  if (g_pagedStore == null) return 1;
  return g_pagedStore!.committedTxId as u32;
}

export function paged_getCowClonesCount(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.cowClonesCount;
}

export function paged_getFreePageCount(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.freePages.length;
}

export function paged_getFreePageAt(index: u32): u32 {
  if (g_pagedStore == null || index >= g_pagedStore!.freePages.length) return 0;
  return g_pagedStore!.freePages.get(index);
}

export function paged_pushFreePage(pageId: u32): void {
  ensurePagedStore();
  if (pageId > 0) {
    g_pagedStore!.freePages.push(pageId);
  }
}

export function paged_getSpoRoot(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.spoRootPageId;
}

export function paged_getPosRoot(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.posRootPageId;
}

export function paged_getOspRoot(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.ospRootPageId;
}

export function paged_restoreSuperblock(
  txId: u32,
  spoRoot: u32,
  posRoot: u32,
  ospRoot: u32,
  totalTriples: u32,
  nextAllocPageId: u32,
): void {
  ensurePagedStore();
  let s = g_pagedStore!;
  s.currentTxId = txId as u64;
  s.committedTxId = txId as u64;
  s.spoRootPageId = spoRoot;
  s.posRootPageId = posRoot;
  s.ospRootPageId = ospRoot;
  s.rootPageId = spoRoot;
  s.committedSpoRoot = spoRoot;
  s.committedPosRoot = posRoot;
  s.committedOspRoot = ospRoot;
  s.totalTriples = totalTriples;
  s.committedTotalTriples = totalTriples;
  s.bufferPool.nextAllocPageId = nextAllocPageId;
  s.inTransaction = false;
  s.freePages.clear();
}

export function paged_getQueryBufferPtr(): usize {
  return g_pagedQueryFlatPtr;
}

export function paged_getExchangeBufferPtr(): usize {
  ensurePagedStore();
  return g_pagedStore!.bufferPool.exchangeBuffer;
}

export function paged_readPageToExchange(pageId: u32): u32 {
  ensurePagedStore();
  let ptr = g_pagedStore!.bufferPool.fetchPage(pageId);
  if (ptr == 0) return 0;
  memory.copy(g_pagedStore!.bufferPool.exchangeBuffer, ptr, PAGE_SIZE);
  return 1;
}

export function paged_writeExchangeToPage(pageId: u32): u32 {
  ensurePagedStore();
  if (pageId == 0) return 0;
  let exPtr = g_pagedStore!.bufferPool.exchangeBuffer;
  if (exPtr == 0) return 0;
  g_pagedStore!.bufferPool.overwritePage(pageId, exPtr);
  if (pageId >= g_pagedStore!.bufferPool.nextAllocPageId) {
    g_pagedStore!.bufferPool.nextAllocPageId = pageId + 1;
  }
  return 1;
}

export function paged_getPageLsn(pageId: u32): u32 {
  if (g_pagedStore == null || pageId == 0) return 0;
  let val = g_pagedStore!.bufferPool.getPageFrameVal(pageId);
  if (val > 0) {
    let fPtr = g_pagedStore!.bufferPool.getFramePointer(val - 1);
    if (fPtr != 0) return BTreePage.getLSN(fPtr) as u32;
  }
  let diskPtr = g_pagedStore!.bufferPool.getVirtualDiskPage(pageId);
  if (diskPtr != 0) {
    return BTreePage.getLSN(diskPtr) as u32;
  }
  let ptr = g_pagedStore!.bufferPool.fetchPage(pageId);
  if (ptr == 0) return 0;
  return BTreePage.getLSN(ptr) as u32;
}

export function paged_flush(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.bufferPool.flushAll();
}

export function paged_getPageCount(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.bufferPool.nextAllocPageId - 1;
}

export function paged_getTotalTriples(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.totalTriples;
}

export function paged_getCommittedTotalTriples(): u32 {
  if (g_pagedStore == null) return 0;
  return g_pagedStore!.inTransaction
    ? g_pagedStore!.committedTotalTriples
    : g_pagedStore!.totalTriples;
}

export function paged_getBufferPoolHitRate(): f32 {
  if (g_pagedStore == null) return 1.0;
  return g_pagedStore!.bufferPool.getHitRate();
}
