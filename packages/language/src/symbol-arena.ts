// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * SymbolArena — Flat, arena-allocated storage for SymbolEntry data.
 *
 * Replaces `Map<SymbolId, SymbolEntry>` with TypedArray columns for the
 * core scalar fields of each entry, drastically reducing V8 object count
 * and GC pressure.
 *
 * ## Memory Layout
 *
 * Each symbol occupies one slot in several parallel TypedArrays:
 *
 * | Column         | Type         | Content                          |
 * |----------------|-------------|----------------------------------|
 * | `nameId`       | Int32Array  | → StringId (interned name)       |
 * | `kindId`       | Int32Array  | → StringId (interned kind)       |
 * | `ruleNameId`   | Int32Array  | → StringId (interned ruleName)   |
 * | `namePathId`   | Int32Array  | → StringId (interned namePath)   |
 * | `parentId`     | Int32Array  | → SymbolId (-1 = null)           |
 * | `startByte`    | Int32Array  | CST start byte offset            |
 * | `endByte`      | Int32Array  | CST end byte offset              |
 * | `resourceIdId` | Int32Array  | → StringId (-1 = null)           |
 * | `fieldNameId`  | Int32Array  | → StringId (-1 = null)           |
 *
 * Non-scalar data (metadata, exports, inherits, fieldRanges) is stored
 * in a side `Map<SymbolId, ...>` since these are variable-length and
 * rare compared to scalar reads.
 *
 * ## Flyweight Access
 *
 * External consumers continue to use the `SymbolEntry` interface via
 * `SymbolEntryView`, a zero-allocation Flyweight that reads directly
 * from the arena columns.
 *
 * ## Compatibility
 *
 * The arena exposes a `toSymbolIndex()` method that returns a standard
 * `SymbolIndex` with a `symbols` Map backed by Flyweight views, enabling
 * a gradual migration path where existing code continues to work.
 */

import type { SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/language";
import { StringInterner } from "@modelscript/language/interner";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel for null parent/resource/fieldName IDs in Int32 columns. */
const NULL_ID = -1;

/** Default initial capacity (number of symbol slots). */
const DEFAULT_CAPACITY = 1024;

// ─────────────────────────────────────────────────────────────────────────────
// SymbolArena
// ─────────────────────────────────────────────────────────────────────────────

export class SymbolArena {
  // ── Scalar columns (parallel TypedArrays) ──

  /** Interned name of each symbol. */
  nameId: Int32Array;
  /** Interned kind (SymbolKind string). */
  kindId: Int32Array;
  /** Interned grammar rule name. */
  ruleNameId: Int32Array;
  /** Interned name path (dot-path to name field in CST). */
  namePathId: Int32Array;
  /** Parent symbol ID (-1 = null/root). */
  parentId: Int32Array;
  /** CST start byte offset. */
  startByte: Int32Array;
  /** CST end byte offset. */
  endByte: Int32Array;
  /** Interned resource URI (-1 = not set). */
  resourceIdId: Int32Array;
  /** Interned CST field name under parent (-1 = null). */
  fieldNameId: Int32Array;

  // ── Variable-length side stores ──

  /** Exports paths per symbol. */
  private exportsMap = new Map<SymbolId, string[]>();
  /** Inherits paths per symbol. */
  private inheritsMap = new Map<SymbolId, string[]>();
  /** Language-specific metadata per symbol. */
  private metadataMap = new Map<SymbolId, Record<string, unknown>>();
  /** Field byte ranges per symbol. */
  private fieldRangesMap = new Map<SymbolId, Record<string, { startByte: number; endByte: number }>>();
  /** Language tag per symbol. */
  private languageMap = new Map<SymbolId, string>();

  // ── Book-keeping ──

  /** Number of allocated symbol slots. */
  private _length = 0;

  /** The string interner used for all string↔id conversions. */
  readonly interner: StringInterner;

  // ── Index structures (mirrors SymbolIndex) ──

  /** Name string → SymbolId[] for fast byName lookups. */
  private byNameIndex = new Map<string, SymbolId[]>();
  /** Parent SymbolId → child SymbolId[] for fast childrenOf lookups. */
  private childrenOfIndex = new Map<SymbolId | null, SymbolId[]>();
  /** Resource URI → SymbolId[] for fast per-file iteration. */
  private symbolsByResourceIndex = new Map<string, SymbolId[]>();

  constructor(interner?: StringInterner, initialCapacity = DEFAULT_CAPACITY) {
    this.interner = interner ?? new StringInterner();

    this.nameId = new Int32Array(initialCapacity);
    this.kindId = new Int32Array(initialCapacity);
    this.ruleNameId = new Int32Array(initialCapacity);
    this.namePathId = new Int32Array(initialCapacity);
    this.parentId = new Int32Array(initialCapacity);
    this.startByte = new Int32Array(initialCapacity);
    this.endByte = new Int32Array(initialCapacity);
    this.resourceIdId = new Int32Array(initialCapacity);
    this.fieldNameId = new Int32Array(initialCapacity);
  }

  /** Number of symbols currently stored. */
  get length(): number {
    return this._length;
  }

  /** Current capacity in slots. */
  get capacity(): number {
    return this.nameId.length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Insertion
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add a symbol entry to the arena from a standard `SymbolEntry` object.
   *
   * The entry's `id` is used as the slot index. If the id exceeds current
   * capacity, the arena grows automatically.
   *
   * @returns The SymbolId (same as entry.id).
   */
  addEntry(entry: SymbolEntry): SymbolId {
    const id = entry.id;

    // Ensure capacity
    while (id >= this.nameId.length) {
      this.grow();
    }

    // Track max allocated
    if (id >= this._length) {
      this._length = id + 1;
    }

    // Write scalar columns
    this.nameId[id] = this.interner.intern(entry.name);
    this.kindId[id] = this.interner.intern(entry.kind);
    this.ruleNameId[id] = this.interner.intern(entry.ruleName);
    this.namePathId[id] = this.interner.intern(entry.namePath);
    this.parentId[id] = entry.parentId ?? NULL_ID;
    this.startByte[id] = entry.startByte;
    this.endByte[id] = entry.endByte;
    this.resourceIdId[id] = entry.resourceId ? this.interner.intern(entry.resourceId) : NULL_ID;
    this.fieldNameId[id] = entry.fieldName ? this.interner.intern(entry.fieldName) : NULL_ID;

    // Write variable-length data
    if (entry.exports.length > 0) this.exportsMap.set(id, entry.exports);
    if (entry.inherits.length > 0) this.inheritsMap.set(id, entry.inherits);
    if (Object.keys(entry.metadata).length > 0) this.metadataMap.set(id, entry.metadata);
    if (entry.fieldRanges) this.fieldRangesMap.set(id, entry.fieldRanges);
    if (entry.language) this.languageMap.set(id, entry.language);

    // Update indices
    const name = entry.name;
    const existing = this.byNameIndex.get(name);
    if (existing) {
      existing.push(id);
    } else {
      this.byNameIndex.set(name, [id]);
    }

    const parent = entry.parentId ?? null;
    const siblings = this.childrenOfIndex.get(parent);
    if (siblings) {
      siblings.push(id);
    } else {
      this.childrenOfIndex.set(parent, [id]);
    }

    if (entry.resourceId) {
      const resourceSymbols = this.symbolsByResourceIndex.get(entry.resourceId);
      if (resourceSymbols) {
        resourceSymbols.push(id);
      } else {
        this.symbolsByResourceIndex.set(entry.resourceId, [id]);
      }
    }

    return id;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bulk Import / Export
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Import all entries from a standard `SymbolIndex` into this arena.
   * Used for one-time migration from Map-based indices.
   */
  importFromIndex(index: SymbolIndex): void {
    for (const entry of index.symbols.values()) {
      this.addEntry(entry);
    }
  }

  /**
   * Export this arena as a standard `SymbolIndex` using Flyweight views.
   *
   * The returned `symbols` Map contains `SymbolEntryView` instances that
   * read directly from the arena — no copying occurs.
   */
  toSymbolIndex(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();

    // Create Flyweight views for all allocated slots
    for (let id = 0; id < this._length; id++) {
      // Skip unoccupied slots (nameId would be 0 which maps to the first interned string)
      if (this.nameId[id] === 0 && !this.byNameIndex.has(this.interner.resolve(0))) {
        continue;
      }
      // Only include slots that are in the byName index (i.e., were actually added)
      const name = this.interner.resolve(this.nameId[id]!);
      const ids = this.byNameIndex.get(name);
      if (ids && ids.includes(id)) {
        symbols.set(id, new SymbolEntryView(this, id));
      }
    }

    return {
      symbols,
      byName: this.byNameIndex,
      childrenOf: this.childrenOfIndex,
      symbolsByResource: this.symbolsByResourceIndex.size > 0 ? this.symbolsByResourceIndex : undefined,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Field Accessors (used by SymbolEntryView)
  // ─────────────────────────────────────────────────────────────────────────

  getName(id: SymbolId): string {
    return this.interner.resolve(this.nameId[id]!);
  }

  getKind(id: SymbolId): string {
    return this.interner.resolve(this.kindId[id]!);
  }

  getRuleName(id: SymbolId): string {
    return this.interner.resolve(this.ruleNameId[id]!);
  }

  getNamePath(id: SymbolId): string {
    return this.interner.resolve(this.namePathId[id]!);
  }

  getParentId(id: SymbolId): SymbolId | null {
    const v = this.parentId[id]!;
    return v === NULL_ID ? null : v;
  }

  getStartByte(id: SymbolId): number {
    return this.startByte[id]!;
  }

  getEndByte(id: SymbolId): number {
    return this.endByte[id]!;
  }

  getResourceId(id: SymbolId): string | undefined {
    const v = this.resourceIdId[id]!;
    return v === NULL_ID ? undefined : this.interner.resolve(v);
  }

  getFieldName(id: SymbolId): string | null {
    const v = this.fieldNameId[id]!;
    return v === NULL_ID ? null : this.interner.resolve(v);
  }

  getExports(id: SymbolId): string[] {
    return this.exportsMap.get(id) ?? [];
  }

  getInherits(id: SymbolId): string[] {
    return this.inheritsMap.get(id) ?? [];
  }

  getMetadata(id: SymbolId): Record<string, unknown> {
    return this.metadataMap.get(id) ?? {};
  }

  getFieldRanges(id: SymbolId): Record<string, { startByte: number; endByte: number }> | undefined {
    return this.fieldRangesMap.get(id);
  }

  getLanguage(id: SymbolId): string | undefined {
    return this.languageMap.get(id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Index Access
  // ─────────────────────────────────────────────────────────────────────────

  getByName(name: string): SymbolId[] {
    return this.byNameIndex.get(name) ?? [];
  }

  getChildrenOf(parentId: SymbolId | null): SymbolId[] {
    return this.childrenOfIndex.get(parentId) ?? [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Memory Management
  // ─────────────────────────────────────────────────────────────────────────

  /** Reset the arena, clearing all data. */
  clear(): void {
    this._length = 0;
    this.exportsMap.clear();
    this.inheritsMap.clear();
    this.metadataMap.clear();
    this.fieldRangesMap.clear();
    this.languageMap.clear();
    this.byNameIndex.clear();
    this.childrenOfIndex.clear();
    this.symbolsByResourceIndex.clear();
  }

  /** Release all buffers for GC. */
  release(): void {
    this.clear();
    this.nameId = new Int32Array(0);
    this.kindId = new Int32Array(0);
    this.ruleNameId = new Int32Array(0);
    this.namePathId = new Int32Array(0);
    this.parentId = new Int32Array(0);
    this.startByte = new Int32Array(0);
    this.endByte = new Int32Array(0);
    this.resourceIdId = new Int32Array(0);
    this.fieldNameId = new Int32Array(0);
  }

  /** Estimate total memory usage in bytes. */
  estimateMemoryBytes(): number {
    const scalarBytes =
      this.nameId.byteLength +
      this.kindId.byteLength +
      this.ruleNameId.byteLength +
      this.namePathId.byteLength +
      this.parentId.byteLength +
      this.startByte.byteLength +
      this.endByte.byteLength +
      this.resourceIdId.byteLength +
      this.fieldNameId.byteLength;

    // Rough estimate for Maps: ~120 bytes per entry
    const mapBytes =
      (this.exportsMap.size + this.inheritsMap.size + this.metadataMap.size + this.fieldRangesMap.size) * 120;

    return scalarBytes + mapBytes + this.interner.estimateMemoryBytes();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private
  // ─────────────────────────────────────────────────────────────────────────

  private grow(): void {
    const newCap = Math.max(this.nameId.length * 2, 16);
    this.nameId = growArray(this.nameId, newCap);
    this.kindId = growArray(this.kindId, newCap);
    this.ruleNameId = growArray(this.ruleNameId, newCap);
    this.namePathId = growArray(this.namePathId, newCap);
    this.parentId = growArray(this.parentId, newCap);
    this.startByte = growArray(this.startByte, newCap);
    this.endByte = growArray(this.endByte, newCap);
    this.resourceIdId = growArray(this.resourceIdId, newCap);
    this.fieldNameId = growArray(this.fieldNameId, newCap);
  }
}

function growArray(old: Int32Array, newLength: number): Int32Array {
  const arr = new Int32Array(newLength);
  arr.set(old);
  return arr;
}

// ─────────────────────────────────────────────────────────────────────────────
// SymbolEntryView — Zero-allocation Flyweight over SymbolArena
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A Flyweight that implements the `SymbolEntry` interface by reading
 * directly from a `SymbolArena`'s TypedArray columns.
 *
 * These views are transient — they hold no data of their own and are
 * cheap to create/discard. They can be used interchangeably anywhere
 * a `SymbolEntry` object is expected.
 */
export class SymbolEntryView implements SymbolEntry {
  constructor(
    private readonly arena: SymbolArena,
    private readonly idx: SymbolId,
  ) {}

  get id(): SymbolId {
    return this.idx;
  }

  get kind(): string {
    return this.arena.getKind(this.idx);
  }

  get name(): string {
    return this.arena.getName(this.idx);
  }

  get ruleName(): string {
    return this.arena.getRuleName(this.idx);
  }

  get namePath(): string {
    return this.arena.getNamePath(this.idx);
  }

  get startByte(): number {
    return this.arena.getStartByte(this.idx);
  }

  get endByte(): number {
    return this.arena.getEndByte(this.idx);
  }

  get parentId(): SymbolId | null {
    return this.arena.getParentId(this.idx);
  }

  get exports(): string[] {
    return this.arena.getExports(this.idx);
  }

  get inherits(): string[] {
    return this.arena.getInherits(this.idx);
  }

  get metadata(): Record<string, unknown> {
    return this.arena.getMetadata(this.idx);
  }

  get fieldRanges(): Record<string, { startByte: number; endByte: number }> | undefined {
    return this.arena.getFieldRanges(this.idx);
  }

  get fieldName(): string | null {
    return this.arena.getFieldName(this.idx);
  }

  get resourceId(): string | undefined {
    return this.arena.getResourceId(this.idx);
  }

  get language(): string | undefined {
    return this.arena.getLanguage(this.idx);
  }
}
