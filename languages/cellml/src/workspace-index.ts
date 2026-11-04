// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/cellml — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for CellML 1.0 / 1.1 / 2.0 files (.cellml, .xml).
 * Indexes model root, custom units, components, variables, equations, and connections.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseCellml } from "./parser/index.js";
import type { CellmlDocument } from "./types.js";

export type CellmlDocumentLoader = () =>
  | string
  | { sourceText?: string | undefined; text?: string | undefined }
  | null
  | undefined;

export class CellmlWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, CellmlDocument>();
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

  public getDocument(uri: string): CellmlDocument | undefined {
    return this.fileDocuments.get(uri);
  }

  public register(uri: string, _loader?: CellmlDocumentLoader): void {
    if (!this.fileIndices.has(uri)) {
      this.fileIndices.set(uri, {
        symbols: new Map(),
        byName: new Map(),
        childrenOf: new Map(),
      });
    }
  }

  public reindexDocument(uri: string, loader?: CellmlDocumentLoader): void {
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
    const addByName = (key: string, symId: SymbolId): void => {
      if (!key) return;
      const list = byName.get(key) ?? [];
      if (!list.includes(symId)) {
        list.push(symId);
        byName.set(key, list);
      }
    };

    const addSymbol = (
      name: string,
      kind: string,
      ruleName: string,
      namePath: string,
      parentId: SymbolId | null,
      startOffset: number,
      endOffset: number,
      metadata: Record<string, unknown> = {},
    ): SymbolId => {
      const symId = ((baseId ?? 0) + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName,
        namePath,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "cellml",
        resourceId: uri,
        metadata,
      };

      symbols.set(symId, entry);
      addByName(name, symId);
      if (namePath !== name) {
        addByName(namePath, symId);
      }

      const existingChildren = childrenOf.get(parentId) ?? [];
      existingChildren.push(symId);
      childrenOf.set(parentId, existingChildren);

      return symId;
    };

    try {
      const doc = parseCellml(text, uri);
      this.fileDocuments.set(uri, doc);

      const modelName = doc.name || "CellmlModel";
      const rootId = addSymbol(
        modelName,
        "Package",
        "cellml_model",
        modelName,
        null,
        doc.range?.startOffset ?? 0,
        doc.range?.endOffset ?? text.length,
        {
          version: doc.version,
          unitCount: doc.units.size,
          componentCount: doc.components.size,
          connectionCount: doc.connections.length,
        },
      );

      // Index custom <units>
      for (const u of doc.units.values()) {
        addSymbol(
          u.name,
          "Constant",
          "cellml_units",
          `${modelName}.${u.name}`,
          rootId,
          u.range.startOffset,
          u.range.endOffset,
          {
            isBaseUnits: u.isBaseUnits,
            dimensions: u.dimensions,
          },
        );
      }

      // Index <component> and child <variable> / <math> equations
      for (const comp of doc.components.values()) {
        const compId = addSymbol(
          comp.name,
          "Component",
          "cellml_component",
          `${modelName}.${comp.name}`,
          rootId,
          comp.range.startOffset,
          comp.range.endOffset,
          {
            variableCount: comp.variables.size,
            equationCount: comp.equations.length,
          },
        );

        for (const v of comp.variables.values()) {
          const qualName = `${comp.name}.${v.name}`;
          const symId = addSymbol(
            v.name,
            "Variable",
            "cellml_variable",
            qualName,
            compId,
            v.range.startOffset,
            v.range.endOffset,
            {
              units: v.units,
              initialValue: v.initialValue,
              publicInterface: v.publicInterface,
              privateInterface: v.privateInterface,
            },
          );
          addByName(qualName, symId);
        }

        for (const eq of comp.equations) {
          const eqName = eq.isOde ? `der(${eq.targetVariable})` : eq.targetVariable;
          addSymbol(
            eqName,
            "Function",
            "cellml_equation",
            `${comp.name}.${eqName}`,
            compId,
            eq.range.startOffset,
            eq.range.endOffset,
            {
              targetVariable: eq.targetVariable,
              isOde: eq.isOde,
              independentVariable: eq.independentVariable,
              rhsExpression: eq.rhsExpression,
            },
          );
        }
      }
    } catch {
      // Partial index on malformed XML
    }

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public resolveInScope(name: string, scopeId: SymbolId | null, uri: string): SymbolEntry | null {
    const idx = this.fileIndices.get(uri);
    if (!idx) return null;

    if (scopeId !== null) {
      const children = idx.childrenOf.get(scopeId);
      if (children) {
        for (const cid of children) {
          const sym = idx.symbols.get(cid);
          if (sym && sym.name === name) {
            return sym;
          }
        }
      }
    }

    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      const firstId = candidates?.[0];
      if (firstId !== undefined) {
        const found = fileIndex.symbols.get(firstId);
        if (found) return found;
      }
    }

    return null;
  }

  public lookupExact(id: SymbolId): SymbolEntry | undefined {
    for (const index of this.fileIndices.values()) {
      const sym = index.symbols.get(id);
      if (sym) return sym;
    }
    return undefined;
  }

  public findByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const index of this.fileIndices.values()) {
      const ids = index.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const s = index.symbols.get(id);
          if (s) results.push(s);
        }
      }
    }
    return results;
  }

  public findDefinition(name: string): SymbolEntry | undefined {
    return this.findByName(name)[0];
  }

  public findReferences(name: string): SymbolEntry[] {
    return this.findByName(name);
  }

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    return idx ? Array.from(idx.symbols.values()) : [];
  }

  public getSymbols(uri: string): SymbolEntry[] {
    return this.getAllSymbols(uri);
  }

  public getAllFiles(): string[] {
    return Array.from(this.fileIndices.keys());
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
    this.nextFileSlot = 1;
  }
}
