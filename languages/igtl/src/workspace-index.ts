// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/igtl — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for OpenIGTLink (.igtl) and PLUS Toolkit (.plus.xml) files.
 * Indexes tracking/ultrasound devices, data sources, coordinate frame transforms,
 * and OpenIGTLink servers.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseIgtl } from "./parser/index.js";
import type { IgtlDocument } from "./types.js";

export class IgtlWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, IgtlDocument>();
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

  public getDocument(uri: string): IgtlDocument | undefined {
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

    const doc = parseIgtl(text, uri);
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

    // 1. Index Devices & Child DataSources
    for (const dev of doc.devices) {
      const devSymId = idCounter++ as SymbolId;
      rootChildren.push(devSymId);

      const entry: SymbolEntry = {
        id: devSymId,
        name: dev.id,
        kind: "Component",
        ruleName: "igtl_device",
        namePath: dev.id,
        fieldName: null,
        parentId: null,
        startOffset: dev.range.startOffset,
        endOffset: dev.range.endOffset,
        exports: dev.outputChannelIds,
        inherits: [],
        language: "igtl",
        resourceId: uri,
        metadata: {
          type: dev.type,
          acquisitionRate: dev.acquisitionRate,
          toolReferenceFrame: dev.toolReferenceFrame,
        },
      };
      symbols.set(devSymId, entry);
      addByName(dev.id, devSymId);

      const devChildren: SymbolId[] = [];
      for (const ds of dev.dataSources) {
        const dsSymId = idCounter++ as SymbolId;
        devChildren.push(dsSymId);
        const dsEntry: SymbolEntry = {
          id: dsSymId,
          name: ds.id,
          kind: "Property",
          ruleName: "igtl_data_source",
          namePath: `${dev.id}.${ds.id}`,
          fieldName: null,
          parentId: devSymId,
          startOffset: ds.range.startOffset,
          endOffset: ds.range.endOffset,
          exports: [],
          inherits: [],
          language: "igtl",
          resourceId: uri,
          metadata: {
            type: ds.type,
            portName: ds.portName,
          },
        };
        symbols.set(dsSymId, dsEntry);
        addByName(ds.id, dsSymId);
      }
      childrenOf.set(devSymId, devChildren);
    }

    // 2. Index Coordinate Transforms
    for (const tf of doc.transforms) {
      const tfSymId = idCounter++ as SymbolId;
      rootChildren.push(tfSymId);
      const tfName = `${tf.from}To${tf.to}`;

      const entry: SymbolEntry = {
        id: tfSymId,
        name: tfName,
        kind: "Function",
        ruleName: "igtl_transform",
        namePath: tfName,
        fieldName: null,
        parentId: null,
        startOffset: tf.range.startOffset,
        endOffset: tf.range.endOffset,
        exports: [],
        inherits: [],
        language: "igtl",
        resourceId: uri,
        metadata: {
          from: tf.from,
          to: tf.to,
          errorMm: tf.errorMm,
        },
      };
      symbols.set(tfSymId, entry);
      addByName(tfName, tfSymId);
      addByName(tf.from, tfSymId);
      addByName(tf.to, tfSymId);
    }

    // 3. Index OpenIGTLink Servers
    for (const srv of doc.servers) {
      const srvSymId = idCounter++ as SymbolId;
      rootChildren.push(srvSymId);

      const entry: SymbolEntry = {
        id: srvSymId,
        name: srv.id,
        kind: "Event",
        ruleName: "igtl_server",
        namePath: srv.id,
        fieldName: null,
        parentId: null,
        startOffset: srv.range.startOffset,
        endOffset: srv.range.endOffset,
        exports: [],
        inherits: [],
        language: "igtl",
        resourceId: uri,
        metadata: {
          listeningPort: srv.listeningPort,
          outputChannelId: srv.outputChannelId,
        },
      };
      symbols.set(srvSymId, entry);
      addByName(srv.id, srvSymId);
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
