// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSimaFile } from "./parser/index.js";
import type { SimaModel } from "./types.js";

/**
 * Workspace symbol indexer for SINTEF Ocean SIMO / RIFLEX and SIMA models (.inp, .sys, .sima, .hyd).
 */
export class SimaWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, SimaModel>();
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

  public getModel(uri: string): SimaModel | undefined {
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
    const model = parseSimaFile(text, uri);
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
        ruleName: "sima",
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

    const rootName = model.title || "SIMA Model";
    const rootId = addSymbol(rootName, "Package", null, 0, text.length);

    // Index Vessels
    for (const v of model.vessels) {
      const vId = addSymbol(v.name, "Class", rootId);
      for (const fl of v.fairleads) {
        addSymbol(`Fairlead: ${fl.name}`, "Port", vId);
      }
    }

    // Index Mooring Lines
    for (const line of model.lines) {
      const lId = addSymbol(`Line: ${line.name} [${line.type}]`, "Variable", rootId);
      for (const seg of line.segments) {
        addSymbol(`Segment: ${seg.name} (${seg.length}m)`, "Field", lId);
      }
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

  public allUris(): string[] {
    return Array.from(this.fileIndices.keys());
  }
}
