// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Typed Arena Allocator — a growable, append-only pool of fixed-stride
 * records backed by TypedArrays.
 *
 * Used across the DoD pipeline to store flat records (symbol entries,
 * variables, equations, expressions) as contiguous integer/float columns
 * instead of JavaScript objects.
 *
 * Properties:
 * - Append-only: slots are never freed individually (arena-level reset only).
 * - O(1) allocation (amortized, with geometric growth).
 * - Zero GC pressure: TypedArrays are not traced by V8's garbage collector.
 * - Cache-friendly: contiguous memory layout for sequential iteration.
 */

/** Supported TypedArray constructors for arena backing buffers. */
type TypedArrayConstructor =
  | Int8ArrayConstructor
  | Uint8ArrayConstructor
  | Int16ArrayConstructor
  | Uint16ArrayConstructor
  | Int32ArrayConstructor
  | Uint32ArrayConstructor
  | Float32ArrayConstructor
  | Float64ArrayConstructor
  | BigInt64ArrayConstructor
  | BigUint64ArrayConstructor;

/** Union of all TypedArray types. */
type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

/**
 * A single-column arena backed by a single TypedArray.
 * Each slot is one element of the array.
 *
 * Use `StructArena` for multi-field records with a stride > 1.
 */
export class Arena<T extends TypedArray> {
  private buffer: T;
  private _length = 0;
  private readonly Ctor: TypedArrayConstructor;

  /**
   * @param Ctor - The TypedArray constructor (e.g., `Int32Array`, `Float64Array`).
   * @param initialCapacity - Initial number of slots to allocate.
   */
  constructor(Ctor: TypedArrayConstructor, initialCapacity = 1024) {
    this.Ctor = Ctor;
    this.buffer = new (Ctor as any)(initialCapacity) as T;
  }

  /** Allocate a new slot, returning its index. */
  alloc(): number {
    const idx = this._length++;
    if (idx >= this.buffer.length) this.grow();
    return idx;
  }

  /** Read the value at slot `idx`. */
  get(idx: number): number | bigint {
    return (this.buffer as any)[idx];
  }

  /** Write `value` to slot `idx`. */
  set(idx: number, value: number | bigint): void {
    (this.buffer as any)[idx] = value;
  }

  /** Current number of allocated slots. */
  get length(): number {
    return this._length;
  }

  /** Current capacity (may be larger than length). */
  get capacity(): number {
    return this.buffer.length;
  }

  /** Direct access to the underlying buffer (read-only view up to length). */
  view(): T {
    return (this.buffer as any).subarray(0, this._length) as T;
  }

  /** Reset the arena without freeing memory (reuse existing buffer). */
  clear(): void {
    this._length = 0;
  }

  /** Release the underlying buffer for garbage collection. */
  release(): void {
    this._length = 0;
    this.buffer = new (this.Ctor as any)(0) as T;
  }

  /** Estimate memory usage in bytes. */
  estimateMemoryBytes(): number {
    return this.buffer.byteLength;
  }

  private grow(): void {
    const newCapacity = Math.max(this.buffer.length * 2, 16);
    const newBuf = new (this.Ctor as any)(newCapacity) as T;
    (newBuf as any).set(this.buffer);
    this.buffer = newBuf;
  }
}

/**
 * A multi-field struct arena where each record has a fixed `stride`
 * (number of fields per record).
 *
 * Example: A variable record with fields [nameId, type, variability, causality, startValue]
 * has stride=5. Field 0 is nameId, field 1 is type, etc.
 *
 * ```typescript
 * const vars = new StructArena(Int32Array, 5);
 * const idx = vars.alloc();
 * vars.set(idx, 0, nameStringId);  // field 0: name
 * vars.set(idx, 1, typeEnum);      // field 1: type
 * ```
 */
export class StructArena<T extends TypedArray> {
  private buffer: T;
  private _length = 0;
  private readonly Ctor: TypedArrayConstructor;
  readonly stride: number;

  /**
   * @param Ctor - The TypedArray constructor.
   * @param stride - Number of fields per record.
   * @param initialCapacity - Initial number of records to allocate.
   */
  constructor(Ctor: TypedArrayConstructor, stride: number, initialCapacity = 1024) {
    this.Ctor = Ctor;
    this.stride = stride;
    this.buffer = new (Ctor as any)(initialCapacity * stride) as T;
  }

  /** Allocate a new record slot, returning the record index. */
  alloc(): number {
    const idx = this._length++;
    if (idx * this.stride >= this.buffer.length) this.grow();
    return idx;
  }

  /** Read field `field` of record `idx`. */
  get(idx: number, field: number): number | bigint {
    return (this.buffer as any)[idx * this.stride + field];
  }

  /** Write `value` to field `field` of record `idx`. */
  set(idx: number, field: number, value: number | bigint): void {
    (this.buffer as any)[idx * this.stride + field] = value;
  }

  /** Current number of allocated records. */
  get length(): number {
    return this._length;
  }

  /** Current capacity in records. */
  get capacity(): number {
    return Math.floor(this.buffer.length / this.stride);
  }

  /** Direct access to the underlying buffer. */
  rawBuffer(): T {
    return this.buffer;
  }

  /** Get a view of the raw data up to the current length. */
  view(): T {
    return (this.buffer as any).subarray(0, this._length * this.stride) as T;
  }

  /** Reset without freeing memory. */
  clear(): void {
    this._length = 0;
  }

  /** Release the underlying buffer for garbage collection. */
  release(): void {
    this._length = 0;
    this.buffer = new (this.Ctor as any)(0) as T;
  }

  /** Estimate memory usage in bytes. */
  estimateMemoryBytes(): number {
    return this.buffer.byteLength;
  }

  private grow(): void {
    const newCapacity = Math.max(Math.floor(this.buffer.length / this.stride) * 2, 16);
    const newBuf = new (this.Ctor as any)(newCapacity * this.stride) as T;
    (newBuf as any).set(this.buffer);
    this.buffer = newBuf;
  }
}
