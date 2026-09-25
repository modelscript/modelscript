// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  atomicChunkAlloc,
  ChunkedUint32Array,
  createChunkedUint32Array,
  ChunkedUint8Array,
  createChunkedUint8Array,
  ChunkedUint16Array,
  createChunkedUint16Array,
} from "../core/array";
import { UnmanagedMap64, createMap64 } from "../core/hashmap";

export const PAGE_SIZE: u32 = 4096;
export const PAGE_HEADER_SIZE: u32 = 32;
export const ENTRY_SIZE: u32 = 16;
export const MAX_ENTRIES_PER_LEAF: u32 = (PAGE_SIZE - PAGE_HEADER_SIZE) / ENTRY_SIZE; // 254 entries
export const MAX_ENTRIES_PER_INTERNAL: u32 = (PAGE_SIZE - PAGE_HEADER_SIZE) / ENTRY_SIZE; // 254 entries

export const PAGE_TYPE_LEAF: u16 = 1;
export const PAGE_TYPE_INTERNAL: u16 = 2;

/**
 * Slotted 4KB B+Tree Page Header Layout (32 bytes):
 *   [0..3]   pageId: u32
 *   [4..5]   pageType: u16 (1 = Leaf, 2 = Internal)
 *   [6..7]   itemCount: u16
 *   [8..11]  prevPage: u32 (doubly-linked leaf chain for range scans)
 *   [12..15] nextPage: u32
 *   [16..19] parentPage: u32
 *   [20..23] flags: u32
 *   [24..31] lsn: u64 (log sequence number for crash recovery)
 *
 * Entry Layout (16 bytes):
 *   Leaf Entry:
 *     [0..3]   sId: u32
 *     [4..7]   pId: u32
 *     [8..11]  oId: u32
 *     [12..13] axiomType: u16
 *     [14..15] flags: u16
 *
 *   Internal Entry:
 *     [0..3]   sId: u32
 *     [4..7]   pId: u32
 *     [8..11]  oId: u32
 *     [12..15] childPageId: u32
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
   * Compares an entry at entryIdx with key (s, p, o).
   * Returns:
   *   -1 if entry < key
   *    0 if entry == key
   *    1 if entry > key
   */
  @inline static compareKey(pagePtr: usize, entryIdx: u32, s: u32, p: u32, o: u32): i32 {
    let es = BTreePage.getEntryS(pagePtr, entryIdx);
    if (es < s) return -1;
    if (es > s) return 1;

    let ep = BTreePage.getEntryP(pagePtr, entryIdx);
    if (ep < p) return -1;
    if (ep > p) return 1;

    let eo = BTreePage.getEntryO(pagePtr, entryIdx);
    if (eo < o) return -1;
    if (eo > o) return 1;

    return 0;
  }

  /**
   * Binary search for key (s, p, o) within a page.
   * Returns exact index if found, or bitwise complement (~insertIdx) if not found.
   */
  static binarySearch(pagePtr: usize, s: u32, p: u32, o: u32): i32 {
    let low: i32 = 0;
    let high: i32 = (BTreePage.getItemCount(pagePtr) as i32) - 1;

    while (low <= high) {
      let mid = (low + high) >> 1;
      let cmp = BTreePage.compareKey(pagePtr, mid as u32, s, p, o);
      if (cmp < 0) {
        low = mid + 1;
      } else if (cmp > 0) {
        high = mid - 1;
      } else {
        return mid;
      }
    }
    return ~low;
  }

  /**
   * Initializes a brand-new page.
   */
  static initPage(pagePtr: usize, pageId: u32, pageType: u16): void {
    memory.fill(pagePtr, 0, PAGE_SIZE);
    BTreePage.setPageId(pagePtr, pageId);
    BTreePage.setPageType(pagePtr, pageType);
    BTreePage.setItemCount(pagePtr, 0);
    BTreePage.setPrevPage(pagePtr, 0);
    BTreePage.setNextPage(pagePtr, 0);
    BTreePage.setParentPage(pagePtr, 0);
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
  pageToFrame: UnmanagedMap64; // pageId -> frameIdx + 1 (0 means not in pool)

  numFrames: u32;
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
    this.clockHand = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.nextAllocPageId = 1; // 1-indexed (0 reserved for null)
    this.isHostIOEnabled = false;

    this.frames = atomicChunkAlloc(numFrames * 16) as usize;
    this.pageToFrame = changetype<UnmanagedMap64>(createMap64(numFrames * 2));

    this.virtualDiskCapacity = 1024;
    this.virtualDiskPages = atomicChunkAlloc(this.virtualDiskCapacity * sizeof<usize>()) as usize;
    this.exchangeBuffer = atomicChunkAlloc(PAGE_SIZE) as usize;
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
    let val = this.pageToFrame.get(pageId as u64);
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
    let val = this.pageToFrame.get(pageId as u64);
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
    if (pageId >= 0x7fffffff) return;
    if (pageId >= this.virtualDiskCapacity) {
      let newCap = this.virtualDiskCapacity * 2;
      while (newCap <= pageId) newCap *= 2;
      let newPtr = atomicChunkAlloc(newCap * sizeof<usize>()) as usize;
      if (newPtr != 0) {
        memory.copy(newPtr, this.virtualDiskPages, this.virtualDiskCapacity * sizeof<usize>());
        // Zero-fill extended capacity
        let addedBytes = (newCap - this.virtualDiskCapacity) * sizeof<usize>();
        memory.fill(newPtr + (this.virtualDiskCapacity * sizeof<usize>()), 0, addedBytes);
        this.virtualDiskPages = newPtr;
        this.virtualDiskCapacity = newCap;
      }
    }
    if (pageId < this.virtualDiskCapacity) {
      store<usize>(this.virtualDiskPages + (pageId * sizeof<usize>()), ptr);
    }
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
   * Allocates a new unique pageId and initializes a fresh page in the buffer pool.
   */
  allocateNewPage(pageType: u16): u32 {
    let pageId = this.nextAllocPageId++;
    let frameIdx = this._findVictimFrame();
    this._loadNewPageIntoFrame(frameIdx, pageId, pageType);
    this._writeFrameToDisk(frameIdx, pageId);
    return pageId;
  }

  /**
   * Fetches a page into the buffer pool. Marks it active and returns its memory address.
   */
  fetchPage(pageId: u32): usize {
    if (pageId == 0) return 0;

    // 1. Check if page is already cached in buffer pool
    let val = this.pageToFrame.get(pageId as u64);
    if (val > 0) {
      let fIdx = val - 1;
      if (fIdx < this.numFrames) {
        this.setFrameRef(fIdx, 1);
        this.cacheHits++;
        return this.getFramePtr(fIdx);
      }
    }

    // 2. Cache miss: find a victim frame to evict
    this.cacheMisses++;
    let victimIdx = this._findVictimFrame();
    this._readDiskPageIntoFrame(victimIdx, pageId);
    return this.getFramePtr(victimIdx);
  }

  /**
   * Marks a page as dirty so it will be flushed to disk upon eviction.
   */
  markDirty(pageId: u32): void {
    let val = this.pageToFrame.get(pageId as u64);
    if (val > 0) {
      let fIdx = val - 1;
      if (fIdx < this.numFrames) {
        this.setFrameDirty(fIdx, 1);
      }
    }
  }

  /**
   * Flushes all dirty frames to backing storage.
   */
  flushAll(): u32 {
    let flushedCount: u32 = 0;
    for (let f: u32 = 0; f < this.numFrames; f++) {
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
    let count: u32 = 0;
    let maxSweeps = this.numFrames * 2;

    while (count < maxSweeps) {
      let f = this.clockHand;
      this.clockHand = (this.clockHand + 1) % this.numFrames;

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
            this.pageToFrame.set(oldPageId as u64, 0);
          }
          return f;
        }
      }
      count++;
    }

    return 0; // Fallback to frame 0 if all are pinned
  }

  private _loadNewPageIntoFrame(fIdx: u32, pageId: u32, pageType: u16): void {
    let ptr = this.getFramePtr(fIdx);
    BTreePage.initPage(ptr, pageId, pageType);

    this.setFramePageId(fIdx, pageId);
    this.setFrameDirty(fIdx, 1);
    this.setFramePin(fIdx, 0);
    this.setFrameRef(fIdx, 1);
    this.pageToFrame.set(pageId as u64, fIdx + 1);
  }

  private _readDiskPageIntoFrame(fIdx: u32, pageId: u32): void {
    let framePtr = this.getFramePtr(fIdx);

    // Read from Virtual Disk
    let diskPtr = this.getVirtualDiskPage(pageId);
    if (diskPtr != 0) {
      memory.copy(framePtr, diskPtr, PAGE_SIZE);
    } else {
      // Unallocated page: initialize as empty leaf
      BTreePage.initPage(framePtr, pageId, PAGE_TYPE_LEAF);
    }

    this.setFramePageId(fIdx, pageId);
    this.setFrameDirty(fIdx, 0);
    this.setFramePin(fIdx, 0);
    this.setFrameRef(fIdx, 1);
    this.pageToFrame.set(pageId as u64, fIdx + 1);
  }

  private _writeFrameToDisk(fIdx: u32, pageId: u32): void {
    if (pageId == 0 || pageId >= 0x7fffffff || fIdx >= this.numFrames) return;
    let framePtr = this.getFramePtr(fIdx);

    let diskPtr = this.getVirtualDiskPage(pageId);
    if (diskPtr == 0) {
      diskPtr = atomicChunkAlloc(PAGE_SIZE) as usize;
      this.setVirtualDiskPage(pageId, diskPtr);
    }
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
 * Provides logarithmic disk/page lookups across 1 Billion+ facts.
 */
@unmanaged
export class PagedBTreeStore {
  bufferPool: BufferPool;
  rootPageId: u32;
  totalTriples: u32;

  init(numFrames: u32 = 256): void {
    let bpPtr = atomicChunkAlloc(offsetof<BufferPool>()) as usize;
    this.bufferPool = changetype<BufferPool>(bpPtr);
    this.bufferPool.init(numFrames);


    // Create root leaf page (Page 1)
    this.rootPageId = this.bufferPool.allocateNewPage(PAGE_TYPE_LEAF);
    this.totalTriples = 0;
  }

  /**
   * Inserts an asserted or inferred triple into the paged B+Tree.
   */
  insert(s: u32, p: u32, o: u32, axiomType: u16 = 0, flags: u16 = 0): u32 {
    let leafPageId = this._findLeafPage(this.rootPageId, s, p, o);
    let leafPtr = this.bufferPool.fetchPage(leafPageId);
    this.bufferPool.pinPage(leafPageId);

    let idx = BTreePage.binarySearch(leafPtr, s, p, o);
    if (idx >= 0) {
      // Triple already present: update type and flags
      BTreePage.setEntryType(leafPtr, idx as u32, axiomType);
      BTreePage.setEntryFlags(leafPtr, idx as u32, flags);
      this.bufferPool.markDirty(leafPageId);
      this.bufferPool.unpinPage(leafPageId);
      return 1;
    }

    let insertIdx = (~idx) as u32;
    let count = BTreePage.getItemCount(leafPtr);

    if ((count as u32) < MAX_ENTRIES_PER_LEAF) {
      // Page has space: shift entries right and insert
      for (let i = (count as u32); i > insertIdx; i--) {
        let srcOffset = BTreePage.getEntryOffset(i - 1);
        let dstOffset = BTreePage.getEntryOffset(i);
        memory.copy(leafPtr + dstOffset, leafPtr + srcOffset, ENTRY_SIZE);
      }

      BTreePage.setEntryS(leafPtr, insertIdx, s);
      BTreePage.setEntryP(leafPtr, insertIdx, p);
      BTreePage.setEntryO(leafPtr, insertIdx, o);
      BTreePage.setEntryType(leafPtr, insertIdx, axiomType);
      BTreePage.setEntryFlags(leafPtr, insertIdx, flags);
      BTreePage.setItemCount(leafPtr, count + 1);

      this.bufferPool.markDirty(leafPageId);
      this.bufferPool.unpinPage(leafPageId);
      this.totalTriples++;
      return 1;
    }

    // Page full: split leaf page
    this._splitLeafPage(leafPageId, leafPtr, s, p, o, axiomType, flags);
    this.bufferPool.unpinPage(leafPageId);
    this.totalTriples++;
    return 1;


  }

  /**
   * Finds matching triples in the B+Tree and writes them to outBuffer.
   * Wildcards are represented by 0 or 0xffffffff.
   */
  find(s: u32, p: u32, o: u32, outBuffer: ChunkedUint32Array): u32 {
    let matchCount: u32 = 0;
    let sWild = s == 0 || s == 0xffffffff;
    let pWild = p == 0 || p == 0xffffffff;
    let oWild = o == 0 || o == 0xffffffff;

    let startS = sWild ? 0 : s;
    let startP = pWild ? 0 : p;
    let startO = oWild ? 0 : o;

    // Navigate to candidate start leaf
    let currPageId: u32 = 0;
    if (sWild) {
      let currId = this.rootPageId;
      while (currId != 0) {
        let pagePtr = this.bufferPool.fetchPage(currId);
        if (BTreePage.getPageType(pagePtr) == PAGE_TYPE_LEAF) {
          currPageId = currId;
          break;
        }
        currId = BTreePage.getPrevPage(pagePtr); // child 0 is leftmost child
      }
    } else {
      currPageId = this._findLeafPage(this.rootPageId, startS, startP, startO);
    }

    while (currPageId != 0) {
      let pagePtr = this.bufferPool.fetchPage(currPageId);
      this.bufferPool.pinPage(currPageId);
      let count = BTreePage.getItemCount(pagePtr) as u32;

      for (let i: u32 = 0; i < count; i++) {
        let es = BTreePage.getEntryS(pagePtr, i);
        let ep = BTreePage.getEntryP(pagePtr, i);
        let eo = BTreePage.getEntryO(pagePtr, i);

        // Early termination if subject exceeds bound pattern
        if (!sWild && es > s) {
          this.bufferPool.unpinPage(currPageId);
          return matchCount;
        }

        let sMatch = sWild || es == s;
        let pMatch = pWild || ep == p;
        let oMatch = oWild || eo == o;

        if (sMatch && pMatch && oMatch) {
          outBuffer.push(es);
          outBuffer.push(ep);
          outBuffer.push(eo);
          outBuffer.push(BTreePage.getEntryType(pagePtr, i) as u32);
          outBuffer.push(BTreePage.getEntryFlags(pagePtr, i) as u32);
          matchCount++;
        }
      }

      let next = BTreePage.getNextPage(pagePtr);
      this.bufferPool.unpinPage(currPageId);
      currPageId = next;
    }

    return matchCount;
  }

  // ---------------------------------------------------------------------------
  // Internal B+Tree Traversal & Node Splitting
  // ---------------------------------------------------------------------------

  private _findLeafPage(pageId: u32, s: u32, p: u32, o: u32): u32 {
    let currId = pageId;

    while (currId != 0) {
      let pagePtr = this.bufferPool.fetchPage(currId);
      let pType = BTreePage.getPageType(pagePtr);

      if (pType == PAGE_TYPE_LEAF) {
        return currId;
      }

      // Internal page: binary search to find next child branch
      let idx = BTreePage.binarySearch(pagePtr, s, p, o);
      if (idx >= 0) {
        currId = BTreePage.getChildPageId(pagePtr, idx as u32);
      } else {
        let insertIdx = (~idx) as u32;
        if (insertIdx == 0) {
          currId = BTreePage.getPrevPage(pagePtr); // child 0
        } else {
          currId = BTreePage.getChildPageId(pagePtr, insertIdx - 1);
        }
      }
    }

    return 1;
  }



  private _splitLeafPage(
    leafPageId: u32,
    leafPtr: usize,
    s: u32, p: u32, o: u32,
    axiomType: u16, flags: u16
  ): void {
    let newLeafId = this.bufferPool.allocateNewPage(PAGE_TYPE_LEAF);
    this.bufferPool.pinPage(newLeafId);
    let newLeafPtr = this.bufferPool.fetchPage(newLeafId);

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
      BTreePage.setPrevPage(nextPtr, newLeafId);
      this.bufferPool.markDirty(oldNext);
      this.bufferPool.unpinPage(oldNext);
    }

    // Insert pending triple into appropriate split leaf
    let firstNewS = BTreePage.getEntryS(newLeafPtr, 0);
    let firstNewP = BTreePage.getEntryP(newLeafPtr, 0);
    let firstNewO = BTreePage.getEntryO(newLeafPtr, 0);

    let targetPageId = (s < firstNewS || (s == firstNewS && p < firstNewP) || (s == firstNewS && p == firstNewP && o < firstNewO))
      ? leafPageId
      : newLeafId;

    let targetPtr = this.bufferPool.fetchPage(targetPageId);
    let tIdx = BTreePage.binarySearch(targetPtr, s, p, o);
    let insertIdx = (~tIdx) as u32;
    let tCount = BTreePage.getItemCount(targetPtr);

    for (let i = (tCount as u32); i > insertIdx; i--) {
      let srcOffset = BTreePage.getEntryOffset(i - 1);
      let dstOffset = BTreePage.getEntryOffset(i);
      memory.copy(targetPtr + dstOffset, targetPtr + srcOffset, ENTRY_SIZE);
    }
    BTreePage.setEntryS(targetPtr, insertIdx, s);
    BTreePage.setEntryP(targetPtr, insertIdx, p);
    BTreePage.setEntryO(targetPtr, insertIdx, o);
    BTreePage.setEntryType(targetPtr, insertIdx, axiomType);
    BTreePage.setEntryFlags(targetPtr, insertIdx, flags);
    BTreePage.setItemCount(targetPtr, tCount + 1);

    this.bufferPool.markDirty(leafPageId);
    this.bufferPool.markDirty(newLeafId);

    // Promote first key of right leaf into parent
    let pivotS = BTreePage.getEntryS(newLeafPtr, 0);
    let pivotP = BTreePage.getEntryP(newLeafPtr, 0);
    let pivotO = BTreePage.getEntryO(newLeafPtr, 0);
    this._insertIntoParent(leafPageId, pivotS, pivotP, pivotO, newLeafId);

    this.bufferPool.unpinPage(newLeafId);
  }

  private _insertIntoParent(leftPageId: u32, pivotS: u32, pivotP: u32, pivotO: u32, rightPageId: u32): void {
    let leftPtr = this.bufferPool.fetchPage(leftPageId);
    let parentId = BTreePage.getParentPage(leftPtr);

    if (parentId == 0) {
      // Left was root: allocate new internal root
      let newRootId = this.bufferPool.allocateNewPage(PAGE_TYPE_INTERNAL);
      this.bufferPool.pinPage(newRootId);
      let newRootPtr = this.bufferPool.fetchPage(newRootId);

      BTreePage.setEntryS(newRootPtr, 0, pivotS);
      BTreePage.setEntryP(newRootPtr, 0, pivotP);
      BTreePage.setEntryO(newRootPtr, 0, pivotO);
      BTreePage.setPrevPage(newRootPtr, leftPageId); // child 0
      BTreePage.setChildPageId(newRootPtr, 0, rightPageId); // child 1
      BTreePage.setItemCount(newRootPtr, 1);

      BTreePage.setParentPage(leftPtr, newRootId);
      let rightPtr = this.bufferPool.fetchPage(rightPageId);
      BTreePage.setParentPage(rightPtr, newRootId);

      this.rootPageId = newRootId;
      this.bufferPool.markDirty(newRootId);
      this.bufferPool.markDirty(leftPageId);
      this.bufferPool.markDirty(rightPageId);
      this.bufferPool.unpinPage(newRootId);
      return;
    }

    // Insert into existing parent
    let parentPtr = this.bufferPool.fetchPage(parentId);
    this.bufferPool.pinPage(parentId);
    let count = BTreePage.getItemCount(parentPtr) as u32;

    if (count < MAX_ENTRIES_PER_INTERNAL) {
      let idx = BTreePage.binarySearch(parentPtr, pivotS, pivotP, pivotO);
      let insIdx = (idx >= 0 ? (idx + 1) : (~idx)) as u32;

      for (let i = count; i > insIdx; i--) {
        let srcOffset = BTreePage.getEntryOffset(i - 1);
        let dstOffset = BTreePage.getEntryOffset(i);
        memory.copy(parentPtr + dstOffset, parentPtr + srcOffset, ENTRY_SIZE);
      }

      BTreePage.setEntryS(parentPtr, insIdx, pivotS);
      BTreePage.setEntryP(parentPtr, insIdx, pivotP);
      BTreePage.setEntryO(parentPtr, insIdx, pivotO);
      BTreePage.setChildPageId(parentPtr, insIdx, rightPageId);
      BTreePage.setItemCount(parentPtr, (count + 1) as u16);

      let rightPtr = this.bufferPool.fetchPage(rightPageId);
      BTreePage.setParentPage(rightPtr, parentId);

      this.bufferPool.markDirty(parentId);
      this.bufferPool.markDirty(rightPageId);
      this.bufferPool.unpinPage(parentId);
      return;
    }

    // Parent is full: split internal node
    this._splitInternalPage(parentId, parentPtr, pivotS, pivotP, pivotO, rightPageId);
    this.bufferPool.unpinPage(parentId);
  }

  private _splitInternalPage(
    parentPageId: u32,
    parentPtr: usize,
    pivotS: u32, pivotP: u32, pivotO: u32,
    rightChildId: u32
  ): void {
    let newInternalId = this.bufferPool.allocateNewPage(PAGE_TYPE_INTERNAL);
    this.bufferPool.pinPage(newInternalId);
    let newInternalPtr = this.bufferPool.fetchPage(newInternalId);

    let count = BTreePage.getItemCount(parentPtr) as u32;
    let mid = count >> 1;

    let promotedS = BTreePage.getEntryS(parentPtr, mid);
    let promotedP = BTreePage.getEntryP(parentPtr, mid);
    let promotedO = BTreePage.getEntryO(parentPtr, mid);
    let newChild0 = BTreePage.getChildPageId(parentPtr, mid);
    BTreePage.setPrevPage(newInternalPtr, newChild0);

    let newCount: u16 = 0;
    for (let i = mid + 1; i < count; i++) {
      let srcOffset = BTreePage.getEntryOffset(i);
      let dstOffset = BTreePage.getEntryOffset(newCount as u32);
      memory.copy(newInternalPtr + dstOffset, parentPtr + srcOffset, ENTRY_SIZE);
      let cId = BTreePage.getChildPageId(newInternalPtr, newCount as u32);
      let cPtr = this.bufferPool.fetchPage(cId);
      BTreePage.setParentPage(cPtr, newInternalId);
      this.bufferPool.markDirty(cId);
      newCount++;
    }

    let c0Ptr = this.bufferPool.fetchPage(newChild0);
    BTreePage.setParentPage(c0Ptr, newInternalId);
    this.bufferPool.markDirty(newChild0);

    BTreePage.setItemCount(parentPtr, mid as u16);
    BTreePage.setItemCount(newInternalPtr, newCount);

    let isLeft = (pivotS < promotedS || (pivotS == promotedS && pivotP < promotedP) || (pivotS == promotedS && pivotP == promotedP && pivotO < promotedO));
    let targetPageId = isLeft ? parentPageId : newInternalId;
    let targetPtr = isLeft ? parentPtr : newInternalPtr;
    let tCount = BTreePage.getItemCount(targetPtr) as u32;
    let idx = BTreePage.binarySearch(targetPtr, pivotS, pivotP, pivotO);
    let insIdx = (idx >= 0 ? (idx + 1) : (~idx)) as u32;

    for (let i = tCount; i > insIdx; i--) {
      let srcOffset = BTreePage.getEntryOffset(i - 1);
      let dstOffset = BTreePage.getEntryOffset(i);
      memory.copy(targetPtr + dstOffset, targetPtr + srcOffset, ENTRY_SIZE);
    }
    BTreePage.setEntryS(targetPtr, insIdx, pivotS);
    BTreePage.setEntryP(targetPtr, insIdx, pivotP);
    BTreePage.setEntryO(targetPtr, insIdx, pivotO);
    BTreePage.setChildPageId(targetPtr, insIdx, rightChildId);
    BTreePage.setItemCount(targetPtr, (tCount + 1) as u16);

    let rcPtr = this.bufferPool.fetchPage(rightChildId);
    BTreePage.setParentPage(rcPtr, targetPageId);
    this.bufferPool.markDirty(rightChildId);

    this.bufferPool.markDirty(parentPageId);
    this.bufferPool.markDirty(newInternalId);
    this.bufferPool.unpinPage(newInternalId);

    this._insertIntoParent(parentPageId, promotedS, promotedP, promotedO, newInternalId);
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

export function paged_getBufferPoolHitRate(): f32 {
  if (g_pagedStore == null) return 1.0;
  return g_pagedStore!.bufferPool.getHitRate();
}
