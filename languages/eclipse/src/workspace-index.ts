// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseEclipse } from "./parser/eclipse-parser.js";
import type { EclipseDeck } from "./types.js";

/**
 * Multi-file workspace indexer for Schlumberger ECLIPSE reservoir decks (.data, .dat, .inc).
 */
export class EclipseWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, EclipseDeck>();
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

  public getDeck(uri: string): EclipseDeck | undefined {
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

  public reindexDocument(uri: string, loader?: () => unknown): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const obj = typeof res === "object" && res !== null ? (res as { sourceText?: unknown; text?: unknown }) : null;
        const text = typeof res === "string" ? res : (obj?.sourceText ?? obj?.text);
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
      metadata: Record<string, unknown> = {},
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "eclipse_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "eclipse",
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
      const deck = parseEclipse(text, uri);
      this.fileDecks.set(uri, deck);

      // Root Reservoir Model symbol
      const rootId = addSymbol(deck.title || "ReservoirModel", "package", null, 0, text.length, {
        units: deck.units,
        startDate: deck.startDate,
        dimensions: deck.dimensions,
      });

      // Index Grid
      if (deck.grid) {
        const start = deck.grid.range?.startOffset ?? 0;
        const end = deck.grid.range?.endOffset ?? 50;
        addSymbol("ReservoirGrid", "struct", rootId, start, end, {
          nx: deck.dimensions.nx,
          ny: deck.dimensions.ny,
          nz: deck.dimensions.nz,
          poro: deck.grid.poro,
          permX: deck.grid.permX,
        });
      }

      // Index Props
      if (deck.props) {
        const start = deck.props.range?.startOffset ?? 0;
        const end = deck.props.range?.endOffset ?? 50;
        addSymbol("PVT_Props", "class", rootId, start, end, {
          pvdoEntries: deck.props.pvdo.length,
          swofEntries: deck.props.swof.length,
        });
      }

      // Index Solution
      if (deck.solution) {
        const start = deck.solution.range?.startOffset ?? 0;
        const end = deck.solution.range?.endOffset ?? 50;
        addSymbol("ReservoirSolution", "field", rootId, start, end, {
          initialPressure: deck.solution.initialPressure,
          equil: deck.solution.equil ? true : false,
        });
      }

      // Index Wells
      for (const [name, well] of deck.wells) {
        const start = well.range?.startOffset ?? 0;
        const end = well.range?.endOffset ?? 50;
        addSymbol(name, "component", rootId, start, end, {
          preferredPhase: well.preferredPhase,
          completions: well.completions.length,
          isProducer: !!well.productionControl,
          isInjector: !!well.injectionControl,
        });
      }
    } catch {
      // Return partial symbol map if parsing failed
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public getSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
  }

  public findDefinition(name: string): SymbolEntry | undefined {
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids && ids.length > 0 && ids[0] !== undefined) {
        const sym = idx.symbols.get(ids[0]);
        if (sym) return sym;
      }
    }
    return undefined;
  }

  public findReferences(name: string): SymbolEntry[] {
    const refs: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const sym = idx.symbols.get(id);
          if (sym) refs.push(sym);
        }
      }
    }
    return refs;
  }

  public clear(): void {
    this.fileIndices.clear();
    this.fileDecks.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
    this._version++;
  }
}
