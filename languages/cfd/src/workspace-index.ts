// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseCfdConfig } from "./dialects/index.js";
import type { CfdModelData } from "./types.js";

/**
 * Workspace indexer for Computational Fluid Dynamics (SU2, OpenFOAM) decks.
 */
export class CfdWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileConfigs = new Map<string, CfdModelData>();
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

  public getConfig(uri: string): CfdModelData | undefined {
    return this.fileConfigs.get(uri);
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
      } catch (err) {
        console.error(`[CfdWorkspaceIndex] Failed to reindex ${uri}:`, err);
      }
    }
  }

  public findDefinition(name: string, currentUri?: string): { uri: string; symbol: SymbolEntry }[] {
    const results: { uri: string; symbol: SymbolEntry }[] = [];
    const searchOrder: string[] = [];

    if (currentUri && this.fileIndices.has(currentUri)) {
      searchOrder.push(currentUri);
    }
    for (const uri of this.fileIndices.keys()) {
      if (uri !== currentUri) {
        searchOrder.push(uri);
      }
    }

    for (const uri of searchOrder) {
      const idx = this.fileIndices.get(uri);
      if (!idx) continue;
      const ids = idx.byName.get(name) ?? [];
      for (const id of ids) {
        const sym = idx.symbols.get(id);
        if (sym) {
          results.push({ uri, symbol: sym });
        }
      }
    }

    return results;
  }

  public findReferences(name: string, _currentUri?: string): { uri: string; range: any }[] {
    const results: { uri: string; range: any }[] = [];
    for (const [uri, config] of this.fileConfigs.entries()) {
      if (config.markers.has(name) || config.directives.has(name)) {
        results.push({
          uri,
          range: { startLine: 1, startCol: 1, endLine: 1, endCol: 1 },
        });
      }
    }
    return results;
  }

  public getCompletions(prefix: string, uri?: string): string[] {
    const norm = prefix.toLowerCase();
    const suggestions = new Set<string>();

    const searchUris = uri && this.fileIndices.has(uri) ? [uri] : Array.from(this.fileIndices.keys());
    for (const u of searchUris) {
      const idx = this.fileIndices.get(u);
      if (!idx) continue;
      for (const name of idx.byName.keys()) {
        if (name.toLowerCase().startsWith(norm)) {
          suggestions.add(name);
        }
      }
    }

    return Array.from(suggestions);
  }

  public indexFile(uri: string, content: string): void {
    let slot = this.fileBaseIds.get(uri);
    if (!slot) {
      slot = this.nextFileSlot++;
      this.fileBaseIds.set(uri, slot);
    }
    const baseId = slot * 100_000;
    let localCounter = 1;
    const allocId = (): SymbolId => (baseId + localCounter++) as SymbolId;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const addSym = (parentId: SymbolId | null, name: string, kind: string): SymbolId => {
      const id = allocId();
      const entry: SymbolEntry = {
        id,
        name,
        kind: kind as any,
        ruleName: "cfd_entity",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "cfd",
        resourceId: uri,
        metadata: {},
      };
      symbols.set(id, entry);

      const list = byName.get(name) ?? [];
      list.push(id);
      byName.set(name, list);

      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(id);
      childrenOf.set(parentId, siblings);

      return id;
    };

    try {
      const ext = uri.split(".").pop() ?? "su2";
      const config = parseCfdConfig(content, ext);
      this.fileConfigs.set(uri, config);

      const rootName = config.mathProblem || (config.meshFilename ? `CFD:${config.meshFilename}` : "CFD Case");
      const rootId = addSym(null, rootName, "model");

      // Index markers
      for (const [markerName, marker] of config.markers.entries()) {
        addSym(rootId, markerName, `marker:${marker.type.toLowerCase()}`);
      }

      // Index key aerodynamic/flow parameters
      if (config.machNumber !== undefined) {
        addSym(rootId, `Mach_${config.machNumber}`, "parameter");
      }
      if (config.reynoldsNumber !== undefined) {
        addSym(rootId, `Re_${config.reynoldsNumber}`, "parameter");
      }
      if (config.aoa !== undefined) {
        addSym(rootId, `AoA_${config.aoa}`, "parameter");
      }
      if (config.meshFilename) {
        addSym(rootId, config.meshFilename, "file");
      }

      this.fileIndices.set(uri, { symbols, byName, childrenOf });
    } catch {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }
}
