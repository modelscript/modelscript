// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Scoped linear-memory scratch pool for WASM numerical & formal kernels.
 *
 * Eliminates permanent `wasm.__new` leaks and hardcoded linear-memory offsets (e.g. `1024`)
 * by reserving reusable, 8-byte-aligned scratch slabs per scope and releasing or resetting
 * them deterministically via `dispose()` / `Symbol.dispose`.
 */

export interface WasmMemoryHost {
  memory: WebAssembly.Memory;
  /** AssemblyScript runtime allocator (optional). */
  __new?: ((size: number, id: number) => number) | undefined;
  /** AssemblyScript GC pin (optional). */
  __pin?: ((ptr: number) => number) | undefined;
  /** AssemblyScript GC unpin (optional). */
  __unpin?: ((ptr: number) => void) | undefined;
  /** C/Emscripten malloc (optional). */
  malloc?: ((size: number) => number) | undefined;
  /** C/Emscripten free (optional). */
  free?: ((ptr: number) => void) | undefined;
  /** Emscripten underscore-prefixed malloc (optional). */
  _malloc?: ((size: number) => number) | undefined;
  /** Emscripten underscore-prefixed free (optional). */
  _free?: ((ptr: number) => void) | undefined;
  /** ModelScript arena chunk allocator (optional). */
  atomicChunkAlloc?: ((size: number) => number) | undefined;
  /** ModelScript arena chunk deallocator (optional). */
  atomicChunkFree?: ((ptr: number) => void) | undefined;
  /** ModelScript arena allocator alias (optional). */
  arena_alloc?: ((size: number) => number) | undefined;
  /** ModelScript arena deallocator alias (optional). */
  arena_free?: ((ptr: number) => void) | undefined;
}

export interface WasmSlice<T extends ArrayBufferView> {
  readonly ptr: number;
  readonly byteLength: number;
  /** Always returns a fresh view over the current `memory.buffer` (safe across `memory.grow`). */
  view(): T;
}

function align8(n: number): number {
  return (n + 7) & ~7;
}

/**
 * Reusable bump-allocated linear-memory slab inside a WASM instance.
 *
 * Call `scope()` before a solver step/invocation and `scope.dispose()` (or `using scope = pool.scope()`)
 * afterward to rewind the bump pointer with zero heap fragmentation and zero memory leaks.
 */
export class WasmScratchPool {
  private readonly host: WasmMemoryHost;
  private basePtr = 0;
  private capacityBytes = 0;
  private offset = 0;
  private readonly backingAllocations: Array<{ ptr: number; kind: "as" | "c" | "em" | "chunk" | "arena" }> = [];
  private disposed = false;

  constructor(host: WasmMemoryHost, initialCapacityBytes = 65536) {
    this.host = host;
    this.growSlab(align8(Math.max(64, initialCapacityBytes)));
  }

  private allocRaw(bytes: number): { ptr: number; kind: "as" | "c" | "em" | "chunk" | "arena" } {
    if (typeof this.host.atomicChunkAlloc === "function") {
      const ptr = this.host.atomicChunkAlloc(bytes) >>> 0;
      if (ptr === 0) throw new Error(`WasmScratchPool: atomicChunkAlloc(${bytes}) returned null`);
      return { ptr, kind: "chunk" };
    }
    if (typeof this.host.arena_alloc === "function") {
      const ptr = this.host.arena_alloc(bytes) >>> 0;
      if (ptr === 0) throw new Error(`WasmScratchPool: arena_alloc(${bytes}) returned null`);
      return { ptr, kind: "arena" };
    }
    if (typeof this.host._malloc === "function") {
      const ptr = this.host._malloc(bytes);
      if (ptr === 0) throw new Error(`WasmScratchPool: _malloc(${bytes}) returned null`);
      return { ptr, kind: "em" };
    }
    if (typeof this.host.malloc === "function") {
      const ptr = this.host.malloc(bytes);
      if (ptr === 0) throw new Error(`WasmScratchPool: malloc(${bytes}) returned null`);
      return { ptr, kind: "c" };
    }
    if (typeof this.host.__new === "function") {
      const ptr = this.host.__new(bytes, 0);
      if (ptr === 0) throw new Error(`WasmScratchPool: __new(${bytes}) returned null`);
      if (typeof this.host.__pin === "function") {
        this.host.__pin(ptr);
      }
      return { ptr, kind: "as" };
    }
    throw new Error("WasmScratchPool: host exports neither atomicChunkAlloc, arena_alloc, _malloc, malloc, nor __new");
  }

  private freeRaw(entry: { ptr: number; kind: "as" | "c" | "em" | "chunk" | "arena" }): void {
    if (entry.kind === "chunk" && typeof this.host.atomicChunkFree === "function") {
      this.host.atomicChunkFree(entry.ptr);
    } else if (entry.kind === "arena" && typeof this.host.arena_free === "function") {
      this.host.arena_free(entry.ptr);
    } else if (entry.kind === "em" && typeof this.host._free === "function") {
      this.host._free(entry.ptr);
    } else if (entry.kind === "c" && typeof this.host.free === "function") {
      this.host.free(entry.ptr);
    } else if (entry.kind === "as" && typeof this.host.__unpin === "function") {
      this.host.__unpin(entry.ptr);
    }
  }

  private growSlab(minBytes: number): void {
    const allocBytes = align8(Math.max(minBytes, this.capacityBytes * 2, 65536));
    const entry = this.allocRaw(allocBytes);
    this.backingAllocations.push(entry);
    this.basePtr = entry.ptr;
    this.capacityBytes = allocBytes;
    this.offset = 0;
  }

  /** Reserves `byteLength` bytes (8-byte aligned) in linear memory. */
  public allocBytes(byteLength: number): number {
    if (this.disposed) throw new Error("WasmScratchPool: cannot allocate from disposed pool");
    const size = align8(Math.max(8, byteLength));
    if (this.offset + size > this.capacityBytes) {
      this.growSlab(size);
    }
    const ptr = this.basePtr + this.offset;
    this.offset += size;
    return ptr;
  }

  public allocF64(length: number): WasmSlice<Float64Array> {
    const byteLength = length * 8;
    const ptr = this.allocBytes(byteLength);
    const memory = this.host.memory;
    return {
      ptr,
      byteLength,
      view: () => new Float64Array(memory.buffer, ptr, length),
    };
  }

  public allocI32(length: number): WasmSlice<Int32Array> {
    const byteLength = length * 4;
    const ptr = this.allocBytes(byteLength);
    const memory = this.host.memory;
    return {
      ptr,
      byteLength,
      view: () => new Int32Array(memory.buffer, ptr, length),
    };
  }

  public allocU8(length: number): WasmSlice<Uint8Array> {
    const byteLength = length;
    const ptr = this.allocBytes(byteLength);
    const memory = this.host.memory;
    return {
      ptr,
      byteLength,
      view: () => new Uint8Array(memory.buffer, ptr, length),
    };
  }

  /** Creates a nested scope that rewinds the bump offset on `dispose()`. */
  public scope(): WasmScratchScope {
    return new WasmScratchScope(this, this.basePtr, this.offset);
  }

  /** @internal */
  public _restore(savedBase: number, savedOffset: number): void {
    if (this.basePtr === savedBase) {
      this.offset = savedOffset;
    } else {
      // A slab growth occurred inside the scope; reset to start of the newest slab
      this.offset = 0;
    }
    // When rewound to the top-level offset 0, release any superseded slabs so long sessions don't retain them
    if (this.offset === 0 && this.backingAllocations.length > 1) {
      const latest = this.backingAllocations[this.backingAllocations.length - 1]!;
      for (let i = 0; i < this.backingAllocations.length - 1; i++) {
        this.freeRaw(this.backingAllocations[i]!);
      }
      this.backingAllocations.length = 1;
      this.backingAllocations[0] = latest;
    }
  }

  /** Releases all backing linear-memory slabs (unpinning AS allocations or freeing C allocations). */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.backingAllocations) {
      this.freeRaw(entry);
    }
    this.backingAllocations.length = 0;
    this.basePtr = 0;
    this.capacityBytes = 0;
    this.offset = 0;
  }

  public [Symbol.dispose](): void {
    this.dispose();
  }
}

export class WasmScratchScope {
  private readonly pool: WasmScratchPool;
  private readonly savedBase: number;
  private readonly savedOffset: number;
  private closed = false;

  constructor(pool: WasmScratchPool, savedBase: number, savedOffset: number) {
    this.pool = pool;
    this.savedBase = savedBase;
    this.savedOffset = savedOffset;
  }

  public allocF64(length: number): WasmSlice<Float64Array> {
    return this.pool.allocF64(length);
  }

  public allocI32(length: number): WasmSlice<Int32Array> {
    return this.pool.allocI32(length);
  }

  public allocU8(length: number): WasmSlice<Uint8Array> {
    return this.pool.allocU8(length);
  }

  public dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.pool._restore(this.savedBase, this.savedOffset);
  }

  public [Symbol.dispose](): void {
    this.dispose();
  }
}
