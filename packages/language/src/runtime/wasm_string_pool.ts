// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

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
    if (!this.wasmExports?.alloc || !this.wasmExports?.memory) return 0;
    if (this.scratchCapacity < size) {
      if (this.scratchPtr && this.wasmExports.free) {
        this.wasmExports.free(this.scratchPtr);
      }
      this.scratchCapacity = Math.max(size, 256);
      this.scratchPtr = this.wasmExports.alloc(this.scratchCapacity);
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
      const encoded = this.utf8Encoder.encode(s);
      const len = encoded.length;
      const ptr = this._ensureScratch(len);
      if (ptr) {
        const memView = new Uint8Array(this.wasmExports.memory.buffer);
        memView.set(encoded, ptr);
        const id = this.wasmExports.stringPool_internUtf8(this.poolPtr, ptr, len);
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
    if (
      this.wasmExports?.stringPool_getOffset &&
      this.wasmExports?.stringPool_getLength &&
      this.poolPtr &&
      this.wasmExports?.memory
    ) {
      const offset = this.wasmExports.stringPool_getOffset(this.poolPtr, id);
      const len = this.wasmExports.stringPool_getLength(this.poolPtr, id);
      if (len > 0) {
        const mem = new Uint8Array(this.wasmExports.memory.buffer, offset, len);
        const str = this.utf8Decoder.decode(mem);
        this.reverse[id] = str;
        this.table.set(str, id);
        if (str.length < 16) this.shortTable.set(str, id);
        return str;
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

    if (this.wasmExports?.stringPool_concatIds && this.poolPtr) {
      const id = this.wasmExports.stringPool_concatIds(this.poolPtr, prefixId, nameId);
      this.pathCache.set(key, id);
      return id;
    }

    const prefixStr = this.resolve(prefixId);
    const nameStr = this.resolve(nameId);
    const id = this.intern(`${prefixStr}.${nameStr}`);
    this.pathCache.set(key, id);
    return id;
  }

  /** The number of unique strings currently interned. */
  get size(): number {
    if (this.wasmExports?.stringPool_getSize && this.poolPtr) {
      return this.wasmExports.stringPool_getSize(this.poolPtr);
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
}

export { WasmStringPool as StringInterner };
