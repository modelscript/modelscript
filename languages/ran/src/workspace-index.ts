// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseNsmaAdf } from "./parser/nsma-parser.js";
import { parsePlanetPat } from "./parser/planet-parser.js";
import type { AntennaPatternDeck } from "./types.js";

/**
 * Multi-file workspace indexer for RAN antenna pattern decks (.adf, .nsma, .pat, .msi).
 */
export class RanWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, AntennaPatternDeck>();
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

  public getDeck(uri: string): AntennaPatternDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public register(uri: string): void {
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
    if (!loader) return;

    try {
      const res = loader();
      const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
      if (!text) return;

      const deck = uri.endsWith(".pat") || uri.endsWith(".msi") ? parsePlanetPat(text, uri) : parseNsmaAdf(text, uri);
      this.fileDecks.set(uri, deck);
      this.buildDeckIndex(uri, deck, text.length);
    } catch {
      // Keep existing index if parsing fails
    }
  }

  private getBaseId(uri: string): number {
    let base = this.fileBaseIds.get(uri);
    if (base === undefined) {
      base = this.nextFileSlot * 100000;
      this.fileBaseIds.set(uri, base);
      this.nextFileSlot++;
    }
    return base;
  }

  private buildDeckIndex(uri: string, deck: AntennaPatternDeck, fileLength: number): void {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();
    const baseId = this.getBaseId(uri);

    const rootSymId = (baseId + 1) as SymbolId;
    symbols.set(rootSymId, {
      id: rootSymId,
      name: deck.name,
      kind: "package",
      ruleName: "antenna_pattern",
      namePath: deck.name,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: fileLength,
      exports: [],
      inherits: [],
      language: "ran",
      resourceId: uri,
      metadata: {
        peakGainDbi: deck.peakGainDbi,
        polarization: deck.polarization,
        downtilt: deck.electricalDowntiltDeg,
      },
    });
    byName.set(deck.name, [rootSymId]);

    const childIds: SymbolId[] = [];

    if (deck.horizontalCut) {
      const hId = (baseId + 2) as SymbolId;
      symbols.set(hId, {
        id: hId,
        name: "HorizontalCut",
        kind: "property",
        ruleName: "azimuth_cut",
        namePath: "HorizontalCut",
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 50,
        exports: [],
        inherits: [],
        language: "ran",
        resourceId: uri,
        metadata: {
          points: deck.horizontalCut.points.length,
          beamwidth: deck.horizontalBeamwidthDeg,
        },
      });
      childIds.push(hId);
      byName.set("HorizontalCut", [hId]);
    }

    if (deck.verticalCut) {
      const vId = (baseId + 3) as SymbolId;
      symbols.set(vId, {
        id: vId,
        name: "VerticalCut",
        kind: "property",
        ruleName: "elevation_cut",
        namePath: "VerticalCut",
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 50,
        exports: [],
        inherits: [],
        language: "ran",
        resourceId: uri,
        metadata: {
          points: deck.verticalCut.points.length,
          beamwidth: deck.verticalBeamwidthDeg,
        },
      });
      childIds.push(vId);
      byName.set("VerticalCut", [vId]);
    }

    childrenOf.set(rootSymId, childIds);
    this.fileIndices.set(uri, { symbols, byName, childrenOf });
  }

  public invalidate(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileDecks.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDecks.clear();
  }

  public get(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const entry = index.symbols.get(id);
      if (entry) return entry;
    }
    return undefined;
  }

  public findByName(name: string): SymbolId[] {
    const results: SymbolId[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) results.push(...ids);
    }
    return results;
  }

  public getChildren(parentId: SymbolId | null): SymbolId[] {
    const results: SymbolId[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.childrenOf.get(parentId);
      if (ids) results.push(...ids);
    }
    return results;
  }
}
