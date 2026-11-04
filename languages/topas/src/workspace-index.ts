// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/topas — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for TOPAS (.topas) and GATE (.mac) files.
 * Indexes geometry components, particle sources, dosimetry scorers, and custom materials.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseTopas } from "./parser/index.js";
import type { TopasDocument } from "./types.js";

export class TopasWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, TopasDocument>();
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

  public getDocument(uri: string): TopasDocument | undefined {
    return this.fileDocuments.get(uri);
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

  public reindexDocument(uri: string, loader?: () => string | { sourceText?: string; text?: string } | null): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const text = typeof res === "string" ? res : (res?.sourceText ?? res?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // incremental reindex guard
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
    let idCounter = baseId;

    const doc = parseTopas(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    const addByName = (key: string, symId: SymbolId) => {
      if (!key) return;
      const list = byName.get(key) ?? [];
      if (!list.includes(symId)) {
        list.push(symId);
        byName.set(key, list);
      }
    };

    // 1. Index Geometry Components
    for (const comp of doc.components) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: comp.name,
        kind: "Component",
        ruleName: "topas_component",
        namePath: `Ge/${comp.name}`,
        fieldName: null,
        parentId: null,
        startOffset: comp.range.startOffset,
        endOffset: comp.range.endOffset,
        exports: [],
        inherits: comp.parent ? [comp.parent] : [],
        language: "topas",
        resourceId: uri,
        metadata: {
          type: comp.type,
          parent: comp.parent,
          material: comp.material,
          hlx: comp.hlx,
          hly: comp.hly,
          hlz: comp.hlz,
          rMax: comp.rMax,
          hl: comp.hl,
        },
      };
      symbols.set(symId, entry);
      addByName(comp.name, symId);
      addByName(`Ge/${comp.name}`, symId);
    }

    // 2. Index Particle Sources
    for (const src of doc.sources) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: src.name,
        kind: "Event",
        ruleName: "topas_source",
        namePath: `So/${src.name}`,
        fieldName: null,
        parentId: null,
        startOffset: src.range.startOffset,
        endOffset: src.range.endOffset,
        exports: [],
        inherits: [],
        language: "topas",
        resourceId: uri,
        metadata: {
          type: src.type,
          beamParticle: src.beamParticle,
          beamEnergy: src.beamEnergy,
          beamEnergySpread: src.beamEnergySpread,
        },
      };
      symbols.set(symId, entry);
      addByName(src.name, symId);
      addByName(`So/${src.name}`, symId);
    }

    // 3. Index Scorers
    for (const sc of doc.scorers) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: sc.name,
        kind: "Property",
        ruleName: "topas_scorer",
        namePath: `Sc/${sc.name}`,
        fieldName: null,
        parentId: null,
        startOffset: sc.range.startOffset,
        endOffset: sc.range.endOffset,
        exports: [],
        inherits: [],
        language: "topas",
        resourceId: uri,
        metadata: {
          quantity: sc.quantity,
          component: sc.component,
        },
      };
      symbols.set(symId, entry);
      addByName(sc.name, symId);
      addByName(`Sc/${sc.name}`, symId);
    }

    // 4. Index Custom Materials
    for (const mat of doc.materials) {
      const symId = idCounter++ as SymbolId;
      rootChildren.push(symId);

      const entry: SymbolEntry = {
        id: symId,
        name: mat.name,
        kind: "Constant",
        ruleName: "topas_material",
        namePath: `Ma/${mat.name}`,
        fieldName: null,
        parentId: null,
        startOffset: mat.range.startOffset,
        endOffset: mat.range.endOffset,
        exports: [],
        inherits: [],
        language: "topas",
        resourceId: uri,
        metadata: {
          density: mat.density,
          components: mat.components,
        },
      };
      symbols.set(symId, entry);
      addByName(mat.name, symId);
      addByName(`Ma/${mat.name}`, symId);
    }

    childrenOf.set(null, rootChildren);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, index);
    return index;
  }

  public resolveInScope(name: string, scopeId: SymbolId | null, uri: string): SymbolEntry | null {
    const idx = this.fileIndices.get(uri);
    if (!idx) return null;

    if (scopeId !== null) {
      const children = idx.childrenOf.get(scopeId);
      if (children) {
        for (const cid of children) {
          const sym = idx.symbols.get(cid);
          if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
            return sym;
          }
        }
      }
    }

    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      const firstCandidate = candidates?.[0];
      if (firstCandidate !== undefined) {
        const found = fileIndex.symbols.get(firstCandidate);
        if (found) return found;
      }
    }

    return null;
  }

  public lookupExact(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const sym = index.symbols.get(id);
      if (sym) return sym;
    }
    return undefined;
  }

  public findByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const s = index.symbols.get(id);
          if (s) results.push(s);
        }
      }
    }
    return results;
  }

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
  }

  public getAllFiles(): string[] {
    return Array.from(this.fileIndices.keys());
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
  }
}
