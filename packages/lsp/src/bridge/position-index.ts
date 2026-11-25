// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LSPRange } from "./types.js";

/**
 * Converts byte offsets to LSP line/character positions.
 * Must be initialized with the source text.
 */
export class PositionIndex {
  /** Character offset of the start of each 0-indexed line. */
  private lineStarts: number[];
  /** UTF-8 byte offset of the start of each 0-indexed line. */
  private byteLineStarts: number[];
  /** Raw document source text. */
  private sourceText: string;
  /** Fast-path flag indicating whether the source contains only 7-bit ASCII characters. */
  private isPureAscii: boolean;

  /**
   * Builds a line-start lookup table for both character and UTF-8 byte offsets.
   *
   * @param sourceText - Full source text of the document.
   */
  constructor(sourceText: string) {
    this.sourceText = sourceText;
    this.lineStarts = [0];
    this.byteLineStarts = [0];

    let pureAscii = true;
    let byteOffset = 0;

    for (let i = 0; i < sourceText.length; i++) {
      const code = sourceText.charCodeAt(i);
      if (code > 0x7f) {
        pureAscii = false;
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < sourceText.length) {
          byteOffset += 4;
          i++; // Skip low surrogate
          continue;
        } else if (code <= 0x7ff) {
          byteOffset += 2;
        } else {
          byteOffset += 3;
        }
      } else {
        byteOffset += 1;
        if (code === 0x0a) {
          this.lineStarts.push(i + 1);
          this.byteLineStarts.push(byteOffset);
        }
      }
    }
    this.isPureAscii = pureAscii;
  }

  // ── Canonical character-offset API ──────────────────────────────────────

  /**
   * Convert a character offset to an LSP line/character position.
   * This is the preferred API — character offsets are the canonical
   * representation used by SyntaxNode.startOffset, SymbolEntry, etc.
   */
  charOffsetToPosition(charOffset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStarts[mid]! <= charOffset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return { line: lo, character: Math.max(0, charOffset - this.lineStarts[lo]!) };
  }

  /**
   * Get the underlying source text.
   */
  getSourceText(): string {
    return this.sourceText;
  }

  /**
   * Convert an LSP line/character position back to a character offset.
   */
  positionToCharOffset(line: number, character: number): number {
    if (line < 0 || line >= this.lineStarts.length) return 0;
    return Math.min(this.lineStarts[line]! + character, this.sourceText.length);
  }

  /**
   * Convert a character offset range to an LSP range.
   */
  rangeFromOffsets(startOffset: number, endOffset: number): LSPRange {
    return {
      start: this.charOffsetToPosition(startOffset),
      end: this.charOffsetToPosition(endOffset),
    };
  }

  // ── Deprecated byte-based API ───────────────────────────────────────────
  // These methods convert UTF-8 byte offsets to positions. Since the codebase
  // is migrating to character offsets everywhere, prefer the methods above.

  /** @deprecated Use {@link charOffsetToPosition} with character offsets instead. */
  offsetToPosition(offset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.byteLineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.byteLineStarts[mid]! <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    const byteDelta = offset - this.byteLineStarts[lo]!;
    if (this.isPureAscii || byteDelta <= 0) {
      return { line: lo, character: Math.max(0, byteDelta) };
    }

    const lineStartChar = this.lineStarts[lo]!;
    const nextLineStartChar = lo + 1 < this.lineStarts.length ? this.lineStarts[lo + 1]! : this.sourceText.length;
    let currByte = 0;
    let charIdx = lineStartChar;

    while (charIdx < nextLineStartChar && currByte < byteDelta) {
      const code = this.sourceText.charCodeAt(charIdx);
      if (code <= 0x7f) {
        currByte += 1;
        charIdx += 1;
      } else if (code >= 0xd800 && code <= 0xdbff && charIdx + 1 < nextLineStartChar) {
        currByte += 4;
        charIdx += 2;
      } else if (code <= 0x7ff) {
        currByte += 2;
        charIdx += 1;
      } else {
        currByte += 3;
        charIdx += 1;
      }
    }

    return { line: lo, character: charIdx - lineStartChar };
  }

  /** @deprecated Use {@link positionToCharOffset} instead. */
  positionToOffset(line: number, character: number): number {
    if (line < 0 || line >= this.lineStarts.length) return 0;
    if (this.isPureAscii) {
      return this.lineStarts[line]! + character;
    }

    const lineStartChar = this.lineStarts[line]!;
    const targetCharIdx = Math.min(lineStartChar + character, this.sourceText.length);
    let byteDelta = 0;

    for (let i = lineStartChar; i < targetCharIdx; i++) {
      const code = this.sourceText.charCodeAt(i);
      if (code <= 0x7f) {
        byteDelta += 1;
      } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < targetCharIdx) {
        byteDelta += 4;
        i++;
      } else if (code <= 0x7ff) {
        byteDelta += 2;
      } else {
        byteDelta += 3;
      }
    }

    return this.byteLineStarts[line]! + byteDelta;
  }

  /** Total number of lines in the source. */
  get lineCount(): number {
    return this.lineStarts.length;
  }
}

/** Normalizes a constructor argument into a `PositionIndex` instance. */
export function resolvePositionIndexArg(arg: unknown): PositionIndex {
  if (arg instanceof PositionIndex) return arg;
  if (arg && typeof arg === "object") {
    const rec = arg as Record<string, unknown>;
    if (typeof rec["positionToCharOffset"] === "function") {
      return arg as PositionIndex;
    }
    if (typeof rec["sourceText"] === "string") {
      return new PositionIndex(rec["sourceText"]);
    }
  }
  return new PositionIndex("");
}
