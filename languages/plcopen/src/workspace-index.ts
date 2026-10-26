// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * @modelscript/plcopen — Multi-File Workspace Indexer.
 *
 * Implements IWorkspaceIndex for IEC 61131-3 PLCopen XML and Structured Text files (.xml, .plcopen, .st).
 * Indexes POUs (programs, function blocks, functions), variables, data types, tasks, and configurations.
 */

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";
import { parsePlcopen } from "./parser/index.js";
import type { PlcProject } from "./types.js";

export class PlcopenWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileDocuments = new Map<string, PlcProject>();
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

  public getDocument(uri: string): PlcProject | undefined {
    return this.fileDocuments.get(uri);
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

    const project = parsePlcopen(text, uri);
    this.fileDocuments.set(uri, project);

    const rootChildren: SymbolId[] = [];

    // 1. Index Data Types
    for (const dt of project.dataTypes) {
      const dtId = idCounter++ as SymbolId;
      rootChildren.push(dtId);

      const dtEntry: SymbolEntry = {
        id: dtId,
        name: dt.name,
        kind: "Type",
        ruleName: "plc_data_type",
        namePath: dt.name,
        fieldName: null,
        parentId: null,
        startOffset: dt.range?.startOffset ?? 0,
        endOffset: dt.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "plcopen",
        resourceId: uri,
        metadata: {
          kind: dt.kind,
          baseType: dt.baseType,
        },
      };
      symbols.set(dtId, dtEntry);

      const ex = byName.get(dt.name) || [];
      ex.push(dtId);
      byName.set(dt.name, ex);
    }

    // 2. Index POUs
    for (const pou of project.pous) {
      const pouId = idCounter++ as SymbolId;
      rootChildren.push(pouId);

      const kindStr = pou.pouType === "function" ? "Function" : pou.pouType === "functionBlock" ? "Class" : "Class";

      const pouEntry: SymbolEntry = {
        id: pouId,
        name: pou.name,
        kind: kindStr as any,
        ruleName: `plc_${pou.pouType}`,
        namePath: pou.name,
        fieldName: null,
        parentId: null,
        startOffset: pou.range.startOffset,
        endOffset: pou.range.endOffset,
        exports: [],
        inherits: [],
        language: "plcopen",
        resourceId: uri,
        metadata: {
          pouType: pou.pouType,
          returnType: pou.returnType,
          variablesCount: pou.variables.length,
          statementsCount: pou.body.st?.statements.length ?? 0,
        },
      };
      symbols.set(pouId, pouEntry);

      const existingPou = byName.get(pou.name) || [];
      existingPou.push(pouId);
      byName.set(pou.name, existingPou);

      const pouChildren: SymbolId[] = [];

      // Variables inside POU
      for (const v of pou.variables) {
        const varId = idCounter++ as SymbolId;
        pouChildren.push(varId);

        const varKind = v.scope === "input" || v.scope === "output" || v.scope === "inOut" ? "Component" : "Variable";

        const varEntry: SymbolEntry = {
          id: varId,
          name: v.name,
          kind: varKind as any,
          ruleName: `plc_variable_${v.scope}`,
          namePath: `${pou.name}.${v.name}`,
          fieldName: null,
          parentId: pouId,
          startOffset: v.range.startOffset,
          endOffset: v.range.endOffset,
          exports: [],
          inherits: [],
          language: "plcopen",
          resourceId: uri,
          metadata: {
            scope: v.scope,
            dataType: v.dataType,
            address: v.address,
            initialValue: v.initialValue,
          },
        };
        symbols.set(varId, varEntry);

        const ex = byName.get(v.name) || [];
        ex.push(varId);
        byName.set(v.name, ex);
      }

      childrenOf.set(pouId, pouChildren);
    }

    // 3. Index Configurations & Tasks
    for (const config of project.configurations) {
      const configId = idCounter++ as SymbolId;
      rootChildren.push(configId);

      const configEntry: SymbolEntry = {
        id: configId,
        name: config.name,
        kind: "Package",
        ruleName: "plc_configuration",
        namePath: config.name,
        fieldName: null,
        parentId: null,
        startOffset: config.range?.startOffset ?? 0,
        endOffset: config.range?.endOffset ?? 0,
        exports: [],
        inherits: [],
        language: "plcopen",
        resourceId: uri,
        metadata: {
          resourceCount: config.resources.length,
        },
      };
      symbols.set(configId, configEntry);

      const ex = byName.get(config.name) || [];
      ex.push(configId);
      byName.set(config.name, ex);

      const configChildren: SymbolId[] = [];

      for (const res of config.resources) {
        for (const task of res.tasks) {
          const taskId = idCounter++ as SymbolId;
          configChildren.push(taskId);

          const taskEntry: SymbolEntry = {
            id: taskId,
            name: task.name,
            kind: "Event",
            ruleName: "plc_task",
            namePath: `${config.name}.${res.name}.${task.name}`,
            fieldName: null,
            parentId: configId,
            startOffset: task.range?.startOffset ?? 0,
            endOffset: task.range?.endOffset ?? 0,
            exports: [],
            inherits: [],
            language: "plcopen",
            resourceId: uri,
            metadata: {
              priority: task.priority,
              interval: task.interval,
              intervalMs: task.intervalMs,
            },
          };
          symbols.set(taskId, taskEntry);

          const tex = byName.get(task.name) || [];
          tex.push(taskId);
          byName.set(task.name, tex);
        }
      }

      childrenOf.set(configId, configChildren);
    }

    childrenOf.set(null, rootChildren);

    const index: SymbolIndex = {
      symbols,
      byName,
      childrenOf,
    };

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
          if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
            return sym;
          }
        }
      }
    }

    // Fallback: search global scope across all indexed files
    for (const fileIndex of this.fileIndices.values()) {
      const candidates = fileIndex.byName.get(name);
      if (candidates && candidates.length > 0) {
        const found = fileIndex.symbols.get(candidates[0]!);
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

  public getAllSymbols(uri: string): SymbolEntry[] {
    const idx = this.fileIndices.get(uri);
    if (!idx) return [];
    return Array.from(idx.symbols.values());
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
