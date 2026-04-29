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
    // Fast path: check if any underlying workspace has changed
    // by comparing version numbers. WorkspaceIndex.version increments
    // on every register/markDirty/remove.
    if (this.partialCache) {
      let allSame = true;
      for (const [language, workspace] of this.indices.entries()) {
        if (workspace.version !== this.partialCacheVersions.get(language)) {
          allSame = false;
          break;
        }
      }
      if (allSame) return this.partialCache;
    }

    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    for (const [language, workspace] of this.indices.entries()) {
      const index = workspace.toUnifiedPartial();
      this.partialCacheVersions.set(language, workspace.version);

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

    this.partialCache = { symbols, byName, childrenOf };
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
