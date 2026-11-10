// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseGtfs } from "./parser/index.js";
import type { GtfsFeed } from "./types.js";

export class GtfsWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileFeeds = new Map<string, GtfsFeed>();
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

  public getFeed(uri: string): GtfsFeed | undefined {
    return this.fileFeeds.get(uri);
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
        // Ignore
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
        ruleName: "gtfs_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "gtfs",
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
      const feed = parseGtfs(text);
      this.fileFeeds.set(uri, feed);

      const rootName = feed.routes[0]?.route_short_name ? `Transit_Route_${feed.routes[0].route_short_name}` : "GTFS_Feed";
      const rootId = addSymbol(rootName, "package", null, 0, text.length);

      for (const r of feed.routes) {
        addSymbol(r.route_short_name || r.route_id, "class", rootId, 0, 50, {
          route_id: r.route_id,
          long_name: r.route_long_name,
          type: r.route_type,
        });
      }

      for (const s of feed.stops) {
        addSymbol(s.stop_name || s.stop_id, "variable", rootId, 0, 50, {
          stop_id: s.stop_id,
          lat: s.stop_lat,
          lon: s.stop_lon,
        });
      }

      for (const t of feed.trips) {
        addSymbol(t.trip_id, "function", rootId, 0, 50, {
          route_id: t.route_id,
          service_id: t.service_id,
        });
      }
    } catch {
      // Ignore
    }

    const symbolIndex: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, symbolIndex);
    return symbolIndex;
  }
}
