/* eslint-disable */
// @ts-nocheck
// @ts-ignore

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
export class SharedState {
  gen1_chunks: u32;
  gen1_chunk_count: u32;
  gen1_offset: u32;
  gen1_endLimit: u32;
  arenaOffset: u32;
  gen0_chunks: u32;
  gen0_chunk_count: u32;
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
}

/**
 * Retrieves the shared cross-worker memory state.
 * Thread-safe initialization using an atomic compare-and-exchange lock.
 */
export function S(): SharedState {
  let ptrLocation = (__heap_base as u32) + 4;
  let ptr = atomic.load<u32>(ptrLocation);
  if (ptr == 0) {
    let newPtr = atomicChunkAlloc(256); // Allocate 256 bytes for global state
    memory.fill(newPtr as usize, 0, 256);
    let old = atomic.cmpxchg<u32>(ptrLocation, 0, newPtr);
    if (old != 0) return changetype<SharedState>(old);

    let state = changetype<SharedState>(newPtr);
    state.currentInputBufferSize = INPUT_BUFFER_SIZE;
    state.arenaBuffer = atomicChunkAlloc(state.currentInputBufferSize);
    state.gen1_chunks = 0;
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
  // Ensure 16-byte alignment for the allocated chunk
  let rem = size % 16;
  if (rem != 0) size += 16 - rem;

  // The bump allocator is placed at the end of the static data segment (__heap_base)
  let ptrLocation = __heap_base as u32;

  // Initialize the bump pointer if it is zero
  atomic.cmpxchg<u32>(ptrLocation, 0, ptrLocation + 16);

  // Atomically increment the bump pointer by the requested size
  let oldPtr = atomic.add<u32>(ptrLocation, size);
  let newPtr = oldPtr + size;

  // Check if the linear memory needs to be grown
  let currentPages = memory.size();
  let currentBytes = currentPages << 16; // 1 page = 65536 bytes

  if (newPtr > (currentBytes as u32)) {
    let diffBytes = newPtr - (currentBytes as u32);
    let diffPages = (diffBytes + 65535) >> 16;

    // Re-check size in case another worker already grew the memory concurrently
    if (memory.size() < currentPages + diffPages) {
      memory.grow(diffPages);
    }
  }

  return oldPtr;
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
    S().fatPaddingCount = 0; // Reset fat padding arena on full re-parse
    if (S().gen1_chunk_count > 0) {
      S().gen1_chunk_count = 1;
      S().gen1_offset = load<u32>(S().gen1_chunks);
      S().arenaOffset = S().gen1_offset;
      S().gen1_endLimit = S().gen1_offset + AST_CHUNK_SIZE;
      memory.fill(S().gen1_offset as usize, 0, AST_CHUNK_SIZE as usize);
    }
  } else if (gen == 0) {
    if (S().gen0_chunk_count > 0) {
      S().gen0_chunk_count = 1;
      S().gen0_offset = load<u32>(S().gen0_chunks);
      S().gen0_endLimit = S().gen0_offset + AST_CHUNK_SIZE;
      memory.fill(S().gen0_offset as usize, 0, AST_CHUNK_SIZE as usize);
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
  // Allow an extra 64 bytes for internal overhead or padding
  if (size + 64 > S().currentInputBufferSize) {
    S().currentInputBufferSize = size + 64;
    S().arenaBuffer = atomicChunkAlloc(S().currentInputBufferSize);
  }
  return S().arenaBuffer + 64;
}

/**
 * Retrieves the memory pointer where the input source text is stored.
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
const FAT_PADDING_CAPACITY: u32 = 100000;
/** The number of active fat padding slots currently utilized. */
/* moved S().fatPaddingCount to state */

/**
 * Initializes the fat padding arena if it hasn't been set up yet.
 * Fat padding holds large offsets or 64-bit literals that don't fit inside a standard 16-byte AST node.
 */
function ensureFatPaddingArena(): void {
  if (S().fatPaddingArenaPtr == 0) {
    S().fatPaddingArenaPtr = atomicChunkAlloc(FAT_PADDING_CAPACITY * 4);
    memory.fill(S().fatPaddingArenaPtr as usize, 0, FAT_PADDING_CAPACITY * 4);
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
  S().gen1_chunks = atomicChunkAlloc(1024 * 4); // Metadata array: up to 1024 chunks
  S().gen0_chunks = atomicChunkAlloc(1024 * 4);

  // Initialize first chunk for Generation 1 (Persistent)
  let chunk1 = atomicChunkAlloc(AST_CHUNK_SIZE);
  store<u32>(S().gen1_chunks, chunk1);
  S().gen1_chunk_count = 1;
  S().gen1_offset = chunk1;
  S().gen1_endLimit = chunk1 + AST_CHUNK_SIZE;

  // Initialize first chunk for Generation 0 (Transient)
  let chunk0 = atomicChunkAlloc(AST_CHUNK_SIZE);
  store<u32>(S().gen0_chunks, chunk0);
  S().gen0_chunk_count = 1;
  S().gen0_offset = chunk0;
  S().gen0_endLimit = chunk0 + AST_CHUNK_SIZE;

  S().activeGeneration = 1;
  S().arenaOffset = S().gen1_offset;
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
  S().allocCount++;
  let ptr: u32 = 0;

  // 1. Attempt to reclaim memory from the free list (structural sharing)
  if (S().freeNodeHead != 0) {
    ptr = S().freeNodeHead;
    S().freeNodeHead = load<u32>(ptr + 8, 0); // The 'firstChild' slot is overloaded as the 'next' pointer
  } else {
    // 2. Perform atomic bump allocation in the currently active generation
    let ptrLoc: usize =
      changetype<usize>(S()) +
      (S().activeGeneration == 0 ? offsetof<SharedState>("gen0_offset") : offsetof<SharedState>("gen1_offset"));
    let endLimit = S().activeGeneration == 0 ? S().gen0_endLimit : S().gen1_endLimit;

    // Atomically claim a 16-byte slot
    ptr = atomic.add<u32>(ptrLoc, NODE_SIZE);

    // Ensure 16-byte alignment if somehow misaligned
    let rem = ptr % 16;
    if (rem != 0) {
      atomic.add<u32>(ptrLoc, 16 - rem);
      ptr += 16 - rem;
    }

    // 3. Request a new chunk if the claimed slot exceeds the current chunk boundary
    if (ptr + NODE_SIZE > endLimit) {
      let newChunk = atomicChunkAlloc(AST_CHUNK_SIZE);
      memory.fill(newChunk as usize, 0, AST_CHUNK_SIZE as usize);

      // Use cmpxchg to safely update the chunk list and limits
      // If multiple workers hit the end simultaneously, only one will successfully swap the offset
      let oldOffset = atomic.cmpxchg<u32>(ptrLoc, ptr + NODE_SIZE, newChunk + NODE_SIZE);
      if (oldOffset == ptr + NODE_SIZE) {
        // We won the race: register the new chunk
        if (S().activeGeneration == 0) {
          store<u32>(S().gen0_chunks + S().gen0_chunk_count * 4, newChunk);
          S().gen0_chunk_count++;
          S().gen0_endLimit = newChunk + AST_CHUNK_SIZE;
        } else {
          store<u32>(S().gen1_chunks + S().gen1_chunk_count * 4, newChunk);
          S().gen1_chunk_count++;
          S().gen1_endLimit = newChunk + AST_CHUNK_SIZE;
        }
        ptr = newChunk;
      } else {
        // We lost the race: another worker allocated the chunk. Just retry the allocation.
        ptr = atomic.add<u32>(ptrLoc, NODE_SIZE);
      }
    }

    if (S().activeGeneration != 0) {
      S().arenaOffset = ptr + NODE_SIZE;
    }
  }

  // 4. Handle values that exceed the 16-bit inline padding limit
  ensureFatPaddingArena();
  let fatFlag: u32 = 0;
  if (paddingLength >= 0xffff) {
    if (S().fatPaddingCount < FAT_PADDING_CAPACITY) {
      store<u32>(S().fatPaddingArenaPtr + S().fatPaddingCount * 4, paddingLength, 0);
      paddingLength = S().fatPaddingCount;
      S().fatPaddingCount++;
      fatFlag = 1;
    } else {
      paddingLength = 0xfffe; // Saturate if the fat arena is completely full
    }
  }

  // 5. Clamp lengths to fit within bit-packed limits
  if (byteLength > MASK_BYTE_LEN) byteLength = MASK_BYTE_LEN;
  if (envHash > 255) envHash = 255;

  // 6. Assemble and store the bit-packed words
  // Word 0: type uses bits 0-9, flags=0, paddingLength uses bits 16-31
  store<u32>(ptr, (type as u32 & MASK_TYPE) | (paddingLength << SHIFT_PADDING), NODE_OFFSET_W0);
  // Word 1: byteLength uses bits 0-22, fatFlag at bit 23, envHash at bits 24-31
  store<u32>(
    ptr + NODE_OFFSET_W1,
    (byteLength & MASK_BYTE_LEN) | (fatFlag << SHIFT_FAT_FLAG) | (envHash << SHIFT_ENV_HASH),
    0,
  );

  // Initialize children and sibling pointers to 0
  store<u32>(ptr + NODE_OFFSET_FIRST_CHILD, 0, 0);
  store<u32>(ptr + NODE_OFFSET_NEXT_SIBLING, 0, 0);

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
  let ptrLoc: usize = changetype<usize>(S()) + offsetof<SharedState>("gen0_offset");

  // Atomically claim the size
  let ptr = atomic.add<u32>(ptrLoc, sizeBytes);

  // Ensure 4-byte alignment
  let rem = ptr % 4;
  if (rem != 0) {
    atomic.add<u32>(ptrLoc, 4 - rem);
    ptr += 4 - rem;
  }

  // Request a new chunk if the current Gen0 chunk is exhausted
  if (ptr + sizeBytes > S().gen0_endLimit) {
    let allocSize = sizeBytes > AST_CHUNK_SIZE ? sizeBytes : AST_CHUNK_SIZE;
    // ensure 4-byte alignment of the allocation size
    let sizeRem = allocSize % 4;
    if (sizeRem != 0) allocSize += 4 - sizeRem;

    let newChunk = atomicChunkAlloc(allocSize);
    memory.fill(newChunk as usize, 0, allocSize as usize);

    let oldOffset = atomic.cmpxchg<u32>(ptrLoc, ptr + sizeBytes, newChunk + sizeBytes);
    if (oldOffset == ptr + sizeBytes) {
      store<u32>(S().gen0_chunks + S().gen0_chunk_count * 4, newChunk);
      S().gen0_chunk_count++;
      S().gen0_endLimit = newChunk + allocSize;
      ptr = newChunk;
    } else {
      ptr = atomic.add<u32>(ptrLoc, sizeBytes);
    }
  }

  return ptr;
}

// ----------------------------------------------------------------------------
// AST Node Memory Layout Bitmasks & Offsets
// ----------------------------------------------------------------------------
const NODE_OFFSET_W0: usize = 0;
const NODE_OFFSET_W1: u32 = 4;
const NODE_OFFSET_FIRST_CHILD: u32 = 8;
const NODE_OFFSET_NEXT_SIBLING: u32 = 12;

const MASK_TYPE: u32 = 0x03ff;
const SHIFT_FLAGS: u32 = 10;
const MASK_FLAGS: u32 = 0x3f;
const SHIFT_PADDING: u32 = 16;
const MASK_PADDING_W0_KEEP: u32 = 0x0000ffff;
const MAX_PADDING: u32 = 0xffff; // 65535

const MASK_BYTE_LEN: u32 = 0x007fffff; // 8MB limit
const MASK_W1_KEEP_UPPER: u32 = 0xff800000;
const SHIFT_FAT_FLAG: u32 = 23;
const SHIFT_ENV_HASH: u32 = 24;

// ----------------------------------------------------------------------------
// Node Flag Definitions
// ----------------------------------------------------------------------------
export const FLAG_GC_MARK: u16 = 1;
export const FLAG_EXTRACTED: u16 = 2;
export const FLAG_INVISIBLE: u16 = 4;
export const FLAG_LSP_VISITED: u16 = 8;
export const FLAG_DIRTY: u16 = 16;
export const FLAG_IS_LIST: u16 = 32; // Separate from FLAG_INVISIBLE to avoid collision

/**
 * Retrieves the 6-bit flag bitmask from an AST node.
 * @param ptr Pointer to the AST node.
 * @returns The flags packed as a u16.
 */
export function getNodeFlags(ptr: u32): u16 {
  return ((load<u32>(ptr, NODE_OFFSET_W0) >> SHIFT_FLAGS) & MASK_FLAGS) as u16;
}

/**
 * Mutates the 6-bit flag bitmask on an AST node.
 * @param ptr Pointer to the AST node.
 * @param flags The new flag bitmask.
 */
export function setNodeFlags(ptr: u32, flags: u16): void {
  let val = load<u32>(ptr, NODE_OFFSET_W0);
  store<u32>(ptr, (val & ~(MASK_FLAGS << SHIFT_FLAGS)) | ((flags as u32 & MASK_FLAGS) << SHIFT_FLAGS), NODE_OFFSET_W0);
}

/** Adds the GC mark flag to the node. */
export function markNode(ptr: u32): void {
  setNodeFlags(ptr, getNodeFlags(ptr) | FLAG_GC_MARK);
}
/** Removes the GC mark flag from the node. */
export function unmarkNode(ptr: u32): void {
  setNodeFlags(ptr, getNodeFlags(ptr) & ~FLAG_GC_MARK);
}
/** Checks if the node is currently marked for GC survival. */
export function isNodeMarked(ptr: u32): boolean {
  return (getNodeFlags(ptr) & FLAG_GC_MARK) != 0;
}

/** Flags the node as extracted during incremental reparsing. */
export function markExtracted(ptr: u32): void {
  setNodeFlags(ptr, getNodeFlags(ptr) | FLAG_EXTRACTED);
}
/** Checks if the node has been extracted. */
export function isExtracted(ptr: u32): boolean {
  return (getNodeFlags(ptr) & FLAG_EXTRACTED) != 0;
}

/** Marks the node as structurally dirty, requiring re-evaluation. */
export function markDirty(ptr: u32): void {
  setNodeFlags(ptr, getNodeFlags(ptr) | FLAG_DIRTY);
}
/** Checks if the node is flagged as dirty. */
export function isDirty(ptr: u32): boolean {
  return (getNodeFlags(ptr) & FLAG_DIRTY) != 0;
}

/**
 * Links a child node into the `firstChild` slot of a parent.
 * Overwrites any existing first child.
 */
export function setFirstChild(parentPtr: u32, childPtr: u32): void {
  store<u32>(parentPtr + NODE_OFFSET_FIRST_CHILD, childPtr, 0);
}

/**
 * Links a sibling node into the `nextSibling` slot of an existing sibling.
 * Forms the intrusive linked list of children.
 */
export function setNextSibling(siblingPtr: u32, nextPtr: u32): void {
  if (siblingPtr == 0) return;
  store<u32>(siblingPtr + NODE_OFFSET_NEXT_SIBLING, nextPtr, 0);
}

// ----------------------------------------------------------------------------
// AST Node Field Accessors
// ----------------------------------------------------------------------------

/** Retrieves the grammar production type ID from the node. */
export function getNodeType(ptr: u32): u16 {
  return (load<u32>(ptr, NODE_OFFSET_W0) & MASK_TYPE) as u16;
}

/**
 * Retrieves the byte padding (whitespace/comments) preceding this node.
 * Automatically resolves fat padding if the inline 16-bit field overflowed.
 */
export function getNodePadding(ptr: u32): u32 {
  let p = load<u32>(ptr, NODE_OFFSET_W0) >> SHIFT_PADDING;
  let isFat = (load<u32>(ptr + NODE_OFFSET_W1, 0) >> SHIFT_FAT_FLAG) & 1;
  if (isFat != 0) return load<u32>(S().fatPaddingArenaPtr + p * 4, 0);
  return p;
}

/** Mutates the padding of an existing node (clamped to 64KB inline limit). */
export function setNodePadding(ptr: u32, pad: u32): void {
  if (pad > MAX_PADDING) pad = MAX_PADDING;
  let val = load<u32>(ptr, NODE_OFFSET_W0);
  store<u32>(ptr, (val & MASK_PADDING_W0_KEEP) | (pad << SHIFT_PADDING), NODE_OFFSET_W0);
}

/** Retrieves the total byte length of the source text spanning this node. */
export function getNodeByteLength(ptr: u32): u32 {
  return load<u32>(ptr + NODE_OFFSET_W1, 0) & MASK_BYTE_LEN;
}

/** Mutates the byte length of an existing node (clamped to 8MB). */
export function setNodeByteLength(ptr: u32, len: u32): void {
  if (len > MASK_BYTE_LEN) len = MASK_BYTE_LEN;
  let val = load<u32>(ptr + NODE_OFFSET_W1, 0);
  store<u32>(ptr + NODE_OFFSET_W1, (val & MASK_W1_KEEP_UPPER) | len, 0);
}

/** Retrieves the 8-bit structural hash environment signature of this node. */
export function getNodeEnvHash(ptr: u32): u32 {
  return load<u32>(ptr + NODE_OFFSET_W1, 0) >> SHIFT_ENV_HASH;
}

/** Retrieves the arena pointer to the first child of this node. */
export function getNodeFirstChild(ptr: u32): u32 {
  return load<u32>(ptr + NODE_OFFSET_FIRST_CHILD, 0);
}

/** Retrieves the arena pointer to the next sibling of this node. */
export function getNodeNextSibling(ptr: u32): u32 {
  return load<u32>(ptr + NODE_OFFSET_NEXT_SIBLING, 0);
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
 * Flags a node as dirty, signaling that it has been manually mutated
 * and needs to be re-evaluated or re-emitted by the unparser.
 * @param ptr The node to flag.
 */
export function ast_markDirty(ptr: u32): void {
  // Flag the node as DIRTY. In a full implementation we would traverse upwards
  // to mark parents, or the unparser will simply spot this dirty node during traversal.
  if (ptr != 0) markDirty(ptr);
}

/** Map storing custom string literals that have been manually mutated. */
export const dirtyNodeStrings = new Map<u32, string>();

/**
 * Overrides the string value of a leaf node (e.g., an identifier or literal).
 * Also automatically flags the node as dirty so the unparser picks up the change.
 * @param ptr The target node.
 * @param val The new string literal value.
 */
export function ast_setLiteralString(ptr: u32, val: string): void {
  if (ptr != 0) {
    dirtyNodeStrings.set(ptr, val);
    ast_markDirty(ptr);
  }
}

/**
 * Retrieves the custom mutated string for a node, if one exists.
 * @param ptr The target node.
 * @returns The mutated string, or a placeholder if missing.
 */
export function ast_getLiteralString(ptr: u32): string {
  if (dirtyNodeStrings.has(ptr)) {
    return dirtyNodeStrings.get(ptr);
  }
  return "/* missing_literal */";
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

const cacheVisited = new Set<u32>();

/**
 * Recursively extracts and caches the raw UTF-8 string values of all leaf nodes in a subtree.
 * This is primarily used to preserve string data when extracting a branch of the AST
 * before a structural mutation invalidates the original buffer offsets.
 *
 * @param nodeId The root node of the subtree to cache.
 * @param absoluteStart The absolute byte offset of the node in the input buffer.
 */
export function cacheNodeStrings(nodeId: u32, absoluteStart: u32): void {
  cacheVisited.clear();
  cacheNodeStringsInner(nodeId, absoluteStart, 0);
}

/** Internal recursive helper for `cacheNodeStrings`. */
function cacheNodeStringsInner(nodeId: u32, absoluteStart: u32, depth: i32): void {
  // Guard against circular references and maximum recursion limits
  if (nodeId == 0 || depth > 200) return;
  if (cacheVisited.has(nodeId)) return;
  cacheVisited.add(nodeId);

  let child = getNodeFirstChild(nodeId);

  // 1. If it's a leaf node and has byteLength > 0, extract the text!
  if (child == 0 && getNodeByteLength(nodeId) > 0) {
    let ptr = getInputBuffer() + absoluteStart;
    let len = getNodeByteLength(nodeId);
    let str = String.UTF8.decodeUnsafe(ptr, len);
    dirtyNodeStrings.set(nodeId, str);
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
  let len = getNodeByteLength(nodeId);
  if (len == 0) return 0;

  let ptr = getInputBuffer() + absoluteStart;
  let hash: u32 = 0x811c9dc5; // FNV offset basis

  for (let i: u32 = 0; i < len; i++) {
    hash ^= load<u8>(ptr + i) as u32;
    hash = (hash * 0x01000193) >>> 0; // FNV prime
  }
  return hash;
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

  let lenA = getNodeByteLength(nodeA);
  let lenB = getNodeByteLength(nodeB);
  if (lenA != lenB) return false;

  let ptrA = getInputBuffer() + absoluteStartA;
  let ptrB = getInputBuffer() + absoluteStartB;

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
    S().gcStackPtr = atomicChunkAlloc(GC_STACK_CAPACITY * 4);
  }
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

  // Prime the stack with the explicitly retained root
  if (rootToKeep != 0) {
    store<u32>(S().gcStackPtr + stackTop * 4, rootToKeep, 0);
    stackTop++;
  }

  // Prime the stack with all actively registered multi-roots
  for (let i: u32 = 0; i < S().activeRootCount; i++) {
    if (stackTop < GC_STACK_CAPACITY) {
      store<u32>(S().gcStackPtr + stackTop * 4, load<u32>(S().activeRootsPtr + i * 4, 0), 0);
      stackTop++;
    }
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
        if (stackTop < GC_STACK_CAPACITY) {
          store<u32>(S().gcStackPtr + stackTop * 4, child, 0);
          stackTop++;
        }
        child = load<u32>(child + 12, 0); // follow intrusive sibling linked list
      }
    }
  }

  // --------------------------------------------------------------------------
  // Sweep Phase
  // --------------------------------------------------------------------------
  S().freeNodeHead = 0; // Reset free-list

  for (let i: u32 = 0; i < S().gen1_chunk_count; i++) {
    let start = load<u32>(S().gen1_chunks + i * 4);
    let sweepEnd = i == S().gen1_chunk_count - 1 ? S().gen1_offset : start + AST_CHUNK_SIZE;

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

    // Memory compaction optimization:
    // If a large contiguous block at the end of the final chunk was dead,
    // contract the bump allocator offset back to the last live node.
    if (i == S().gen1_chunk_count - 1 && lastLivePtr < S().gen1_offset) {
      S().gen1_offset = lastLivePtr;
      S().arenaOffset = lastLivePtr;
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
