// SPDX-License-Identifier: AGPL-3.0-or-later

import type { IWorkspaceIndex, SymbolEntry, SymbolId, SymbolIndex } from "@modelscript/runtime";

export interface ScadDependency {
  type: "include" | "use";
  targetPath: string;
  startOffset: number;
  endOffset: number;
}

export interface ScadFileInfo {
  uri: string;
  index: SymbolIndex;
  modules: Map<string, SymbolEntry>;
  functions: Map<string, SymbolEntry>;
  variables: Map<string, SymbolEntry>;
  dependencies: ScadDependency[];
}

/**
 * Multi-File Workspace Indexer for OpenSCAD (.scad) models.
 *
 * Implements IWorkspaceIndex tracking document versions, structural revisions,
 * exported modules, functions, and variables across `include <...>` and `use <...>`
 * directives without regex hacks.
 */
export class ScadWorkspaceIndex implements IWorkspaceIndex {
  private _version = 1;
  private _structuralRevision = 1;
  private fileIndices = new Map<string, SymbolIndex>();
  private fileInfos = new Map<string, ScadFileInfo>();
  private fileBaseIds = new Map<string, number>();
  private nextFileSlot = 1;

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._structuralRevision;
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

  public getFileInfo(uri: string): ScadFileInfo | undefined {
    return this.fileInfos.get(uri);
  }

  public getDependencies(uri: string): ScadDependency[] {
    return this.fileInfos.get(uri)?.dependencies ?? [];
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
        const obj =
          typeof res === "object" && res !== null ? (res as { sourceText?: unknown; text?: unknown }) : undefined;
        const text = typeof res === "string" ? res : (obj?.sourceText ?? obj?.text);
        if (typeof text === "string") {
          this.indexFile(uri, text);
        }
      } catch {
        // incremental guard
      }
    }
  }

  /**
   * Parses an OpenSCAD source file and registers all declared modules, functions, variables,
   * and include/use dependencies in the workspace index.
   */
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

    const modules = new Map<string, SymbolEntry>();
    const functions = new Map<string, SymbolEntry>();
    const variables = new Map<string, SymbolEntry>();
    const dependencies: ScadDependency[] = [];

    // Root File Symbol
    const rootId = idCounter++ as SymbolId;
    const fileName = uri.split("/").pop() || uri;
    const rootEntry: SymbolEntry = {
      id: rootId,
      name: fileName,
      kind: "Class",
      ruleName: "scad_file",
      namePath: fileName,
      fieldName: null,
      parentId: null,
      startOffset: 0,
      endOffset: text.length,
      exports: [],
      inherits: [],
      language: "scad",
      metadata: {},
    };
    symbols.set(rootId, rootEntry);
    byName.set(fileName, [rootId]);
    childrenOf.set(null, [rootId]);

    const childIds: SymbolId[] = [];

    // Token-based scanning for modules, functions, variables, and include/use
    // Robustly strips comments before matching declarations
    let i = 0;
    const len = text.length;

    while (i < len) {
      // Skip whitespace
      if (text.charCodeAt(i) <= 32) {
        i++;
        continue;
      }

      // Skip line comment
      if (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 47) {
        i += 2;
        while (i < len && text.charCodeAt(i) !== 10 && text.charCodeAt(i) !== 13) i++;
        continue;
      }

      // Skip block comment
      if (text.charCodeAt(i) === 47 && text.charCodeAt(i + 1) === 42) {
        i += 2;
        while (i < len - 1 && !(text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 47)) i++;
        i += 2;
        continue;
      }

      // Check for include or use directive: `include <...>` or `use <...>`
      if (text.startsWith("include", i) && (text.charCodeAt(i + 7) <= 32 || text.charCodeAt(i + 7) === 60)) {
        const start = i;
        const openAngle = text.indexOf("<", i + 7);
        const closeAngle = openAngle !== -1 ? text.indexOf(">", openAngle) : -1;
        if (openAngle !== -1 && closeAngle !== -1) {
          const target = text.slice(openAngle + 1, closeAngle).trim();
          dependencies.push({ type: "include", targetPath: target, startOffset: start, endOffset: closeAngle + 1 });
          i = closeAngle + 1;
          continue;
        }
      }

      if (text.startsWith("use", i) && (text.charCodeAt(i + 3) <= 32 || text.charCodeAt(i + 3) === 60)) {
        const start = i;
        const openAngle = text.indexOf("<", i + 3);
        const closeAngle = openAngle !== -1 ? text.indexOf(">", openAngle) : -1;
        if (openAngle !== -1 && closeAngle !== -1) {
          const target = text.slice(openAngle + 1, closeAngle).trim();
          dependencies.push({ type: "use", targetPath: target, startOffset: start, endOffset: closeAngle + 1 });
          i = closeAngle + 1;
          continue;
        }
      }

      // Check for module declaration: `module name(...)`
      if (text.startsWith("module", i) && text.charCodeAt(i + 6) <= 32) {
        const start = i;
        i += 6;
        while (i < len && text.charCodeAt(i) <= 32) i++;
        const idStart = i;
        while (i < len && (isIdentChar(text.charCodeAt(i)) || (i === idStart && isIdentStart(text.charCodeAt(i))))) i++;
        const modName = text.slice(idStart, i).trim();
        if (modName) {
          const symId = idCounter++ as SymbolId;
          const entry: SymbolEntry = {
            id: symId,
            name: modName,
            kind: "Module",
            ruleName: "module_declaration",
            namePath: `${fileName}.${modName}`,
            fieldName: null,
            parentId: rootId,
            startOffset: start,
            endOffset: i,
            exports: [],
            inherits: [],
            language: "scad",
            metadata: {},
          };
          symbols.set(symId, entry);
          const list = byName.get(modName) || [];
          list.push(symId);
          byName.set(modName, list);
          childIds.push(symId);
          modules.set(modName, entry);
        }
        continue;
      }

      // Check for function declaration: `function name(...) =`
      if (text.startsWith("function", i) && text.charCodeAt(i + 8) <= 32) {
        const start = i;
        i += 8;
        while (i < len && text.charCodeAt(i) <= 32) i++;
        const idStart = i;
        while (i < len && (isIdentChar(text.charCodeAt(i)) || (i === idStart && isIdentStart(text.charCodeAt(i))))) i++;
        const fnName = text.slice(idStart, i).trim();
        if (fnName) {
          const symId = idCounter++ as SymbolId;
          const entry: SymbolEntry = {
            id: symId,
            name: fnName,
            kind: "Function",
            ruleName: "function_declaration",
            namePath: `${fileName}.${fnName}`,
            fieldName: null,
            parentId: rootId,
            startOffset: start,
            endOffset: i,
            exports: [],
            inherits: [],
            language: "scad",
            metadata: {},
          };
          symbols.set(symId, entry);
          const list = byName.get(fnName) || [];
          list.push(symId);
          byName.set(fnName, list);
          childIds.push(symId);
          functions.set(fnName, entry);
        }
        continue;
      }

      // Check for top-level variable assignment: `ident = expr;`
      if (isIdentStart(text.charCodeAt(i))) {
        const start = i;
        while (i < len && isIdentChar(text.charCodeAt(i))) i++;
        const varName = text.slice(start, i);
        // Look ahead for '=' (skipping whitespace)
        let j = i;
        while (j < len && text.charCodeAt(j) <= 32) j++;
        if (j < len && text.charCodeAt(j) === 61 && text.charCodeAt(j + 1) !== 61) {
          // assignment
          const symId = idCounter++ as SymbolId;
          const entry: SymbolEntry = {
            id: symId,
            name: varName,
            kind: "Variable",
            ruleName: "variable_declaration",
            namePath: `${fileName}.${varName}`,
            fieldName: null,
            parentId: rootId,
            startOffset: start,
            endOffset: j + 1,
            exports: [],
            inherits: [],
            language: "scad",
            metadata: {},
          };
          symbols.set(symId, entry);
          const list = byName.get(varName) || [];
          list.push(symId);
          byName.set(varName, list);
          childIds.push(symId);
          variables.set(varName, entry);
          i = j + 1;
          continue;
        }
      }

      i++;
    }

    childrenOf.set(rootId, childIds);
    const index: SymbolIndex = { symbols, byName, childrenOf };

    this.fileIndices.set(uri, index);
    this.fileInfos.set(uri, {
      uri,
      index,
      modules,
      functions,
      variables,
      dependencies,
    });

    this._structuralRevision++;
    return index;
  }

  public toSymbolIndex(): SymbolIndex {
    return this.toUnified();
  }

  public toUnified(): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    const rootChildren: SymbolId[] = [];

    for (const fileIdx of this.fileIndices.values()) {
      for (const [id, entry] of fileIdx.symbols.entries()) {
        symbols.set(id, entry);
        if (entry.parentId === null) {
          rootChildren.push(id);
        }
      }
      for (const [name, ids] of fileIdx.byName.entries()) {
        const existing = byName.get(name) || [];
        existing.push(...ids);
        byName.set(name, existing);
      }
      for (const [parentId, ids] of fileIdx.childrenOf.entries()) {
        if (parentId !== null) {
          const existing = childrenOf.get(parentId) || [];
          existing.push(...ids);
          childrenOf.set(parentId, existing);
        }
      }
    }

    childrenOf.set(null, rootChildren);
    return { symbols, byName, childrenOf };
  }

  public async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toUnified();
  }

  public toUnifiedPartial(): SymbolIndex {
    return this.toUnified();
  }

  public getSkeletonIndex(): SymbolIndex {
    return this.toUnified();
  }

  /**
   * Resolves a module, function, or variable visible from the given document URI,
   * taking `include <...>` and `use <...>` into account.
   */
  public resolveVisibleSymbol(name: string, fromUri: string): SymbolEntry | undefined {
    const fileInfo = this.fileInfos.get(fromUri);
    if (!fileInfo) return undefined;

    // 1. Check local file symbols
    if (fileInfo.modules.has(name)) return fileInfo.modules.get(name);
    if (fileInfo.functions.has(name)) return fileInfo.functions.get(name);
    if (fileInfo.variables.has(name)) return fileInfo.variables.get(name);

    // 2. Check dependencies
    for (const dep of fileInfo.dependencies) {
      // Find matching registered URI ending with targetPath
      for (const [otherUri, otherInfo] of this.fileInfos.entries()) {
        if (otherUri === fromUri) continue;
        if (otherUri.endsWith(dep.targetPath) || otherUri.endsWith(`/${dep.targetPath}`)) {
          if (otherInfo.modules.has(name)) return otherInfo.modules.get(name);
          if (otherInfo.functions.has(name)) return otherInfo.functions.get(name);
          if (dep.type === "include" && otherInfo.variables.has(name)) {
            return otherInfo.variables.get(name);
          }
        }
      }
    }

    return undefined;
  }
}

function isIdentStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36; // A-Z, a-z, _, $
}

function isIdentChar(c: number): boolean {
  return isIdentStart(c) || (c >= 48 && c <= 57); // 0-9
}
