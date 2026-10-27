// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/verilog-a — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for Verilog-A / Verilog-AMS models (.va, .vams).
 * Indexes modules, ports, parameters, variables, and cross-file `include dependencies.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseVerilogA } from "./parser/verilog-a-parser.js";
import type { VerilogADocument } from "./types.js";

export class VerilogAWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, VerilogADocument>();
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

  public getDocument(uri: string): VerilogADocument | undefined {
    return this.fileDocuments.get(uri);
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

  public reindexDocument(
    uri: string,
    loader?: () => string | { sourceText?: string; text?: string } | null | undefined,
  ): void {
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

    const doc = parseVerilogA(text, uri);
    this.fileDocuments.set(uri, doc);

    const rootChildren: SymbolId[] = [];

    for (const mod of doc.modules) {
      const modId = idCounter++ as SymbolId;
      rootChildren.push(modId);

      const modEntry: SymbolEntry = {
        id: modId,
        name: mod.name,
        kind: "Class",
        ruleName: "verilog_a_module",
        namePath: mod.name,
        fieldName: null,
        parentId: null,
        startOffset: mod.sourceRange.startOffset,
        endOffset: mod.sourceRange.endOffset,
        exports: [],
        inherits: [],
        language: "verilog-a",
        resourceId: uri,
        metadata: {
          portsCount: mod.ports.length,
          parametersCount: mod.parameters.length,
        },
      };
      symbols.set(modId, modEntry);

      const existingMod = byName.get(mod.name) || [];
      existingMod.push(modId);
      byName.set(mod.name, existingMod);

      const modChildren: SymbolId[] = [];

      // Ports
      for (const port of mod.ports) {
        const portId = idCounter++ as SymbolId;
        modChildren.push(portId);

        const portEntry: SymbolEntry = {
          id: portId,
          name: port.name,
          kind: "Component",
          ruleName: "verilog_a_port",
          namePath: `${mod.name}.${port.name}`,
          fieldName: null,
          parentId: modId,
          startOffset: port.sourceRange.startOffset,
          endOffset: port.sourceRange.endOffset,
          exports: [],
          inherits: [],
          language: "verilog-a",
          resourceId: uri,
          metadata: {
            direction: port.direction,
            discipline: port.discipline ?? "electrical",
          },
        };
        symbols.set(portId, portEntry);

        const ex = byName.get(port.name) || [];
        ex.push(portId);
        byName.set(port.name, ex);
      }

      // Parameters
      for (const param of mod.parameters) {
        const paramId = idCounter++ as SymbolId;
        modChildren.push(paramId);

        const paramEntry: SymbolEntry = {
          id: paramId,
          name: param.name,
          kind: "Constant",
          ruleName: "verilog_a_parameter",
          namePath: `${mod.name}.${param.name}`,
          fieldName: null,
          parentId: modId,
          startOffset: param.sourceRange.startOffset,
          endOffset: param.sourceRange.endOffset,
          exports: [],
          inherits: [],
          language: "verilog-a",
          resourceId: uri,
          metadata: {
            type: param.type,
            defaultValue: param.defaultValue,
          },
        };
        symbols.set(paramId, paramEntry);

        const ex = byName.get(param.name) || [];
        ex.push(paramId);
        byName.set(param.name, ex);
      }

      // Variables
      for (const v of mod.variables) {
        const varId = idCounter++ as SymbolId;
        modChildren.push(varId);

        const varEntry: SymbolEntry = {
          id: varId,
          name: v.name,
          kind: "Variable",
          ruleName: "verilog_a_variable",
          namePath: `${mod.name}.${v.name}`,
          fieldName: null,
          parentId: modId,
          startOffset: v.sourceRange.startOffset,
          endOffset: v.sourceRange.endOffset,
          exports: [],
          inherits: [],
          language: "verilog-a",
          resourceId: uri,
          metadata: {
            type: v.type,
          },
        };
        symbols.set(varId, varEntry);

        const ex = byName.get(v.name) || [];
        ex.push(varId);
        byName.set(v.name, ex);
      }

      childrenOf.set(modId, modChildren);
    }

    childrenOf.set(null, rootChildren);

    const index: SymbolIndex = { symbols, byName, childrenOf };
    this.fileIndices.set(uri, index);
    return index;
  }

  public remove(uri: string): void {
    this._version++;
    this.fileIndices.delete(uri);
    this.fileDocuments.delete(uri);
    this.fileBaseIds.delete(uri);
  }

  public clear(): void {
    this._version++;
    this.fileIndices.clear();
    this.fileDocuments.clear();
    this.fileBaseIds.clear();
  }

  public findSymbol(uri: string, name: string): SymbolEntry | undefined {
    const idx = this.fileIndices.get(uri);
    if (!idx) return undefined;
    const ids = idx.byName.get(name);
    if (!ids || ids.length === 0) return undefined;
    const firstId = ids[0];
    if (firstId === undefined) return undefined;
    return idx.symbols.get(firstId);
  }

  public findSymbolsByName(name: string): SymbolEntry[] {
    const results: SymbolEntry[] = [];
    for (const idx of this.fileIndices.values()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const s = idx.symbols.get(id);
          if (s) results.push(s);
        }
      }
    }
    return results;
  }

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
  }

  public findReferences(name: string): { uri: string; symbol: SymbolEntry }[] {
    const matches: { uri: string; symbol: SymbolEntry }[] = [];
    for (const [uri, idx] of this.fileIndices.entries()) {
      const ids = idx.byName.get(name);
      if (ids) {
        for (const id of ids) {
          const sym = idx.symbols.get(id);
          if (sym) {
            matches.push({ uri, symbol: sym });
          }
        }
      }
    }
    return matches;
  }
}
