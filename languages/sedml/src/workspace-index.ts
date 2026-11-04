// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseSedml } from "./parser/sedml-parser.js";
import type { SedmlDocument } from "./types.js";

export type SedmlDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

/**
 * Multi-file workspace indexer for Simulation Experiment Description Markup Language documents (.sedml, .xml).
 */
export class SedmlWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, SedmlDocument>();
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

  public getDocument(uri: string): SedmlDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: SedmlDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: SedmlDocumentLoader): void {
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

    let localId = 1;
    function addSymbol(
      name: string,
      kind: string,
      parentId: SymbolId | null,
      startOffset: number,
      endOffset: number,
      metadata: Record<string, unknown> = {},
    ): SymbolId {
      const symId = ((baseId ?? 0) + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "sedml_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "sedml",
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
      const doc = parseSedml(text, uri);
      this.fileDocuments.set(uri, doc);

      // Root Experiment symbol
      const rootId = addSymbol("SedmlExperiment", "package", null, 0, text.length, {
        level: doc.level,
        version: doc.version,
        simulationCount: doc.simulations.length,
        modelCount: doc.models.length,
        taskCount: doc.tasks.length,
        dataGeneratorCount: doc.dataGenerators.length,
        outputCount: doc.outputs.length,
      });

      // Index Simulations
      for (const sim of doc.simulations) {
        const start = sim.range?.startOffset ?? 0;
        const end = sim.range?.endOffset ?? 50;
        addSymbol(sim.id, "event", rootId, start, end, {
          name: sim.name,
          type: sim.type,
          kisaoID: sim.algorithm?.kisaoID,
          initialTime: sim.initialTime,
          outputStartTime: sim.outputStartTime,
          outputEndTime: sim.outputEndTime,
          numberOfSteps: sim.numberOfSteps,
        });
      }

      // Index Models
      for (const m of doc.models) {
        const start = m.range?.startOffset ?? 0;
        const end = m.range?.endOffset ?? 50;
        addSymbol(m.id, "struct", rootId, start, end, {
          name: m.name,
          language: m.language,
          source: m.source,
          changeCount: m.changes.length,
        });
      }

      // Index Tasks
      for (const t of doc.tasks) {
        const start = t.range?.startOffset ?? 0;
        const end = t.range?.endOffset ?? 50;
        addSymbol(t.id, "function", rootId, start, end, {
          name: t.name,
          type: t.type,
          modelReference: t.modelReference,
          simulationReference: t.simulationReference,
        });
      }

      // Index DataGenerators
      for (const dg of doc.dataGenerators) {
        const start = dg.range?.startOffset ?? 0;
        const end = dg.range?.endOffset ?? 50;
        addSymbol(dg.id, "variable", rootId, start, end, {
          name: dg.name,
          math: dg.math,
          variableCount: dg.variables.length,
          parameterCount: dg.parameters.length,
        });
      }

      // Index Outputs
      for (const out of doc.outputs) {
        const start = out.range?.startOffset ?? 0;
        const end = out.range?.endOffset ?? 50;
        addSymbol(out.id, "interface", rootId, start, end, {
          name: out.name,
          type: out.type,
          curveCount: out.curves.length,
          dataSetCount: out.dataSets.length,
        });
      }
    } catch {
      // Return partial symbol map if parsing failed
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public getSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
  }

  public findDefinition(name: string): SymbolEntry | undefined {
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids && ids.length > 0 && ids[0] !== undefined) {
        const sym = idx.symbols.get(ids[0]);
        if (sym) return sym;
      }
    }
    return undefined;
  }

  public findReferences(name: string): SymbolEntry[] {
    const refs: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const sym = idx.symbols.get(id);
          if (sym) refs.push(sym);
        }
      }
    }
    return refs;
  }

  public clear(): void {
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
    this._version++;
  }
}
