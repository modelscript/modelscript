/* eslint-disable */
// @ts-nocheck
// Chunked Array for Zero-GC Memory Growth
import { atomicChunkAlloc } from "./arena";

// 2^12 = 4096. Used for fast division to find the chunk index.
@inline function CHUNK_BITS(): u32 { return 12; }

// The fixed number of elements per chunk (page size).
@inline function CHUNK_SIZE(): u32 { return 4096; }

// 4095 (0xFFF). Used for fast modulo operation to find the local offset within a chunk.
@inline function CHUNK_MASK(): u32 { return 4095; }

/**
 * A zero-GC, linear-memory array implementation.
 *
 * Works like a two-level page table to provide dynamically growable arrays
 * without ever needing to reallocate or copy old data. When the array grows
 * beyond its current bounds, a new chunk (page) of `CHUNK_SIZE` is allocated
 * and added to the directory.
 *
 * This is crucial for performance because the built-in AssemblyScript `Array<T>`
 * uses standard malloc/realloc which fragments memory and triggers GC pauses.
 */
@unmanaged
export class ChunkedArray<T> {
  public directory: usize;
  private dirCapacity: u32;
  private allocatedChunks: u32;
  public length: u32;

  // Unmanaged classes cannot have a standard constructor, they are instantiated via changetype.

  /**
   * Initializes the array directory and pre-allocates chunks based on the requested initial capacity.
   * @param initialElements The expected number of elements, used to eagerly allocate chunks.
   */
  public init(initialElements: u32 = 0): void {
    this.dirCapacity = 1024;
    this.directory = atomicChunkAlloc(this.dirCapacity * sizeof<usize>());
    this.allocatedChunks = 0;
    this.length = 0;

    let initialChunks = (initialElements + CHUNK_SIZE() - 1) >> CHUNK_BITS();
    if (initialChunks == 0) initialChunks = 1;
    for (let i: u32 = 0; i < initialChunks; i++) {
      this.addChunk();
    }
  }

  /**
   * Appends a new 4096-element chunk to the array.
   * If the directory (page table) is full, it dynamically doubles the directory size
   * via an unmanaged allocation and copies the old pointers over.
   */
  @inline
  private addChunk(): void {
    if (this.allocatedChunks >= this.dirCapacity) {
      let newDirCapacity = this.dirCapacity == 0 ? 1024 : this.dirCapacity * 2;
      let newDirectory = atomicChunkAlloc(newDirCapacity * sizeof<usize>());
      memory.copy(newDirectory, this.directory, this.dirCapacity * sizeof<usize>());
      this.directory = newDirectory;
      this.dirCapacity = newDirCapacity;
    }
    let chunkBytes = CHUNK_SIZE() * sizeof<T>();
    let newChunk = atomicChunkAlloc(chunkBytes);
    memory.fill(newChunk, 0, chunkBytes);
    store<usize>(this.directory + this.allocatedChunks * sizeof<usize>(), newChunk);
    this.allocatedChunks++;
  }

  /**
   * Appends a single value to the end of the array.
   * Automatically provisions a new chunk if the array crosses a 4096-element boundary.
   * @param value The value to append.
   */
  @inline
  public push(value: T): void {
    let chunkIdx = this.length >> CHUNK_BITS();
    if (chunkIdx >= this.allocatedChunks) {
      this.addChunk();
    }
    let chunkPtr = load<usize>(this.directory + chunkIdx * sizeof<usize>());
    let localOffset = this.length & CHUNK_MASK();
    store<T>(chunkPtr + localOffset * sizeof<T>(), value);
    this.length++;
  }

  /**
   * Retrieves an element at the specified index.
   * Returns 0 (or null equivalent) if the index points to an unallocated chunk.
   * @param index The global array index.
   * @returns The value at the index.
   */
  @inline
  public get(index: u32): T {
    let chunkIdx = index >> CHUNK_BITS();
    if (chunkIdx >= this.allocatedChunks) return 0 as T;
    let chunkPtr = load<usize>(this.directory + chunkIdx * sizeof<usize>());
    let localOffset = index & CHUNK_MASK();
    return load<T>(chunkPtr + localOffset * sizeof<T>());
  }

  /**
   * Operator overload for bracket read access (e.g., `arr[idx]`).
   * Safely traps negative indices to prevent bounds wrapping and memory violations.
   */
  @inline
  @operator("[]")
  public __get(index: i32): T {
    if (index < 0) return 0 as T;
    return this.get(index as u32);
  }

  /**
   * Mutates the element at the specified index.
   * If the index exceeds currently allocated bounds, it sequentially allocates
   * new chunks until the index is reachable.
   * @param index The global array index.
   * @param value The new value to set.
   */
  @inline
  public set(index: u32, value: T): void {
    let chunkIdx = index >> CHUNK_BITS();
    while (chunkIdx >= this.allocatedChunks) {
      this.addChunk();
    }
    let chunkPtr = load<usize>(this.directory + chunkIdx * sizeof<usize>());
    let localOffset = index & CHUNK_MASK();
    store<T>(chunkPtr + localOffset * sizeof<T>(), value);
    if (index >= this.length) {
      this.length = index + 1;
    }
  }

  /**
   * Operator overload for bracket write access (e.g., `arr[idx] = val`).
   * Safely traps negative indices. Without this guard, `arr[-1]` would wrap to
   * `4,294,967,295`, triggering the allocation of >16GB of chunks and immediately OOM crashing.
   */
  @inline
  @operator("[]=")
  public __set(index: i32, value: T): void {
    if (index < 0) return; // Prevent OOM loops when index wraps to a massive u32
    this.set(index as u32, value);
  }

  /**
   * Removes and returns the last element of the array.
   * Does not deallocate chunks (memory remains provisioned for future growth).
   */
  @inline
  public pop(): T {
    if (this.length == 0) return 0 as T;
    this.length--;
    return this.get(this.length);
  }

  /**
   * Resets the array length to 0.
   * Previously allocated chunks are preserved for zero-allocation reuse.
   */
  @inline
  public clear(): void {
    this.length = 0;
  }

  /**
   * Bulk-copies elements from a source ChunkedArray.
   * Extremely optimized for zero-GC mass array cloning (e.g., AST stack duplication).
   * @param src The source array to copy from.
   * @param count The number of elements to copy starting from index 0.
   */
  @inline
  public copyFrom(src: ChunkedArray<T>, count: u32): void {
    if (count == 0) return;

    // Fast-path: Small copies (<= 128 elements) are sequentially looped from the first chunk.
    // Avoids the overhead of chunk math and memory.copy intrinsics for trivial payload sizes.
    if (count <= 128) {
      let srcChunk = load<usize>(src.directory);
      let destChunk = load<usize>(this.directory);
      for (let i: u32 = 0; i < count; i++) {
        store<T>(destChunk + i * sizeof<T>(), load<T>(srcChunk + i * sizeof<T>()));
      }
      if (count > this.length) {
        this.length = count;
      }
      return;
    }

    // Slow-path: Mass memory duplication.
    // 1. Ensure the destination has enough chunks provisioned.
    let requiredChunks = (count + CHUNK_SIZE() - 1) >> CHUNK_BITS();
    while (this.allocatedChunks < requiredChunks) {
      this.addChunk();
    }

    // 2. Perform bulk `memory.copy` per chunk.
    for (let i: u32 = 0; i < requiredChunks; i++) {
      let srcChunk = load<usize>(src.directory + i * sizeof<usize>());
      let destChunk = load<usize>(this.directory + i * sizeof<usize>());

      // Calculate how many elements remain to be copied.
      // If it's the last chunk, it might not be completely full.
      let elementsRemaining = count - (i << CHUNK_BITS());
      let copyElements = elementsRemaining < CHUNK_SIZE() ? elementsRemaining : CHUNK_SIZE();

      memory.copy(destChunk, srcChunk, copyElements * sizeof<T>());
    }

    if (count > this.length) {
      this.length = count;
    }
  }

  /**
   * Bulk-copies elements from the ChunkedArray to a flat unmanaged memory buffer.
   * Useful for exporting chunked data to JS via a contiguous array pointer.
   * @param destPtr The memory address of the flat destination array.
   */
  @inline
  public copyToFlat(destPtr: usize): void {
    if (this.length == 0) return;
    
    let chunks = (this.length + CHUNK_SIZE() - 1) >> CHUNK_BITS();
    for (let i: u32 = 0; i < chunks; i++) {
      let srcChunk = load<usize>(this.directory + i * sizeof<usize>());
      let elementsInChunk = (i == chunks - 1) ? (this.length - (i << CHUNK_BITS())) : CHUNK_SIZE();
      memory.copy(destPtr + i * CHUNK_SIZE() * sizeof<T>(), srcChunk, elementsInChunk * sizeof<T>());
    }
  }
}

@unmanaged
export class ChunkedUint32Array extends ChunkedArray<u32> {}

@unmanaged
export class ChunkedInt32Array extends ChunkedArray<i32> {}

@unmanaged
export class ChunkedFloat64Array extends ChunkedArray<f64> {}

@unmanaged
export class ChunkedUint8Array extends ChunkedArray<u8> {}

/**
 * Factory function to safely instantiate an unmanaged `ChunkedUint32Array`.
 * Bypasses the `new` keyword to allocate directly from the `atomicChunkAlloc` linear arena.
 * @param initialElements The number of elements to pre-allocate chunks for.
 */
export function createChunkedUint32Array(initialElements: u32 = 0): ChunkedUint32Array {
  let ptr = atomicChunkAlloc(offsetof<ChunkedUint32Array>());
  let arr = changetype<ChunkedUint32Array>(ptr);
  arr.init(initialElements);
  return arr;
}

/**
 * Factory function to safely instantiate an unmanaged `ChunkedInt32Array`.
 * Bypasses the `new` keyword to allocate directly from the `atomicChunkAlloc` linear arena.
 * @param initialElements The number of elements to pre-allocate chunks for.
 */
export function createChunkedInt32Array(initialElements: u32 = 0): ChunkedInt32Array {
  let ptr = atomicChunkAlloc(offsetof<ChunkedInt32Array>());
  let arr = changetype<ChunkedInt32Array>(ptr);
  arr.init(initialElements);
  return arr;
}

export function createChunkedFloat64Array(initialElements: u32 = 0): ChunkedFloat64Array {
  let ptr = atomicChunkAlloc(offsetof<ChunkedFloat64Array>());
  let arr = changetype<ChunkedFloat64Array>(ptr);
  arr.init(initialElements);
  return arr;
}

export function createChunkedUint8Array(initialElements: u32 = 0): ChunkedUint8Array {
  let ptr = atomicChunkAlloc(offsetof<ChunkedUint8Array>());
  let arr = changetype<ChunkedUint8Array>(ptr);
  arr.init(initialElements);
  return arr;
}

@unmanaged
export class UnmanagedInt32Array {
  @inline @operator("[]") get(index: i32): i32 {
    return load<i32>(changetype<usize>(this) + ((index as u32) << 2));
  }
  @inline @operator("[]=") set(index: i32, value: i32): void {
    store<i32>(changetype<usize>(this) + ((index as u32) << 2), value);
  }
}

@unmanaged
export class UnmanagedUint32Array {
  @inline @operator("[]") get(index: i32): u32 {
    return load<u32>(changetype<usize>(this) + ((index as u32) << 2));
  }
  @inline @operator("[]=") set(index: i32, value: u32): void {
    store<u32>(changetype<usize>(this) + ((index as u32) << 2), value);
  }
  @inline atomicGet(index: i32): u32 {
    return atomic.load<u32>(changetype<usize>(this) + ((index as u32) << 2));
  }
  @inline atomicSet(index: i32, value: u32): void {
    atomic.store<u32>(changetype<usize>(this) + ((index as u32) << 2), value);
  }
  @inline atomicCmpxchg(index: i32, expected: u32, replacement: u32): u32 {
    return atomic.cmpxchg<u32>(changetype<usize>(this) + ((index as u32) << 2), expected, replacement);
  }
  @inline atomicAdd(index: i32, value: u32): u32 {
    return atomic.add<u32>(changetype<usize>(this) + ((index as u32) << 2), value);
  }
}


@unmanaged
export class UnmanagedUint16Array {
  @inline @operator("[]") get(index: i32): u16 {
    return load<u16>(changetype<usize>(this) + ((index as u32) << 1));
  }
  @inline @operator("[]=") set(index: i32, value: u16): void {
    store<u16>(changetype<usize>(this) + ((index as u32) << 1), value);
  }
}

@unmanaged
export class UnmanagedUint8Array {
  @inline @operator("[]") get(index: i32): u8 {
    return load<u8>(changetype<usize>(this) + (index as u32));
  }
  @inline @operator("[]=") set(index: i32, value: u8): void {
    store<u8>(changetype<usize>(this) + (index as u32), value);
  }
}
