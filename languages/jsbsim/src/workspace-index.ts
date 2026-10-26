// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseJsbsim } from "./parser/jsbsim-parser.js";
import type { JsbsimDocument } from "./types.js";

/**
 * Multi-file workspace indexer for JSBSim 2.0 flight dynamics XML definitions.
 */
export class JsbsimWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, JsbsimDocument>();
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

  public getDocument(uri: string): JsbsimDocument | undefined {
    return this.fileDocuments.get(uri);
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
        ruleName: "jsbsim_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "jsbsim",
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
      const doc = parseJsbsim(text, uri);
      this.fileDocuments.set(uri, doc);
      const m = doc.model;

      // Root Model symbol
      const rootId = addSymbol(m.name || "AircraftModel", "package", null, 0, text.length, {
        version: m.version,
        wingArea: m.metrics.wingArea,
        emptyWeight: m.massBalance.emptyWeight,
        enginesCount: m.engines.length,
      });

      // Index Metrics
      if (m.metrics) {
        const start = m.metrics.range?.startOffset ?? 0;
        const end = m.metrics.range?.endOffset ?? 50;
        addSymbol("AirframeMetrics", "struct", rootId, start, end, {
          wingArea: m.metrics.wingArea,
          wingspan: m.metrics.wingspan,
          chord: m.metrics.chord,
        });
      }

      // Index Mass Balance
      if (m.massBalance) {
        const start = m.massBalance.range?.startOffset ?? 0;
        const end = m.massBalance.range?.endOffset ?? 50;
        addSymbol("MassBalance", "struct", rootId, start, end, {
          emptyWeight: m.massBalance.emptyWeight,
          ixx: m.massBalance.ixx,
          iyy: m.massBalance.iyy,
          izz: m.massBalance.izz,
        });
      }

      // Index Landing Gear
      for (const g of m.groundReactions) {
        const start = g.range?.startOffset ?? 0;
        const end = g.range?.endOffset ?? 50;
        addSymbol(`Gear_${g.name}`, "component", rootId, start, end, {
          type: g.type,
          steerable: g.steerable,
        });
      }

      // Index Engines
      for (const e of m.engines) {
        const start = e.range?.startOffset ?? 0;
        const end = e.range?.endOffset ?? 50;
        addSymbol(`Engine_${e.name}`, "component", rootId, start, end, {
          maxThrust: e.maxThrust,
        });
      }

      // Index Aerodynamic Coefficients
      for (const c of m.aeroCoefficients) {
        const start = c.range?.startOffset ?? 0;
        const end = c.range?.endOffset ?? 50;
        addSymbol(c.name, "variable", rootId, start, end, {
          axis: c.axis,
          baseValue: c.baseValue,
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
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
    this._version++;
  }
}
