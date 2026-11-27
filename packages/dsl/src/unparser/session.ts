// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Point, SyntaxNode } from "../utils/cst-facade.js";
import { createXmlCstTree } from "../xml/cst-adapter.js";
import { parseXmlSync } from "../xml/parser.js";
import type { UnparsePosition } from "./types.js";

/**
 * Incremental text change descriptor matching Monaco `IModelContentChange` and WASM `tree.edit()`.
 */
export interface CstTextDelta {
  rangeOffset: number;
  rangeLength: number;
  text: string;
}

/**
 * Minimal parser interface satisfied by every generated ModelScript WASM GLR parser.
 */
export interface CstIncrementalParser {
  parse(
    input: string,
    oldTree?: CstManagedTree | null,
    startIndex?: number,
    oldEndIndex?: number,
    newEndIndex?: number,
    uri?: string,
  ): CstManagedTree | null;
}

/**
 * Minimal tree interface satisfied by WASM GLR trees and streaming `XmlCstTree`.
 */
export interface CstManagedTree {
  readonly rootNode: SyntaxNode;
  edit?(inputEdit: {
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
    startPosition: Point;
    oldEndPosition: Point;
    newEndPosition: Point;
  }): void;
  delete?(): void;
  sourceCode?: string;
}

export interface CstDocumentSessionOptions {
  uri: string;
  text: string;
  version?: number | undefined;
  parser?: CstIncrementalParser | null | undefined;
  /** When true, falls back to the streaming XML CST tree when no WASM parser is attached or file exceeds `maxWasmBytes`. */
  xmlFallback?: boolean | undefined;
  /** Byte limit above which XML documents use streaming CST instead of WASM GLR (default: 2 MiB). */
  maxWasmBytes?: number | undefined;
}

const DEFAULT_MAX_WASM_BYTES = 2 * 1024 * 1024;

export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function detectDocumentEol(text: string): "\r\r\n" | "\r\n" | "\n" {
  if (text.includes("\r\r\n")) return "\r\r\n";
  if (text.includes("\r\n")) return "\r\n";
  return "\n";
}

export function nodeStartOffset(node: SyntaxNode): number {
  const n = node as unknown as { startOffset?: number; startIndex?: number };
  return typeof n.startOffset === "number" ? n.startOffset : (n.startIndex ?? 0);
}

export function nodeEndOffset(node: SyntaxNode): number {
  const n = node as unknown as { endOffset?: number; endIndex?: number };
  return typeof n.endOffset === "number" ? n.endOffset : (n.endIndex ?? 0);
}

export function isNodeError(node: SyntaxNode | null | undefined): boolean {
  if (!node) return true;
  if (node.type === "ERROR") return true;
  const raw = node as unknown as { isError?: boolean | (() => boolean) };
  return typeof raw.isError === "function" ? raw.isError() : Boolean(raw.isError);
}

export function isNodeMissing(node: SyntaxNode | null | undefined): boolean {
  if (!node) return true;
  const raw = node as unknown as { isMissing?: boolean | (() => boolean) };
  return typeof raw.isMissing === "function" ? raw.isMissing() : Boolean(raw.isMissing);
}

export function isNodeHealthy(node: SyntaxNode | null | undefined): boolean {
  return Boolean(node) && !isNodeError(node) && !isNodeMissing(node);
}

export function getNodeChildrenSafe(node: SyntaxNode | null | undefined): readonly SyntaxNode[] {
  if (!node) return [];
  const raw = node as unknown as {
    children?: readonly SyntaxNode[];
    childCount?: number;
    child?: (i: number) => SyntaxNode | null;
  };
  if (Array.isArray(raw.children)) return raw.children;
  if (typeof raw.childCount === "number" && typeof raw.child === "function") {
    const out: SyntaxNode[] = [];
    for (let i = 0; i < raw.childCount; i++) {
      const c = raw.child(i);
      if (c) out.push(c);
    }
    return out;
  }
  return [];
}

/**
 * Error-tolerant pre-order CST walk: descends into all non-`ERROR`, non-`MISSING` nodes.
 * Returning `false` from `visitor` prunes descent into that node's children.
 */
export function walkHealthyCst(root: SyntaxNode | null | undefined, visitor: (node: SyntaxNode) => unknown): void {
  if (!root || !isNodeHealthy(root)) return;
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (!isNodeHealthy(cur)) continue;
    if (visitor(cur) === false) continue;
    const kids = getNodeChildrenSafe(cur);
    for (let i = kids.length - 1; i >= 0; i--) {
      const ch = kids[i];
      if (ch && isNodeHealthy(ch)) stack.push(ch);
    }
  }
}

function computeMinimalStringDiff(
  oldText: string,
  newText: string,
): { startIndex: number; oldEndIndex: number; newEndIndex: number } {
  const oldLen = oldText.length;
  const newLen = newText.length;
  let startIndex = 0;
  const minLen = Math.min(oldLen, newLen);
  while (startIndex < minLen && oldText.charCodeAt(startIndex) === newText.charCodeAt(startIndex)) {
    startIndex++;
  }
  let oldEndIndex = oldLen;
  let newEndIndex = newLen;
  while (
    oldEndIndex > startIndex &&
    newEndIndex > startIndex &&
    oldText.charCodeAt(oldEndIndex - 1) === newText.charCodeAt(newEndIndex - 1)
  ) {
    oldEndIndex--;
    newEndIndex--;
  }
  return { startIndex, oldEndIndex, newEndIndex };
}

/**
 * Stateful incremental CST session for a single open document.
 *
 * Maintains one live WASM GLR `Tree` (or streaming XML CST fallback for `> 2 MiB` / cold-start),
 * cached O(log N) line-start offsets, and incremental `tree.edit()` + `parser.parse()` updates
 * so every diagram edit reuses untouched CST subtrees without full re-parsing.
 */
export class CstDocumentSession {
  public readonly uri: string;
  private _text: string;
  private _version: number;
  private _lineStarts: number[];
  private _eol: "\r\r\n" | "\r\n" | "\n";
  private _parser: CstIncrementalParser | null;
  private _tree: CstManagedTree | null = null;
  private _isWasmTree = false;
  private readonly xmlFallback: boolean;
  private readonly maxWasmBytes: number;

  constructor(options: CstDocumentSessionOptions) {
    this.uri = options.uri;
    this._text = options.text;
    this._version = options.version ?? 1;
    this._lineStarts = computeLineStarts(options.text);
    this._eol = detectDocumentEol(options.text);
    this._parser = options.parser ?? null;
    this.xmlFallback = options.xmlFallback ?? false;
    this.maxWasmBytes = options.maxWasmBytes ?? DEFAULT_MAX_WASM_BYTES;
    this.reparseFull();
  }

  get text(): string {
    return this._text;
  }

  get version(): number {
    return this._version;
  }

  get eol(): "\r\r\n" | "\r\n" | "\n" {
    return this._eol;
  }

  get tree(): CstManagedTree | null {
    return this._tree;
  }

  get rootNode(): SyntaxNode | null {
    return this._tree?.rootNode ?? null;
  }

  get isWasmBacked(): boolean {
    return this._isWasmTree;
  }

  /** Attaches or swaps the WASM GLR parser (e.g. once lazy WASM instantiation finishes) and rebuilds the tree. */
  public setParser(parser: CstIncrementalParser | null): void {
    if (this._parser === parser) return;
    this._parser = parser;
    this.reparseFull();
  }

  /** Converts a 0-based character offset to a 0-based LSP `{ line, character }` in O(log L). */
  public offsetToPosition(offset: number): UnparsePosition {
    const clamped = Math.max(0, Math.min(offset, this._text.length));
    const starts = this._lineStarts;
    let low = 0;
    let high = starts.length - 1;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      if (starts[mid]! <= clamped) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const line = Math.max(0, low - 1);
    return { line, character: clamped - (starts[line] ?? 0) };
  }

  /** Converts a 0-based character offset to a CST `Point` (`{ row, column }`). */
  public offsetToPoint(offset: number): Point {
    const pos = this.offsetToPosition(offset);
    return { row: pos.line, column: pos.character };
  }

  /** Converts a 0-based LSP `{ line, character }` to a 0-based character offset. */
  public positionToOffset(pos: UnparsePosition): number {
    const lineIdx = Math.max(0, Math.min(pos.line, this._lineStarts.length - 1));
    const lineStart = this._lineStarts[lineIdx] ?? 0;
    return Math.max(0, Math.min(lineStart + Math.max(0, pos.character), this._text.length));
  }

  /** Returns the leading horizontal whitespace on the line containing `offset`. */
  public lineIndentAt(offset: number): string {
    const pos = this.offsetToPosition(offset);
    const lineStart = this._lineStarts[pos.line] ?? 0;
    let i = lineStart;
    while (i < this._text.length && (this._text[i] === " " || this._text[i] === "\t")) {
      i++;
    }
    return this._text.slice(lineStart, i);
  }

  /** Applies an ordered batch of Monaco-style incremental deltas and updates the CST incrementally. */
  public applyDeltas(deltas: ReadonlyArray<CstTextDelta>, nextVersion?: number): void {
    if (deltas.length === 0) {
      if (nextVersion !== undefined) this._version = nextVersion;
      return;
    }
    for (const d of deltas) {
      const startIndex = Math.max(0, Math.min(d.rangeOffset, this._text.length));
      const oldEndIndex = Math.max(startIndex, Math.min(startIndex + d.rangeLength, this._text.length));
      const newEndIndex = startIndex + d.text.length;
      const nextText = this._text.slice(0, startIndex) + d.text + this._text.slice(oldEndIndex);
      this.applyIncrementalSpan(nextText, startIndex, oldEndIndex, newEndIndex);
    }
    this._version = nextVersion ?? this._version + 1;
  }

  /** Replaces document text, automatically computing minimal edit bounds for incremental CST re-parse. */
  public setText(nextText: string, nextVersion?: number): void {
    if (nextText === this._text) {
      if (nextVersion !== undefined) this._version = nextVersion;
      return;
    }
    const { startIndex, oldEndIndex, newEndIndex } = computeMinimalStringDiff(this._text, nextText);
    this.applyIncrementalSpan(nextText, startIndex, oldEndIndex, newEndIndex);
    this._version = nextVersion ?? this._version + 1;
  }

  public dispose(): void {
    if (this._tree?.delete) {
      try {
        this._tree.delete();
      } catch {
        // ignore double-dispose
      }
    }
    this._tree = null;
    this._isWasmTree = false;
  }

  private applyIncrementalSpan(nextText: string, startIndex: number, oldEndIndex: number, newEndIndex: number): void {
    const oldStartPos = this.offsetToPoint(startIndex);
    const oldEndPos = this.offsetToPoint(oldEndIndex);
    const nextLineStarts = computeLineStarts(nextText);

    const prevText = this._text;
    const prevTree = this._tree;
    const prevWasWasm = this._isWasmTree;

    this._text = nextText;
    this._lineStarts = nextLineStarts;
    this._eol = detectDocumentEol(nextText);

    const useWasm = Boolean(this._parser) && nextText.length <= this.maxWasmBytes;
    if (useWasm && this._parser) {
      try {
        if (prevTree && prevWasWasm && typeof prevTree.edit === "function" && prevText.length <= this.maxWasmBytes) {
          const newEndPos = this.offsetToPoint(newEndIndex);
          prevTree.edit({
            startIndex,
            oldEndIndex,
            newEndIndex,
            startPosition: oldStartPos,
            oldEndPosition: oldEndPos,
            newEndPosition: newEndPos,
          });
          const nextTree = this._parser.parse(nextText, prevTree, startIndex, oldEndIndex, newEndIndex, this.uri);
          if (nextTree?.rootNode) {
            if (nextTree !== prevTree) prevTree.delete?.();
            nextTree.sourceCode = nextText;
            this._tree = nextTree;
            this._isWasmTree = true;
            return;
          }
        }
        const freshTree = this._parser.parse(nextText, null, 0, 0, 0, this.uri);
        if (freshTree?.rootNode) {
          if (prevTree && prevTree !== freshTree) prevTree.delete?.();
          freshTree.sourceCode = nextText;
          this._tree = freshTree;
          this._isWasmTree = true;
          return;
        }
      } catch {
        // Fall through to XML streaming fallback if configured
      }
    }

    if (this.xmlFallback) {
      if (prevTree && prevWasWasm) prevTree.delete?.();
      this.parseXmlFallback();
    } else {
      this._tree = null;
      this._isWasmTree = false;
    }
  }

  private reparseFull(): void {
    const prevTree = this._tree;
    const useWasm = Boolean(this._parser) && this._text.length <= this.maxWasmBytes;
    if (useWasm && this._parser) {
      try {
        const freshTree = this._parser.parse(this._text, null, 0, 0, 0, this.uri);
        if (freshTree?.rootNode) {
          if (prevTree && prevTree !== freshTree) prevTree.delete?.();
          freshTree.sourceCode = this._text;
          this._tree = freshTree;
          this._isWasmTree = true;
          return;
        }
      } catch {
        // Fall through to streaming XML fallback
      }
    }
    if (this.xmlFallback) {
      if (prevTree) prevTree.delete?.();
      this.parseXmlFallback();
    } else {
      this._tree = null;
      this._isWasmTree = false;
    }
  }

  private parseXmlFallback(): void {
    const xmlDoc = parseXmlSync(this._text);
    const tree = createXmlCstTree(xmlDoc) as unknown as CstManagedTree;
    tree.sourceCode = this._text;
    this._tree = tree;
    this._isWasmTree = false;
  }
}

/**
 * Bounded LRU cache of live {@link CstDocumentSession} instances keyed by document URI.
 * Used by LSP diagram backends so repeated edits reuse and incrementally advance the
 * existing WASM CST rather than cold-parsing the document on every request.
 */
export class CstSessionCache {
  private readonly entries = new Map<string, CstDocumentSession>();
  private readonly maxEntries: number;

  constructor(maxEntries = 32) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  public getOrUpdate(uri: string, text: string, factory: () => CstDocumentSession): CstDocumentSession {
    const existing = this.entries.get(uri);
    if (existing) {
      // Refresh LRU position
      this.entries.delete(uri);
      this.entries.set(uri, existing);
      if (existing.text !== text) {
        existing.setText(text, existing.version + 1);
      }
      return existing;
    }

    const created = factory();
    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        const oldest = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        oldest?.dispose();
      }
    }
    this.entries.set(uri, created);
    return created;
  }

  public delete(uri: string): void {
    const existing = this.entries.get(uri);
    if (existing) {
      this.entries.delete(uri);
      existing.dispose();
    }
  }

  public get size(): number {
    return this.entries.size;
  }

  public dispose(): void {
    for (const session of this.entries.values()) {
      session.dispose();
    }
    this.entries.clear();
  }
}
