// SPDX-License-Identifier: AGPL-3.0-or-later

import { PolyglotTransformer, type PolyglotNode } from "../interop/polyglot-transformer.js";
import { WasmOntologyStore } from "../ontology/wasm_ontology.js";
import {
  getLanguageDomainId,
  getSymbolDomain,
  LanguageDomainId,
  makePolyglotSymbolId,
  type IndexerHook,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../runtime.js";
import { computeEditRanges, type EditRange } from "../util/diff.js";
import { WorkspaceTypeRegistry } from "../util/type_registry.js";

/**
 * Common interface implemented by single-language (`LanguageWorkspaceIndex`) and
 * polyglot (`UnifiedWorkspace`) workspace symbol indices.
 */
export interface IWorkspaceIndex {
  /** Monotonically increasing document/symbol mutation counter. */
  readonly version: number;
  /** Monotonically increasing counter incremented only when symbol signatures or hierarchy change. */
  readonly structuralRevision?: number | undefined;
  /** Total number of registered documents in the workspace. */
  readonly fileCount?: number | undefined;
  /** Materializes and returns the complete `SymbolIndex`, evaluating any pending lazy file loaders. */
  toSymbolIndex?(): SymbolIndex;
  /** Alias for `toSymbolIndex()` returning the unified `SymbolIndex` across all indexed files. */
  toUnified?(): SymbolIndex;
  /** Asynchronously materializes and returns the unified `SymbolIndex`. */
  toUnifiedAsync?(): Promise<SymbolIndex>;
  /** Returns the currently materialized `SymbolIndex` without forcing evaluation of pending lazy loaders. */
  toUnifiedPartial?(): SymbolIndex;
  /** Returns a lightweight top-level skeleton `SymbolIndex` for workspace navigation. */
  getSkeletonIndex?(): SymbolIndex;
}

/**
 * Compact WebAssembly Tier 1 declaration stub record representing a symbol's location,
 * hierarchy link, and Merkle hash in linear memory.
 */
export interface WasmStubSymbol {
  /** Integer file identifier assigned by `LanguageWorkspaceIndex.getFileId()`. */
  fileId: number;
  /** Unique integer symbol identifier within the workspace index. */
  symbolId: number;
  /** Enclosing parent symbol ID (`0` for top-level declarations). */
  parentSymbolId: number;
  /** Numeric symbol kind tag. */
  kind: number;
  /** Bitmask of declaration flags (e.g. visibility, variability, replaceable). */
  flags: number;
  /** 32-bit hash of the symbol's simple name for SIMD lookup acceleration. */
  nameHash: number;
  /** Start byte offset of the declaration in its source file. */
  startByte: number;
  /** End byte offset of the declaration in its source file. */
  endByte: number;
  /** Optional start character offset in the source file. */
  startOffset?: number | undefined;
  /** Optional end character offset in the source file. */
  endOffset?: number | undefined;
  /** Optional low 32 bits of the declaration's structural Merkle hash. */
  merkleLow?: number | undefined;
  /** Optional high 32 bits of the declaration's structural Merkle hash. */
  merkleHigh?: number | undefined;
}

/**
 * Low-level WebAssembly Tier 1 symbol stub store interface exported by language indexer modules.
 */
export interface WasmLanguageInstance {
  /** Registers a symbol stub in WebAssembly linear memory and returns its assigned stub ID. */
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
  /** Associates a file ID with its enclosing `within` package FQN in the WASM stub table. */
  registerFileParentFQN(fileId: number, parentFQN: string): void;
  /** Binds a fully qualified name string to a stub ID in the WASM FQN table. */
  bindFqnStub(fqn: string, stubId: number): void;
  /** Links a child stub ID to its parent package FQN and returns the resolved parent stub ID. */
  stitchParentFQN(childStubId: number, parentFQN: string): number;
  /** Removes all symbol stubs registered for `fileId` (or all files when `fileId` is `0`/omitted). */
  clearFileStubs(fileId?: number): void;
  /** Finds all declaration stubs matching `name`. */
  findStubsByName(name: string): WasmStubSymbol[];
  /** SIMD-accelerated stub lookup by `name`, prioritizing results from `preferredFileId`. */
  findStubsByNameSIMD(name: string, preferredFileId?: number): WasmStubSymbol[];
  /** Returns all declaration stubs registered for `fileId`. */
  getFileSymbols(fileId: number): WasmStubSymbol[];
  /** Returns all direct child stubs of `parentSymbolId`. */
  getStubChildren(parentSymbolId: number): WasmStubSymbol[];
  /** Returns the total number of stubs stored in linear memory. */
  getStubCount(): number;
  /** Serializes the WASM stub store and string pool into a compact binary snapshot. */
  exportStubBinary(): Uint8Array;
  /** Deserializes a binary snapshot into the WASM stub store. */
  importStubBinary(buffer: Uint8Array): boolean;
  /** Bulk-inserts packed `Uint32Array` stub records produced by background worker threads. */
  bulkRegisterStubs(payload: Uint32Array): number;
  /** Computes the 32-bit FNV/hash of `str` used by the WASM stub table. */
  hashString(str: string): number;
}

/**
 * Searches a CST node and its non-body descendants for a child matching `fieldName`
 * (or an identifier child when `fieldName === "name"`).
 */
function findDescendantByFieldName(node: any, fieldName: string): any | null {
  const direct = node.childForFieldName ? node.childForFieldName(fieldName) : null;
  if (direct) return direct;
  if (fieldName === "name" && node.children) {
    const directId = node.children.find((c: any) => c.type === "identifier" || c.type === "IDENT");
    if (directId) return directId;
  }
  for (const child of node.children || []) {
    const type = child.type || "";
    if (
      type.endsWith("Body") ||
      type.endsWith("Member") ||
      type.endsWith("Section") ||
      type === "class_body" ||
      type === "body"
    ) {
      continue;
    }
    const found = findDescendantByFieldName(child, fieldName);
    if (found) return found;
  }
  return null;
}

/**
 * Resolves a dot-separated field path (e.g. `"parent.name"`, `"$self"`, or `"type_specifier"`)
 * starting from `node` in the CST.
 */
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

/** Returns the trimmed source text of a CST node, or `""` if unavailable. */
function getNodeText(node: any): string {
  return node.text ? node.text.trim() : "";
}

/** Scans direct CST children of `node` for a modifier or direction keyword token matching `fieldName`. */
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

/** Extracts a key-value metadata dictionary from a CST `node` using the field paths configured on `hook`. */
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

/** Extracts an array of non-empty trimmed string values from `node` for each field path in `paths`. */
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

/**
 * Single-language multi-file workspace symbol indexer (`WorkspaceIndex` / `WasmWorkspaceIndex`).
 *
 * Manages document URI-to-`fileId` mappings, demand-driven lazy CST loaders for large libraries
 * (such as the Modelica Standard Library), incremental CST re-indexing with stable `SymbolId`
 * preservation, and unified `SymbolIndex` materialization.
 */
export class LanguageWorkspaceIndex implements IWorkspaceIndex {
  /** Underlying WebAssembly Tier 1 symbol stub store instance (or fallback host object). */
  private instance: WasmLanguageInstance;
  /** Map from document URI string to sequential integer `fileId`. */
  private uriToId = new Map<string, number>();
  /** Reverse map from integer `fileId` back to document URI string. */
  private idToUri = new Map<number, string>();
  /** Next sequential integer `fileId` to allocate for a newly registered URI. */
  private nextFileId = 1;
  /** Next sequential integer `SymbolId` to allocate for a newly discovered symbol declaration. */
  private nextSymbolId = 1;
  /** Monotonically increasing workspace mutation version counter. */
  private _version = 0;
  /** Monotonically increasing revision counter incremented only when symbol structure/signatures change. */
  private _structuralRevision = 0;
  /** Per-document structural revision counters keyed by document URI. */
  private fileStructuralRevisions = new Map<string, number>();
  /** Grammar CST rule name -> `IndexerHook` lookup table driving `indexCst()`. */
  private hookMap = new Map<string, IndexerHook>();
  /** Map from document URI to the ordered list of `SymbolId`s declared in that file. */
  private fileSymbols = new Map<string, SymbolId[]>();
  /** Pending lazy CST loader callbacks keyed by document URI for on-demand package indexing. */
  private fileLoaders = new Map<string, { loader: () => any; parentFQN?: string | undefined; editRanges?: any }>();
  /** Map from top-level package/class FQN to the document URI that defines it. */
  private fqnToUri = new Map<string, string>();
  /** Re-entrancy guard set tracking FQNs currently being materialized in `ensureFQNIndexed()`. */
  private ensuringFQNSet = new Set<string>();
  /** Re-entrancy guard set tracking URIs currently being materialized in `ensureIndexed()`. */
  private ensuringUriSet = new Set<string>();
  /** Unified in-memory `SymbolIndex` aggregating all indexed declarations across files. */
  private unifiedIndex: SymbolIndex = {
    symbols: new Map<SymbolId, SymbolEntry>(),
    byName: new Map<string, SymbolId[]>(),
    childrenOf: new Map<SymbolId | null, SymbolId[]>(),
  };

  /**
   * Creates a new `LanguageWorkspaceIndex` from either an array of grammar `IndexerHook`s
   * or a low-level `WasmLanguageInstance`.
   */
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

  /** Current workspace mutation version counter. */
  get version(): number {
    return this._version;
  }

  /** Current workspace structural revision counter (incremented when symbol hierarchy or signatures change). */
  get structuralRevision(): number {
    return this._structuralRevision;
  }

  /** Returns the structural revision counter for a specific document `uri`. */
  getFileStructuralRevision(uri: string): number {
    return this.fileStructuralRevisions.get(uri) ?? 0;
  }

  /** Increments the per-file structural revision counter for `uri`. */
  bumpFileStructuralRevision(uri?: string): void {
    if (uri) {
      this.fileStructuralRevisions.set(uri, (this.fileStructuralRevisions.get(uri) ?? 0) + 1);
    }
  }

  /** Total number of registered document URIs in this workspace index. */
  get fileCount(): number {
    return this.uriToId.size;
  }

  /** Array of all document URIs registered in this workspace index. */
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
  indexDocument(uri: string, loader?: () => any, parentFQN?: string, editRanges?: any, lazy = false): number {
    const fileId = this.registerFile(uri, parentFQN);
    if (editRanges && Array.isArray(editRanges)) {
      this.fileDirtyRanges.set(uri, editRanges);
    }
    const rawFilename = uri.split("/").pop();
    const filename = rawFilename?.replace(/\.(mo|sysml|csv|step)$/i, "");
    if (filename === "package") {
      const parts = uri.split("/");
      const pkgDirRaw = parts.length >= 2 ? decodeURIComponent(parts[parts.length - 2]!).split(" ")[0] : "";
      if (pkgDirRaw) {
        let pkgFqn = pkgDirRaw;
        if (parentFQN) {
          const parentLast = parentFQN.split(".").pop();
          pkgFqn = parentLast === pkgDirRaw ? parentFQN : `${parentFQN}.${pkgDirRaw}`;
        }
        this.fqnToUri.set(pkgFqn, uri);
      }
    } else if (filename) {
      const fqn = parentFQN ? `${parentFQN}.${filename}` : filename;
      this.fqnToUri.set(fqn, uri);
    }
    if (typeof loader === "function") {
      if (lazy) {
        this.fileLoaders.set(uri, { loader, parentFQN, editRanges });
      } else {
        this.fileLoaders.delete(uri);
        const rootNode = loader();
        if (rootNode) {
          this.indexCst(uri, rootNode, parentFQN);
        }
      }
    }
    return fileId;
  }

  /**
   * Backwards-compatible alias for indexDocument. Defaults to lazy loading when a loader function is supplied.
   */
  register(uri: string, loader?: () => any, parentFQN?: string, editRanges?: any): number {
    return this.indexDocument(uri, loader, parentFQN, editRanges, true);
  }

  /**
   * Evaluates the lazy loader for the given URI if it has not yet been indexed.
   */
  ensureIndexed(uri: string): void {
    if (!uri || this.ensuringUriSet.has(uri)) return;
    this.ensuringUriSet.add(uri);
    try {
      const entry = this.fileLoaders.get(uri);
      if (entry) {
        this.fileLoaders.delete(uri);
        if (entry.parentFQN && !this.ensuringFQNSet.has(entry.parentFQN)) {
          this.ensureFQNIndexed(entry.parentFQN);
        }
        const rootNode = entry.loader();
        if (rootNode) {
          this.indexCst(uri, rootNode, entry.parentFQN);
        }
      }
    } finally {
      this.ensuringUriSet.delete(uri);
    }
  }

  /**
   * Ensures that all ancestor packages and files along the specified FQN path are indexed in hierarchical order.
   */
  ensureFQNIndexed(fqn: string): void {
    if (!fqn || this.ensuringFQNSet.has(fqn)) return;
    this.ensuringFQNSet.add(fqn);
    try {
      const parts = fqn.split(".");
      this.ensureChildrenIndexed("");
      let prefix = "";
      for (let i = 0; i < parts.length; i++) {
        prefix = prefix ? `${prefix}.${parts[i]!}` : parts[i]!;
        let uri = this.fqnToUri.get(prefix);
        if (!uri && prefix.includes(".")) {
          const pParts = prefix.split(".");
          for (let j = pParts.length - 1; j >= 1; j--) {
            const sub = pParts.slice(0, j).join(".");
            if (this.fqnToUri.has(sub)) {
              uri = this.fqnToUri.get(sub);
              break;
            }
          }
        }
        if (!uri && (prefix === "Modelica.Icons" || prefix.endsWith(".Icons") || prefix === "Icons")) {
          for (const fUri of this.fileLoaders.keys()) {
            if (fUri.endsWith("/Icons.mo") || fUri.endsWith("Icons.mo")) {
              uri = fUri;
              break;
            }
          }
        }
        if (uri) {
          this.ensureIndexed(uri);
        }
        this.ensureChildrenIndexed(prefix);
      }
    } finally {
      this.ensuringFQNSet.delete(fqn);
    }
  }

  /**
   * Evaluates lazy loaders for all files whose parentFQN matches targetParent.
   * Passing "" or undefined indexes root-level files.
   */
  ensureChildrenIndexed(parentFQN?: string): void {
    const norm = !parentFQN || parentFQN === "" ? "" : parentFQN;
    for (const [uri, entry] of Array.from(this.fileLoaders.entries())) {
      const entryParent = !entry.parentFQN || entry.parentFQN === "" ? "" : entry.parentFQN;
      if (entryParent === norm || (norm === "Modelica" && (uri.endsWith("/Icons.mo") || uri.endsWith("Icons.mo")))) {
        this.ensureIndexed(uri);
      }
    }
  }

  /**
   * Checks if there are any unindexed lazy loaders whose parentFQN matches targetParent.
   */
  hasPendingChildren(parentFQN?: string): boolean {
    const norm = !parentFQN || parentFQN === "" ? "" : parentFQN;
    for (const entry of this.fileLoaders.values()) {
      const entryParent = !entry.parentFQN || entry.parentFQN === "" ? "" : entry.parentFQN;
      if (entryParent === norm) return true;
    }
    return false;
  }

  /**
   * Returns count of files registered with a pending lazy loader.
   */
  get pendingFileCount(): number {
    return this.fileLoaders.size;
  }

  /**
   * Progressively indexes remaining lazy-registered files in the background, yielding to the event loop.
   */
  async indexRemainingInBackground(
    batchSize = 20,
    onProgress?: (indexed: number, total: number) => void,
  ): Promise<void> {
    const uris = Array.from(this.fileLoaders.keys());
    const total = uris.length;
    let indexed = 0;
    for (const uri of uris) {
      this.ensureIndexed(uri);
      indexed++;
      if (indexed % batchSize === 0) {
        onProgress?.(indexed, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(total, total);
  }

  /**
   * Resolves a fully qualified class name to its backing file URI, evaluating lazy loader if needed.
   */
  getFileUriForFQN(fqn: string): string | undefined {
    let uri = this.fqnToUri.get(fqn);
    if (!uri) {
      this.ensureFQNIndexed(fqn);
      uri = this.fqnToUri.get(fqn);
    }
    if (!uri) {
      const parts = fqn.split(".");
      for (let i = parts.length - 1; i >= 1; i--) {
        const prefix = parts.slice(0, i).join(".");
        if (this.fqnToUri.has(prefix)) {
          uri = this.fqnToUri.get(prefix);
          break;
        }
      }
    }
    return uri;
  }

  /** Checks whether `uri` is registered (either eagerly indexed or pending in `fileLoaders`). */
  has(uri: string): boolean {
    return this.uriToId.has(uri) || this.fileSymbols.has(uri) || this.fileLoaders.has(uri);
  }

  /** Per-document dirty byte/offset edit ranges used to narrow incremental symbol invalidation during `indexCst()`. */
  private fileDirtyRanges = new Map<
    string,
    { startByte: number; endByte: number; startOffset?: number | undefined; endOffset?: number | undefined }[]
  >();

  /** Returns the pending dirty byte/offset edit ranges recorded for `uri`, if any. */
  getDirtyRanges(
    uri: string,
  ):
    | { startByte: number; endByte: number; startOffset?: number | undefined; endOffset?: number | undefined }[]
    | undefined {
    return this.fileDirtyRanges.get(uri);
  }

  /** Clears recorded dirty edit ranges for `uri` after incremental indexing completes. */
  clearDirtyRanges(uri: string): void {
    this.fileDirtyRanges.delete(uri);
  }

  /**
   * Re-indexes a document or marks it dirty upon edit.
   */
  reindexDocument(uri: string, loader?: () => any, editRanges?: any, _totalDelta?: number): void {
    const existingEntry = this.fileLoaders.get(uri);
    this.fileLoaders.delete(uri);
    if (editRanges && Array.isArray(editRanges)) {
      this.fileDirtyRanges.set(uri, editRanges);
    }
    if (typeof loader === "function") {
      const rootNode = loader();
      if (rootNode) {
        this.indexCst(uri, rootNode, existingEntry?.parentFQN);
      }
    } else {
      this._version++;
      this._structuralRevision++;
      this.bumpFileStructuralRevision(uri);
    }
  }

  /**
   * Extracts the enclosing package FQN declared by a top-level `within <package>;` clause
   * from `rootNode`, returning `""` for root `within;` or `null` if no `within` clause is present.
   */
  private extractDeclaredWithin(rootNode: any): string | null {
    if (!rootNode) return null;
    const findInNode = (n: any): string | null => {
      if (!n) return null;
      if (n.type === "within_clause" || n.type === "WithinDirective") {
        const nameChild = n.children?.find(
          (c: any) => c.type === "name" || c.type === "name_list" || c.type === "identifier" || c.type === "IDENT",
        );
        if (nameChild && nameChild.text) {
          return nameChild.text.trim();
        }
        const t = n.text || "";
        const m = t.match(/^within\s*([a-zA-Z0-9_.]*)\s*;/m);
        return m ? m[1]?.trim() || "" : "";
      }
      for (const child of n.children || []) {
        if (child.type === "within_clause" || child.type === "WithinDirective") {
          const nameChild = child.children?.find(
            (c: any) => c.type === "name" || c.type === "name_list" || c.type === "identifier" || c.type === "IDENT",
          );
          if (nameChild && nameChild.text) {
            return nameChild.text.trim();
          }
          const t = child.text || "";
          const m = t.match(/^within\s*([a-zA-Z0-9_.]*)\s*;/m);
          return m ? m[1]?.trim() || "" : "";
        }
        if (child.type === "stored_definition" || child.type === "program") {
          const res = findInNode(child);
          if (res !== null) return res;
        }
      }
      if (typeof n.text === "string" && n.text.length > 0) {
        const m = n.text.slice(0, 1000).match(/^\s*within\s*([a-zA-Z0-9_.]*)\s*;/m);
        if (m) return m[1]?.trim() || "";
      }
      return null;
    };
    return findInNode(rootNode);
  }

  /**
   * @deprecated Backwards-compatible alias for reindexDocument. Use `reindexDocument` instead.
   */
  markDirty(uri: string, loader?: () => any, editRanges?: any, totalDelta?: number): void {
    this.reindexDocument(uri, loader, editRanges, totalDelta);
  }

  /** Accumulated set of `SymbolId`s modified since the last `takeGlobalChangedIds()` call. */
  private globalChangedIds = new Set<number>();
  /** Accumulated set of `SymbolId`s whose structural signature/children changed since the last `takeGlobalChangedIds()` call. */
  private globalStructuralChangedIds = new Set<number>();

  /** Drains and returns the accumulated sets of modified and structurally modified `SymbolId`s for Salsa invalidation. */
  takeGlobalChangedIds(): { changedIds: Set<number>; structuralChangedIds?: Set<number> | undefined } | null {
    const ids = new Set(this.globalChangedIds);
    const structIds = new Set(this.globalStructuralChangedIds);
    this.globalChangedIds.clear();
    this.globalStructuralChangedIds.clear();
    return { changedIds: ids, structuralChangedIds: structIds };
  }

  /** Returns the drained set of globally modified symbol names (if tracked). */
  takeGlobalChangedNames(): Set<string> | null {
    return new Set<string>();
  }

  /**
   * Walks the green CST of a parsed document to populate or incrementally update
   * the unified `SymbolIndex` (classes, components, `extends` clauses, `connect`
   * equations, and FQN symbol lookup tables).
   *
   * Preserves existing `SymbolId` allocations when a declaration's parent, kind,
   * name, and grammar rule match its prior incarnation, minimizing Salsa query
   * invalidations across incremental edits.
   *
   * @param uri Document resource URI being indexed.
   * @param rootNode Root CST node produced by the WASM GLR parser.
   * @param _parentFQN Optional enclosing package FQN (inferred from `within` clause if omitted).
   */
  private indexCst(uri: string, rootNode: any, _parentFQN?: string): void {
    // Step 1: Resolve enclosing package scope from top-level `within <package>;` declaration if not explicitly provided.
    if (!_parentFQN && rootNode) {
      const declared = this.extractDeclaredWithin(rootNode);
      if (declared !== null) {
        _parentFQN = declared.length > 0 ? declared : undefined;
      }
    }
    const existingIds = this.fileSymbols.get(uri);
    const prevSignatures: string[] = [];
    const oldEntriesByKey = new Map<string, SymbolEntry>();
    const oldSymbolsToDelete = new Set<SymbolId>();

    // Step 2: Snapshot prior symbols for this URI so stable declarations can reuse their SymbolIds,
    // and temporarily detach old entries from parent-child and byName lookup tables before re-walking.
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
          const parentIdKey = entry.parentId ?? 0;
          const parentChildren = this.unifiedIndex.childrenOf.get(parentIdKey);
          if (parentChildren) {
            this.unifiedIndex.childrenOf.set(
              parentIdKey,
              parentChildren.filter((symId) => symId !== id),
            );
          }
          const list = this.unifiedIndex.byName.get(entry.name);
          if (list) {
            this.unifiedIndex.byName.set(
              entry.name,
              list.filter((symId) => symId !== id),
            );
          }
          if (_parentFQN && entry.name) {
            const fqn = `${_parentFQN}.${entry.name}`;
            const fqnList = this.unifiedIndex.byName.get(fqn);
            if (fqnList) {
              this.unifiedIndex.byName.set(
                fqn,
                fqnList.filter((symId) => symId !== id),
              );
            }
          }
          if (entry.name && entry.name.includes(":")) {
            const localName = entry.name.split(":").pop()!;
            const localList = this.unifiedIndex.byName.get(localName);
            if (localList) {
              this.unifiedIndex.byName.set(
                localName,
                localList.filter((symId) => symId !== id),
              );
            }
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

    // Step 3: Helper to purge any prior symbols that were not matched and reclaimed during the new CST walk,
    // recording both the removed symbols and their parents in the global changed/structural sets for Salsa invalidation.
    const cleanupDeletedSymbols = () => {
      for (const oldId of oldSymbolsToDelete) {
        this.globalChangedIds.add(oldId);
        this.globalStructuralChangedIds.add(oldId);
        const entry = this.unifiedIndex.symbols.get(oldId);
        if (entry && entry.parentId !== null) {
          this.globalChangedIds.add(entry.parentId);
          this.globalStructuralChangedIds.add(entry.parentId);
          const parentChildren = this.unifiedIndex.childrenOf.get(entry.parentId);
          if (parentChildren) {
            this.unifiedIndex.childrenOf.set(
              entry.parentId,
              parentChildren.filter((id) => id !== oldId),
            );
          }
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
    };

    const newIds: SymbolId[] = [];

    // Step 4: Special-case tabular `.csv` resources by synthesizing a package-like root Class symbol
    // and virtual Component symbols (`numRows`, `numCols`, `values`, and per-column arrays).
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

      const parentKey = parentId === null ? "root" : String(parentId);
      const matchKey = `${parentKey}:Class:${normalizedName}:SourceFile`;
      let symId: SymbolId;
      const existingEntry =
        oldEntriesByKey.get(matchKey) ?? oldEntriesByKey.get(`root:Class:${normalizedName}:SourceFile`);
      const rootStart = rootNode.startOffset ?? rootNode.startByte ?? rootNode.startIndex ?? 0;
      const rootEnd = rootNode.endOffset ?? rootNode.endByte ?? rootNode.endIndex ?? 0;
      if (existingEntry && oldSymbolsToDelete.has(existingEntry.id)) {
        symId = existingEntry.id;
        oldSymbolsToDelete.delete(symId);
        const prevStart = existingEntry.startOffset ?? existingEntry.startByte;
        const prevEnd = existingEntry.endOffset ?? existingEntry.endByte;
        if (prevStart !== rootStart || prevEnd !== rootEnd) {
          this.globalChangedIds.add(symId);
          this.globalStructuralChangedIds.add(symId);
          if (parentId !== null) {
            this.globalChangedIds.add(parentId);
            this.globalStructuralChangedIds.add(parentId);
          }
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
        startByte: rootStart,
        endByte: rootEnd,
        startOffset: rootStart,
        endOffset: rootEnd,
        exports: [],
        inherits: [],
        metadata: {
          classPrefixes: "package",
        },
      };
      this.unifiedIndex.symbols.set(symId, rootEntry);

      const nameList = this.unifiedIndex.byName.get(normalizedName) || [];
      if (!nameList.includes(symId)) nameList.push(symId);
      this.unifiedIndex.byName.set(normalizedName, nameList);

      if (_parentFQN) {
        const fqn = `${_parentFQN}.${normalizedName}`;
        const fqnList = this.unifiedIndex.byName.get(fqn) || [];
        if (!fqnList.includes(symId)) fqnList.push(symId);
        this.unifiedIndex.byName.set(fqn, fqnList);
      }

      const parentChildList = this.unifiedIndex.childrenOf.get(parentId ?? 0) || [];
      if (!parentChildList.includes(symId)) parentChildList.push(symId);
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
            startOffset: 0,
            endOffset: 0,
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
          if (!list.includes(childId)) list.push(childId);
          this.unifiedIndex.byName.set(name, list);

          const childList = this.unifiedIndex.childrenOf.get(symId) || [];
          if (!childList.includes(childId)) childList.push(childId);
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

      cleanupDeletedSymbols();
      this.fileSymbols.set(uri, newIds);
      this._version++;
      this._structuralRevision++;
      return;
    }

    // Step 5: Recursive green CST walker that extracts symbols (Classes, Components, Extends, Connect, etc.)
    // according to language grammar `IndexerHook` definitions.
    const walk = (node: any, parentId: SymbolId | null) => {
      let currentId = parentId;
      const hook = this.hookMap.get(node.type);

      // Step 5a: Handle `class extends <Name>` (long_class_specifier with leading `extends` keyword)
      // by synthesizing an implicit `Extends` symbol entry attached to the enclosing class.
      if (node.type === "long_class_specifier" || node.type === "LongClassSpecifier") {
        const firstChild = (node.children || [])[0];
        const isExtends =
          firstChild &&
          (firstChild.text === "extends" || firstChild.type === '"extends"' || firstChild.type === "extends");
        if (isExtends && parentId !== null) {
          const identChild = (node.children || []).find((c: any) => c.type === "identifier" || c.type === "IDENT");
          const extName = identChild ? getNodeText(identChild) : "";
          if (extName) {
            const extHook: IndexerHook = {
              ruleName: "extends_clause",
              kind: "Extends",
              namePath: "name",
              exportPaths: [],
              inheritPaths: [],
              metadataFieldPaths: {
                typeSpecifier: "name",
              },
            };
            const parentKey = String(parentId);
            const matchKey = `${parentKey}:${extHook.kind}:${extName}:${extHook.ruleName}`;
            let extSymId: SymbolId;
            const existingEntry = oldEntriesByKey.get(matchKey);
            const modChild = (node.children || []).find(
              (c: any) => c.type === "class_modification" || c.type === "ClassModification",
            );
            const extEnd = modChild
              ? (modChild.endOffset ?? modChild.endByte ?? modChild.endIndex ?? 0)
              : (identChild.endOffset ?? identChild.endByte ?? identChild.endIndex ?? 0);
            const extStart =
              firstChild.startOffset ??
              firstChild.startByte ??
              firstChild.startIndex ??
              node.startOffset ??
              node.startByte ??
              node.startIndex ??
              0;
            if (existingEntry && oldSymbolsToDelete.has(existingEntry.id)) {
              extSymId = existingEntry.id;
              oldSymbolsToDelete.delete(extSymId);
              this.globalChangedIds.add(extSymId);
              this.globalStructuralChangedIds.add(extSymId);
              if (parentId !== null) {
                this.globalChangedIds.add(parentId);
                this.globalStructuralChangedIds.add(parentId);
              }
            } else {
              extSymId = this.nextSymbolId++;
              this.globalChangedIds.add(extSymId);
              this.globalStructuralChangedIds.add(extSymId);
              this.globalChangedIds.add(parentId);
              this.globalStructuralChangedIds.add(parentId);
            }
            newIds.push(extSymId);
            const extEntry: SymbolEntry = {
              id: extSymId,
              kind: "Extends",
              name: extName,
              ruleName: "extends_clause",
              namePath: "name",
              fieldName: null,
              parentId,
              resourceId: uri,
              startByte: extStart,
              endByte: extEnd,
              startOffset: extStart,
              endOffset: extEnd,
              exports: [],
              inherits: [],
              metadata: {
                typeSpecifier: extName,
              },
            };
            this.unifiedIndex.symbols.set(extSymId, extEntry);
            const list = this.unifiedIndex.byName.get(extName) || [];
            if (!list.includes(extSymId)) list.push(extSymId);
            this.unifiedIndex.byName.set(extName, list);

            const childList = this.unifiedIndex.childrenOf.get(parentId) || [];
            if (!childList.includes(extSymId)) childList.push(extSymId);
            this.unifiedIndex.childrenOf.set(parentId, childList);
          }
        }
      }

      // Step 5b: If the CST node type matches a registered grammar IndexerHook (e.g. class_definition,
      // component_clause, extends_clause, connect_clause), extract its name, byte/offset spans, and metadata.
      if (hook) {
        const nameNode = hook.namePath ? resolveFieldPath(node, hook.namePath) : null;
        let name = nameNode ? getNodeText(nameNode) : "";
        if (!name && node.type) {
          name = node.type;
        }

        // Attempt to reuse the previous SymbolId if a symbol with the same parent, kind, name, and rule existed.
        const parentKey = parentId === null ? "root" : String(parentId);
        const matchKey = `${parentKey}:${hook.kind}:${name}:${hook.ruleName}`;
        let symId: SymbolId;
        const existingEntry = oldEntriesByKey.get(matchKey);
        const nodeStart = node.startOffset ?? node.startByte ?? node.startIndex ?? 0;
        const nodeEnd = node.endOffset ?? node.endByte ?? node.endIndex ?? 0;
        if (existingEntry && oldSymbolsToDelete.has(existingEntry.id)) {
          symId = existingEntry.id;
          oldSymbolsToDelete.delete(symId);
          // Mark symbol dirty only if its span intersects the incremental edit ranges or shifted bounds.
          const dirtyRanges = this.fileDirtyRanges.get(uri);
          const existingStart = existingEntry.startOffset ?? existingEntry.startByte;
          const existingEnd = existingEntry.endOffset ?? existingEntry.endByte;
          const intersectsDirty =
            dirtyRanges && dirtyRanges.length > 0
              ? dirtyRanges.some(
                  (r) =>
                    Math.max(r.startOffset ?? r.startByte, existingStart) <=
                    Math.min(r.endOffset ?? r.endByte, existingEnd),
                )
              : existingStart !== nodeStart || existingEnd !== nodeEnd;
          if (intersectsDirty) {
            this.globalChangedIds.add(symId);
            this.globalStructuralChangedIds.add(symId);
            if (parentId !== null) {
              this.globalChangedIds.add(parentId);
              this.globalStructuralChangedIds.add(parentId);
            }
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

        // Capture precise identifier field ranges for diagnostic underlines and go-to-definition.
        let fieldRanges:
          | Record<
              string,
              { startByte: number; endByte: number; startOffset?: number | undefined; endOffset?: number | undefined }
            >
          | undefined;
        if (nameNode) {
          const nameStartOff = nameNode.startOffset ?? nameNode.startByte ?? nameNode.startIndex ?? nodeStart;
          const nameEndOff = nameNode.endOffset ?? nameNode.endByte ?? nameNode.endIndex ?? nameStartOff + name.length;
          const nameStartByte = nameNode.startByte ?? nameStartOff;
          const nameEndByte = nameNode.endByte ?? nameEndOff;
          fieldRanges = {
            name: {
              startByte: nameStartByte,
              endByte: nameEndByte,
              startOffset: nameStartOff,
              endOffset: nameEndOff,
            },
          };
          if (hook.namePath) {
            fieldRanges[hook.namePath] = fieldRanges["name"]!;
          }
        }

        const entry: SymbolEntry = {
          id: symId,
          kind: hook.kind,
          name,
          ruleName: hook.ruleName,
          namePath: hook.namePath ?? "",
          fieldName: null,
          parentId,
          resourceId: uri,
          startByte: node.startByte ?? nodeStart,
          endByte: node.endByte ?? nodeEnd,
          startOffset: nodeStart,
          endOffset: nodeEnd,
          fieldRanges,
          exports: extractStringList(node, hook.exportPaths),
          inherits: extractStringList(node, hook.inheritPaths),
          metadata: extractMetadata(node, hook),
        };

        // Step 5c: Register symbol in the primary table, simple-name index, curried/prefixed local name index,
        // top-level FQN index (`_parentFQN.name`), and parent->children tree.
        this.unifiedIndex.symbols.set(symId, entry);

        const list = this.unifiedIndex.byName.get(name) || [];
        if (!list.includes(symId)) list.push(symId);
        this.unifiedIndex.byName.set(name, list);

        if (name && name.includes(":")) {
          const localName = name.split(":").pop()!;
          if (localName) {
            const localList = this.unifiedIndex.byName.get(localName) || [];
            if (!localList.includes(symId)) {
              localList.push(symId);
              this.unifiedIndex.byName.set(localName, localList);
            }
          }
        }

        if (_parentFQN && parentId === initialParentId && name) {
          const fqn = `${_parentFQN}.${name}`;
          const fqnList = this.unifiedIndex.byName.get(fqn) || [];
          if (!fqnList.includes(symId)) {
            fqnList.push(symId);
            this.unifiedIndex.byName.set(fqn, fqnList);
          }
          this.fqnToUri.set(fqn, uri);
        }

        const childList = this.unifiedIndex.childrenOf.get(parentId ?? 0) || [];
        if (!childList.includes(symId)) childList.push(symId);
        this.unifiedIndex.childrenOf.set(parentId ?? 0, childList);
      }

      // Step 5d: Prune CST subtrees that cannot contain structural symbol declarations
      // (expressions, algorithm statements, comments, annotations are lowered directly during flattening).
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

    // Step 6: Resolve the initial parent SymbolId from `_parentFQN` (lazily indexing the parent package if needed)
    // and execute the CST walk from `rootNode`.
    let initialParentId: SymbolId | null = null;
    if (_parentFQN) {
      if (typeof this.ensureFQNIndexed === "function") {
        this.ensureFQNIndexed(_parentFQN);
      }
      let parentEntries = this.unifiedIndex.byName.get(_parentFQN);
      if (!parentEntries || parentEntries.length === 0) {
        const lastPart = _parentFQN.split(".").pop();
        if (lastPart) {
          parentEntries = this.unifiedIndex.byName.get(lastPart);
        }
      }
      if (parentEntries && parentEntries.length > 0) {
        initialParentId = parentEntries[0]!;
      }
    }

    walk(rootNode, initialParentId);

    // Step 7: Finalize symbol cleanup, record the file's symbol list, and bump structural revisions
    // only if the ordered signature sequence (`name:kind:ruleName`) of declared symbols changed.
    cleanupDeletedSymbols();

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

  /** Ensures `uri` is indexed and returns the partial unified `SymbolIndex`. */
  getFileIndex(uri: string): SymbolIndex {
    this.ensureIndexed(uri);
    return this.toUnifiedPartial();
  }

  /**
   * Hydrates pre-serialized `SymbolIndex` bundle data (`symbols`, `byName`, `childrenOf`)
   * for `uri` into `unifiedIndex`, remapping symbol IDs to avoid collisions with existing entries.
   */
  hydrate(uri: string, indexData: any, parentFQN?: string, mapResourceId?: (path: string) => string): void {
    if (!indexData) {
      this._version++;
      this._structuralRevision++;
      return;
    }

    const fileId = this.getFileId(uri);
    if (parentFQN && this.instance && typeof this.instance.registerFileParentFQN === "function") {
      this.instance.registerFileParentFQN(fileId, parentFQN);
    }

    // 1. Build ID remapping table to prevent collisions between bundles and existing symbols
    const symbolsSource: [string | number, any][] =
      indexData.symbols instanceof Map
        ? Array.from(indexData.symbols.entries())
        : Object.entries(indexData.symbols || {});

    const idMap = new Map<number, number>();
    for (const [rawId] of symbolsSource) {
      const oldId = typeof rawId === "string" && !isNaN(Number(rawId)) ? Number(rawId) : Number(rawId);
      const newId = this.nextSymbolId++;
      idMap.set(oldId, newId);
    }

    // 2. Merge symbols
    for (const [rawId, rawEntry] of symbolsSource) {
      const oldId = typeof rawId === "string" && !isNaN(Number(rawId)) ? Number(rawId) : Number(rawId);
      const newId = idMap.get(oldId) ?? oldId;
      const entry: SymbolEntry = { ...(rawEntry as SymbolEntry) };
      const startOff = entry.startOffset ?? entry.startByte ?? 0;
      const endOff = entry.endOffset ?? entry.endByte ?? 0;
      entry.startOffset = startOff;
      entry.endOffset = endOff;
      entry.startByte = entry.startByte ?? startOff;
      entry.endByte = entry.endByte ?? endOff;
      if (entry.fieldRanges) {
        const mappedRanges: Record<
          string,
          { startByte: number; endByte: number; startOffset?: number | undefined; endOffset?: number | undefined }
        > = {};
        for (const [k, v] of Object.entries(entry.fieldRanges)) {
          if (v) {
            const fStart = v.startOffset ?? v.startByte ?? 0;
            const fEnd = v.endOffset ?? v.endByte ?? 0;
            mappedRanges[k] = {
              startByte: v.startByte ?? fStart,
              endByte: v.endByte ?? fEnd,
              startOffset: fStart,
              endOffset: fEnd,
            };
          }
        }
        entry.fieldRanges = mappedRanges;
      }
      entry.id = newId as SymbolId;

      if (entry.parentId !== null && entry.parentId !== undefined) {
        const oldParent = Number(entry.parentId);
        entry.parentId = (idMap.get(oldParent) ?? oldParent) as SymbolId;
      }

      if (mapResourceId && entry.resourceId) {
        entry.resourceId = mapResourceId(entry.resourceId);
      }
      this.unifiedIndex.symbols.set(newId as SymbolId, entry);

      // Associate with file URI for tracking
      const effectiveUri = entry.resourceId || uri;
      let list = this.fileSymbols.get(effectiveUri);
      if (!list) {
        list = [];
        this.fileSymbols.set(effectiveUri, list);
      }
      list.push(newId as SymbolId);

      // Register into WASM linear memory if instance supports it
      if (this.instance && typeof this.instance.registerSymbol === "function") {
        try {
          const sFileId = entry.resourceId ? this.getFileId(entry.resourceId) : fileId;
          const sParentId = entry.parentId === null ? 0 : Number(entry.parentId);
          this.instance.registerSymbol(
            sFileId,
            Number(newId),
            sParentId,
            0,
            0,
            entry.name || "",
            entry.startOffset ?? entry.startByte ?? 0,
            entry.endOffset ?? entry.endByte ?? 0,
            0,
            0,
            parentFQN || "",
          );
        } catch {
          /* ignore WASM registration errors during hydration */
        }
      }
    }

    // 3. Merge byName
    const byNameSource =
      indexData.byName instanceof Map ? indexData.byName.entries() : Object.entries(indexData.byName || {});
    for (const [name, ids] of byNameSource) {
      const idList = Array.isArray(ids) ? (ids as SymbolId[]) : [];
      const mappedIds = idList.map((id) => (idMap.get(Number(id)) ?? id) as SymbolId);
      const existing = this.unifiedIndex.byName.get(name);
      if (!existing) {
        this.unifiedIndex.byName.set(name, [...mappedIds]);
      } else {
        const idSet = new Set(existing);
        for (const id of mappedIds) idSet.add(id);
        this.unifiedIndex.byName.set(name, Array.from(idSet));
      }
    }

    // 4. Merge childrenOf
    const childrenOfSource =
      indexData.childrenOf instanceof Map ? indexData.childrenOf.entries() : Object.entries(indexData.childrenOf || {});
    for (const [rawParentId, children] of childrenOfSource) {
      const rawParent =
        rawParentId === "null" || rawParentId === null || rawParentId === undefined
          ? null
          : typeof rawParentId === "string" && !isNaN(Number(rawParentId))
            ? Number(rawParentId)
            : Number(rawParentId);
      const parentId = rawParent === null ? null : ((idMap.get(rawParent) ?? rawParent) as SymbolId);
      const childList = Array.isArray(children) ? (children as SymbolId[]) : [];
      const mappedChildren = childList.map((c) => (idMap.get(Number(c)) ?? c) as SymbolId);
      const existing = this.unifiedIndex.childrenOf.get(parentId);
      if (!existing) {
        this.unifiedIndex.childrenOf.set(parentId, [...mappedChildren]);
      } else {
        const childSet = new Set(existing);
        for (const c of mappedChildren) childSet.add(c);
        this.unifiedIndex.childrenOf.set(parentId, Array.from(childSet));
      }
    }

    this._version++;
    this._structuralRevision++;
    this.bumpFileStructuralRevision(uri);
  }

  /** Evaluates all remaining lazy loaders and returns the complete unified `SymbolIndex`. */
  toSymbolIndex(): SymbolIndex {
    if (this.fileLoaders.size > 0) {
      const uris = Array.from(this.fileLoaders.keys());
      for (const uri of uris) {
        this.ensureIndexed(uri);
      }
    }
    (this.unifiedIndex as any).workspace = this;
    (this.unifiedIndex as any).workspaceIndex = this;
    return this.unifiedIndex;
  }

  /** Alias for `toSymbolIndex()` returning the complete unified `SymbolIndex`. */
  toUnified(): SymbolIndex {
    return this.toSymbolIndex();
  }

  /** Returns the currently materialized `SymbolIndex` without evaluating pending lazy loaders. */
  toTreeIndex(): SymbolIndex {
    return this.toUnifiedPartial();
  }

  /** Asynchronously evaluates remaining lazy loaders and returns the unified `SymbolIndex`. */
  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toSymbolIndex();
  }

  /** Returns the currently materialized `SymbolIndex` with `workspace` back-references attached. */
  toUnifiedPartial(): SymbolIndex {
    (this.unifiedIndex as any).workspace = this;
    (this.unifiedIndex as any).workspaceIndex = this;
    return this.unifiedIndex;
  }

  /** Returns the workspace skeleton `SymbolIndex` (delegating to `toSymbolIndex()`). */
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
    let stubId = symbolId;
    if (this.instance && typeof this.instance.registerSymbol === "function") {
      stubId = this.instance.registerSymbol(
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
    }
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
    if (this.instance && typeof this.instance.findStubsByNameSIMD === "function") {
      return this.instance.findStubsByNameSIMD(name, preferredFileId);
    }
    const ids = this.unifiedIndex.byName.get(name) ?? [];
    return ids.map((id) => {
      const sym = this.unifiedIndex.symbols.get(id);
      const start = sym?.startOffset ?? sym?.startByte ?? 0;
      const end = sym?.endOffset ?? sym?.endByte ?? 0;
      return {
        symbolId: id,
        fileId: sym ? (this.uriToId.get(sym.resourceId ?? "") ?? 0) : 0,
        parentSymbolId: typeof sym?.parentId === "number" ? sym.parentId : 0,
        kind: typeof sym?.kind === "number" ? sym.kind : 0,
        flags: 0,
        nameHash: 0,
        startByte: sym?.startByte ?? start,
        endByte: sym?.endByte ?? end,
        startOffset: start,
        endOffset: end,
      } as WasmStubSymbol;
    });
  }

  /**
   * Returns all child stubs for a parent symbol ID.
   */
  getChildren(parentSymbolId: number): WasmStubSymbol[] {
    if (this.instance && typeof this.instance.getStubChildren === "function") {
      return this.instance.getStubChildren(parentSymbolId);
    }
    const childrenIds = this.unifiedIndex.childrenOf.get(parentSymbolId) ?? [];
    return childrenIds.map((id) => {
      const sym = this.unifiedIndex.symbols.get(id);
      const start = sym?.startOffset ?? sym?.startByte ?? 0;
      const end = sym?.endOffset ?? sym?.endByte ?? 0;
      return {
        symbolId: id,
        fileId: sym ? (this.uriToId.get(sym.resourceId ?? "") ?? 0) : 0,
        parentSymbolId: typeof sym?.parentId === "number" ? sym.parentId : parentSymbolId,
        kind: typeof sym?.kind === "number" ? sym.kind : 0,
        flags: 0,
        nameHash: 0,
        startByte: sym?.startByte ?? start,
        endByte: sym?.endByte ?? end,
        startOffset: start,
        endOffset: end,
      } as WasmStubSymbol;
    });
  }

  /**
   * Returns all symbols belonging to a specific file.
   */
  getFileSymbols(uriOrFileId: string | number): WasmStubSymbol[] {
    const fileId = typeof uriOrFileId === "number" ? uriOrFileId : this.uriToId.get(uriOrFileId);
    if (!fileId) return [];
    if (this.instance && typeof this.instance.getFileSymbols === "function") {
      return this.instance.getFileSymbols(fileId);
    }
    const uri = this.idToUri.get(fileId);
    const symIds = uri ? (this.fileSymbols.get(uri) ?? []) : [];
    return symIds.map((id) => {
      const sym = this.unifiedIndex.symbols.get(id);
      const start = sym?.startOffset ?? sym?.startByte ?? 0;
      const end = sym?.endOffset ?? sym?.endByte ?? 0;
      return {
        symbolId: id,
        fileId,
        parentSymbolId: typeof sym?.parentId === "number" ? sym.parentId : 0,
        kind: typeof sym?.kind === "number" ? sym.kind : 0,
        flags: 0,
        nameHash: 0,
        startByte: sym?.startByte ?? start,
        endByte: sym?.endByte ?? end,
        startOffset: start,
        endOffset: end,
      } as WasmStubSymbol;
    });
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
      this.fileDirtyRanges.delete(uri);
      this.fileStructuralRevisions.delete(uri);
      this.fileLoaders.delete(uri);
      for (const [fqn, mappedUri] of this.fqnToUri.entries()) {
        if (mappedUri === uri) {
          this.fqnToUri.delete(fqn);
        }
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
            const pKey = entry.parentId ?? null;
            const pChildren = this.unifiedIndex.childrenOf.get(pKey);
            if (pChildren) {
              const filteredChildren = pChildren.filter((x) => x !== id);
              if (filteredChildren.length > 0) {
                this.unifiedIndex.childrenOf.set(pKey, filteredChildren);
              } else {
                this.unifiedIndex.childrenOf.delete(pKey);
              }
            }
            if (pKey !== 0) {
              const zeroChildren = this.unifiedIndex.childrenOf.get(0);
              if (zeroChildren) {
                const filteredZero = zeroChildren.filter((x) => x !== id);
                if (filteredZero.length > 0) {
                  this.unifiedIndex.childrenOf.set(0, filteredZero);
                } else {
                  this.unifiedIndex.childrenOf.delete(0);
                }
              }
            }
          }
          this.unifiedIndex.childrenOf.delete(id);
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
      this.fileDirtyRanges.clear();
      this.fileStructuralRevisions.clear();
      this.fileLoaders.clear();
      this.fqnToUri.clear();
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

  /**
   * Exports all SymbolEntry items associated with a given document URI.
   */
  exportFileEntries(uri: string): SymbolEntry[] {
    const ids = this.fileSymbols.get(uri);
    if (!ids) return [];
    const result: SymbolEntry[] = [];
    for (const id of ids) {
      const entry = this.unifiedIndex.symbols.get(id);
      if (entry) {
        result.push(entry);
      }
    }
    return result;
  }

  /**
   * Directly ingests a pre-compiled array of SymbolEntry items for a URI without CST parsing.
   */
  registerPrecompiledEntries(uri: string, entries: SymbolEntry[]): number {
    const fileId = this.registerFile(uri);
    const newIds: SymbolId[] = [];

    // Remove existing entries for this URI if any
    const existingIds = this.fileSymbols.get(uri);
    if (existingIds) {
      for (const id of existingIds) {
        const entry = this.unifiedIndex.symbols.get(id);
        if (entry) {
          const list = this.unifiedIndex.byName.get(entry.name);
          if (list) {
            const filtered = list.filter((symId) => symId !== id);
            if (filtered.length > 0) {
              this.unifiedIndex.byName.set(entry.name, filtered);
            } else {
              this.unifiedIndex.byName.delete(entry.name);
            }
          }
          const pKey = entry.parentId ?? 0;
          const pChildren = this.unifiedIndex.childrenOf.get(pKey);
          if (pChildren) {
            const filteredChildren = pChildren.filter((symId) => symId !== id);
            if (filteredChildren.length > 0) {
              this.unifiedIndex.childrenOf.set(pKey, filteredChildren);
            } else {
              this.unifiedIndex.childrenOf.delete(pKey);
            }
          }
        }
        this.unifiedIndex.symbols.delete(id);
        this.unifiedIndex.childrenOf.delete(id);
      }
    }

    for (const rawEntry of entries) {
      const startOff = rawEntry.startOffset ?? rawEntry.startByte ?? 0;
      const endOff = rawEntry.endOffset ?? rawEntry.endByte ?? 0;
      const entry: SymbolEntry = {
        ...rawEntry,
        startByte: rawEntry.startByte ?? startOff,
        endByte: rawEntry.endByte ?? endOff,
        startOffset: startOff,
        endOffset: endOff,
      };
      this.unifiedIndex.symbols.set(entry.id, entry);
      newIds.push(entry.id);

      const list = this.unifiedIndex.byName.get(entry.name) || [];
      if (!list.includes(entry.id)) {
        list.push(entry.id);
      }
      this.unifiedIndex.byName.set(entry.name, list);

      const parentId = entry.parentId ?? 0;
      const childList = this.unifiedIndex.childrenOf.get(parentId) || [];
      if (!childList.includes(entry.id)) {
        childList.push(entry.id);
      }
      this.unifiedIndex.childrenOf.set(parentId, childList);

      if (entry.id >= this.nextSymbolId) {
        this.nextSymbolId = entry.id + 1;
      }
    }

    this.fileSymbols.set(uri, newIds);
    this._version++;
    this._structuralRevision++;
    return fileId;
  }
}

/**
 * In-memory document entry stored by `UnifiedWorkspace` containing source text,
 * mutation version, and cached WASM GLR syntax tree.
 */
export interface DocumentRecord {
  /** Document resource URI. */
  uri: string;
  /** Full UTF-16 source text of the document. */
  text: string;
  /** Monotonically increasing per-document edit version. */
  version: number;
  /** Cached parsed syntax tree (`CSTTree`), if parsed. */
  tree?: any;
}

/**
 * Polyglot multi-language workspace coordinator (`UnifiedWorkspace`).
 *
 * Aggregates per-language `LanguageWorkspaceIndex` instances, `WasmQueryEngine` instances,
 * WASM GLR parsers, document text/tree stores, OWL2 ontology stores, and cross-domain
 * `SymbolIndex` merging with optional domain-prefixed `SymbolId` partitioning.
 */
export class UnifiedWorkspace implements IWorkspaceIndex {
  /** Embedded WebAssembly OWL2 ontology store for semantic knowledge graph queries. */
  public owl2Store: WasmOntologyStore;
  /** Cross-language type registry used by `PolyglotTransformer` projections. */
  public typeRegistry = new WorkspaceTypeRegistry();
  /** Map from language identifier (e.g. `"modelica"`, `"sysml2"`) to its `LanguageWorkspaceIndex`. */
  private workspaces = new Map<string, any>();
  /** Map from language identifier to its associated `WasmQueryEngine`. */
  private queryEngines = new Map<string, any>();
  /** Map from language identifier to its registered language configuration object. */
  private configs = new Map<string, any>();
  /** Monotonically increasing workspace mutation counter. */
  private _version = 0;

  /** Process-wide fallback registry mapping file extensions (e.g. `".mo"`) to WASM GLR parser instances. */
  private static globalParsers = new Map<string, any>();
  /** Instance-level registry mapping file extensions to WASM GLR parser instances. */
  private parsers = new Map<string, any>();
  /** Map from document URI to its `DocumentRecord` (text, version, and parsed CST tree). */
  private documents = new Map<string, DocumentRecord>();

  /** Callback used to resolve a `SymbolId` to its backing CST node across workspace documents. */
  public cstNodeProvider?: ((id: SymbolId) => unknown | null) | undefined;
  /** Callback used to slice raw source text `[startByte, endByte]` for a `SymbolEntry`. */
  public cstTextProvider?: ((startByte: number, endByte: number, entry: SymbolEntry) => string | null) | undefined;
  /** Callback routing semantic `query(queryName, id)` invocations to the appropriate language `QueryEngine`. */
  public queryProvider?: ((queryName: string, id: SymbolId) => unknown | null) | undefined;

  /** Initializes a new `UnifiedWorkspace` with default CST node, text, and query providers. */
  constructor() {
    this.owl2Store = new WasmOntologyStore(null, this);

    this.cstNodeProvider = (id: SymbolId): unknown | null => {
      const idx = this.toUnifiedPartial();
      const entry = idx.symbols.get(id);
      if (!entry || !entry.resourceId) return null;
      const tree = this.getDocumentTree(entry.resourceId);
      if (!tree || !tree.rootNode) return null;
      const start = entry.startOffset ?? entry.startByte;
      const end = Math.max(start, entry.endOffset ?? entry.endByte);
      return typeof tree.rootNode.descendantForIndex === "function"
        ? tree.rootNode.descendantForIndex(start, end)
        : null;
    };

    this.cstTextProvider = (startByte: number, endByte: number, entry: SymbolEntry): string | null => {
      if (!entry || !entry.resourceId) return null;
      const text = this.getDocumentText(entry.resourceId);
      if (text === undefined) return null;
      const start = startByte !== undefined ? startByte : (entry.startOffset ?? entry.startByte);
      const end = endByte !== undefined ? endByte : (entry.endOffset ?? entry.endByte);
      return text.substring(start, end);
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

  /** Recovers the CST node for `id` using `cstNodeProvider`. */
  getCstNode(id: SymbolId): any | null {
    if (this.cstNodeProvider) return this.cstNodeProvider(id);
    return null;
  }

  /** Extracts the source text slice `[startByte, endByte]` for `entry` using `cstTextProvider`. */
  getCstText(startByte: number, endByte: number, entry: SymbolEntry): string | null {
    if (this.cstTextProvider) return this.cstTextProvider(startByte, endByte, entry);
    return null;
  }

  /** Evaluates a semantic query `queryName` on `id` via the owning language's `QueryEngine`. */
  query(queryName: string, id: SymbolId): unknown | null {
    if (this.queryProvider) return this.queryProvider(queryName, id);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Parser Registry
  // ---------------------------------------------------------------------------

  /** Registers a WASM GLR parser globally for the file extension `extname` (e.g. `".mo"`). */
  static registerGlobalParser(extname: string, parser: any): void {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    UnifiedWorkspace.globalParsers.set(ext, parser);
  }

  /** Retrieves the globally registered WASM GLR parser for `extname`, if any. */
  static getGlobalParser(extname: string): any | undefined {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    return UnifiedWorkspace.globalParsers.get(ext);
  }

  /** Registers a WASM GLR parser on both this workspace instance and the global parser registry. */
  registerParser(extname: string, parser: any): void {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    this.parsers.set(ext, parser);
    UnifiedWorkspace.registerGlobalParser(ext, parser);
  }

  /** Returns the parser registered for `extname` (checking instance parsers first, then global parsers). */
  getParser(extname: string): any | undefined {
    const ext = extname.startsWith(".") ? extname : `.${extname}`;
    return this.parsers.get(ext) ?? UnifiedWorkspace.getGlobalParser(ext);
  }

  /**
   * Parses `input` using the WASM GLR parser registered for `uriOrExt`, supporting incremental
   * re-parsing when `oldTree` and `editBounds` are provided.
   */
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

  /**
   * Stores or updates a document's text in the workspace, computing incremental diff ranges,
   * re-parsing its CST tree (unless `options.parse === false`), and indexing its symbols into
   * the corresponding `LanguageWorkspaceIndex` (unless `options.index === false`).
   */
  setDocument(
    uri: string,
    text: string,
    options?: {
      parse?: boolean | undefined;
      oldTree?: any;
      editBounds?: any;
      editRanges?: EditRange[] | undefined;
      index?: boolean | undefined;
    },
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

  /** Returns the `DocumentRecord` for `uri`, or `undefined` if not stored. */
  getDocument(uri: string): DocumentRecord | undefined {
    return this.documents.get(uri);
  }

  /** Returns the raw source text for `uri`, or `undefined` if not stored. */
  getDocumentText(uri: string): string | undefined {
    return this.documents.get(uri)?.text;
  }

  /** Returns the parsed CST tree for `uri`, parsing on-demand if only source text is currently stored. */
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

  /** Explicitly attaches a pre-parsed CST `tree` to `uri` in the document store. */
  setDocumentTree(uri: string, tree: any): void {
    const doc = this.documents.get(uri);
    if (doc) {
      doc.tree = tree;
    } else {
      this.documents.set(uri, { uri, text: "", version: 1, tree });
    }
  }

  /** Removes `uri` from the document store and clears its indexed symbols from the owning language workspace. */
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

  /** Static lookup table mapping file extensions (e.g. `".mo"`, `".sysml"`) to canonical language IDs. */
  private static languageExtensionMap = new Map<string, string>([
    [".sysml", "sysml2"],
    [".sysml2", "sysml2"],
    [".mo", "modelica"],
    [".msim", "modelica"],
    [".mos", "modelica"],
    [".step", "step"],
    [".stp", "step"],
    [".p21", "step"],
    [".owl", "owl2"],
    [".ttl", "owl2"],
    [".ofn", "owl2"],
    [".rdf", "owl2"],
    [".csv", "csv"],
    [".scad", "scad"],
    [".inp", "fea"],
    [".bdf", "fea"],
    [".cfg", "cfd"],
  ]);

  /** Globally associates a file extension `ext` with a canonical language identifier `lang`. */
  static registerLanguageExtension(ext: string, lang: string): void {
    const normalized = ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    UnifiedWorkspace.languageExtensionMap.set(normalized, lang.toLowerCase());
  }

  /** Instance helper that delegates to `UnifiedWorkspace.registerLanguageExtension(ext, lang)`. */
  registerLanguageExtension(ext: string, lang: string): void {
    UnifiedWorkspace.registerLanguageExtension(ext, lang);
  }

  /** Infers the canonical language identifier (e.g. `"modelica"`, `"sysml2"`) from a document URI's file extension. */
  detectLanguage(uri: string): string | undefined {
    const ext = uri.includes(".") ? `.${uri.split(".").pop()?.toLowerCase()}` : "";
    if (UnifiedWorkspace.languageExtensionMap.has(ext)) {
      return UnifiedWorkspace.languageExtensionMap.get(ext);
    }
    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Polyglot Directory Ingestion
  // ---------------------------------------------------------------------------

  /**
   * Recursively crawls `dirPath` using the provided virtual/host `fs` adapter, loading and
   * indexing all files whose extension has a registered parser.
   */
  async loadDirectory(
    dirPath: string,
    fs: {
      stat: (p: string) => any;
      readdir: (p: string) => { name: string }[];
      read: (p: string) => string;
      join: (...p: string[]) => string;
    },
    options?: { ignore?: string[] | undefined },
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

  /** Total number of documents stored in `this.documents`. */
  get fileCount(): number {
    return this.documents.size;
  }

  /** Aggregate mutation version across `UnifiedWorkspace` and all registered language workspaces. */
  get version(): number {
    let v = this._version;
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.version === "number") v += ws.version;
    }
    return v;
  }

  /** Aggregate structural revision sum across all registered language workspaces. */
  get structuralRevision(): number {
    let r = 0;
    for (const ws of this.workspaces.values()) {
      if (ws && typeof ws.structuralRevision === "number") r += ws.structuralRevision;
    }
    return r;
  }

  /** Returns the per-file structural revision for `uri` from its owning language workspace. */
  getFileStructuralRevision(uri: string): number {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).getFileStructuralRevision === "function") {
        const rev = (ws as any).getFileStructuralRevision(uri);
        if (rev > 0) return rev;
      }
    }
    return 0;
  }

  /** Registers a language workspace index (and optional language DSL configuration) under `language`. */
  registerWorkspace(language: string, index: any, config?: any): void {
    if (!index) return;
    this.workspaces.set(language, index);
    if (config) {
      this.configs.set(language, config);
    }
    this._version++;
  }

  /** Unregisters the workspace index, configuration, and query engine for `language`. */
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

  /** Returns the registered workspace index for `language`, if any. */
  getWorkspace(language: string): any {
    return this.workspaces.get(language);
  }

  /** Returns the registered language configuration for `language`, if any. */
  getLanguageConfig(language: string): any {
    return this.configs.get(language);
  }

  /** Creates a `PolyglotTransformer` for `language` if its config defines polyglot projection rules. */
  createPolyglotTransformer(language: string): PolyglotTransformer | null {
    const config = this.configs.get(language);
    if (!config?.polyglot) return null;
    return new PolyglotTransformer(config.polyglot, this.typeRegistry);
  }

  /** Projects a `PolyglotNode` from `sourceLang` into `targetLang` source text. */
  projectPolyglot(sourceLang: string, targetLang: string, node: PolyglotNode): string | null {
    const transformer = this.createPolyglotTransformer(sourceLang);
    if (!transformer) return null;
    return transformer.transform(node, targetLang);
  }

  /** Registers a `WasmQueryEngine` instance for `language`. */
  registerQueryEngine(language: string, engine: any): void {
    this.queryEngines.set(language, engine);
    this._version++;
  }

  /** Returns the registered `WasmQueryEngine` for `language`, if any. */
  getQueryEngine(language: string): any {
    return this.queryEngines.get(language);
  }

  /** When `true`, forces symbol IDs merged across multiple languages to be bit-prefixed with their `LanguageDomainId`. */
  public domainPartitioning = false;

  /**
   * Merges per-language `SymbolIndex` snapshots into `merged`, applying `makePolyglotSymbolId`
   * domain bit-partitioning whenever `domainPartitioning` is enabled or a `SymbolId` collision is detected.
   */
  private mergeIndices(merged: SymbolIndex, entries: [string, SymbolIndex | null][]): SymbolIndex {
    for (const [lang, idx] of entries) {
      if (!idx) continue;

      const domain = getLanguageDomainId(lang);
      const mustRemap = this.domainPartitioning && domain !== LanguageDomainId.Default;

      // Check if there is an ID collision with any symbol already in merged
      let hasCollision = false;
      if (!mustRemap) {
        for (const id of idx.symbols.keys()) {
          if (merged.symbols.has(id)) {
            hasCollision = true;
            break;
          }
        }
      }

      const shouldRemap = mustRemap || hasCollision;
      const idMap = new Map<SymbolId, SymbolId>();
      const remap = (id: SymbolId): SymbolId => {
        if (!shouldRemap) return id;
        if (getSymbolDomain(id) !== 0) return id;
        let mapped = idMap.get(id);
        if (mapped === undefined) {
          mapped = makePolyglotSymbolId(domain, id);
          idMap.set(id, mapped);
        }
        return mapped;
      };

      for (const [id, entry] of idx.symbols.entries()) {
        const newId = remap(id);
        const newParentId =
          entry.parentId !== null && entry.parentId !== undefined
            ? entry.parentId === 0
              ? 0
              : remap(entry.parentId)
            : null;
        const startOff = entry.startOffset ?? entry.startByte ?? 0;
        const endOff = entry.endOffset ?? entry.endByte ?? 0;
        merged.symbols.set(newId, {
          ...entry,
          id: newId,
          parentId: newParentId,
          startByte: entry.startByte ?? startOff,
          endByte: entry.endByte ?? endOff,
          startOffset: startOff,
          endOffset: endOff,
          language: entry.language ?? lang,
        });
      }

      for (const [name, ids] of idx.byName.entries()) {
        const existing = merged.byName.get(name) || [];
        const newIds = shouldRemap ? ids.map(remap) : ids;
        merged.byName.set(name, existing.concat(newIds));
      }

      for (const [parentId, childIds] of idx.childrenOf.entries()) {
        const targetParent =
          parentId !== null && parentId !== undefined ? (parentId === 0 ? 0 : remap(parentId)) : null;
        const existing = merged.childrenOf.get(targetParent) || [];
        const newChildIds = shouldRemap ? childIds.map(remap) : childIds;
        merged.childrenOf.set(targetParent, existing.concat(newChildIds));
      }
    }
    return merged;
  }

  /** Materializes and merges the complete `SymbolIndex` across all registered language workspaces. */
  toSymbolIndex(): SymbolIndex {
    if (this.workspaces.size === 0) {
      return {
        symbols: new Map<SymbolId, SymbolEntry>(),
        byName: new Map<string, SymbolId[]>(),
        childrenOf: new Map<SymbolId | null, SymbolId[]>(),
      };
    }
    if (this.workspaces.size === 1 && !this.domainPartitioning) {
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
    const entries: [string, SymbolIndex | null][] = [];
    for (const [lang, ws] of this.workspaces.entries()) {
      if (!ws) continue;
      const idx =
        typeof ws.toSymbolIndex === "function"
          ? ws.toSymbolIndex()
          : typeof ws.toUnified === "function"
            ? ws.toUnified()
            : null;
      entries.push([lang, idx]);
    }
    return this.mergeIndices(merged, entries);
  }

  /** Ensures all direct child files under `parentFQN` are indexed across all language workspaces. */
  ensureChildrenIndexed(parentFQN?: string): void {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).ensureChildrenIndexed === "function") {
        (ws as any).ensureChildrenIndexed(parentFQN);
      }
    }
  }

  /** Ensures all ancestor packages and files along `fqn` are indexed across all language workspaces. */
  ensureFQNIndexed(fqn: string): void {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).ensureFQNIndexed === "function") {
        (ws as any).ensureFQNIndexed(fqn);
      }
    }
  }

  /** Resolves a fully qualified name `fqn` to its defining document URI across all language workspaces. */
  getFileUriForFQN(fqn: string): string | undefined {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).getFileUriForFQN === "function") {
        const uri = (ws as any).getFileUriForFQN(fqn);
        if (uri) return uri;
      }
    }
    this.ensureFQNIndexed(fqn);
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).getFileUriForFQN === "function") {
        const uri = (ws as any).getFileUriForFQN(fqn);
        if (uri) return uri;
      }
    }
    return undefined;
  }

  /** Checks whether any language workspace has unindexed lazy loaders under `parentFQN`. */
  hasPendingChildren(parentFQN?: string): boolean {
    for (const ws of this.workspaces.values()) {
      if (ws && typeof (ws as any).hasPendingChildren === "function") {
        if ((ws as any).hasPendingChildren(parentFQN)) return true;
      }
    }
    return false;
  }

  /** Materializes and returns the unified `SymbolIndex` across all registered language workspaces. */
  toUnified(): SymbolIndex {
    if (this.workspaces.size === 0) {
      return {
        symbols: new Map<SymbolId, SymbolEntry>(),
        byName: new Map<string, SymbolId[]>(),
        childrenOf: new Map<SymbolId | null, SymbolId[]>(),
      };
    }
    if (this.workspaces.size === 1 && !this.domainPartitioning) {
      for (const ws of this.workspaces.values()) {
        if (ws && typeof ws.toUnified === "function") {
          return ws.toUnified();
        }
        if (ws && typeof ws.toSymbolIndex === "function") {
          return ws.toSymbolIndex();
        }
      }
    }
    const merged: SymbolIndex = {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
    const entries: [string, SymbolIndex | null][] = [];
    for (const [lang, ws] of this.workspaces.entries()) {
      if (!ws) continue;
      let idx: SymbolIndex | null = null;
      if (typeof ws.toUnified === "function") {
        idx = ws.toUnified();
      } else if (typeof ws.toSymbolIndex === "function") {
        idx = ws.toSymbolIndex();
      }
      entries.push([lang, idx]);
    }
    this.mergeIndices(merged, entries);
    (merged as any).workspace = this;
    return merged;
  }

  /** Alias for `toUnifiedPartial()` returning the currently materialized symbol tree index. */
  toTreeIndex(): SymbolIndex {
    return this.toUnifiedPartial();
  }

  /** Asynchronously materializes and merges the `SymbolIndex` across all registered language workspaces. */
  async toSymbolIndexAsync(): Promise<SymbolIndex> {
    if (this.workspaces.size === 0) {
      return {
        symbols: new Map<SymbolId, SymbolEntry>(),
        byName: new Map<string, SymbolId[]>(),
        childrenOf: new Map<SymbolId | null, SymbolId[]>(),
      };
    }
    if (this.workspaces.size === 1 && !this.domainPartitioning) {
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
    const entries: [string, SymbolIndex | null][] = [];
    for (const [lang, ws] of this.workspaces.entries()) {
      if (!ws) continue;
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
      entries.push([lang, idx]);
    }
    return this.mergeIndices(merged, entries);
  }

  /** Alias for `toSymbolIndexAsync()`. */
  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toSymbolIndexAsync();
  }

  /** Returns the merged `SymbolIndex` of all currently indexed files without evaluating pending lazy loaders. */
  toUnifiedPartial(): SymbolIndex {
    if (this.workspaces.size === 0) {
      return {
        symbols: new Map<SymbolId, SymbolEntry>(),
        byName: new Map<string, SymbolId[]>(),
        childrenOf: new Map<SymbolId | null, SymbolId[]>(),
      };
    }
    if (this.workspaces.size === 1) {
      for (const ws of this.workspaces.values()) {
        if (ws && typeof ws.toUnifiedPartial === "function") {
          const res = ws.toUnifiedPartial();
          (res as any).workspace = this;
          return res;
        }
        if (ws && typeof ws.toSymbolIndex === "function") {
          const res = ws.toSymbolIndex();
          (res as any).workspace = this;
          return res;
        }
      }
    }
    const merged: SymbolIndex = {
      symbols: new Map<SymbolId, SymbolEntry>(),
      byName: new Map<string, SymbolId[]>(),
      childrenOf: new Map<SymbolId | null, SymbolId[]>(),
    };
    const entries: [string, SymbolIndex | null][] = [];
    for (const [lang, ws] of this.workspaces.entries()) {
      if (!ws) continue;
      const idx =
        typeof ws.toUnifiedPartial === "function"
          ? ws.toUnifiedPartial()
          : typeof ws.toSymbolIndex === "function"
            ? ws.toSymbolIndex()
            : null;
      entries.push([lang, idx]);
    }
    this.mergeIndices(merged, entries);
    (merged as any).workspace = this;
    return merged;
  }

  /** Returns a lightweight skeleton `SymbolIndex` across registered language workspaces. */
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
