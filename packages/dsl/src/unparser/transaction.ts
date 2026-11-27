// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "../utils/cst-facade.js";
import { CstDocumentSession, nodeEndOffset, nodeStartOffset } from "./session.js";
import type { CstTextEdit } from "./types.js";

/**
 * Low-level byte-range mutation accumulated inside a {@link CstTransaction}.
 */
export interface CstByteEdit {
  start: number;
  end: number;
  text: string;
  /** Optional deterministic insertion ordering hint when multiple inserts share an exact offset. */
  order: number;
}

export interface CstTransactionSkipped {
  reason: string;
  target?: string | undefined;
}

export interface CstTransactionResult {
  edits: CstTextEdit[];
  byteEdits: CstByteEdit[];
  skipped: CstTransactionSkipped[];
  /** Applies the committed byte edits directly to `source` in reverse offset order. */
  applyToString(source?: string): string;
}

/**
 * Atomic, multi-node CST patch transaction.
 *
 * Accumulates independent surgical edits against an immutable {@link CstDocumentSession}
 * snapshot, coalesces coincident zero-width insertions (e.g. multiple attributes or child
 * elements added to the same parent in one action batch), drops overlapping conflicting writes
 * safely, and emits sorted, non-overlapping LSP `CstTextEdit[]` without rewriting parent
 * subtrees or disturbing `ERROR` nodes.
 */
export class CstTransaction {
  public readonly session: CstDocumentSession;
  private readonly ops: CstByteEdit[] = [];
  private readonly skippedOps: CstTransactionSkipped[] = [];
  private nextOrder = 0;

  constructor(session: CstDocumentSession) {
    this.session = session;
  }

  get editCount(): number {
    return this.ops.length;
  }

  get skipped(): readonly CstTransactionSkipped[] {
    return this.skippedOps;
  }

  /** Records a non-fatal skipped mutation (e.g. target inside an `ERROR` node) so healthy sibling edits still commit. */
  public recordSkipped(reason: string, target?: string): void {
    this.skippedOps.push({ reason, target });
  }

  /** Replaces an exact byte range `[start, end)` in the snapshot source. */
  public replaceRange(start: number, end: number, text: string): void {
    const len = this.session.text.length;
    const s = Math.max(0, Math.min(start, len));
    const e = Math.max(s, Math.min(end, len));
    this.ops.push({ start: s, end: e, text, order: this.nextOrder++ });
  }

  /** Inserts `text` at exact byte offset `offset`. Multiple inserts at the same offset preserve insertion order. */
  public insertAt(offset: number, text: string): void {
    const clamped = Math.max(0, Math.min(offset, this.session.text.length));
    this.ops.push({ start: clamped, end: clamped, text, order: this.nextOrder++ });
  }

  /** Replaces an entire CST node's span with `newText`. */
  public replaceNode(node: SyntaxNode, newText: string): void {
    this.replaceRange(nodeStartOffset(node), nodeEndOffset(node), newText);
  }

  /** Replaces a named field child of `parent` if present; records skipped otherwise. */
  public replaceField(parent: SyntaxNode, fieldName: string, newText: string): boolean {
    const child = typeof parent.childForFieldName === "function" ? parent.childForFieldName(fieldName) : null;
    if (!child) {
      this.recordSkipped(`field '${fieldName}' not found on '${parent.type}'`, fieldName);
      return false;
    }
    this.replaceNode(child, newText);
    return true;
  }

  /** Deletes a CST node's exact span. */
  public deleteNode(node: SyntaxNode): void {
    this.replaceRange(nodeStartOffset(node), nodeEndOffset(node), "");
  }

  /** Deletes a byte range `[start, end)`. */
  public deleteRange(start: number, end: number): void {
    this.replaceRange(start, end, "");
  }

  /**
   * Normalizes, merges coincident inserts, deduplicates overlapping ranges (later op wins for exact same span),
   * and converts all edits into LSP `CstTextEdit[]`.
   */
  public commit(): CstTransactionResult {
    if (this.ops.length === 0) {
      const baseText = this.session.text;
      return {
        edits: [],
        byteEdits: [],
        skipped: [...this.skippedOps],
        applyToString: (src?: string) => src ?? baseText,
      };
    }

    // Sort ascending by start, then end, then insertion order
    const sorted = [...this.ops].sort((a, b) => a.start - b.start || a.end - b.end || a.order - b.order);

    const merged: CstByteEdit[] = [];
    for (const op of sorted) {
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push({ ...op });
        continue;
      }

      // Coincident zero-width inserts: concatenate in deterministic insertion order
      if (prev.start === prev.end && op.start === op.end && prev.start === op.start) {
        prev.text += op.text;
        continue;
      }

      // Exact same replacement range: later edit in the transaction wins (e.g. duplicate setAttribute in one batch)
      if (prev.start === op.start && prev.end === op.end) {
        prev.text = op.text;
        prev.order = op.order;
        continue;
      }

      // Disjoint (prev.end <= op.start): append cleanly
      if (prev.end <= op.start) {
        merged.push({ ...op });
        continue;
      }

      // Overlapping non-identical range: keep outer/earlier deletion if op is strictly inside a deletion
      if (prev.text === "" && op.start >= prev.start && op.end <= prev.end) {
        continue;
      }

      // Otherwise record skipped overlap rather than corrupting offsets
      this.skippedOps.push({
        reason: `overlapping edit [${op.start},${op.end}) conflicts with [${prev.start},${prev.end})`,
      });
    }

    const edits: CstTextEdit[] = merged.map((b) => ({
      range: {
        start: this.session.offsetToPosition(b.start),
        end: this.session.offsetToPosition(b.end),
      },
      newText: b.text,
    }));

    const baseText = this.session.text;
    return {
      edits,
      byteEdits: merged,
      skipped: [...this.skippedOps],
      applyToString: (src?: string) => {
        let out = src ?? baseText;
        for (let i = merged.length - 1; i >= 0; i--) {
          const b = merged[i]!;
          out = out.slice(0, b.start) + b.text + out.slice(b.end);
        }
        return out;
      },
    };
  }
}
