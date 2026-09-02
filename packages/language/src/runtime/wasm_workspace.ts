import { PolyglotTransformer, type PolyglotNode } from "../transformers/polyglot-transformer.js";
import type { IndexerHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";
import { WasmOntologyStore } from "./wasm_ontology.js";

export interface IWorkspaceIndex {
  version: number;
  structuralRevision?: number;
  fileCount?: number;
  toUnified?(): any;
  toUnifiedAsync?(): Promise<any>;
  toUnifiedPartial?(): any;
  getSkeletonIndex?(): any;
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

export class WasmWorkspaceIndex {
  private instance: WasmLanguageInstance;
  private uriToId = new Map<string, number>();
  private idToUri = new Map<number, string>();
  private nextFileId = 1;
  private nextSymbolId = 1;
  private _version = 0;
  private _structuralRevision = 0;
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

  register(uri: string, loader?: () => any, parentFQN?: string): number {
    const fileId = this.registerFile(uri, parentFQN);
    if (typeof loader === "function") {
      const rootNode = loader();
      if (rootNode) {
        this.indexCst(uri, rootNode, parentFQN);
      }
    }
    return fileId;
  }

  has(uri: string): boolean {
    return this.uriToId.has(uri) || this.fileSymbols.has(uri);
  }

  markDirty(uri: string, loader?: () => any, _editRanges?: any, _totalDelta?: number): void {
    if (typeof loader === "function") {
      const rootNode = loader();
      if (rootNode) {
        this.indexCst(uri, rootNode);
      }
    } else {
      this._version++;
      this._structuralRevision++;
    }
  }

  takeGlobalChangedIds(): { changedIds: Set<number> } | null {
    return { changedIds: new Set<number>() };
  }

  takeGlobalChangedNames(): Set<string> | null {
    return new Set<string>();
  }

  private indexCst(uri: string, rootNode: any, _parentFQN?: string): void {
    const existingIds = this.fileSymbols.get(uri);
    if (existingIds) {
      for (const id of existingIds) {
        const entry = this.unifiedIndex.symbols.get(id);
        if (entry) {
          this.unifiedIndex.symbols.delete(id);
          const byNameList = this.unifiedIndex.byName.get(entry.name);
          if (byNameList) {
            this.unifiedIndex.byName.set(
              entry.name,
              byNameList.filter((symId) => symId !== id),
            );
          }
        }
      }
    }

    const newIds: SymbolId[] = [];

    const walk = (node: any, parentId: SymbolId | null) => {
      let currentId = parentId;
      const hook = this.hookMap.get(node.type);

      if (hook) {
        const nameNode = hook.namePath ? resolveFieldPath(node, hook.namePath) : null;
        let name = nameNode ? getNodeText(nameNode) : "";
        if (!name && node.type) {
          name = node.type;
        }

        const symId = this.nextSymbolId++;
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

      for (const child of node.children || []) {
        walk(child, currentId);
      }
    };

    walk(rootNode, null);
    this.fileSymbols.set(uri, newIds);
    this._version++;
    this._structuralRevision++;
  }

  getFileIndex(_uri: string): SymbolIndex {
    return this.toUnified();
  }

  hydrate(_uri: string, _index: any, _parentFQN?: string, _mapResourceId?: any): void {
    this._version++;
    this._structuralRevision++;
  }

  toUnified(): SymbolIndex {
    return this.unifiedIndex;
  }

  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toUnified();
  }

  toUnifiedPartial(): SymbolIndex {
    return this.toUnified();
  }

  getSkeletonIndex(): SymbolIndex {
    return this.toUnified();
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
   * Clears stubs for a single file, or all files if uri is omitted.
   */
  clear(uri?: string): void {
    if (uri) {
      const fileId = this.uriToId.get(uri);
      if (fileId) {
        this.instance.clearFileStubs(fileId);
      }
    } else {
      this.instance.clearFileStubs(0);
      this.uriToId.clear();
      this.idToUri.clear();
      this.nextFileId = 1;
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

export class UnifiedWorkspace {
  public owl2Store: WasmOntologyStore;
  private workspaces = new Map<string, any>();
  private queryEngines = new Map<string, any>();
  private configs = new Map<string, any>();
  private _version = 0;

  public cstNodeProvider?: (id: SymbolId) => unknown | null;
  public cstTextProvider?: (startByte: number, endByte: number, entry: SymbolEntry) => string | null;
  public queryProvider?: (queryName: string, id: SymbolId) => unknown | null;

  constructor() {
    this.owl2Store = new WasmOntologyStore();
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

  registerWorkspace(language: string, index: any, config?: any): void {
    this.workspaces.set(language, index);
    if (config) {
      this.configs.set(language, config);
    }
    this._version++;
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
    return new PolyglotTransformer(config.polyglot);
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

  toUnified(): SymbolIndex {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.toUnified === "function") {
        return ws.toUnified();
      }
    }
    return {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
  }

  async toUnifiedAsync(): Promise<SymbolIndex> {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.toUnifiedAsync === "function") {
        return await ws.toUnifiedAsync();
      }
      if (ws && typeof ws.toUnified === "function") {
        return ws.toUnified();
      }
    }
    return {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
  }

  toUnifiedPartial(): SymbolIndex {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.toUnifiedPartial === "function") {
        return ws.toUnifiedPartial();
      }
      if (ws && typeof ws.toUnified === "function") {
        return ws.toUnified();
      }
    }
    return {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
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
