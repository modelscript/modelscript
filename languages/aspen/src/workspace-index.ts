// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseAspen } from "./parser/aspen-parser.js";
import type { AspenDeck } from "./types.js";

/**
 * Multi-file workspace indexer for Aspen Plus process flowsheets (.in, .inp, .bkp).
 */
export class AspenWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, AspenDeck>();
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

  public getDeck(uri: string): AspenDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public register(uri: string, _loader?: () => any): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: () => any): void {
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
        kind: kind as any,
        ruleName: "aspen_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "aspen",
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
      const deck = parseAspen(text);
      this.fileDecks.set(uri, deck);

      // Root process flowsheet symbol
      const rootId = addSymbol(
        deck.title ?? "AspenProcess",
        "package",
        null,
        deck.loc?.startOffset ?? 0,
        deck.loc?.endOffset ?? text.length,
      );

      // Index Components
      for (const [cId, comp] of deck.components) {
        addSymbol(cId, "variable", rootId, comp.loc.startOffset, comp.loc.endOffset);
      }

      // Index Flowsheet Blocks
      for (const [bId, block] of deck.blocks) {
        addSymbol(bId, "class", rootId, block.loc.startOffset, block.loc.endOffset);
      }

      // Index Streams
      for (const [sId, stream] of deck.streams) {
        addSymbol(sId, "field", rootId, stream.loc.startOffset, stream.loc.endOffset);
      }
    } catch {
      // If parsing fails during index, leave empty symbol table
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
