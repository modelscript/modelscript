// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseIbis } from "./parser/ibis-parser.js";
import type { IbisDeck } from "./types.js";

/**
 * Multi-file workspace indexer for IBIS buffer model files (.ibs).
 */
export class IbisWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, IbisDeck>();
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

  public getDeck(uri: string): IbisDeck | undefined {
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
      metadata: Record<string, any> = {},
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind: kind as any,
        ruleName: "ibis_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "ibis",
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
      const deck = parseIbis(text, uri);
      this.fileDecks.set(uri, deck);

      // Root File Symbol
      const rootName = deck.fileName || "IbisDocument";
      const rootId = addSymbol(rootName, "package", null, 0, text.length, {
        ibisVer: deck.ibisVer,
      });

      // Index Components
      for (const [compName, comp] of deck.components) {
        const compId = addSymbol(compName, "class", rootId, 0, 50, {
          manufacturer: comp.manufacturer,
        });

        // Index Pins under component
        for (const [pinName, pin] of comp.pins) {
          addSymbol(pinName, "field", compId, 0, 50, {
            signal: pin.signalName,
            model: pin.modelName,
          });
        }
      }

      // Index Models
      for (const [modName, mod] of deck.models) {
        addSymbol(modName, "interface", rootId, 0, 50, {
          modelType: mod.modelType,
          vcc: mod.voltageRange.typ,
        });
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
