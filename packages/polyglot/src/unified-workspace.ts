import { AdapterRegistry } from "./adapter-registry.js";
import { SymbolEntry, SymbolIndex } from "./runtime.js";
import { WorkspaceIndex } from "./workspace-index.js";

/**
 * Manages multiple language-specific WorkspaceIndex instances and merges them
 * into a single unified SymbolIndex for polyglot authoring.
 */
export class UnifiedWorkspace {
  private indices = new Map<string, WorkspaceIndex>();
  public adapterRegistry: AdapterRegistry;

  constructor() {
    this.adapterRegistry = new AdapterRegistry();
  }

  /**
   * Registers a language-specific WorkspaceIndex.
   * @param language The language identifier (e.g., "modelica", "sysml2")
   * @param index The WorkspaceIndex for that language
   * @param config The exported language configuration (from language.ts) to register adapters
   */
  registerWorkspace(language: string, index: WorkspaceIndex, config: unknown): void {
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
  getWorkspace(language: string): WorkspaceIndex | undefined {
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
   */
  toUnifiedPartial(): SymbolIndex {
    const symbols = new Map<number, SymbolEntry>();
    const byName = new Map<string, number[]>();
    const childrenOf = new Map<number | null, number[]>();

    for (const [language, workspace] of this.indices.entries()) {
      const index = workspace.toUnifiedPartial();

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
