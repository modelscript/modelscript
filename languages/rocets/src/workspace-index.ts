// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseRocetsDeck } from "./parser/deck-parser.js";
import type { RocetsEngineModel } from "./types.js";

/**
 * Workspace symbol indexer for NASA ROCETS engine models (.roc, .dat, .deck).
 */
export class RocetsWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, RocetsEngineModel>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
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

  public getModel(uri: string): RocetsEngineModel | undefined {
    return this.fileModels.get(uri);
  }

  public register(uri: string, _loader?: () => any, text?: string): void {
    if (text) {
      this.indexFile(uri, text);
    }
  }

  public unregister(uri: string): void {
    this.fileIndices.delete(uri);
    this.fileModels.delete(uri);
    this.fileBaseIds.delete(uri);
    this._version++;
  }

  public indexFile(uri: string, text: string): SymbolIndex {
    const model = parseRocetsDeck(text);
    this.fileModels.set(uri, model);

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot * 100000;
      this.fileBaseIds.set(uri, baseId);
      this.nextFileSlot++;
    }

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    childrenOf.set(null, []);

    let localId = 1;
    function addSymbol(
      name: string,
      kind: string,
      parentId: SymbolId | null,
      startOffset = 0,
      endOffset = 0,
    ): SymbolId {
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "module",
        fieldName: "name",
        namePath: "name",
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        metadata: {},
      };
      symbols.set(symId, entry);

      const list = byName.get(name) || [];
      list.push(symId);
      byName.set(name, list);

      const ch = childrenOf.get(parentId) || [];
      ch.push(symId);
      childrenOf.set(parentId, ch);

      return symId;
    }

    // Engine Model root symbol (Kind "Package")
    const modelRootId = addSymbol(model.name, "Package", null, 0, text.length);

    // Module symbols (Kind "Class")
    for (const [compId, comp] of model.components) {
      const label = `${compId} [${comp.type}]`;
      addSymbol(label, "Class", modelRootId, comp.startOffset ?? 0, comp.endOffset ?? 0);
    }

    const symIndex: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, symIndex);
    this._version++;
    return symIndex;
  }

  public toUnifiedPartial(): SymbolIndex {
    const mergedSymbols = new Map<SymbolId, SymbolEntry>();
    const mergedByName = new Map<string, SymbolId[]>();
    const mergedChildrenOf = new Map<SymbolId | null, SymbolId[]>();

    mergedChildrenOf.set(null, []);

    for (const fileIdx of this.fileIndices.values()) {
      for (const [id, entry] of fileIdx.symbols) {
        mergedSymbols.set(id, entry);
      }
      for (const [name, ids] of fileIdx.byName) {
        const existing = mergedByName.get(name) || [];
        mergedByName.set(name, [...existing, ...ids]);
      }
      for (const [parent, children] of fileIdx.childrenOf) {
        const existing = mergedChildrenOf.get(parent) || [];
        mergedChildrenOf.set(parent, [...existing, ...children]);
      }
    }

    return {
      symbols: mergedSymbols,
      byName: mergedByName,
      childrenOf: mergedChildrenOf,
    };
  }
}
