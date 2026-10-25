// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseGtmModel } from "./parser/gtm-parser.js";
import type { GtModel } from "./types.js";

/**
 * Workspace symbol indexer for GT-SUITE engine and powertrain models (.gtm, .gtd, .gtx).
 */
export class GtSuiteWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, GtModel>();
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

  public getModel(uri: string): GtModel | undefined {
    return this.fileModels.get(uri);
  }

  public register(uri: string, _loader?: () => unknown, text?: string): void {
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
    const model = parseGtmModel(text);
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

    let symCounter = 1;
    function addSymbol(
      name: string,
      kind: string,
      parentId: SymbolId | null,
      startOffset = 0,
      endOffset = 0,
    ): SymbolId {
      const symId = (baseId! + symCounter++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "component",
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

    // 1. Model Root Symbol
    const modelRootId = addSymbol(model.name, "Package", null, 0, text.length);

    // 2. Component Symbols
    for (const comp of model.components) {
      const label = `${comp.id} [${comp.kind}]`;
      addSymbol(label, "Class", modelRootId, 0, 0);
    }

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, index);
    this._version++;
    return index;
  }

  public lookup(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const entry = index.symbols.get(id);
          if (entry) results.push(entry);
        }
      }
    }
    return results;
  }
}
