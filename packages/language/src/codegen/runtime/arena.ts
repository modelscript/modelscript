/* eslint-disable */
// @ts-nocheck
// @ts-ignore

import {
  ChunkedArray, ChunkedUint8Array, ChunkedUint32Array, ChunkedFloat64Array, ChunkedInt32Array
} from "./array";
import { inputEncoding } from "./parser";

/**
 * Arena Allocator for AST Nodes (Persistent / Structural Sharing)
 *
 * Provides a zero-GC, thread-safe linear memory allocator for Abstract Syntax Tree (AST) nodes.
 * Each AST node is allocated a fixed size of 16 bytes.
 *
 * Node Memory Layout:
 * offset + 0:  type (10 bits) | flags (6 bits) | paddingLength (16 bits)
 * offset + 4:  byteLength (24 bits) | envHash (8 bits)
 * offset + 8:  firstChild (u32, arena ptr)
 * offset + 12: nextSibling (u32, arena ptr)
 */

const NODE_SIZE: u32 = 16;
const GLOBAL_BUMP_PTR: usize = 0;

@unmanaged
export class ASTNode {
  word0: u32;
  word1: u32;
  firstChild: u32;
  nextSibling: u32;

  @inline get type(): u16 { return (this.word0 & 0x03ff) as u16; }
  @inline set type(t: u16) { this.word0 = (this.word0 & ~0x03ff) | (t as u32 & 0x03ff); }

  @inline get flags(): u16 { return ((this.word0 >> 10) & 0xff) as u16; }
  @inline set flags(f: u16) { this.word0 = (this.word0 & ~(0xff << 10)) | ((f as u32 & 0xff) << 10); }

  @inline get paddingLength(): u32 { return this.word0 >> 18; }
  @inline set paddingLength(pad: u32) { this.word0 = (this.word0 & 0x0003ffff) | (pad << 18); }

  @inline get byteLength(): u32 { return this.word1 & 0x007fffff; }
  @inline set byteLength(len: u32) { this.word1 = (this.word1 & 0xff800000) | (len & 0x007fffff); }

  @inline get isFatPadding(): boolean { return ((this.word1 >> 23) & 1) == 1; }
  @inline set isFatPadding(val: boolean) {
    if (val) this.word1 |= (1 << 23);
    else this.word1 &= ~(1 << 23);
  }

  @inline get envHash(): u32 { return this.word1 >> 24; }
  @inline set envHash(hash: u32) { this.word1 = (this.word1 & ~(0xff << 24)) | ((hash & 0xff) << 24); }
}

/**
 * Gen 2 / Static / Input Buffer
 * This buffer stores the raw source code text. It must match INPUT_BUFFER_SIZE in arena_layout.ts.
 */
const INPUT_BUFFER_SIZE = 4 * 1024 * 1024;
/* moved S().arenaBuffer to state */
/* moved S().currentInputBufferSize to state */

/**
 * The chunk size for incremental AST node allocation.
 * Memory is requested from the linear memory in chunks of this size.
 */
const AST_CHUNK_SIZE: u32 = 256 * 1024; // 256 KB incremental chunks

/**
 * Shared State Header
 * We allocate a fixed struct at __heap_base + 4 so that ALL worker threads
 * in the ParserThreadPool share the EXACT same parser state via SharedArrayBuffer.
 * This prevents isolation of WASM globals across multiple threads.
 */
@unmanaged
class SharedState {
  gen1_chunks: u32;
  gen1_chunk_count: u32;
  gen1_active_chunk: u32;
  gen1_offset: u32;
  gen1_endLimit: u32;
  arenaOffset: u32;
  gen0_chunks: u32;
  gen0_chunk_count: u32;
  gen0_active_chunk: u32;
  gen0_offset: u32;
  gen0_endLimit: u32;
  activeGeneration: u8;
  allocCount: u32;
  freeNodeHead: u32;
  fatPaddingArenaPtr: u32;
  fatPaddingCount: u32;
  arenaBuffer: u32;
  currentInputBufferSize: u32;
  activeRootCount: u32;
  activeRootsPtr: u32;
  gcStackPtr: u32;
  gcStackCapacity: u32;
  allocLock: u32; // Used for thread-safe spinlocking during chunk rollovers
}

const shared_state_ptr = memory.data<u32>([0]);

/**
 * Retrieves the shared cross-worker memory state.
 * Thread-safe initialization using an atomic compare-and-exchange lock.
 */
export function S(): SharedState {
  let ptrLocation = changetype<usize>(shared_state_ptr);
  let ptr = atomic.load<u32>(ptrLocation);
  if (ptr == 0) {
    let newPtr = atomicChunkAlloc(256); // Allocate 256 bytes for global state
    memory.fill(newPtr as usize, 0, 256);
    let old = atomic.cmpxchg<u32>(ptrLocation, 0, newPtr);
    if (old != 0) return changetype<SharedState>(old);

    let state = changetype<SharedState>(newPtr);
    state.currentInputBufferSize = INPUT_BUFFER_SIZE;
    state.arenaBuffer = atomicChunkAlloc(state.currentInputBufferSize);
    state.gen1_chunks = atomicChunkAlloc(8192 * 4);
    state.gen1_chunk_count = 1;
    store<u32>(state.gen1_chunks, atomicChunkAlloc(AST_CHUNK_SIZE));

    state.gen0_chunks = atomicChunkAlloc(8192 * 4);
    state.gen0_chunk_count = 1;
    store<u32>(state.gen0_chunks, atomicChunkAlloc(AST_CHUNK_SIZE));

    state.activeGeneration = 1;
    state.activeRootsPtr = atomicChunkAlloc(100 * 4); // Up to 100 roots
    return state;
  }
  return changetype<SharedState>(ptr);
}

/**
 * Atomically allocates a chunk of linear memory.
 * This allocator guarantees thread-safety when multiple WASM workers allocate memory
 * from the SharedArrayBuffer. Memory is aligned to 16 bytes.
 *
 * @param size The requested allocation size in bytes.
 * @returns A pointer to the newly allocated memory chunk.
 */

export function atomicChunkAlloc(size: u32): u32 {
  // Use the unmanaged heap allocator for zero-GC memory allocation
  // Allocate an extra 16 bytes to guarantee we can 16-byte align the pointer
  let ptr = heap.alloc(size + 16);

  // Ensure 16-byte alignment
  let rem = ptr % 16;
  if (rem != 0) ptr += 16 - rem;

  return ptr as u32;
}

/**
 * Sets the active generation for subsequent allocations.
 * Generation 1 is persistent, generation 0 is transient.
 * @param gen The generation to activate (0 or 1).
 */
export function setActiveGeneration(gen: u8): void {
  S().activeGeneration = gen;
}

/**
 * Resets a specific memory generation, clearing all allocated chunks
 * and resetting the offset back to the beginning of the generation.
 * @param gen The generation to reset (0 or 1).
 */
export function resetGeneration(gen: u8): void {
  if (gen == 1) {
    S().freeNodeHead = 0; // Clear free list to prevent handing out old pointers after reset
    S().fatPaddingCount = 0; // Reset fat padding arena on full re-parse
    if (S().gen1_chunk_count > 0) {
      S().gen1_active_chunk = 0;
      let startOffset = load<u32>(S().gen1_chunks);
      let usedBytes = S().gen1_offset - startOffset;
      S().gen1_offset = startOffset;
      S().arenaOffset = S().gen1_offset;
      S().gen1_endLimit = S().gen1_offset + AST_CHUNK_SIZE;
      if (usedBytes > 0) {
        memory.fill(S().gen1_offset as usize, 0, usedBytes as usize);
      }
    }
  } else if (gen == 0) {
    if (S().gen0_chunk_count > 0) {
      S().gen0_active_chunk = 0;
      let startOffset = load<u32>(S().gen0_chunks);
      let usedBytes = S().gen0_offset - startOffset;
      S().gen0_offset = startOffset;
      S().gen0_endLimit = S().gen0_offset + AST_CHUNK_SIZE;
      if (usedBytes > 0) {
        memory.fill(S().gen0_offset as usize, 0, usedBytes as usize);
      }
    }
  }
}

/**
 * Ensures the input buffer can accommodate the provided source code size.
 * Reallocates a new buffer block if the current one is too small.
 * @param size The size of the incoming source code in bytes.
 * @returns The pointer to the start of the usable input buffer.
 */
export function ensureInputBuffer(size: u32): usize {
  // Allow an extra 64 bytes of leading overhead so the usable region starts at
  // a cache-line-aligned offset, keeping metadata out of the hot input path.
  if (size + 64 > S().currentInputBufferSize) {
    S().currentInputBufferSize = size + 64;
    S().arenaBuffer = atomicChunkAlloc(S().currentInputBufferSize);
  }
  return S().arenaBuffer + 64;
}

/**
 * Retrieves the memory pointer where the input source text is stored.
 * The +64 offset reserves a leading cache-line for internal arena metadata,
 * ensuring the usable input region does not alias with allocator bookkeeping.
 * @returns The pointer to the usable region of the input buffer.
 */
export function getInputBuffer(): usize {
  return S().arenaBuffer + 64;
}

/**
 * Retrieves the starting pointer of the primary (persistent) AST generation.
 * @returns The base pointer of Generation 1.
 */
export function getNodeArenaStart(): u32 {
  return S().gen1_chunk_count > 0 ? load<u32>(S().gen1_chunks) : 0;
}

// ----------------------------------------------------------------------------
// Fat Padding Storage
// ----------------------------------------------------------------------------

/** Pointer to the arena used for storing values that exceed the 16-bit inline padding limit. */
/* moved S().fatPaddingArenaPtr to state */
let fatPaddingCapacity: u32 = 100000; // Grows dynamically if exhausted
/** The number of active fat padding slots currently utilized. */
/* moved S().fatPaddingCount to state */

/**
 * Initializes the fat padding arena if it hasn't been set up yet.
 * Fat padding holds large offsets or 64-bit literals that don't fit inside a standard 16-byte AST node.
 */
function ensureFatPaddingArena(): void {
  if (S().fatPaddingArenaPtr == 0) {
    S().fatPaddingArenaPtr = atomicChunkAlloc(fatPaddingCapacity * 4);
    memory.fill(S().fatPaddingArenaPtr as usize, 0, fatPaddingCapacity * 4);
  }
}

/**
 * Returns a pointer to a fat padding slot.
 * Primarily used by the evaluator to read f64 literal values (8 bytes per slot).
 *
 * Note: The regular padding allocator in allocNode() uses 4-byte (u32) slots,
 * while the evaluator co-opts fat padding slots for 8-byte (f64) literal storage.
 * Both use cases share the same linear arena but access it at different byte granularities.
 * @param idx The fat padding index.
 * @returns The physical memory pointer to the 8-byte padding/literal slot.
 */
export function getFatPaddingPtr(idx: u32): usize {
  return S().fatPaddingArenaPtr + (idx << 3); // 8 bytes per f64 literal slot
}

/**
 * Bootstraps the allocator, establishing initial chunks for Generation 0 and Generation 1.
 * @param sizeBytes Expected initial size (unused currently).
 */
export function initArena(sizeBytes: u32): void {
  let s = S();
  s.gen1_chunks = atomicChunkAlloc(8192 * 4); // Metadata array: up to 8192 chunks
  s.gen0_chunks = atomicChunkAlloc(8192 * 4);

  // Initialize first chunk for Generation 1 (Persistent)
  let chunk1 = atomicChunkAlloc(AST_CHUNK_SIZE);
  store<u32>(s.gen1_chunks, chunk1);
  s.gen1_chunk_count = 1;
  s.gen1_active_chunk = 0;
  s.gen1_offset = chunk1;
  s.gen1_endLimit = chunk1 + AST_CHUNK_SIZE;

  // Initialize first chunk for Generation 0 (Transient)
  let chunk0 = atomicChunkAlloc(AST_CHUNK_SIZE);
  store<u32>(s.gen0_chunks, chunk0);
  s.gen0_chunk_count = 1;
  s.gen0_active_chunk = 0;
  s.gen0_offset = chunk0;
  s.gen0_endLimit = chunk0 + AST_CHUNK_SIZE;

  s.activeGeneration = 1;
  s.arenaOffset = s.gen1_offset;

  // Eagerly initialize fat padding arena (avoids per-allocNode null check)
  ensureFatPaddingArena();
}

/**
 * Allocates a new AST node directly in linear memory.
 * Implements structural sharing by attempting to pop a reclaimed node from the free-list first.
 * If the free-list is empty, it uses the fast bump-allocator for the active generation.
 *
 * @param type The grammar production type ID.
 * @param paddingLength The byte offset/padding prior to this node in the source.
 * @param byteLength The total length of the source text spanning this node.
 * @param envHash A structural hash used for rapid comparison and deduplication.
 * @returns A physical memory pointer (u32) to the newly allocated 16-byte node.
 */
export function allocNode(type: u16, paddingLength: u32, byteLength: u32, envHash: u32): u32 {
  let s = S();
  s.allocCount++;
  let ptr: u32 = 0;

  // 1. Attempt to reclaim memory from the free list (structural sharing)
  if (s.freeNodeHead != 0) {
    ptr = s.freeNodeHead;
    s.freeNodeHead = load<u32>(ptr + 8, 0); // The 'firstChild' slot is overloaded as the 'next' pointer
  } else {
    // 2. Perform atomic bump allocation in the currently active generation
    let ptrLoc: usize =
      changetype<usize>(s) +
      (s.activeGeneration == 0 ? offsetof<SharedState>("gen0_offset") : offsetof<SharedState>("gen1_offset"));
    let endLimit = s.activeGeneration == 0 ? s.gen0_endLimit : s.gen1_endLimit;

    // Atomically claim a 16-byte slot (guaranteed 16-byte aligned by chunk allocators)
    ptr = atomic.add<u32>(ptrLoc, NODE_SIZE);

    // 3. Request a new chunk if the claimed slot exceeds the current chunk boundary
    if (ptr + NODE_SIZE > endLimit) {
      let isGen0 = s.activeGeneration == 0;
      let lockLoc = changetype<usize>(s) + offsetof<SharedState>("allocLock");
      
      // 3.1 Acquire spinlock to safely handle the rollover and prevent data corruption
      // If multiple threads exhaust the chunk concurrently, only one thread handles the reallocation.
      while (atomic.cmpxchg<u32>(lockLoc, 0, 1) != 0) { /* spin */ }
      
      // Re-read ptrLoc and endLimit inside the lock to check if another thread already rolled over
      let currentPtrLoc = atomic.load<u32>(ptrLoc);
      let currentEndLimit = isGen0 ? s.gen0_endLimit : s.gen1_endLimit;
      
      if (currentPtrLoc + NODE_SIZE > currentEndLimit) {
        // 3.2 Chunk is genuinely exhausted, we must allocate a new one
        let activeChunk = isGen0 ? s.gen0_active_chunk : s.gen1_active_chunk;
        let chunkCount = isGen0 ? s.gen0_chunk_count : s.gen1_chunk_count;

        let newChunk: u32 = 0;
        let usingRecycled = false;

        if (activeChunk + 1 < chunkCount) {
          let chunkArray = isGen0 ? s.gen0_chunks : s.gen1_chunks;
          newChunk = load<u32>(chunkArray + (activeChunk + 1) * 4);
          usingRecycled = true;
        } else {
          newChunk = atomicChunkAlloc(AST_CHUNK_SIZE);
        }

        if (isGen0) {
          s.gen0_active_chunk++;
          if (!usingRecycled && s.gen0_chunk_count < 8192) {
            store<u32>(s.gen0_chunks + s.gen0_chunk_count * 4, newChunk);
            s.gen0_chunk_count++;
          }
          s.gen0_endLimit = newChunk + AST_CHUNK_SIZE;
        } else {
          s.gen1_active_chunk++;
          if (!usingRecycled && s.gen1_chunk_count < 8192) {
            store<u32>(s.gen1_chunks + s.gen1_chunk_count * 4, newChunk);
            s.gen1_chunk_count++;
          }
          s.gen1_endLimit = newChunk + AST_CHUNK_SIZE;
        }
        atomic.store<u32>(ptrLoc, newChunk + NODE_SIZE);
        ptr = newChunk;
      } else {
        // 3.3 Another thread already rolled over the chunk while we were spinning.
        // The old `ptrLoc` is now pointing safely inside the NEW chunk. Claim a slot from it.
        ptr = atomic.add<u32>(ptrLoc, NODE_SIZE);
      }
      
      // 3.4 Release spinlock
      atomic.store<u32>(lockLoc, 0);
    }

    if (s.activeGeneration != 0) {
      s.arenaOffset = ptr + NODE_SIZE;
    }
  }

  // 4. Handle values that exceed the 16-bit inline padding limit
  // Fat padding arena is eagerly initialized in initArena(), no null check needed here
  let fatFlag: u32 = 0;
  if (paddingLength >= 0xffff) {
    if (s.fatPaddingCount >= fatPaddingCapacity) {
      // Grow the fat padding arena dynamically
      let newCapacity = fatPaddingCapacity * 2;
      let newPtr = atomicChunkAlloc(newCapacity * 4);
      memory.copy(newPtr, s.fatPaddingArenaPtr, fatPaddingCapacity * 4);
      s.fatPaddingArenaPtr = newPtr;
      fatPaddingCapacity = newCapacity;
    }
    store<u32>(s.fatPaddingArenaPtr + s.fatPaddingCount * 4, paddingLength, 0);
    paddingLength = s.fatPaddingCount;
    s.fatPaddingCount++;
    fatFlag = 1;
  }

  // 5. Clamp lengths to fit within bit-packed limits
  if (byteLength > 0x007fffff) byteLength = 0x007fffff;
  if (envHash > 255) envHash = 255;

  // 6. Assemble using the unmanaged wrapper
  let node = changetype<ASTNode>(ptr);
  node.word0 = (type as u32 & 0x03ff) | (paddingLength << 18);
  node.word1 = byteLength | (fatFlag << 23) | (envHash << 24);
  node.firstChild = 0;
  node.nextSibling = 0;

  return ptr;
}

/**
 * Allocates a raw buffer in the transient Generation 0 memory space.
 * Primarily used for strings, scratch arrays, and short-lived evaluator data.
 * The memory is 4-byte aligned.
 *
 * @param sizeBytes The requested allocation size in bytes.
 * @returns A physical memory pointer (u32) to the newly allocated transient space.
 */
export function allocGen0(sizeBytes: u32): u32 {
  // Ensure sizeBytes is 4-byte aligned to keep gen0_offset perfectly aligned at all times
  let rem = sizeBytes % 4;
  if (rem != 0) sizeBytes += 4 - rem;

  let ptrLoc: usize = changetype<usize>(S()) + offsetof<SharedState>("gen0_offset");

  // Atomically claim the size
  let ptr = atomic.add<u32>(ptrLoc, sizeBytes);

  // Request a new chunk if the current Gen0 chunk is exhausted
  if (ptr + sizeBytes > S().gen0_endLimit) {
    let lockLoc = changetype<usize>(S()) + offsetof<SharedState>("allocLock");
    
    // Acquire spinlock to handle rollover safely across threads
    while (atomic.cmpxchg<u32>(lockLoc, 0, 1) != 0) { /* spin */ }
    
    let currentPtrLoc = atomic.load<u32>(ptrLoc);
    
    if (currentPtrLoc + sizeBytes > S().gen0_endLimit) {
      let allocSize = sizeBytes > AST_CHUNK_SIZE ? sizeBytes : AST_CHUNK_SIZE;

      let activeChunk = S().gen0_active_chunk;
      let chunkCount = S().gen0_chunk_count;

      let newChunk: u32 = 0;
      let usingRecycled = false;

      if (activeChunk + 1 < chunkCount && allocSize <= AST_CHUNK_SIZE) {
        newChunk = load<u32>(S().gen0_chunks + (activeChunk + 1) * 4);
        usingRecycled = true;
      } else {
        newChunk = atomicChunkAlloc(allocSize);
      }

      S().gen0_active_chunk++;
      if (!usingRecycled && S().gen0_chunk_count < 8192) {
        store<u32>(S().gen0_chunks + S().gen0_chunk_count * 4, newChunk);
        S().gen0_chunk_count++;
      }
      S().gen0_endLimit = newChunk + allocSize;
      atomic.store<u32>(ptrLoc, newChunk + sizeBytes);
      ptr = newChunk;
    } else {
      // Another thread successfully rolled over the chunk. Grab a new slot.
      ptr = atomic.add<u32>(ptrLoc, sizeBytes);
    }
    
    atomic.store<u32>(lockLoc, 0); // Release spinlock
  }

  return ptr;
}

// ----------------------------------------------------------------------------
// AST Node Field Accessors (Legacy wrappers using @unmanaged ASTNode)
// ----------------------------------------------------------------------------

export const FLAG_GC_MARK: u16 = 1;
export const FLAG_EXTRACTED: u16 = 2;
export const FLAG_INVISIBLE: u16 = 4;
export const FLAG_LSP_VISITED: u16 = 8;
export const FLAG_DIRTY: u16 = 16;
export const FLAG_IS_LIST: u16 = 32;
export const FLAG_LIST_BOUNDARY: u16 = 64;

export function getNodeFlags(ptr: u32): u16 {
  return changetype<ASTNode>(ptr).flags;
}

export function setNodeFlags(ptr: u32, flags: u16): void {
  changetype<ASTNode>(ptr).flags = flags;
}

let saved_gen_offset: u32 = 0;
let saved_freeNodeHead: u32 = 0;
let saved_gen_active_chunk: u32 = 0;
let saved_gen_endLimit: u32 = 0;

export function checkpointMemory(): void {
  if (S().activeGeneration == 0) {
    saved_gen_offset = S().gen0_offset;
    saved_gen_active_chunk = S().gen0_active_chunk;
    saved_gen_endLimit = S().gen0_endLimit;
  } else {
    saved_gen_offset = S().gen1_offset;
    saved_gen_active_chunk = S().gen1_active_chunk;
    saved_gen_endLimit = S().gen1_endLimit;
  }
  saved_freeNodeHead = S().freeNodeHead;
}

export function rollbackMemory(): void {
  if (S().activeGeneration == 0) {
    S().gen0_offset = saved_gen_offset;
    S().gen0_active_chunk = saved_gen_active_chunk;
    S().gen0_endLimit = saved_gen_endLimit;
  } else {
    S().gen1_offset = saved_gen_offset;
    S().gen1_active_chunk = saved_gen_active_chunk;
    S().gen1_endLimit = saved_gen_endLimit;
  }
  S().freeNodeHead = saved_freeNodeHead;
}

export function markNode(ptr: u32): void {
  changetype<ASTNode>(ptr).flags |= FLAG_GC_MARK;
}
export function unmarkNode(ptr: u32): void {
  changetype<ASTNode>(ptr).flags &= ~FLAG_GC_MARK;
}
export function isNodeMarked(ptr: u32): boolean {
  return (changetype<ASTNode>(ptr).flags & FLAG_GC_MARK) != 0;
}

export function markExtracted(ptr: u32): void {
  changetype<ASTNode>(ptr).flags |= FLAG_EXTRACTED;
}
export function isExtracted(ptr: u32): boolean {
  return (changetype<ASTNode>(ptr).flags & FLAG_EXTRACTED) != 0;
}

export function markDirty(ptr: u32): void {
  changetype<ASTNode>(ptr).flags |= FLAG_DIRTY;
}
export function isDirty(ptr: u32): boolean {
  return (changetype<ASTNode>(ptr).flags & FLAG_DIRTY) != 0;
}

export function setFirstChild(parentPtr: u32, childPtr: u32): void {
  changetype<ASTNode>(parentPtr).firstChild = childPtr;
}

export function setNextSibling(siblingPtr: u32, nextPtr: u32): void {
  if (siblingPtr == 0) return;
  changetype<ASTNode>(siblingPtr).nextSibling = nextPtr;
}

export function getNodeType(ptr: u32): u16 {
  return changetype<ASTNode>(ptr).type;
}

export function getNodePadding(ptr: u32): u32 {
  let node = changetype<ASTNode>(ptr);
  if (node.isFatPadding) return load<u32>(S().fatPaddingArenaPtr + node.paddingLength * 4, 0);
  return node.paddingLength;
}

export function setNodePadding(ptr: u32, pad: u32): void {
  if (pad > 0x3fff) pad = 0x3fff; // MAX_PADDING
  changetype<ASTNode>(ptr).paddingLength = pad;
}

export function getNodeByteLength(ptr: u32): u32 {
  return changetype<ASTNode>(ptr).byteLength;
}

export function setNodeByteLength(ptr: u32, len: u32): void {
  changetype<ASTNode>(ptr).byteLength = len;
}

export function getNodeEnvHash(ptr: u32): u32 {
  return changetype<ASTNode>(ptr).envHash;
}

export function getNodeFirstChild(ptr: u32): u32 {
  return changetype<ASTNode>(ptr).firstChild;
}

export function getNodeNextSibling(ptr: u32): u32 {
  return changetype<ASTNode>(ptr).nextSibling;
}

// ----------------------------------------------------------------------------
// AST Mutator API
// ----------------------------------------------------------------------------

/**
 * Creates a raw AST node initialized with the specified grammar type.
 * @param type The grammar production type ID.
 * @returns The memory pointer to the new node.
 */
export function ast_createNode(type: u16): u32 {
  return allocNode(type, 0, 0, 0);
}

/**
 * Appends a child to the end of a parent's children list.
 * Traverses the intrusive linked list to find the tail.
 * @param parentPtr The parent node.
 * @param childPtr The child node to append.
 */
export function ast_appendChild(parentPtr: u32, childPtr: u32): void {
  if (parentPtr == 0 || childPtr == 0) return;

  let currentFirst = getNodeFirstChild(parentPtr);
  if (currentFirst == 0) {
    setFirstChild(parentPtr, childPtr);
  } else {
    let curr = currentFirst;
    while (getNodeNextSibling(curr) != 0) {
      curr = getNodeNextSibling(curr);
    }
    setNextSibling(curr, childPtr);
  }
}

/**
 * Zero-GC variadic wrapper to create a linked list of node pointers.
 * Uses a dummy AST node (type 0xFFFF) to hold the children.
 */
export function nodeList(
  n0: u32 = 0, n1: u32 = 0, n2: u32 = 0, n3: u32 = 0,
  n4: u32 = 0, n5: u32 = 0, n6: u32 = 0, n7: u32 = 0,
  n8: u32 = 0, n9: u32 = 0, n10: u32 = 0, n11: u32 = 0,
  n12: u32 = 0, n13: u32 = 0, n14: u32 = 0, n15: u32 = 0
): u32 {
  let listPtr = ast_createNode(0xFFFF);
  if (n0 != 0) ast_appendChild(listPtr, n0);
  if (n1 != 0) ast_appendChild(listPtr, n1);
  if (n2 != 0) ast_appendChild(listPtr, n2);
  if (n3 != 0) ast_appendChild(listPtr, n3);
  if (n4 != 0) ast_appendChild(listPtr, n4);
  if (n5 != 0) ast_appendChild(listPtr, n5);
  if (n6 != 0) ast_appendChild(listPtr, n6);
  if (n7 != 0) ast_appendChild(listPtr, n7);
  if (n8 != 0) ast_appendChild(listPtr, n8);
  if (n9 != 0) ast_appendChild(listPtr, n9);
  if (n10 != 0) ast_appendChild(listPtr, n10);
  if (n11 != 0) ast_appendChild(listPtr, n11);
  if (n12 != 0) ast_appendChild(listPtr, n12);
  if (n13 != 0) ast_appendChild(listPtr, n13);
  if (n14 != 0) ast_appendChild(listPtr, n14);
  if (n15 != 0) ast_appendChild(listPtr, n15);
  return listPtr;
}

/**
 * Inserts a new sibling node immediately after a target node.
 * Automatically wires up the linked list to preserve downstream siblings.
 * @param targetPtr The existing node in the list.
 * @param newSiblingPtr The new node to insert.
 */
export function ast_insertSibling(targetPtr: u32, newSiblingPtr: u32): void {
  if (targetPtr == 0 || newSiblingPtr == 0) return;
  let oldNext = getNodeNextSibling(targetPtr);
  setNextSibling(targetPtr, newSiblingPtr);
  setNextSibling(newSiblingPtr, oldNext);
}

/**
 * Replaces an old child node with a new child node in a parent's children list.
 * @param parentPtr The parent node.
 * @param oldChildPtr The node to be replaced.
 * @param newChildPtr The new node to insert.
 */
export function replaceNode(parentPtr: u32, oldChildPtr: u32, newChildPtr: u32): void {
  if (parentPtr == 0 || oldChildPtr == 0 || newChildPtr == 0) return;

  let current = getNodeFirstChild(parentPtr);
  if (current == oldChildPtr) {
    setFirstChild(parentPtr, newChildPtr);
    setNextSibling(newChildPtr, getNodeNextSibling(oldChildPtr));
    return;
  }

  while (current != 0) {
    let next = getNodeNextSibling(current);
    if (next == oldChildPtr) {
      setNextSibling(current, newChildPtr);
      setNextSibling(newChildPtr, getNodeNextSibling(oldChildPtr));
      return;
    }
    current = next;
  }
}

/**
 * Removes a child node from a parent's children list.
 * @param parentPtr The parent node.
 * @param childPtr The node to remove.
 */
export function ast_removeNode(parentPtr: u32, childPtr: u32): void {
  if (parentPtr == 0 || childPtr == 0) return;

  let current = getNodeFirstChild(parentPtr);
  if (current == childPtr) {
    setFirstChild(parentPtr, getNodeNextSibling(childPtr));
    setNextSibling(childPtr, 0); // clear the removed node's sibling pointer
    return;
  }

  while (current != 0) {
    let next = getNodeNextSibling(current);
    if (next == childPtr) {
      setNextSibling(current, getNodeNextSibling(childPtr));
      setNextSibling(childPtr, 0); // clear the removed node's sibling pointer
      return;
    }
    current = next;
  }
}

/**
 * Recursively clones an AST subtree.
 * @param nodeId The root of the subtree to clone.
 * @param deep If true, recursively clones all children.
 * @returns The pointer to the new cloned node.
 */
export function cloneNode(nodeId: u32, deep: boolean): u32 {
  if (nodeId == 0) return 0;
  
  let type = getNodeType(nodeId);
  let padding = getNodePadding(nodeId);
  let byteLen = getNodeByteLength(nodeId);
  let envHash = getNodeEnvHash(nodeId);
  
  let newPtr = allocNode(type, padding, byteLen, envHash);
  
  // Mark it as a shadow/extracted node so it doesn't get cleared by incremental GC
  markExtracted(newPtr);
  
  // Map origin provenance for accurate diagnostics
  let origin = ast_getProvenance(nodeId);
  nodeProvenance.set(newPtr, origin != 0 ? origin : nodeId);

  let typeOverride = nodeOverrideType.get(nodeId);
  if (typeOverride != OVERRIDE_NONE) {
    nodeOverrideType.set(newPtr, typeOverride);
    if (typeOverride == OVERRIDE_STRING) nodeOverrideStrings.set(newPtr, nodeOverrideStrings.get(nodeId));
    else if (typeOverride == OVERRIDE_FLOAT) nodeOverrideFloats.set(newPtr, nodeOverrideFloats.get(nodeId));
    else if (typeOverride == OVERRIDE_INT) nodeOverrideInts.set(newPtr, nodeOverrideInts.get(nodeId));
    else if (typeOverride == OVERRIDE_TENSOR) nodeTensorHandles.set(newPtr, nodeTensorHandles.get(nodeId));
    else if (typeOverride == OVERRIDE_NODEREF) nodeOverrideRefs.set(newPtr, nodeOverrideRefs.get(nodeId));
  }
  
  let currentFlags = nodeFlags.get(nodeId);
  if (currentFlags != 0) {
    nodeFlags.set(newPtr, currentFlags);
  }
  
  if (deep) {
    let child = getNodeFirstChild(nodeId);
    let prevNewChild: u32 = 0;
    while (child != 0) {
      let newChild = cloneNode(child, true);
      if (prevNewChild == 0) {
        setFirstChild(newPtr, newChild);
      } else {
        setNextSibling(prevNewChild, newChild);
      }
      prevNewChild = newChild;
      child = getNodeNextSibling(child);
    }
  }
  
  return newPtr;
}

/**
 * Flags a node as dirty, signaling that it has been manually mutated
 * and needs to be re-evaluated or re-emitted by the unparser.
 * @param ptr The node to flag.
 */
export function ast_markDirty(ptr: u32): void {
  // Flag the node as DIRTY. In a full implementation we would traverse upwards
  // to mark parents, or the unparser will simply spot this dirty node during traversal.
  if (ptr != 0) markDirty(ptr);
}

export const OVERRIDE_NONE = 0;
export const OVERRIDE_STRING: u8 = 1;
export const OVERRIDE_FLOAT: u8 = 2;
export const OVERRIDE_INT: u8 = 3;
export const OVERRIDE_TENSOR = 4;
export const OVERRIDE_NODEREF = 5;

export const nodeOverrideType = new ChunkedUint8Array();
export const nodeOverrideStrings = new ChunkedUint32Array();
export const nodeOverrideFloats = new ChunkedFloat64Array();
export const nodeOverrideInts = new ChunkedInt32Array();
export const nodeOverrideRefs = new ChunkedUint32Array();

export const nodeFlags = new ChunkedUint32Array();
export const nodeProvenance = new ChunkedUint32Array();

export function ast_getProvenance(nodeId: u32): u32 {
  if (nodeId == 0) return 0;
  let origin = nodeProvenance.get(nodeId);
  return origin != 0 ? origin : nodeId;
}

export function ast_setNodeFlag(nodeId: u32, flag: u32): void {
  if (nodeId != 0) {
    nodeFlags.set(nodeId, nodeFlags.get(nodeId) | flag);
    ast_markDirty(nodeId);
  }
}

export function ast_clearNodeFlag(nodeId: u32, flag: u32): void {
  if (nodeId != 0) {
    nodeFlags.set(nodeId, nodeFlags.get(nodeId) & ~flag);
    ast_markDirty(nodeId);
  }
}

export function ast_hasNodeFlag(nodeId: u32, flag: u32): boolean {
  if (nodeId == 0) return false;
  return (nodeFlags.get(nodeId) & flag) !== 0;
}

export function ast_setLiteralNodeRef(ptr: u32, targetId: u32): void {
  if (ptr != 0) {
    nodeOverrideRefs.set(ptr, targetId);
    nodeOverrideType.set(ptr, <u8>OVERRIDE_NODEREF);
    ast_markDirty(ptr);
  }
}

export function ast_getLiteralNodeRef(ptr: u32): u32 {
  if (nodeOverrideType.get(ptr) != OVERRIDE_NODEREF) return 0;
  return nodeOverrideRefs.get(ptr);
}

let stringArenaPtr: usize = 0;
let stringArenaOffset: u32 = 0;
let stringArenaCapacity: u32 = 1024 * 1024; // 1MB

function ensureStringArena(bytesNeeded: u32): void {
  if (stringArenaPtr == 0) {
    stringArenaPtr = atomicChunkAlloc(stringArenaCapacity);
  }
  if (stringArenaOffset + bytesNeeded > stringArenaCapacity) {
    let newCapacity = stringArenaCapacity * 2;
    while (stringArenaOffset + bytesNeeded > newCapacity) newCapacity *= 2;
    let newPtr = atomicChunkAlloc(newCapacity);
    memory.copy(newPtr, stringArenaPtr, stringArenaOffset);
    stringArenaPtr = newPtr;
    stringArenaCapacity = newCapacity;
  }
}

export function ast_extractLiteralString(ptr: u32, sourcePtr: usize, lenBytes: u32, encoding: u8): void {
  if (ptr != 0 && nodeOverrideType.get(ptr) != OVERRIDE_STRING) {
    let byteSize = 4 + lenBytes;
    ensureStringArena(byteSize);
    
    let handle = stringArenaOffset;
    // Set the highest bit to 1 if encoding == 0 (UTF-8), otherwise 0 (UTF-16)
    let headerLen = encoding == 0 ? (lenBytes | 0x80000000) : lenBytes;
    store<u32>(stringArenaPtr + handle, headerLen);
    memory.copy(stringArenaPtr + handle + 4, sourcePtr, lenBytes);
    stringArenaOffset += byteSize;
    
    nodeOverrideStrings.set(ptr, handle);
    nodeOverrideType.set(ptr, OVERRIDE_STRING);
    ast_markDirty(ptr);
  }
}

/**
 * Overrides the string value of a leaf node using Zero-GC unmanaged memory.
 * @param ptr The target node.
 * @param val The new string literal value.
 */
export function ast_setLiteralString(ptr: u32, val: string): void {
  if (ptr != 0) {
    let lenBytes = val.length << 1;
    let byteSize = 4 + lenBytes;
    ensureStringArena(byteSize);
    
    let handle = stringArenaOffset;
    store<u32>(stringArenaPtr + handle, lenBytes); // UTF-16 from JS string, highest bit is 0
    memory.copy(stringArenaPtr + handle + 4, changetype<usize>(val), lenBytes);
    stringArenaOffset += byteSize;
    
    nodeOverrideStrings.set(ptr, handle);
    nodeOverrideType.set(ptr, OVERRIDE_STRING);
    ast_markDirty(ptr);
  }
}

export function ast_setLiteralFloat(ptr: u32, val: f64): void {
  if (ptr != 0) {
    nodeOverrideFloats.set(ptr, val);
    nodeOverrideType.set(ptr, OVERRIDE_FLOAT);
    ast_markDirty(ptr);
  }
}

export function ast_setLiteralInt(ptr: u32, val: i32): void {
  if (ptr != 0) {
    nodeOverrideInts.set(ptr, val);
    nodeOverrideType.set(ptr, OVERRIDE_INT);
    ast_markDirty(ptr);
  }
}

/**
 * Retrieves the raw text span of a node.
 * Returns a 64-bit integer packing the memory pointer (high 32) and the byte length (low 32).
 */
export function ast_getTextSpan(ptr: u32, absoluteStart: u32 = 0xFFFFFFFF): u64 {
  if (ptr == 0) return 0;
  
  let type = nodeOverrideType.get(ptr);
  if (type == OVERRIDE_STRING) {
    let handle = nodeOverrideStrings.get(ptr);
    let lenBytes = load<u32>(stringArenaPtr + handle) & 0x7FFFFFFF;
    let start = stringArenaPtr + handle + 4;
    return (u64(start) << 32) | u64(lenBytes);
  }
  
  if (absoluteStart != 0xFFFFFFFF) {
    let len = getNodeByteLength(ptr);
    if (len == 0) return 0;
    let start = getInputBuffer() + absoluteStart;
    return (u64(start) << 32) | u64(len);
  }
  
  return 0;
}

/**
 * Legacy interop wrapper for modifying literal values from the C-bindings.
 * @param ptr The target node.
 * @param valueStringPtr A pointer to the value string (currently ignored, just marks dirty).
 */
export function ast_setLiteralValue(ptr: u32, valueStringPtr: u32): void {
  // Legacy C-ptr interop
  ast_markDirty(ptr);
}

export function cacheNodeStrings(nodeId: u32, absoluteStart: u32): void {
  cacheNodeStringsInner(nodeId, absoluteStart, 0);
}

/** Internal recursive helper for `cacheNodeStrings`. */
function cacheNodeStringsInner(nodeId: u32, absoluteStart: u32, depth: i32): void {
  // Guard against circular references and maximum recursion limits
  if (nodeId == 0 || depth > 200) return;
  if (isExtracted(nodeId)) return;
  markExtracted(nodeId);

  let child = getNodeFirstChild(nodeId);

  // 1. If it's a leaf node and has byteLength > 0, extract the text!
  if (child == 0 && getNodeByteLength(nodeId) > 0) {
    let ptr = getInputBuffer() + absoluteStart;
    let len = getNodeByteLength(nodeId);
    ast_extractLiteralString(nodeId, ptr, len, inputEncoding);
  }

  // 2. Compute offset distribution for children
  // For children, absoluteStart already includes the padding of THIS node.
  // Since the first child's padding is identical to this node's padding,
  // we must offset it backwards so the first child's padding addition is correct.
  let currentOffset = absoluteStart - getNodePadding(nodeId);

  // 3. Recurse over all siblings in the children list
  while (child != 0) {
    currentOffset += getNodePadding(child);
    cacheNodeStringsInner(child, currentOffset, depth + 1);
    currentOffset += getNodeByteLength(child);
    child = getNodeNextSibling(child);
  }
}

// ----------------------------------------------------------------------------
// Zero-GC String Hashing & Equality
// ----------------------------------------------------------------------------

/**
 * Computes an FNV-1a hash of a node's source text given its absolute byte offset.
 * Because nodes do not contain their absolute offset (only relative padding),
 * callers must provide the absolute start byte computed during tree traversal.
 *
 * @param nodeId The target node.
 * @param absoluteStart The pre-calculated absolute byte offset in the input buffer.
 * @returns A 32-bit FNV-1a hash.
 */
export function hashNodeTextAt(nodeId: u32, absoluteStart: u32): u32 {
  if (nodeId == 0) return 0;
  let span = ast_getTextSpan(nodeId, absoluteStart);
  return ast_hashSpan(span);
}

/**
 * Legacy single-arg wrapper: computes the absolute offset by reading the node's padding field.
 * WARNING: This only works for root-level nodes or scenarios where the padding natively
 * represents the absolute offset from the start of the file.
 * For general nodes deep in the tree, use `hashNodeTextAt`.
 * @param nodeId The target node.
 * @returns A 32-bit FNV-1a hash.
 */
export function hashNodeText(nodeId: u32): u32 {
  if (nodeId == 0) return 0;
  let pad = getNodePadding(nodeId);
  return hashNodeTextAt(nodeId, pad);
}

/**
 * Performs a zero-GC byte-by-byte comparison of the source text of two nodes.
 * @param nodeA The first node.
 * @param absoluteStartA The pre-calculated absolute offset of the first node.
 * @param nodeB The second node.
 * @param absoluteStartB The pre-calculated absolute offset of the second node.
 * @returns true if the source strings are identical, false otherwise.
 */
export function isNodeTextEqualAt(nodeA: u32, absoluteStartA: u32, nodeB: u32, absoluteStartB: u32): boolean {
  if (nodeA == nodeB) return true;
  if (nodeA == 0 || nodeB == 0) return false;

  let spanA = ast_getTextSpan(nodeA, absoluteStartA);
  let spanB = ast_getTextSpan(nodeB, absoluteStartB);
  if (spanA == 0 || spanB == 0) return false;

  let lenA = (spanA & 0xFFFFFFFF) as u32;
  let lenB = (spanB & 0xFFFFFFFF) as u32;
  if (lenA != lenB) return false;

  let ptrA = (spanA >> 32) as u32;
  let ptrB = (spanB >> 32) as u32;

  for (let i: u32 = 0; i < lenA; i++) {
    if (load<u8>(ptrA + i) != load<u8>(ptrB + i)) return false;
  }
  return true;
}

/**
 * Legacy single-arg wrapper (see `hashNodeText` note for limitations).
 * Assumes the node padding represents the absolute offset.
 */
export function isNodeTextEqual(nodeA: u32, nodeB: u32): boolean {
  if (nodeA == nodeB) return true;
  if (nodeA == 0 || nodeB == 0) return false;
  let padA = getNodePadding(nodeA);
  let padB = getNodePadding(nodeB);
  return isNodeTextEqualAt(nodeA, padA, nodeB, padB);
}

/** Returns the current physical linear memory offset for Generation 1. */
export function getArenaOffset(): u32 {
  return S().gen1_offset;
}
/** Returns the upper memory boundary for the current Generation 1 chunk. */
export function getArenaEnd(): u32 {
  return S().gen1_endLimit;
}

// ----------------------------------------------------------------------------
// Multi-Root Garbage Collection for Persistent Trees
// ----------------------------------------------------------------------------

/* moved activeRoots */ 100;
/* moved S().activeRootCount to state */

/**
 * Registers an AST node as a GC root.
 * Roots and their entire subtrees are protected from being swept during clearAstMarks().
 * @param rootPtr The pointer to the AST node to register.
 */
export function registerRoot(rootPtr: u32): void {
  if (S().activeRootCount < 100) {
    store<u32>(S().activeRootsPtr + S().activeRootCount++ * 4, rootPtr, 0);
  }
}

/**
 * Unregisters an AST node from the GC root list.
 * @param rootPtr The pointer to the AST node to unregister.
 */
export function dropRoot(rootPtr: u32): void {
  for (let i: u32 = 0; i < S().activeRootCount; i++) {
    if (load<u32>(S().activeRootsPtr + i * 4, 0) == rootPtr) {
      store<u32>(S().activeRootsPtr + i * 4, load<u32>(S().activeRootsPtr + (S().activeRootCount - 1) * 4, 0), 0); // Fast remove by swapping tail
      S().activeRootCount--;
      return;
    }
  }
}

// GC mark stack in linear memory (zero-GC)
const GC_STACK_CAPACITY: u32 = 1000000;
/* moved S().gcStackPtr to state */

/** Initializes the linear memory stack used by the GC for iterative tree traversal. */
function ensureGcStack(): void {
  if (S().gcStackPtr == 0) {
    S().gcStackCapacity = GC_STACK_CAPACITY;
    S().gcStackPtr = atomicChunkAlloc(S().gcStackCapacity * 4);
  }
}

@inline
function pushGcStack(val: u32, stackTop: u32): u32 {
  if (stackTop >= S().gcStackCapacity) {
    let newCap = S().gcStackCapacity * 2;
    let newPtr = atomicChunkAlloc(newCap * 4);
    memory.copy(newPtr as usize, S().gcStackPtr as usize, S().gcStackCapacity * 4);
    S().gcStackPtr = newPtr;
    S().gcStackCapacity = newCap;
  }
  store<u32>(S().gcStackPtr + stackTop * 4, val, 0);
  return stackTop + 1;
}

/**
 * Performs a Mark-and-Sweep Garbage Collection pass over the AST.
 * Unmarked nodes are collected and pushed onto the free-list for future reallocation.
 * @param rootToKeep An explicit root node to protect during this specific sweep pass.
 */
export function clearAstMarks(rootToKeep: u32): void {
  ensureGcStack();

  // --------------------------------------------------------------------------
  // Mark Phase
  // --------------------------------------------------------------------------
  let stackTop: u32 = 0;
  let gcHighWaterMark: u32 = 0; // Tracks the highest physical memory address containing a live node

  // 1. Mark Phase: Depth-first traversal using a zero-alloc explicit linear memory stack
  // Prime the stack with the explicitly retained root
  if (rootToKeep != 0) {
    stackTop = pushGcStack(rootToKeep, stackTop);
  }

  // Prime the stack with all actively registered multi-roots
  for (let i: u32 = 0; i < S().activeRootCount; i++) {
    stackTop = pushGcStack(load<u32>(S().activeRootsPtr + i * 4, 0), stackTop);
  }

  // Iterative depth-first traversal
  while (stackTop > 0) {
    stackTop--;
    let curr = load<u32>(S().gcStackPtr + stackTop * 4, 0);
    if (curr == 0) continue;

    let flags = (load<u32>(curr, 0) >> 10) & 0x3f;
    if ((flags & FLAG_GC_MARK) == 0) {
      // Mark this node as live
      let val = load<u32>(curr, 0);
      store<u32>(curr, val | (FLAG_GC_MARK << 10), 0);

      if (curr > gcHighWaterMark) gcHighWaterMark = curr;

      // Push all children to the stack
      let child = load<u32>(curr + 8, 0);
      while (child != 0) {
        stackTop = pushGcStack(child, stackTop);
        child = load<u32>(child + 12, 0); // follow intrusive sibling linked list
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sweep Phase
  // --------------------------------------------------------------------------
  S().freeNodeHead = 0; // Reset free-list

  let activeChunk = S().gen1_active_chunk;
  if (activeChunk >= S().gen1_chunk_count) {
    activeChunk = S().gen1_chunk_count - 1;
  }

  for (let i: u32 = 0; i <= activeChunk; i++) {
    let start = load<u32>(S().gen1_chunks + i * 4);
    let sweepEnd = i == S().gen1_active_chunk ? S().gen1_offset : start + AST_CHUNK_SIZE;

    let lastLivePtr: u32 = start;

    // Sweep sequentially through the chunk's memory block
    for (let ptr = start; ptr < sweepEnd; ptr += NODE_SIZE) {
      let val = load<u32>(ptr, 0);
      let flags = (val >> 10) & 0x3f;

      if ((flags & FLAG_GC_MARK) == 0) {
        // Node is dead: add to free-list using the firstChild slot
        store<u32>(ptr + 8, S().freeNodeHead, 0);
        S().freeNodeHead = ptr;
      } else {
        // Node is live: clear the GC and LSP flags for the next cycle
        lastLivePtr = ptr + NODE_SIZE;
        store<u32>(ptr, val & ~((<u32>(FLAG_GC_MARK | FLAG_LSP_VISITED)) << 10), 0);
      }
    }
  }
}

/**
 * Convenience helper to fetch the N-th child of an AST node.
 * Because children are an intrusive linked list, this operation is O(N).
 * @param node The parent node pointer.
 * @param n The 0-based index of the child to retrieve.
 * @returns The pointer to the N-th child, or 0 if it doesn't exist.
 */
export function getNthChild(node: u32, n: u32): u32 {
  let child = getNodeFirstChild(node);
  for (let i: u32 = 0; i < n; i++) {
    if (child == 0) return 0;
    child = getNodeNextSibling(child);
  }
  return child;
}

// ----------------------------------------------------------------------------
// Zero-GC Tensor Arena (Linear Bump Allocator)
// ----------------------------------------------------------------------------

let tensorArenaPtr: usize = 0;
let tensorArenaOffset: u32 = 0;
let tensorArenaCapacity: u32 = 1024 * 1024; // 1MB initial allocation

/**
 * Ensures the linear tensor memory block has enough capacity.
 */
function ensureTensorArena(bytesNeeded: u32): void {
  if (tensorArenaPtr == 0) {
    tensorArenaPtr = atomicChunkAlloc(tensorArenaCapacity);
  }
  if (tensorArenaOffset + bytesNeeded > tensorArenaCapacity) {
    let newCapacity = tensorArenaCapacity * 2;
    while (tensorArenaOffset + bytesNeeded > newCapacity) {
      newCapacity *= 2;
    }
    let newPtr = atomicChunkAlloc(newCapacity);
    memory.copy(newPtr, tensorArenaPtr, tensorArenaOffset);
    tensorArenaPtr = newPtr;
    tensorArenaCapacity = newCapacity;
  }
}

// Chunked array mapping nodeId (index) to Tensor Arena handle (offset)
export const nodeTensorHandles = new ChunkedUint32Array();

export enum TensorType {
  Float64 = 0,
  Int32 = 1,
  Boolean = 2,
  Float32 = 3,
  Float16 = 4,
  Int64 = 5,
  Int16 = 6,
  Int8 = 7,
  Uint8 = 8,
  Uint16 = 9,
  Uint32 = 10,
  Uint64 = 11,
}

function getElementSize(type: u32): u32 {
  if (type == TensorType.Float64) return 8;
  if (type == TensorType.Int64) return 8;
  if (type == TensorType.Uint64) return 8;
  if (type == TensorType.Float32) return 4;
  if (type == TensorType.Int32) return 4;
  if (type == TensorType.Uint32) return 4;
  if (type == TensorType.Float16) return 2;
  if (type == TensorType.Int16) return 2;
  if (type == TensorType.Uint16) return 2;
  return 1; // Boolean, Int8, Uint8
}

/** Universal N-Dimensional Tensor Allocation */
export function ast_createTensor(type: u32, rank: u32, elementCount: u32): u32 {
  // align base handle to 16 bytes for safe WebGPU and SIMD access
  tensorArenaOffset = (tensorArenaOffset + 15) & ~15;
  let handle = tensorArenaOffset;
  
  // Calculate header size: 16 bytes for metadata (type, rank, count, dataOffset) + shape array
  let headerSize = 16 + (rank * 4);
  
  // Align data payload start to 16 bytes (critical for WebGPU Uniform/Storage buffers)
  let alignedHeaderSize = (headerSize + 15) & ~15;
  
  let elementSize = getElementSize(type);
  let byteSize = alignedHeaderSize + (elementCount * elementSize);
  ensureTensorArena(byteSize);
  
  store<u32>(tensorArenaPtr + handle, type);
  store<u32>(tensorArenaPtr + handle + 4, rank);
  store<u32>(tensorArenaPtr + handle + 8, elementCount);
  store<u32>(tensorArenaPtr + handle + 12, alignedHeaderSize); // Store data payload offset
  
  tensorArenaOffset += byteSize;
  return handle;
}

export function ast_setTensorShape(handle: u32, dimIndex: u32, size: u32): void {
  store<u32>(tensorArenaPtr + handle + 16 + (dimIndex * 4), size);
}

export function ast_getTensorShape(handle: u32, dimIndex: u32): u32 {
  return load<u32>(tensorArenaPtr + handle + 16 + (dimIndex * 4));
}

@inline function getTensorDataPtr(handle: u32, flatIndex: u32, elementSize: u32): usize {
  let headerSize = load<u32>(tensorArenaPtr + handle + 12);
  return tensorArenaPtr + handle + headerSize + (flatIndex * elementSize);
}

export function ast_setTensorFloat(h: u32, i: u32, v: f64): void { store<f64>(getTensorDataPtr(h, i, 8), v); }
export function ast_getTensorFloat(h: u32, i: u32): f64 { return load<f64>(getTensorDataPtr(h, i, 8)); }

export function ast_setTensorFloat32(h: u32, i: u32, v: f32): void { store<f32>(getTensorDataPtr(h, i, 4), v); }
export function ast_getTensorFloat32(h: u32, i: u32): f32 { return load<f32>(getTensorDataPtr(h, i, 4)); }

export function ast_setTensorFloat16Raw(h: u32, i: u32, v: u16): void { store<u16>(getTensorDataPtr(h, i, 2), v); }
export function ast_getTensorFloat16Raw(h: u32, i: u32): u16 { return load<u16>(getTensorDataPtr(h, i, 2)); }

export function ast_setTensorInt(h: u32, i: u32, v: i32): void { store<i32>(getTensorDataPtr(h, i, 4), v); }
export function ast_getTensorInt(h: u32, i: u32): i32 { return load<i32>(getTensorDataPtr(h, i, 4)); }

export function ast_setTensorUint32(h: u32, i: u32, v: u32): void { store<u32>(getTensorDataPtr(h, i, 4), v); }
export function ast_getTensorUint32(h: u32, i: u32): u32 { return load<u32>(getTensorDataPtr(h, i, 4)); }

export function ast_setTensorInt64(h: u32, i: u32, v: i64): void { store<i64>(getTensorDataPtr(h, i, 8), v); }
export function ast_getTensorInt64(h: u32, i: u32): i64 { return load<i64>(getTensorDataPtr(h, i, 8)); }

export function ast_setTensorUint64(h: u32, i: u32, v: u64): void { store<u64>(getTensorDataPtr(h, i, 8), v); }
export function ast_getTensorUint64(h: u32, i: u32): u64 { return load<u64>(getTensorDataPtr(h, i, 8)); }

export function ast_setTensorInt16(h: u32, i: u32, v: i16): void { store<i16>(getTensorDataPtr(h, i, 2), v); }
export function ast_getTensorInt16(h: u32, i: u32): i16 { return load<i16>(getTensorDataPtr(h, i, 2)); }

export function ast_setTensorUint16(h: u32, i: u32, v: u16): void { store<u16>(getTensorDataPtr(h, i, 2), v); }
export function ast_getTensorUint16(h: u32, i: u32): u16 { return load<u16>(getTensorDataPtr(h, i, 2)); }

export function ast_setTensorInt8(h: u32, i: u32, v: i8): void { store<i8>(getTensorDataPtr(h, i, 1), v); }
export function ast_getTensorInt8(h: u32, i: u32): i8 { return load<i8>(getTensorDataPtr(h, i, 1)); }

export function ast_setTensorUint8(h: u32, i: u32, v: u8): void { store<u8>(getTensorDataPtr(h, i, 1), v); }
export function ast_getTensorUint8(h: u32, i: u32): u8 { return load<u8>(getTensorDataPtr(h, i, 1)); }

export function ast_setTensorBool(h: u32, i: u32, v: boolean): void { store<u8>(getTensorDataPtr(h, i, 1), v ? 1 : 0); }
export function ast_getTensorBool(h: u32, i: u32): boolean { return load<u8>(getTensorDataPtr(h, i, 1)) !== 0; }

/** Binds a Tensor Handle to an AST Node using the O(1) side-table */
export function ast_setLiteralTensor(nodeId: u32, handle: u32): void {
  if (nodeId != 0) {
    nodeTensorHandles.set(nodeId, handle);
    nodeOverrideType.set(nodeId, <u8>OVERRIDE_TENSOR);
    ast_markDirty(nodeId);
  }
}

/** Retrieves the Tensor Handle bound to an AST Node, or 0 if none */
export function ast_getLiteralTensor(nodeId: u32): u32 {
  if (nodeOverrideType.get(nodeId) != OVERRIDE_TENSOR) return 0;
  return nodeTensorHandles.get(nodeId);
}

// ----------------------------------------------------------------------------
// Host Bridge (JS/TS Frontend Accessors)
// ----------------------------------------------------------------------------

export function ast_getTensorType(nodeId: u32): u32 {
  let handle = nodeTensorHandles.get(nodeId);
  if (handle == 0) return 0; // defaults to Float64
  return load<u32>(tensorArenaPtr + handle);
}

export function ast_getTensorDimensions(nodeId: u32): u32 {
  let handle = nodeTensorHandles.get(nodeId);
  if (handle == 0) return 0;
  return load<u32>(tensorArenaPtr + handle + 4);
}

export function ast_getTensorShapePtr(nodeId: u32): usize {
  let handle = nodeTensorHandles.get(nodeId);
  if (handle == 0) return 0;
  return tensorArenaPtr + handle + 12;
}

export function ast_getTensorDataPtr(nodeId: u32): usize {
  let handle = nodeTensorHandles.get(nodeId);
  if (handle == 0) return 0;
  let dims = load<u32>(tensorArenaPtr + handle + 4);
  return tensorArenaPtr + handle + 12 + (dims * 4);
}

// ----------------------------------------------------------------------------
/** Computes the number of children of a node by traversing nextSibling edges. */
export function ast_getChildCount(nodeId: u32): u32 {
  if (nodeId == 0) return 0;
  let count: u32 = 0;
  let child = getNodeFirstChild(nodeId);
  while (child != 0) {
    count++;
    child = getNodeNextSibling(child);
  }
  return count;
}

// ----------------------------------------------------------------------------
// O(1) Zero-GC Symbol Hash Table
// ----------------------------------------------------------------------------

export const nodeScopes = new ChunkedUint32Array();

// FNV-1a hash functions for memory spans
export function ast_hashSpan(span: u64, hash: u32 = 2166136261): u32 {
  if (span == 0) return hash;
  let ptr = (span >> 32) as u32;
  let len = (span & 0xFFFFFFFF) as u32;
  
  let isOverride = (ptr >= (stringArenaPtr as u32) && ptr < (stringArenaPtr as u32) + (stringArenaCapacity as u32));
  let encoding = inputEncoding;
  
  if (isOverride) {
    let rawLen = load<u32>(ptr - 4);
    encoding = (rawLen & 0x80000000) != 0 ? 0 : 1;
  }

  if (encoding == 0) {
    let i: u32 = 0;
    while (i < len) {
      let b1 = load<u8>(ptr + i);
      let cp: u32 = 0;
      if (b1 < 0x80) {
        cp = b1;
        i++;
      } else if ((b1 & 0xE0) == 0xC0) {
        if (i + 1 >= len) break;
        let b2 = load<u8>(ptr + i + 1);
        cp = ((b1 & 0x1F) << 6) | (b2 & 0x3F);
        i += 2;
      } else if ((b1 & 0xF0) == 0xE0) {
        if (i + 2 >= len) break;
        let b2 = load<u8>(ptr + i + 1);
        let b3 = load<u8>(ptr + i + 2);
        cp = ((b1 & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F);
        i += 3;
      } else {
        if (i + 3 >= len) break;
        let b2 = load<u8>(ptr + i + 1);
        let b3 = load<u8>(ptr + i + 2);
        let b4 = load<u8>(ptr + i + 3);
        cp = ((b1 & 0x07) << 18) | ((b2 & 0x3F) << 12) | ((b3 & 0x3F) << 6) | (b4 & 0x3F);
        i += 4;
      }
      hash ^= cp;
      hash = hash * 16777619;
    }
  } else if (encoding == 1) {
    let i: u32 = 0;
    while (i < len) {
      let u1 = load<u16>(ptr + i);
      let cp: u32 = u1;
      i += 2;
      if (u1 >= 0xD800 && u1 <= 0xDBFF && i < len) {
        let u2 = load<u16>(ptr + i);
        if (u2 >= 0xDC00 && u2 <= 0xDFFF) {
          cp = 0x10000 + (((u1 & 0x3FF) << 10) | (u2 & 0x3FF));
          i += 2;
        }
      }
      hash ^= cp;
      hash = hash * 16777619;
    }
  } else {
    for (let i: u32 = 0; i < len; i += 4) {
      let cp = load<u32>(ptr + i);
      hash ^= cp;
      hash = hash * 16777619;
    }
  }
  
  return hash;
}

export function ast_hashByte(byte: u8, hash: u32 = 2166136261): u32 {
  hash ^= byte;
  return hash * 16777619;
}

let scopeArenaPtr: usize = 0;
let scopeArenaOffset: u32 = 0;
let scopeArenaCapacity: u32 = 1024 * 1024; // 1MB

function ensureScopeArena(bytesNeeded: u32): void {
  if (scopeArenaPtr == 0) {
    scopeArenaPtr = atomicChunkAlloc(scopeArenaCapacity);
  }
  if (scopeArenaOffset + bytesNeeded > scopeArenaCapacity) {
    let newCapacity = scopeArenaCapacity * 2;
    while (scopeArenaOffset + bytesNeeded > newCapacity) newCapacity *= 2;
    let newPtr = atomicChunkAlloc(newCapacity);
    memory.copy(newPtr, scopeArenaPtr, scopeArenaOffset);
    scopeArenaPtr = newPtr;
    scopeArenaCapacity = newCapacity;
  }
}

/** Binds a child node to a specific 32-bit hash in the parent's symbol table. */
export function ast_bindChildHash(parentId: u32, hash: u32, childId: u32): void {
  if (parentId == 0 || childId == 0) return;
  
  if (hash == 0) hash = 1; // Reserve 0 for empty slot
  
  let tableOffset = nodeScopes.get(parentId);
  if (tableOffset == 0) {
    // Initialize a new linear open-addressing hash table for this parent.
    // Memory layout: 
    // offset + 0: capacity (u32)
    // offset + 4: count (u32)
    // offset + 8: slots array (capacity * 8 bytes). Each slot is [hash(u32), childId(u32)]
    let cap = 8;
    let byteSize = 8 + (cap * 8);
    ensureScopeArena(byteSize);
    tableOffset = scopeArenaOffset;
    store<u32>(scopeArenaPtr + tableOffset, cap);
    store<u32>(scopeArenaPtr + tableOffset + 4, 0);
    memory.fill(scopeArenaPtr + tableOffset + 8, 0, cap * 8);
    scopeArenaOffset += byteSize;
    nodeScopes.set(parentId, tableOffset);
  }
  
  let capacity = load<u32>(scopeArenaPtr + tableOffset);
  let count = load<u32>(scopeArenaPtr + tableOffset + 4);
  
  // Resize if load factor >= 0.75
  if (count * 4 >= capacity * 3) {
    let newCap = capacity * 2;
    let newByteSize = 8 + (newCap * 8);
    ensureScopeArena(newByteSize);
    let newTableOffset = scopeArenaOffset;
    store<u32>(scopeArenaPtr + newTableOffset, newCap);
    store<u32>(scopeArenaPtr + newTableOffset + 4, count);
    memory.fill(scopeArenaPtr + newTableOffset + 8, 0, newCap * 8);
    scopeArenaOffset += newByteSize;
    
    // Rehash
    for (let i: u32 = 0; i < capacity; i++) {
      let oldSlot = tableOffset + 8 + (i * 8);
      let h = load<u32>(scopeArenaPtr + oldSlot);
      if (h != 0) {
        let nId = load<u32>(scopeArenaPtr + oldSlot + 4);
        let mask = newCap - 1;
        let idx = h & mask;
        while (true) {
          let slot = newTableOffset + 8 + (idx * 8);
          if (load<u32>(scopeArenaPtr + slot) == 0) {
            store<u32>(scopeArenaPtr + slot, h);
            store<u32>(scopeArenaPtr + slot + 4, nId);
            break;
          }
          idx = (idx + 1) & mask;
        }
      }
    }
    tableOffset = newTableOffset;
    nodeScopes.set(parentId, tableOffset);
    capacity = newCap;
  }
  
  // Insert
  let mask = capacity - 1;
  let idx = hash & mask;
  while (true) {
    let slot = tableOffset + 8 + (idx * 8);
    let slotHash = load<u32>(scopeArenaPtr + slot);
    if (slotHash == 0 || slotHash == hash) {
      if (slotHash == 0) {
        store<u32>(scopeArenaPtr + tableOffset + 4, count + 1);
      }
      store<u32>(scopeArenaPtr + slot, hash);
      store<u32>(scopeArenaPtr + slot + 4, childId);
      break;
    }
    idx = (idx + 1) & mask;
  }
}

/** Convenience wrapper to bind by a node's text span */
export function ast_bindChildNode(parentId: u32, nameNodeId: u32, childId: u32, absoluteStart: u32 = 0xFFFFFFFF): void {
  ast_bindChildHash(parentId, ast_hashSpan(ast_getTextSpan(nameNodeId, absoluteStart)), childId);
}

/** Resolves a child node by its exact 32-bit hash in O(1) time. */
export function ast_resolveChildByHash(parentId: u32, hash: u32): u32 {
  if (parentId == 0) return 0;
  let tableOffset = nodeScopes.get(parentId);
  if (tableOffset == 0) return 0;
  
  if (hash == 0) hash = 1;
  
  let capacity = load<u32>(scopeArenaPtr + tableOffset);
  let mask = capacity - 1;
  let idx = hash & mask;
  
  while (true) {
    let slot = tableOffset + 8 + (idx * 8);
    let slotHash = load<u32>(scopeArenaPtr + slot);
    if (slotHash == 0) return 0; // Not found
    
    if (slotHash == hash) {
      return load<u32>(scopeArenaPtr + slot + 4);
    }
    idx = (idx + 1) & mask;
  }
}

/** Convenience wrapper to resolve by a node's text span */
export function ast_resolveChildNode(parentId: u32, nameNodeId: u32, absoluteStart: u32 = 0xFFFFFFFF): u32 {
  return ast_resolveChildByHash(parentId, ast_hashSpan(ast_getTextSpan(nameNodeId, absoluteStart)));
}
