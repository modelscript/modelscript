import { computeEditRanges, type EditRange } from "./diff.js";
import { PolyglotTransformer, type PolyglotNode } from "./polyglot-transformer.js";
import type { IndexerHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";
import { WorkspaceTypeRegistry } from "./type_registry.js";
import { WasmOntologyStore } from "./wasm_ontology.js";

export interface IWorkspaceIndex {
  readonly version: number;
  readonly structuralRevision?: number;
  readonly fileCount?: number;
  toSymbolIndex?(): SymbolIndex;
  toUnified?(): SymbolIndex;
  toUnifiedAsync?(): Promise<SymbolIndex>;
  toUnifiedPartial?(): SymbolIndex;
  getSkeletonIndex?(): SymbolIndex;
}

export interface WasmStubSymbol {
  fileId: number;
  symbolId: number;
  parentSymbolId: number;
  kind: number;
  flags: number;
  nameHash: number;
  startByte: number;
  endByte: number;
  merkleLow?: number;
  merkleHigh?: number;
}

export interface WasmLanguageInstance {
  registerSymbol(
    fileId: number,
    symbolId: number,
    parentSymbolId: number,
    kind: number,
    flags: number,
    name: string,
    startByte: number,
    endByte: number,
    merkleLow?: number,
    merkleHigh?: number,
    parentFqn?: string,
  ): number;
  registerFileParentFQN(fileId: number, parentFQN: string): void;
  bindFqnStub(fqn: string, stubId: number): void;
  stitchParentFQN(childStubId: number, parentFQN: string): number;
  clearFileStubs(fileId?: number): void;
  findStubsByName(name: string): WasmStubSymbol[];
  findStubsByNameSIMD(name: string, preferredFileId?: number): WasmStubSymbol[];
  getFileSymbols(fileId: number): WasmStubSymbol[];
  getStubChildren(parentSymbolId: number): WasmStubSymbol[];
  getStubCount(): number;
  exportStubBinary(): Uint8Array;
  importStubBinary(buffer: Uint8Array): boolean;
  bulkRegisterStubs(payload: Uint32Array): number;
  hashString(str: string): number;
}

function findDescendantByFieldName(node: any, fieldName: string): any | null {
  const direct = node.childForFieldName ? node.childForFieldName(fieldName) : null;
  if (direct) return direct;
  for (const child of node.children || []) {
    const found = findDescendantByFieldName(child, fieldName);
    if (found) return found;
  }
  return null;
}

function resolveFieldPath(node: any, fieldPath: string): any | null {
  if (!fieldPath || fieldPath === "$self") return node;
  const parts = fieldPath.split(".");
  let current: any | null = node;

  for (const part of parts) {
    if (!current) return null;
    if (part === "parent") {
      current = current.parent ?? null;
    } else {
      let child = current.childForFieldName ? current.childForFieldName(part) : null;
      if (!child) {
        const children: any[] = current.children || [];
        const pascalType = part.charAt(0).toUpperCase() + part.slice(1);
        child = children.find((c: any) => c.type === pascalType || c.type === part) ?? null;
      }
      if (!child) {
        child = findDescendantByFieldName(current, part);
      }
      current = child;
    }
  }

  return current;
}

function getNodeText(node: any): string {
  return node.text ? node.text.trim() : "";
}

function scanForKeyword(node: any, fieldName: string): string | null {
  let keyword: string | null = null;
  let keywords: string[] | null = null;

  if (fieldName === "direction") {
    keywords = ["in", "out", "inout"];
  } else if (fieldName.startsWith("is") && fieldName.length > 2) {
    keyword = fieldName.slice(2, 3).toLowerCase() + fieldName.slice(3);
  } else {
    keyword = fieldName;
  }

  const children = node.children || [];
  for (const child of children) {
    const t = child.type;
    if (keywords) {
      if (keywords.includes(t)) return t;
    } else if (keyword && t === keyword) {
      return t;
    }
  }
  return null;
}

function extractMetadata(node: any, hook: IndexerHook): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  if (!hook.metadataFieldPaths) return metadata;
  for (const [key, fieldPath] of Object.entries(hook.metadataFieldPaths)) {
    const fieldNode = resolveFieldPath(node, fieldPath);
    if (fieldNode) {
      metadata[key] = getNodeText(fieldNode);
    } else {
      metadata[key] = scanForKeyword(node, fieldPath);
    }
  }
  return metadata;
}

function extractStringList(node: any, paths?: string[]): string[] {
  if (!paths || paths.length === 0) return [];
  const results: string[] = [];
  for (const path of paths) {
    const target = resolveFieldPath(node, path);
    if (target) {
      const text = getNodeText(target);
      if (text) results.push(text);
    }
  }
  return results;
}

export class LanguageWorkspaceIndex implements IWorkspaceIndex {
  private instance: WasmLanguageInstance;
  private uriToId = new Map<string, number>();
  private idToUri = new Map<number, string>();
  private nextFileId = 1;
  private nextSymbolId = 1;
  private _version = 0;
  private _structuralRevision = 0;
  private fileStructuralRevisions = new Map<string, number>();
  private hookMap = new Map<string, IndexerHook>();
  private fileSymbols = new Map<string, SymbolId[]>();
  private unifiedIndex: SymbolIndex = {
    symbols: new Map<SymbolId, SymbolEntry>(),
    byName: new Map<string, SymbolId[]>(),
    childrenOf: new Map<SymbolId | null, SymbolId[]>(),
  };

  constructor(instanceOrHooks: WasmLanguageInstance | IndexerHook[] | any = {}) {
    if (Array.isArray(instanceOrHooks)) {
      for (const hook of instanceOrHooks) {
        if (hook && hook.ruleName) {
          this.hookMap.set(hook.ruleName, hook);
        }
      }
      this.instance = {} as any;
    } else {
      this.instance = instanceOrHooks || {};
    }
  }

  get version(): number {
    return this._version;
  }

  get structuralRevision(): number {
    return this._structuralRevision;
  }

  getFileStructuralRevision(uri: string): number {
    return this.fileStructuralRevisions.get(uri) ?? 0;
  }

  bumpFileStructuralRevision(uri?: string): void {
    if (uri) {
      this.fileStructuralRevisions.set(uri, (this.fileStructuralRevisions.get(uri) ?? 0) + 1);
    }
  }

  get fileCount(): number {
    return this.uriToId.size;
  }

  get uris(): string[] {
    return Array.from(this.uriToId.keys());
  }

  /**
   * Returns or assigns a unique integer fileId for a given URI.
   */
  getFileId(uri: string): number {
    let id = this.uriToId.get(uri);
    if (!id) {
      id = this.nextFileId++;
      this.uriToId.set(uri, id);
      this.idToUri.set(id, uri);
    }
    return id;
  }

  /**
   * Resolves a fileId back to its original document URI.
   */
  getUri(fileId: number): string | undefined {
    return this.idToUri.get(fileId);
  }

  /**
   * Registers a file and optionally binds its enclosing parent FQN.
   */
  registerFile(uri: string, parentFQN?: string): number {
    const fileId = this.getFileId(uri);
    if (parentFQN && this.instance && this.instance.registerFileParentFQN) {
      this.instance.registerFileParentFQN(fileId, parentFQN);
    }
    this._version++;
    return fileId;
  }

  /**
   * Indexes a document's CST into the symbol table.
   */
  indexDocument(uri: string, loader?: () => any, parentFQN?: string, editRanges?: any): number {
    const fileId = this.registerFile(uri, parentFQN);
    if (editRanges && Array.isArray(editRanges)) {
      this.fileDirtyRanges.set(uri, editRanges);
    }
    if (typeof loader === "function") {
      const rootNode = loader();
      if (rootNode) {
        this.indexCst(uri, rootNode, parentFQN);
      }
    }
    return fileId;
  }

  /**
   * Backwards-compatible alias for indexDocument.
   */
  register(uri: string, loader?: () => any, parentFQN?: string, editRanges?: any): number {
    return this.indexDocument(uri, loader, parentFQN, editRanges);
  }

  has(uri: string): boolean {
    return this.uriToId.has(uri) || this.fileSymbols.has(uri);
  }

  private fileDirtyRanges = new Map<string, { startByte: number; endByte: number }[]>();

  getDirtyRanges(uri: string): { startByte: number; endByte: number }[] | undefined {
    return this.fileDirtyRanges.get(uri);
  }

  clearDirtyRanges(uri: string): void {
    this.fileDirtyRanges.delete(uri);
  }

  /**
   * Re-indexes a document or marks it dirty upon edit.
   */
  reindexDocument(uri: string, loader?: () => any, editRanges?: any, _totalDelta?: number): void {
    if (editRanges && Array.isArray(editRanges)) {
      this.fileDirtyRanges.set(uri, editRanges);
    }
    if (typeof loader === "function") {
      const rootNode = loader();
      if (rootNode) {
        this.indexCst(uri, rootNode);
      }
    } else {
      this._version++;
      this._structuralRevision++;
      this.bumpFileStructuralRevision(uri);
    }
  }

  /**
   * Backwards-compatible alias for reindexDocument.
   */
  markDirty(uri: string, loader?: () => any, editRanges?: any, totalDelta?: number): void {
    this.reindexDocument(uri, loader, editRanges, totalDelta);
  }

  private globalChangedIds = new Set<number>();
  private globalStructuralChangedIds = new Set<number>();

  takeGlobalChangedIds(): { changedIds: Set<number>; structuralChangedIds?: Set<number> } | null {
    const ids = new Set(this.globalChangedIds);
    const structIds = new Set(this.globalStructuralChangedIds);
    this.globalChangedIds.clear();
    this.globalStructuralChangedIds.clear();
    return { changedIds: ids, structuralChangedIds: structIds };
  }

  takeGlobalChangedNames(): Set<string> | null {
    return new Set<string>();
  }

  private indexCst(uri: string, rootNode: any, _parentFQN?: string): void {
    const existingIds = this.fileSymbols.get(uri);
    const prevSignatures: string[] = [];
    const oldEntriesByKey = new Map<string, SymbolEntry>();
    const oldSymbolsToDelete = new Set<SymbolId>();

    if (existingIds) {
      for (const id of existingIds) {
        const entry = this.unifiedIndex.symbols.get(id);
        if (entry) {
          prevSignatures.push(`${entry.name}:${entry.kind}:${entry.ruleName}`);
          const parentKey = entry.parentId === null ? "root" : String(entry.parentId);
          const key = `${parentKey}:${entry.kind}:${entry.name}:${entry.ruleName}`;
          oldEntriesByKey.set(key, entry);
          oldSymbolsToDelete.add(id);
        }
        this.unifiedIndex.childrenOf.delete(id);
        if (entry) {
          const list = this.unifiedIndex.byName.get(entry.name);
          if (list) {
            this.unifiedIndex.byName.set(
              entry.name,
              list.filter((symId) => symId !== id),
            );
          }
        }
      }
      const rootChildren = this.unifiedIndex.childrenOf.get(0);
      if (rootChildren) {
        const existingSet = new Set(existingIds);
        this.unifiedIndex.childrenOf.set(
          0,
          rootChildren.filter((id) => !existingSet.has(id)),
        );
      }
    }

    const newIds: SymbolId[] = [];

    if (uri.endsWith(".csv")) {
      const filename = uri.split(/[/\\]/).pop() || "";
      const basename = filename.replace(/\.csv$/i, "");
      const normalizedName = basename.replace(/[^a-zA-Z0-9_]/g, "_");

      let parentId: SymbolId | null = null;
      if (_parentFQN) {
        const parentEntries = this.unifiedIndex.byName.get(_parentFQN);
        if (parentEntries && parentEntries.length > 0) {
          parentId = parentEntries[0]!;
        }
      }

      const matchKey = `root:Class:${normalizedName}:SourceFile`;
      let symId: SymbolId;
      const existingEntry = oldEntriesByKey.get(matchKey);
      const rootStart = rootNode.startByte ?? rootNode.startIndex ?? 0;
      const rootEnd = rootNode.endByte ?? rootNode.endIndex ?? 0;
      if (existingEntry && oldSymbolsToDelete.has(existingEntry.id)) {
        symId = existingEntry.id;
        oldSymbolsToDelete.delete(symId);
        if (existingEntry.startByte !== rootStart || existingEntry.endByte !== rootEnd) {
          this.globalChangedIds.add(symId);
        }
      } else {
        symId = this.nextSymbolId++;
        this.globalChangedIds.add(symId);
        this.globalStructuralChangedIds.add(symId);
        if (parentId !== null) {
          this.globalChangedIds.add(parentId);
          this.globalStructuralChangedIds.add(parentId);
        }
      }
      newIds.push(symId);

      const rootEntry: SymbolEntry = {
        id: symId,
        kind: "Class",
        name: normalizedName,
        ruleName: "SourceFile",
        namePath: "",
        fieldName: null,
        parentId,
        resourceId: uri,
        startByte: rootNode.startByte ?? rootNode.startIndex ?? 0,
        endByte: rootNode.endByte ?? rootNode.endIndex ?? 0,
        exports: [],
        inherits: [],
        metadata: {
          classPrefixes: "package",
        },
      };
      this.unifiedIndex.symbols.set(symId, rootEntry);

      const nameList = this.unifiedIndex.byName.get(normalizedName) || [];
      nameList.push(symId);
      this.unifiedIndex.byName.set(normalizedName, nameList);

      if (_parentFQN) {
        const fqn = `${_parentFQN}.${normalizedName}`;
        const fqnList = this.unifiedIndex.byName.get(fqn) || [];
        fqnList.push(symId);
        this.unifiedIndex.byName.set(fqn, fqnList);
      }

      const parentChildList = this.unifiedIndex.childrenOf.get(parentId ?? 0) || [];
      parentChildList.push(symId);
      this.unifiedIndex.childrenOf.set(parentId ?? 0, parentChildList);

      const rootNodeText = typeof rootNode.text === "string" ? rootNode.text : "";
      const lines = rootNodeText.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
      if (lines.length > 0) {
        const headerLine = lines[0] as string;
        const delimiter = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ",";
        const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/[^a-zA-Z0-9_]/g, "_"));
        const numCols = headers.length;

        const data: number[][] = [];
        for (let i = 1; i < lines.length; i++) {
          const parts = (lines[i] as string).split(delimiter);
          const row = parts.map((p) => parseFloat(p.trim()));
          if (row.length === numCols && !row.some(isNaN)) {
            data.push(row);
          }
        }
        const numRows = data.length;

        const addVirtualSymbol = (name: string, typeSpecifier: string, csvValue: any, arrayDimensions?: number[]) => {
          const childId = this.nextSymbolId++;
          newIds.push(childId);
          const virtualEntry: SymbolEntry = {
            id: childId,
            kind: "Component",
            name,
            ruleName: "CSVVirtualComponent",
            namePath: "",
            fieldName: null,
            startByte: 0,
            endByte: 0,
            parentId: symId,
            exports: [],
            inherits: [],
            metadata: {
              typeSpecifier,
              csvValue,
              _className: "CSVVirtualComponent",
              ...(arrayDimensions ? { arrayDimensions } : {}),
            },
            resourceId: uri,
          };
          this.unifiedIndex.symbols.set(childId, virtualEntry);

          const list = this.unifiedIndex.byName.get(name) || [];
          list.push(childId);
          this.unifiedIndex.byName.set(name, list);

          const childList = this.unifiedIndex.childrenOf.get(symId) || [];
          childList.push(childId);
          this.unifiedIndex.childrenOf.set(symId, childList);
        };

        addVirtualSymbol("numRows", "Integer", numRows);
        addVirtualSymbol("numCols", "Integer", numCols);
        addVirtualSymbol("values", "Real", data, [numRows, numCols]);

        for (let c = 0; c < numCols; c++) {
          const colName = headers[c] || `col${c}`;
          const colData = data.map((row) => row[c]);
          addVirtualSymbol(colName, "Real", colData, [numRows]);
        }
      }

      this.fileSymbols.set(uri, newIds);
      this._version++;
      this._structuralRevision++;
      return;
    }

    const walk = (node: any, parentId: SymbolId | null) => {
      let currentId = parentId;
      const hook = this.hookMap.get(node.type);

      if (hook) {
        const nameNode = hook.namePath ? resolveFieldPath(node, hook.namePath) : null;
        let name = nameNode ? getNodeText(nameNode) : "";
        if (!name && node.type) {
          name = node.type;
        }

        const parentKey = parentId === null ? "root" : String(parentId);
        const matchKey = `${parentKey}:${hook.kind}:${name}:${hook.ruleName}`;
        let symId: SymbolId;
        const existingEntry = oldEntriesByKey.get(matchKey);
        const nodeStart = node.startByte ?? node.startIndex ?? 0;
        const nodeEnd = node.endByte ?? node.endIndex ?? 0;
        if (existingEntry && oldSymbolsToDelete.has(existingEntry.id)) {
          symId = existingEntry.id;
          oldSymbolsToDelete.delete(symId);
          const dirtyRanges = this.fileDirtyRanges.get(uri);
          const intersectsDirty =
            dirtyRanges && dirtyRanges.length > 0
              ? dirtyRanges.some(
                  (r) => Math.max(r.startByte, existingEntry.startByte) <= Math.min(r.endByte, existingEntry.endByte),
                )
              : existingEntry.startByte !== nodeStart || existingEntry.endByte !== nodeEnd;
          if (intersectsDirty) {
            this.globalChangedIds.add(symId);
          }
        } else {
          symId = this.nextSymbolId++;
          this.globalChangedIds.add(symId);
          this.globalStructuralChangedIds.add(symId);
          if (parentId !== null) {
            this.globalChangedIds.add(parentId);
            this.globalStructuralChangedIds.add(parentId);
          }
        }

        currentId = symId;
        newIds.push(symId);

        const entry: SymbolEntry = {
          id: symId,
          kind: hook.kind,
          name,
          ruleName: hook.ruleName,
          namePath: hook.namePath ?? "",
          fieldName: null,
          parentId,
          resourceId: uri,
          startByte: node.startByte ?? node.startIndex ?? 0,
          endByte: node.endByte ?? node.endIndex ?? 0,
          exports: extractStringList(node, hook.exportPaths),
          inherits: extractStringList(node, hook.inheritPaths),
          metadata: extractMetadata(node, hook),
        };

        this.unifiedIndex.symbols.set(symId, entry);

        const list = this.unifiedIndex.byName.get(name) || [];
        list.push(symId);
        this.unifiedIndex.byName.set(name, list);

        const childList = this.unifiedIndex.childrenOf.get(parentId ?? 0) || [];
        childList.push(symId);
        this.unifiedIndex.childrenOf.set(parentId ?? 0, childList);
      }

      if (
        node.type === "expression" ||
        node.type === "array_arguments" ||
        node.type === "expression_list" ||
        node.type === "algorithm_section" ||
        node.type === "comment" ||
        node.type === "annotation"
      ) {
        return;
      }

      for (const child of node.children || []) {
        walk(child, currentId);
      }
    };

    walk(rootNode, null);

    for (const oldId of oldSymbolsToDelete) {
      this.globalChangedIds.add(oldId);
      this.globalStructuralChangedIds.add(oldId);
      const entry = this.unifiedIndex.symbols.get(oldId);
      if (entry && entry.parentId !== null) {
        this.globalChangedIds.add(entry.parentId);
        this.globalStructuralChangedIds.add(entry.parentId);
      }
      if (entry) {
        this.unifiedIndex.symbols.delete(oldId);
        const byNameList = this.unifiedIndex.byName.get(entry.name);
        if (byNameList) {
          this.unifiedIndex.byName.set(
            entry.name,
            byNameList.filter((id) => id !== oldId),
          );
        }
      }
      this.unifiedIndex.childrenOf.delete(oldId);
    }

    this.fileSymbols.set(uri, newIds);
    this._version++;

    const newSignatures: string[] = [];
    for (const id of newIds) {
      const entry = this.unifiedIndex.symbols.get(id);
      if (entry) {
        newSignatures.push(`${entry.name}:${entry.kind}:${entry.ruleName}`);
      }
    }
    const isFirstIndex = !existingIds || existingIds.length === 0;
    const structurallyEqual =
      !isFirstIndex &&
      prevSignatures.length === newSignatures.length &&
      prevSignatures.every((sig, i) => sig === newSignatures[i]);

    if (!structurallyEqual) {
      this._structuralRevision++;
      this.bumpFileStructuralRevision(uri);
    }
  }

  getFileIndex(_uri: string): SymbolIndex {
    return this.toSymbolIndex();
  }

  hydrate(_uri: string, _index: any, _parentFQN?: string, _mapResourceId?: any): void {
    this._version++;
    this._structuralRevision++;
  }

  toSymbolIndex(): SymbolIndex {
    return this.unifiedIndex;
  }

  toUnified(): SymbolIndex {
    return this.toSymbolIndex();
  }

  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toSymbolIndex();
  }

  toUnifiedPartial(): SymbolIndex {
    return this.toSymbolIndex();
  }

  getSkeletonIndex(): SymbolIndex {
    return this.toSymbolIndex();
  }

  /**
   * Registers a declaration symbol in the WASM Tier 1 store.
   */
  registerSymbol(
    uri: string,
    symbolId: number,
    parentSymbolId: number,
    kind: number,
    flags: number,
    name: string,
    startByte: number,
    endByte: number,
    merkleLow = 0,
    merkleHigh = 0,
    parentFqn = "",
  ): number {
    const fileId = this.getFileId(uri);
    const stubId = this.instance.registerSymbol(
      fileId,
      symbolId,
      parentSymbolId,
      kind,
      flags,
      name,
      startByte,
      endByte,
      merkleLow,
      merkleHigh,
      parentFqn,
    );
    this._version++;
    this._structuralRevision++;
    const fileUri = this.idToUri.get(fileId);
    if (fileUri) this.bumpFileStructuralRevision(fileUri);
    return stubId;
  }

  /**
   * Finds all declaration stubs matching a given name across the workspace.
   */
  findByName(name: string, preferredUri?: string): WasmStubSymbol[] {
    const preferredFileId = preferredUri ? this.uriToId.get(preferredUri) || 0 : 0;
    return this.instance.findStubsByNameSIMD(name, preferredFileId);
  }

  /**
   * Returns all child stubs for a parent symbol ID.
   */
  getChildren(parentSymbolId: number): WasmStubSymbol[] {
    return this.instance.getStubChildren(parentSymbolId);
  }

  /**
   * Returns all symbols belonging to a specific file.
   */
  getFileSymbols(uriOrFileId: string | number): WasmStubSymbol[] {
    const fileId = typeof uriOrFileId === "number" ? uriOrFileId : this.uriToId.get(uriOrFileId);
    if (!fileId) return [];
    return this.instance.getFileSymbols(fileId);
  }

  /**
   * Clears stubs and indexed symbols for a single file, or all files if uri is omitted.
   */
  clear(uri?: string): void {
    if (uri) {
      const fileId = this.uriToId.get(uri);
      if (fileId) {
        if (this.instance && typeof this.instance.clearFileStubs === "function") {
          this.instance.clearFileStubs(fileId);
        }
        this.uriToId.delete(uri);
        this.idToUri.delete(fileId);
      }
      const symIds = this.fileSymbols.get(uri);
      if (symIds) {
        for (const id of symIds) {
          const entry = this.unifiedIndex.symbols.get(id);
          if (entry) {
            const byNameList = this.unifiedIndex.byName.get(entry.name);
            if (byNameList) {
              const filtered = byNameList.filter((x) => x !== id);
              if (filtered.length > 0) this.unifiedIndex.byName.set(entry.name, filtered);
              else this.unifiedIndex.byName.delete(entry.name);
            }
          }
          this.unifiedIndex.symbols.delete(id);
        }
        this.fileSymbols.delete(uri);
      }
    } else {
      if (this.instance && typeof this.instance.clearFileStubs === "function") {
        this.instance.clearFileStubs(0);
      }
      this.uriToId.clear();
      this.idToUri.clear();
      this.nextFileId = 1;
      this.fileSymbols.clear();
      this.unifiedIndex.symbols.clear();
      this.unifiedIndex.byName.clear();
      this.unifiedIndex.childrenOf.clear();
    }
    this._version++;
    this._structuralRevision++;
  }

  /**
   * Exports the entire Tier 1 stub store and string pool to a compact binary snapshot.
   */
  exportSnapshot(): Uint8Array {
    return this.instance.exportStubBinary();
  }

  /**
   * Imports a pre-compiled binary snapshot into the WASM stub store.
   */
  importSnapshot(buffer: Uint8Array): boolean {
    const ok = this.instance.importStubBinary(buffer);
    if (ok) {
      this._version++;
      this._structuralRevision++;
    }
    return ok;
  }

  /**
   * Ingests a bulk batch of raw uint32 stub records from worker threads.
   */
  bulkRegister(payload: Uint32Array): number {
    const count = this.instance.bulkRegisterStubs(payload);
    if (count > 0) {
      this._version++;
      this._structuralRevision++;
    }
    return count;
  }
}

export interface DocumentRecord {
  uri: string;
  text: string;
  version: number;
  tree?: any;
}

export class UnifiedWorkspace implements IWorkspaceIndex {
  public owl2Store: WasmOntologyStore;
  public typeRegistry = new WorkspaceTypeRegistry();
  private workspaces = new Map<string, any>();
  private queryEngines = new Map<string, any>();
  private configs = new Map<string, any>();
  private _version = 0;

  private static globalParsers = new Map<string, any>();
  private parsers = new Map<string, any>();
  private documents = new Map<string, DocumentRecord>();

  public cstNodeProvider?: (id: SymbolId) => unknown | null;
  public cstTextProvider?: (startByte: number, endByte: number, entry: SymbolEntry) => string | null;
  public queryProvider?: (queryName: string, id: SymbolId) => unknown | null;

  constructor() {
    this.owl2Store = new WasmOntologyStore();

    this.cstNodeProvider = (id: SymbolId): unknown | null => {
      const idx = this.toUnifiedPartial();
      const entry = idx.symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const tree = this.getDocumentTree(entry.resourceId);
      if (!tree || !tree.rootNode) return null;
      const start = entry.startByte;
      const end = Math.max(start, entry.endByte);
      return typeof tree.rootNode.descendantForIndex === "function"
        ? tree.rootNode.descendantForIndex(start, end)
        : null;
    };

    this.cstTextProvider = (startByte: number, endByte: number, entry: SymbolEntry): string | null => {
      if (!entry || !entry.resourceId) return null;
      const text = this.getDocumentText(entry.resourceId);
      if (text === undefined) return null;
      return text.substring(startByte, endByte);
    };

    this.queryProvider = (queryName: string, id: SymbolId): unknown | null => {
      const idx = this.toUnifiedPartial();
      const entry = idx.symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const lang = this.detectLanguage(entry.resourceId);
      const engine = lang ? this.queryEngines.get(lang) : this.queryEngines.values().next().value;
      return engine?.query ? engine.query(queryName, id) : null;
    };
  }

  // ---------------------------------------------------------------------------
  // CST & Semantic Query Methods
  // ---------------------------------------------------------------------------

  getCstNode(id: SymbolId): any | null {
    if (this.cstNodeProvider) return this.cstNodeProvider(id);
    return null;
  }

  getCstText(startByte: number, endByte: number, entry: SymbolEntry): string | null {
    if (this.cstTextProvider) return this.cstTextProvider(startByte, endByte, entry);
    return null;
  }

  query(queryName: string, id: SymbolId): unknown | null {
    if (this.queryProvider) return this.queryProvider(queryName, id);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Parser Registry
  // ---------------------------------------------------------------------------

  static registerGlobalParser(extname: string, parser: any): void {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    UnifiedWorkspace.globalParsers.set(ext, parser);
  }

  static getGlobalParser(extname: string): any | undefined {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    return UnifiedWorkspace.globalParsers.get(ext);
  }

  registerParser(extname: string, parser: any): void {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    this.parsers.set(ext, parser);
    UnifiedWorkspace.registerGlobalParser(ext, parser);
  }

  getParser(extname: string): any | undefined {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    return this.parsers.get(ext) ?? UnifiedWorkspace.getGlobalParser(ext);
  }

  parse(uriOrExt: string, input: string, oldTree?: any, editBounds?: any): any {
    const ext = uriOrExt.includes(".") ? `.${uriOrExt.split(".").pop()}` : uriOrExt;
    const parser = this.getParser(ext);
    if (!parser) {
      throw new Error(`[UnifiedWorkspace] No parser registered for extension '${ext}'`);
    }
    if (typeof parser.parse === "function") {
      return parser.parse(
        input,
        oldTree,
        editBounds?.editStart ?? 0,
        editBounds?.editOldEnd ?? 0,
        editBounds?.editNewEnd ?? 0,
        editBounds?.uri ?? "",
      );
    }
    throw new Error(`[UnifiedWorkspace] Registered parser for '${ext}' does not have a parse() method`);
  }

  // ---------------------------------------------------------------------------
  // Document & CST Tree Store
  // ---------------------------------------------------------------------------

  setDocument(
    uri: string,
    text: string,
    options?: { parse?: boolean; oldTree?: any; editBounds?: any; editRanges?: EditRange[]; index?: boolean },
  ): { editRanges: EditRange[]; delta: number; tree?: any } {
    const prev = this.documents.get(uri);
    let editRanges: EditRange[] = options?.editRanges ?? [];
    let delta = 0;

    if (prev && prev.text !== text && editRanges.length === 0) {
      editRanges = computeEditRanges(prev.text, text);
      delta = text.length - prev.text.length;
    }

    let tree = prev?.tree;
    if (options?.parse !== false) {
      const ext = uri.includes(".") ? `.${uri.split(".").pop()}` : "";
      const parser = this.getParser(ext);
      if (parser) {
        try {
          tree = this.parse(uri, text, options?.oldTree ?? prev?.tree, options?.editBounds);
        } catch {
          // ignore or keep previous
        }
      }
    }

    const version = (prev?.version ?? 0) + 1;
    this.documents.set(uri, { uri, text, version, tree });
    this._version++;

    // Automated ingestion: update language workspace index if registered
    if (tree && options?.index !== false) {
      const lang = this.detectLanguage(uri);
      const ws = lang ? this.workspaces.get(lang) : undefined;
      if (ws) {
        if (typeof ws.indexDocument === "function") {
          ws.indexDocument(uri, () => tree.rootNode, undefined, editRanges);
        } else if (typeof ws.register === "function") {
          ws.register(uri, () => tree.rootNode, undefined, editRanges);
        }
      }
    }

    return { editRanges, delta, tree };
  }

  getDocument(uri: string): DocumentRecord | undefined {
    return this.documents.get(uri);
  }

  getDocumentText(uri: string): string | undefined {
    return this.documents.get(uri)?.text;
  }

  getDocumentTree(uri: string): any | undefined {
    const doc = this.documents.get(uri);
    if (!doc) return undefined;
    if (doc.tree) return doc.tree;
    const ext = uri.includes(".") ? `.${uri.split(".").pop()}` : "";
    const parser = this.getParser(ext);
    if (parser && doc.text !== undefined) {
      try {
        doc.tree = this.parse(uri, doc.text);
      } catch {
        // ignore
      }
    }
    return doc.tree;
  }

  setDocumentTree(uri: string, tree: any): void {
    const doc = this.documents.get(uri);
    if (doc) {
      doc.tree = tree;
    } else {
      this.documents.set(uri, { uri, text: "", version: 1, tree });
    }
  }

  deleteDocument(uri: string): boolean {
    const existed = this.documents.delete(uri);
    const lang = this.detectLanguage(uri);
    const ws = lang ? this.workspaces.get(lang) : undefined;
    if (ws && typeof ws.clear === "function") {
      ws.clear(uri);
    }
    if (existed) {
      this._version++;
    }
    return existed;
  }

  detectLanguage(uri: string): string | undefined {
    if (uri.endsWith(".sysml")) return "sysml2";
    if (uri.endsWith(".mo") || uri.endsWith(".msim")) return "modelica";
    if (uri.endsWith(".step") || uri.endsWith(".stp")) return "step";
    if (uri.endsWith(".owl") || uri.endsWith(".ttl") || uri.endsWith(".rdf")) return "owl2";
    if (uri.endsWith(".csv")) return "csv";
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Polyglot Directory Ingestion
  // ---------------------------------------------------------------------------

  async loadDirectory(
    dirPath: string,
    fs: {
      stat: (p: string) => any;
      readdir: (p: string) => { name: string }[];
      read: (p: string) => string;
      join: (...p: string[]) => string;
    },
    options?: { ignore?: string[] },
  ): Promise<string[]> {
    const loadedUris: string[] = [];
    const ignoreList = new Set(options?.ignore ?? ["node_modules", "dist", ".git", "testsuite"]);

    const crawl = (dir: string) => {
      const stat = fs.stat(dir);
      if (!stat) return;
      if (stat.isFile()) {
        const ext = dir.includes(".") ? `.${dir.split(".").pop()}` : "";
        if (this.getParser(ext)) {
          const content = fs.read(dir);
          this.setDocument(dir, content);
          const lang = this.detectLanguage(dir);
          const ws = lang ? this.workspaces.get(lang) : undefined;
          if (ws && typeof ws.register === "function") {
            ws.register(dir, () => this.getDocumentTree(dir)?.rootNode);
          }
          loadedUris.push(dir);
        }
      } else if (stat.isDirectory()) {
        for (const entry of fs.readdir(dir)) {
          if (ignoreList.has(entry.name)) continue;
          crawl(fs.join(dir, entry.name));
        }
      }
    };

    crawl(dirPath);
    return loadedUris;
  }

  // ---------------------------------------------------------------------------
  // Workspace & Query Engine Management
  // ---------------------------------------------------------------------------

  get fileCount(): number {
    return this.documents.size;
  }

  get version(): number {
    let v = this._version;
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.version === "number") v += ws.version;
    }
    return v;
  }

  get structuralRevision(): number {
    let r = 0;
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.structuralRevision === "number") r += ws.structuralRevision;
    }
    return r;
  }

  getFileStructuralRevision(uri: string): number {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).getFileStructuralRevision === "function") {
        const rev = (ws as any).getFileStructuralRevision(uri);
        if (rev > 0) return rev;
      }
    }
    return 0;
  }

  registerWorkspace(language: string, index: any, config?: any): void {
    this.workspaces.set(language, index);
    if (config) {
      this.configs.set(language, config);
    }
    this._version++;
  }

  unregisterWorkspace(language: string): boolean {
    const existed = this.workspaces.has(language);
    this.workspaces.delete(language);
    this.configs.delete(language);
    this.queryEngines.delete(language);
    if (existed) {
      this._version++;
    }
    return existed;
  }

  getWorkspace(language: string): any {
    return this.workspaces.get(language);
  }

  getLanguageConfig(language: string): any {
    return this.configs.get(language);
  }

  createPolyglotTransformer(language: string): PolyglotTransformer | null {
    const config = this.configs.get(language);
    if (!config?.polyglot) return null;
    return new PolyglotTransformer(config.polyglot, this.typeRegistry);
  }

  projectPolyglot(sourceLang: string, targetLang: string, node: PolyglotNode): string | null {
    const transformer = this.createPolyglotTransformer(sourceLang);
    if (!transformer) return null;
    return transformer.transform(node, targetLang);
  }

  registerQueryEngine(language: string, engine: any): void {
    this.queryEngines.set(language, engine);
    this._version++;
  }

  getQueryEngine(language: string): any {
    return this.queryEngines.get(language);
  }

  toSymbolIndex(): SymbolIndex {
    if (this.workspaces.size === 0) {
      return {
        symbols: new Map<SymbolId, SymbolEntry>(),
        byName: new Map<string, SymbolId[]>(),
        childrenOf: new Map<SymbolId | null, SymbolId[]>(),
      };
    }
    if (this.workspaces.size === 1) {
      for (const ws of this.workspaces.values()) {
        if (ws && typeof ws.toSymbolIndex === "function") {
          return ws.toSymbolIndex();
        }
        if (ws && typeof ws.toUnified === "function") {
          return ws.toUnified();
        }
      }
    }
    const merged: SymbolIndex = {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
    for (const [lang, ws] of this.workspaces.entries()) {
      const idx =
        typeof ws.toSymbolIndex === "function"
          ? ws.toSymbolIndex()
          : typeof ws.toUnified === "function"
            ? ws.toUnified()
            : null;
      if (!idx) continue;
      for (const [id, entry] of idx.symbols.entries()) {
        merged.symbols.set(id, { ...entry, language: entry.language ?? lang });
      }
      for (const [name, ids] of idx.byName.entries()) {
        const existing = merged.byName.get(name) || [];
        merged.byName.set(name, existing.concat(ids));
      }
      for (const [parentId, childIds] of idx.childrenOf.entries()) {
        const existing = merged.childrenOf.get(parentId) || [];
        merged.childrenOf.set(parentId, existing.concat(childIds));
      }
    }
    return merged;
  }

  toUnified(): SymbolIndex {
    return this.toSymbolIndex();
  }

  async toSymbolIndexAsync(): Promise<SymbolIndex> {
    if (this.workspaces.size === 0) {
      return {
        symbols: new Map<SymbolId, SymbolEntry>(),
        byName: new Map<string, SymbolId[]>(),
        childrenOf: new Map<SymbolId | null, SymbolId[]>(),
      };
    }
    if (this.workspaces.size === 1) {
      for (const ws of this.workspaces.values()) {
        if (ws && typeof ws.toSymbolIndexAsync === "function") {
          return await ws.toSymbolIndexAsync();
        }
        if (ws && typeof ws.toUnifiedAsync === "function") {
          return await ws.toUnifiedAsync();
        }
        if (ws && typeof ws.toSymbolIndex === "function") {
          return ws.toSymbolIndex();
        }
        if (ws && typeof ws.toUnified === "function") {
          return ws.toUnified();
        }
      }
    }
    const merged: SymbolIndex = {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
    for (const [lang, ws] of this.workspaces.entries()) {
      let idx: SymbolIndex | null = null;
      if (typeof ws.toSymbolIndexAsync === "function") {
        idx = await ws.toSymbolIndexAsync();
      } else if (typeof ws.toUnifiedAsync === "function") {
        idx = await ws.toUnifiedAsync();
      } else if (typeof ws.toSymbolIndex === "function") {
        idx = ws.toSymbolIndex();
      } else if (typeof ws.toUnified === "function") {
        idx = ws.toUnified();
      }
      if (!idx) continue;
      for (const [id, entry] of idx.symbols.entries()) {
        merged.symbols.set(id, { ...entry, language: entry.language ?? lang });
      }
      for (const [name, ids] of idx.byName.entries()) {
        const existing = merged.byName.get(name) || [];
        merged.byName.set(name, existing.concat(ids));
      }
      for (const [parentId, childIds] of idx.childrenOf.entries()) {
        const existing = merged.childrenOf.get(parentId) || [];
        merged.childrenOf.set(parentId, existing.concat(childIds));
      }
    }
    return merged;
  }

  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toSymbolIndexAsync();
  }

  toUnifiedPartial(): SymbolIndex {
    return this.toSymbolIndex();
  }

  getSkeletonIndex(): SymbolIndex {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.getSkeletonIndex === "function") {
        return ws.getSkeletonIndex();
      }
    }
    return this.toUnifiedPartial();
  }
}

/** @deprecated Use `LanguageWorkspaceIndex` instead. */
export { LanguageWorkspaceIndex as WasmWorkspaceIndex };
/** @deprecated Use `LanguageWorkspaceIndex` for single-language index or `UnifiedWorkspace` for multi-language workspace. */
export { LanguageWorkspaceIndex as WorkspaceIndex };
