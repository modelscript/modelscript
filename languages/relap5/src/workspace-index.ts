// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseRelap5 } from "./parser/relap5-parser.js";
import type { Relap5Deck } from "./types.js";

export type Relap5DocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for US NRC RELAP5-3D decks (.i, .inp, .r5).
 */
export class Relap5WorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, Relap5Deck>();
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

  public getDeck(uri: string): Relap5Deck | undefined {
    return this.fileDecks.get(uri);
  }

  public register(uri: string, _loader?: Relap5DocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: Relap5DocumentLoader): void {
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
      metadata: Record<string, unknown> = {},
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "relap5_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "relap5",
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
      const deck = parseRelap5(text, uri);
      this.fileDecks.set(uri, deck);

      // Root Plant Model symbol
      const rootId = addSymbol(deck.title, "package", null, 0, text.length, {
        problemType: deck.problemType,
        executionType: deck.executionType,
      });

      // Index Volumes
      for (const [id, vol] of deck.volumes) {
        const start = vol.range?.startOffset ?? 0;
        const end = vol.range?.endOffset ?? 50;
        addSymbol(vol.name, "class", rootId, start, end, {
          componentId: id,
          type: vol.type,
          pressure: vol.initialPressure,
          temperature: vol.initialTemperature,
        });
      }

      // Index Junctions
      for (const [id, junc] of deck.junctions) {
        const start = junc.range?.startOffset ?? 0;
        const end = junc.range?.endOffset ?? 50;
        addSymbol(`Junc_${id}`, "component", rootId, start, end, {
          junctionId: id,
          fromVolume: junc.fromVolume,
          toVolume: junc.toVolume,
        });
      }

      // Index Heat Structures
      for (const [id, hs] of deck.heatStructures) {
        const start = hs.range?.startOffset ?? 0;
        const end = hs.range?.endOffset ?? 50;
        addSymbol(`HeatStructure_${id}`, "struct", rootId, start, end, {
          meshPoints: hs.meshPoints,
          k: hs.thermalConductivity,
        });
      }

      // Index Reactor Kinetics
      if (deck.kinetics) {
        const start = deck.kinetics.range?.startOffset ?? 0;
        const end = deck.kinetics.range?.endOffset ?? 50;
        addSymbol("ReactorPointKinetics", "module", rootId, start, end, {
          initialPower: deck.kinetics.initialPower,
          promptGenerationTime: deck.kinetics.promptGenerationTime,
          delayedGroups: deck.kinetics.delayedGroups.length,
        });
      }

      // Index Trips
      for (const [id, trip] of deck.trips) {
        const start = trip.range?.startOffset ?? 0;
        const end = trip.range?.endOffset ?? 50;
        addSymbol(`Trip_${id}`, "event", rootId, start, end, {
          isLogical: trip.isLogical,
          variable: trip.variableName,
          setpoint: trip.setpoint,
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
