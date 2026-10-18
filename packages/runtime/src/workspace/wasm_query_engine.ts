// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview WebAssembly-Native Salsa Incremental Query Engine & QueryDB Bridge.
 *
 * Academic Citations:
 * - Matsakis, N. (2018). Salsa: Incremental On-Demand Computation. Rust Latin America.
 *   https://github.com/salsa-rs/salsa
 * - Hammer, M. A., Khoo, Y. P., Hicks, M., & Foster, J. S. (2014). Adapton: Composable,
 *   demand-driven incremental computation. In Proceedings of the 35th ACM SIGPLAN Conference
 *   on Programming Language Design and Implementation (PLDI '14), 281-293.
 *   https://doi.org/10.1145/2666356.2594324
 * - Demers, A., Reps, T., & Teitelbaum, T. (1981). Incremental evaluation for attribute
 *   grammars with application to syntax-directed editors. In Proceedings of the 8th ACM
 *   SIGPLAN-SIGACT Symposium on Principles of Programming Languages (POPL '81), 105-116.
 *   https://doi.org/10.1145/567532.567544
 *
 * ModelScript Architectural Rationale:
 * ModelScript's Language Server Protocol (LSP), visual IDE, and polyglot compiler require
 * sub-millisecond incremental re-analysis across multi-file Modelica libraries (such as the
 * Modelica Standard Library with 10,000+ classes) and SysML v2 / KerML taxonomies. Full recompilation
 * on every keystroke is intractable. The Salsa query engine decomposes compilation into pure,
 * memoized queries with fine-grained dependency tracking. Using the Red-Green algorithm with
 * early cut-off (backdating), when a source file is edited, only queries depending on invalidated
 * CST ranges or symbol entries are recomputed; unchanged downstream semantic derivations remain valid.
 *
 * ModelScript Modifications:
 * - Bridges high-level TypeScript query definitions with WebAssembly linear memory dependency
 *   graphs (`WasmWorkspaceIndex`) and linear CST nodes (`db.cstNode()`).
 * - Employs zero-GC linear memory handles and integer symbol IDs (`SymbolId`) rather than heavy
 *   AST objects to eliminate garbage collection pressure in the IDE thread.
 * - Integrates semantic query hooks (`lint__*`) directly into the Salsa dependency graph to provide
 *   demand-driven, incremental compiler diagnostics.
 */

import { TaxonomyIndex } from "@modelscript/dsl";
import {
  type CSTTree,
  type DependencyKey,
  type ExpressionEvaluator,
  getLanguageDomainId,
  getSymbolDomain,
  LanguageDomainId,
  type Memo,
  type ParityReport,
  type QueryCacheStore,
  type QueryDB,
  type QueryFn,
  type QueryHooks,
  type Revision,
  type ShapeBinding,
  type SpecializationArgs,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../runtime.js";

// -- Public Types --

/**
 * Raw diagnostic result returned by a `lint__*` semantic query hook before byte/offset
 * spans are resolved against the target `SymbolEntry`.
 */
export interface LintResult {
  /** Human-readable diagnostic message text. */
  message: string;
  /** Diagnostic severity level. */
  severity: "error" | "warning" | "info" | "hint";
  /** Optional explicit start byte offset in the source document. */
  startByte?: number | undefined;
  /** Optional explicit end byte offset in the source document. */
  endByte?: number | undefined;
  /** Optional explicit start character offset in the source document. */
  startOffset?: number | undefined;
  /** Optional explicit end character offset in the source document. */
  endOffset?: number | undefined;
  /** Optional named CST field on the symbol entry to highlight (e.g. `"name"`). */
  field?: string | undefined;
  /** Optional numeric compiler error/lint code (e.g. `3001` for `M3001`). */
  code?: number | undefined;
}

/**
 * Error thrown when an asynchronous or cooperative query/lint evaluation is preempted
 * by a newer workspace edit or cancellation token.
 */
export class QueryCancelledError extends Error {
  /** Creates a new `QueryCancelledError` with an optional custom message. */
  constructor(message = "Query computation was cancelled") {
    super(message);
    this.name = "QueryCancelledError";
  }
}

/**
 * Resolved semantic lint diagnostic associated with a specific `SymbolId` and source span.
 */
export interface LintDiagnostic {
  /** Target symbol ID that produced the diagnostic. */
  symbolId: SymbolId;
  /** Resolved start byte offset in the source document. */
  startByte: number;
  /** Resolved end byte offset in the source document. */
  endByte: number;
  /** Resolved start character offset in the source document. */
  startOffset?: number | undefined;
  /** Resolved end character offset in the source document. */
  endOffset?: number | undefined;
  /** Formatted diagnostic message text. */
  message: string;
  /** Diagnostic severity level. */
  severity: "error" | "warning" | "info" | "hint";
  /** Unprefixed name of the lint hook that emitted the diagnostic. */
  lintName: string;
  /** Optional numeric compiler error/lint code. */
  code?: number | undefined;
}

// -- Dependency Tracker --

/**
 * Per-frame dependency collector active during a single `WasmQueryEngine.execute()` invocation.
 *
 * Records all symbol inputs, derived sub-queries, `byName` table lookups, and polyglot
 * language domain revisions read while computing a query's value so Salsa's `deepVerify`
 * and reverse-dependency invalidation can track exact fine-grained dependencies.
 */
class DependencyTracker {
  /** Ordered list of dependency keys read during the current query execution. */
  readonly dependencies: DependencyKey[] = [];
  /** Set of symbol names queried via `byName()` during the current query execution. */
  readonly byNameLookups = new Set<string>();

  /** Records a direct dependency on a symbol entry's input state. */
  recordInput(symbolId: SymbolId): void {
    this.dependencies.push({ kind: "input", symbolId });
  }

  /** Records a dependency on another derived Salsa query (and optional serialized argument hash). */
  recordQuery(queryName: string, symbolId: SymbolId, argsHash?: string): void {
    this.dependencies.push({ kind: "query", queryName, symbolId, argsHash });
  }

  /** Records a dependency on the global `byName` symbol resolution table for `name`. */
  recordByName(name: string): void {
    this.byNameLookups.add(name);
    this.dependencies.push({ kind: "byName", name });
  }

  /** Records a dependency on a polyglot language domain's revision counter. */
  recordDomain(domain: LanguageDomainId): void {
    this.dependencies.push({ kind: "domain", domain });
  }
}

/**
 * Bounded recursive structural equality check used by Salsa backdating to determine
 * whether a recomputed query value is equivalent to its prior memoized result.
 */
function shallowEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (depth > 10) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shallowEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false;

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const valA = (a as Record<string, unknown>)[key];
    const valB = (b as Record<string, unknown>)[key];
    if (valA !== valB && !shallowEqual(valA, valB, depth + 1)) return false;
  }

  return true;
}

/**
 * Produces a deterministic, key-sorted JSON serialization of parameterized query arguments
 * (or returns `hashOverride` directly if supplied by the caller).
 */
function stableStringifyArgs(args: Record<string, unknown>, hashOverride?: string): string {
  if (hashOverride !== undefined) return hashOverride;
  return JSON.stringify(args, (_key, value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value)
          .sort()
          .reduce(
            (acc, k) => {
              acc[k] = (value as Record<string, unknown>)[k];
              return acc;
            },
            {} as Record<string, unknown>,
          )
      : value,
  );
}

// -- Canonical QueryEngine Implementation --

/**
 * WebAssembly-native Salsa incremental query engine (`QueryEngine`).
 *
 * Manages demand-driven memoized semantic queries (`instantiate`, `classInstance`,
 * `resolveSimpleName`, `variability`, `causality`, `effectiveModification`, and `lint__*` hooks)
 * over a `SymbolIndex` and `CSTTree` using the Salsa Red-Green verification algorithm
 * with early cut-off (backdating) and reverse-dependency invalidation.
 */
export class WasmQueryEngine {
  /** Monotonically increasing global revision counter incremented on every input invalidation. */
  public currentRevision: Revision = 0;
  /** Primary Salsa memoization table mapping 53-bit packed numeric query keys to cached `Memo` entries. */
  private memos = new Map<number, Memo>();
  /** Random unique identifier for this query engine instance (used for debugging and cache isolation). */
  public instanceId = Math.random();

  /** Next sequential integer ID to assign to a newly encountered query name. */
  private static nextQueryId = 1;
  /** Global intern table mapping query names (e.g. `"instantiate"`, `"variability"`) to compact integer IDs. */
  private static queryIds = new Map<string, number>();

  /** Returns or assigns a compact interned integer ID for `queryName`. */
  private getQueryId(queryName: string): number {
    let id = WasmQueryEngine.queryIds.get(queryName);
    if (id === undefined) {
      id = WasmQueryEngine.nextQueryId++;
      WasmQueryEngine.queryIds.set(queryName, id);
    }
    return id;
  }

  /** Next sequential integer ID to assign to a newly encountered parameterized query argument hash. */
  private static nextArgsId = 1;
  /** Global intern table mapping canonicalized query argument hashes to compact integer IDs. */
  private static argsIds = new Map<string, number>();

  /** Returns or assigns a compact interned integer ID for a serialized `argsHash` (`0` if unparameterized). */
  private getArgsId(argsHash?: string): number {
    if (!argsHash) return 0;
    let id = WasmQueryEngine.argsIds.get(argsHash);
    if (id === undefined) {
      id = WasmQueryEngine.nextArgsId++;
      WasmQueryEngine.argsIds.set(argsHash, id);
    }
    return id;
  }

  /** Optional persistent external cache store (e.g. IndexedDB / disk cache) for preflight memo hydration. */
  private cacheStore?: QueryCacheStore | undefined;
  /** Maximum number of memoized query entries retained before FIFO eviction triggers. */
  private maxMemos: number;

  /** Ontological taxonomy index for subtype and classification queries across polyglot domains. */
  public taxonomy: TaxonomyIndex = new TaxonomyIndex();

  /** Reverse dependency graph mapping each input `SymbolId` to the set of packed memo keys that read it. */
  private inputReverseDependencies = new Map<SymbolId, Set<number>>();
  /** Reverse dependency graph mapping symbol names to the set of packed memo keys that queried `byName(name)`. */
  private byNameReverseDependencies = new Map<string, Set<number>>();
  /** Revision table tracking when each symbol name's `byName` lookup set was last modified. */
  private byNameRevisions = new Map<string, Revision>();
  /** Snapshot of the last known name for each `SymbolId` to detect renames during `updateIndex`/`invalidate`. */
  private symbolNames = new Map<SymbolId, string>();

  /** Optional cross-language TGG correspondence index linking symbols across polyglot domains. */
  private correspondenceIndex?: any;
  /** Mapping from `SymbolId` to its slot index within `correspondenceIndex` for cascading staleness propagation. */
  private correspondenceSlotMap?: Map<SymbolId, number> | undefined;

  /** Attaches a cross-language Triple Graph Grammar (TGG) correspondence index and optional symbol-to-slot map. */
  public setCorrespondenceIndex(corr: any, slotMap?: Map<SymbolId, number>): void {
    this.correspondenceIndex = corr;
    if (slotMap) this.correspondenceSlotMap = slotMap;
  }

  /** Returns the currently attached cross-language TGG correspondence index, if any. */
  public getCorrespondenceIndex(): any {
    return this.correspondenceIndex;
  }

  /** Associates a `SymbolId` with a slot index in the TGG correspondence index for cascading invalidation. */
  public mapSymbolToCorrespondenceSlot(symbolId: SymbolId, slot: number): void {
    if (!this.correspondenceSlotMap) {
      this.correspondenceSlotMap = new Map();
    }
    this.correspondenceSlotMap.set(symbolId, slot);
  }

  /** Set of query names considered volatile whose memos can be bulk-purged via `flushVolatile()`. */
  public volatileQueryNames = new Set<string>([
    "arrayDimensions",
    "effectiveModification",
    "isProtected",
    "isFinal",
    "isEvaluate",
    "isOuter",
    "isInner",
    "isReplaceable",
    "isConnectorType",
    "flowPrefix",
    "causality",
    "variability",
    "classInstance",
    "resolvedArrayDimensions",
  ]);

  /** Marks a query name as volatile so its memoized results are cleared when `flushVolatile()` is called. */
  public markVolatile(queryName: string): void {
    this.volatileQueryNames.add(queryName);
  }

  /** Purges all memoized entries belonging to queries registered in `volatileQueryNames`. */
  public flushVolatile(): void {
    const volatileIds = new Set<number>();
    for (const name of this.volatileQueryNames) {
      const id = WasmQueryEngine.queryIds.get(name);
      if (id !== undefined) volatileIds.add(id);
    }
    if (volatileIds.size === 0) return;

    for (const key of this.memos.keys()) {
      const queryId = Math.floor(key / 100000) % 1000;
      if (volatileIds.has(queryId)) {
        this.memos.delete(key);
      }
    }
  }

  /**
   * Invalidates all cached memos that depend on `byName(name)` lookups, advancing
   * the name's revision to `currentRevision` and marking dependent symbols dirty for re-linting.
   */
  public invalidateByName(name: string): void {
    if (!name) return;
    this.byNameRevisions.set(name, this.currentRevision);
    const dependentKeys = this.byNameReverseDependencies.get(name);
    if (dependentKeys) {
      for (const key of dependentKeys) {
        this.memos.delete(key);
        const depSymId = this.symbolIdFromKey(key);
        for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
          cacheDirtySet.add(depSymId);
        }
      }
    }
  }

  /** Per-symbol revision counter recording the last `currentRevision` at which each `SymbolId` was modified. */
  private inputRevisions = new Map<SymbolId, Revision>();
  /** Per-domain revision counter tracking modifications across polyglot `LanguageDomainId` partitions. */
  private domainRevisions = new Map<LanguageDomainId, Revision>();

  /** Returns the current revision number for a specific polyglot `LanguageDomainId`. */
  public getDomainRevision(domain: LanguageDomainId): Revision {
    return this.domainRevisions.get(domain) ?? 0;
  }

  /** Increments and returns the revision counter for a specific polyglot `LanguageDomainId`. */
  public incrementDomainRevision(domain: LanguageDomainId): Revision {
    const next = (this.domainRevisions.get(domain) ?? 0) + 1;
    this.domainRevisions.set(domain, next);
    return next;
  }

  /** Checks whether the specified `LanguageDomainId` has been modified since `sinceRevision`. */
  public hasDomainChanged(domain: LanguageDomainId, sinceRevision: Revision): boolean {
    return (this.domainRevisions.get(domain) ?? 0) > sinceRevision;
  }

  /** Bumps the global and domain revisions and marks all symbols in `domain` as modified at `currentRevision`. */
  public invalidateDomain(domain: LanguageDomainId): void {
    this.currentRevision++;
    this.incrementDomainRevision(domain);
    for (const id of this.index.symbols.keys()) {
      if (getSymbolDomain(id) === domain) {
        this.inputRevisions.set(id, this.currentRevision);
      }
    }
  }

  /** Cached lint diagnostics grouped by resource URI (`"__all__"` or document URI) and `SymbolId`. */
  private lintCache = new Map<string, Map<SymbolId, LintDiagnostic[]>>();
  /** Set of `SymbolId`s whose cached lint results are dirty and require re-evaluation per resource key. */
  private dirtyLintSymbols = new Map<string, Set<SymbolId>>();
  /** Revision at which each resource URI's lint cache was last synchronized. */
  public lintCacheRevision = new Map<string, Revision>();

  /** Currently active dependency tracker collecting inputs and sub-queries during `execute()`. */
  private activeTracker: DependencyTracker | null = null;
  /** Call stack of currently executing queries used to detect and recover from dependency cycles. */
  private executionStack: { key: number; queryName: string; symbolId: SymbolId }[] = [];
  /** Set of packed memo keys currently undergoing `deepVerify` to guard against verification cycles. */
  private activeVerifications = new Set<number>();
  /** Grammar rule name -> `QueryHooks` dispatch table registered for this language engine. */
  private hooksByRule: Map<string, QueryHooks>;

  // Virtual entry infrastructure (specialization)
  /** Synthetic `SymbolEntry` instances allocated via `db.specialize()` (indexed by negative `SymbolId`). */
  private virtualEntries = new Map<SymbolId, SymbolEntry>();
  /** Specialization arguments associated with each negative virtual `SymbolId`. */
  private specializationArgs = new Map<SymbolId, SpecializationArgs>();
  /** Mapping from specialized virtual `SymbolId` back to its unspecialized base `SymbolId`. */
  private specializationBases = new Map<SymbolId, SymbolId>();
  /** Deduping cache mapping `"${baseId}:${args.hash}"` to an existing negative virtual `SymbolId`. */
  private specializeCache = new Map<string, SymbolId>();
  /** Monotonically decreasing counter (`-1, -2, ...`) for allocating virtual specialized `SymbolId`s. */
  private nextVirtualId: SymbolId = -1;

  /** Optional callback for evaluating constant/parameter AST expressions within `db.evaluate()`. */
  private evaluator: ExpressionEvaluator | null;
  /** Backing syntax tree (`CSTTree`) used to recover CST nodes and source text slices by byte range. */
  private tree: CSTTree | null;

  /**
   * Constructs a new `WasmQueryEngine` bound to a `SymbolIndex` and grammar rule `queryHooks` map.
   *
   * @param index Initial symbol table snapshot.
   * @param queryHooks Map from grammar rule name to semantic and `lint__*` query hook definitions.
   * @param options Optional expression evaluator, backing CST tree, external cache store, and memo limit.
   */
  constructor(
    public index: SymbolIndex,
    queryHooks: Map<string, QueryHooks>,
    options?: {
      evaluator?: ExpressionEvaluator | undefined;
      tree?: CSTTree | undefined;
      cacheStore?: QueryCacheStore | undefined;
      maxMemos?: number | undefined;
    },
  ) {
    this.hooksByRule = queryHooks;
    this.evaluator = options?.evaluator ?? null;
    this.tree = options?.tree ?? null;
    this.cacheStore = options?.cacheStore;
    this.maxMemos = options?.maxMemos ?? 2_000_000;

    for (const [id, entry] of this.index.symbols.entries()) {
      this.inputRevisions.set(id, 0);
      this.symbolNames.set(id, entry.name);
    }
  }

  /** Returns the currently attached backing `CSTTree`, or `null` if none is set. */
  getTree(): CSTTree | null {
    return this.tree;
  }

  /** Updates the backing `CSTTree` used for CST node and text slice recovery. */
  setTree(tree: CSTTree | null): void {
    this.tree = tree;
  }

  /** Returns the current global Salsa revision counter (`currentRevision`). */
  getRevision(): Revision {
    return this.currentRevision;
  }

  /** Returns the total number of memoized query entries currently stored in `memos`. */
  getMemoCount(): number {
    return this.memos.size;
  }

  /** Returns a shallow clone of the internal memoization map for snapshotting or persistence. */
  public dumpMemos(): Map<number, Memo> {
    return new Map(this.memos);
  }

  /** Hydrates pre-computed `Memo` entries into the internal memoization table. */
  public hydrateMemos(memos: Map<number, Memo>): void {
    for (const [key, memo] of memos) {
      this.memos.set(key, memo);
    }
  }

  /** Looks up the raw `Memo` record for `(queryName, symbolId, argsHash)` without triggering evaluation. */
  public getMemoFor(queryName: string, symbolId: SymbolId, argsHash?: string): Memo | undefined {
    const key = this.memoKey(queryName, symbolId, argsHash);
    return this.memos.get(key);
  }

  /**
   * Packs a `(queryName, symbolId, argsHash)` tuple into a collision-free 53-bit safe integer key
   * (conceptually analogous to `(queryIdx + 1) * 0x100000000 + symbolId`, extended with decimal
   * bit-field slots to accommodate polyglot domain prefixes, parameterized `argsHash` IDs, and
   * negative virtual symbol IDs within IEEE-754 double precision).
   *
   * Layout in decimal digits:
   * - `[compactSym] * 100_000_000`: 5-bit language domain (`absSymbolId >>> 24`) * 2,000,000 + 24-bit local sequence
   * - `(qId % 1000) * 100_000`: 3-digit interned query ID
   * - `(aId % 10_000) * 10`: 4-digit interned `argsHash` ID
   * - `signBit`: `1` if `symbolId < 0` (virtual specialized symbol), `0` otherwise
   */
  public memoKey(queryName: string, symbolId: SymbolId, argsHash?: string): number {
    // Intern the query name and optional serialized arguments into small integer IDs.
    const qId = this.getQueryId(queryName);
    const aId = this.getArgsId(argsHash);
    // Extract sign bit for virtual (negative) SymbolIds and fold domain + local symbol sequence into `compactSym`.
    const absSymbolId = Math.abs(symbolId);
    const signBit = symbolId < 0 ? 1 : 0;
    const compactSym = ((absSymbolId >>> 24) & 0x1f) * 2_000_000 + ((absSymbolId & 0x00ff_ffff) % 2_000_000);
    // Combine all fields into a single 53-bit safe integer key for fast Map lookup without string allocation.
    return compactSym * 100_000_000 + (qId % 1000) * 100_000 + (aId % 10_000) * 10 + signBit;
  }

  /** Decodes and reconstructs the original `SymbolId` (including polyglot domain bits and sign) from a packed memo key. */
  private symbolIdFromKey(key: number): SymbolId {
    const compactSym = Math.floor(key / 100_000_000);
    const domain = Math.floor(compactSym / 2_000_000);
    const localSeq = compactSym % 2_000_000;
    const absSymbolId = domain > 0 ? (((domain & 0x1f) << 24) | localSeq) >>> 0 : localSeq;
    const signBit = key % 10;
    return signBit === 1 ? -absSymbolId : absSymbolId;
  }

  /** Resolves a `SymbolId` (either a regular indexed ID or a negative virtual specialized ID) to its `SymbolEntry`. */
  public resolveEntry(id: SymbolId): SymbolEntry | undefined {
    const resolvedId = typeof id === "object" && id !== null && "id" in (id as any) ? (id as any).id : id;
    if (resolvedId < 0) {
      return this.virtualEntries.get(resolvedId) ?? this.index.symbols.get(resolvedId);
    }
    return this.index.symbols.get(resolvedId);
  }

  /** Iterates over all symbol entries in both the primary `SymbolIndex` and the specialized `virtualEntries` table. */
  public *allEntries(): IterableIterator<SymbolEntry> {
    for (const entry of this.index.symbols.values()) {
      yield entry;
    }
    for (const entry of this.virtualEntries.values()) {
      yield entry;
    }
  }

  /** Extracts raw source text for the byte/character span `[startByte, endByte]` from the backing CST or document store. */
  public getCstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
    const start = startByte !== undefined ? startByte : entry ? (entry.startOffset ?? entry.startByte) : 0;
    const end = endByte !== undefined ? endByte : entry ? (entry.endOffset ?? entry.endByte) : 0;
    if (this.tree && typeof (this.tree as any).getText === "function") {
      const text = (this.tree as any).getText(start, end, entry);
      if (text !== null && text !== undefined) return text;
    }
    if (entry?.resourceId && (this.index as any).documents) {
      const doc = (this.index as any).documents.get(entry.resourceId);
      if (doc && typeof doc.getText === "function") {
        return doc.getText().substring(start, end);
      }
    }
    if (this.tree && (this.tree as any).rootNode) {
      const root = (this.tree as any).rootNode;
      const text = root.text ?? root.tree?.text;
      if (typeof text === "string" && start >= 0 && end <= text.length) {
        return text.substring(start, end);
      }
    }
    return null;
  }

  /** Recovers the linear CST node corresponding to `id`'s recorded byte range. */
  public getCstNode(id: SymbolId): unknown | null {
    const entry = this.resolveEntry(id);
    if (!entry) return null;
    return this.getCstNodeRange(entry.startOffset ?? entry.startByte, entry.endOffset ?? entry.endByte, entry);
  }

  /** Recovers the smallest CST node enclosing `[startByte, endByte]` from the backing syntax tree. */
  public getCstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
    const start = startByte !== undefined ? startByte : entry ? (entry.startOffset ?? entry.startByte) : 0;
    const end = endByte !== undefined ? endByte : entry ? (entry.endOffset ?? entry.endByte) : 0;
    let treeToUse = this.tree;
    if (entry?.resourceId && (this.index as any).documents) {
      const doc = (this.index as any).documents.get(entry.resourceId);
      if (doc && doc.tree) {
        treeToUse = doc.tree;
      }
    }
    if (treeToUse && typeof (treeToUse as any).getNode === "function") {
      const node = (treeToUse as any).getNode(start, end, entry);
      if (node) return node;
    }
    if (treeToUse && (treeToUse as any).rootNode) {
      const root = (treeToUse as any).rootNode;
      if (typeof root.descendantForIndex === "function") {
        return root.descendantForIndex(start, end);
      }
      if (typeof root.descendantForByteRange === "function") {
        return root.descendantForByteRange(start, end);
      }
      const findNode = (n: any): any | null => {
        const s = n.startOffset ?? n.startIndex ?? n.startByte ?? -1;
        const e = n.endOffset ?? n.endIndex ?? n.endByte ?? -1;
        if (s === start && e === end) return n;
        for (const c of n.children || []) {
          const cs = c.startOffset ?? c.startIndex ?? c.startByte ?? -1;
          const ce = c.endOffset ?? c.endIndex ?? c.endByte ?? -1;
          if (cs <= start && ce >= end) {
            const found = findNode(c);
            if (found) return found;
          }
        }
        return s <= start && e >= end ? n : null;
      };
      return findNode(root);
    }
    return null;
  }

  /** Alias for `getCstText` conforming to the `QueryDB` interface. */
  public cstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
    return this.getCstText(startByte, endByte, entry);
  }

  /** Alias for `getCstNode` conforming to the `QueryDB` interface. */
  public cstNode(id: SymbolId): unknown | null {
    return this.getCstNode(id);
  }

  /** Alias for `getCstNodeRange` conforming to the `QueryDB` interface. */
  public cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
    return this.getCstNodeRange(startByte, endByte, entry);
  }

  /** Evaluates or fetches the memoized result of `queryName` for `id`. */
  public query<T = unknown>(queryName: string, id: SymbolId): T {
    return this.fetch(queryName, id) as T;
  }

  /** Evaluates or fetches the memoized result of a parameterized query `queryName` for `id` with `args`. */
  public queryWith<T = unknown>(
    queryName: string,
    id: SymbolId,
    args: Record<string, unknown>,
    hashOverride?: string,
  ): T {
    const argsHash = stableStringifyArgs(args, hashOverride);
    return this.fetch(queryName, id, argsHash, args) as T;
  }

  /** Replaces the backing syntax tree reference (`this.tree`). */
  public updateTree(tree: CSTTree | null): void {
    this.tree = tree;
  }

  /**
   * Updates the backing `SymbolIndex` after a workspace re-index and triggers incremental
   * Salsa invalidation for all added, removed, or modified symbols.
   *
   * When `explicitChangedIds` is omitted or empty, diffs `newIndex` against `this.index`
   * and `this.symbolNames` to automatically detect deleted symbols, newly inserted symbols,
   * span shifts, structural hierarchy changes, and symbol renames.
   *
   * @param newIndex Updated `SymbolIndex` snapshot.
   * @param _resourceId Optional resource URI that triggered the update.
   * @param explicitChangedIds Pre-computed set of modified `SymbolId`s from incremental CST indexing.
   * @param structuralChangedIds Subset of `SymbolId`s whose structural signature or child list changed.
   */
  public updateIndex(
    newIndex: SymbolIndex,
    _resourceId?: string,
    explicitChangedIds?: Set<SymbolId>,
    structuralChangedIds?: Set<SymbolId>,
  ): void {
    const changedIds = explicitChangedIds ? new Set<SymbolId>(explicitChangedIds) : new Set<SymbolId>();
    const changedNames = new Set<string>();

    // If the caller did not supply explicit changed symbol IDs, compute the diff between the old and new index.
    if (!explicitChangedIds || explicitChangedIds.size === 0) {
      // 1. Detect symbols present in the old index that were deleted in `newIndex`.
      if (this.index !== newIndex) {
        for (const [id, oldEntry] of this.index.symbols) {
          if (!newIndex.symbols.has(id)) {
            changedIds.add(id);
            if (oldEntry.name) changedNames.add(oldEntry.name);
          }
        }
      }
      // 2. Also check `symbolNames` in case `this.index` was mutated in-place before `updateIndex` was called.
      for (const [id, prevName] of this.symbolNames) {
        if (!newIndex.symbols.has(id)) {
          changedIds.add(id);
          if (prevName) changedNames.add(prevName);
        }
      }
      // 3. Detect newly added symbols or existing symbols whose byte spans, kind, parent, rule, or name changed.
      for (const [id, entry] of newIndex.symbols) {
        const old = this.index !== newIndex ? this.index.symbols.get(id) : undefined;
        const prevName = old?.name ?? this.symbolNames.get(id);
        if (!old && prevName === undefined) {
          changedIds.add(id);
          if (entry.name) changedNames.add(entry.name);
        } else if (
          (old &&
            ((old.startOffset ?? old.startByte) !== (entry.startOffset ?? entry.startByte) ||
              (old.endOffset ?? old.endByte) !== (entry.endOffset ?? entry.endByte) ||
              old.name !== entry.name ||
              old.kind !== entry.kind ||
              old.parentId !== entry.parentId ||
              old.ruleName !== entry.ruleName)) ||
          (prevName !== undefined && prevName !== entry.name)
        ) {
          changedIds.add(id);
          if (entry.name) changedNames.add(entry.name);
          if (prevName) changedNames.add(prevName);
        }
      }
    }

    // Swap in the new symbol index and propagate invalidations through the reverse dependency graph.
    this.index = newIndex;
    this.invalidate(changedIds, structuralChangedIds, changedNames);
  }

  /**
   * Pre-warms the memoization table for a batch of `symbolIds` and `queryNames`,
   * hydrating from `cacheStore` if configured before executing `fetch()` on each pair.
   */
  public async preflight(symbolIds: SymbolId[], queryNames?: string[]): Promise<void> {
    if (this.cacheStore && queryNames && queryNames.length > 0 && symbolIds.length > 0) {
      const keys: number[] = [];
      for (const id of symbolIds) {
        for (const q of queryNames) {
          keys.push(this.memoKey(q, id));
        }
      }
      try {
        const cached = await this.cacheStore.getMemos(keys);
        if (cached && cached.size > 0) {
          this.hydrateMemos(cached);
        }
      } catch {
        /* ignore cache preflight errors */
      }
    }

    for (const id of symbolIds) {
      if (queryNames) {
        for (const q of queryNames) {
          try {
            this.fetch(q, id);
          } catch {}
        }
      }
    }
  }

  /**
   * Advances `currentRevision` and propagates invalidations through the reverse dependency
   * graphs (`inputReverseDependencies`, `byNameReverseDependencies`, lint caches, and polyglot
   * correspondence slots).
   *
   * - Updates `inputRevisions` for all `changedSymbolIds` so `deepVerify` can detect stale inputs.
   * - Evicts memos that directly depend on `byName` lookups for added/renamed/deleted symbol names.
   * - Eagerly evicts memos in `inputReverseDependencies` for `structuralChangedIds`.
   * - Marks affected symbols and their reverse dependents dirty in `dirtyLintSymbols`.
   *
   * @param changedSymbolIds Symbols whose CST range or content changed.
   * @param structuralChangedIds Symbols whose structural signature or children changed.
   * @param changedNames Symbol names whose `byName` resolution set changed.
   */
  public invalidate(
    changedSymbolIds: Set<SymbolId> | SymbolId[],
    structuralChangedIds?: Set<SymbolId>,
    changedNames?: Set<string>,
  ): void {
    // Bump global Salsa revision counter.
    this.currentRevision++;
    const ids = changedSymbolIds instanceof Set ? changedSymbolIds : new Set(changedSymbolIds);

    // Step 1: Bump per-symbol input revisions, domain revisions, and invalidate `byName` reverse dependencies
    // whenever a symbol is newly added, renamed, or deleted.
    for (const id of ids) {
      this.inputRevisions.set(id, this.currentRevision);
      const domain = getSymbolDomain(id);
      if (domain !== LanguageDomainId.Default) {
        this.incrementDomainRevision(domain);
      }
      const entry = this.index.symbols.get(id);
      const prevName = this.symbolNames.get(id);
      if (entry) {
        if (prevName === undefined) {
          if (entry.name) this.invalidateByName(entry.name);
        } else if (prevName !== entry.name) {
          if (entry.name) this.invalidateByName(entry.name);
          if (prevName) this.invalidateByName(prevName);
        }
        this.symbolNames.set(id, entry.name);
      } else if (prevName) {
        this.invalidateByName(prevName);
        this.symbolNames.delete(id);
      }
    }

    // Step 2: Invalidate any explicit symbol names reported by the caller.
    if (changedNames) {
      for (const name of changedNames) {
        this.invalidateByName(name);
      }
    }

    // Step 3: Traverse `inputReverseDependencies` for structurally changed symbols,
    // evicting dependent memos and marking their target symbols dirty for re-linting.
    if (structuralChangedIds) {
      for (const id of structuralChangedIds) {
        const dependentKeys = this.inputReverseDependencies.get(id);
        if (dependentKeys) {
          for (const key of dependentKeys) {
            this.memos.delete(key);
            const depSymId = this.symbolIdFromKey(key);
            for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
              cacheDirtySet.add(depSymId);
            }
          }
        }
        const entry = this.index.symbols.get(id);
        if (entry?.name) {
          this.invalidateByName(entry.name);
        }
      }
    }

    // Step 4: Mark all changed symbols and their direct input reverse dependents dirty in the incremental lint caches.
    for (const id of ids) {
      for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
        cacheDirtySet.add(id);
      }
      const dependentKeys = this.inputReverseDependencies.get(id);
      if (dependentKeys) {
        for (const key of dependentKeys) {
          const depSymId = this.symbolIdFromKey(key);
          for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
            cacheDirtySet.add(depSymId);
          }
        }
      }
    }

    // Step 5: Propagate staleness across cross-domain TGG correspondence links if configured.
    if (this.correspondenceIndex) {
      for (const id of ids) {
        if (typeof this.correspondenceIndex.markStale === "function") {
          this.correspondenceIndex.markStale(id);
        }
        const parentSlot = this.correspondenceSlotMap?.get(id);
        if (parentSlot !== undefined && typeof this.correspondenceIndex.markStaleCascading === "function") {
          this.correspondenceIndex.markStaleCascading(parentSlot);
        }
      }
    }
  }

  /** Replaces `this.index` with `newIndex` and immediately invalidates `changedSymbolIds` (and optional `structuralChangedIds`). */
  public swapIndex(newIndex: SymbolIndex, changedSymbolIds: Set<SymbolId>, structuralChangedIds?: Set<SymbolId>): void {
    this.index = newIndex;
    if (structuralChangedIds) {
      this.invalidate(changedSymbolIds, structuralChangedIds);
    } else {
      this.invalidate(changedSymbolIds);
    }
  }

  /** Executes all `lint__*` query hooks registered for `symbolId`'s grammar rule and returns their raw `LintResult`s. */
  public runLints(symbolId: SymbolId): { lintName: string; result: LintResult }[] {
    const entry = this.resolveEntry(symbolId);
    if (!entry) return [];
    const hooks = this.hooksByRule.get(entry.ruleName);
    if (!hooks) return [];

    const results: { lintName: string; result: LintResult }[] = [];
    for (const key of Object.keys(hooks)) {
      if (!key.startsWith(WasmQueryEngine.LINT_PREFIX)) continue;
      const lintName = key.slice(WasmQueryEngine.LINT_PREFIX.length);
      try {
        const result = this.fetch(key, symbolId) as LintResult | LintResult[] | null;
        if (result) {
          if (Array.isArray(result)) {
            for (const r of result) results.push({ lintName, result: r });
          } else {
            results.push({ lintName, result });
          }
        }
      } catch (e: any) {
        console.warn(`[lint] ${lintName} failed for ${entry.name}: ${e?.stack ?? e}`);
      }
    }
    return results;
  }

  /** Standard prefix (`"lint__"`) identifying semantic linter hooks in `QueryHooks`. */
  static readonly LINT_PREFIX = "lint__";

  /**
   * Registers an incremental lint hook for a specific AST rule or grammar construct.
   *
   * @param ruleName Target rule name (e.g. "AssemblyDefinition", "RequirementDefinition")
   * @param lintName Identifier for the linter (e.g. "cad_clearance", "parametric_bounds")
   * @param fn Lint evaluation function returning LintResult or LintResult[]
   */
  public registerLintHook(ruleName: string, lintName: string, fn: QueryFn): void {
    let hooks = this.hooksByRule.get(ruleName);
    if (!hooks) {
      hooks = {};
      this.hooksByRule.set(ruleName, hooks);
    }
    const hookKey = lintName.startsWith(WasmQueryEngine.LINT_PREFIX)
      ? lintName
      : `${WasmQueryEngine.LINT_PREFIX}${lintName}`;
    hooks[hookKey] = fn;
  }

  /**
   * Resolves the precise byte and character offset range for a `LintResult` against its `SymbolEntry`,
   * preferring explicit `result` spans, named `fieldRanges[result.field]`, identifier field ranges,
   * and finally the full symbol entry span.
   */
  private resolveLintDiagnosticRange(
    entry: SymbolEntry,
    result: LintResult,
  ): {
    startByte: number;
    endByte: number;
    startOffset: number;
    endOffset: number;
  } {
    const entryStart = entry.startOffset ?? entry.startByte;
    const entryEnd = entry.endOffset ?? entry.endByte;
    const rStart = result.startOffset ?? (result as any).startCharOffset ?? result.startByte;
    const rEnd = result.endOffset ?? (result as any).endCharOffset ?? result.endByte;
    const isWholeEntryRange = rStart === entryStart && rEnd === entryEnd;

    if (rStart !== undefined && rEnd !== undefined && rEnd >= rStart && !isWholeEntryRange) {
      const startByte = result.startByte ?? rStart;
      const endByte = result.endByte ?? rEnd;
      return { startByte, endByte, startOffset: rStart, endOffset: rEnd };
    }

    const fieldRange = result.field ? entry.fieldRanges?.[result.field] : undefined;
    if (fieldRange) {
      const startOffset = fieldRange.startOffset ?? fieldRange.startByte;
      const endOffset = fieldRange.endOffset ?? fieldRange.endByte;
      return {
        startByte: fieldRange.startByte ?? startOffset,
        endByte: fieldRange.endByte ?? endOffset,
        startOffset,
        endOffset,
      };
    }

    const fallbackField =
      entry.fieldRanges?.["declaredName"] ?? entry.fieldRanges?.["name"] ?? entry.fieldRanges?.["id"];
    if (fallbackField) {
      const startOffset = fallbackField.startOffset ?? fallbackField.startByte;
      const endOffset = fallbackField.endOffset ?? fallbackField.endByte;
      return {
        startByte: fallbackField.startByte ?? startOffset,
        endByte: fallbackField.endByte ?? endOffset,
        startOffset,
        endOffset,
      };
    }

    return {
      startByte: entry.startByte ?? entryStart,
      endByte: entry.endByte ?? entryEnd,
      startOffset: entryStart,
      endOffset: entryEnd,
    };
  }

  /**
   * Synchronously runs all registered `lint__*` hooks across all symbols in the index
   * (or restricted to `resourceId` when provided) and returns resolved `LintDiagnostic`s.
   */
  public runAllLints(resourceId?: string): LintDiagnostic[] {
    const diagnostics: LintDiagnostic[] = [];
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
        const { startByte, endByte, startOffset, endOffset } = this.resolveLintDiagnosticRange(entry, result);
        diagnostics.push({
          symbolId: id,
          startByte,
          endByte,
          startOffset,
          endOffset,
          message: result.message,
          severity: result.severity,
          lintName,
          code: result.code,
        });
      }
    }
    return diagnostics;
  }

  /**
   * Incrementally evaluates dirty `lint__*` hooks asynchronously with cooperative yielding
   * and optional viewport-first prioritization, updating `lintCache` and `dirtyLintSymbols`.
   *
   * @param resourceId Optional document URI filter (`"__all__"` when omitted).
   * @param yieldFn Optional cooperative cancellation/yield callback returning `true` if cancelled.
   * @param viewportRange Optional visible byte/offset range prioritized ahead of off-screen symbols.
   */
  public async runAllLintsAsync(
    resourceId?: string,
    yieldFn?: () => Promise<boolean>,
    viewportRange?: {
      startByte?: number | undefined;
      endByte?: number | undefined;
      startOffset?: number | undefined;
      endOffset?: number | undefined;
    },
  ): Promise<LintDiagnostic[]> {
    const cacheKey = resourceId ?? "__all__";
    let perSymbolCache = this.lintCache.get(cacheKey);
    let cacheDirtySet = this.dirtyLintSymbols.get(cacheKey);

    if (!perSymbolCache || !cacheDirtySet) {
      perSymbolCache = new Map();
      this.lintCache.set(cacheKey, perSymbolCache);
      cacheDirtySet = new Set(this.index.symbols.keys());
      this.dirtyLintSymbols.set(cacheKey, cacheDirtySet);
    }

    const symbolsToRelint: [SymbolId, SymbolEntry][] = [];
    const relintIds = new Set<SymbolId>();

    for (const id of cacheDirtySet) {
      const entry = this.index.symbols.get(id);
      if (!entry) {
        cacheDirtySet.delete(id);
        perSymbolCache.delete(id);
        continue;
      }
      if (resourceId && entry.resourceId !== resourceId) {
        const norm = (u: string) => u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
        if (!entry.resourceId || norm(entry.resourceId) !== norm(resourceId)) continue;
      }
      symbolsToRelint.push([id, entry]);
      relintIds.add(id);
    }

    if (viewportRange && symbolsToRelint.length > 1) {
      const vpStart = viewportRange.startOffset ?? viewportRange.startByte ?? 0;
      const vpEnd = viewportRange.endOffset ?? viewportRange.endByte ?? Infinity;
      const inViewport: [SymbolId, SymbolEntry][] = [];
      const outViewport: [SymbolId, SymbolEntry][] = [];
      for (const pair of symbolsToRelint) {
        const entry = pair[1];
        const entryStart = entry.startOffset ?? entry.startByte;
        const entryEnd = entry.endOffset ?? entry.endByte;
        if (entryStart <= vpEnd && entryEnd >= vpStart) {
          inViewport.push(pair);
        } else {
          outViewport.push(pair);
        }
      }
      symbolsToRelint.length = 0;
      symbolsToRelint.push(...inViewport, ...outViewport);
    }

    for (const [id, entry] of symbolsToRelint) {
      if (yieldFn && (await yieldFn())) {
        throw new QueryCancelledError();
      }
      const diags: LintDiagnostic[] = [];
      for (const { lintName, result } of this.runLints(id)) {
        const { startByte, endByte, startOffset, endOffset } = this.resolveLintDiagnosticRange(entry, result);
        diags.push({
          symbolId: id,
          startByte,
          endByte,
          startOffset,
          endOffset,
          message: result.message,
          severity: result.severity,
          lintName,
          code: result.code,
        });
      }
      perSymbolCache.set(id, diags);
      cacheDirtySet.delete(id);
    }

    const allDiags: LintDiagnostic[] = [];
    for (const diags of perSymbolCache.values()) {
      allDiags.push(...diags);
    }
    return allDiags;
  }

  /**
   * Purges cached diagnostics and dirty sets for a closed or deleted document.
   */
  public disposeDocument(resourceId: string): void {
    this.lintCache.delete(resourceId);
    this.dirtyLintSymbols.delete(resourceId);
    const norm = (u: string) => u.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
    const targetNorm = norm(resourceId);
    this.lintCache.delete(targetNorm);
    this.dirtyLintSymbols.delete(targetNorm);

    for (const [id, entry] of this.index.symbols) {
      if (entry.resourceId && norm(entry.resourceId) === targetNorm) {
        this.inputRevisions.set(id, ++this.currentRevision);
        const dependentKeys = this.inputReverseDependencies.get(id);
        if (dependentKeys) {
          for (const key of dependentKeys) {
            this.memos.delete(key);
          }
        }
        for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
          cacheDirtySet.add(id);
        }
      }
    }
  }

  /**
   * Evaluates bipartite structural equation balancing for a symbol.
   */
  public checkEquationBalance(symbolId: SymbolId): {
    isBalanced: boolean;
    varCount: number;
    eqCount: number;
    difference: number;
    status: "balanced" | "under-determined" | "over-determined";
  } {
    const entry = this.resolveEntry(symbolId);
    if (!entry) {
      return { isBalanced: true, varCount: 0, eqCount: 0, difference: 0, status: "balanced" };
    }

    const { varNames, equations } = this.extractSymbolVarsAndEquations(symbolId);
    const varCount = varNames.size;
    const eqCount = equations.length;

    const diff = eqCount - varCount;
    return {
      isBalanced: diff === 0,
      varCount,
      eqCount,
      difference: diff,
      status: diff === 0 ? "balanced" : diff < 0 ? "under-determined" : "over-determined",
    };
  }

  /**
   * Computes strongly connected components (algebraic loops) for equations in a symbol
   * using maximum bipartite matching (Hopcroft-Karp / DFS augmenting paths) followed by
   * Tarjan's strongly connected components algorithm.
   */
  public checkAlgebraicLoops(symbolId: SymbolId): {
    hasLoops: boolean;
    loopCount: number;
    loops: { size: number; vars: string[] }[];
  } {
    const entry = this.resolveEntry(symbolId);
    if (!entry) {
      return { hasLoops: false, loopCount: 0, loops: [] };
    }

    const { varNames, equations } = this.extractSymbolVarsAndEquations(symbolId);
    if (varNames.size === 0 || equations.length === 0) {
      return { hasLoops: false, loopCount: 0, loops: [] };
    }

    const vars = Array.from(varNames);
    const varToIdx = new Map<string, number>();
    for (let i = 0; i < vars.length; i++) {
      varToIdx.set(vars[i]!, i);
    }

    // Build equation-to-variable incidence lists (excluding der(x) state occurrences)
    const eqVars: number[][] = [];
    for (const eqText of equations) {
      const strippedDer = eqText.replace(/\bder\s*\([^)]*\)/g, " ");
      const idents = strippedDer.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
      const inc = new Set<number>();
      for (const id of idents) {
        const vIdx = varToIdx.get(id);
        if (vIdx !== undefined) inc.add(vIdx);
      }
      eqVars.push(Array.from(inc));
    }

    // Maximum bipartite matching: match each equation e to an unknown variable v
    const numVars = vars.length;
    const numEqs = eqVars.length;
    const varMatch = new Int32Array(numVars).fill(-1); // varIdx -> eqIdx
    const eqMatch = new Int32Array(numEqs).fill(-1); // eqIdx -> varIdx

    const augment = (eqIdx: number, visitedVars: Uint8Array): boolean => {
      const candidates = eqVars[eqIdx]!;
      for (let i = 0; i < candidates.length; i++) {
        const v = candidates[i]!;
        if (visitedVars[v]) continue;
        visitedVars[v] = 1;
        if (varMatch[v] === -1 || augment(varMatch[v]!, visitedVars)) {
          varMatch[v] = eqIdx;
          eqMatch[eqIdx] = v;
          return true;
        }
      }
      return false;
    };

    for (let e = 0; e < numEqs; e++) {
      const visited = new Uint8Array(numVars);
      augment(e, visited);
    }

    // Build directed dependency graph among matched variables:
    // If equation e is matched to variable u, and variable v != u appears in e, add edge u -> v.
    const adj: number[][] = Array.from({ length: numVars }, () => []);
    for (let u = 0; u < numVars; u++) {
      const e = varMatch[u]!;
      if (e < 0) continue;
      for (const v of eqVars[e]!) {
        if (v !== u) {
          adj[u]!.push(v);
        }
      }
    }

    // Tarjan's Strongly Connected Components algorithm
    let index = 0;
    const indices = new Int32Array(numVars).fill(-1);
    const lowlink = new Int32Array(numVars).fill(-1);
    const onStack = new Uint8Array(numVars);
    const stack: number[] = [];
    const loops: { size: number; vars: string[] }[] = [];

    const strongConnect = (v: number): void => {
      indices[v] = index;
      lowlink[v] = index;
      index++;
      stack.push(v);
      onStack[v] = 1;

      for (const w of adj[v]!) {
        if (indices[w] === -1) {
          strongConnect(w);
          if (lowlink[w]! < lowlink[v]!) lowlink[v] = lowlink[w]!;
        } else if (onStack[w]) {
          if (indices[w]! < lowlink[v]!) lowlink[v] = indices[w]!;
        }
      }

      if (lowlink[v] === indices[v]) {
        const scc: string[] = [];
        while (stack.length > 0) {
          const w = stack.pop()!;
          onStack[w] = 0;
          scc.push(vars[w]!);
          if (w === v) break;
        }
        if (scc.length > 1) {
          scc.reverse();
          loops.push({ size: scc.length, vars: scc });
        }
      }
    };

    for (let v = 0; v < numVars; v++) {
      if (indices[v] === -1) {
        strongConnect(v);
      }
    }

    return {
      hasLoops: loops.length > 0,
      loopCount: loops.length,
      loops,
    };
  }

  /**
   * Helper that extracts unknown continuous/discrete variables and non-initial equation strings
   * for a class/model `symbolId` (used by `checkEquationBalance` and `checkAlgebraicLoops`).
   */
  private extractSymbolVarsAndEquations(symbolId: SymbolId): {
    varNames: Set<string>;
    equations: string[];
  } {
    const varNames = new Set<string>();
    const equations: string[] = [];

    // 1. Collect non-parameter, non-constant child variables from symbol table
    const children = this.index.childrenOf.get(symbolId) ?? [];
    for (const cid of children) {
      const centry = this.resolveEntry(cid);
      if (!centry) continue;
      if (
        centry.kind === "Component" ||
        centry.kind === "Variable" ||
        centry.ruleName === "component_declaration" ||
        centry.ruleName === "component_clause"
      ) {
        const queriedVar = this.hooksByRule.get(centry.ruleName)?.["variability"]
          ? this.fetch("variability", cid)
          : undefined;
        const variability = String(queriedVar ?? centry.metadata?.["variability"] ?? "").toLowerCase();
        const causality = String(centry.metadata?.["causality"] ?? "").toLowerCase();
        const isParamOrConst =
          variability === "parameter" ||
          variability === "constant" ||
          Boolean(centry.metadata?.["isParameter"]) ||
          Boolean(centry.metadata?.["isConstant"]);
        if (!isParamOrConst && causality !== "input" && centry.name) {
          varNames.add(centry.name);
        }
      }
    }

    // 2. Collect equations from registered query hook if available
    const queriedEqs = this.fetch("equations", symbolId);
    if (Array.isArray(queriedEqs) && queriedEqs.length > 0) {
      for (const eq of queriedEqs) {
        if (typeof eq === "string") {
          equations.push(eq);
        } else if (eq && typeof eq === "object" && typeof (eq as any).text === "string") {
          equations.push((eq as any).text);
        } else {
          equations.push(String(eq));
        }
      }
    }

    // 3. Otherwise inspect CST nodes or structured equation sections
    const cst = this.getCstNode(symbolId) as any;
    if (equations.length === 0 && cst) {
      const eqNodeKinds = new Set([
        "equation",
        "simple_equation",
        "connect_clause",
        "if_equation",
        "for_equation",
        "when_equation",
        "Equation",
        "Constraint",
      ]);
      const visitNode = (node: any): void => {
        if (!node || typeof node !== "object") return;
        const kind = String(node.type ?? node.kind ?? node.ruleName ?? "");
        if (kind === "initial_equation_section" || kind === "annotation" || kind === "comment") {
          return;
        }
        if (eqNodeKinds.has(kind)) {
          if (typeof node.text === "string" && node.text.trim().length > 0) {
            equations.push(node.text.trim());
          } else {
            equations.push(kind);
          }
          return;
        }
        const nodeChildren = node.namedChildren ?? node.children;
        if (Array.isArray(nodeChildren)) {
          for (const ch of nodeChildren) visitNode(ch);
        }
      };
      visitNode(cst);

      // Fallback if CST only provides raw source text (e.g. unit-test mock CST)
      if (equations.length === 0 && typeof cst.text === "string" && cst.text.length > 0) {
        const cleanText = cst.text
          .replace(/\/\/[^\n]*/g, "")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/"(?:\\.|[^"\\])*"/g, '""');

        // Also discover component declarations if children were not indexed
        if (varNames.size === 0) {
          const declRegex = /\b(?:(parameter|constant|input)\s+)?(?:Real|Integer|Boolean)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
          let m: RegExpExecArray | null;
          while ((m = declRegex.exec(cleanText)) !== null) {
            const prefix = m[1];
            const name = m[2];
            if (!prefix && name) {
              varNames.add(name);
            }
          }
        }

        // Extract statements inside non-initial `equation` sections, or top-level equations
        const eqSectionRegex =
          /(?<!initial\s)\bequation\b([\s\S]*?)(?=\b(?:initial\s+equation|algorithm|initial\s+algorithm|end)\b|$)/g;
        let secMatch: RegExpExecArray | null;
        let foundSection = false;
        while ((secMatch = eqSectionRegex.exec(cleanText)) !== null) {
          foundSection = true;
          const body = secMatch[1] ?? "";
          const stmts = body
            .split(";")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          for (const stmt of stmts) {
            const withoutRelOps = stmt.replace(/<=|>=|==|<>|:=/g, " ");
            if (withoutRelOps.includes("=") || /^connect\s*\(/.test(stmt)) {
              equations.push(stmt);
            }
          }
        }

        if (!foundSection) {
          const stmts = String(cleanText)
            .split(";")
            .map((s: string) => s.trim())
            .filter((s: string) => s.length > 0);
          for (const stmt of stmts) {
            if (/^\b(parameter|constant|model|class|block|connector|record|function|package|end)\b/.test(stmt)) {
              continue;
            }
            const withoutRelOps = stmt.replace(/<=|>=|==|<>|:=/g, " ");
            if (withoutRelOps.includes("=")) {
              // Strip leading type specifier if it is a variable declaration with binding
              if (!/^(?:Real|Integer|Boolean|String)\b/.test(stmt)) {
                equations.push(stmt);
              }
            }
          }
        }
      }
    }

    return { varNames, equations };
  }

  // -- Salsa 3.0 Query Execution --

  /**
   * Entry point of the Salsa `fetch -> deepVerify -> execute -> backdate` pipeline.
   *
   * 1. Records a query dependency on the caller's active `DependencyTracker` (if nested).
   * 2. Fast path: if a memo exists and `memo.verified_at === this.currentRevision`, returns `memo.value` immediately.
   * 3. Deep verify path: if a memo exists from an older revision and `deepVerify(memo, key)` confirms none of its
   *    transitive dependencies changed since `memo.verified_at`, updates `memo.verified_at` and returns `memo.value`.
   * 4. Slow path: invokes `execute()` to recompute the query, track dependencies, and potentially backdate `changed_at`.
   */
  private fetch(queryName: string, symbolId: SymbolId, argsHash?: string, args?: Record<string, unknown>): unknown {
    const key = this.memoKey(queryName, symbolId, argsHash);

    // Record this query invocation as a dependency of the parent query currently on the execution stack.
    if (this.activeTracker) {
      this.activeTracker.recordQuery(queryName, symbolId, argsHash);
    }

    const memo = this.memos.get(key);

    // Fast path: memo was already verified in the current global revision.
    if (memo && memo.verified_at === this.currentRevision) {
      return memo.value;
    }

    // Deep verification: recursively check if any input, byName, domain, or sub-query dependency changed.
    if (memo && this.deepVerify(memo, key)) {
      memo.verified_at = this.currentRevision;
      return memo.value;
    }

    // Re-execute the query hook when no valid memo exists or a transitive dependency changed.
    return this.execute(queryName, symbolId, argsHash, args);
  }

  /**
   * Salsa deep verification step: walks a cached `Memo`'s recorded dependencies to determine
   * whether the memo's value is still valid at `this.currentRevision` without re-running its body.
   *
   * - For `"input"`, `"byName"`, and `"domain"` dependencies, compares their revision counters
   *   directly against `memo.verified_at`.
   * - For `"query"` dependencies, recursively calls `this.fetch()` (which may itself deep-verify
   *   or re-execute and backdate the child query) and checks whether `depMemo.changed_at > memo.verified_at`.
   */
  private deepVerify(memo: Memo, memoKey: number): boolean {
    // Guard against cyclic verification loops.
    if (this.activeVerifications.has(memoKey)) return false;
    this.activeVerifications.add(memoKey);
    // Suspend dependency tracking while verifying dependencies so verification reads don't pollute the caller's tracker.
    const prevTracker = this.activeTracker;
    this.activeTracker = null;
    try {
      for (const dep of memo.dependencies) {
        if (dep.kind === "input") {
          // Direct symbol input check: invalidated if the symbol was modified after `memo.verified_at`.
          const rev = this.inputRevisions.get(dep.symbolId) ?? 0;
          if (rev > memo.verified_at) return false;
        } else if (dep.kind === "byName") {
          // Name table lookup check: invalidated if symbols with `dep.name` were added/removed/renamed.
          const rev = this.byNameRevisions.get(dep.name) ?? 0;
          if (rev > memo.verified_at) return false;
        } else if (dep.kind === "domain") {
          // Polyglot domain check: invalidated if the target language domain revision advanced.
          const rev = this.domainRevisions.get(dep.domain) ?? 0;
          if (rev > memo.verified_at) return false;
        } else if (dep.kind === "query") {
          // Derived sub-query check: ensure the sub-query is up-to-date for `currentRevision`,
          // then check whether its output value actually changed (`changed_at > memo.verified_at`).
          try {
            this.fetch(dep.queryName, dep.symbolId, dep.argsHash);
          } catch (e) {
            if (e instanceof QueryCancelledError) throw e;
            return false;
          }
          const depKey = this.memoKey(dep.queryName, dep.symbolId, dep.argsHash);
          const depMemo = this.memos.get(depKey);
          if (!depMemo) return false;
          if (depMemo.changed_at > memo.verified_at) return false;
        }
      }
      return true;
    } finally {
      this.activeTracker = prevTracker;
      this.activeVerifications.delete(memoKey);
    }
  }

  /**
   * Executes a query hook for `(queryName, symbolId, args)`, capturing all dynamic dependencies
   * via a fresh `DependencyTracker` and applying Salsa backdating if the newly computed result
   * is shallow-equal to the prior memoized value.
   *
   * Also performs cycle detection on `executionStack` (invoking an optional cycle `recovery` handler
   * or returning `undefined` gracefully) and registers reverse dependencies for incremental invalidation.
   */
  private execute(queryName: string, symbolId: SymbolId, argsHash?: string, args?: Record<string, unknown>): unknown {
    const entry = this.resolveEntry(symbolId);
    if (!entry) return undefined;

    // Resolve the query hook implementation registered for the symbol's grammar rule.
    const hooks = this.hooksByRule.get(entry.ruleName);
    const rawQuery = hooks?.[queryName];
    if (!rawQuery) return undefined;
    const queryFn: QueryFn | undefined =
      typeof rawQuery === "function"
        ? (rawQuery as QueryFn)
        : typeof (rawQuery as any)?.execute === "function"
          ? (rawQuery as any).execute
          : undefined;
    if (!queryFn) return undefined;

    const key = this.memoKey(queryName, symbolId, argsHash);

    // Cycle detection: check if `key` is already active on the current execution stack.
    for (let i = 0; i < this.executionStack.length; i++) {
      const frame = this.executionStack[i]!;
      if (frame.key === key) {
        const recoveryFn =
          typeof rawQuery === "object" && rawQuery !== null && typeof (rawQuery as any).recovery === "function"
            ? (rawQuery as any).recovery
            : undefined;
        if (recoveryFn) {
          const participants = [
            ...this.executionStack.slice(i).map((f) => ({ queryName: f.queryName, symbolId: f.symbolId })),
            { queryName, symbolId },
          ];
          const cycleDb = Object.assign(this.createTrackedDB(), { participants });
          return recoveryFn(cycleDb, entry, args);
        }
        return undefined; // Graceful cycle fallback
      }
    }

    // Push execution frame and install a fresh DependencyTracker to record all inputs and sub-queries read.
    this.executionStack.push({ key, queryName, symbolId });
    const prevTracker = this.activeTracker;
    const tracker = new DependencyTracker();
    this.activeTracker = tracker;

    let result: unknown;
    try {
      const db = this.createTrackedDB();
      result = queryFn(db, entry, args);
    } finally {
      this.activeTracker = prevTracker;
      this.executionStack.pop();
    }

    // Backdating: if the newly computed result is shallow-equal to the previous memoized value,
    // preserve `oldMemo.changed_at` so downstream dependent queries can short-circuit during `deepVerify`.
    const oldMemo = this.memos.get(key);
    let changedAt = this.currentRevision;
    if (oldMemo && shallowEqual(oldMemo.value, result)) {
      changedAt = oldMemo.changed_at;
    }

    const memo: Memo = {
      value: result,
      verified_at: this.currentRevision,
      changed_at: changedAt,
      dependencies: tracker.dependencies,
      byNameLookups: tracker.byNameLookups,
    };

    // Enforce bounded memo table capacity via FIFO eviction before storing the new memo.
    if (this.memos.size >= this.maxMemos) {
      const firstKey = this.memos.keys().next().value;
      if (firstKey !== undefined) this.memos.delete(firstKey);
    }
    this.memos.set(key, memo);

    // Populate reverse dependency tables so future `invalidate()` calls can locate this memo key.
    for (const dep of tracker.dependencies) {
      if (dep.kind === "input") {
        let set = this.inputReverseDependencies.get(dep.symbolId);
        if (!set) {
          set = new Set();
          this.inputReverseDependencies.set(dep.symbolId, set);
        }
        set.add(key);
      } else if (dep.kind === "byName") {
        let set = this.byNameReverseDependencies.get(dep.name);
        if (!set) {
          set = new Set();
          this.byNameReverseDependencies.set(dep.name, set);
        }
        set.add(key);
      }
    }

    return result;
  }

  // -- Tracked QueryDB for Salsa --

  /**
   * Constructs a dependency-tracking `QueryDB` facade bound to the currently active
   * `DependencyTracker` during `execute()`.
   *
   * Every symbol lookup (`symbol`, `childrenOf`, `parentOf`, `cstNode`, `cstText`),
   * name resolution (`byName`, `resolvePolyglotSymbol`), domain revision check, and
   * nested `query`/`queryWith` call automatically logs its dependency edge into `tracker`.
   */
  private createTrackedDB(): QueryDB {
    /* eslint-disable-next-line @typescript-eslint/no-this-alias */
    const engine = this;
    const tracker = this.activeTracker;

    return {
      ensureFQNIndexed(fqn: string): void {
        engine.ensureFQNIndexed(fqn);
      },

      symbol(id: SymbolId): SymbolEntry | undefined {
        if (tracker) tracker.recordInput(id);
        return engine.resolveEntry(id);
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        if (tracker) tracker.recordInput(id);
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId ?? 0);
        if (childIds) {
          for (const cid of childIds) {
            const entry = engine.resolveEntry(cid);
            if (entry) {
              if (tracker) tracker.recordInput(cid);
              results.push(entry);
            }
          }
        }
        for (const vEntry of engine.virtualEntries.values()) {
          if (vEntry.parentId === id) results.push(vEntry);
        }
        return results;
      },

      childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[] {
        if (tracker) tracker.recordInput(id);
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        const childIds = engine.index.childrenOf.get(lookupId ?? 0);
        if (childIds) {
          for (const cid of childIds) {
            const entry = engine.resolveEntry(cid);
            if (entry && entry.fieldName === fieldName) {
              if (tracker) tracker.recordInput(cid);
              results.push(entry);
            }
          }
        }
        for (const vEntry of engine.virtualEntries.values()) {
          if (vEntry.parentId === id && vEntry.fieldName === fieldName) results.push(vEntry);
        }
        return results;
      },

      parentOf(id: SymbolId): SymbolEntry | undefined {
        const entry = this.symbol(id);
        if (!entry || entry.parentId === null) return undefined;
        return this.symbol(entry.parentId);
      },

      exportsOf(id: SymbolId): SymbolEntry[] {
        return this.childrenOf(id);
      },

      query<T = unknown>(queryName: string, id: SymbolId): T {
        return engine.fetch(queryName, id) as T;
      },

      byName(name: string): SymbolEntry[] {
        if (tracker) tracker.recordByName(name);
        const ids = engine.index.byName.get(name);
        if (!ids) return [];
        return ids
          .map((id: SymbolId) => {
            if (tracker) tracker.recordInput(id);
            return engine.resolveEntry(id);
          })
          .filter(Boolean) as SymbolEntry[];
      },

      allEntries(): SymbolEntry[] {
        return Array.from(engine.allEntries());
      },

      resolvePolyglotSymbol(fqn: string, targetDomain?: LanguageDomainId): SymbolId | null {
        if (tracker) tracker.recordByName(fqn);
        return engine.resolvePolyglotSymbol(fqn, targetDomain);
      },

      crossDomainBinding(symbolId: SymbolId): SymbolId[] {
        if (tracker) tracker.recordInput(symbolId);
        const results = engine.crossDomainBinding(symbolId);
        if (tracker) {
          for (const rid of results) {
            tracker.recordInput(rid);
          }
        }
        return results;
      },

      physicalQuantityParity(modelicaVarId: SymbolId, sysmlAttrId: SymbolId): ParityReport {
        if (tracker) {
          tracker.recordInput(modelicaVarId);
          tracker.recordInput(sysmlAttrId);
        }
        return engine.physicalQuantityParity(modelicaVarId, sysmlAttrId);
      },

      geometricShapeBinding(cadSymbolId: SymbolId, feaMeshId: SymbolId): ShapeBinding {
        if (tracker) {
          tracker.recordInput(cadSymbolId);
          tracker.recordInput(feaMeshId);
        }
        return engine.geometricShapeBinding(cadSymbolId, feaMeshId);
      },

      getDomainRevision(domain: LanguageDomainId): Revision {
        if (tracker) tracker.recordDomain(domain);
        return engine.getDomainRevision(domain);
      },

      hasDomainChanged(domain: LanguageDomainId, sinceRevision: Revision): boolean {
        if (tracker) tracker.recordDomain(domain);
        return engine.hasDomainChanged(domain, sinceRevision);
      },

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>, hashOverride?: string): T {
        const argsHash = stableStringifyArgs(args, hashOverride);
        return engine.fetch(queryName, id, argsHash, args) as T;
      },

      specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId {
        const cacheKey = `${baseId}:${args.hash}`;
        const existing = engine.specializeCache.get(cacheKey);
        if (existing !== undefined) return existing;

        const base = engine.resolveEntry(baseId);
        if (!base) throw new Error(`Cannot specialize unknown symbol ${baseId}`);

        const virtualId = engine.nextVirtualId--;
        const baseStart = base.startOffset ?? base.startByte;
        const baseEnd = base.endOffset ?? base.endByte;
        const virtualEntry: SymbolEntry = {
          ...base,
          id: virtualId,
          startByte: base.startByte ?? baseStart,
          endByte: base.endByte ?? baseEnd,
          startOffset: baseStart,
          endOffset: baseEnd,
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
        if (tracker && entry) tracker.recordInput(entry.id);
        return engine.getCstText(startByte, endByte, entry);
      },

      cstNode(id: SymbolId): unknown | null {
        if (tracker) tracker.recordInput(id);
        return engine.getCstNode(id);
      },

      cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
        if (tracker && entry) tracker.recordInput(entry.id);
        return engine.getCstNodeRange(startByte, endByte, entry);
      },

      flushVolatile(): void {
        engine.flushVolatile();
      },

      taxonomy: engine.taxonomy,
    };
  }

  /**
   * Ensures that all lazy-loaded workspace files along the package hierarchy of `fqn`
   * have been parsed and merged into `this.index`.
   */
  public ensureFQNIndexed(fqn: string): void {
    const ws =
      (this.index as any)?.workspace ??
      (this.index as any)?.workspaceIndex ??
      (this.index as any)?.globalWorkspaceIndex;
    if (ws && typeof ws.ensureFQNIndexed === "function") {
      ws.ensureFQNIndexed(fqn);
      if (typeof ws.toUnifiedPartial === "function" && this.index) {
        const newIdx = ws.toUnifiedPartial();
        if (newIdx && newIdx !== this.index) {
          if (newIdx.symbols && this.index.symbols) {
            for (const [id, entry] of newIdx.symbols.entries()) {
              this.index.symbols.set(id, entry);
            }
          }
          if (newIdx.byName && this.index.byName) {
            for (const [name, ids] of newIdx.byName.entries()) {
              const existing = this.index.byName.get(name);
              if (existing) {
                const merged = Array.from(new Set([...existing, ...ids]));
                this.index.byName.set(name, merged);
              } else {
                this.index.byName.set(name, ids);
              }
            }
          }
          if (newIdx.childrenOf && this.index.childrenOf) {
            for (const [parentId, childIds] of newIdx.childrenOf.entries()) {
              const existing = this.index.childrenOf.get(parentId);
              if (existing) {
                const merged = Array.from(new Set([...existing, ...childIds]));
                this.index.childrenOf.set(parentId, merged);
              } else {
                this.index.childrenOf.set(parentId, childIds);
              }
            }
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Polyglot Cross-Domain Query Implementations
  // -------------------------------------------------------------------------

  /**
   * Resolves a cross-language symbol reference (optionally prefixed with `Domain::` or `domain://`,
   * e.g. `SysML2::Vehicle::Powertrain` or `Modelica.Mechanics.Rotational`) to its `SymbolId`.
   */
  public resolvePolyglotSymbol(fqn: string, targetDomain?: LanguageDomainId): SymbolId | null {
    if (!fqn || typeof fqn !== "string") return null;
    const trimmed = fqn.trim();
    if (!trimmed) return null;

    let searchDomain = targetDomain;
    let pathStr = trimmed;

    // Check for domain prefix like SysML2::..., Modelica::..., STEP::..., CAD::..., sysml2://...
    const prefixMatch = pathStr.match(/^([-a-zA-Z0-9_]+)(?:::|\/\/)(.*)$/);
    if (prefixMatch && prefixMatch[1] && prefixMatch[2]) {
      const detectedDomain = getLanguageDomainId(prefixMatch[1]);
      if (detectedDomain !== LanguageDomainId.Default) {
        searchDomain = detectedDomain;
        pathStr = prefixMatch[2];
      }
    }

    // Direct match by qualifiedName / fqn metadata or exact name
    for (const entry of this.allEntries()) {
      if (searchDomain !== undefined && getSymbolDomain(entry.id) !== searchDomain) {
        continue;
      }
      if (
        entry.metadata?.["qualifiedName"] === pathStr ||
        entry.metadata?.["fqn"] === pathStr ||
        entry.name === pathStr
      ) {
        return entry.id;
      }
    }

    // Split path by :: or .
    const segments = pathStr.split(/::|\./).filter((s) => s.length > 0);
    if (segments.length === 0) return null;

    // Look for root candidates matching segments[0]
    const rootCandidates = this.index.byName.get(segments[0]!) || [];
    for (const candId of rootCandidates) {
      const cand = this.resolveEntry(candId);
      if (!cand) continue;
      if (searchDomain !== undefined && getSymbolDomain(cand.id) !== searchDomain) {
        continue;
      }

      if (segments.length === 1) {
        return cand.id;
      }

      // Traverse children down the path
      let currentId: SymbolId | null = cand.id;
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i]!;
        const childIds = this.index.childrenOf.get(currentId) || [];
        let nextChild: SymbolEntry | null = null;
        for (const cid of childIds) {
          const centry = this.resolveEntry(cid);
          if (centry && centry.name === seg) {
            nextChild = centry;
            break;
          }
        }
        if (!nextChild) {
          currentId = null;
          break;
        }
        currentId = nextChild.id;
      }

      if (currentId !== null) {
        return currentId;
      }
    }

    // If still not found, search by the leaf name if targetDomain matches
    const leafName = segments[segments.length - 1]!;
    const leafCandidates = this.index.byName.get(leafName) || [];
    for (const lid of leafCandidates) {
      const entry = this.resolveEntry(lid);
      if (!entry) continue;
      if (searchDomain !== undefined && getSymbolDomain(entry.id) !== searchDomain) {
        continue;
      }
      return entry.id;
    }

    return null;
  }

  /**
   * Returns all cross-domain counterpart `SymbolId`s bound to `symbolId` via the TGG
   * correspondence slot table, explicit metadata links (`twin`, `counterpart`, `implements`,
   * `cadBinding`), or matching symbol names in other language domains.
   */
  public crossDomainBinding(symbolId: SymbolId): SymbolId[] {
    const entry = this.resolveEntry(symbolId);
    if (!entry) return [];

    const domain = getSymbolDomain(symbolId);
    const results = new Set<SymbolId>();

    // 1. Check correspondence slot map if configured
    if (this.correspondenceSlotMap && this.correspondenceSlotMap.has(symbolId)) {
      const slot = this.correspondenceSlotMap.get(symbolId)!;
      for (const [otherId, otherSlot] of this.correspondenceSlotMap.entries()) {
        if (otherSlot === slot && otherId !== symbolId) {
          results.add(otherId);
        }
      }
    }

    // 2. Check metadata links (twin, counterpart, implements, cadBinding)
    const meta = entry.metadata;
    if (meta) {
      const candidates = [
        meta["twin"],
        meta["counterpart"],
        meta["implements"],
        meta["cadBinding"],
        meta["crossDomainBinding"],
      ].filter(Boolean);

      for (const cand of candidates) {
        if (typeof cand === "number") {
          results.add(cand);
        } else if (typeof cand === "string") {
          const resolved = this.resolvePolyglotSymbol(cand);
          if (resolved !== null && resolved !== symbolId) {
            results.add(resolved);
          }
        }
      }
    }

    // 3. Fall back to name matching across other language domains
    if (entry.name) {
      const nameMatches = this.index.byName.get(entry.name) || [];
      for (const otherId of nameMatches) {
        if (otherId === symbolId) continue;
        const otherDomain = getSymbolDomain(otherId);
        if (otherDomain !== domain) {
          results.add(otherId);
        }
      }
    }

    return Array.from(results);
  }

  /**
   * Verifies dimensional, unit, and type compatibility between a Modelica variable symbol
   * and a SysML v2 attribute symbol, returning a detailed `ParityReport`.
   */
  public physicalQuantityParity(modelicaVarId: SymbolId, sysmlAttrId: SymbolId): ParityReport {
    const mEntry = this.resolveEntry(modelicaVarId);
    const sEntry = this.resolveEntry(sysmlAttrId);

    if (!mEntry || !sEntry) {
      return {
        compatible: false,
        reason: `Symbol not found: modelica=${Boolean(mEntry)}, sysml=${Boolean(sEntry)}`,
      };
    }

    const mType = (mEntry.metadata?.["type"] || mEntry.ruleName || "").toString();
    const mUnit = (mEntry.metadata?.["unit"] || "").toString();
    const sType = (sEntry.metadata?.["type"] || sEntry.ruleName || "").toString();
    const sUnit = (sEntry.metadata?.["unit"] || "").toString();

    // Normalization helper for physical dimensions
    const normalizeUnit = (u: string) => u.replace(/\*/g, ".").replace(/\s+/g, "").toLowerCase();

    const normMUnit = normalizeUnit(mUnit);
    const normSUnit = normalizeUnit(sUnit);

    const isTorque = (t: string, u: string) =>
      /torque/i.test(t) || u === "n.m" || u === "nm" || u === "n*m" || u === "kg.m2/s2";
    const isMass = (t: string, u: string) => /mass/i.test(t) || u === "kg" || u === "g";
    const isVoltage = (t: string, u: string) => /voltage|potential/i.test(t) || u === "v";
    const isLength = (t: string, u: string) => /length|distance|radius|diameter/i.test(t) || u === "m" || u === "mm";

    let compatible = false;
    let reason: string | undefined;

    if (normMUnit && normSUnit && normMUnit === normSUnit) {
      compatible = true;
    } else if (isTorque(mType, normMUnit) && isTorque(sType, normSUnit)) {
      compatible = true;
    } else if (isMass(mType, normMUnit) && isMass(sType, normSUnit)) {
      compatible = true;
    } else if (isVoltage(mType, normMUnit) && isVoltage(sType, normSUnit)) {
      compatible = true;
    } else if (isLength(mType, normMUnit) && isLength(sType, normSUnit)) {
      compatible = true;
    } else if (!mUnit && !sUnit) {
      const isReal = (t: string) => /real|float|double/i.test(t);
      const isInt = (t: string) => /int/i.test(t);
      const isBool = (t: string) => /bool/i.test(t);
      const isStr = (t: string) => /string/i.test(t);

      if (
        (isReal(mType) && isReal(sType)) ||
        (isInt(mType) && isInt(sType)) ||
        (isBool(mType) && isBool(sType)) ||
        (isStr(mType) && isStr(sType))
      ) {
        compatible = true;
      } else {
        compatible = false;
        reason = `Type mismatch between Modelica '${mType}' and SysML '${sType}'`;
      }
    } else {
      compatible = false;
      reason = `Unit mismatch: Modelica '${mUnit || mType}' vs SysML '${sUnit || sType}'`;
    }

    return {
      compatible,
      modelicaType: mType,
      modelicaUnit: mUnit,
      sysmlType: sType,
      sysmlUnit: sUnit,
      reason,
    };
  }

  /**
   * Computes the geometric shape and mesh binding summary between a CAD solid symbol
   * and an FEA mesh symbol (`surfaceArea`, `volume`, `meshElementCount`).
   */
  public geometricShapeBinding(cadSymbolId: SymbolId, feaMeshId: SymbolId): ShapeBinding {
    const cadEntry = this.resolveEntry(cadSymbolId);
    const feaEntry = this.resolveEntry(feaMeshId);

    const bound = Boolean(cadEntry && feaEntry);
    const cadMeta = cadEntry?.metadata || {};
    const feaMeta = feaEntry?.metadata || {};

    const asNum = (v: unknown): number | undefined =>
      typeof v === "number" ? v : typeof v === "string" && !isNaN(Number(v)) ? Number(v) : undefined;

    return {
      bound,
      cadSymbolId,
      feaMeshId,
      shapeName: cadEntry?.name ?? undefined,
      surfaceArea: asNum(cadMeta["surfaceArea"] ?? cadMeta["area"]),
      volume: asNum(cadMeta["volume"]),
      meshElementCount: asNum(feaMeta["elementCount"] ?? feaMeta["meshElementCount"] ?? feaMeta["nodeCount"]),
    };
  }

  // -- Standalone QueryDB Facade --

  /** Cached singleton `QueryDB` facade for external callers outside active query execution. */
  private _queryDBCache: QueryDB | null = null;

  /**
   * Returns a cached, untracked `QueryDB` facade suitable for external consumers
   * (such as `ModelicaFlattener`, constant folders, or IDE language services) to
   * inspect symbols, CST nodes, and invoke memoized `fetch` queries outside of an
   * active `DependencyTracker` frame.
   */
  public toQueryDB(): QueryDB {
    if (this._queryDBCache) return this._queryDBCache;
    /* eslint-disable-next-line @typescript-eslint/no-this-alias */
    const engine = this;

    // Construct a lightweight facade delegating directly to `engine` without recording input dependencies.
    const db: QueryDB = {
      ensureFQNIndexed(fqn: string): void {
        engine.ensureFQNIndexed(fqn);
      },

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

      resolvePolyglotSymbol(fqn: string, targetDomain?: LanguageDomainId): SymbolId | null {
        return engine.resolvePolyglotSymbol(fqn, targetDomain);
      },

      crossDomainBinding(symbolId: SymbolId): SymbolId[] {
        return engine.crossDomainBinding(symbolId);
      },

      physicalQuantityParity(modelicaVarId: SymbolId, sysmlAttrId: SymbolId): ParityReport {
        return engine.physicalQuantityParity(modelicaVarId, sysmlAttrId);
      },

      geometricShapeBinding(cadSymbolId: SymbolId, feaMeshId: SymbolId): ShapeBinding {
        return engine.geometricShapeBinding(cadSymbolId, feaMeshId);
      },

      getDomainRevision(domain: LanguageDomainId): Revision {
        return engine.getDomainRevision(domain);
      },

      hasDomainChanged(domain: LanguageDomainId, sinceRevision: Revision): boolean {
        return engine.hasDomainChanged(domain, sinceRevision);
      },

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>, hashOverride?: string): T {
        const argsHash = stableStringifyArgs(args, hashOverride);
        return engine.fetch(queryName, id, argsHash, args) as T;
      },

      specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId {
        const cacheKey = `${baseId}:${args.hash}`;
        const existing = engine.specializeCache.get(cacheKey);
        if (existing !== undefined) return existing;

        const base = engine.resolveEntry(baseId);
        if (!base) throw new Error(`Cannot specialize unknown symbol ${baseId}`);

        const virtualId = engine.nextVirtualId--;
        const baseStart = base.startOffset ?? base.startByte;
        const baseEnd = base.endOffset ?? base.endByte;
        const virtualEntry: SymbolEntry = {
          ...base,
          id: virtualId,
          startByte: base.startByte ?? baseStart,
          endByte: base.endByte ?? baseEnd,
          startOffset: baseStart,
          endOffset: baseEnd,
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
        return engine.getCstText(startByte, endByte, entry);
      },

      cstNode(id: SymbolId): unknown | null {
        return engine.getCstNode(id);
      },

      cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
        return engine.getCstNodeRange(startByte, endByte, entry);
      },

      flushVolatile(): void {
        engine.flushVolatile();
      },

      taxonomy: engine.taxonomy,
    };
    this._queryDBCache = db;
    return db;
  }
}

// -- Drop-in Alias --
/** Canonical `QueryEngine` value alias for `WasmQueryEngine`. */
export const QueryEngine = WasmQueryEngine;
/** Canonical `QueryEngine` type alias for `WasmQueryEngine`. */
export type QueryEngine = WasmQueryEngine;
