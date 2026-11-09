// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseFiberGis } from "./parser/fiber-gis-parser.js";
import type { FiberOutsidePlantNetwork } from "./types.js";

/**
 * Multi-file workspace indexer for optical fiber outside plant (OSP) networks.
 */
export class FiberWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileNetworks = new Map<string, FiberOutsidePlantNetwork>();
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

  public getNetwork(uri: string): FiberOutsidePlantNetwork | undefined {
    return this.fileNetworks.get(uri);
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

      const net = parseFiberGis(text);
      this.fileNetworks.set(uri, net);
      this.buildNetworkIndex(uri, net, text.length);
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

  private buildNetworkIndex(uri: string, net: FiberOutsidePlantNetwork, fileLength: number): void {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();
    const baseId = this.getBaseId(uri);

    const rootSymId = (baseId + 1) as SymbolId;
    symbols.set(rootSymId, {
      id: rootSymId,
      name: net.name,
      kind: "package",
      ruleName: "fiber_network",
      namePath: net.name,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: fileLength,
      exports: [],
      inherits: [],
      language: "fiber",
      resourceId: uri,
      metadata: {
        nodeCount: net.nodes.size,
        cableCount: net.cables.size,
        spliceCount: net.splices.length,
      },
    });
    byName.set(net.name, [rootSymId]);

    const childIds: SymbolId[] = [];
    let counter = 2;

    for (const node of net.nodes.values()) {
      const symId = (baseId + counter++) as SymbolId;
      symbols.set(symId, {
        id: symId,
        name: node.name,
        kind: "class",
        ruleName: "osp_structure",
        namePath: node.name,
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "fiber",
        resourceId: uri,
        metadata: {
          nodeType: node.nodeType,
          coords: node.coordinates,
        },
      });
      childIds.push(symId);
      const list = byName.get(node.name) || [];
      list.push(symId);
      byName.set(node.name, list);
    }

    for (const cable of net.cables.values()) {
      const symId = (baseId + counter++) as SymbolId;
      symbols.set(symId, {
        id: symId,
        name: cable.name,
        kind: "component",
        ruleName: "fiber_cable",
        namePath: cable.name,
        fieldName: null,
        parentId: rootSymId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "fiber",
        resourceId: uri,
        metadata: {
          strandCount: cable.strandCount,
          lengthMeters: cable.sheathLengthMeters,
        },
      });
      childIds.push(symId);
      const list = byName.get(cable.name) || [];
      list.push(symId);
      byName.set(cable.name, list);
    }

    childrenOf.set(rootSymId, childIds);
    this.fileIndices.set(uri, { symbols, byName, childrenOf });
  }

  public invalidate(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileNetworks.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileNetworks.clear();
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
