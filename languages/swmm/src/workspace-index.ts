// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSwmm } from "./parser/swmm-parser.js";
import type { SwmmDeck } from "./types.js";

/**
 * Multi-file workspace indexer for US EPA SWMM 5.x (.inp) network decks.
 */
export class SwmmWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, SwmmDeck>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._version;
  }

  get fileCount(): number {
    return this.fileIndices.size;
  }

  public has(uri: string): boolean {
    return this.fileIndices.has(uri);
  }

  public getFileIndex(uri: string): SymbolIndex | undefined {
    return this.fileIndices.get(uri);
  }

  public getDeck(uri: string): SwmmDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public register(uri: string, _loader?: () => unknown): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(
    uri: string,
    loader?: () => string | { sourceText?: string; text?: string } | null | undefined,
  ): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // Ignore loader errors during incremental re-indexing
      }
    }
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 100_000;
      this.fileBaseIds.set(uri, baseId);
    }

    let localId = 1;
    function addSymbol(
      name: string,
      kind: string,
      parentId: SymbolId | null,
      startOffset: number,
      endOffset: number,
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "swmm_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "swmm",
        resourceId: uri,
        metadata: {},
      };

      symbols.set(symId, entry);

      const existingByName = byName.get(name) ?? [];
      existingByName.push(symId);
      byName.set(name, existingByName);

      const existingChildren = childrenOf.get(parentId) ?? [];
      existingChildren.push(symId);
      childrenOf.set(parentId, existingChildren);

      return symId;
    }

    try {
      const deck = parseSwmm(text);
      this.fileDecks.set(uri, deck);

      // Root Network symbol
      const rootId = addSymbol(
        deck.title ?? "SwmmNetwork",
        "package",
        null,
        deck.range?.startOffset ?? 0,
        deck.range?.endOffset ?? text.length,
      );

      // Index Junctions
      for (const [id, j] of deck.junctions) {
        addSymbol(id, "variable", rootId, j.range.startOffset, j.range.endOffset);
      }

      // Index Outfalls
      for (const [id, o] of deck.outfalls) {
        addSymbol(id, "variable", rootId, o.range.startOffset, o.range.endOffset);
      }

      // Index Conduits
      for (const [id, c] of deck.conduits) {
        addSymbol(id, "class", rootId, c.range.startOffset, c.range.endOffset);
      }

      // Index Pumps
      for (const [id, p] of deck.pumps) {
        addSymbol(id, "class", rootId, p.range.startOffset, p.range.endOffset);
      }

      // Index Subcatchments
      for (const [id, sc] of deck.subcatchments) {
        addSymbol(id, "field", rootId, sc.range.startOffset, sc.range.endOffset);
      }
    } catch {
      // If parsing fails, preserve empty symbol table
    }

    const symbolIndex: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, symbolIndex);
    return symbolIndex;
  }
}
