import { IdTrieMap } from "./utils/radix-trie.js";
/* eslint-disable */
export interface LintResult {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  startByte?: number;
  endByte?: number;
  field?: string;
}

import type {
  CSTTree,
  CycleInfo,
  CycleRecoveryFn,
  DependencyKey,
  ExpressionEvaluator,
  Memo,
  QueryCacheStore,
  QueryDB,
  QueryDef,
  QueryFn,
  QueryHooks,
  Revision,
  SpecializationArgs,
  SymbolEntry,
  SymbolId,
  SymbolIndex,
} from "./runtime.js";

// ---------------------------------------------------------------------------
// Dependency Tracker — Records which inputs/queries a query reads
// ---------------------------------------------------------------------------

/**
 * Captures dependencies during query execution.
 * A fresh tracker is pushed onto the stack before each `execute()` call
 * and popped afterwards. The recorded dependencies become the memo's edges.
 */
class DependencyTracker {
  readonly dependencies: DependencyKey[] = [];
  /** Names looked up via byName() — used for negative dependency tracking. */
  readonly byNameLookups = new Set<string>();

  recordInput(symbolId: SymbolId): void {
    this.dependencies.push({ kind: "input", symbolId });
  }

  recordQuery(queryName: string, symbolId: SymbolId, argsHash?: string): void {
    this.dependencies.push({ kind: "query", queryName, symbolId, argsHash });
  }

  recordByName(name: string): void {
    this.byNameLookups.add(name);
    this.dependencies.push({ kind: "byName", name });
  }
}

// ---------------------------------------------------------------------------
// Shallow Equality — Used for backdating decisions
// ---------------------------------------------------------------------------

/**
 * Determines if two query results are "the same" for backdating purposes.
 * Uses reference equality first, then falls back to JSON comparison for
 * arrays and plain objects. This is the right default tradeoff:
 * - Fast for primitives and shared object references
 * - Correct for the common case of returning filtered arrays
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Query Engine — Salsa-style incremental computation
// ---------------------------------------------------------------------------

/**
 * A Salsa-style incremental query engine that lazily evaluates semantic
 * queries defined in `language.ts`.
 *
 * ## How it works
 *
 * The engine implements the **red-green algorithm** from Salsa:
 *
 * 1. **Revision tracking:** A monotonic counter (`currentRevision`) is
 *    incremented every time an input changes. Each memo records the revision
 *    it was verified at and the revision its value last actually changed.
 *
 * 2. **Dependency recording:** During query execution, every `db.query()`,
 *    `db.symbol()`, `db.childrenOf()` etc. call is intercepted and recorded
 *    as a dependency edge in the memo.
 *
 * 3. **Deep verification:** On a cache hit in a new revision, instead of
 *    eagerly evicting, the engine recursively walks the dependency edges
 *    to check if any transitive input actually changed. If not, the cached
 *    value is reused without re-execution.
 *
 * 4. **Backdating:** If a query IS re-executed but produces the same result,
 *    its `changed_at` revision is NOT updated. This prevents cascading
 *    re-execution of downstream queries.
 */
// ---------------------------------------------------------------------------
// Lint Diagnostic — resolved output from lint queries
// ---------------------------------------------------------------------------

/** A resolved lint diagnostic with full position and identity info. */
export interface LintDiagnostic {
  symbolId: SymbolId;
  startByte: number;
  endByte: number;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  lintName: string;
}

export class QueryEngine {
  /** Monotonic revision counter. Bumped on every `invalidate()` call. */
  private currentRevision: Revision = 0;

  /** Memoized query results keyed by composite integer.
   * Maintained as an LRU cache. Oldest items are at the front of the Map iteration.
   */
  private memos = new Map<number, Memo>();

  private static nextQueryId = 1;
  private static queryIds = new Map<string, number>();

  private getQueryId(queryName: string): number {
    let id = QueryEngine.queryIds.get(queryName);
    if (id === undefined) {
      id = QueryEngine.nextQueryId++;
      QueryEngine.queryIds.set(queryName, id);
    }
    return id;
  }

  private static nextArgsId = 1;
  private static argsIds = new Map<string, number>();

  private getArgsId(argsHash?: string): number {
    if (!argsHash) return 0;
    let id = QueryEngine.argsIds.get(argsHash);
    if (id === undefined) {
      id = QueryEngine.nextArgsId++;
      QueryEngine.argsIds.set(argsHash, id);
    }
    return id;
  }

  /** The external cache store for saving evicted memos (e.g. SQLite, IndexedDB). */
  private cacheStore?: QueryCacheStore | undefined;
  private maxMemos: number;

  private inputReverseDependencies = new Map<SymbolId, Set<number>>();
  private byNameReverseDependencies = new Map<string, Set<number>>();

  /** Tracks when each input (symbol entry) was last modified. */
  private inputRevisions = new Map<SymbolId, Revision>();

  // ---- Incremental lint cache ----

  /**
   * Per-resource cache of lint diagnostics, keyed by SymbolId.
   * On incremental edits only changed symbols are re-linted; the rest reuse cached results.
   */
  private lintCache = new Map<string, Map<SymbolId, LintDiagnostic[]>>();

  /** The set of dirty symbols for each lint cache key. */
  private dirtyLintSymbols = new Map<string, Set<SymbolId>>();

  /** The engine revision at which each resource's lint cache was last fully populated. */
  private lintCacheRevision = new Map<string, Revision>();

  /** The active dependency tracker (non-null during query execution). */
  private activeTracker: DependencyTracker | null = null;

  /** Cycle detection: ordered list of queries currently being executed. */
  private executionStack: Array<{ key: number; queryName: string; symbolId: SymbolId }> = [];

  /** Query function hooks keyed by grammar rule name. */
  private hooksByRule: Map<string, QueryHooks>;

  // ---- Virtual entry infrastructure (specialization) ----

  /** Virtual (specialized) symbol entries. Negative IDs. */
  private virtualEntries = new IdTrieMap<SymbolEntry>();

  /** Specialization args for virtual entries. */
  private specializationArgs = new Map<SymbolId, SpecializationArgs>();

  /** Base symbol ID for virtual entries. */
  private specializationBases = new Map<SymbolId, SymbolId>();

  /** Memoization: "baseId:argsHash" → virtualId. */
  private specializeCache = new Map<string, SymbolId>();

  /** Counter for virtual IDs (decrements from -1). */
  private nextVirtualId: SymbolId = -1;

  /** Optional language-specific expression evaluator. */
  private evaluator: ExpressionEvaluator | null;

  /**
   * Optional Tree-sitter tree for CST access.
   * Held as an opaque reference — the engine doesn't interpret it.
   * Used by `cstText()` and `cstNode()` on the tracked QueryDB.
   */
  private tree: CSTTree | null;

  constructor(
    public index: SymbolIndex,
    queryHooks: Map<string, QueryHooks>,
    options?: {
      evaluator?: ExpressionEvaluator;
      tree?: CSTTree;
      cacheStore?: QueryCacheStore;
      maxMemos?: number;
    },
  ) {
    this.hooksByRule = queryHooks;
    this.evaluator = options?.evaluator ?? null;
    this.tree = options?.tree ?? null;
    this.cacheStore = options?.cacheStore;
    // Set a very high default memo limit (2 million) to prevent cache trashing
    // for massive models (e.g. MSL + 30k symbol stress tests).
    this.maxMemos = options?.maxMemos ?? 2_000_000;

    // Initialize input revisions for all existing symbols
    for (const id of index.symbols.keys()) {
      this.inputRevisions.set(id, this.currentRevision);
    }
  }

  /** Update the CST tree reference (e.g., after an incremental parse). */
  updateTree(tree: CSTTree | null): void {
    this.tree = tree;
  }

  // =========================================================================
  // Public API
  // =========================================================================

  cstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
    if (!this.tree) return null;
    return this.tree.getText(startByte, endByte, entry);
  }

  /**
   * Execute a named query for a symbol, with Salsa-style memoization.
   *
   * This is the main entry point. It implements the `fetch` algorithm:
   * 1. If we have a memo verified this revision → return cached value
   * 2. If we have a memo and all deps are unchanged → mark verified, return cached
   * 3. Otherwise → re-execute, possibly backdate
   *
   * @param queryName - The name of the query (as defined in language.ts).
   * @param symbolId  - The symbol to query.
   * @returns The query result.
   */
  query<T = unknown>(queryName: string, symbolId: SymbolId): T {
    return this.fetch(queryName, symbolId) as T;
  }

  /**
   * Preflight queries to hydrate the in-memory cache from the cache store.
   * This allows the synchronous `query` method to find what it needs for
   * dependencies that have been flushed to the DB.
   *
   * @param symbols The symbols to preflight.
   * @param queryNames The queries that will likely be run on these symbols.
   */
  async preflight(symbols: SymbolId[], queryNames: string[]): Promise<void> {
    if (!this.cacheStore) return;

    const keysToFetch: number[] = [];
    for (const symbolId of symbols) {
      for (const queryName of queryNames) {
        const key = this.memoKey(queryName, symbolId);
        if (!this.memos.has(key)) {
          keysToFetch.push(key);
        }
      }
    }

    if (keysToFetch.length > 0) {
      const fetched = await this.cacheStore.getMemos(keysToFetch);
      for (const [key, memo] of fetched) {
        // We set directly without LRU refresh because preflight implies imminent usage
        this.memos.set(key, memo);
      }
      this.evictIfNeeded();
    }
  }

  /**
   * Dump all currently cached memos in memory.
   * Useful for serialization and federated caching.
   */
  dumpMemos(): Map<number, Memo> {
    return new Map(this.memos);
  }

  /**
   * Notify the engine that symbols have changed.
   * Bumps the revision counter and records which inputs changed.
   *
   * **Unlike the previous implementation, this does NOT evict any cache entries.**
   * Cached memos are retained and lazily re-verified on the next `query()` call.
   *
   * @param changedSymbolIds - IDs of symbols that were added, removed, or modified.
   */
  invalidate(changedSymbolIds: Set<SymbolId>, allChangedIds?: Set<SymbolId>): void {
    this.currentRevision++;

    for (const id of changedSymbolIds) {
      this.inputRevisions.set(id, this.currentRevision);
    }

    // Invalidate virtual entries whose base was changed
    for (const [cacheKey, virtualId] of this.specializeCache) {
      const baseId = this.specializationBases.get(virtualId);
      if (baseId !== undefined && changedSymbolIds.has(baseId)) {
        this.virtualEntries.delete(virtualId);
        this.specializationArgs.delete(virtualId);
        this.specializationBases.delete(virtualId);
        this.specializeCache.delete(cacheKey);
        this.inputRevisions.delete(virtualId);
        changedSymbolIds.add(virtualId);
      }
    }

    // Push-based dirty bit propagation
    const dirtyMemos = new Set<number>();
    const stack: number[] = [];

    // Names that might have changed (for byName reverse dependencies)
    // We invalidate all memos that looked up a name that belongs to any changed symbol
    for (const id of changedSymbolIds) {
      const entry = this.index.symbols.get(id);
      if (entry && entry.name) {
        const rev = this.byNameReverseDependencies.get(entry.name);
        if (rev) for (const k of rev) stack.push(k);
      }

      const rev = this.inputReverseDependencies.get(id);
      if (rev) for (const k of rev) stack.push(k);
    }

    while (stack.length > 0) {
      const key = stack.pop()!;
      if (dirtyMemos.has(key)) continue;
      dirtyMemos.add(key);

      const memo = this.memos.get(key);
      if (memo) {
        memo.verified_at = -1; // Force re-evaluation
        if (memo.reverseDependencies) {
          for (const revDep of memo.reverseDependencies) {
            stack.push(revDep);
          }
        }
      }
    }

    const dirtySet = new Set<SymbolId>();
    for (const key of dirtyMemos) {
      dirtySet.add(this.symbolIdFromKey(key));
    }
    const fullDirtySet = allChangedIds ? allChangedIds : changedSymbolIds;
    for (const id of fullDirtySet) {
      dirtySet.add(id);
    }

    for (const [cacheKey, cacheDirtySet] of this.dirtyLintSymbols) {
      for (const id of dirtySet) {
        cacheDirtySet.add(id);
      }
    }

    // Drop dirty memos from lint cache so runAllLintsAsync picks them up
    for (const id of dirtySet) {
      for (const cache of this.lintCache.values()) {
        cache.delete(id);
      }
    }

    // Prune memos for symbols that were deleted
    for (const key of this.memos.keys()) {
      const id = this.symbolIdFromKey(key);
      if (!this.resolveEntry(id)) {
        this.memos.delete(key);
      }
    }
  }

  /**
   * Replace the symbol index (e.g. after an incremental update).
   * Bumps the revision and records input changes for new/modified symbols.
   */
  updateIndex(newIndex: SymbolIndex): void {
    if (newIndex.lastChangedIds) {
      this.index = newIndex;
      this.invalidate(newIndex.lastChangedIds);
      return;
    }

    this.currentRevision++;

    let hasNewSymbols = false;

    // Determine which symbols are new or changed
    const dirtySet = new Set<SymbolId>();
    for (const [id, entry] of newIndex.symbols) {
      const oldEntry = this.index.symbols.get(id);
      if (!oldEntry) hasNewSymbols = true;
      if (!oldEntry || !symbolEntryEqual(oldEntry, entry)) {
        this.inputRevisions.set(id, this.currentRevision);
        dirtySet.add(id);
      }
    }

    if (dirtySet.size > 0) {
      for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
        for (const id of dirtySet) {
          cacheDirtySet.add(id);
        }
      }
    }

    if (hasNewSymbols) {
      // Selectively invalidate memos that looked up names which now exist.
      // We only care about new GLOBAL symbols (parentId === null) because
      // byName lookups are used for global/root resolution. A new local
      // variable should not invalidate the entire MSL cache.
      const newNames = new Set<string>();
      for (const [id, entry] of newIndex.symbols) {
        if (!this.index.symbols.has(id)) {
          if (entry.parentId === null || (entry.metadata as any)?.isPredefined) {
            newNames.add(entry.name);
          }
        }
      }
      if (newNames.size > 0) {
        for (const [key, memo] of this.memos) {
          if (memo.byNameLookups) {
            for (const name of newNames) {
              if (memo.byNameLookups.has(name)) {
                this.memos.delete(key);
                break;
              }
            }
          }
        }
      }
    }

    // Prune memos for deleted symbols
    for (const key of this.memos.keys()) {
      const id = this.symbolIdFromKey(key);
      if (!newIndex.symbols.has(id)) {
        this.memos.delete(key);
      }
    }

    // Prune input revisions for deleted symbols
    for (const id of this.inputRevisions.keys()) {
      if (!newIndex.symbols.has(id)) {
        this.inputRevisions.delete(id);
      }
    }

    // Prune dirtyLintSymbols for deleted symbols
    for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
      for (const id of cacheDirtySet) {
        if (!newIndex.symbols.has(id)) {
          cacheDirtySet.delete(id);
        }
      }
    }

    this.index = newIndex;
  }

  /**
   * Fast-path index replacement: swap the index reference and invalidate
   * only the specified changed symbols, avoiding the O(all symbols) diff
   * that `updateIndex()` performs.
   *
   * Use this when the caller knows exactly which symbols changed
   * (e.g., from incremental re-indexing via SymbolIndexer.update()).
   *
   * @param newIndex - The new SymbolIndex to use.
   * @param changedSymbolIds - IDs of symbols that were added, removed, or modified.
   */
  swapIndex(newIndex: SymbolIndex, changedSymbolIds: Set<SymbolId>, structuralChangedIds?: Set<SymbolId>): void {
    this.index = newIndex;
    if (structuralChangedIds) {
      this.invalidate(structuralChangedIds, changedSymbolIds);
    } else {
      this.invalidate(changedSymbolIds);
    }
  }

  // =========================================================================
  // Lint Execution
  // =========================================================================

  /**
   * A resolved lint diagnostic with full position info.
   */
  static readonly LINT_PREFIX = "lint__";

  /**
   * Run all lint queries for a single symbol.
   * Returns an empty array if the symbol has no lint hooks.
   */
  runLints(symbolId: SymbolId): Array<{ lintName: string; result: LintResult }> {
    const entry = this.resolveEntry(symbolId);
    if (!entry) return [];
    const hooks = this.hooksByRule.get(entry.ruleName);
    if (!hooks) return [];

    const results: Array<{ lintName: string; result: LintResult }> = [];
    for (const key of Object.keys(hooks)) {
      if (!key.startsWith(QueryEngine.LINT_PREFIX)) continue;
      const lintName = key.slice(QueryEngine.LINT_PREFIX.length);
      try {
        const result = this.fetch(key, symbolId) as LintResult | LintResult[] | null;
        if (result) {
          if (Array.isArray(result)) {
            for (const r of result) results.push({ lintName, result: r });
          } else {
            results.push({ lintName, result });
          }
        }
      } catch (e) {
        // Don't let a failing lint crash the system
        console.warn(`[lint] ${lintName} failed for ${entry.name}: ${e}`);
      }
    }
    return results;
  }

  /**
   * Run all lint queries. If `resourceId` is provided, only runs lints for symbols
   * belonging to that specific document, preventing massive performance bottlenecks
   * when processing the standard library.
   * Returns a flat array of diagnostics with resolved byte positions.
   */
  runAllLints(resourceId?: string): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];

    // When filtering by resource, use the symbolsByResource index for O(1) lookup
    let symbolsToCheck: Iterable<[SymbolId, SymbolEntry]>;
    if (resourceId && this.index.symbolsByResource) {
      const resourceSymbolIds = this.index.symbolsByResource.get(resourceId);
      if (!resourceSymbolIds) return diagnostics;
      symbolsToCheck = resourceSymbolIds
        .map((id: SymbolId) => [id, this.index.symbols.get(id)] as [SymbolId, SymbolEntry | undefined])
        .filter((pair: any): pair is [SymbolId, SymbolEntry] => pair[1] !== undefined);
    } else {
      symbolsToCheck = this.index.symbols;
    }

    for (const [id, entry] of symbolsToCheck) {
      if (resourceId && entry.resourceId !== resourceId) continue;

      for (const { lintName, result } of this.runLints(id)) {
        // Resolve byte range: explicit range > field lookup > symbol range
        let startByte = result.startByte ?? entry.startByte;
        let endByte = result.endByte ?? entry.endByte;

        // If a field name is specified, look up its range from the entry
        if (result.field && !result.startByte && !result.endByte) {
          const fieldRange = entry.fieldRanges?.[result.field];
          if (fieldRange) {
            startByte = fieldRange.startByte;
            endByte = fieldRange.endByte;
          }
        }

        diagnostics.push({
          symbolId: id,
          startByte,
          endByte,
          message: result.message,
          severity: result.severity,
          lintName,
        });
      }
    }
    return diagnostics;
  }

  /**
   * Async version of runAllLints that yields to the event loop.
   * If yieldFn returns true, the process is considered stale and aborts early.
   */
  async runAllLintsAsync(
    resourceId?: string,
    yieldFn?: () => Promise<boolean>,
    viewportRange?: { startByte: number; endByte: number },
  ): Promise<LintDiagnostic[]> {
    const diagnostics: LintDiagnostic[] = [];

    // ── Incremental lint caching ──────────────────────────────────────────
    const cacheKey = resourceId ?? "__all__";
    let perSymbolCache = this.lintCache.get(cacheKey);
    let cacheDirtySet = this.dirtyLintSymbols.get(cacheKey);

    if (!perSymbolCache || !cacheDirtySet) {
      perSymbolCache = new Map();
      this.lintCache.set(cacheKey, perSymbolCache);

      cacheDirtySet = new Set(this.index.symbols.keys());
      this.dirtyLintSymbols.set(cacheKey, cacheDirtySet);
    }

    // Determine which symbols actually need re-linting
    const symbolsToRelint: Array<[SymbolId, SymbolEntry]> = [];
    const relintIds = new Set<SymbolId>();
    const validCachedIds = new Set<SymbolId>();

    const totalSymbols = resourceId
      ? (this.index.symbolsByResource?.get(resourceId)?.length ?? 0)
      : this.index.symbols.size;

    for (const id of cacheDirtySet) {
      const entry = this.index.symbols.get(id);
      if (!entry) {
        cacheDirtySet.delete(id);
        continue;
      }
      if (resourceId && entry.resourceId !== resourceId) continue;

      symbolsToRelint.push([id, entry]);
      relintIds.add(id);
    }

    // ── Viewport prioritization ───────────────────────────────────────────
    // When a viewport range is provided, sort symbols so those within the
    // visible area are processed first. This means the user sees diagnostics
    // for on-screen code immediately while off-screen lints trickle in.
    if (viewportRange && symbolsToRelint.length > 1) {
      const { startByte: vpStart, endByte: vpEnd } = viewportRange;
      const inViewport: Array<[SymbolId, SymbolEntry]> = [];
      const outViewport: Array<[SymbolId, SymbolEntry]> = [];
      for (const pair of symbolsToRelint) {
        const entry = pair[1];
        if (entry.startByte <= vpEnd && entry.endByte >= vpStart) {
          inViewport.push(pair);
        } else {
          outViewport.push(pair);
        }
      }
      symbolsToRelint.length = 0;
      symbolsToRelint.push(...inViewport, ...outViewport);
    }

    for (const cachedId of perSymbolCache.keys()) {
      const entry = this.index.symbols.get(cachedId);
      if (!entry || (resourceId && entry.resourceId !== resourceId)) {
        perSymbolCache.delete(cachedId);
      } else if (this.index.symbols.has(cachedId) && !relintIds.has(cachedId)) {
        validCachedIds.add(cachedId);
      }
    }

    let chunkCount = 0;
    let cpuTime = 0;
    let yieldTime = 0;
    let lastTime = performance.now();
    let lastYieldStart = performance.now();
    const cachedCount = validCachedIds.size;

    // Re-lint only changed symbols
    for (let i = 0; i < symbolsToRelint.length; i++) {
      const [id, entry] = symbolsToRelint[i];
      const symbolDiags: LintDiagnostic[] = [];

      for (const { lintName, result } of this.runLints(id)) {
        let startByte = result.startByte ?? entry.startByte;
        let endByte = result.endByte ?? entry.endByte;

        if (result.field && !result.startByte && !result.endByte) {
          const fieldRange = entry.fieldRanges?.[result.field];
          if (fieldRange) {
            startByte = fieldRange.startByte;
            endByte = fieldRange.endByte;
          }
        }

        symbolDiags.push({
          symbolId: id,
          startByte,
          endByte,
          message: result.message,
          severity: result.severity,
          lintName,
        });
      }

      perSymbolCache.set(id, symbolDiags);
      diagnostics.push(...symbolDiags);

      // Successfully linted, remove from dirty set
      cacheDirtySet.delete(id);

      chunkCount++;
      if (yieldFn && chunkCount % 500 === 0 && performance.now() - lastYieldStart > 200) {
        cpuTime += performance.now() - lastTime;
        const yieldStart = performance.now();
        const isStale = await yieldFn();
        yieldTime += performance.now() - yieldStart;
        lastTime = performance.now();
        lastYieldStart = performance.now();

        if (isStale) {
          // Merge cached results for symbols we DID NOT process yet so they aren't lost
          // from the display entirely while the user keeps typing.
          for (let j = i + 1; j < symbolsToRelint.length; j++) {
            const unprocessedId = symbolsToRelint[j][0];
            const cached = perSymbolCache.get(unprocessedId);
            if (cached && cached.length > 0) diagnostics.push(...cached);
          }
          // Merge cached results for symbols that were NOT dirty
          for (const id of validCachedIds) {
            const cached = perSymbolCache.get(id);
            if (cached && cached.length > 0) diagnostics.push(...cached);
          }
          return diagnostics;
        }
      }
    }

    // Merge cached results from unchanged symbols
    for (const id of validCachedIds) {
      const cached = perSymbolCache.get(id);
      if (cached && cached.length > 0) diagnostics.push(...cached);
    }

    // Record this revision as the cache baseline
    this.lintCacheRevision.set(cacheKey, this.currentRevision);

    cpuTime += performance.now() - lastTime;
    return diagnostics;
  }

  // =========================================================================
  // Public QueryDB Facade
  // =========================================================================

  /**
   * Create a public (non-dependency-tracked) QueryDB facade.
   *
   * Used by external consumers (e.g., compat-shim's QueryBackedClassInstance)
   * that need to invoke queries and access symbols outside of the Salsa
   * dependency tracking context.
   *
   * Unlike `createTrackedDB()`, accesses through this facade are NOT recorded
   * as dependencies of any executing query.
   */
  private _queryDBCache: QueryDB | null = null;
  toQueryDB(): QueryDB {
    if (this._queryDBCache) return this._queryDBCache;
    const engine = this;

    const db: QueryDB = {
      symbol(id: SymbolId): SymbolEntry | undefined {
        return engine.resolveEntry(id);
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId ?? 0);
        if (childIds) {
          for (const cid of childIds) {
            const entry = engine.resolveEntry(cid);
            if (entry) results.push(entry);
          }
        }
        // Also include virtual (specialized) entries whose parentId matches
        for (const vEntry of engine.virtualEntries.values()) {
          if (vEntry.parentId === id) results.push(vEntry);
        }
        return results;
      },

      childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId ?? 0);
        if (childIds) {
          for (const cid of childIds) {
            const entry = engine.resolveEntry(cid);
            if (entry && entry.fieldName === fieldName) results.push(entry);
          }
        }
        for (const vEntry of engine.virtualEntries.values()) {
          if (vEntry.parentId === id && vEntry.fieldName === fieldName) results.push(vEntry);
        }
        return results;
      },

      parentOf(id: SymbolId): SymbolEntry | undefined {
        const entry = engine.resolveEntry(id);
        if (!entry || entry.parentId === null) return undefined;
        return engine.resolveEntry(entry.parentId);
      },

      exportsOf(id: SymbolId): SymbolEntry[] {
        return this.childrenOf(id);
      },

      query<T = unknown>(queryName: string, id: SymbolId): T {
        return engine.fetch(queryName, id) as T;
      },

      byName(name: string): SymbolEntry[] {
        const ids = engine.index.byName.get(name);
        if (!ids) return [];
        return ids.map((id: SymbolId) => engine.resolveEntry(id)).filter(Boolean) as SymbolEntry[];
      },

      allEntries(): SymbolEntry[] {
        return Array.from(engine.allEntries());
      },

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>): T {
        const argsHash = JSON.stringify(args, Object.keys(args).sort());
        return engine.fetch(queryName, id, argsHash, args) as T;
      },

      specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId {
        const cacheKey = `${baseId}:${args.hash}`;
        const existing = engine.specializeCache.get(cacheKey);
        if (existing !== undefined) return existing;

        const base = engine.resolveEntry(baseId);
        if (!base) throw new Error(`Cannot specialize unknown symbol ${baseId}`);

        const virtualId = engine.nextVirtualId--;
        const virtualEntry: SymbolEntry = {
          ...base,
          id: virtualId,
          metadata: { ...base.metadata },
        };

        engine.virtualEntries.set(virtualId, virtualEntry);
        engine.specializationArgs.set(virtualId, args as SpecializationArgs);
        engine.specializationBases.set(virtualId, baseId);
        engine.specializeCache.set(cacheKey, virtualId);
        engine.inputRevisions.set(virtualId, engine.currentRevision);

        return virtualId;
      },

      argsOf<T = unknown>(id: SymbolId): SpecializationArgs<T> | null {
        return (engine.specializationArgs.get(id) as SpecializationArgs<T>) ?? null;
      },

      baseOf(id: SymbolId): SymbolId | null {
        return engine.specializationBases.get(id) ?? null;
      },

      evaluate(expression: unknown, scopeId?: SymbolId | null): unknown {
        if (!engine.evaluator) {
          throw new Error("No expression evaluator configured on the QueryEngine");
        }
        const scope = scopeId ? (engine.resolveEntry(scopeId) ?? null) : null;
        return engine.evaluator(expression, scope, this);
      },

      cstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
        if (!engine.tree) return null;
        return engine.tree.getText(startByte, endByte, entry);
      },

      cstNode(id: SymbolId): unknown | null {
        if (!engine.tree) return null;
        const entry = engine.resolveEntry(id);
        if (!entry) return null;
        return engine.tree.getNode(entry.startByte, entry.endByte, entry);
      },

      cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
        if (!engine.tree) return null;
        return engine.tree.getNode(startByte, endByte, entry);
      },
    };
    this._queryDBCache = db;
    return db;
  }

  // =========================================================================
  // Salsa Algorithm: fetch → deep_verify → execute → backdate
  // =========================================================================

  /**
   * The core Salsa `fetch` algorithm.
   *
   * 1. Fast path: memo exists and was verified this revision → return cached.
   * 2. Deep verify: recursively check if dependencies changed → if not, reuse.
   * 3. Re-execute: run the user's query lambda, record new dependencies.
   * 4. Backdate: if result is the same as before, don't bump `changed_at`.
   */
  private fetch(queryName: string, symbolId: SymbolId, argsHash?: string, args?: Record<string, unknown>): unknown {
    const key = this.memoKey(queryName, symbolId, argsHash);

    // Record this query as a dependency of the currently executing query
    if (this.activeTracker) {
      this.activeTracker.recordQuery(queryName, symbolId, argsHash);
    }

    const memo = this.memos.get(key);

    // Fast path: already verified this revision
    if (memo && memo.verified_at === this.currentRevision) {
      return memo.value;
    }

    // Push-based invalidation optimization:
    // If a memo is dirty, `invalidate()` sets its `verified_at` to -1.
    // Therefore, if `verified_at !== -1`, the memo is guaranteed to be clean
    // and unaffected by the current revision's changes.
    if (memo && memo.verified_at !== -1) {
      memo.verified_at = this.currentRevision;
      return memo.value;
    }

    // At this point, verified_at === -1. We must check if backdating is possible via deepVerify.
    // If deepVerify returns true, the dependencies didn't actually change their values (just their revisions),
    // so we can backdate and avoid re-executing.
    const inputRev = this.inputRevisions.get(symbolId) ?? 0;
    if (memo && this.deepVerify(memo)) {
      memo.verified_at = this.currentRevision;
      return memo.value;
    }

    // Must re-execute
    const { value, dependencies, byNameLookups } = this.execute(queryName, symbolId, argsHash, args);

    // Helper to wire reverse dependencies
    const wireReverseDeps = () => {
      for (const dep of dependencies) {
        if (dep.kind === "input") {
          let rev = this.inputReverseDependencies.get(dep.symbolId);
          if (!rev) {
            rev = new Set();
            this.inputReverseDependencies.set(dep.symbolId, rev);
          }
          rev.add(key);
        } else if (dep.kind === "query") {
          const depKey = this.memoKey(dep.queryName, dep.symbolId, dep.argsHash);
          let depMemo = this.memos.get(depKey);
          if (depMemo) {
            if (!depMemo.reverseDependencies) depMemo.reverseDependencies = new Set();
            depMemo.reverseDependencies.add(key);
          }
        } else if (dep.kind === "byName") {
          let rev = this.byNameReverseDependencies.get(dep.name);
          if (!rev) {
            rev = new Set();
            this.byNameReverseDependencies.set(dep.name, rev);
          }
          rev.add(key);
        }
      }
    };

    // Backdating: if the result is the same, don't bump changed_at
    if (memo && shallowEqual(memo.value, value)) {
      memo.value = value;
      memo.verified_at = this.currentRevision;
      memo.dependencies = dependencies;
      if (byNameLookups.size > 0) memo.byNameLookups = byNameLookups;
      wireReverseDeps();
      // *** changed_at stays the same — this is the backdating magic ***
      return value;
    }

    // New or changed result
    const newMemo: Memo = {
      value,
      verified_at: this.currentRevision,
      changed_at: this.currentRevision,
      dependencies,
    };
    if (byNameLookups.size > 0) newMemo.byNameLookups = byNameLookups;
    this.memos.set(key, newMemo);
    wireReverseDeps();
    this.evictIfNeeded();
    return value;
  }

  /**
   * Evicts the oldest 10% of memos if the memory size exceeds maxMemos.
   *
   * Only memos whose values are JSON-serializable are flushed to the
   * cache store. Memos containing live object graphs (e.g.,
   * LiveClassInstance) are silently discarded since they cannot
   * survive serialization round-tripping.
   */
  private evictIfNeeded(): void {
    if (this.memos.size <= this.maxMemos) return;

    const numToEvict = Math.ceil(this.maxMemos * 0.1);
    const keysToEvict: number[] = [];
    const serializableMemos = new Map<number, Memo>();

    let count = 0;
    // Map iteration yields entries in insertion order (oldest first)
    for (const [key, memo] of this.memos.entries()) {
      keysToEvict.push(key);

      // Only attempt to persist memos whose values survive JSON round-tripping.
      // Many query results contain live class instances, closures, or circular
      // references that would produce garbage if serialized.
      if (this.cacheStore) {
        try {
          // JSON.stringify doesn't throw on functions (it returns undefined),
          // which allows closures to slip through and crash IndexedDB's structured clone.
          // We use structuredClone to accurately test if the value is cloneable by IDB.
          if (typeof memo.value === "function") {
            throw new Error("Functions are not cloneable");
          }
          if (typeof structuredClone === "function") {
            structuredClone(memo.value);
          } else {
            // Fallback for older environments without structuredClone:
            // stringify to check for circular refs, and reject top-level undefined/functions
            const json = JSON.stringify(memo.value);
            if (json === undefined) throw new Error("Not serializable");
          }

          // Value is safe — include for persistence
          serializableMemos.set(key, memo);
        } catch {
          // Not serializable — discard silently
        }
      }

      count++;
      if (count >= numToEvict) break;
    }

    for (const key of keysToEvict) {
      this.memos.delete(key);
    }

    if (this.cacheStore && serializableMemos.size > 0) {
      // Fire and forget cache save
      this.cacheStore.setMemos(serializableMemos).catch((e) => {
        console.warn("Failed to flush memos to cache:", e);
      });
    }
  }

  /**
   * The Salsa `maybe_changed_after` check.
   *
   * Recursively walks the memo's dependency edges to determine if any
   * transitive input actually changed since the memo was last verified.
   *
   * For input dependencies: checks if the input's revision is newer.
   * For query dependencies: recursively fetches the dependency (which
   * will verify IT in turn), then checks if its `changed_at` is newer.
   */
  private deepVerify(memo: Memo): boolean {
    for (const dep of memo.dependencies) {
      if (dep.kind === "input") {
        const inputRev = this.inputRevisions.get(dep.symbolId);
        if (inputRev === undefined || inputRev > memo.verified_at) {
          return false; // Input was changed or deleted
        }
      } else if (dep.kind === "query") {
        const depKey = this.memoKey(dep.queryName, dep.symbolId);
        let depMemo = this.memos.get(depKey);

        if (!depMemo) {
          return false; // Dependency was evicted — must re-execute
        }

        // Ensure the dependency is verified in the current revision
        if (depMemo.verified_at !== this.currentRevision) {
          // Recursively fetch the dependency (this will verify it)
          this.fetch(dep.queryName, dep.symbolId);
          depMemo = this.memos.get(depKey);
          if (!depMemo) return false;
        }

        // Check if the dependency's VALUE changed since we last verified
        if (depMemo.changed_at > memo.verified_at) {
          return false; // Dependency's result changed
        }
      } else if (dep.kind === "byName") {
        // Negative dependency: the query looked up this name.
        // If it didn't exist before but now does, the memo is stale.
        // We check the *current* index (after swap) to see if the name is now present.
        const currentIds = this.index.byName.get(dep.name);
        // If the name now resolves to IDs that were added after this memo was verified,
        // we must re-execute.
        if (currentIds) {
          for (const id of currentIds) {
            const entry = this.index.symbols.get(id);
            if (entry && (entry.parentId === null || (entry.metadata as any)?.isPredefined)) {
              const rev = this.inputRevisions.get(id);
              if (rev !== undefined && rev > memo.verified_at) {
                return false; // A new global symbol with this name appeared
              }
            }
          }
        }
      }
    }

    return true; // All dependencies are unchanged
  }

  /**
   * Execute a user's query lambda with dependency recording.
   *
   * Pushes a fresh DependencyTracker, runs the query function, then
   * pops the tracker and returns the result with recorded dependencies.
   *
   * If a cycle is detected:
   * - Finds the cycle participants from the execution stack
   * - If the cycle entry point has a `recovery` function, calls it
   * - Otherwise throws an error
   */
  private execute(
    queryName: string,
    symbolId: SymbolId,
    argsHash?: string,
    args?: Record<string, unknown>,
  ): { value: unknown; dependencies: DependencyKey[]; byNameLookups: Set<string> } {
    const entry = this.resolveEntry(symbolId);
    if (!entry) {
      // Tolerate stale symbol IDs gracefully (e.g. from UI requests querying a stale wrapper during re-indexing yields)
      return { value: null, dependencies: [], byNameLookups: new Set<string>() };
    }

    // In a polyglot unified index, the engine may encounter symbols from a
    // different language that have no query hooks (e.g., a SysML2 engine
    // encountering a Modelica ClassDefinition). Return null gracefully.
    const hooks = this.hooksByRule.get(entry.ruleName);
    if (!hooks || !hooks[queryName]) {
      return { value: null, dependencies: [], byNameLookups: new Set<string>() };
    }

    const { queryFn, recoveryFn } = this.resolveHook(queryName, entry.ruleName);

    // Cycle detection
    const key = this.memoKey(queryName, symbolId, argsHash);
    const cycleIdx = this.executionStack.findIndex((f) => f.key === key);

    if (cycleIdx !== -1) {
      // Build the list of cycle participants (from the cycle entry point to now)
      const participants = this.executionStack.slice(cycleIdx).map((f) => ({
        queryName: f.queryName,
        symbolId: f.symbolId,
      }));

      // Look for the FIRST participant in the cycle that has a recovery function
      const recoverer = this.findCycleRecovery(participants);

      if (recoverer) {
        const cycleInfo: CycleInfo = { participants };
        const fallback = recoverer.recoveryFn(cycleInfo, entry);
        return { value: fallback, dependencies: [], byNameLookups: new Set<string>() };
      }

      // No recovery available — throw
      const stackDesc = this.executionStack.map((f) => `${f.queryName}:${f.symbolId}`).join(" → ");
      throw new Error(
        `Cycle detected: query "${queryName}" for symbol ${symbolId} ` +
          `is already being computed. Stack: [${stackDesc}]\n` +
          `To handle this cycle, add a \`recovery\` function to one of the ` +
          `participating queries.`,
      );
    }

    // Push tracker and execute
    const previousTracker = this.activeTracker;
    const tracker = new DependencyTracker();
    this.activeTracker = tracker;
    this.executionStack.push({ key, queryName, symbolId });

    try {
      const value = queryFn(this.createTrackedDB(), entry, args);
      return { value, dependencies: tracker.dependencies, byNameLookups: tracker.byNameLookups };
    } finally {
      this.activeTracker = previousTracker;
      this.executionStack.pop();
    }
  }

  /**
   * Resolves a query hook entry into its function and optional recovery.
   * Handles both bare functions and `{ execute, recovery }` objects.
   */
  private resolveHook(queryName: string, ruleName: string): { queryFn: QueryFn; recoveryFn: CycleRecoveryFn | null } {
    const hooks = this.hooksByRule.get(ruleName);
    const hook = hooks?.[queryName];

    if (!hook) {
      throw new Error(`Unknown query "${queryName}" for rule "${ruleName}"`);
    }

    if (typeof hook === "function") {
      return { queryFn: hook, recoveryFn: null };
    }

    // It's a QueryDef: { execute, recovery }
    return {
      queryFn: (hook as QueryDef).execute,
      recoveryFn: (hook as QueryDef).recovery,
    };
  }

  /**
   * Finds the first participant in a cycle that has a recovery function.
   * Returns null if no participant defines recovery.
   */
  private findCycleRecovery(
    participants: Array<{ queryName: string; symbolId: SymbolId }>,
  ): { recoveryFn: CycleRecoveryFn } | null {
    for (const p of participants) {
      const entry = this.index.symbols.get(p.symbolId);
      if (!entry) continue;

      const hooks = this.hooksByRule.get(entry.ruleName);
      const hook = hooks?.[p.queryName];
      if (!hook || typeof hook === "function") continue;

      if ((hook as QueryDef).recovery) {
        return { recoveryFn: (hook as QueryDef).recovery };
      }
    }
    return null;
  }

  // =========================================================================
  // Tracked QueryDB Facade — records dependencies
  // =========================================================================

  /**
   * Creates a QueryDB facade that records every access as a dependency.
   *
   * - `symbol()`, `childrenOf()`, `parentOf()`, `exportsOf()` record input deps
   * - `query()` delegates to `fetch()`, which records query deps
   */
  private createTrackedDB(): QueryDB {
    const engine = this;
    const tracker = this.activeTracker;

    return {
      symbol(id: SymbolId): SymbolEntry | undefined {
        tracker?.recordInput(id);
        return engine.resolveEntry(id);
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        tracker?.recordInput(id);
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId ?? 0);
        if (childIds) {
          for (const cid of childIds) {
            const entry = engine.resolveEntry(cid);
            if (entry) results.push(entry);
          }
        }
        // Also include virtual (specialized) entries whose parentId matches
        for (const vEntry of engine.virtualEntries.values()) {
          if (vEntry.parentId === id) results.push(vEntry);
        }
        return results;
      },

      childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[] {
        tracker?.recordInput(id);
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId ?? 0);
        if (childIds) {
          for (const cid of childIds) {
            const entry = engine.resolveEntry(cid);
            if (entry) results.push(entry);
          }
        }
        for (const vEntry of engine.virtualEntries.values()) {
          if (vEntry.parentId === id && vEntry.fieldName === fieldName) results.push(vEntry);
        }
        return results;
      },

      parentOf(id: SymbolId): SymbolEntry | undefined {
        tracker?.recordInput(id);
        const entry = engine.resolveEntry(id);
        if (!entry || entry.parentId === null) return undefined;
        tracker?.recordInput(entry.parentId);
        return engine.resolveEntry(entry.parentId);
      },

      exportsOf(id: SymbolId): SymbolEntry[] {
        return this.childrenOf(id);
      },

      query<T = unknown>(queryName: string, id: SymbolId): T {
        return engine.fetch(queryName, id) as T;
      },

      byName(name: string): SymbolEntry[] {
        tracker?.recordByName(name);
        const ids = engine.index.byName.get(name);
        if (!ids) return [];
        const results: SymbolEntry[] = [];
        for (const id of ids) {
          tracker?.recordInput(id);
          const entry = engine.resolveEntry(id);
          if (entry) results.push(entry);
        }
        return results;
      },

      allEntries(): SymbolEntry[] {
        const results = Array.from(engine.allEntries());
        for (const r of results) {
          tracker?.recordInput(r.id);
        }
        return results;
      },

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>, hashOverride?: string): T {
        const argsHash = hashOverride ?? JSON.stringify(args, Object.keys(args).sort());
        const key = engine.memoKey(queryName, id, argsHash);

        // Record compound dependency
        if (tracker) {
          tracker.dependencies.push({ kind: "query", queryName, symbolId: id, argsHash });
        }

        // Check memo
        const memo = engine.memos.get(key);
        if (memo && memo.verified_at === engine.currentRevision) {
          return memo.value as T;
        }

        // Execute (same as regular fetch but with compound key)
        return engine.fetch(queryName, id, argsHash, args) as T;
      },

      specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId {
        tracker?.recordInput(baseId);

        const cacheKey = `${baseId}:${args.hash}`;
        const existing = engine.specializeCache.get(cacheKey);
        if (existing !== undefined) return existing;

        const base = engine.resolveEntry(baseId);
        if (!base) throw new Error(`Cannot specialize unknown symbol ${baseId}`);

        const virtualId = engine.nextVirtualId--;
        const virtualEntry: SymbolEntry = {
          ...base,
          id: virtualId,
          metadata: { ...base.metadata },
        };

        engine.virtualEntries.set(virtualId, virtualEntry);
        engine.specializationArgs.set(virtualId, args as SpecializationArgs);
        engine.specializationBases.set(virtualId, baseId);
        engine.specializeCache.set(cacheKey, virtualId);
        engine.inputRevisions.set(virtualId, engine.currentRevision);

        return virtualId;
      },

      argsOf<T = unknown>(id: SymbolId): SpecializationArgs<T> | null {
        return (engine.specializationArgs.get(id) as SpecializationArgs<T>) ?? null;
      },

      baseOf(id: SymbolId): SymbolId | null {
        return engine.specializationBases.get(id) ?? null;
      },

      evaluate(expression: unknown, scopeId?: SymbolId | null): unknown {
        if (!engine.evaluator) {
          throw new Error("No expression evaluator configured on the QueryEngine");
        }
        const scope = scopeId ? (engine.resolveEntry(scopeId) ?? null) : null;
        if (scopeId) tracker?.recordInput(scopeId);
        return engine.evaluator(expression, scope, this);
      },

      cstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
        if (!engine.tree) return null;
        return engine.tree.getText(startByte, endByte, entry);
      },

      cstNode(id: SymbolId): unknown | null {
        if (!engine.tree) return null;
        const entry = engine.resolveEntry(id);
        if (!entry) return null;
        return engine.tree.getNode(entry.startByte, entry.endByte, entry);
      },

      cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
        if (!engine.tree) return null;
        return engine.tree.getNode(startByte, endByte, entry);
      },
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private memoKey(queryName: string, symbolId: SymbolId, argsHash?: string): number {
    const queryId = this.getQueryId(queryName);
    const argsId = this.getArgsId(argsHash);
    const positiveSymbolId = symbolId >= 0 ? symbolId * 2 : -symbolId * 2 - 1;
    return positiveSymbolId + queryId * 10000000 + argsId * 10000000000;
  }

  private symbolIdFromKey(key: number): SymbolId {
    const positiveSymbolId = key % 10000000;
    return positiveSymbolId % 2 === 0 ? positiveSymbolId / 2 : -(positiveSymbolId + 1) / 2;
  }

  /**
   * Resolve a symbol entry by ID, checking both real and virtual entries.
   */
  private resolveEntry(id: SymbolId): SymbolEntry | undefined {
    return this.index.symbols.get(id) ?? this.virtualEntries.get(id);
  }

  /**
   * Iterate over all entries (real + virtual).
   */
  private *allEntries(): IterableIterator<SymbolEntry> {
    yield* this.index.symbols.values();
    yield* this.virtualEntries.values();
  }
}

// ---------------------------------------------------------------------------
// Symbol entry comparison (for updateIndex change detection)
// ---------------------------------------------------------------------------

function symbolEntryEqual(a: SymbolEntry, b: SymbolEntry): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.name === b.name &&
    a.ruleName === b.ruleName &&
    a.namePath === b.namePath &&
    a.parentId === b.parentId &&
    arraysEqual(a.exports, b.exports) &&
    arraysEqual(a.inherits, b.inherits) &&
    JSON.stringify(a.metadata) === JSON.stringify(b.metadata)
  );
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
