// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseTough } from "./parser/index.js";
import type { ToughDeck } from "./types.js";

export class ToughWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, ToughDeck>();
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

  public getDeck(uri: string): ToughDeck | undefined {
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
        // Ignore
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
      metadata: Record<string, unknown> = {},
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "tough_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "tough",
        resourceId: uri,
        metadata,
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
      const deck = parseTough(text);
      this.fileDecks.set(uri, deck);

      const rootName = deck.title || "TOUGH_Reservoir";
      const rootId = addSymbol(rootName, "package", null, 0, text.length);

      for (const r of deck.rocks) {
        addSymbol(r.name, "class", rootId, 0, 50, { porosity: r.porosity, density: r.density });
      }
      for (const el of deck.elements) {
        addSymbol(el.name, "variable", rootId, 0, 50, { rock: el.rockName, volume: el.volume });
      }
      for (const g of deck.generators) {
        addSymbol(g.name || `GEN_${g.elem}`, "function", rootId, 0, 50, { type: g.type, rate: g.rate });
      }
    } catch {
      // Ignore
    }

    const symbolIndex: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, symbolIndex);
    return symbolIndex;
  }
}
