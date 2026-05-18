// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */

/**
 * Line-Index Table — O(1) cursor-to-token mapping for the Language Server.
 *
 * Replaces fragile binary search over overlapping AST regions with a
 * two-level index:
 *   1. Line number → index of first token on that line (O(1) array lookup)
 *   2. Short linear scan of tokens on that line to find exact column match
 *
 * Key property: tokens are leaf-level and NEVER overlap, so the scan
 * is always unambiguous (unlike AST nodes which nest/overlap).
 *
 * Memory: ~12 bytes per token (3 × Uint32) + ~4 bytes per line.
 * For a 10,000-line file with ~50,000 tokens: ~650 KB.
 */

/** Raw token data provided during construction. */
export interface TokenData {
  /** 0-indexed line number. */
  line: number;
  /** 0-indexed start column (UTF-16 code units). */
  startCol: number;
  /** 0-indexed end column (exclusive). */
  endCol: number;
  /** The AST node ID this token belongs to. */
  nodeId: number;
}

/**
 * A pre-built index for O(1) line-based token lookups.
 *
 * Construction is O(n) where n = number of tokens.
 * Lookups are O(1) for line + O(k) for column, where k = tokens per line (~20).
 */
export class LineIndex {
  /**
   * For each line, the index into the token arrays where that line's
   * tokens begin. Lines with no tokens point to the same index as
   * the next non-empty line.
   *
   * Length = totalLines + 1 (sentinel at end).
   */
  private lineStarts: Uint32Array;

  /** Start column of each token (parallel array). */
  private tokenStartCol: Uint16Array;
  /** End column of each token (exclusive, parallel array). */
  private tokenEndCol: Uint16Array;
  /** AST node ID of each token (parallel array). */
  private tokenNodeId: Int32Array;

  /** Total number of tokens. */
  private tokenCount: number;

  /**
   * Build a LineIndex from a sorted array of tokens.
   *
   * @param totalLines - Total number of lines in the source file.
   * @param tokens - Tokens sorted by (line, startCol). Must be non-overlapping.
   */
  constructor(totalLines: number, tokens: TokenData[]) {
    this.tokenCount = tokens.length;

    // Allocate parallel token arrays
    this.tokenStartCol = new Uint16Array(tokens.length);
    this.tokenEndCol = new Uint16Array(tokens.length);
    this.tokenNodeId = new Int32Array(tokens.length);

    // Fill token arrays
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      this.tokenStartCol[i] = t.startCol;
      this.tokenEndCol[i] = t.endCol;
      this.tokenNodeId[i] = t.nodeId;
    }

    // Build line → first token index mapping
    // +1 for sentinel at end
    this.lineStarts = new Uint32Array(totalLines + 1);

    // Fill with sentinel value (tokens.length) initially
    this.lineStarts.fill(tokens.length);

    // Walk tokens backwards to find first token on each line
    for (let i = tokens.length - 1; i >= 0; i--) {
      const line = tokens[i]!.line;
      if (line < totalLines) {
        this.lineStarts[line] = i;
      }
    }

    // Forward-fill: lines with no tokens should point to the next
    // non-empty line's start (so the scan terminates immediately)
    for (let line = totalLines - 1; line >= 0; line--) {
      if (this.lineStarts[line] === tokens.length) {
        // No tokens on this line — use next line's start
        this.lineStarts[line] = this.lineStarts[line + 1]!;
      }
    }
  }

  /**
   * Find the AST node ID at a given cursor position.
   *
   * @param line - 0-indexed line number.
   * @param col - 0-indexed column (UTF-16 code units).
   * @returns The nodeId of the token at this position, or -1 if none found.
   */
  nodeAt(line: number, col: number): number {
    if (line < 0 || line >= this.lineStarts.length - 1) return -1;

    const start = this.lineStarts[line]!;
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1]! : this.tokenCount;

    // Linear scan over tokens on this line (typically < 20)
    for (let i = start; i < end; i++) {
      // Guard: if we've moved past this line's tokens, stop
      if (i >= this.tokenCount) break;

      const sc = this.tokenStartCol[i]!;
      const ec = this.tokenEndCol[i]!;

      if (col >= sc && col < ec) {
        return this.tokenNodeId[i]!;
      }
    }

    return -1;
  }

  /**
   * Find the token index at a given cursor position.
   *
   * @param line - 0-indexed line number.
   * @param col - 0-indexed column.
   * @returns The token index, or -1 if none found.
   */
  tokenIndexAt(line: number, col: number): number {
    if (line < 0 || line >= this.lineStarts.length - 1) return -1;

    const start = this.lineStarts[line]!;
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1]! : this.tokenCount;

    for (let i = start; i < end; i++) {
      if (i >= this.tokenCount) break;

      const sc = this.tokenStartCol[i]!;
      const ec = this.tokenEndCol[i]!;

      if (col >= sc && col < ec) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Get all tokens on a given line.
   *
   * @param line - 0-indexed line number.
   * @returns Array of { startCol, endCol, nodeId } for tokens on this line.
   */
  tokensOnLine(line: number): { startCol: number; endCol: number; nodeId: number }[] {
    if (line < 0 || line >= this.lineStarts.length - 1) return [];

    const start = this.lineStarts[line]!;
    const end = line + 1 < this.lineStarts.length ? this.lineStarts[line + 1]! : this.tokenCount;

    const result: { startCol: number; endCol: number; nodeId: number }[] = [];
    for (let i = start; i < end && i < this.tokenCount; i++) {
      result.push({
        startCol: this.tokenStartCol[i]!,
        endCol: this.tokenEndCol[i]!,
        nodeId: this.tokenNodeId[i]!,
      });
    }
    return result;
  }

  /** Total number of indexed tokens. */
  get size(): number {
    return this.tokenCount;
  }

  /** Estimate memory usage in bytes. */
  estimateMemoryBytes(): number {
    return (
      this.lineStarts.byteLength +
      this.tokenStartCol.byteLength +
      this.tokenEndCol.byteLength +
      this.tokenNodeId.byteLength
    );
  }
}
