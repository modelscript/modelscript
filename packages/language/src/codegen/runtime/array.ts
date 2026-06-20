/* eslint-disable */
// @ts-nocheck
// Chunked Array for Zero-GC Memory Growth
import { atomicChunkAlloc } from "./arena";

const CHUNK_BITS: u32 = 12;
const CHUNK_SIZE: u32 = 1 << CHUNK_BITS;
const CHUNK_MASK: u32 = CHUNK_SIZE - 1;
const CHUNK_BYTE_SIZE: u32 = CHUNK_SIZE * 4;

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
export class ChunkedArray<T> {
  public directory: usize;
  private dirCapacity: u32;
  private allocatedChunks: u32;
  public length: u32;

  constructor(initialElements: u32 = 0) {
    this.init(initialElements);
  }

  public init(initialElements: u32 = 0): void {
    this.dirCapacity = 1024;
    this.directory = atomicChunkAlloc(this.dirCapacity * sizeof<usize>());
    this.allocatedChunks = 0;
    this.length = 0;

    let initialChunks = (initialElements + CHUNK_SIZE - 1) >> CHUNK_BITS;
    if (initialChunks == 0) initialChunks = 1;
    for (let i: u32 = 0; i < initialChunks; i++) {
      this.addChunk();
    }
  }

  @inline
  private addChunk(): void {
    if (this.allocatedChunks >= this.dirCapacity) {
      let newDirCapacity = this.dirCapacity == 0 ? 1024 : this.dirCapacity * 2;
      let newDirectory = atomicChunkAlloc(newDirCapacity * sizeof<usize>());
      memory.copy(newDirectory, this.directory, this.dirCapacity * sizeof<usize>());
      this.directory = newDirectory;
      this.dirCapacity = newDirCapacity;
    }
    let chunkBytes = CHUNK_SIZE * sizeof<T>();
    let newChunk = atomicChunkAlloc(chunkBytes);
    memory.fill(newChunk, 0, chunkBytes);
    store<usize>(this.directory + this.allocatedChunks * sizeof<usize>(), newChunk);
    this.allocatedChunks++;
  }

  @inline
  public push(value: T): void {
    let chunkIdx = this.length >> CHUNK_BITS;
    if (chunkIdx >= this.allocatedChunks) {
      this.addChunk();
    }
    let chunkPtr = load<usize>(this.directory + chunkIdx * sizeof<usize>());
    let localOffset = this.length & CHUNK_MASK;
    store<T>(chunkPtr + localOffset * sizeof<T>(), value);
    this.length++;
  }

  @inline
  public get(index: u32): T {
    let chunkIdx = index >> CHUNK_BITS;
    if (chunkIdx >= this.allocatedChunks) return 0 as T;
    let chunkPtr = load<usize>(this.directory + chunkIdx * sizeof<usize>());
    let localOffset = index & CHUNK_MASK;
    return load<T>(chunkPtr + localOffset * sizeof<T>());
  }

  @inline
  @operator("[]")
  public __get(index: i32): T {
    return this.get(index as u32);
  }

  @inline
  public set(index: u32, value: T): void {
    let chunkIdx = index >> CHUNK_BITS;
    while (chunkIdx >= this.allocatedChunks) {
      this.addChunk();
    }
    let chunkPtr = load<usize>(this.directory + chunkIdx * sizeof<usize>());
    let localOffset = index & CHUNK_MASK;
    store<T>(chunkPtr + localOffset * sizeof<T>(), value);
    if (index >= this.length) {
      this.length = index + 1;
    }
  }

  @inline
  @operator("[]=")
  public __set(index: i32, value: T): void {
    this.set(index as u32, value);
  }

  @inline
  public pop(): T {
    if (this.length == 0) return 0 as T;
    this.length--;
    return this.get(this.length);
  }

  @inline
  public clear(): void {
    this.length = 0;
  }

  @inline
  public copyFrom(src: ChunkedArray<T>, count: u32): void {
    if (count == 0) return;

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

    let requiredChunks = (count + CHUNK_SIZE - 1) >> CHUNK_BITS;
    while (this.allocatedChunks < requiredChunks) {
      this.addChunk();
    }

    for (let i: u32 = 0; i < requiredChunks; i++) {
      let srcChunk = load<usize>(src.directory + i * sizeof<usize>());
      let destChunk = load<usize>(this.directory + i * sizeof<usize>());

      let elementsRemaining = count - (i << CHUNK_BITS);
      let copyElements = elementsRemaining < CHUNK_SIZE ? elementsRemaining : CHUNK_SIZE;

      memory.copy(destChunk, srcChunk, copyElements * sizeof<T>());
    }

    if (count > this.length) {
      this.length = count;
    }
  }
}

export class ChunkedUint32Array extends ChunkedArray<u32> {}

export class ChunkedInt32Array extends ChunkedArray<i32> {}

export class ChunkedFloat64Array extends ChunkedArray<f64> {}

export class ChunkedUint8Array extends ChunkedArray<u8> {}

export function createChunkedUint32Array(initialElements: u32 = 0): ChunkedUint32Array {
  let ptr = atomicChunkAlloc(offsetof<ChunkedUint32Array>());
  let arr = changetype<ChunkedUint32Array>(ptr);
  arr.init(initialElements);
  return arr;
}

export function createChunkedInt32Array(initialElements: u32 = 0): ChunkedInt32Array {
  let ptr = atomicChunkAlloc(offsetof<ChunkedInt32Array>());
  let arr = changetype<ChunkedInt32Array>(ptr);
  arr.init(initialElements);
  return arr;
}
