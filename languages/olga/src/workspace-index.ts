// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/olga — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for OLGA multiphase models, resolving
 * flowpaths, pipeline segments, boundary nodes, and external fluid tables (.tab)
 * across project workspaces into the Salsa QueryEngine.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseOpi } from "./parser/opi-parser.js";
import type { OlgaModel } from "./types.js";

export class OlgaWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, OlgaModel>();
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

  public getModel(uri: string): OlgaModel | undefined {
    return this.fileModels.get(uri);
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

  public reindexDocument(uri: string, loader?: () => unknown): void {
    this._version++;
    if (loader) {
      try {
        const res = loader();
        const obj = typeof res === "object" && res !== null ? (res as { sourceText?: unknown; text?: unknown }) : null;
        const text = typeof res === "string" ? res : (obj?.sourceText ?? obj?.text);
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

    const parsedModel = parseOpi(text);
    this.fileModels.set(uri, parsedModel);

    // Root OlgaCase Symbol
    const rootId = idCounter++ as SymbolId;
    const caseName = parsedModel.title || "OlgaCase";
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: caseName,
      kind: "Class",
      ruleName: "olga_case",
      namePath: caseName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "olga",
      resourceId: uri,
      metadata: {
        tableFile: parsedModel.tableFile,
        nFlowpaths: parsedModel.flowpaths.length,
        nNodes: parsedModel.nodes.length,
      },
    };
    symbols.set(rootId, rootEntry);
    byName.set(caseName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    function addChild(name: string, kind: string, meta?: Record<string, unknown>) {
      const id = idCounter++ as SymbolId;
      const entry: SymbolEntry = {
        id,
        name,
        kind,
        ruleName: "olga_component",
        namePath: `${caseName}.${name}`,
        fieldName: null,
        parentId: rootId,
        startOffset: 0,
        endOffset: 0,
        exports: [],
        inherits: [],
        language: "olga",
        resourceId: uri,
        metadata: meta ?? {},
      };
      symbols.set(id, entry);
      const existing = byName.get(name) ?? [];
      existing.push(id);
      byName.set(name, existing);
      childIds.push(id);
    }

    // Index flowpaths, pipes, and valves
    for (const fp of parsedModel.flowpaths) {
      addChild(fp.name, "Component", { kind: "flowpath", pipeCount: fp.pipes.length });
      for (const p of fp.pipes) {
        addChild(`${fp.name}.${p.label}`, "Property", {
          kind: "pipe",
          length: p.length,
          diameter: p.diameter,
          elevation: p.elevation,
        });
      }
      for (const v of fp.valves) {
        addChild(`${fp.name}.${v.name}`, "Property", {
          kind: "valve",
          opening: v.opening,
          diameter: v.diameter,
        });
      }
    }

    // Index boundary nodes
    for (const node of parsedModel.nodes) {
      addChild(node.name, "Port", {
        kind: "node",
        type: node.type,
        flowpath: node.flowpath,
        boundaryPosition: node.boundaryPosition,
      });
    }

    // Index referenced fluid table file if specified
    if (parsedModel.tableFile) {
      addChild(parsedModel.tableFile, "Import", {
        kind: "table_file",
        path: parsedModel.tableFile,
      });
    }

    childrenOf.set(rootId, childIds);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public removeFile(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileModels.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileModels.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
  }
}
