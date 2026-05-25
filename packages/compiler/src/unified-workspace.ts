import { AdapterRegistry } from "./adapter-registry.js";
import type { OWL2AxiomDelta } from "./owl2-axioms.js";
import { OWL2OntologyStore } from "./owl2-ontology-store.js";
import type { SymbolEntry, SymbolIndex } from "./runtime.js";

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

  /** OWL2 ontology store — incrementally maintained from all source language projections. */
  public owl2Store: OWL2OntologyStore;

  /** Cached result of toUnifiedPartial() — reused when underlying partials haven't changed. */
  private partialCache: SymbolIndex | null = null;
  /** Version numbers of each workspace at the time the cache was built. */
  private partialCacheVersions = new Map<string, number>();
  /** Symbol IDs belonging to each language in the partial cache — for incremental patching. */
  private partialCacheSymbolsByLang = new Map<string, number[]>();

  constructor() {
    this.adapterRegistry = new AdapterRegistry();
    this.owl2Store = new OWL2OntologyStore(this.adapterRegistry);
  }

  /**
   * Registers a language-specific WorkspaceIndex.
   * @param language The language identifier (e.g., "modelica", "sysml2")
   * @param index The WorkspaceIndex for that language
   * @param config The exported language configuration (from language.ts) to register adapters
   */
  registerWorkspace(language: string, index: IWorkspaceIndex, config: unknown): void {
    this.indices.set(language, index);

    const indexProxy = new Proxy({} as SymbolIndex, {
      get: (target, prop) => {
        const liveIndex = index.toUnifiedPartial();
        return Reflect.get(liveIndex, prop);
      },
    });
    this.adapterRegistry.registerLanguage(config, indexProxy);

    // Register as an OWL2 source language (all languages can project into OWL2)
    if (language !== "owl2") {
      this.owl2Store.registerSourceLanguage(language);
    }
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

    // Inject synthetic entries for projected OWL2 axioms
    // This enables cross-language IRI resolution in OWL2 lint queries
    this.mergeOWL2Synthetics(symbols, byName, childrenOf);

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

    // Inject synthetic entries for projected OWL2 axioms
    this.mergeOWL2Synthetics(symbols, byName, childrenOf);

    return { symbols, byName, childrenOf };
  }

  /**
   * Builds a unified index from only already-parsed files, without triggering lazy loaders.
   * Caches the result and reuses it when the underlying workspace partials haven't changed.
   */
  toUnifiedPartial(): SymbolIndex {
    const modelicaWs = this.indices.get("modelica");
    if (!modelicaWs) return this.toUnified(); // Fallback if no modelica workspace

    const baseIndex = modelicaWs.toUnifiedPartial();
    const baseChanged = this.partialCache !== baseIndex;
    this.partialCacheVersions.set("modelica", modelicaWs.version);

    const changedOtherLangs: string[] = [];
    for (const [language, workspace] of this.indices.entries()) {
      if (language === "modelica") continue;
      if (workspace.version !== this.partialCacheVersions.get(language)) {
        changedOtherLangs.push(language);
        this.partialCacheVersions.set(language, workspace.version);
      }
    }

    if (!baseChanged && changedOtherLangs.length === 0) {
      return baseIndex;
    }

    if (!baseIndex.symbolsByResource) {
      baseIndex.symbolsByResource = new Map<string, number[]>();
    }

    if (baseChanged) {
      // Base index was fully rebuilt, need to re-inject everything
      this.partialCacheSymbolsByLang.clear();
      for (const [language, workspace] of this.indices.entries()) {
        if (language === "modelica") continue;
        this._injectLanguageIntoBase(language, workspace, baseIndex);
      }
    } else {
      // Base index was incrementally updated, only re-inject changed languages
      for (const language of changedOtherLangs) {
        const workspace = this.indices.get(language);
        if (!workspace) continue;
        this._removeLanguageFromBase(language, baseIndex);
        this._injectLanguageIntoBase(language, workspace, baseIndex);
      }
    }

    this.mergeOWL2Synthetics(baseIndex.symbols, baseIndex.byName, baseIndex.childrenOf);
    this.partialCache = baseIndex;
    return baseIndex;
  }

  private _removeLanguageFromBase(language: string, baseIndex: SymbolIndex) {
    const oldIds = this.partialCacheSymbolsByLang.get(language);
    if (!oldIds) return;

    for (const id of oldIds) {
      const entry = baseIndex.symbols.get(id);
      if (!entry) continue;
      baseIndex.symbols.delete(id);

      const nameIds = baseIndex.byName.get(entry.name);
      if (nameIds) {
        const idx = nameIds.indexOf(id);
        if (idx !== -1) nameIds.splice(idx, 1);
        if (nameIds.length === 0) baseIndex.byName.delete(entry.name);
      }

      const parentChildren = baseIndex.childrenOf.get(entry.parentId);
      if (parentChildren) {
        const idx = parentChildren.indexOf(id);
        if (idx !== -1) parentChildren.splice(idx, 1);
        if (parentChildren.length === 0) baseIndex.childrenOf.delete(entry.parentId);
      }
      baseIndex.childrenOf.delete(id);

      if (entry.resourceId && baseIndex.symbolsByResource) {
        const resourceIds = baseIndex.symbolsByResource.get(entry.resourceId);
        if (resourceIds) {
          const idx = resourceIds.indexOf(id);
          if (idx !== -1) resourceIds.splice(idx, 1);
          if (resourceIds.length === 0) baseIndex.symbolsByResource.delete(entry.resourceId);
        }
      }
    }
    this.partialCacheSymbolsByLang.delete(language);
  }

  private _injectLanguageIntoBase(language: string, workspace: IWorkspaceIndex, baseIndex: SymbolIndex) {
    const index = workspace.toUnifiedPartial();
    const injectedIds: number[] = [];

    for (const [id, entry] of index.symbols) {
      baseIndex.symbols.set(id, { ...entry, language });
      injectedIds.push(id);
    }
    this.partialCacheSymbolsByLang.set(language, injectedIds);

    for (const [name, ids] of index.byName) {
      const existing = baseIndex.byName.get(name);
      if (existing) {
        for (const i of ids) if (!existing.includes(i)) existing.push(i);
      } else {
        baseIndex.byName.set(name, [...ids]);
      }
    }
    for (const [parentId, ids] of index.childrenOf) {
      const existing = baseIndex.childrenOf.get(parentId);
      if (existing) {
        for (const i of ids) if (!existing.includes(i)) existing.push(i);
      } else {
        baseIndex.childrenOf.set(parentId, [...ids]);
      }
    }
    if (index.symbolsByResource && baseIndex.symbolsByResource) {
      for (const [resId, ids] of index.symbolsByResource) {
        const existing = baseIndex.symbolsByResource.get(resId);
        if (existing) {
          for (const i of ids) if (!existing.includes(i)) existing.push(i);
        } else {
          baseIndex.symbolsByResource.set(resId, [...ids]);
        }
      }
    }
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

  // =========================================================================
  // OWL2 Ontology Projection
  // =========================================================================

  /**
   * Incrementally update the OWL2 ontology store.
   * Checks which workspaces changed and re-projects only those.
   *
   * @returns The incremental delta, or null if nothing changed.
   */
  updateOntology(): OWL2AxiomDelta | null {
    const versions = new Map<string, number>();
    for (const [language, workspace] of this.indices.entries()) {
      versions.set(language, workspace.version);
    }
    return this.owl2Store.update(versions);
  }

  /**
   * Perform a full OWL2 ontology projection from all source languages.
   * Use this for initial workspace setup or after major structural changes.
   */
  fullOntologyProjection(): void {
    this.owl2Store.fullProjection();
  }

  // =========================================================================
  // Private — OWL2 Synthetic Entry Injection
  // =========================================================================

  /**
   * Merge synthetic SymbolEntry objects from the OWL2 ontology store into
   * the unified symbol index. This enables cross-language IRI resolution:
   * when an OWL2 file references `mo:Motor` and Motor only exists in a
   * Modelica file, the projected ClassDeclaration axiom produces a synthetic
   * entry with `{ kind: "Class", name: "mo:Motor" }` that the lint query
   * can find via `db.byName("mo:Motor")`.
   */
  private mergeOWL2Synthetics(
    symbols: Map<number, SymbolEntry>,
    byName: Map<string, number[]>,
    childrenOf: Map<number | null, number[]>,
  ): void {
    if (this.owl2Store.size === 0) return;

    const synthetics = this.owl2Store.toSyntheticSymbolEntries();

    for (const [id, entry] of synthetics.symbols) {
      // Skip if a real entry with this name and kind already exists
      // (avoids duplicates when an OWL2 file also declares the same class)
      const existingIds = byName.get(entry.name);
      if (existingIds) {
        const alreadyExists = existingIds.some((eid) => {
          const existing = symbols.get(eid);
          return existing && existing.kind === entry.kind;
        });
        if (alreadyExists) continue;
      }

      symbols.set(id, entry);
      const nameIds = byName.get(entry.name);
      if (nameIds) {
        nameIds.push(id);
      } else {
        byName.set(entry.name, [id]);
      }
    }

    for (const [parentId, ids] of synthetics.childrenOf) {
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
}
