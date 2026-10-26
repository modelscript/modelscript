// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSimulink } from "./parser/index.js";
import type { SimulinkBlock, SimulinkModel, SimulinkSystem } from "./types.js";

/**
 * Multi-File Workspace Indexer for MATLAB Simulink models (.slx, .mdl).
 * Indexes models, subsystems, blocks, and connections across workspace files.
 */
export class SimulinkWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, SimulinkModel>();
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

  public getModel(uri: string): SimulinkModel | undefined {
    return this.fileModels.get(uri);
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
        // incremental reindex guard
      }
    }
  }

  public indexFile(uri: string, content: string | Buffer | Uint8Array): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let baseId = this.fileBaseIds.get(uri);
    if (baseId === undefined) {
      baseId = this.nextFileSlot++ * 10000;
      this.fileBaseIds.set(uri, baseId);
    }
    let localCounter = 1;

    const makeId = (): SymbolId => (baseId! + localCounter++) as SymbolId;

    const addSymbol = (name: string, kind: string, parentId: SymbolId | null): SymbolId => {
      const id = makeId();
      const entry: SymbolEntry = {
        id,
        name,
        kind: kind as any,
        ruleName: kind === "Class" ? "simulink_model" : "simulink_block",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "simulink",
        resourceId: uri,
        metadata: {},
      };
      symbols.set(id, entry);

      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);

      const siblingList = childrenOf.get(parentId) ?? [];
      siblingList.push(id);
      childrenOf.set(parentId, siblingList);

      return id;
    };

    try {
      const model = parseSimulink(content, uri);
      this.fileModels.set(uri, model);

      // Root Model Symbol
      const modelSymbolId = addSymbol(model.name, "Class", null);

      // Index system recursively
      this.indexSystem(model.rootSystem, modelSymbolId, addSymbol);
    } catch {
      // Return empty index on parse failure
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  private indexSystem(
    system: SimulinkSystem,
    parentSymbolId: SymbolId,
    addSymbol: (name: string, kind: string, parentId: SymbolId | null) => SymbolId,
  ): void {
    for (const block of system.blocks.values()) {
      const blockId = addSymbol(block.name, "Component", parentSymbolId);

      if (block.type === "SubSystem" && block.subsystem) {
        this.indexSystem(block.subsystem, blockId, addSymbol);
      }
    }
  }

  public lookup(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const fileIdx of this.fileIndices.values()) {
      const ids = fileIdx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const entry = fileIdx.symbols.get(id);
          if (entry) results.push(entry);
        }
      }
    }
    return results;
  }

  public getBlocksByName(blockName: string): SimulinkBlock[] {
    const list: SimulinkBlock[] = [];
    for (const model of this.fileModels.values()) {
      const found = model.rootSystem.blocks.get(blockName);
      if (found) list.push(found);
    }
    return list;
  }
}
