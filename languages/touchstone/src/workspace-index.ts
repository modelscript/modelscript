// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseTouchstone } from "./parser/touchstone-parser.js";
import type { TouchstoneDeck } from "./types.js";

/**
 * Multi-file workspace indexer for Touchstone N-Port network decks (.s1p ... .sNp, .ts).
 */
export class TouchstoneWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, TouchstoneDeck>();
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

  public getDeck(uri: string): TouchstoneDeck | undefined {
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
        ruleName: "touchstone_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "touchstone",
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
      const deck = parseTouchstone(text, uri);
      this.fileDecks.set(uri, deck);

      // Root N-Port Model Symbol
      const rootName = `Touchstone_${deck.numPorts}Port`;
      const rootId = addSymbol(rootName, "package", null, 0, text.length, {
        numPorts: deck.numPorts,
        version: deck.version,
        parameterType: deck.options.parameterType,
        referenceResistance: deck.options.referenceResistance,
      });

      // Frequency Sweep symbol
      if (deck.points.length > 0) {
        const fMin = deck.points[0]!.frequencyHz;
        const fMax = deck.points[deck.points.length - 1]!.frequencyHz;
        addSymbol("FrequencySweep", "constant", rootId, 0, 50, {
          fMin,
          fMax,
          numPoints: deck.points.length,
          unit: deck.options.frequencyUnit,
        });
      }

      // Port Symbols
      for (let p = 1; p <= deck.numPorts; p++) {
        addSymbol(`Port_${p}`, "variable", rootId, 0, 50, {
          portIndex: p,
          impedance: deck.options.referenceResistance,
        });
      }

      // S-Parameter Symbols
      for (let r = 1; r <= deck.numPorts; r++) {
        for (let c = 1; c <= deck.numPorts; c++) {
          addSymbol(`S${r}${c}`, "property", rootId, 0, 50, {
            row: r,
            col: c,
          });
        }
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
