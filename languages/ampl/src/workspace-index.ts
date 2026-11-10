// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Multi-file Workspace Indexer for AMPL Models & Data.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parseAmplData } from "./parser/ampl-dat-parser.js";
import { parseAmplModel } from "./parser/ampl-mod-parser.js";
import type { AmplData, AmplModel } from "./types.js";

export class AmplWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileModels = new Map<string, AmplModel>();
  private fileData = new Map<string, AmplData>();
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

  public getModel(uri: string): AmplModel | undefined {
    return this.fileModels.get(uri);
  }

  public getData(uri: string): AmplData | undefined {
    return this.fileData.get(uri);
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
      const symId = (baseId! + localId++) as SymbolId;
      const entry: SymbolEntry = {
        id: symId,
        name,
        kind,
        ruleName: "ampl_symbol",
        namePath: name,
        fieldName: null,
        parentId,
        startOffset,
        endOffset,
        exports: [],
        inherits: [],
        language: "ampl",
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

    const isDat = uri.toLowerCase().endsWith(".dat") || /^\s*(?:set|param)\s+\w+\s*:?=/m.test(text);

    if (isDat) {
      try {
        const data = parseAmplData(text);
        this.fileData.set(uri, data);
        const rootId = addSymbol("AMPL_Data", "package", null, 0, text.length);

        for (const [setName, elements] of data.sets) {
          addSymbol(setName, "array", rootId, 0, 50, { size: elements.length });
        }
        for (const [paramName, values] of data.params) {
          addSymbol(paramName, "constant", rootId, 0, 50, { size: values.size });
        }
      } catch {
        // Fallback to empty symbols on parse error
      }
    } else {
      try {
        const model = parseAmplModel(text);
        this.fileModels.set(uri, model);
        const rootId = addSymbol("AMPL_Model", "package", null, 0, text.length);

        for (const [name, decl] of model.sets) {
          addSymbol(name, "array", rootId, 0, 50, { dimen: decl.dimen });
        }
        for (const [name, decl] of model.params) {
          addSymbol(name, "constant", rootId, 0, 50, { type: decl.type });
        }
        for (const [name, decl] of model.vars) {
          addSymbol(name, "variable", rootId, 0, 50, { type: decl.type });
        }
        for (const [name, decl] of model.objectives) {
          addSymbol(name, "function", rootId, 0, 50, { direction: decl.direction });
        }
        for (const [name, decl] of model.constraints) {
          addSymbol(name, "property", rootId, 0, 50, { operator: decl.operator });
        }
      } catch {
        // Fallback to empty symbols on parse error
      }
    }

    const symbolIndex: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

    this.fileIndices.set(uri, symbolIndex);
    return symbolIndex;
  }
}
