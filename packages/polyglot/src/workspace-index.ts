/* eslint-disable */
import type { IndexerHook, SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";
import { SymbolIndexer, type CSTNode } from "./symbol-indexer.js";

/** Global ID counter — ensures unique IDs across all files. */
let globalIdCounter: SymbolId = 1;

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
      /** Retained old index for incremental re-indexing. */
      oldIndex: SymbolIndex | null;
      /** Edit byte ranges for incremental re-indexing. */
      editRanges: Array<{ startByte: number; endByte: number }> | null;
      /** ID remapping from local→global IDs for the current index. */
      idMap: Map<SymbolId, SymbolId> | null;
      loader: (() => CSTNode) | null;
      parentFQN?: string;
      dirty: boolean;
    }
  >();

  /** Changed symbol IDs from the last incremental update, keyed by file URI. */
  private lastChangedIds = new Map<string, Set<SymbolId>>();

  /** Aggregated symbol IDs that changed across the entire workspace since the last takeGlobalChangedIds() call. */
  private globalChangedIdsBuffer = new Set<SymbolId>();

  /** Monotonic version counter — bumped on every register/markDirty/remove. */
  private _version = 0;

  /** The current version — increments on any structural change. */
  get version(): number {
    return this._version;
  }

  private hooks: IndexerHook[];

  /** Cached unified index — invalidated when any file changes. */
  private unifiedCache: SymbolIndex | null = null;

  /** URIs that have changed since the last partial cache build. */
  private dirtyUris = new Set<string>();

  constructor(hooks: IndexerHook[]) {
    this.hooks = hooks;
  }

  /**
   * Register a file for lazy indexing.
   * The loader will be called only when the file's index is first requested.
   */
  register(uri: string, loader: () => CSTNode, parentFQN?: string): void {
    this.files.set(uri, { index: null, oldIndex: null, editRanges: null, idMap: null, loader, parentFQN, dirty: true });
    this.unifiedCache = null;
    this.dirtyUris.add(uri);
    this.skeletonCache = null;
    this._version++;
  }

  /**
   * Mark a file as dirty (will re-index on next access).
   * Optionally provide a new loader.
   */
  markDirty(uri: string, loader?: () => CSTNode, editRanges?: Array<{ startByte: number; endByte: number }>): void {
    const file = this.files.get(uri);
    if (file) {
      file.dirty = true;
      file.oldIndex = file.index; // Retain for incremental update
      file.editRanges = editRanges ?? null;
      file.index = null;
      if (loader) file.loader = loader;
      this.unifiedCache = null;
      this.dirtyUris.add(uri);
      this.skeletonCache = null;
      this._version++;
    }
  }

  /**
   * Remove a file from the workspace.
   */
  remove(uri: string): void {
    this.files.delete(uri);
    this.unifiedCache = null;
    this._version++;
    // Full rebuild needed — we must remove entries from the cached index
    this.partialCache = null;
    this.dirtyUris.clear();
    this.skeletonCache = null;
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

      const rootNode = file.loader();
      const indexer = new SymbolIndexer(this.hooks);

      // --- Incremental path: use SymbolIndexer.update() when we have an old index ---
      if (file.oldIndex && file.editRanges && file.idMap) {
        // Build a reverse map (global → local) so we can feed the old index
        // to the indexer in local ID space. The indexer's update() returns
        // local IDs, so we then re-map them back to global IDs.
        const reverseMap = new Map<SymbolId, SymbolId>();
        for (const [localId, globalId] of file.idMap) {
          reverseMap.set(globalId, localId);
        }

        // Convert old global index back to local ID space for the indexer
        const oldLocalSymbols = new Map<SymbolId, SymbolEntry>();
        const oldLocalByName = new Map<string, SymbolId[]>();
        const oldLocalChildrenOf = new Map<SymbolId | null, SymbolId[]>();

        for (const [globalId, entry] of file.oldIndex.symbols) {
          const localId = reverseMap.get(globalId) ?? globalId;
          const localParentId = entry.parentId !== null ? (reverseMap.get(entry.parentId) ?? entry.parentId) : null;
          oldLocalSymbols.set(localId, { ...entry, id: localId, parentId: localParentId });
        }
        for (const [name, ids] of file.oldIndex.byName) {
          oldLocalByName.set(
            name,
            ids.map((id) => reverseMap.get(id) ?? id),
          );
        }
        for (const [parentId, ids] of file.oldIndex.childrenOf) {
          const localParent = parentId !== null ? (reverseMap.get(parentId) ?? parentId) : null;
          oldLocalChildrenOf.set(
            localParent,
            ids.map((id) => reverseMap.get(id) ?? id),
          );
        }

        const oldLocalIndex: SymbolIndex = {
          symbols: oldLocalSymbols,
          byName: oldLocalByName,
          childrenOf: oldLocalChildrenOf,
        };

        // Compute total byte delta for position adjustment of post-edit entries
        let totalDelta = 0;
        // We don't have exact old vs new lengths, but the edit ranges give us
        // approximate bounds. The indexer handles imprecise deltas gracefully.

        const { index: rawIndex, changedIds: localChangedIds } = indexer.update(
          oldLocalIndex,
          rootNode,
          file.editRanges,
          totalDelta,
        );

        // Re-map to global IDs, reusing old global IDs for unchanged entries
        const idMap = new Map<SymbolId, SymbolId>();
        for (const localId of rawIndex.symbols.keys()) {
          // If this local ID existed in the old index, reuse its global ID
          const existingGlobal = file.idMap.get(localId);
          if (existingGlobal !== undefined) {
            idMap.set(localId, existingGlobal);
          } else {
            idMap.set(localId, globalIdCounter++);
          }
        }

        const symbols = new Map<SymbolId, SymbolEntry>();
        const byName = new Map<string, SymbolId[]>();

        for (const [localId, entry] of rawIndex.symbols) {
          const globalId = idMap.get(localId)!;
          const remapped: SymbolEntry = {
            ...entry,
            id: globalId,
            parentId: entry.parentId !== null ? (idMap.get(entry.parentId) ?? entry.parentId) : null,
            resourceId: uri,
          };
          symbols.set(globalId, remapped);
          const existing = byName.get(remapped.name);
          if (existing) existing.push(globalId);
          else byName.set(remapped.name, [globalId]);
        }

        const childrenOf = new Map<SymbolId | null, SymbolId[]>();
        for (const [parentId, childIds] of rawIndex.childrenOf) {
          const newParentId = parentId !== null ? (idMap.get(parentId) ?? parentId) : null;
          const newChildIds = childIds.map((cid) => idMap.get(cid) ?? cid);
          childrenOf.set(newParentId, newChildIds);
        }

        file.index = { symbols, byName, childrenOf };
        file.idMap = idMap;

        // Map changed local IDs to global IDs
        const globalChangedIds = new Set<SymbolId>();
        for (const localId of localChangedIds) {
          const gid = idMap.get(localId) ?? file.idMap.get(localId);
          if (gid !== undefined) {
            globalChangedIds.add(gid);
            this.globalChangedIdsBuffer.add(gid);
          }
        }
        this.lastChangedIds.set(uri, globalChangedIds);

        file.dirty = false;
        file.oldIndex = null;
        file.editRanges = null;

        this.dirtyUris.add(uri);
        this.unifiedCache = null;
        this.skeletonCache = null;
        this._version++;

        return file.index;
      }

      // --- Full index path: new file or no old index available ---
      const rawIndex = indexer.index(rootNode);

      // Re-map IDs to be globally unique
      const idMap = new Map<SymbolId, SymbolId>();
      for (const id of rawIndex.symbols.keys()) {
        const globalId = globalIdCounter++;
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
      file.idMap = idMap;
      file.dirty = false;
      file.oldIndex = null;
      file.editRanges = null;

      // Mark all symbols as changed for full-index case
      const allFileSymbolIds = new Set(symbols.keys());
      this.lastChangedIds.set(uri, allFileSymbolIds);
      for (const id of allFileSymbolIds) {
        this.globalChangedIdsBuffer.add(id);
      }

      // Invalidate caches so toUnifiedPartial() / toTreeIndex() pick up the new entries.
      // Adding to dirtyUris triggers the incremental merge path in toUnifiedPartial().
      this.dirtyUris.add(uri);
      this.unifiedCache = null;
      this.skeletonCache = null;
      this._version++;
    }

    return file.index;
  }

  /**
   * Get the set of globally-unique symbol IDs that changed in the last
   * indexing pass for a given file. Returns null if the file hasn't been
   * indexed or was fully re-indexed (in which case all symbols changed).
   */
  getChangedIds(uri: string): Set<SymbolId> | null {
    return this.lastChangedIds.get(uri) ?? null;
  }

  /**
   * Retrieve and clear the aggregated set of globally-unique symbol IDs
   * that have changed across the workspace since this method was last called.
   */
  takeGlobalChangedIds(): Set<SymbolId> {
    const ids = new Set(this.globalChangedIdsBuffer);
    this.globalChangedIdsBuffer.clear();
    return ids;
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

  /**
   * Build a unified index from ONLY already-parsed files.
   * Does NOT trigger any lazy loaders — skips files whose index is null.
   * This is O(already-parsed files), not O(all files).
   *
   * Use this for initial document validation to avoid blocking on full MSL parsing.
   * The result is NOT cached as unifiedCache (since it's partial).
   */
  toUnifiedPartial(): SymbolIndex {
    if (this.unifiedCache) return this.unifiedCache;

    // Fast path: if we have a cached partial index and only specific files changed,
    // incrementally patch the cache instead of rebuilding from scratch.
    if (this.partialCache && this.dirtyUris.size > 0) {
      const { symbols, byName, childrenOf } = this.partialCache;
      const symbolsByResource = this.partialCache.symbolsByResource ?? new Map<string, SymbolId[]>();

      for (const dirtyUri of this.dirtyUris) {
        // 1. Remove old entries for this file from the cache
        const oldResourceIds = symbolsByResource.get(dirtyUri);
        const toRemove = oldResourceIds ? [...oldResourceIds] : [];
        symbolsByResource.delete(dirtyUri);
        for (const id of toRemove) {
          const entry = symbols.get(id)!;
          symbols.delete(id);

          // Remove from byName
          const nameIds = byName.get(entry.name);
          if (nameIds) {
            const idx = nameIds.indexOf(id);
            if (idx !== -1) nameIds.splice(idx, 1);
            if (nameIds.length === 0) byName.delete(entry.name);
          }

          // Remove from childrenOf
          const parentChildren = childrenOf.get(entry.parentId);
          if (parentChildren) {
            const idx = parentChildren.indexOf(id);
            if (idx !== -1) parentChildren.splice(idx, 1);
            if (parentChildren.length === 0) childrenOf.delete(entry.parentId);
          }
        }

        // 2. Merge new entries for this file
        const file = this.files.get(dirtyUri);
        if (!file || !file.index) continue;

        for (const [id, entry] of file.index.symbols) {
          symbols.set(id, entry);
        }
        for (const [name, ids] of file.index.byName) {
          const existing = byName.get(name);
          if (existing) existing.push(...ids);
          else byName.set(name, [...ids]);
        }
        for (const [parentId, ids] of file.index.childrenOf) {
          const existing = childrenOf.get(parentId);
          if (existing) {
            for (const cid of ids) {
              if (!existing.includes(cid)) existing.push(cid);
            }
          } else {
            childrenOf.set(parentId, [...ids]);
          }
        }

        // Update symbolsByResource
        const newResourceIds: SymbolId[] = [];
        for (const id of file.index.symbols.keys()) {
          newResourceIds.push(id);
        }
        if (newResourceIds.length > 0) {
          symbolsByResource.set(dirtyUri, newResourceIds);
        }
      }

      this.partialCache.symbolsByResource = symbolsByResource;

      this.stitchParentFQNs(symbols, byName, childrenOf);
      this.dirtyUris.clear();
      return this.partialCache;
    }

    // No cache at all — full rebuild
    if (this.partialCache) return this.partialCache;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    for (const [_uri, file] of this.files) {
      if (!file.index) continue; // Skip unindexed files — no parsing triggered

      for (const [id, entry] of file.index.symbols) {
        symbols.set(id, entry);
      }

      for (const [name, ids] of file.index.byName) {
        const existing = byName.get(name);
        if (existing) existing.push(...ids);
        else byName.set(name, [...ids]);
      }

      for (const [parentId, ids] of file.index.childrenOf) {
        const existing = childrenOf.get(parentId);
        if (existing) {
          for (const cid of ids) {
            if (!existing.includes(cid)) existing.push(cid);
          }
        } else {
          childrenOf.set(parentId, [...ids]);
        }
      }
    }

    this.stitchParentFQNs(symbols, byName, childrenOf);
    this.dirtyUris.clear();

    // Build symbolsByResource for per-file iteration
    const symbolsByResource = new Map<string, SymbolId[]>();
    for (const [id, entry] of symbols) {
      if (entry.resourceId) {
        const ids = symbolsByResource.get(entry.resourceId);
        if (ids) ids.push(id);
        else symbolsByResource.set(entry.resourceId, [id]);
      }
    }

    this.partialCache = { symbols, byName, childrenOf, symbolsByResource };
    return this.partialCache;
  }

  /**
   * Count of files not yet indexed (lazy loaders not yet invoked).
   */
  get pendingFileCount(): number {
    let count = 0;
    for (const file of this.files.values()) {
      if (!file.index) count++;
    }
    return count;
  }

  /**
   * Progressively index remaining files in the background.
   * Yields to the event loop every `batchSize` files.
   * Calls `onProgress` with (indexed, total) periodically.
   * When complete, sets the unified cache.
   */
  async indexRemainingInBackground(
    batchSize = 20,
    onProgress?: (indexed: number, total: number) => void,
  ): Promise<void> {
    const urisToIndex: string[] = [];
    for (const [uri, file] of this.files) {
      if (!file.index && file.loader) urisToIndex.push(uri);
    }

    if (urisToIndex.length === 0) return;

    const total = urisToIndex.length;
    let indexed = 0;

    for (const uri of urisToIndex) {
      this.getFileIndex(uri); // Triggers lazy parsing
      indexed++;

      if (indexed % batchSize === 0) {
        onProgress?.(indexed, total);
        await new Promise((r) => setTimeout(r, 0)); // Yield
      }
    }

    onProgress?.(total, total);

    // Now build the full unified cache
    this.unifiedCache = null; // Force rebuild
    this.toUnified();
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

  /** Gets the URI of the file that defines the given fully qualified class name. */
  getFileUriForFQN(targetFqn: string): string | null {
    for (const [uri, file] of this.files) {
      const path = uri.startsWith("file://") ? uri.substring(7) : uri;
      const segments = path.split("/");
      const fileName = segments[segments.length - 1];

      let name: string;
      if (fileName === "package.mo") {
        const dirName = segments[segments.length - 2] ?? "";
        name = dirName.split(" ")[0];
      } else if (fileName.endsWith(".mo")) {
        name = fileName.slice(0, -3);
      } else {
        continue;
      }

      const fqn = file.parentFQN ? `${file.parentFQN}.${name}` : name;
      if (fqn === targetFqn) return uri;
    }
    return null;
  }

  /**
   * Get a lightweight tree index without parsing any files.
   * Returns the cached unified index if available (already built by document processing),
   * otherwise builds a skeleton from file registration metadata (URI paths + parentFQNs).
   *
   * This is designed for the library tree view, which only needs class names,
   * parent-child relationships, and approximate class kinds.
   */
  toTreeIndex(): SymbolIndex {
    if (this.unifiedCache) return this.unifiedCache;
    return this.toTreeSkeleton();
  }

  /** Cached partial index — invalidated alongside unifiedCache. */
  private partialCache: SymbolIndex | null = null;

  /** Cached skeleton index — invalidated alongside unifiedCache. */
  private skeletonCache: SymbolIndex | null = null;

  /**
   * Build a lightweight SymbolIndex from file registration metadata only.
   * Infers class names from URIs and hierarchy from parentFQNs.
   * Does NOT call any file loaders or trigger parsing.
   *
   * Entries have:
   * - kind: "Class"
   * - name: from URI filename or directory name
   * - metadata.classPrefixes: "package" for package.mo, "" otherwise
   * - parentId: resolved from parentFQN
   */
  private toTreeSkeleton(): SymbolIndex {
    if (this.skeletonCache) return this.skeletonCache;

    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    let nextId: SymbolId = 1;
    // FQN → SymbolId for parent resolution
    const fqnToId = new Map<string, SymbolId>();

    // First pass: create entries from registered files
    const pendingEntries: Array<{
      id: SymbolId;
      name: string;
      parentFQN: string;
      isPackage: boolean;
      uri: string;
    }> = [];

    for (const [uri, file] of this.files) {
      // Infer class name from URI
      const path = uri.startsWith("file://") ? uri.substring(7) : uri;
      const segments = path.split("/");
      const fileName = segments[segments.length - 1];

      let name: string;
      let isPackage = false;

      if (fileName === "package.mo") {
        // Package: name is the directory containing package.mo
        const dirName = segments[segments.length - 2] ?? "";
        // Strip version string if present (e.g. "Modelica 4.1.0" → "Modelica")
        name = dirName.split(" ")[0];
        isPackage = true;
      } else if (fileName.endsWith(".mo")) {
        name = fileName.slice(0, -3); // Strip .mo
      } else {
        continue; // Skip non-Modelica files
      }

      if (!name) continue;

      const id = nextId++;
      const parentFQN = file.parentFQN ?? "";
      const fqn = parentFQN ? `${parentFQN}.${name}` : name;

      fqnToId.set(fqn, id);
      pendingEntries.push({ id, name, parentFQN, isPackage, uri });
    }

    // Second pass: resolve parents and build the index
    for (const { id, name, parentFQN, isPackage, uri } of pendingEntries) {
      const parentId = parentFQN ? (fqnToId.get(parentFQN) ?? null) : null;

      const entry: SymbolEntry = {
        id,
        kind: "Class",
        name,
        ruleName: "ClassDefinition",
        namePath: "classSpecifier.identifier",
        startByte: 0,
        endByte: 0,
        parentId,
        exports: [],
        inherits: [],
        metadata: { classPrefixes: isPackage ? "package" : "" },
        fieldName: null,
        resourceId: uri,
      };

      symbols.set(id, entry);

      const existing = byName.get(name);
      if (existing) existing.push(id);
      else byName.set(name, [id]);

      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(id);
      else childrenOf.set(parentId, [id]);
    }

    this.skeletonCache = { symbols, byName, childrenOf };
    return this.skeletonCache;
  }

  /**
   * Merges multiple SymbolIndex structures into one without mutating the inputs.
   * Useful for combining a global workspace index with a local one.
   */
  static mergePartialIndexes(...indexes: SymbolIndex[]): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    for (const index of indexes) {
      if (!index) continue;

      for (const [id, entry] of index.symbols) {
        symbols.set(id, entry);
      }

      for (const [name, ids] of index.byName) {
        const existing = byName.get(name);
        if (existing) {
          existing.push(...ids);
        } else {
          byName.set(name, [...ids]);
        }
      }

      for (const [parentId, ids] of index.childrenOf) {
        const existing = childrenOf.get(parentId);
        if (existing) {
          existing.push(...ids);
        } else {
          childrenOf.set(parentId, [...ids]);
        }
      }
    }

    return { symbols, byName, childrenOf };
  }
}
