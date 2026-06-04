/**
 * The database facade passed to adapter `transform` functions.
 * Provides cross-language projection utilities alongside the
 * standard symbol-index navigation helpers.
 */
export interface AdapterDB {
  /** Get a symbol entry by ID (real or virtual). */
  symbol(id: SymbolId): SymbolEntry | undefined;
  /** Get all direct children of a symbol. */
  childrenOf(id: SymbolId): SymbolEntry[];
  /**
   * Look up all symbols with a given name across all registered indices.
   * Enables type resolution and cross-referencing during projection.
   */
  byName(name: string): SymbolEntry[];
  /**
   * Recursively project a foreign SymbolEntry into the given target language.
   * Walks registered adapters (C → B → A priority) to find a matching transform.
   * Returns a property bag ready to pass into the target's AST class constructors,
   * or `null` if no adapter matched.
   *
   * This is the main primitive for recursive cross-language AST walking:
   *   modelica → sysml2:  db.project(foreignModelicaClass, "sysml2")
   *   sysml2  → modelica: db.project(foreignSysmlBlock, "modelica")
   */
  project(foreignEntry: SymbolEntry, targetLang: string): Record<string, unknown> | null;
  /** Retrieve the CST node for a symbol (if available). */
  cstNode(id: SymbolId): unknown | null;
  /** Retrieve CST source text for a byte range. */
  cstText(startByte: number, endByte: number, entry: SymbolEntry): string | null;
  /** Execute a named query on a symbol (e.g. 'instantiate', 'variability') */
  query<T>(queryName: string, id: SymbolId): T | null;
}

/**
 * Node-level cross-language adapter (Approaches A and B).
 * Placed inside a `def()` call under `adapters[languageName]`.
 *
 * **Approach A (source-side export):**
 * This node declares how it should appear when viewed by another language.
 *   adapters: {
 *     sysml2: {
 *       target: "BlockDefinition",
 *       transform: (db, self) => ({ name: self.name, parts: [...] })
 *     }
 *   }
 *
 * **Approach B (target-side import):**
 * This node declares which foreign nodes it can absorb and how.
 *   adapters: {
 *     sysml2: {
 *       accepts: ["BlockDefinition"],
 *       transform: (db, foreign) => ({ name: foreign.name, ... })
 *     }
 *   }
 */
export interface NodeAdapter {
  /**
   * Approach A — the className this node projects INTO in the target language.
   * Must match the `ast.className` of a rule in the target language.
   */
  target?: string;

  /**
   * Approach B — which foreign node classNames this node can accept.
   * Each string must match the `ast.className` of a rule from the foreign language.
   */
  accepts?: string[];

  /**
   * The projection function.
   * - Approach A: `self` is a SelfAccessor proxy over this node's own fields.
   * - Approach B: `self` is the raw foreign SymbolEntry being imported.
   * Returns a plain property bag consumed by the adapter registry.
   */
  transform?: (db: AdapterDB, self: Record<string, unknown> | SymbolEntry) => Record<string, unknown>;
}

/**
 * Top-level language-wide adapter registry (Approach C).
 * Lives at the root of `language({})` under the `adapters` key.
 *
 * Shape:
 *   adapters: {
 *     sysml2: {
 *       BlockDefinition: (db, foreignNode) => ({ target: "ClassDefinition", props: {...} })
 *     }
 *   }
 *
 * Priority: C > B > A (global registry is the most intentional override).
 */
export type GlobalAdapters = Record<
  string, // foreign language name (e.g. "sysml2", "modelica")
  Record<
    string, // foreign node className matching ast.className
    (
      db: AdapterDB,
      foreignNode: SymbolEntry,
    ) => {
      /** Local className to project into (must match a local ast.className). */
      target: string;
      /** Property bag for the projected synthetic node. */
      props: Record<string, unknown>;
    }
  >
>;

/* eslint-disable */
/**
 * adapter-registry.ts
 *
 * Runtime registry for polyglot cross-language projection.
 * Collects Approach A, B, and C adapters from one or more language configs
 * and exposes a unified `project()` method that resolves the correct
 * transform following the priority: C > B > A.
 *
 * **Priority rationale:**
 *   C (global registry) — declared at the language level, most intentional override
 *   B (target-side import) — consuming language says "I know how to read foreign X"
 *   A (source-side export) — source language says "here is how I look to others"
 */

import type { SymbolEntry, SymbolId, SymbolIndex } from "./runtime.js";

// ---------------------------------------------------------------------------
// Extracted adapter shapes (normalised from language configs)
// ---------------------------------------------------------------------------

/** Approach A — a source-language node declaring how it looks in a target language. */
interface ApproachAEntry {
  kind: "A";
  /** Source language name (e.g. "modelica") */
  sourceLang: string;
  /** Source rule name (e.g. "class_definition") */
  sourceRule: string;
  /** Target language name (e.g. "sysml2") */
  targetLang: string;
  /** Target className (e.g. "BlockDefinition") */
  targetClass: string;
  transform: (db: AdapterDB, self: SymbolEntry) => Record<string, unknown>;
}

/** Approach B — a target-language node declaring which foreign classNames it accepts. */
interface ApproachBEntry {
  kind: "B";
  /** Target language name */
  targetLang: string;
  /** Target rule name */
  targetRule: string;
  /** Target className */
  targetClass: string;
  /** Foreign language name */
  foreignLang: string;
  /** Which foreign classNames this target node accepts */
  acceptedClasses: string[];
  transform: (db: AdapterDB, foreignNode: SymbolEntry) => Record<string, unknown>;
}

/** Approach C — language-wide global registry entry. */
interface ApproachCEntry {
  kind: "C";
  /** The language that declared this registry (the *target* language) */
  targetLang: string;
  /** Foreign language name */
  foreignLang: string;
  /** Foreign className to match */
  foreignClass: string;
  /** Local className to project into */
  localClass: string;
  transform: (db: AdapterDB, foreignNode: SymbolEntry) => { target: string; props: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// AdapterRegistry
// ---------------------------------------------------------------------------

/**
 * Collects and resolves polyglot cross-language adapters.
 *
 * Usage:
 *   const registry = new AdapterRegistry();
 *   registry.registerLanguage(modelicaConfig, modelicaIndex);
 *   registry.registerLanguage(sysml2Config,   sysml2Index);
 *   const props = registry.project(foreignEntry, "modelica");
 */
export class AdapterRegistry {
  private approachA: ApproachAEntry[] = [];
  private approachB: ApproachBEntry[] = [];
  private approachC: ApproachCEntry[] = [];

  /** Maps languageName → SymbolIndex for cross-index navigation. */
  private indices = new Map<string, SymbolIndex>();

  public cstNodeProvider?: (id: SymbolId) => unknown | null;
  public cstTextProvider?: (startByte: number, endByte: number, entry: SymbolEntry) => string | null;
  public queryProvider?: (queryName: string, id: SymbolId) => unknown | null;

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  getIndex(langName: string): SymbolIndex | undefined {
    return this.indices.get(langName);
  }

  /**
   * Scan a language config and register all adapter entries it declares.
   * Call once per language that participates in the polyglot workspace.
   *
   * @param langConfig - The default export of a `language.ts` file.
   * @param index      - The live SymbolIndex for this language's files.
   */
  registerLanguage(langConfig: any, index: SymbolIndex): void {
    const langName: string = langConfig.name ?? "unknown";
    this.indices.set(langName, index);

    const $ = new Proxy({} as Record<string, any>, {
      get: (_, prop) => ({ type: "sym", name: prop }),
    });

    if (!langConfig.rules) return;

    // Scan each rule for node-level adapters (A and B)
    for (const [ruleName, ruleFn] of Object.entries<any>(langConfig.rules)) {
      const ruleAST = ruleFn($);
      if (!ruleAST || ruleAST.type !== "def") continue;
      const opts = ruleAST.options;
      if (!opts?.adapters) continue;

      // Get the ast className for this rule (used for B matching)
      const className: string = opts.ast?.className ?? toPascalCase(ruleName);

      for (const [adapterLangKey, adapterDef] of Object.entries<any>(opts.adapters)) {
        if (!adapterDef) continue;

        if (adapterDef.accepts && adapterDef.transform) {
          // Approach B — target-side import
          this.approachB.push({
            kind: "B",
            targetLang: langName,
            targetRule: ruleName,
            targetClass: className,
            foreignLang: adapterLangKey,
            acceptedClasses: adapterDef.accepts as string[],
            transform: adapterDef.transform,
          });
        } else if (adapterDef.target && adapterDef.transform) {
          // Approach A — source-side export
          this.approachA.push({
            kind: "A",
            sourceLang: langName,
            sourceRule: ruleName,
            targetLang: adapterLangKey,
            targetClass: adapterDef.target,
            transform: adapterDef.transform,
          });
        }
      }
    }

    // Approach C — top-level global adapters
    if (langConfig.adapters) {
      this.registerGlobalAdapters(langName, langConfig.adapters as GlobalAdapters);
    }
  }

  private registerGlobalAdapters(targetLang: string, adapters: GlobalAdapters): void {
    for (const [foreignLang, classMap] of Object.entries(adapters)) {
      for (const [foreignClass, fn] of Object.entries(classMap)) {
        // fn signature: (db, foreignNode) => { target, props }
        this.approachC.push({
          kind: "C",
          targetLang,
          foreignLang,
          foreignClass,
          localClass: "", // resolved at projection time from fn return value
          transform: fn as any,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Projection
  // -------------------------------------------------------------------------

  /**
   * Project a foreign SymbolEntry into the given target language.
   *
   * Resolution order: C → B → A.
   *
   * Returns a normalized projection result containing:
   *   - `targetClass`  — the matched local className
   *   - `targetLang`   — the target language name
   *   - `props`        — the property bag from the transform
   *   - `approach`     — which approach matched ("A" | "B" | "C")
   *
   * Returns `null` if no adapter matches.
   */
  project(foreignEntry: SymbolEntry, foreignLang: string, targetLang: string): ProjectionResult | null {
    const db = this.createAdapterDB(targetLang);

    // The `className` is stored in metadata._className by the registry
    // at index time, or we fall back to the ruleName in PascalCase.
    const foreignClass = this.resolveClassName(foreignEntry);

    // --- Approach C (highest priority: global override) ---
    for (const entry of this.approachC) {
      if (entry.targetLang === targetLang && entry.foreignLang === foreignLang && entry.foreignClass === foreignClass) {
        try {
          const result = entry.transform(db, foreignEntry);
          return {
            targetClass: result.target,
            targetLang,
            props: result.props,
            approach: "C",
            foreignEntry,
          };
        } catch (e) {
          console.warn(`[adapter-registry] Approach C transform failed for ${foreignClass}: ${e}`);
        }
      }
    }

    // --- Approach B (target-side import) ---
    for (const entry of this.approachB) {
      if (
        entry.targetLang === targetLang &&
        entry.foreignLang === foreignLang &&
        entry.acceptedClasses.includes(foreignClass)
      ) {
        try {
          const props = entry.transform(db, foreignEntry);
          return {
            targetClass: entry.targetClass,
            targetLang,
            props,
            approach: "B",
            foreignEntry,
          };
        } catch (e) {
          console.warn(`[adapter-registry] Approach B transform failed for ${foreignClass}: ${e}`);
        }
      }
    }

    // --- Approach A (source-side export) ---
    for (const entry of this.approachA) {
      if (
        entry.sourceLang === foreignLang &&
        entry.targetLang === targetLang &&
        this.resolveRuleForEntry(foreignEntry, foreignLang) === entry.sourceRule
      ) {
        try {
          // Approach A self is the SelfAccessor for its own fields —
          // at runtime we pass the SymbolEntry; the transform extracts names from it.
          const props = entry.transform(db, foreignEntry);
          return {
            targetClass: entry.targetClass,
            targetLang,
            props,
            approach: "A",
            foreignEntry,
          };
        } catch (e) {
          console.warn(`[adapter-registry] Approach A transform failed for ${foreignClass}: ${e}`);
        }
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Bulk projection — project all symbols from one language into another
  // -------------------------------------------------------------------------

  /**
   * Project all symbols in `sourceLang`'s index into `targetLang`.
   * Returns only pairs that successfully matched an adapter.
   */
  projectAll(sourceLang: string, targetLang: string): ProjectionResult[] {
    const sourceIndex = this.indices.get(sourceLang);
    if (!sourceIndex) return [];

    const results: ProjectionResult[] = [];
    for (const entry of sourceIndex.symbols.values()) {
      const result = this.project(entry, sourceLang, targetLang);
      if (result) results.push(result);
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // AdapterDB factory
  // -------------------------------------------------------------------------

  /**
   * Creates an AdapterDB facade scoped to a given target language.
   * The `project()` method on the facade calls back into this registry.
   */
  createAdapterDB(forLang: string): AdapterDB {
    const registry = this;

    return {
      symbol(id: SymbolId): SymbolEntry | undefined {
        // Search all indices
        for (const index of registry.indices.values()) {
          const entry = index.symbols.get(id);
          if (entry) return entry;
        }
        return undefined;
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        for (const index of registry.indices.values()) {
          for (const entry of index.symbols.values()) {
            if (entry.parentId === id) results.push(entry);
          }
        }
        return results;
      },

      byName(name: string): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        for (const index of registry.indices.values()) {
          const ids = index.byName.get(name);
          if (ids) {
            for (const id of ids) {
              const entry = index.symbols.get(id);
              if (entry) results.push(entry);
            }
          }
        }
        return results;
      },

      project(foreignEntry: SymbolEntry, targetLang: string): Record<string, unknown> | null {
        // Detect which language this foreign entry came from
        const sourceLang = registry.detectLang(foreignEntry);
        if (!sourceLang) return null;
        const result = registry.project(foreignEntry, sourceLang, targetLang);
        return result ? result.props : null;
      },

      cstNode(id: SymbolId): unknown | null {
        return registry.cstNodeProvider ? registry.cstNodeProvider(id) : null;
      },

      cstText(startByte: number, endByte: number, entry: SymbolEntry): string | null {
        return registry.cstTextProvider ? registry.cstTextProvider(startByte, endByte, entry) : null;
      },

      query<T>(queryName: string, id: SymbolId): T | null {
        return registry.queryProvider ? (registry.queryProvider(queryName, id) as T) : null;
      },
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Find which language index a SymbolEntry lives in. */
  private detectLang(entry: SymbolEntry): string | null {
    for (const [langName, index] of this.indices) {
      if (index.symbols.has(entry.id)) return langName;
    }
    return null;
  }

  /** Determine the className for a SymbolEntry (from metadata or ruleName). */
  private resolveClassName(entry: SymbolEntry): string {
    // Prefer metadata._className injected by some languages
    if (typeof entry.metadata._className === "string") return entry.metadata._className;
    return toPascalCase(entry.ruleName);
  }

  /** Determine the ruleName for a SymbolEntry within a language index. */
  private resolveRuleForEntry(entry: SymbolEntry, _langName: string): string {
    return entry.ruleName;
  }

  // -------------------------------------------------------------------------
  // Introspection helpers (used by playground UI)
  // -------------------------------------------------------------------------

  /** List all registered A entries (for debugging/playground). */
  getApproachAEntries(): ReadonlyArray<ApproachAEntry> {
    return this.approachA;
  }
  /** List all registered B entries. */
  getApproachBEntries(): ReadonlyArray<ApproachBEntry> {
    return this.approachB;
  }
  /** List all registered C entries. */
  getApproachCEntries(): ReadonlyArray<ApproachCEntry> {
    return this.approachC;
  }
  /** Return registered language names. */
  getLanguageNames(): string[] {
    return Array.from(this.indices.keys());
  }
}

// ---------------------------------------------------------------------------
// Projection result type
// ---------------------------------------------------------------------------

export interface ProjectionResult {
  /** The local className the foreign node was projected into. */
  targetClass: string;
  /** The target language name. */
  targetLang: string;
  /** Property bag from the transform. */
  props: Record<string, unknown>;
  /** Which approach resolved this projection. */
  approach: "A" | "B" | "C";
  /** The original foreign SymbolEntry. */
  foreignEntry: SymbolEntry;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function toPascalCase(str: string): string {
  return str.replace(/(^|_)([a-z])/g, (_, __, c) => c.toUpperCase());
}
