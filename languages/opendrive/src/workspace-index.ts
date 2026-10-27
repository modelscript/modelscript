// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for ASAM OpenDRIVE files (.xodr, .xml).
 * Indexes roads, planView geometries, junctions, lane sections, and signals.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOpenDrive } from "./parser/index.js";
import type { OpenDriveDocument } from "./types.js";

export class OpenDriveWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, OpenDriveDocument>();
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

  public getDocument(uri: string): OpenDriveDocument | undefined {
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

    const doc = parseOpenDrive(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    // 1. Index Roads
    for (const road of doc.roads) {
      const roadId = idCounter++ as SymbolId;
      rootChildren.push(roadId);

      const roadName = road.name ? `${road.name} (${road.id})` : `Road_${road.id}`;

      const roadEntry: SymbolEntry = {
        id: roadId,
        name: roadName,
        kind: "Class",
        ruleName: "opendrive_road",
        namePath: roadName,
        fieldName: null,
        parentId: null,
        startOffset: road.range.startOffset,
        endOffset: road.range.endOffset,
        exports: [],
        inherits: [],
        language: "opendrive",
        resourceId: uri,
        metadata: {
          roadId: road.id,
          length: road.length,
          junction: road.junction,
          geometriesCount: road.planView.length,
          laneSectionsCount: road.lanes.laneSections.length,
          signalsCount: road.signals.length,
        },
      };
      symbols.set(roadId, roadEntry);

      const ex = byName.get(road.id) || [];
      ex.push(roadId);
      byName.set(road.id, ex);

      const roadChildren: SymbolId[] = [];

      // Index Geometries within Road
      for (let gi = 0; gi < road.planView.length; gi++) {
        const g = road.planView[gi]!;
        const gId = idCounter++ as SymbolId;
        roadChildren.push(gId);

        const gName = `Geometry_${gi}_${g.type}`;
        const gEntry: SymbolEntry = {
          id: gId,
          name: gName,
          kind: "Component",
          ruleName: `opendrive_geom_${g.type}`,
          namePath: `${roadName}.${gName}`,
          fieldName: null,
          parentId: roadId,
          startOffset: g.range.startOffset,
          endOffset: g.range.endOffset,
          exports: [],
          inherits: [],
          language: "opendrive",
          resourceId: uri,
          metadata: {
            s: g.s,
            type: g.type,
            length: g.length,
          },
        };
        symbols.set(gId, gEntry);
      }

      // Index Signals
      for (const sig of road.signals) {
        const sigId = idCounter++ as SymbolId;
        roadChildren.push(sigId);

        const sigName = sig.name ? `${sig.name} (${sig.id})` : `Signal_${sig.id}`;
        const sigEntry: SymbolEntry = {
          id: sigId,
          name: sigName,
          kind: "Event",
          ruleName: "opendrive_signal",
          namePath: `${roadName}.${sigName}`,
          fieldName: null,
          parentId: roadId,
          startOffset: sig.range.startOffset,
          endOffset: sig.range.endOffset,
          exports: [],
          inherits: [],
          language: "opendrive",
          resourceId: uri,
          metadata: {
            s: sig.s,
            t: sig.t,
            dynamic: sig.dynamic,
          },
        };
        symbols.set(sigId, sigEntry);

        const sex = byName.get(sig.id) || [];
        sex.push(sigId);
        byName.set(sig.id, sex);
      }

      childrenOf.set(roadId, roadChildren);
    }

    // 2. Index Junctions
    for (const junc of doc.junctions) {
      const jId = idCounter++ as SymbolId;
      rootChildren.push(jId);

      const jName = junc.name ? `${junc.name} (${junc.id})` : `Junction_${junc.id}`;
      const jEntry: SymbolEntry = {
        id: jId,
        name: jName,
        kind: "Package",
        ruleName: "opendrive_junction",
        namePath: jName,
        fieldName: null,
        parentId: null,
        startOffset: junc.range.startOffset,
        endOffset: junc.range.endOffset,
        exports: [],
        inherits: [],
        language: "opendrive",
        resourceId: uri,
        metadata: {
          junctionId: junc.id,
          connectionsCount: junc.connections.length,
        },
      };
      symbols.set(jId, jEntry);

      const jex = byName.get(junc.id) || [];
      jex.push(jId);
      byName.set(junc.id, jex);
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
          if (sym && sym.name.toLowerCase().includes(name.toLowerCase())) {
            return sym;
          }
        }
      }
    }

    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      if (candidates && candidates.length > 0) {
        const found = fileIndex.symbols.get(candidates[0]!);
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
