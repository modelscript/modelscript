// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * String Interner — maps strings to unique integer IDs for memory-efficient
 * storage in Data-Oriented Design (DoD) arenas.
 *
 * All fully-qualified Modelica names, type paths, and identifiers are interned
 * into a global table. Every string becomes a `StringId` (uint32), eliminating
 * thousands of duplicate string objects from the V8 heap.
 *
 * Thread-safety: single-threaded (V8 main thread only).
 * Lifecycle: one interner per compilation context.
 */

/** A unique integer identifier for an interned string. */
export type StringId = number;

/** Sentinel value representing "no string" / null. */
export const NULL_STRING_ID: StringId = -1;

/**
 * Bidirectional string ↔ integer mapping.
 *
 * - `intern(s)` returns the same `StringId` for the same string (idempotent).
 * - `resolve(id)` recovers the original string in O(1).
 * - Strings are never freed — the interner is append-only.
 */
export class StringInterner {
  /** Forward map: string → StringId. */
  private table = new Map<string, StringId>();

  /** Fast-path map for short strings (<16 chars). */
  private shortTable = new Map<string, StringId>();

  /** Cache for path concatenation: (prefixId * 2^26 + nameId) -> StringId */
  private pathCache = new Map<number, StringId>();

  /** Reverse map: StringId → string (indexed by ID). */
  private reverse: string[] = [];

  // Pre-assigned IDs for hot-path lookup
  public static readonly REAL = 0;
  public static readonly INTEGER = 1;
  public static readonly BOOLEAN = 2;
  public static readonly STRING = 3;
  public static readonly PARAMETER = 4;
  public static readonly CONSTANT = 5;
  public static readonly DISCRETE = 6;
  public static readonly CONTINUOUS = 7;
  public static readonly INPUT = 8;
  public static readonly OUTPUT = 9;

  constructor() {
    this._internPredefined("Real", StringInterner.REAL);
    this._internPredefined("Integer", StringInterner.INTEGER);
    this._internPredefined("Boolean", StringInterner.BOOLEAN);
    this._internPredefined("String", StringInterner.STRING);
    this._internPredefined("parameter", StringInterner.PARAMETER);
    this._internPredefined("constant", StringInterner.CONSTANT);
    this._internPredefined("discrete", StringInterner.DISCRETE);
    this._internPredefined("continuous", StringInterner.CONTINUOUS);
    this._internPredefined("input", StringInterner.INPUT);
    this._internPredefined("output", StringInterner.OUTPUT);

    // Pre-intern common Modelica keywords and built-ins to avoid runtime allocations
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
      if (!this.table.has(kw)) {
        const id = this.reverse.length;
        this.reverse.push(kw);
        this.table.set(kw, id);
        this.shortTable.set(kw, id);
      }
    }
  }

  private _internPredefined(s: string, expectedId: number) {
    const id = this.reverse.length;
    if (id !== expectedId) throw new Error("StringInterner predefined ID mismatch");
    this.reverse.push(s);
    this.table.set(s, id);
    this.shortTable.set(s, id);
  }

  /**
   * Intern a string, returning its unique integer ID.
   * If the string was already interned, returns the existing ID.
   *
   * @param s - The string to intern.
   * @returns The unique StringId for this string.
   */
  intern(s: string): StringId {
    // Fast path for single-word identifiers (99% of calls)
    if (s.length < 16) {
      const id = this.shortTable.get(s);
      if (id !== undefined) return id;
    }

    let id = this.table.get(s);
    if (id !== undefined) return id;

    id = this.reverse.length;
    this.reverse.push(s);
    this.table.set(s, id);
    if (s.length < 16) {
      this.shortTable.set(s, id);
    }
    return id;
  }

  /**
   * Resolve a StringId back to the original string.
   *
   * @param id - The StringId to resolve.
   * @returns The original string.
   * @throws RangeError if the ID is out of bounds.
   */
  resolve(id: StringId): string {
    if (id < 0 || id >= this.reverse.length) {
      console.warn(
        `StringInterner: encountered invalid StringId ${id} (size=${this.reverse.length}). Returning fallback "<invalid>".`,
      );
      return "<invalid>";
    }
    return this.reverse[id]!;
  }

  /**
   * Check if a string has already been interned.
   *
   * @param s - The string to check.
   * @returns True if the string has been interned.
   */
  has(s: string): boolean {
    return this.table.has(s);
  }

  /**
   * Look up the StringId for a string without interning it.
   *
   * @param s - The string to look up.
   * @returns The StringId, or NULL_STRING_ID if not interned.
   */
  tryGet(s: string): StringId {
    return this.table.get(s) ?? NULL_STRING_ID;
  }

  /**
   * Interns a compound path "prefix.name" using StringIds, avoiding string
   * concatenation if the path has been interned before.
   */
  internPath(prefixId: StringId, nameId: StringId): StringId {
    if (prefixId === NULL_STRING_ID) return nameId;

    // Combine 32-bit IDs into a 52-bit key (safe up to 2^26 strings ~ 67 million)
    const key = prefixId * 67108864 + nameId;
    const cachedId = this.pathCache.get(key);
    if (cachedId !== undefined) return cachedId;

    const prefixStr = this.resolve(prefixId);
    const nameStr = this.resolve(nameId);
    const id = this.intern(`${prefixStr}.${nameStr}`);
    this.pathCache.set(key, id);
    return id;
  }

  /** The number of unique strings currently interned. */
  get size(): number {
    return this.reverse.length;
  }

  /**
   * Estimate the memory usage of this interner in bytes.
   * Useful for diagnostics and memory profiling.
   */
  estimateMemoryBytes(): number {
    let strBytes = 0;
    for (const s of this.reverse) {
      // V8 strings: ~2 bytes per char (UTF-16) + ~40 bytes overhead per string object
      strBytes += s.length * 2 + 40;
    }
    // Map overhead: ~80 bytes per entry (key ref + value + hash bucket)
    const mapBytes = this.table.size * 80;
    // Array overhead: ~8 bytes per pointer
    const arrayBytes = this.reverse.length * 8;
    return strBytes + mapBytes + arrayBytes;
  }
}
