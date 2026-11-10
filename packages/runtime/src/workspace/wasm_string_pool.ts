// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WASM String Pool Bridge — unified string interning backed by WebAssembly
 * linear memory (ArenaStringPool) with seamless host-side caching.
 *
 * Maps strings to unique integer IDs for memory-efficient storage in
 * Data-Oriented Design (DoD) arenas.
 */

export type StringId = number;

/** Sentinel value representing "no string" / null. */
export const NULL_STRING_ID: StringId = 0;

export interface IStringInterner {
  intern(s: string): StringId;
  resolve(id: StringId): string;
  has(s: string): boolean;
  tryGet(s: string): StringId;
  lookup(s: string): StringId | undefined;
  internPath(prefixId: StringId, nameId: StringId): StringId;
  getDerStringId?(innerNameId: StringId): StringId;
  readonly size: number;
  estimateMemoryBytes(): number;
}

/**
 * High-performance string pool backed by WebAssembly linear memory (`ArenaStringPool`)
 * with fallback to an in-process string table.
 */
export class WasmStringPool implements IStringInterner {
  // Pre-assigned IDs for hot-path lookup
  public static readonly NULL_ID: StringId = 0;
  public static readonly REAL: StringId = 1;
  public static readonly INTEGER: StringId = 2;
  public static readonly BOOLEAN: StringId = 3;
  public static readonly STRING: StringId = 4;
  public static readonly PARAMETER: StringId = 5;
  public static readonly CONSTANT: StringId = 6;
  public static readonly DISCRETE: StringId = 7;
  public static readonly CONTINUOUS: StringId = 8;
  public static readonly INPUT: StringId = 9;
  public static readonly OUTPUT: StringId = 10;

  private wasmExports: any = null;
  public poolPtr: number = 0;

  private utf8Encoder = new TextEncoder();
  private utf8Decoder = new TextDecoder("utf-8");

  // Host-side caches for $O(1)$ fast paths
  private table = new Map<string, StringId>();
  private shortTable = new Map<string, StringId>();
  private reverse: (string | undefined)[] = [];
  private pathCache = new Map<number, StringId>();

  // Reusable WASM scratch buffer pointer for string transfer
  private scratchPtr = 0;
  private scratchCapacity = 0;
  private _scratchView: Uint8Array | null = null;

  constructor(wasmExports?: any, poolPtr?: number) {
    if (wasmExports && (wasmExports.stringPool_internUtf8 || wasmExports.dae_createBuilder)) {
      this.wasmExports = wasmExports;
      this.poolPtr =
        poolPtr && poolPtr !== 0
          ? poolPtr
          : this.wasmExports.stringPool_create
            ? this.wasmExports.stringPool_create()
            : 0;
    }

    // Initialize ID 0 as empty string
    this.reverse[0] = "";
    this.table.set("", 0);
    this.shortTable.set("", 0);

    // Pre-assigned IDs
    this._internPredefined("Real", WasmStringPool.REAL);
    this._internPredefined("Integer", WasmStringPool.INTEGER);
    this._internPredefined("Boolean", WasmStringPool.BOOLEAN);
    this._internPredefined("String", WasmStringPool.STRING);
    this._internPredefined("parameter", WasmStringPool.PARAMETER);
    this._internPredefined("constant", WasmStringPool.CONSTANT);
    this._internPredefined("discrete", WasmStringPool.DISCRETE);
    this._internPredefined("continuous", WasmStringPool.CONTINUOUS);
    this._internPredefined("input", WasmStringPool.INPUT);
    this._internPredefined("output", WasmStringPool.OUTPUT);

    // Pre-intern common Modelica keywords
    const MODELICA_KEYWORDS = [
      "model",
      "record",
      "block",
      "connector",
      "type",
      "package",
      "function",
      "equation",
      "algorithm",
      "initial equation",
      "initial algorithm",
      "public",
      "protected",
      "encapsulated",
      "partial",
      "within",
      "extends",
      "import",
      "end",
      "annotation",
      "der",
      "time",
      "true",
      "false",
      "if",
      "then",
      "elseif",
      "else",
      "for",
      "while",
      "loop",
      "return",
      "break",
      "connect",
      "flow",
      "stream",
      "inner",
      "outer",
      "replaceable",
      "redeclare",
      "constrainedby",
      "final",
      "each",
      "pure",
      "impure",
    ];

    for (const kw of MODELICA_KEYWORDS) {
      this.intern(kw);
    }

    // Pre-intern canonical BuiltinMathFunc names at deterministic IDs (56 + BuiltinMathFunc.*)
    const BUILTIN_MATH_FUNCS = [
      "sin", // 56 + 0
      "cos", // 56 + 1
      "tan", // 56 + 2
      "asin", // 56 + 3
      "acos", // 56 + 4
      "atan", // 56 + 5
      "atan2", // 56 + 6
      "sinh", // 56 + 7
      "cosh", // 56 + 8
      "tanh", // 56 + 9
      "exp", // 56 + 10
      "log", // 56 + 11
      "log10", // 56 + 12
      "sqrt", // 56 + 13
      "abs", // 56 + 14
      "sign", // 56 + 15
      "min", // 56 + 16
      "max", // 56 + 17
      "floor", // 56 + 18
      "ceil", // 56 + 19
      "mod", // 56 + 20
      "pow", // 56 + 21
      "noEvent", // 56 + 22
      "smooth", // 56 + 23
      "homotopy", // 56 + 24
      "semiLinear", // 56 + 25
    ];

    for (const fn of BUILTIN_MATH_FUNCS) {
      this.intern(fn);
    }
  }

  private _internPredefined(s: string, expectedId: number) {
    const id = this.reverse.length;
    if (id !== expectedId) {
      // Pad if needed
      while (this.reverse.length < expectedId) {
        this.reverse.push(undefined);
      }
    }
    this.reverse[expectedId] = s;
    this.table.set(s, expectedId);
    this.shortTable.set(s, expectedId);
  }

  private _ensureScratch(size: number): number {
    const allocFn =
      this.wasmExports?.alloc ??
      this.wasmExports?.dae_alloc ??
      this.wasmExports?.arena_alloc ??
      this.wasmExports?.atomicChunkAlloc ??
      (typeof this.wasmExports?.__new === "function" ? (n: number) => this.wasmExports.__new(n, 0) : undefined);
    if (!allocFn || !this.wasmExports?.memory) return 0;
    if (
      this.scratchCapacity < size ||
      !this._scratchView ||
      this._scratchView.buffer !== this.wasmExports.memory.buffer
    ) {
      if (this.scratchCapacity < size) {
        if (this.scratchPtr && this.wasmExports.free) {
          this.wasmExports.free(this.scratchPtr);
        }
        this.scratchCapacity = Math.max(size, 256);
        this.scratchPtr = allocFn(this.scratchCapacity) >>> 0;
      }
      this._scratchView = new Uint8Array(this.wasmExports.memory.buffer, this.scratchPtr >>> 0, this.scratchCapacity);
    }
    return this.scratchPtr;
  }

  /**
   * Intern a string, returning its unique integer ID.
   */
  intern(s: string): StringId {
    if (s === "") return 0;

    // Fast path: short strings in JS map
    if (s.length < 16) {
      const cached = this.shortTable.get(s);
      if (cached !== undefined) return cached;
    } else {
      const cached = this.table.get(s);
      if (cached !== undefined) return cached;
    }

    // WASM path if active
    if (this.wasmExports?.stringPool_internUtf8 && this.poolPtr && this.wasmExports?.memory) {
      const maxLen = s.length * 3 + 1;
      const ptr = this._ensureScratch(maxLen);
      if (ptr && this._scratchView) {
        let written: number;
        if (this.utf8Encoder.encodeInto) {
          const res = this.utf8Encoder.encodeInto(s, this._scratchView);
          written = res.written;
        } else {
          const encoded = this.utf8Encoder.encode(s);
          written = encoded.length;
          this._scratchView.set(encoded, 0);
        }
        const id = this.wasmExports.stringPool_internUtf8(this.poolPtr, ptr, written);
        this.table.set(s, id);
        if (s.length < 16) this.shortTable.set(s, id);
        this.reverse[id] = s;
        return id;
      }
    }

    // Standalone JS fallback
    const id = this.reverse.length;
    this.reverse.push(s);
    this.table.set(s, id);
    if (s.length < 16) this.shortTable.set(s, id);
    return id;
  }

  /**
   * Look up an already interned string without inserting it.
   */
  lookup(s: string): StringId | undefined {
    if (s === "") return 0;
    if (s.length < 16) {
      const id = this.shortTable.get(s);
      if (id !== undefined) return id;
    }
    return this.table.get(s);
  }

  /**
   * Check if a string has already been interned.
   */
  has(s: string): boolean {
    if (s === "") return true;
    return this.table.has(s);
  }

  /**
   * Look up the StringId for a string without interning it, returning NULL_STRING_ID if not found.
   */
  tryGet(s: string): StringId {
    if (s === "") return 0;
    return this.table.get(s) ?? NULL_STRING_ID;
  }

  /**
   * Resolve a StringId back to the original string.
   */
  resolve(id: StringId): string {
    if (id <= 0) return "";
    if (id < this.reverse.length && this.reverse[id] !== undefined) {
      return this.reverse[id]!;
    }

    // WASM memory resolution if active
    if (this.wasmExports?.stringPool_getLength && this.poolPtr && this.wasmExports?.memory) {
      const len = this.wasmExports.stringPool_getLength(this.poolPtr, id);
      if (len > 0 && this.wasmExports.stringPool_copyOut) {
        const scratch = this._ensureScratch(len);
        if (scratch && this._scratchView) {
          this.wasmExports.stringPool_copyOut(this.poolPtr, id, scratch);
          const mem = this._scratchView.subarray(0, len);
          const str = this.utf8Decoder.decode(mem);
          this.reverse[id] = str;
          this.table.set(str, id);
          if (str.length < 16) this.shortTable.set(str, id);
          return str;
        }
      }
    }

    return "<invalid>";
  }

  /**
   * Interns a compound path "prefix.name" using StringIds.
   */
  internPath(prefixId: StringId, nameId: StringId): StringId {
    if (prefixId === NULL_STRING_ID || prefixId === -1 || prefixId === 0) return nameId;
    if (nameId === NULL_STRING_ID || nameId === -1 || nameId === 0) return prefixId;

    const key = prefixId * 67108864 + nameId;
    const cachedId = this.pathCache.get(key);
    if (cachedId !== undefined) return cachedId;

    const prefixStr = this.resolve(prefixId);
    const nameStr = this.resolve(nameId);
    const fullPath = `${prefixStr}.${nameStr}`;

    if (this.wasmExports?.stringPool_concatIds && this.poolPtr) {
      const id = this.wasmExports.stringPool_concatIds(this.poolPtr, prefixId, nameId);
      this.reverse[id] = fullPath;
      this.table.set(fullPath, id);
      if (fullPath.length < 16) this.shortTable.set(fullPath, id);
      this.pathCache.set(key, id);
      return id;
    }

    const id = this.intern(fullPath);
    this.pathCache.set(key, id);
    return id;
  }

  private derTable = new Map<StringId, StringId>();

  /**
   * Retrieves the interned StringId for der(<innerName>), caching the mapping to eliminate
   * runtime string allocations during symbolic derivative matching.
   */
  public getDerStringId(innerNameId: StringId): StringId {
    const cached = this.derTable.get(innerNameId);
    if (cached !== undefined) return cached;
    const str = this.resolve(innerNameId);
    if (!str) return 0;
    const derId = this.intern(`der(${str})`);
    this.derTable.set(innerNameId, derId);
    return derId;
  }

  /** The number of unique strings currently interned. */
  get size(): number {
    if (this.wasmExports?.stringPool_getSize && this.poolPtr) {
      return Math.max(this.reverse.length, this.wasmExports.stringPool_getSize(this.poolPtr));
    }
    return this.reverse.length;
  }

  /**
   * Estimate the memory usage of this pool in bytes.
   */
  estimateMemoryBytes(): number {
    let strBytes = 0;
    for (const s of this.reverse) {
      if (s) strBytes += s.length * 2 + 40;
    }
    const mapBytes = this.table.size * 80;
    const arrayBytes = this.reverse.length * 8;
    return strBytes + mapBytes + arrayBytes;
  }

  /**
   * Synchronizes all interned strings into a target WebAssembly ArenaStringPool instance.
   * Ensures that string IDs in linear memory match the host-side StringInterner IDs.
   */
  public syncToWasmPool(exports: any, targetPoolPtr: number): void {
    if (!exports?.stringPool_internUtf8 || !targetPoolPtr || !exports.memory) return;
    const synced = this.syncedCountByPool.get(targetPoolPtr) ?? 0;
    const startId = synced + 1;

    let totalCount = this.reverse.length;
    if (this.wasmExports?.stringPool_getSize && this.poolPtr) {
      const wasmCount = this.wasmExports.stringPool_getSize(this.poolPtr);
      if (wasmCount > totalCount) totalCount = wasmCount;
    }
    if (startId >= totalCount) return;

    const allocFn =
      exports.alloc ??
      exports.dae_alloc ??
      exports.arena_alloc ??
      exports.atomicChunkAlloc ??
      (typeof exports.__new === "function" ? (n: number) => exports.__new(n, 0) : undefined);
    if (!allocFn) return;

    let scratchCap = 1024;
    let scratchPtr = allocFn(scratchCap) >>> 0;
    let scratchView = new Uint8Array(exports.memory.buffer, scratchPtr >>> 0, scratchCap);

    for (let id = startId; id < totalCount; id++) {
      let s = this.reverse[id];
      if (s === undefined) {
        s = this.resolve(id);
      }
      if (s === undefined) continue;
      const maxLen = s.length * 3 + 1;
      if (maxLen > scratchCap || scratchView.buffer !== exports.memory.buffer) {
        if (exports.free) exports.free(scratchPtr);
        scratchCap = Math.max(maxLen, scratchCap * 2);
        scratchPtr = allocFn(scratchCap) >>> 0;
        scratchView = new Uint8Array(exports.memory.buffer, scratchPtr >>> 0, scratchCap);
      }
      let written: number;
      if (this.utf8Encoder.encodeInto) {
        written = this.utf8Encoder.encodeInto(s, scratchView).written;
      } else {
        const encoded = this.utf8Encoder.encode(s);
        written = encoded.length;
        scratchView.set(encoded, 0);
      }
      exports.stringPool_internUtf8(targetPoolPtr, scratchPtr, written);
    }
    if (exports.free) exports.free(scratchPtr);
    this.syncedCountByPool.set(targetPoolPtr, totalCount - 1);
  }

  private syncedCountByPool = new Map<number, number>();
}

export { WasmStringPool as StringInterner };
