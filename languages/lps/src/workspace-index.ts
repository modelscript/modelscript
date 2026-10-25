// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/lps — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for PipelineStudio models, resolving
 * pipeline networks, compressor stations, and delivery nodes across workspaces
 * into the Salsa QueryEngine.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseLps } from "./parser/index.js";
import type { LpsModel } from "./types.js";

export class LpsWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, LpsModel>();
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

  public getModel(uri: string): LpsModel | undefined {
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
        // Ignore loader errors during incremental re-indexing
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

    const parsedModel = parseLps(text, uri);
    this.fileModels.set(uri, parsedModel);

    // Root LpsStudy Symbol
    const rootId = idCounter++ as SymbolId;
    const studyName = parsedModel.title || parsedModel.id || "PipelineStudy";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: studyName,
      kind: "Class",
      ruleName: "lps_study",
      namePath: studyName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "lps",
      resourceId: uri,
      metadata: {
        type: parsedModel.type,
        nPipes: parsedModel.pipes.length,
        nNodes: parsedModel.nodes.length,
        nCompressors: parsedModel.compressors.length,
        nPumps: parsedModel.pumps.length,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(studyName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    function addChild(name: string, kind: string, meta?: any) {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind: kind as any,
        ruleName: "lps_component",
        namePath: `${studyName}.${name}`,
        fieldName: null,
        parentId: rootId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "lps",
        resourceId: uri,
        metadata: meta ?? {},
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    }

    for (const node of parsedModel.nodes) {
      addChild(node.name, "Field", { type: node.type, elevation: node.elevation, pressure: node.pressure });
    }
    for (const pipe of parsedModel.pipes) {
      addChild(pipe.name, "Variable", { length: pipe.length, diameter: pipe.diameter, maop: pipe.maop });
    }
    for (const comp of parsedModel.compressors) {
      addChild(comp.name, "Method", { type: comp.type, maxPower: comp.maxPower });
    }
    for (const pump of parsedModel.pumps) {
      addChild(pump.name, "Method", { maxPower: pump.maxPower });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public getSymbols(): SymbolEntry[] {
    const all: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      for (const entry of idx.symbols.values()) {
        all.push(entry);
      }
    }
    return all;
  }
}
