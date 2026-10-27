// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOpenDss } from "./parser/opendss-parser.js";
import type { DssDeck } from "./types.js";

export type OpenDssDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for EPRI OpenDSS distribution network scripts (.dss).
 */
export class OpenDssWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDecks = new Map<string, DssDeck>();
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

  public getDeck(uri: string): DssDeck | undefined {
    return this.fileDecks.get(uri);
  }

  public register(uri: string, _loader?: OpenDssDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: OpenDssDocumentLoader): void {
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
        ruleName: "opendss_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "opendss",
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
      const deck = parseOpenDss(text, uri);
      this.fileDecks.set(uri, deck);

      // Root Circuit Symbol
      const rootName = deck.circuit?.name ?? "DistributionCircuit";
      const rootId = addSymbol(rootName, "package", null, 0, text.length, {
        baseKv: deck.circuit?.baseKv,
        bus1: deck.circuit?.bus1,
      });

      // Index Transformers
      for (const [id, xfmr] of deck.transformers) {
        addSymbol(id, "class", rootId, 0, 50, {
          buses: xfmr.buses,
          kvs: xfmr.kvs,
        });
      }

      // Index Lines
      for (const [id, line] of deck.lines) {
        addSymbol(id, "class", rootId, 0, 50, {
          bus1: line.bus1,
          bus2: line.bus2,
          length: line.length,
        });
      }

      // Index Loads
      for (const [id, load] of deck.loads) {
        addSymbol(id, "variable", rootId, 0, 50, {
          bus1: load.bus1,
          kw: load.kw,
          kvar: load.kvar,
        });
      }

      // Index PV Systems
      for (const [id, pv] of deck.pvSystems) {
        addSymbol(id, "field", rootId, 0, 50, {
          bus1: pv.bus1,
          pmpp: pv.pmpp,
        });
      }

      // Index Capacitors
      for (const [id, cap] of deck.capacitors) {
        addSymbol(id, "variable", rootId, 0, 50, {
          bus1: cap.bus1,
          kvar: cap.kvar,
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
