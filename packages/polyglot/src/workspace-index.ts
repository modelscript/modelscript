/* eslint-disable */
import type { IndexerHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";
import { SymbolIndexer, type CSTNode } from "./symbol-indexer.js";

/**
 * A workspace-level symbol index spanning multiple files.
 * Supports lazy loading: files are indexed on first access.
 * Provides a unified view for cross-file resolution.
 */
export class WorkspaceIndex {
  private files = new Map<
    string,
    {
      index: SymbolIndex | null;
      loader: (() => CSTNode) | null;
      parentFQN?: string;
      dirty: boolean;
    }
  >();

  private hooks: IndexerHook[];

  /** Global ID counter — ensures unique IDs across all files. */
  private nextGlobalId: SymbolId = 1;

  /** Cached unified index — invalidated when any file changes. */
  private unifiedCache: SymbolIndex | null = null;

  constructor(hooks: IndexerHook[]) {
    this.hooks = hooks;
  }

  /**
   * Register a file for lazy indexing.
   * The loader will be called only when the file's index is first requested.
   */
  register(uri: string, loader: () => CSTNode, parentFQN?: string): void {
    this.files.set(uri, { index: null, loader, parentFQN, dirty: true });
    this.unifiedCache = null;
  }

  /**
   * Mark a file as dirty (will re-index on next access).
   * Optionally provide a new loader.
   */
  markDirty(uri: string, loader?: () => CSTNode): void {
    const file = this.files.get(uri);
    if (file) {
      file.dirty = true;
      file.index = null; // Clear old index
      if (loader) file.loader = loader;
      this.unifiedCache = null;
    }
  }

  /**
   * Remove a file from the workspace.
   */
  remove(uri: string): void {
    this.files.delete(uri);
    this.unifiedCache = null;
  }

  /**
   * Get or create the index for a single file.
   * Indexes lazily on first access.
   * Each file gets globally unique symbol IDs via remapping.
   */
  getFileIndex(uri: string): SymbolIndex | null {
    const file = this.files.get(uri);
    if (!file) return null;

    if (file.dirty || !file.index) {
      if (!file.loader) return null;
      const indexer = new SymbolIndexer(this.hooks);
      const rawIndex = indexer.index(file.loader());

      // Re-map IDs to be globally unique
      const idMap = new Map<SymbolId, SymbolId>();
      for (const id of rawIndex.symbols.keys()) {
        const globalId = this.nextGlobalId++;
        idMap.set(id, globalId);
      }

      const symbols = new Map<SymbolId, SymbolEntry>();
      const byName = new Map<string, SymbolId[]>();

      for (const [oldId, entry] of rawIndex.symbols) {
        const newId = idMap.get(oldId)!;
        const remapped: SymbolEntry = {
          ...entry,
          id: newId,
          parentId: entry.parentId !== null ? (idMap.get(entry.parentId) ?? entry.parentId) : null,
          resourceId: uri,
        };
        symbols.set(newId, remapped);

        const existing = byName.get(remapped.name);
        if (existing) existing.push(newId);
        else byName.set(remapped.name, [newId]);
      }

      // Re-map childrenOf to use global IDs
      const childrenOf = new Map<SymbolId | null, SymbolId[]>();
      for (const [parentId, childIds] of rawIndex.childrenOf) {
        const newParentId = parentId !== null ? (idMap.get(parentId) ?? parentId) : null;
        const newChildIds = childIds.map((cid) => idMap.get(cid) ?? cid);
        childrenOf.set(newParentId, newChildIds);
      }

      file.index = { symbols, byName, childrenOf };
      file.dirty = false;
    }

    return file.index;
  }

  /**
   * Unified name lookup across all loaded files.
   * Forces indexing of all registered files.
   */
  byName(name: string): SymbolEntry[] {
    const unified = this.toUnified();
    const ids = unified.byName.get(name);
    if (!ids) return [];
    return ids.map((id) => unified.symbols.get(id)!).filter(Boolean);
  }

  /**
   * Get a merged SymbolIndex view across all files.
   * Forces indexing of all registered files.
   * Cached until any file is marked dirty.
   */
  toUnified(): SymbolIndex {
    if (this.unifiedCache) return this.unifiedCache;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();

    console.error(`[WorkspaceIndex] toUnified() started. Processing ${this.files.size} files...`);
    let processed = 0;
    for (const uri of this.files.keys()) {
      const fileIndex = this.getFileIndex(uri);
      processed++;
      if (processed % 500 === 0) console.error(`[WorkspaceIndex] Processed ${processed}/${this.files.size} files...`);
      if (!fileIndex) continue;

      for (const [id, entry] of fileIndex.symbols) {
        symbols.set(id, entry);
      }

      for (const [name, ids] of fileIndex.byName) {
        const existing = byName.get(name);
        if (existing) {
          existing.push(...ids);
        } else {
          byName.set(name, [...ids]);
        }
      }
    }

    // Merge childrenOf maps
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();
    for (const uri of this.files.keys()) {
      const fileIndex = this.getFileIndex(uri);
      if (!fileIndex) continue;
      for (const [parentId, childIds] of fileIndex.childrenOf) {
        const existing = childrenOf.get(parentId);
        if (existing) {
          for (const cid of childIds) {
            if (!existing.includes(cid)) existing.push(cid);
          }
        } else {
          childrenOf.set(parentId, [...childIds]);
        }
      }
    }

    this.stitchParentFQNs(symbols, byName, childrenOf);
    this.unifiedCache = { symbols, byName, childrenOf };
    return this.unifiedCache;
  }

  async toUnifiedAsync(): Promise<SymbolIndex> {
    if (this.unifiedCache) return this.unifiedCache;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();

    let count = 0;
    for (const uri of this.files.keys()) {
      const fileIndex = this.getFileIndex(uri);

      // Yield to event loop to keep UI responsive
      if (++count % 50 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      if (!fileIndex) continue;

      for (const [id, entry] of fileIndex.symbols) {
        symbols.set(id, entry);
      }

      for (const [name, ids] of fileIndex.byName) {
        const existing = byName.get(name);
        if (existing) {
          existing.push(...ids);
        } else {
          byName.set(name, [...ids]);
        }
      }
    }

    const childrenOf = new Map<SymbolId | null, SymbolId[]>();
    for (const uri of this.files.keys()) {
      const fileIndex = this.getFileIndex(uri);
      if (!fileIndex) continue;
      for (const [parentId, childIds] of fileIndex.childrenOf) {
        const existing = childrenOf.get(parentId);
        if (existing) {
          for (const cid of childIds) {
            if (!existing.includes(cid)) existing.push(cid);
          }
        } else {
          childrenOf.set(parentId, [...childIds]);
        }
      }
    }

    this.stitchParentFQNs(symbols, byName, childrenOf);
    this.unifiedCache = { symbols, byName, childrenOf };
    return this.unifiedCache;
  }

  private stitchParentFQNs(
    symbols: Map<SymbolId, SymbolEntry>,
    byName: Map<string, SymbolId[]>,
    childrenOf: Map<SymbolId | null, SymbolId[]>,
  ) {
    const sortedUris = [...this.files.entries()]
      .filter(([_, file]) => !!file.parentFQN)
      .sort((a, b) => a[1].parentFQN!.length - b[1].parentFQN!.length);

    for (const [uri, file] of sortedUris) {
      if (!file.parentFQN || !file.index) continue;
      const parentId = this.resolveFQN(file.parentFQN, symbols, byName);
      if (parentId !== null) {
        const rootChildIds = file.index.childrenOf.get(null);
        if (rootChildIds) {
          for (const id of rootChildIds) {
            const entry = symbols.get(id);
            if (entry) {
              entry.parentId = parentId;

              let children = childrenOf.get(parentId);
              if (!children) {
                children = [];
                childrenOf.set(parentId, children);
              }
              if (!children.includes(id)) {
                children.push(id);
              }

              let rootChildren = childrenOf.get(null);
              if (rootChildren) {
                const idx = rootChildren.indexOf(id);
                if (idx !== -1) rootChildren.splice(idx, 1);
              }
            }
          }
        }
      }
    }
  }

  private resolveFQN(
    fqn: string,
    symbols: Map<SymbolId, SymbolEntry>,
    byName: Map<string, SymbolId[]>,
  ): SymbolId | null {
    if (!fqn) return null;
    const parts = fqn.split(".");
    const lastName = parts[parts.length - 1];
    const candidates = byName.get(lastName);
    if (!candidates) return null;

    for (const id of candidates) {
      let currentId: SymbolId | null = id;
      let matched = true;
      for (let i = parts.length - 1; i >= 0; i--) {
        const sym = symbols.get(currentId!);
        if (!sym || sym.name !== parts[i]) {
          matched = false;
          break;
        }
        currentId = sym.parentId;
      }
      if (matched && currentId === null) {
        return id;
      }
    }
    return null;
  }

  /** Get all registered file URIs. */
  get uris(): string[] {
    return [...this.files.keys()];
  }

  /** Check if a file is registered. */
  has(uri: string): boolean {
    return this.files.has(uri);
  }
}
