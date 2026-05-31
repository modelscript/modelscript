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

  /** Reverse map: StringId → string (indexed by ID). */
  private reverse: string[] = [];

  /**
   * Intern a string, returning its unique integer ID.
   * If the string was already interned, returns the existing ID.
   *
   * @param s - The string to intern.
   * @returns The unique StringId for this string.
   */
  intern(s: string): StringId {
    let id = this.table.get(s);
    if (id !== undefined) return id;
    id = this.reverse.length;
    this.reverse.push(s);
    this.table.set(s, id);
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
