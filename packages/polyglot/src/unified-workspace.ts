import { AdapterRegistry } from "./adapter-registry.js";
import { SymbolEntry, SymbolIndex } from "./runtime.js";

export interface IWorkspaceIndex {
  version: number;
  toUnified(): SymbolIndex;
  toUnifiedAsync(): Promise<SymbolIndex>;
  toUnifiedPartial(): SymbolIndex;
  toTreeIndex(): SymbolIndex;
}

/**
 * Manages multiple language-specific WorkspaceIndex instances and merges them
 * into a single unified SymbolIndex for polyglot authoring.
 */
export class UnifiedWorkspace {
  private indices = new Map<string, IWorkspaceIndex>();
  public adapterRegistry: AdapterRegistry;

  /** Cached result of toUnifiedPartial() — reused when underlying partials haven't changed. */
  private partialCache: SymbolIndex | null = null;
  /** Version numbers of each workspace at the time the cache was built. */
  private partialCacheVersions = new Map<string, number>();
  /** Symbol IDs belonging to each language in the partial cache — for incremental patching. */
  private partialCacheSymbolsByLang = new Map<string, number[]>();

  constructor() {
    this.adapterRegistry = new AdapterRegistry();
  }

  /**
   * Registers a language-specific WorkspaceIndex.
   * @param language The language identifier (e.g., "modelica", "sysml2")
   * @param index The WorkspaceIndex for that language
   * @param config The exported language configuration (from language.ts) to register adapters
   */
  registerWorkspace(language: string, index: IWorkspaceIndex, config: unknown): void {
    this.indices.set(language, index);

    // Create an empty, dummy SymbolIndex to pass to the adapter registry, since the
    // AdapterRegistry expects a SymbolIndex there, but we will pass the unified index
    // when we run `project()`. Actually, wait — `AdapterRegistry` takes `index: SymbolIndex`
    // but uses it for standard queries inside the `project()` DB.
    // We should pass a proxy or a placeholder, and handle the real lookups via `toUnified()`.
    this.adapterRegistry.registerLanguage(config, {
      symbols: new Map(),
      byName: new Map(),
      childrenOf: new Map(),
    });
  }

  /**
   * Gets a specific language workspace index.
   */
  getWorkspace(language: string): IWorkspaceIndex | undefined {
    return this.indices.get(language);
  }

  /**
   * Merges all registered language workspace indices into a single unified SymbolIndex.
   * This forces parsing of all files in all workspaces.
   */
  toUnified(): SymbolIndex {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    for (const [language, workspace] of this.indices.entries()) {
      const index = workspace.toUnified();

      for (const [id, entry] of index.symbols) {
        // Tag each symbol with its originated language
        const sys: SymbolEntry = { ...entry, language };
        symbols.set(id, sys);
      }

      for (const [name, ids] of index.byName) {
        const existing = byName.get(name);
        if (existing) existing.push(...ids);
        else byName.set(name, [...ids]);
      }

      for (const [parentId, ids] of index.childrenOf) {
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

    return { symbols, byName, childrenOf };
  }

  /**
   * Merges all registered language workspace indices asynchronously into a single unified SymbolIndex.
   */
  async toUnifiedAsync(): Promise<SymbolIndex> {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    for (const [language, workspace] of this.indices.entries()) {
      const index = await workspace.toUnifiedAsync();

      for (const [id, entry] of index.symbols) {
        const sys: SymbolEntry = { ...entry, language };
        symbols.set(id, sys);
      }

      for (const [name, ids] of index.byName) {
        const existing = byName.get(name);
        if (existing) existing.push(...ids);
        else byName.set(name, [...ids]);
      }

      for (const [parentId, ids] of index.childrenOf) {
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

    return { symbols, byName, childrenOf };
  }

  /**
   * Builds a unified index from only already-parsed files, without triggering lazy loaders.
   * Caches the result and reuses it when the underlying workspace partials haven't changed.
   */
  toUnifiedPartial(): SymbolIndex {
    // Determine which workspaces actually changed
    const changedWorkspaces: string[] = [];
    for (const [language, workspace] of this.indices.entries()) {
      if (workspace.version !== this.partialCacheVersions.get(language)) {
        changedWorkspaces.push(language);
      }
    }

    // Fast path: nothing changed anywhere
    if (changedWorkspaces.length === 0 && this.partialCache) {
      return this.partialCache;
    }

    // Incremental path: patch existing cache for only the changed workspaces.
    // This avoids iterating over symbols from unchanged workspaces (e.g., SysML2
    // symbols don't need to be re-merged when only a Modelica file changed).
    if (this.partialCache && changedWorkspaces.length < this.indices.size) {
      const { symbols, byName, childrenOf, symbolsByResource } = this.partialCache;
      // If symbolsByResource is missing from an older cache, initialize it
      const actualSymbolsByResource = symbolsByResource || new Map<string, number[]>();

      for (const language of changedWorkspaces) {
        const workspace = this.indices.get(language);
        if (!workspace) continue;

        // 1. Remove old entries for this workspace from the merged cache
        const oldIds = this.partialCacheSymbolsByLang.get(language);
        if (oldIds) {
          for (const id of oldIds) {
            const entry = symbols.get(id);
            if (entry) {
              symbols.delete(id);
              // Clean up byName
              const nameIds = byName.get(entry.name);
              if (nameIds) {
                const idx = nameIds.indexOf(id);
                if (idx !== -1) nameIds.splice(idx, 1);
                if (nameIds.length === 0) byName.delete(entry.name);
              }
              // Clean up childrenOf (as a child of its parent)
              const parentChildren = childrenOf.get(entry.parentId);
              if (parentChildren) {
                const idx = parentChildren.indexOf(id);
                if (idx !== -1) parentChildren.splice(idx, 1);
                if (parentChildren.length === 0) childrenOf.delete(entry.parentId);
              }
              // Remove its own children array
              childrenOf.delete(id);
              // Clean up symbolsByResource
              if (entry.resourceId) {
                const resourceIds = actualSymbolsByResource.get(entry.resourceId);
                if (resourceIds) {
                  const idx = resourceIds.indexOf(id);
                  if (idx !== -1) resourceIds.splice(idx, 1);
                  if (resourceIds.length === 0) actualSymbolsByResource.delete(entry.resourceId);
                }
              }
            }
          }
        }

        // 2. Merge new entries for this workspace
        const index = workspace.toUnifiedPartial();
        this.partialCacheVersions.set(language, workspace.version);

        const newIds: number[] = [];
        for (const [id, entry] of index.symbols) {
          const sys: SymbolEntry = { ...entry, language };
          symbols.set(id, sys);
          newIds.push(id);
        }
        this.partialCacheSymbolsByLang.set(language, newIds);

        for (const [name, ids] of index.byName) {
          const existing = byName.get(name);
          if (existing) existing.push(...ids);
          else byName.set(name, [...ids]);
        }

        for (const [parentId, ids] of index.childrenOf) {
          const existing = childrenOf.get(parentId);
          if (existing) {
            for (const cid of ids) {
              if (!existing.includes(cid)) existing.push(cid);
            }
          } else {
            childrenOf.set(parentId, [...ids]);
          }
        }

        if (index.symbolsByResource) {
          for (const [resId, ids] of index.symbolsByResource) {
            const existing = actualSymbolsByResource.get(resId);
            if (existing) {
              for (const cid of ids) {
                if (!existing.includes(cid)) existing.push(cid);
              }
            } else {
              actualSymbolsByResource.set(resId, [...ids]);
            }
          }
        }
      }

      this.partialCache.symbolsByResource = actualSymbolsByResource;
      return this.partialCache;
    }

    // Full rebuild: no cache or all workspaces changed
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();
    const symbolsByResource = new Map<string, number[]>();

    for (const [language, workspace] of this.indices.entries()) {
      const index = workspace.toUnifiedPartial();
      this.partialCacheVersions.set(language, workspace.version);

      const langIds: number[] = [];
      for (const [id, entry] of index.symbols) {
        const sys: SymbolEntry = { ...entry, language };
        symbols.set(id, sys);
        langIds.push(id);
      }
      this.partialCacheSymbolsByLang.set(language, langIds);

      for (const [name, ids] of index.byName) {
        const existing = byName.get(name);
        if (existing) existing.push(...ids);
        else byName.set(name, [...ids]);
      }

      for (const [parentId, ids] of index.childrenOf) {
        const existing = childrenOf.get(parentId);
        if (existing) {
          for (const cid of ids) {
            if (!existing.includes(cid)) existing.push(cid);
          }
        } else {
          childrenOf.set(parentId, [...ids]);
        }
      }

      if (index.symbolsByResource) {
        for (const [resId, ids] of index.symbolsByResource) {
          const existing = symbolsByResource.get(resId);
          if (existing) existing.push(...ids);
          else symbolsByResource.set(resId, [...ids]);
        }
      }
    }

    this.partialCache = { symbols, byName, childrenOf, symbolsByResource };
    return this.partialCache;
  }

  /**
   * Builds a combined lightweight skeleton index without parsing any files.
   */
  toTreeIndex(): SymbolIndex {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    for (const [language, workspace] of this.indices.entries()) {
      const index = workspace.toTreeIndex();

      for (const [id, entry] of index.symbols) {
        const sys: SymbolEntry = { ...entry, language };
        symbols.set(id, sys);
      }

      for (const [name, ids] of index.byName) {
        const existing = byName.get(name);
        if (existing) existing.push(...ids);
        else byName.set(name, [...ids]);
      }

      for (const [parentId, ids] of index.childrenOf) {
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

    return { symbols, byName, childrenOf };
  }
}
