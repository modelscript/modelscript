/* eslint-disable */
import type { LintResult } from "./index.js";
import type {
  CSTTree,
  CycleInfo,
  CycleRecoveryFn,
  DependencyKey,
  ExpressionEvaluator,
  Memo,
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

  recordQuery(queryName: string, symbolId: SymbolId): void {
    this.dependencies.push({ kind: "query", queryName, symbolId });
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

  /** Memoized query results keyed by "queryName:symbolId" or "queryName:symbolId:argsHash". */
  private memos = new Map<string, Memo>();

  /** Tracks when each input (symbol entry) was last modified. */
  private inputRevisions = new Map<SymbolId, Revision>();

  /** The active dependency tracker (non-null during query execution). */
  private activeTracker: DependencyTracker | null = null;

  /** Cycle detection: ordered list of queries currently being executed. */
  private executionStack: Array<{ key: string; queryName: string; symbolId: SymbolId }> = [];

  /** Query function hooks keyed by grammar rule name. */
  private hooksByRule: Map<string, QueryHooks>;

  // ---- Virtual entry infrastructure (specialization) ----

  /** Virtual (specialized) symbol entries. Negative IDs. */
  private virtualEntries = new Map<SymbolId, SymbolEntry>();

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
    private index: SymbolIndex,
    queryHooks: Map<string, QueryHooks>,
    options?: {
      evaluator?: ExpressionEvaluator;
      tree?: CSTTree;
    },
  ) {
    this.hooksByRule = queryHooks;
    this.evaluator = options?.evaluator ?? null;
    this.tree = options?.tree ?? null;

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
   * Notify the engine that symbols have changed.
   * Bumps the revision counter and records which inputs changed.
   *
   * **Unlike the previous implementation, this does NOT evict any cache entries.**
   * Cached memos are retained and lazily re-verified on the next `query()` call.
   *
   * @param changedSymbolIds - IDs of symbols that were added, removed, or modified.
   */
  invalidate(changedSymbolIds: Set<SymbolId>): void {
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
    this.currentRevision++;

    let hasNewSymbols = false;

    // Determine which symbols are new or changed
    for (const [id, entry] of newIndex.symbols) {
      const oldEntry = this.index.symbols.get(id);
      if (!oldEntry) hasNewSymbols = true;
      if (!oldEntry || !symbolEntryEqual(oldEntry, entry)) {
        this.inputRevisions.set(id, this.currentRevision);
      }
    }

    if (hasNewSymbols) {
      // Selectively invalidate memos that looked up names which now exist.
      // This replaces the previous nuclear memos.clear() with targeted
      // invalidation: only memos that did a byName() lookup for a name
      // that is now newly present need re-execution.
      const newNames = new Set<string>();
      for (const [id, entry] of newIndex.symbols) {
        if (!this.index.symbols.has(id)) {
          newNames.add(entry.name);
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
  swapIndex(newIndex: SymbolIndex, changedSymbolIds: Set<SymbolId>): void {
    this.index = newIndex;
    this.invalidate(changedSymbolIds);
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
        .map((id) => [id, this.index.symbols.get(id)] as [SymbolId, SymbolEntry | undefined])
        .filter((pair): pair is [SymbolId, SymbolEntry] => pair[1] !== undefined);
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
  toQueryDB(): QueryDB {
    const engine = this;

    return {
      symbol(id: SymbolId): SymbolEntry | undefined {
        return engine.resolveEntry(id);
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId);
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
        const childIds = engine.index.childrenOf.get(lookupId);
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
        return ids.map((id) => engine.resolveEntry(id)).filter(Boolean) as SymbolEntry[];
      },

      allEntries(): SymbolEntry[] {
        return Array.from(engine.allEntries());
      },

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>): T {
        return engine.fetch(queryName, id) as T;
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
    };
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
  private fetch(queryName: string, symbolId: SymbolId): unknown {
    const key = this.memoKey(queryName, symbolId);

    // Record this query as a dependency of the currently executing query
    if (this.activeTracker) {
      this.activeTracker.recordQuery(queryName, symbolId);
    }

    const memo = this.memos.get(key);

    // Fast path: already verified this revision
    if (memo && memo.verified_at === this.currentRevision) {
      return memo.value;
    }

    // Try to deep-verify: check if all dependencies are still current
    if (memo && this.deepVerify(memo)) {
      memo.verified_at = this.currentRevision;
      return memo.value;
    }

    // Must re-execute
    const { value, dependencies, byNameLookups } = this.execute(queryName, symbolId);

    // Backdating: if the result is the same, don't bump changed_at
    if (memo && shallowEqual(memo.value, value)) {
      memo.value = value;
      memo.verified_at = this.currentRevision;
      memo.dependencies = dependencies;
      memo.byNameLookups = byNameLookups.size > 0 ? byNameLookups : undefined;
      // *** changed_at stays the same — this is the backdating magic ***
      return value;
    }

    // New or changed result
    const newMemo: Memo = {
      value,
      verified_at: this.currentRevision,
      changed_at: this.currentRevision,
      dependencies,
      byNameLookups: byNameLookups.size > 0 ? byNameLookups : undefined,
    };
    this.memos.set(key, newMemo);
    return value;
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
            const rev = this.inputRevisions.get(id);
            if (rev !== undefined && rev > memo.verified_at) {
              return false; // A new symbol with this name appeared
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
    const key = this.memoKey(queryName, symbolId);
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
      const stackDesc = this.executionStack.map((f) => f.key).join(" → ");
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
      const value = queryFn(this.createTrackedDB(), entry);
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
        const childIds = engine.index.childrenOf.get(lookupId);
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
        const childIds = engine.index.childrenOf.get(lookupId);
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

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>): T {
        const argsHash = JSON.stringify(args, Object.keys(args).sort());
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
        return engine.fetch(queryName, id) as T;
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
    };
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private memoKey(queryName: string, symbolId: SymbolId, argsHash?: string): string {
    return argsHash ? `${queryName}:${symbolId}:${argsHash}` : `${queryName}:${symbolId}`;
  }

  private symbolIdFromKey(key: string): SymbolId {
    const parts = key.split(":");
    return Number(parts[1]);
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
    a.startByte === b.startByte &&
    a.endByte === b.endByte &&
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
