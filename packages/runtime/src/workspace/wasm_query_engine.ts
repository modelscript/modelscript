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
  defaultSymbolInteropRegistry,
  type SymbolInteropLibrary,
  type SymbolInteropRegistry,
} from "../interop/symbol_interop.js";
import {
  type CSTTree,
  type DependencyKey,
  Durability,
  type ExpressionEvaluator,
  getLanguageDomainId,
  getSymbolDomain,
  LanguageDomainId,
  makePolyglotSymbolId,
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
import { LinearRevisionStore } from "./linear_revision_store.js";
import {
  checkAlgebraicLoopsForSymbol,
  checkEquationBalanceForSymbol,
  computeGeometricShapeBinding,
  computePhysicalQuantityParity,
  type EquationHelperHost,
} from "./query_domain_helpers.js";
import { stableMemoCacheKey } from "./wasm_cache_store.js";

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
  /** Resolved start character offset in the source document. */
  startOffset: number;
  /** Resolved end character offset in the source document. */
  endOffset: number;
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
export interface QueryDependencyRecord {
  queryName: string;
  symbolId: SymbolId;
  argsHash?: string | undefined;
  args?: Record<string, unknown> | undefined;
  key?: number | undefined;
}

class DependencyTracker {
  // Pre-allocated typed array buffer for direct symbol input tracking (zero object allocations)
  private inputBuffer: Int32Array = new Int32Array(32);
  private inputCount = 0;
  private inputSet?: Set<SymbolId> | undefined;

  public queries?: QueryDependencyRecord[] | undefined;
  private queryKeySet?: Set<number> | undefined;

  public byNames?: string[] | undefined;
  private byNameSet?: Set<string> | undefined;

  public domains?: LanguageDomainId[] | undefined;
  private domainSet?: Set<LanguageDomainId> | undefined;

  public durability: Durability = Durability.High;
  public readsAllEntries = false;

  /** Narrows this frame's durability to the minimum of its current durability and `d`. */
  narrowDurability(d: Durability): void {
    if (d < this.durability) this.durability = d;
  }

  /** Marks that this query enumerated all entries in the index (depends on global symbol additions/deletions). */
  recordAllEntries(): void {
    this.readsAllEntries = true;
    this.durability = Durability.Low;
  }

  /** Records a direct dependency on a symbol entry's input state without duplicate entries. */
  recordInput(symbolId: SymbolId): void {
    if (this.inputSet) {
      if (this.inputSet.has(symbolId)) return;
      this.inputSet.add(symbolId);
    } else {
      for (let i = 0; i < this.inputCount; i++) {
        if (this.inputBuffer[i] === symbolId) return;
      }
      if (this.inputCount >= 8) {
        const set = new Set<SymbolId>();
        for (let i = 0; i < this.inputCount; i++) set.add(this.inputBuffer[i]!);
        set.add(symbolId);
        this.inputSet = set;
      }
    }
    if (this.inputCount >= this.inputBuffer.length) {
      const next = new Int32Array(this.inputBuffer.length * 2);
      next.set(this.inputBuffer);
      this.inputBuffer = next;
    }
    this.inputBuffer[this.inputCount++] = symbolId;
  }

  /** Records a deduplicated dependency on another derived Salsa query (preserving `args` for `deepVerify`). */
  recordQuery(
    queryName: string,
    symbolId: SymbolId,
    argsHash?: string,
    key?: number,
    args?: Record<string, unknown>,
  ): void {
    if (!this.queries) {
      this.queries = [{ queryName, symbolId, argsHash, args, key }];
      return;
    }
    if (key !== undefined) {
      if (this.queryKeySet) {
        if (this.queryKeySet.has(key)) return;
        this.queryKeySet.add(key);
      } else {
        for (let i = 0; i < this.queries.length; i++) {
          if (this.queries[i]!.key === key) return;
        }
        if (this.queries.length >= 8) {
          const set = new Set<number>();
          for (let i = 0; i < this.queries.length; i++) {
            const k = this.queries[i]!.key;
            if (k !== undefined) set.add(k);
          }
          set.add(key);
          this.queryKeySet = set;
        }
      }
    } else {
      for (let i = 0; i < this.queries.length; i++) {
        const q = this.queries[i]!;
        if (q.queryName === queryName && q.symbolId === symbolId && q.argsHash === argsHash) return;
      }
    }
    this.queries.push({ queryName, symbolId, argsHash, args, key });
  }

  /** Records a deduplicated dependency on the global `byName` symbol resolution table. */
  recordByName(name: string): void {
    this.durability = Durability.Low;
    if (!this.byNames) {
      this.byNames = [name];
      return;
    }
    if (this.byNameSet) {
      if (this.byNameSet.has(name)) return;
      this.byNameSet.add(name);
    } else {
      for (let i = 0; i < this.byNames.length; i++) {
        if (this.byNames[i] === name) return;
      }
      if (this.byNames.length >= 8) {
        this.byNameSet = new Set(this.byNames);
        this.byNameSet.add(name);
      }
    }
    this.byNames.push(name);
  }

  /** Records a deduplicated dependency on a polyglot language domain's revision counter. */
  recordDomain(domain: LanguageDomainId): void {
    if (!this.domains) {
      this.domains = [domain];
      return;
    }
    if (this.domainSet) {
      if (this.domainSet.has(domain)) return;
      this.domainSet.add(domain);
    } else {
      for (let i = 0; i < this.domains.length; i++) {
        if (this.domains[i] === domain) return;
      }
      if (this.domains.length >= 8) {
        this.domainSet = new Set(this.domains);
        this.domainSet.add(domain);
      }
    }
    this.domains.push(domain);
  }

  /** Resets this tracker for zero-allocation reuse from `WasmQueryEngine.trackerPool`. */
  reset(): void {
    this.inputCount = 0;
    this.inputSet = undefined;
    this.queries = undefined;
    this.queryKeySet = undefined;
    this.byNames = undefined;
    this.byNameSet = undefined;
    this.domains = undefined;
    this.domainSet = undefined;
    this.durability = Durability.High;
    this.readsAllEntries = false;
  }

  /** Returns true if at least one direct symbol input dependency was recorded. */
  hasInputs(): boolean {
    return this.inputCount > 0;
  }

  /** Freezes and returns a compact Int32Array of recorded input symbol IDs. */
  finishInputs(): Int32Array | undefined {
    if (this.inputCount === 0) return undefined;
    return new Int32Array(this.inputBuffer.subarray(0, this.inputCount));
  }

  /** Synthetic compatibility getter for legacy callers inspecting raw `dependencies`. */
  get dependencies(): DependencyKey[] {
    const deps: DependencyKey[] = [];
    for (let i = 0; i < this.inputCount; i++) {
      deps.push({ kind: "input", symbolId: this.inputBuffer[i]! });
    }
    if (this.queries) {
      for (const q of this.queries) {
        deps.push({ kind: "query", queryName: q.queryName, symbolId: q.symbolId, argsHash: q.argsHash });
      }
    }
    if (this.byNames) {
      for (const name of this.byNames) {
        deps.push({ kind: "byName", name });
      }
    }
    if (this.domains) {
      for (const d of this.domains) {
        deps.push({ kind: "domain", domain: d });
      }
    }
    return deps;
  }
}

/**
 * Bounded recursive structural equality check used by Salsa backdating to determine
 * whether a recomputed query value is equivalent to its prior memoized result.
 * Includes O(1) 64-bit Merkle hash fast-paths for CST/AST/Symbol nodes and proper
 * handling of `Map`, `Set`, `Date`, `RegExp`, `TypedArray`, and `NaN`.
 */
function shallowEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (depth > 10) return false;

  // Fast-path O(1) 64-bit Merkle hash comparison for CST nodes, symbols, or AST fragments
  const aObj = a as any;
  const bObj = b as any;
  if (aObj.merkleLow !== undefined && bObj.merkleLow !== undefined) {
    if (aObj.merkleLow !== 0 || aObj.merkleHigh !== 0 || bObj.merkleLow !== 0 || bObj.merkleHigh !== 0) {
      return aObj.merkleLow === bObj.merkleLow && aObj.merkleHigh === bObj.merkleHigh;
    }
  }
  if (aObj._merkleLow !== undefined && bObj._merkleLow !== undefined) {
    if (aObj._merkleLow !== 0 || aObj._merkleHigh !== 0 || bObj._merkleLow !== 0 || bObj._merkleHigh !== 0) {
      return aObj._merkleLow === bObj._merkleLow && aObj._merkleHigh === bObj._merkleHigh;
    }
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shallowEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (Array.isArray(b)) return false;

  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
  }

  if (a instanceof RegExp || b instanceof RegExp) {
    return a instanceof RegExp && b instanceof RegExp && a.source === b.source && a.flags === b.flags;
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set) || a.size !== b.size) return false;
    for (const v of a) {
      if (!b.has(v)) return false;
    }
    return true;
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !shallowEqual(v, b.get(k), depth + 1)) return false;
    }
    return true;
  }

  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b)) return false;
    if (a.constructor !== b.constructor || a.byteLength !== b.byteLength) return false;
    const viewA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const viewB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false;
    }
    return true;
  }

  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    const valA = (a as Record<string, unknown>)[key];
    const valB = (b as Record<string, unknown>)[key];
    if (!Object.is(valA, valB) && !shallowEqual(valA, valB, depth + 1)) return false;
  }

  return true;
}

/**
 * Produces a deterministic, key-sorted JSON serialization of parameterized query arguments
 * (or returns `hashOverride` directly if supplied by the caller).
 */
function stableStringifyArgs(args: Record<string, unknown>, hashOverride?: string): string {
  if (hashOverride !== undefined) return hashOverride;
  return JSON.stringify(args, (_key, value) => {
    if (typeof value === "bigint") return { __bigint__: value.toString() };
    if (typeof value === "number" && !Number.isFinite(value)) return { __num__: String(value) };
    if (value instanceof Set) return { __set__: Array.from(value) };
    if (value instanceof Map) return { __map__: Array.from(value.entries()) };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.keys(value)
        .sort()
        .reduce(
          (acc, k) => {
            acc[k] = (value as Record<string, unknown>)[k];
            return acc;
          },
          {} as Record<string, unknown>,
        );
    }
    return value;
  });
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

  /** Next sequential collision-free numeric memo key ID allocated by this engine instance. */
  private nextMemoKeyId = 1;
  /** Two-level collision-free intern table for unparameterized queries: `queryId -> symbolId -> memoKeyId`. */
  private memoKeyByQuery = new Map<number, Map<SymbolId, number>>();
  /** Three-level collision-free intern table for parameterized queries: `queryId -> symbolId -> argsHash -> memoKeyId`. */
  private paramMemoKeyByQuery = new Map<number, Map<SymbolId, Map<string, number>>>();
  /** O(1) reverse lookup from `memoKeyId` to exact `SymbolId` (Float64Array preserves both negative virtual IDs and unsigned 32-bit polyglot IDs). */
  private keySymbolIds = new Float64Array(256);

  /** Optional persistent external cache store (e.g. IndexedDB / disk cache) for preflight memo hydration. */
  private cacheStore?: QueryCacheStore | undefined;
  /** Maximum number of memoized query entries retained before eviction triggers. */
  private maxMemos: number;
  /** Trait-based interop registry for O(1) zero-allocation foreign symbol capability queries. */
  public interopRegistry: SymbolInteropRegistry = defaultSymbolInteropRegistry;

  /** Returns the registered `SymbolInteropLibrary` for `symbolId`'s 8-bit language domain, if any. */
  public getForeignSymbolInterop(symbolId: SymbolId): SymbolInteropLibrary | undefined {
    return this.interopRegistry.getForSymbol(symbolId);
  }

  /** Returns the `InteropTrait` bitmask for a foreign `symbolId` in O(1) without DTO allocation. */
  public getForeignSymbolTraits(symbolId: SymbolId, index?: SymbolIndex): number {
    return this.interopRegistry.getTraits(symbolId, index);
  }

  /**
   * 3-tier Salsa durability last-changed revision table (`[Low, Medium, High]`).
   * `lastChangedAt[d]` is the latest global revision at which any input of durability `>= d` changed.
   * When `lastChangedAt[memo.durability] <= memo.verified_at`, the memo verifies in O(1) without `deepVerify`.
   */
  private lastChangedAt: [Revision, Revision, Revision] = [0, 0, 0];
  /** Zero-GC dense typed-array SoA store for per-symbol revisions and durability overrides. */
  private revisionStore = new LinearRevisionStore();
  /** Pre-allocated reusable pool of `DependencyTracker` frames to eliminate per-`execute()` GC churn. */
  private trackerPool: DependencyTracker[] = [];
  /** Per-domain durability override table (defaults to `Durability.Low`). */
  private domainDurabilities = new Map<LanguageDomainId, Durability>();
  /** Global structure revision bumped whenever symbols are added or removed (tracks `db.allEntries()`). */
  private globalStructureRevision: Revision = 0;
  /** Set of active non-default polyglot domain IDs present in this workspace (avoids hardcoded 1..16 probing). */
  private activeDomains = new Set<number>();

  /** Optional synchronous cooperative cancellation check polled during `fetch` and `execute`. */
  private cancelCheck: (() => boolean) | null = null;
  private cancelPollCounter = 0;
  private cancelPollInterval = 64;

  /** Configures a synchronous cancellation predicate polled every `pollInterval` query steps (default 64). */
  public setCancellationChecker(fn: (() => boolean) | null, pollInterval = 64): void {
    this.cancelCheck = fn;
    this.cancelPollInterval = Math.max(1, pollInterval);
    this.cancelPollCounter = 0;
  }

  /** Polls the cooperative cancellation checker if configured, throwing `QueryCancelledError` when cancelled. */
  private checkCancelled(): void {
    if (this.cancelCheck && ++this.cancelPollCounter % this.cancelPollInterval === 0 && this.cancelCheck()) {
      throw new QueryCancelledError();
    }
  }

  /** Assigns a Salsa durability tier (`Low`, `Medium`, `High`) to a specific symbol input. */
  public setInputDurability(symbolId: SymbolId, durability: Durability): void {
    this.revisionStore.setDurability(symbolId, durability);
  }

  /** Returns true when `resourceId` belongs to an immutable standard library or registry bundle. */
  private static isStdlibResourceId(resourceId: string): boolean {
    return (
      resourceId.startsWith("modelscript-stdlib://") ||
      resourceId.startsWith("modelscript-stdpack://") ||
      resourceId.startsWith("sysml2://stdlib/") ||
      resourceId.startsWith("dep-bundle:/") ||
      resourceId.startsWith("library-bundle:") ||
      resourceId.startsWith("modelica://") ||
      resourceId.includes("/modelscript_registry/")
    );
  }

  /** Returns the Salsa durability tier of a symbol input (auto-classifies stdlib resources as `High`). */
  public getInputDurability(symbolId: SymbolId): Durability {
    const explicit = this.revisionStore.getExplicitDurability(symbolId);
    if (explicit !== undefined) return explicit;
    const entry = this.index.symbols.get(symbolId);
    if (entry?.resourceId && WasmQueryEngine.isStdlibResourceId(entry.resourceId)) {
      return Durability.High;
    }
    const dom = getSymbolDomain(symbolId);
    if (dom !== LanguageDomainId.Default) {
      return this.domainDurabilities.get(dom) ?? Durability.Low;
    }
    return Durability.Low;
  }

  /** Assigns a Salsa durability tier to all symbols belonging to `resourceId` (e.g. `Durability.High` for MSL). */
  public setResourceDurability(resourceId: string, durability: Durability): void {
    const byRes = this.index.symbolsByResource?.get(resourceId);
    if (byRes) {
      for (const id of byRes) {
        this.revisionStore.setDurability(id, durability);
      }
      return;
    }
    for (const [id, entry] of this.index.symbols) {
      if (entry.resourceId === resourceId) {
        this.revisionStore.setDurability(id, durability);
      }
    }
  }

  /** Assigns a default Salsa durability tier to all symbols in a polyglot `LanguageDomainId`. */
  public setDomainDurability(domain: LanguageDomainId, durability: Durability): void {
    this.domainDurabilities.set(domain, durability);
  }

  /** Records that an input of durability `d` changed at `this.currentRevision`. */
  private bumpDurabilityRevision(d: Durability): void {
    for (let tier = Durability.Low; tier <= d; tier++) {
      this.lastChangedAt[tier] = this.currentRevision;
    }
  }

  /** Registers any non-default polyglot domain bit from `symbolId` in `activeDomains`. */
  private registerSymbolDomain(symbolId: SymbolId): void {
    if (symbolId > 0) {
      const dom = getSymbolDomain(symbolId);
      if (dom !== LanguageDomainId.Default) {
        this.activeDomains.add(dom);
      }
    }
  }

  /** Ontological taxonomy index for subtype and classification queries across polyglot domains. */
  public taxonomy: TaxonomyIndex = new TaxonomyIndex();

  /** Reverse dependency graph mapping each input `SymbolId` to the set of memo keys that read it. */
  private inputReverseDependencies = new Map<SymbolId, Set<number>>();
  /** Reverse dependency graph mapping symbol names to the set of memo keys that queried `byName(name)`. */
  private byNameReverseDependencies = new Map<string, Set<number>>();
  /** Revision table tracking when each symbol name's `byName` lookup set was last modified. */
  private byNameRevisions = new Map<string, Revision>();
  /** Snapshot of the last known name for each `SymbolId` to detect renames during `updateIndex`/`invalidate`. */
  private symbolNames = new Map<SymbolId, string>();
  /** Lightweight 32-bit structural fingerprint per `SymbolId` to detect in-place `updateIndex(this.index)` edits. */
  private symbolFingerprints = new Map<SymbolId, number>();

  /** Computes a fast 32-bit FNV-1a structural fingerprint of a `SymbolEntry` for in-place diff detection. */
  private static computeSymbolFingerprint(entry: SymbolEntry): number {
    let h = 0x811c9dc5;
    const mixNum = (n: number) => {
      h ^= n | 0;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    const mixStr = (s: string | null | undefined) => {
      mixNum(0x1f);
      if (!s) return;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
    };
    mixNum(entry.startOffset);
    mixNum(entry.endOffset);
    mixNum(entry.parentId ?? -0x7fffffff);
    mixStr(entry.name);
    mixStr(entry.kind);
    mixStr(entry.ruleName);
    mixStr(entry.fieldName);
    mixStr(entry.resourceId);
    if (entry.exports) {
      mixNum(entry.exports.length);
      for (let i = 0; i < entry.exports.length; i++) mixStr(entry.exports[i]);
    }
    if (entry.inherits) {
      mixNum(entry.inherits.length);
      for (let i = 0; i < entry.inherits.length; i++) mixStr(entry.inherits[i]);
    }
    if (entry.metadata) {
      const keys = Object.keys(entry.metadata);
      mixNum(keys.length);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        mixStr(k);
        const v = entry.metadata[k];
        if (typeof v === "string") mixStr(v);
        else if (typeof v === "number") mixNum(v);
        else if (typeof v === "boolean") mixNum(v ? 1 : 0);
        else if (v !== null && v !== undefined) {
          try {
            mixStr(JSON.stringify(v));
          } catch {
            mixStr(String(v));
          }
        }
      }
    }
    return h >>> 0;
  }
  /** Structured failure records from any `lint__*` hooks that threw during `runLints`. */
  private lintFailuresBySymbol = new Map<
    SymbolId,
    Array<{ symbolId: SymbolId; symbolName: string; lintName: string; message: string }>
  >();

  /** Optional cross-language TGG correspondence index linking symbols across polyglot domains. */
  private correspondenceIndex?: any;
  /** Mapping from `SymbolId` to its slot index within `correspondenceIndex` for cascading staleness propagation. */
  private correspondenceSlotMap?: Map<SymbolId, number> | undefined;
  /** Reverse mapping from correspondence slot index to the set of `SymbolId`s sharing that slot (O(1) lookup). */
  private correspondenceSlotToSymbols?: Map<number, Set<SymbolId>> | undefined;

  /** Lightweight telemetry counters for Salsa cache performance and invalidation analysis. */
  private stats = {
    fastHits: 0,
    durabilityHits: 0,
    deepVerifyHits: 0,
    backdateHits: 0,
    recomputes: 0,
    evictions: 0,
    cycles: 0,
  };

  /** Returns a snapshot of Salsa query engine telemetry counters. */
  public getStats(): {
    fastHits: number;
    durabilityHits: number;
    deepVerifyHits: number;
    backdateHits: number;
    recomputes: number;
    evictions: number;
    cycles: number;
    memoCount: number;
  } {
    return { ...this.stats, memoCount: this.memos.size };
  }

  /** Resets Salsa telemetry counters to zero. */
  public resetStats(): void {
    this.stats.fastHits = 0;
    this.stats.durabilityHits = 0;
    this.stats.deepVerifyHits = 0;
    this.stats.backdateHits = 0;
    this.stats.recomputes = 0;
    this.stats.evictions = 0;
    this.stats.cycles = 0;
  }

  /** Multi-slot map from SymbolId to all hypergraph slots it participates in. */
  private correspondenceSlotsBySymbol?: Map<SymbolId, Set<number>>;

  /** Attaches a cross-language Triple Graph Grammar (TGG) correspondence index and optional symbol-to-slot map(s). */
  public setCorrespondenceIndex(
    corr: any,
    slotMap?: Map<SymbolId, number>,
    slotsBySymbol?: Map<SymbolId, Set<number>>,
  ): void {
    this.correspondenceIndex = corr;
    if (slotsBySymbol) {
      this.correspondenceSlotsBySymbol = slotsBySymbol;
    }
    if (slotMap) {
      this.correspondenceSlotMap = slotMap;
      const rev = new Map<number, Set<SymbolId>>();
      if (slotsBySymbol && slotsBySymbol.size > 0) {
        for (const [symId, slots] of slotsBySymbol.entries()) {
          for (const slot of slots) {
            let set = rev.get(slot);
            if (!set) {
              set = new Set();
              rev.set(slot, set);
            }
            set.add(symId);
          }
        }
      } else {
        for (const [symId, slot] of slotMap.entries()) {
          let set = rev.get(slot);
          if (!set) {
            set = new Set();
            rev.set(slot, set);
          }
          set.add(symId);
        }
      }
      this.correspondenceSlotToSymbols = rev;
    }
    if (this.byNameReverseDependencies.has("__tgg_correspondence__")) {
      this.currentRevision++;
      this.invalidateByName("__tgg_correspondence__");
    }
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
    if (!this.correspondenceSlotToSymbols) {
      this.correspondenceSlotToSymbols = new Map();
    }
    const prevSlot = this.correspondenceSlotMap.get(symbolId);
    if (prevSlot !== undefined && prevSlot !== slot) {
      const prevSet = this.correspondenceSlotToSymbols.get(prevSlot);
      if (prevSet) {
        prevSet.delete(symbolId);
        if (prevSet.size === 0) this.correspondenceSlotToSymbols.delete(prevSlot);
      }
    }
    this.correspondenceSlotMap.set(symbolId, slot);
    let set = this.correspondenceSlotToSymbols.get(slot);
    if (!set) {
      set = new Set();
      this.correspondenceSlotToSymbols.set(slot, set);
    }
    set.add(symbolId);
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
    "resolvedArrayDimensionAt",
    "resolvedDimParamValue",
    "cyclicDimensionInfo",
  ]);

  /** Marks a query name as volatile so its memoized results are cleared when `flushVolatile()` is called. */
  public markVolatile(queryName: string): void {
    this.volatileQueryNames.add(queryName);
  }

  /** Purges all memoized entries belonging to queries registered in `volatileQueryNames`. */
  public flushVolatile(): void {
    const volatileModIds = new Set<number>();
    for (const name of this.volatileQueryNames) {
      const id = WasmQueryEngine.queryIds.get(name);
      if (id !== undefined) volatileModIds.add(id % 1000);
    }
    if (volatileModIds.size === 0 && this.volatileQueryNames.size === 0) return;

    const toDelete: number[] = [];
    for (const [key, memo] of this.memos) {
      if (memo.queryName !== undefined) {
        if (this.volatileQueryNames.has(memo.queryName)) {
          toDelete.push(key);
        }
      } else {
        const queryId = Math.floor(key / 100000) % 1000;
        if (volatileModIds.has(queryId)) {
          toDelete.push(key);
        }
      }
    }
    for (const key of toDelete) {
      this.deleteMemo(key);
    }
  }

  /**
   * Purges all memoized query entries and reverse dependency tracking to bound memory.
   */
  public clearMemos(): void {
    this.memos.clear();
    this.inputReverseDependencies.clear();
    this.byNameReverseDependencies.clear();
    this.queryReverseDependencies.clear();
    this.domainReverseDependencies.clear();
  }

  /** Deletes a memo entry and unlinks all of its reverse-dependency references to prevent leaks. */
  private deleteMemo(key: number): void {
    const memo = this.memos.get(key);
    if (!memo) return;
    this.memos.delete(key);
    this.unlinkMemoReverseDeps(key, memo);
  }

  /** Registers reverse-dependency edges for a newly stored or hydrated memo. */
  private linkMemoReverseDeps(key: number, memo: Memo): void {
    if (memo.inputs) {
      const len = memo.inputs.length;
      for (let i = 0; i < len; i++) {
        const symId = memo.inputs[i]!;
        let set = this.inputReverseDependencies.get(symId);
        if (!set) {
          set = new Set();
          this.inputReverseDependencies.set(symId, set);
        }
        set.add(key);
      }
    }
    if (memo.byNames) {
      for (const name of memo.byNames) {
        let set = this.byNameReverseDependencies.get(name);
        if (!set) {
          set = new Set();
          this.byNameReverseDependencies.set(name, set);
        }
        set.add(key);
      }
    }
    if (memo.domains) {
      for (const dom of memo.domains) {
        let set = this.domainReverseDependencies.get(dom);
        if (!set) {
          set = new Set();
          this.domainReverseDependencies.set(dom, set);
        }
        set.add(key);
      }
    }
    if (memo.queries) {
      for (const q of memo.queries) {
        const depKey = q.key ?? this.memoKey(q.queryName, q.symbolId, q.argsHash);
        let set = this.queryReverseDependencies.get(depKey);
        if (!set) {
          set = new Set();
          this.queryReverseDependencies.set(depKey, set);
        }
        set.add(key);
      }
    }
  }

  private unlinkMemoReverseDeps(key: number, memo: Memo): void {
    if (memo.inputs) {
      for (let i = 0; i < memo.inputs.length; i++) {
        const symId = memo.inputs[i]!;
        const set = this.inputReverseDependencies.get(symId);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.inputReverseDependencies.delete(symId);
        }
      }
    }
    if (memo.byNames) {
      for (const name of memo.byNames) {
        const set = this.byNameReverseDependencies.get(name);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.byNameReverseDependencies.delete(name);
        }
      }
    }
    if (memo.domains) {
      for (const dom of memo.domains) {
        const set = this.domainReverseDependencies.get(dom);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.domainReverseDependencies.delete(dom);
        }
      }
    }
    if (memo.queries) {
      for (const q of memo.queries) {
        const depKey = q.key ?? this.memoKey(q.queryName, q.symbolId, q.argsHash);
        const set = this.queryReverseDependencies.get(depKey);
        if (set) {
          set.delete(key);
          if (set.size === 0) this.queryReverseDependencies.delete(depKey);
        }
      }
    }
  }

  /**
   * Reverse dependency graph mapping a packed memo key to the set of packed memo keys whose
   * execution read it via `db.query(...)`. Used to propagate lint dirtiness transitively.
   */
  private queryReverseDependencies = new Map<number, Set<number>>();
  /** Reverse dependency graph mapping a `LanguageDomainId` to the set of packed memo keys that read its revision. */
  private domainReverseDependencies = new Map<LanguageDomainId, Set<number>>();

  /**
   * Marks the owning symbols of `seedKeys` and of every memo that transitively depends on them
   * (through `queryReverseDependencies`) dirty in all incremental lint caches.
   *
   * Without the transitive walk, a lint `lint__X(A) → classInstance(A) → resolveSimpleName(B)`
   * would never be re-run when `B`'s input changes, because only `B` would be marked dirty and
   * `runAllLintsAsync` serves non-dirty symbols straight from `lintCache`.
   */
  private markLintDirtyTransitive(seedKeys: Iterable<number>): void {
    if (this.dirtyLintSymbols.size === 0) return;
    const visited = new Set<number>();
    const stack: number[] = [];
    for (const k of seedKeys) {
      if (!visited.has(k)) {
        visited.add(k);
        stack.push(k);
      }
    }
    while (stack.length > 0) {
      const key = stack.pop()!;
      const depSymId = this.symbolIdFromKey(key);
      for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
        cacheDirtySet.add(depSymId);
      }
      const dependents = this.queryReverseDependencies.get(key);
      if (!dependents) continue;
      for (const d of dependents) {
        if (!visited.has(d)) {
          visited.add(d);
          stack.push(d);
        }
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
      const keysCopy = Array.from(dependentKeys);
      this.markLintDirtyTransitive(keysCopy);
      for (const key of keysCopy) {
        this.deleteMemo(key);
      }
    }
  }

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
    this.bumpDurabilityRevision(this.domainDurabilities.get(domain) ?? Durability.Low);
    this.globalStructureRevision = this.currentRevision;
    const domainDepKeys = this.domainReverseDependencies.get(domain);
    if (domainDepKeys) {
      this.markLintDirtyTransitive(domainDepKeys);
    }
    for (const id of this.index.symbols.keys()) {
      if (getSymbolDomain(id) === domain) {
        this.revisionStore.setRevision(id, this.currentRevision);
        for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
          cacheDirtySet.add(id);
        }
        const depKeys = this.inputReverseDependencies.get(id);
        if (depKeys) {
          this.markLintDirtyTransitive(depKeys);
        }
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
  private executionStack: {
    key: number;
    queryName: string;
    symbolId: SymbolId;
    inCycle: boolean;
    isCycleHead: boolean;
  }[] = [];
  /** Set of packed memo keys currently undergoing `deepVerify` to guard against verification cycles. */
  private activeVerifications = new Set<number>();
  /** Grammar rule name -> `QueryHooks` dispatch table registered for this language engine. */
  private hooksByRule: Map<string, QueryHooks>;

  // Virtual entry infrastructure (specialization)
  /** Synthetic `SymbolEntry` instances allocated via `db.specialize()` (indexed by negative `SymbolId`). */
  private virtualEntries = new Map<SymbolId, SymbolEntry>();
  /** Reverse index from parent `SymbolId` to virtual child `SymbolEntry`s for O(1) `childrenOf` lookup. */
  private virtualChildrenOf = new Map<SymbolId, SymbolEntry[]>();
  /** Reverse index from base `SymbolId` to all specialized virtual `SymbolId`s derived from it. */
  private virtualsByBase = new Map<SymbolId, Set<SymbolId>>();
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
      this.revisionStore.setRevision(id, 0);
      this.symbolNames.set(id, entry.name);
      this.symbolFingerprints.set(id, WasmQueryEngine.computeSymbolFingerprint(entry));
      this.registerSymbolDomain(id);
    }
  }

  /**
   * Evicts a single memo entry using durability-aware LRU: inspects up to 8 least-recently-used
   * entries and prefers evicting `Low`/`Medium`-durability memos over `High`-durability stdlib memos.
   */
  private evictOneMemo(): void {
    let victimKey: number | undefined;
    let lowestDurability = Durability.High + 1;
    let scanned = 0;
    for (const [k, m] of this.memos) {
      const dur = m.durability ?? Durability.Low;
      if (dur < lowestDurability) {
        lowestDurability = dur;
        victimKey = k;
        if (dur === Durability.Low) break;
      }
      if (++scanned >= 8) break;
    }
    if (victimKey !== undefined) {
      this.deleteMemo(victimKey);
      this.stats.evictions++;
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

  /**
   * Hydrates pre-computed `Memo` entries into the internal memoization table,
   * re-keying deterministically when `queryName`/`symbolId` metadata is present,
   * clamping revisions to `this.currentRevision`, enforcing `maxMemos`, and
   * rebuilding reverse-dependency indices.
   */
  public hydrateMemos(memos: Map<number, Memo>): void {
    for (const [rawKey, rawMemo] of memos) {
      const key =
        rawMemo.queryName !== undefined && rawMemo.symbolId !== undefined
          ? this.memoKey(rawMemo.queryName, rawMemo.symbolId, rawMemo.argsHash)
          : rawKey;

      const memo: Memo =
        rawMemo.verified_at > this.currentRevision || rawMemo.changed_at > this.currentRevision
          ? {
              ...rawMemo,
              verified_at: Math.min(rawMemo.verified_at, this.currentRevision),
              changed_at: Math.min(rawMemo.changed_at, this.currentRevision),
            }
          : rawMemo;

      const prevMemo = this.memos.get(key);
      if (prevMemo) {
        this.unlinkMemoReverseDeps(key, prevMemo);
      } else if (this.memos.size >= this.maxMemos) {
        this.evictOneMemo();
      }
      this.memos.set(key, memo);
      this.linkMemoReverseDeps(key, memo);
    }
  }

  /** Looks up the raw `Memo` record for `(queryName, symbolId, argsHash)` without triggering evaluation. */
  public getMemoFor(queryName: string, symbolId: SymbolId, argsHash?: string): Memo | undefined {
    const key = this.memoKey(queryName, symbolId, argsHash);
    return this.memos.get(key);
  }

  /** Allocates a fresh collision-free sequential numeric memo key ID and records its `symbolId`. */
  private allocateMemoKeyId(symbolId: SymbolId): number {
    const id = this.nextMemoKeyId++;
    if (id >= this.keySymbolIds.length) {
      const next = new Float64Array(this.keySymbolIds.length * 2);
      next.set(this.keySymbolIds);
      this.keySymbolIds = next;
    }
    this.keySymbolIds[id] = symbolId;
    return id;
  }

  /**
   * Returns a collision-free numeric key for `(queryName, symbolId, argsHash)` backed by
   * a per-engine hierarchical intern table. Supports all 256 polyglot language domains,
   * full 32-bit symbol IDs (including negative virtual IDs), unlimited query names, and
   * unlimited parameterized argument hashes without hash collisions or modulo wraparound.
   */
  public memoKey(queryName: string, symbolId: SymbolId, argsHash?: string): number {
    const qId = this.getQueryId(queryName);
    if (!argsHash) {
      let bySym = this.memoKeyByQuery.get(qId);
      if (!bySym) {
        bySym = new Map<SymbolId, number>();
        this.memoKeyByQuery.set(qId, bySym);
      }
      let key = bySym.get(symbolId);
      if (key === undefined) {
        key = this.allocateMemoKeyId(symbolId);
        bySym.set(symbolId, key);
      }
      return key;
    }

    let bySym = this.paramMemoKeyByQuery.get(qId);
    if (!bySym) {
      bySym = new Map<SymbolId, Map<string, number>>();
      this.paramMemoKeyByQuery.set(qId, bySym);
    }
    let byArgs = bySym.get(symbolId);
    if (!byArgs) {
      byArgs = new Map<string, number>();
      bySym.set(symbolId, byArgs);
    }
    let key = byArgs.get(argsHash);
    if (key === undefined) {
      key = this.allocateMemoKeyId(symbolId);
      byArgs.set(argsHash, key);
    }
    return key;
  }

  /** Returns the exact `SymbolId` associated with `key` in O(1). */
  private symbolIdFromKey(key: number): SymbolId {
    if (key > 0 && key < this.nextMemoKeyId) {
      return this.keySymbolIds[key]!;
    }
    // Legacy fallback for externally hydrated packed numeric keys without queryName/symbolId metadata
    const compactSym = Math.floor(key / 100_000_000);
    const domain = Math.floor(compactSym / 500_000);
    const localSeq = compactSym % 500_000;
    const absSymbolId = domain > 0 ? (((domain & 0x7f) << 24) | localSeq) >>> 0 : localSeq;
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

  /** Extracts raw source text for the character span `[startOffset, endOffset]` from the backing CST or document store. */
  public getCstText(startOffset: number, endOffset: number, entry?: SymbolEntry): string | null {
    const start = startOffset !== undefined ? startOffset : entry ? entry.startOffset : 0;
    const end = endOffset !== undefined ? endOffset : entry ? entry.endOffset : 0;
    if (this.tree && typeof (this.tree as any).getText === "function") {
      const text = (this.tree as any).getText(start, end, entry);
      if (text !== null && text !== undefined) return text;
    }
    const docs =
      (this.index as any).documents ||
      (this.index as any).workspace?.documents ||
      (this.index as any).workspaceIndex?.documents;
    if (entry?.resourceId && docs) {
      const doc = docs.get(entry.resourceId);
      if (doc && typeof doc.getText === "function") {
        return doc.getText().substring(start, end);
      }
    }
    if (this.tree && typeof (this.tree as any).sourceCode === "string") {
      const src = (this.tree as any).sourceCode as string;
      if (start >= 0 && start <= src.length) {
        return src.substring(start, Math.min(end, src.length));
      }
    }
    if (this.tree && (this.tree as any).rootNode) {
      const root = (this.tree as any).rootNode;
      const src = root.tree?.sourceCode ?? root.tree?.text;
      if (typeof src === "string" && start >= 0 && start <= src.length) {
        return src.substring(start, Math.min(end, src.length));
      }
      const text = root.text;
      const offset = root.startOffset ?? root.startIndex ?? 0;
      if (typeof text === "string" && start >= offset && start - offset <= text.length) {
        return text.substring(start - offset, Math.min(end - offset, text.length));
      }
    }
    return null;
  }

  /** Recovers the linear CST node corresponding to `id`'s recorded offset range. */
  public getCstNode(id: SymbolId): unknown | null {
    const entry = this.resolveEntry(id);
    if (!entry) return null;
    return this.getCstNodeRange(entry.startOffset, entry.endOffset, entry);
  }

  /** Recovers the smallest CST node enclosing `[startOffset, endOffset]` from the backing syntax tree. */
  public getCstNodeRange(startOffset: number, endOffset: number, entry?: SymbolEntry): unknown | null {
    const start = startOffset !== undefined ? startOffset : entry ? entry.startOffset : 0;
    const end = endOffset !== undefined ? endOffset : entry ? entry.endOffset : 0;
    let treeToUse = this.tree;
    const docs =
      (this.index as any).documents ||
      (this.index as any).workspace?.documents ||
      (this.index as any).workspaceIndex?.documents;
    if (entry?.resourceId && docs) {
      const doc = docs.get(entry.resourceId);
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
        const s = n.startOffset ?? n.startIndex ?? -1;
        const e = n.endOffset ?? n.endIndex ?? -1;
        if (s === start && e === end) return n;
        for (const c of n.children || []) {
          const cs = c.startOffset ?? c.startIndex ?? -1;
          const ce = c.endOffset ?? c.endIndex ?? -1;
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
  public cstText(startOffset: number, endOffset: number, entry?: SymbolEntry): string | null {
    return this.getCstText(startOffset, endOffset, entry);
  }

  /** Alias for `getCstNode` conforming to the `QueryDB` interface. */
  public cstNode(id: SymbolId): unknown | null {
    return this.getCstNode(id);
  }

  /** Alias for `getCstNodeRange` conforming to the `QueryDB` interface. */
  public cstNodeRange(startOffset: number, endOffset: number, entry?: SymbolEntry): unknown | null {
    return this.getCstNodeRange(startOffset, endOffset, entry);
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

  /**
   * Evaluates or retrieves the memoized 3D formal verification overlay for a class/component symbol,
   * including dynamic clearance violations, safety shells, and counterexample witness states.
   */
  public verification3DOverlay<T = unknown>(symbolId: SymbolId): T {
    return this.query<T>("verification3DOverlay", symbolId);
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
    explicitChangedNames?: Set<string>,
  ): void {
    const changedIds = explicitChangedIds ? new Set<SymbolId>(explicitChangedIds) : new Set<SymbolId>();
    const changedNames = explicitChangedNames ? new Set<string>(explicitChangedNames) : new Set<string>();

    // Collect changed names for explicit IDs too so peer engines invalidate byName dependencies
    if (explicitChangedIds && explicitChangedIds.size > 0) {
      for (const id of explicitChangedIds) {
        const oldName = this.index.symbols.get(id)?.name ?? this.symbolNames.get(id);
        const newName = newIndex.symbols.get(id)?.name;
        if (oldName) changedNames.add(oldName);
        if (newName) changedNames.add(newName);
      }
    }

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
      // 3. Detect newly added symbols or existing symbols whose span, kind, parent, rule, name, or metadata changed
      // (including in-place `this.index === newIndex` mutations via `symbolFingerprints`).
      const sameIndex = this.index === newIndex;
      for (const [id, entry] of newIndex.symbols) {
        const old = sameIndex ? undefined : this.index.symbols.get(id);
        const prevName = old?.name ?? this.symbolNames.get(id);
        if (!old && prevName === undefined) {
          changedIds.add(id);
          if (entry.name) changedNames.add(entry.name);
        } else if (
          (old &&
            (old.startOffset !== entry.startOffset ||
              old.endOffset !== entry.endOffset ||
              old.name !== entry.name ||
              old.kind !== entry.kind ||
              old.parentId !== entry.parentId ||
              old.ruleName !== entry.ruleName ||
              old.fieldName !== entry.fieldName ||
              old.resourceId !== entry.resourceId ||
              !shallowEqual(old.metadata, entry.metadata) ||
              !shallowEqual(old.exports, entry.exports) ||
              !shallowEqual(old.inherits, entry.inherits))) ||
          (prevName !== undefined && prevName !== entry.name) ||
          (sameIndex && this.symbolFingerprints.get(id) !== WasmQueryEngine.computeSymbolFingerprint(entry))
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
          keys.push(stableMemoCacheKey(q, id));
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
    const rawIds = changedSymbolIds instanceof Set ? changedSymbolIds : new Set(changedSymbolIds);
    const ids = new Set<SymbolId>(rawIds);
    const structIds = structuralChangedIds ? new Set<SymbolId>(structuralChangedIds) : undefined;

    // Expand local un-prefixed SymbolIds to matching polyglot domain-prefixed SymbolIds when
    // the engine backs a merged UnifiedWorkspace whose per-language indices were remapped.
    if (this.activeDomains.size > 0) {
      for (const id of rawIds) {
        if (id > 0 && getSymbolDomain(id) === 0) {
          for (const d of this.activeDomains) {
            const polyId = makePolyglotSymbolId(d, id);
            if (
              this.index.symbols.has(polyId) ||
              this.symbolNames.has(polyId) ||
              this.revisionStore.hasRevision(polyId) ||
              this.inputReverseDependencies.has(polyId)
            ) {
              ids.add(polyId);
            }
          }
        }
      }
      if (structuralChangedIds && structIds) {
        for (const id of structuralChangedIds) {
          if (id > 0 && getSymbolDomain(id) === 0) {
            for (const d of this.activeDomains) {
              const polyId = makePolyglotSymbolId(d, id);
              if (
                this.index.symbols.has(polyId) ||
                this.symbolNames.has(polyId) ||
                this.revisionStore.hasRevision(polyId) ||
                this.inputReverseDependencies.has(polyId)
              ) {
                structIds.add(polyId);
              }
            }
          }
        }
      }
    }

    // Propagate invalidation from modified base symbols to their specialized virtual entries
    // and refresh virtual entry snapshots from the updated base.
    if (this.virtualsByBase.size > 0) {
      for (const baseId of Array.from(ids)) {
        const virtualIds = this.virtualsByBase.get(baseId);
        if (!virtualIds) continue;
        const updatedBase = this.index.symbols.get(baseId);
        for (const vid of virtualIds) {
          ids.add(vid);
          if (structIds?.has(baseId)) structIds.add(vid);
          if (updatedBase) {
            this.virtualEntries.set(vid, {
              ...updatedBase,
              id: vid,
              startOffset: updatedBase.startOffset,
              endOffset: updatedBase.endOffset,
              metadata: { ...updatedBase.metadata },
            });
          }
        }
      }
    }

    // Step 1: Bump per-symbol input revisions, durability revisions, domain revisions,
    // and invalidate `byName` reverse dependencies whenever a symbol is newly added, renamed, or deleted.
    let maxChangedDurability: Durability = Durability.Low;
    let structureChanged = false;
    for (const id of ids) {
      this.registerSymbolDomain(id);
      this.revisionStore.setRevision(id, this.currentRevision);
      const idDur = this.getInputDurability(id);
      if (idDur > maxChangedDurability) maxChangedDurability = idDur;
      const domain = getSymbolDomain(id);
      if (domain !== LanguageDomainId.Default) {
        this.incrementDomainRevision(domain);
      }
      const entry = this.index.symbols.get(id);
      const prevName = this.symbolNames.get(id);
      if (entry) {
        if (prevName === undefined) {
          structureChanged = true;
          if (entry.name) this.invalidateByName(entry.name);
        } else if (prevName !== entry.name) {
          if (entry.name) this.invalidateByName(entry.name);
          if (prevName) this.invalidateByName(prevName);
        }
        this.symbolNames.set(id, entry.name);
        this.symbolFingerprints.set(id, WasmQueryEngine.computeSymbolFingerprint(entry));
      } else if (prevName) {
        structureChanged = true;
        this.invalidateByName(prevName);
        this.symbolNames.delete(id);
        this.symbolFingerprints.delete(id);
      }
    }

    if (ids.size > 0 || (changedNames && changedNames.size > 0)) {
      this.bumpDurabilityRevision(maxChangedDurability);
    }
    if (structureChanged) {
      this.globalStructureRevision = this.currentRevision;
    }

    // Step 2: Invalidate any explicit symbol names reported by the caller.
    if (changedNames) {
      for (const name of changedNames) {
        this.invalidateByName(name);
      }
    }

    // Step 3: Traverse `inputReverseDependencies` for structurally changed symbols,
    // evicting dependent memos (and unlinking their reverse deps) and marking targets dirty for re-linting.
    if (structIds) {
      for (const id of structIds) {
        const dependentKeys = this.inputReverseDependencies.get(id);
        if (dependentKeys) {
          const keysCopy = Array.from(dependentKeys);
          this.markLintDirtyTransitive(keysCopy);
          for (const key of keysCopy) {
            this.deleteMemo(key);
          }
        }
        const entry = this.index.symbols.get(id);
        if (entry?.name) {
          this.invalidateByName(entry.name);
        }
      }
    }

    // Step 4: Mark all changed symbols and every memo that transitively reads them dirty in the
    // incremental lint caches.
    for (const id of ids) {
      for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
        cacheDirtySet.add(id);
      }
      const dependentKeys = this.inputReverseDependencies.get(id);
      if (dependentKeys) {
        this.markLintDirtyTransitive(dependentKeys);
      }
    }

    // Step 5: Propagate staleness across cross-domain TGG correspondence links if configured.
    if (this.correspondenceIndex) {
      const isWasmCorrIndex = typeof this.correspondenceIndex.markStaleCascading === "function";
      for (const id of ids) {
        if (isWasmCorrIndex) {
          if (typeof this.correspondenceIndex.markStale === "function") {
            this.correspondenceIndex.markStale(id);
          }
          const slots = this.correspondenceSlotsBySymbol?.get(id);
          if (slots && slots.size > 0) {
            for (const slot of slots) {
              this.correspondenceIndex.markStaleCascading(slot);
            }
          } else {
            const parentSlot = this.correspondenceSlotMap?.get(id);
            if (parentSlot !== undefined) {
              this.correspondenceIndex.markStaleCascading(parentSlot);
            }
          }
        } else if (typeof this.correspondenceIndex.markStale === "function") {
          // DigitalThreadHypergraph.markStale(slot) expects a 0-based slot index, NOT a SymbolId.
          const slots = this.correspondenceSlotsBySymbol?.get(id);
          if (slots && slots.size > 0) {
            for (const slot of slots) {
              this.correspondenceIndex.markStale(slot);
            }
          } else {
            const slot = this.correspondenceSlotMap?.get(id);
            if (slot !== undefined) {
              this.correspondenceIndex.markStale(slot);
            }
          }
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

  /** Returns any structured failure records collected from throwing `lint__*` hooks. */
  public getLintFailures(): Array<{ symbolId: SymbolId; symbolName: string; lintName: string; message: string }> {
    const out: Array<{ symbolId: SymbolId; symbolName: string; lintName: string; message: string }> = [];
    for (const items of this.lintFailuresBySymbol.values()) {
      out.push(...items);
    }
    return out;
  }

  /** Clears recorded lint hook failure records (optionally for a specific symbol). */
  public clearLintFailures(symbolId?: SymbolId): void {
    if (symbolId !== undefined) {
      this.lintFailuresBySymbol.delete(symbolId);
    } else {
      this.lintFailuresBySymbol.clear();
    }
  }

  /** Executes all `lint__*` query hooks registered for `symbolId`'s grammar rule and returns their raw `LintResult`s. */
  public runLints(symbolId: SymbolId): { lintName: string; result: LintResult }[] {
    this.lintFailuresBySymbol.delete(symbolId);
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
        const errMsg = e?.message ? String(e.message) : String(e);
        let list = this.lintFailuresBySymbol.get(symbolId);
        if (!list) {
          list = [];
          this.lintFailuresBySymbol.set(symbolId, list);
        }
        list.push({
          symbolId,
          symbolName: entry.name,
          lintName,
          message: errMsg,
        });
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
   * Resolves the precise character offset range for a `LintResult` against its `SymbolEntry`,
   * preferring explicit `result` spans, named `fieldRanges[result.field]`, identifier field ranges,
   * and finally the full symbol entry span.
   */
  private resolveLintDiagnosticRange(
    entry: SymbolEntry,
    result: LintResult,
  ): {
    startOffset: number;
    endOffset: number;
  } {
    const entryStart = entry.startOffset;
    const entryEnd = entry.endOffset;
    const rStart = result.startOffset;
    const rEnd = result.endOffset;
    const isWholeEntryRange = rStart === entryStart && rEnd === entryEnd;

    const trimWithinEntry = (s: number, e: number): { startOffset: number; endOffset: number } => {
      if (e <= s + 1) return { startOffset: s, endOffset: e };
      const cstText = (this as unknown as { cstNode?: (id: SymbolId) => { text?: string } | null }).cstNode?.(
        entry.id,
      )?.text;
      if (!cstText || s < entryStart || e > entryStart + cstText.length) {
        return { startOffset: s, endOffset: e };
      }
      let relS = s - entryStart;
      let relE = e - entryStart;
      while (relS < relE - 1 && (cstText[relS] === " " || cstText[relS] === "\t")) {
        relS++;
      }
      while (
        relE > relS + 1 &&
        (cstText[relE - 1] === " " ||
          cstText[relE - 1] === "\t" ||
          cstText[relE - 1] === "\r" ||
          cstText[relE - 1] === "\n")
      ) {
        relE--;
      }
      return { startOffset: entryStart + relS, endOffset: entryStart + relE };
    };

    if (rStart !== undefined && rEnd !== undefined && rEnd >= rStart && !isWholeEntryRange) {
      return trimWithinEntry(rStart, rEnd);
    }

    const fieldRange = result.field ? entry.fieldRanges?.[result.field] : undefined;
    if (fieldRange) {
      return trimWithinEntry(fieldRange.startOffset, fieldRange.endOffset);
    }

    const fallbackField =
      entry.fieldRanges?.["declaredName"] ??
      entry.fieldRanges?.["name"] ??
      entry.fieldRanges?.["id"] ??
      entry.fieldRanges?.["typeName"];
    if (fallbackField) {
      return trimWithinEntry(fallbackField.startOffset, fallbackField.endOffset);
    }

    const cstText = (this as unknown as { cstNode?: (id: SymbolId) => { text?: string } | null }).cstNode?.(
      entry.id,
    )?.text;
    if (cstText) {
      const leadMatch = cstText.match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (leadMatch) {
        return {
          startOffset: entryStart,
          endOffset: entryStart + leadMatch[0].length,
        };
      }
    }

    return {
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
        const { startOffset, endOffset } = this.resolveLintDiagnosticRange(entry, result);
        diagnostics.push({
          symbolId: id,
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
   * @param viewportRange Optional visible offset range prioritized ahead of off-screen symbols.
   */
  public async runAllLintsAsync(
    resourceId?: string,
    yieldFn?: () => Promise<boolean>,
    viewportRange?: {
      startOffset?: number | undefined;
      endOffset?: number | undefined;
    },
  ): Promise<LintDiagnostic[]> {
    const cacheKey = resourceId ?? "__all__";
    const norm = (u: string) => u.replace(/^([a-z0-9+-]+):\/{1,3}/i, "$1:///");
    const targetNorm = resourceId ? norm(resourceId) : undefined;
    let perSymbolCache = this.lintCache.get(cacheKey);
    let cacheDirtySet = this.dirtyLintSymbols.get(cacheKey);

    if (!perSymbolCache || !cacheDirtySet) {
      perSymbolCache = new Map();
      this.lintCache.set(cacheKey, perSymbolCache);
      if (resourceId) {
        const resIds =
          this.index.symbolsByResource?.get(resourceId) ??
          (targetNorm ? this.index.symbolsByResource?.get(targetNorm) : undefined);
        if (resIds) {
          cacheDirtySet = new Set(resIds);
        } else {
          cacheDirtySet = new Set<SymbolId>();
          for (const [id, entry] of this.index.symbols) {
            if (entry.resourceId && (entry.resourceId === resourceId || norm(entry.resourceId) === targetNorm)) {
              cacheDirtySet.add(id);
            }
          }
        }
      } else {
        cacheDirtySet = new Set(this.index.symbols.keys());
      }
      this.dirtyLintSymbols.set(cacheKey, cacheDirtySet);
    }

    const symbolsToRelint: [SymbolId, SymbolEntry][] = [];

    for (const id of cacheDirtySet) {
      const entry = this.index.symbols.get(id);
      if (!entry) {
        cacheDirtySet.delete(id);
        perSymbolCache.delete(id);
        continue;
      }
      if (resourceId && entry.resourceId !== resourceId) {
        if (!entry.resourceId || norm(entry.resourceId) !== targetNorm) {
          cacheDirtySet.delete(id);
          continue;
        }
      }
      symbolsToRelint.push([id, entry]);
    }

    if (viewportRange && symbolsToRelint.length > 1) {
      const vpStart = viewportRange.startOffset ?? 0;
      const vpEnd = viewportRange.endOffset ?? Infinity;
      const inViewport: [SymbolId, SymbolEntry][] = [];
      const outViewport: [SymbolId, SymbolEntry][] = [];
      for (const pair of symbolsToRelint) {
        const entry = pair[1];
        const entryStart = entry.startOffset;
        const entryEnd = entry.endOffset;
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
        const { startOffset, endOffset } = this.resolveLintDiagnosticRange(entry, result);
        diags.push({
          symbolId: id,
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

    this.lintCacheRevision.set(cacheKey, this.currentRevision);

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
    this.lintCacheRevision.delete(resourceId);
    const norm = (u: string) => u.replace(/^([a-z0-9+-]+):\/{0,3}/i, "$1:///");
    const targetNorm = norm(resourceId);
    this.lintCache.delete(targetNorm);
    this.dirtyLintSymbols.delete(targetNorm);
    this.lintCacheRevision.delete(targetNorm);

    const disposedEntries: [SymbolId, SymbolEntry][] = [];
    const byRes = this.index.symbolsByResource?.get(resourceId) ?? this.index.symbolsByResource?.get(targetNorm);
    if (byRes) {
      for (const id of byRes) {
        const entry = this.index.symbols.get(id);
        if (entry) disposedEntries.push([id, entry]);
      }
    } else {
      for (const [id, entry] of this.index.symbols) {
        if (entry.resourceId && norm(entry.resourceId) === targetNorm) {
          disposedEntries.push([id, entry]);
        }
      }
    }

    if (disposedEntries.length === 0) return;

    // Bump revision once for the entire disposed document instead of once per symbol.
    const rev = ++this.currentRevision;
    this.globalStructureRevision = rev;
    let maxDur: Durability = Durability.Low;
    for (const [id, entry] of disposedEntries) {
      this.revisionStore.setRevision(id, rev);
      const idDur = this.getInputDurability(id);
      if (idDur > maxDur) maxDur = idDur;
      const dependentKeys = this.inputReverseDependencies.get(id);
      if (dependentKeys) {
        const keysCopy = Array.from(dependentKeys);
        this.markLintDirtyTransitive(keysCopy);
        for (const key of keysCopy) {
          this.deleteMemo(key);
        }
      }
      if (entry.name) {
        this.invalidateByName(entry.name);
      }
      this.symbolNames.delete(id);
      this.symbolFingerprints.delete(id);
      for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
        cacheDirtySet.add(id);
      }
    }
    this.bumpDurabilityRevision(maxDur);
  }

  private getEquationHelperHost(): EquationHelperHost {
    return {
      index: this.index,
      resolveEntry: (id) => this.resolveEntry(id),
      getCstNode: (id) => this.getCstNode(id),
      hasHook: (ruleName, queryName) => Boolean(this.hooksByRule.get(ruleName)?.[queryName]),
      query: <T = unknown>(queryName: string, id: SymbolId) => this.fetch(queryName, id) as T,
    };
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
    return checkEquationBalanceForSymbol(this.getEquationHelperHost(), symbolId);
  }

  /**
   * Computes strongly connected components (algebraic loops) for equations in a symbol
   * using maximum bipartite matching followed by Tarjan's strongly connected components algorithm.
   */
  public checkAlgebraicLoops(symbolId: SymbolId): {
    hasLoops: boolean;
    loopCount: number;
    loops: { size: number; vars: string[] }[];
  } {
    return checkAlgebraicLoopsForSymbol(this.getEquationHelperHost(), symbolId);
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
    this.checkCancelled();
    const key = this.memoKey(queryName, symbolId, argsHash);

    // Record this query invocation as a dependency of the parent query currently on the execution stack.
    if (this.activeTracker) {
      this.activeTracker.recordQuery(queryName, symbolId, argsHash, key, args);
    }

    const memo = this.memos.get(key);

    // Fast path: memo was already verified in the current global revision.
    if (memo && memo.verified_at === this.currentRevision) {
      if (this.memos.size >= this.maxMemos * 0.75) {
        this.memos.delete(key);
        this.memos.set(key, memo);
      }
      this.stats.fastHits++;
      return memo.value;
    }

    // O(1) Durability fast path: if no input of durability >= memo.durability changed since
    // memo.verified_at (e.g. a Low-durability user edit while this memo only depends on High-durability MSL),
    // skip deepVerify entirely!
    if (memo && memo.durability !== undefined && this.lastChangedAt[memo.durability] <= memo.verified_at) {
      memo.verified_at = this.currentRevision;
      if (this.memos.size >= this.maxMemos * 0.75) {
        this.memos.delete(key);
        this.memos.set(key, memo);
      }
      this.stats.durabilityHits++;
      return memo.value;
    }

    // Deep verification: recursively check if any input, byName, domain, or sub-query dependency changed.
    if (memo && this.deepVerify(memo, key)) {
      memo.verified_at = this.currentRevision;
      if (this.memos.size >= this.maxMemos * 0.75) {
        this.memos.delete(key);
        this.memos.set(key, memo);
      }
      this.stats.deepVerifyHits++;
      return memo.value;
    }

    // Re-execute the query hook when no valid memo exists or a transitive dependency changed.
    return this.execute(queryName, symbolId, argsHash, args);
  }

  /**
   * Salsa deep verification step: walks a cached `Memo`'s recorded dependencies to determine
   * whether the memo's value is still valid at `this.currentRevision` without re-running its body.
   *
   * - For symbol inputs (`memo.inputs`), scans the contiguous `Int32Array` in a tight loop.
   * - For `"byName"` and `"domain"` dependencies, compares their revision counters directly against `memo.verified_at`.
   * - For `"query"` dependencies, recursively calls `this.fetch()` (preserving `dep.args`) and checks whether `depMemo.changed_at > memo.verified_at`.
   */
  private deepVerify(memo: Memo, memoKey: number): boolean {
    // Guard against cyclic verification loops.
    if (this.activeVerifications.has(memoKey)) return false;
    this.activeVerifications.add(memoKey);
    // Suspend dependency tracking while verifying dependencies so verification reads don't pollute the caller's tracker.
    const prevTracker = this.activeTracker;
    this.activeTracker = null;
    try {
      const verifiedAt = memo.verified_at;

      // 0. Global structure check for queries that called `db.allEntries()`
      if (memo.readsAllEntries && this.globalStructureRevision > verifiedAt) {
        return false;
      }

      // 1. Zero-GC vectorized input check over dense Uint32Array revision slab
      if (memo.inputs && this.revisionStore.hasAnyInputChangedSince(memo.inputs, verifiedAt)) {
        return false;
      }

      // 2. Name table lookup check
      if (memo.byNames) {
        const byNames = memo.byNames;
        const len = byNames.length;
        for (let i = 0; i < len; i++) {
          const rev = this.byNameRevisions.get(byNames[i]!) ?? 0;
          if (rev > verifiedAt) return false;
        }
      }

      // 3. Polyglot domain check
      if (memo.domains) {
        const domains = memo.domains;
        const len = domains.length;
        for (let i = 0; i < len; i++) {
          const rev = this.domainRevisions.get(domains[i]!) ?? 0;
          if (rev > verifiedAt) return false;
        }
      }

      // 4. Derived sub-query check
      if (memo.queries) {
        const queries = memo.queries;
        const len = queries.length;
        for (let i = 0; i < len; i++) {
          const dep = queries[i]!;
          const depKey = dep.key ?? this.memoKey(dep.queryName, dep.symbolId, dep.argsHash);
          // Do not validate against a dependency currently mid-execution on the stack.
          for (let s = 0; s < this.executionStack.length; s++) {
            if (this.executionStack[s]!.key === depKey) return false;
          }
          try {
            this.fetch(dep.queryName, dep.symbolId, dep.argsHash, dep.args);
          } catch (e) {
            if (e instanceof QueryCancelledError) throw e;
            return false;
          }
          const depMemo = this.memos.get(depKey);
          if (!depMemo) return false;
          if (depMemo.changed_at > verifiedAt) return false;
        }
      }

      // 5. Fallback for legacy/compatibility memos
      if (memo.dependencies && memo.dependencies.length > 0 && !memo.inputs && !memo.queries) {
        for (const dep of memo.dependencies) {
          if (dep.kind === "input") {
            const rev = this.revisionStore.getRevision(dep.symbolId);
            if (rev > verifiedAt) return false;
          } else if (dep.kind === "byName") {
            const rev = this.byNameRevisions.get(dep.name) ?? 0;
            if (rev > verifiedAt) return false;
          } else if (dep.kind === "domain") {
            const rev = this.domainRevisions.get(dep.domain) ?? 0;
            if (rev > verifiedAt) return false;
          } else if (dep.kind === "query") {
            const depKey = this.memoKey(dep.queryName, dep.symbolId, dep.argsHash);
            for (let s = 0; s < this.executionStack.length; s++) {
              if (this.executionStack[s]!.key === depKey) return false;
            }
            try {
              this.fetch(dep.queryName, dep.symbolId, dep.argsHash);
            } catch (e) {
              if (e instanceof QueryCancelledError) throw e;
              return false;
            }
            const depMemo = this.memos.get(depKey);
            if (!depMemo) return false;
            if (depMemo.changed_at > verifiedAt) return false;
          }
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
    this.checkCancelled();
    const entry = this.resolveEntry(symbolId);
    if (!entry) return undefined;

    // Resolve the query hook implementation registered for the symbol's grammar rule,
    // falling back to a generic `@kind:<SymbolKind>` adapter for cross-language symbols on non-lint queries.
    const hooks =
      this.hooksByRule.get(entry.ruleName) ??
      (!queryName.startsWith("lint__") ? this.hooksByRule.get(`@kind:${entry.kind}`) : undefined);
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
        this.stats.cycles++;
        frame.isCycleHead = true;
        for (let j = i; j < this.executionStack.length; j++) {
          this.executionStack[j]!.inCycle = true;
        }
        const recoveryFn =
          typeof rawQuery === "object" && rawQuery !== null && typeof (rawQuery as any).recovery === "function"
            ? (rawQuery as any).recovery
            : undefined;
        if (recoveryFn) {
          const participants = [
            ...this.executionStack.slice(i).map((f) => ({ queryName: f.queryName, symbolId: f.symbolId })),
            { queryName, symbolId },
          ];
          // Suspend caller's dependency tracker while running recovery handler so recovery reads don't pollute it.
          const savedTracker = this.activeTracker;
          this.activeTracker = null;
          try {
            const cycleDb = Object.assign(Object.create(this.createTrackedDB()), { participants });
            return recoveryFn(cycleDb, entry, args);
          } finally {
            this.activeTracker = savedTracker;
          }
        }
        return undefined; // Graceful cycle fallback
      }
    }

    // Push execution frame and install a pooled DependencyTracker (zero per-call GC allocation).
    const execFrame = { key, queryName, symbolId, inCycle: false, isCycleHead: false };
    this.executionStack.push(execFrame);
    const prevTracker = this.activeTracker;
    const tracker = this.trackerPool.pop() ?? new DependencyTracker();
    tracker.reset();
    this.activeTracker = tracker;

    let result: unknown;
    let inputs: Int32Array | undefined;
    let queries: QueryDependencyRecord[] | undefined;
    let byNames: string[] | undefined;
    let domains: LanguageDomainId[] | undefined;
    let baseDurability: Durability = Durability.High;
    let readsAllEntries = false;
    try {
      const db = this.createTrackedDB();
      result = queryFn(db, entry, args);

      this.stats.recomputes++;

      // Deterministic cycle handling: do not memoize cycle-participating frames, because their
      // values depend on which participant broke the cycle. Non-cyclic callers outside the cycle
      // are still memoized normally, and querying any cycle participant in any order is deterministic.
      if (execFrame.inCycle) {
        return result;
      }

      // If a leaf query read `entry` (`self`) directly without invoking any tracked `db.*` methods,
      // record `symbolId` as its input dependency so edits to `symbolId` still invalidate it
      // without breaking early cut-off (backdating) for derived queries on the same symbol.
      if (!tracker.hasInputs() && !tracker.queries && !tracker.byNames && !tracker.domains) {
        tracker.recordInput(symbolId);
      }

      inputs = tracker.finishInputs();
      queries = tracker.queries;
      byNames = tracker.byNames;
      domains = tracker.domains;
      baseDurability = tracker.durability;
      readsAllEntries = tracker.readsAllEntries;
    } finally {
      this.activeTracker = prevTracker;
      this.executionStack.pop();
      tracker.reset();
      if (this.trackerPool.length < 64) {
        this.trackerPool.push(tracker);
      }
    }

    // Backdating: if the newly computed result is shallow-equal to the previous memoized value,
    // preserve `oldMemo.changed_at` so downstream dependent queries can short-circuit during `deepVerify`.
    const oldMemo = this.memos.get(key);
    let changedAt = this.currentRevision;
    if (oldMemo && shallowEqual(oldMemo.value, result)) {
      changedAt = oldMemo.changed_at;
      this.stats.backdateHits++;
    }

    // Compute transitive minimum durability across all recorded inputs, domains, and sub-queries.
    let durability: Durability = baseDurability;
    if (durability > Durability.Low && inputs) {
      for (let i = 0; i < inputs.length; i++) {
        const d = this.getInputDurability(inputs[i]!);
        if (d < durability) {
          durability = d;
          if (durability === Durability.Low) break;
        }
      }
    }
    if (durability > Durability.Low && domains) {
      for (const dom of domains) {
        const d = this.domainDurabilities.get(dom) ?? Durability.Low;
        if (d < durability) {
          durability = d;
          if (durability === Durability.Low) break;
        }
      }
    }
    if (durability > Durability.Low && queries) {
      for (const q of queries) {
        const depKey = q.key ?? this.memoKey(q.queryName, q.symbolId, q.argsHash);
        const depDur = this.memos.get(depKey)?.durability ?? Durability.Low;
        if (depDur < durability) {
          durability = depDur;
          if (durability === Durability.Low) break;
        }
      }
    }

    const memo: Memo = {
      value: result,
      verified_at: this.currentRevision,
      changed_at: changedAt,
      durability,
      readsAllEntries: readsAllEntries || undefined,
      queryName,
      symbolId,
      argsHash,
      inputs,
      queries,
      byNames,
      domains,
    };

    // Enforce bounded memo table capacity via durability-aware LRU eviction before storing the new memo,
    // cleaning up reverse-dependency maps for replaced or evicted memos so they never leak.
    const prevMemo = this.memos.get(key);
    if (prevMemo) {
      this.unlinkMemoReverseDeps(key, prevMemo);
    }
    if (!prevMemo && this.memos.size >= this.maxMemos) {
      this.evictOneMemo();
    }
    this.memos.set(key, memo);

    // Populate reverse dependency tables so future `invalidate()` calls can locate this memo key.
    this.linkMemoReverseDeps(key, memo);

    return result;
  }

  /** Shared helper to create or retrieve a specialized virtual symbol entry and maintain reverse indices. */
  private specializeSymbol<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId {
    const cacheKey = `${baseId}:${args.hash}`;
    const existing = this.specializeCache.get(cacheKey);
    if (existing !== undefined) return existing;

    const base = this.resolveEntry(baseId);
    if (!base) throw new Error(`Cannot specialize unknown symbol ${baseId}`);

    const virtualId = this.nextVirtualId--;
    const virtualEntry: SymbolEntry = {
      ...base,
      id: virtualId,
      startOffset: base.startOffset,
      endOffset: base.endOffset,
      metadata: { ...base.metadata },
    };

    this.virtualEntries.set(virtualId, virtualEntry);
    if (virtualEntry.parentId !== null) {
      let list = this.virtualChildrenOf.get(virtualEntry.parentId);
      if (!list) {
        list = [];
        this.virtualChildrenOf.set(virtualEntry.parentId, list);
      }
      list.push(virtualEntry);
    }
    let byBase = this.virtualsByBase.get(baseId);
    if (!byBase) {
      byBase = new Set();
      this.virtualsByBase.set(baseId, byBase);
    }
    byBase.add(virtualId);

    this.specializationArgs.set(virtualId, args as SpecializationArgs);
    this.specializationBases.set(virtualId, baseId);
    this.specializeCache.set(cacheKey, virtualId);
    this.revisionStore.setRevision(virtualId, this.currentRevision);

    return virtualId;
  }

  // -- Tracked QueryDB for Salsa --

  /** Cached singleton tracked `QueryDB` facade reading `this.activeTracker` dynamically (zero per-call closure allocation). */
  private _trackedDBCache: QueryDB | null = null;

  /**
   * Returns a cached dependency-tracking `QueryDB` facade bound dynamically to `this.activeTracker`
   * during `execute()`.
   *
   * Every symbol lookup (`symbol`, `childrenOf`, `parentOf`, `cstNode`, `cstText`),
   * name resolution (`byName`, `resolvePolyglotSymbol`), domain revision check, and
   * nested `query`/`queryWith` call automatically logs its dependency edge into `this.activeTracker`.
   */
  private createTrackedDB(): QueryDB {
    if (this._trackedDBCache) return this._trackedDBCache;
    /* eslint-disable-next-line @typescript-eslint/no-this-alias */
    const engine = this;

    const db: QueryDB = {
      ensureFQNIndexed(fqn: string): void {
        engine.ensureFQNIndexed(fqn);
      },

      getRevision(): Revision {
        return engine.currentRevision;
      },

      symbol(id: SymbolId): SymbolEntry | undefined {
        const t = engine.activeTracker;
        if (t) t.recordInput(id);
        return engine.resolveEntry(id);
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        const t = engine.activeTracker;
        if (t) t.recordInput(id);
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        if (t && lookupId !== id) t.recordInput(lookupId);
        if (lookupId === null || lookupId === undefined || lookupId === 0) {
          const seen = new Set<SymbolId>();
          for (const rootKey of [0, null] as (SymbolId | null)[]) {
            const childIds = engine.index.childrenOf.get(rootKey as SymbolId);
            if (childIds) {
              for (const cid of childIds) {
                if (!seen.has(cid)) {
                  seen.add(cid);
                  const entry = engine.resolveEntry(cid);
                  if (entry) {
                    if (t) t.recordInput(cid);
                    results.push(entry);
                  }
                }
              }
            }
          }
        } else {
          const childIds = engine.index.childrenOf.get(lookupId);
          if (childIds) {
            for (const cid of childIds) {
              const entry = engine.resolveEntry(cid);
              if (entry) {
                if (t) t.recordInput(cid);
                results.push(entry);
              }
            }
          }
        }
        const vChildren = engine.virtualChildrenOf.get(id);
        if (vChildren) {
          for (const vEntry of vChildren) {
            if (t) t.recordInput(vEntry.id);
            results.push(vEntry);
          }
        }
        return results;
      },

      childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[] {
        const t = engine.activeTracker;
        if (t) t.recordInput(id);
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        if (t && lookupId !== id) t.recordInput(lookupId);
        if (lookupId === null || lookupId === undefined || lookupId === 0) {
          const seen = new Set<SymbolId>();
          for (const rootKey of [0, null] as (SymbolId | null)[]) {
            const childIds = engine.index.childrenOf.get(rootKey as SymbolId);
            if (childIds) {
              for (const cid of childIds) {
                if (!seen.has(cid)) {
                  seen.add(cid);
                  const entry = engine.resolveEntry(cid);
                  if (entry && entry.fieldName === fieldName) {
                    if (t) t.recordInput(cid);
                    results.push(entry);
                  }
                }
              }
            }
          }
        } else {
          const childIds = engine.index.childrenOf.get(lookupId);
          if (childIds) {
            for (const cid of childIds) {
              const entry = engine.resolveEntry(cid);
              if (entry && entry.fieldName === fieldName) {
                if (t) t.recordInput(cid);
                results.push(entry);
              }
            }
          }
        }
        const vChildren = engine.virtualChildrenOf.get(id);
        if (vChildren) {
          for (const vEntry of vChildren) {
            if (vEntry.fieldName === fieldName) {
              if (t) t.recordInput(vEntry.id);
              results.push(vEntry);
            }
          }
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
        const t = engine.activeTracker;
        if (t) t.recordByName(name);
        const ids = engine.index.byName.get(name);
        if (!ids) return [];
        return ids
          .map((id: SymbolId) => {
            if (t) t.recordInput(id);
            return engine.resolveEntry(id);
          })
          .filter(Boolean) as SymbolEntry[];
      },

      allEntries(): SymbolEntry[] {
        const t = engine.activeTracker;
        const entries = Array.from(engine.allEntries());
        if (t) {
          t.recordAllEntries();
          for (const e of entries) t.recordInput(e.id);
        }
        return entries;
      },

      resolvePolyglotSymbol(fqn: string, targetDomain?: LanguageDomainId): SymbolId | null {
        const t = engine.activeTracker;
        if (t) {
          t.recordByName(fqn);
          const segments = fqn
            .trim()
            .split(/::|\.|\/\//)
            .filter((s) => s.length > 0);
          if (segments.length > 0) {
            t.recordByName(segments[segments.length - 1]!);
          }
        }
        return engine.resolvePolyglotSymbol(fqn, targetDomain);
      },

      crossDomainBinding(symbolId: SymbolId): SymbolId[] {
        const t = engine.activeTracker;
        if (t) {
          t.recordInput(symbolId);
          t.recordByName("__tgg_correspondence__");
          const entry = engine.resolveEntry(symbolId);
          if (entry?.name) t.recordByName(entry.name);
        }
        const results = engine.crossDomainBinding(symbolId);
        if (t) {
          for (const rid of results) {
            t.recordInput(rid);
          }
        }
        return results;
      },

      physicalQuantityParity(modelicaVarId: SymbolId, sysmlAttrId: SymbolId): ParityReport {
        const t = engine.activeTracker;
        if (t) {
          t.recordInput(modelicaVarId);
          t.recordInput(sysmlAttrId);
        }
        return engine.physicalQuantityParity(modelicaVarId, sysmlAttrId);
      },

      geometricShapeBinding(cadSymbolId: SymbolId, feaMeshId: SymbolId): ShapeBinding {
        const t = engine.activeTracker;
        if (t) {
          t.recordInput(cadSymbolId);
          t.recordInput(feaMeshId);
        }
        return engine.geometricShapeBinding(cadSymbolId, feaMeshId);
      },

      getDomainRevision(domain: LanguageDomainId): Revision {
        const t = engine.activeTracker;
        if (t) t.recordDomain(domain);
        return engine.getDomainRevision(domain);
      },

      hasDomainChanged(domain: LanguageDomainId, sinceRevision: Revision): boolean {
        const t = engine.activeTracker;
        if (t) t.recordDomain(domain);
        return engine.hasDomainChanged(domain, sinceRevision);
      },

      queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>, hashOverride?: string): T {
        const argsHash = stableStringifyArgs(args, hashOverride);
        return engine.fetch(queryName, id, argsHash, args) as T;
      },

      specialize<T = unknown>(baseId: SymbolId, args: SpecializationArgs<T>): SymbolId {
        const t = engine.activeTracker;
        if (t) t.recordInput(baseId);
        return engine.specializeSymbol(baseId, args);
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
        const t = engine.activeTracker;
        if (t && scopeId) t.recordInput(scopeId);
        const scope = scopeId ? (engine.resolveEntry(scopeId) ?? null) : null;
        return engine.evaluator(expression, scope, this);
      },

      cstText(startOffset: number, endOffset: number, entry?: SymbolEntry): string | null {
        const t = engine.activeTracker;
        if (t && entry) t.recordInput(entry.id);
        return engine.getCstText(startOffset, endOffset, entry);
      },

      cstNode(id: SymbolId): unknown | null {
        const t = engine.activeTracker;
        if (t) t.recordInput(id);
        return engine.getCstNode(id);
      },

      cstNodeRange(startOffset: number, endOffset: number, entry?: SymbolEntry): unknown | null {
        const t = engine.activeTracker;
        if (t && entry) t.recordInput(entry.id);
        return engine.getCstNodeRange(startOffset, endOffset, entry);
      },

      flushVolatile(): void {
        engine.flushVolatile();
      },

      clearMemos(): void {
        engine.clearMemos();
      },

      taxonomy: engine.taxonomy,
    };

    this._trackedDBCache = db;
    return db;
  }

  /**
   * Ensures that all lazy-loaded workspace files along the package hierarchy of `fqn`
   * have been parsed and merged into `this.index`, invalidating any stale Salsa memos
   * for newly populated package scopes.
   */
  public ensureFQNIndexed(fqn: string): void {
    const ws =
      (this.index as any)?.workspace ??
      (this.index as any)?.workspaceIndex ??
      (this.index as any)?.globalWorkspaceIndex;
    if (ws && typeof ws.ensureFQNIndexed === "function") {
      ws.ensureFQNIndexed(fqn);
      const lazyChanges =
        typeof ws.takeLazyChangedIds === "function"
          ? (ws.takeLazyChangedIds() as { changedIds: Set<SymbolId>; structuralChangedIds: Set<SymbolId> })
          : null;
      const hadChanges = lazyChanges ? lazyChanges.changedIds.size > 0 : true;
      if (hadChanges && typeof ws.getIndex === "function" && this.index) {
        const newIdx = ws.getIndex();
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
      if (lazyChanges && lazyChanges.changedIds.size > 0) {
        this.invalidate(lazyChanges.changedIds, lazyChanges.structuralChangedIds);
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

    const entryMatchesDomain = (entry: SymbolEntry, expected: LanguageDomainId | undefined): boolean => {
      if (expected === undefined) return true;
      const bitDomain = getSymbolDomain(entry.id);
      if (bitDomain !== 0) return bitDomain === expected;
      if (entry.language) return getLanguageDomainId(entry.language) === expected;
      return false;
    };

    // Fast path: check exact name via `byName` before falling back to a full scan.
    const exactCandidates = this.index.byName.get(pathStr);
    if (exactCandidates) {
      for (const cid of exactCandidates) {
        const entry = this.resolveEntry(cid);
        if (entry && entryMatchesDomain(entry, searchDomain)) {
          return entry.id;
        }
      }
    }

    // Split path by :: or .
    const segments = pathStr.split(/::|\./).filter((s) => s.length > 0);
    if (segments.length === 0) return null;

    // Look for root candidates matching segments[0] and walk children
    const rootCandidates = this.index.byName.get(segments[0]!) || [];
    for (const candId of rootCandidates) {
      const cand = this.resolveEntry(candId);
      if (!cand) continue;
      if (!entryMatchesDomain(cand, searchDomain)) {
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

    // Check leaf candidates for exact qualifiedName / fqn metadata match before full scan
    const leafName = segments[segments.length - 1]!;
    const leafCandidates = this.index.byName.get(leafName) || [];
    for (const lid of leafCandidates) {
      const entry = this.resolveEntry(lid);
      if (!entry || !entryMatchesDomain(entry, searchDomain)) continue;
      if (entry.metadata?.["qualifiedName"] === pathStr || entry.metadata?.["fqn"] === pathStr) {
        return entry.id;
      }
    }

    // Fallback scan for entries whose qualifiedName/fqn metadata does not match their leaf name
    for (const entry of this.allEntries()) {
      if (!entryMatchesDomain(entry, searchDomain)) {
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

    // Final fallback: match by leaf name if targetDomain matches
    for (const lid of leafCandidates) {
      const entry = this.resolveEntry(lid);
      if (!entry) continue;
      if (!entryMatchesDomain(entry, searchDomain)) {
        continue;
      }
      return entry.id;
    }

    return null;
  }

  /**
   * Returns all cross-domain counterpart `SymbolId`s bound to `symbolId` via the TGG
   * correspondence slot table / `DigitalThreadHypergraph`, explicit metadata links (`twin`,
   * `counterpart`, `implements`, `cadBinding`), or (when no correspondence indexer is attached)
   * top-level name matching across other language domains.
   */
  public crossDomainBinding(symbolId: SymbolId): SymbolId[] {
    const entry = this.resolveEntry(symbolId);
    if (!entry) return [];

    const domain = getSymbolDomain(symbolId) || (entry.language ? getLanguageDomainId(entry.language) : 0);
    const entryLang = entry.language?.toLowerCase() ?? "";
    const results = new Set<SymbolId>();

    // 1. Check TGG correspondence slot map & attached DigitalThreadHypergraph if configured
    if (this.correspondenceSlotMap && this.correspondenceSlotMap.has(symbolId)) {
      const slot = this.correspondenceSlotMap.get(symbolId)!;
      const peers = this.correspondenceSlotToSymbols?.get(slot);
      if (peers) {
        for (const otherId of peers) {
          if (otherId !== symbolId) results.add(otherId);
        }
      } else {
        for (const [otherId, otherSlot] of this.correspondenceSlotMap.entries()) {
          if (otherSlot === slot && otherId !== symbolId) {
            results.add(otherId);
          }
        }
      }
      if (this.correspondenceIndex && typeof this.correspondenceIndex.getRecord === "function") {
        const rec = this.correspondenceIndex.getRecord(slot);
        if (rec && !rec.isRemoved && rec.domainNodes) {
          for (const nodeId of Object.values(rec.domainNodes) as number[]) {
            if (typeof nodeId === "number" && nodeId !== symbolId && this.resolveEntry(nodeId)) {
              results.add(nodeId);
            }
          }
        }
      }
    }

    if (
      this.correspondenceIndex &&
      typeof this.correspondenceIndex.resolveOrRegisterDomain === "function" &&
      (typeof this.correspondenceIndex.findSlotsByDomainNode === "function" ||
        typeof this.correspondenceIndex.findThreadsByDomainNode === "function") &&
      entryLang
    ) {
      const normalizedLang = entryLang === "sysml" ? "sysml2" : entryLang;
      const hgDom = this.correspondenceIndex.resolveOrRegisterDomain(normalizedLang);
      const slots: number[] =
        typeof this.correspondenceIndex.findSlotsByDomainNode === "function"
          ? (this.correspondenceIndex.findSlotsByDomainNode(hgDom, symbolId) ?? [])
          : (this.correspondenceIndex.findThreadsByDomainNode(hgDom, symbolId) ?? []);
      for (const slot of slots) {
        const rec = this.correspondenceIndex.getRecord?.(slot);
        if (rec && !rec.isRemoved && rec.domainNodes) {
          for (const nodeId of Object.values(rec.domainNodes) as number[]) {
            if (typeof nodeId === "number" && nodeId !== symbolId && this.resolveEntry(nodeId)) {
              results.add(nodeId);
            }
          }
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

    // 3. Legacy fallback ONLY when no correspondence indexer is attached: match top-level containers across domains
    if (!this.correspondenceSlotMap && entry.name && entry.parentId === null) {
      const nameMatches = this.index.byName.get(entry.name) || [];
      for (const otherId of nameMatches) {
        if (otherId === symbolId) continue;
        const otherEntry = this.resolveEntry(otherId);
        if (!otherEntry || otherEntry.parentId !== null) continue;
        const otherDomain =
          getSymbolDomain(otherId) || (otherEntry.language ? getLanguageDomainId(otherEntry.language) : 0);
        const isDifferentLang =
          entryLang && otherEntry.language ? entryLang !== otherEntry.language.toLowerCase() : otherDomain !== domain;
        if (isDifferentLang) {
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
    return computePhysicalQuantityParity(this.resolveEntry(modelicaVarId), this.resolveEntry(sysmlAttrId));
  }

  /**
   * Computes the geometric shape and mesh binding summary between a CAD solid symbol
   * and an FEA mesh symbol (`surfaceArea`, `volume`, `meshElementCount`).
   */
  public geometricShapeBinding(cadSymbolId: SymbolId, feaMeshId: SymbolId): ShapeBinding {
    return computeGeometricShapeBinding(
      cadSymbolId,
      feaMeshId,
      this.resolveEntry(cadSymbolId),
      this.resolveEntry(feaMeshId),
    );
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

      getRevision(): Revision {
        return engine.currentRevision;
      },

      symbol(id: SymbolId): SymbolEntry | undefined {
        return engine.resolveEntry(id);
      },

      childrenOf(id: SymbolId): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        if (lookupId === null || lookupId === undefined || lookupId === 0) {
          const seen = new Set<SymbolId>();
          for (const rootKey of [0, null] as (SymbolId | null)[]) {
            const childIds = engine.index.childrenOf.get(rootKey as SymbolId);
            if (childIds) {
              for (const cid of childIds) {
                if (!seen.has(cid)) {
                  seen.add(cid);
                  const entry = engine.resolveEntry(cid);
                  if (entry) results.push(entry);
                }
              }
            }
          }
        } else {
          const childIds = engine.index.childrenOf.get(lookupId);
          if (childIds) {
            for (const cid of childIds) {
              const entry = engine.resolveEntry(cid);
              if (entry) results.push(entry);
            }
          }
        }
        const vChildren = engine.virtualChildrenOf.get(id);
        if (vChildren) {
          for (const vEntry of vChildren) {
            results.push(vEntry);
          }
        }
        return results;
      },

      childrenOfField(id: SymbolId, fieldName: string): SymbolEntry[] {
        const results: SymbolEntry[] = [];
        const lookupId = engine.specializationBases.get(id) ?? id;
        if (lookupId === null || lookupId === undefined || lookupId === 0) {
          const seen = new Set<SymbolId>();
          for (const rootKey of [0, null] as (SymbolId | null)[]) {
            const childIds = engine.index.childrenOf.get(rootKey as SymbolId);
            if (childIds) {
              for (const cid of childIds) {
                if (!seen.has(cid)) {
                  seen.add(cid);
                  const entry = engine.resolveEntry(cid);
                  if (entry && entry.fieldName === fieldName) results.push(entry);
                }
              }
            }
          }
        } else {
          const childIds = engine.index.childrenOf.get(lookupId);
          if (childIds) {
            for (const cid of childIds) {
              const entry = engine.resolveEntry(cid);
              if (entry && entry.fieldName === fieldName) results.push(entry);
            }
          }
        }
        const vChildren = engine.virtualChildrenOf.get(id);
        if (vChildren) {
          for (const vEntry of vChildren) {
            if (vEntry.fieldName === fieldName) results.push(vEntry);
          }
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
        return engine.specializeSymbol(baseId, args);
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

      cstText(startOffset: number, endOffset: number, entry?: SymbolEntry): string | null {
        return engine.getCstText(startOffset, endOffset, entry);
      },

      cstNode(id: SymbolId): unknown | null {
        return engine.getCstNode(id);
      },

      cstNodeRange(startOffset: number, endOffset: number, entry?: SymbolEntry): unknown | null {
        return engine.getCstNodeRange(startOffset, endOffset, entry);
      },

      verification3DOverlay<T = unknown>(symbolId: SymbolId): T {
        return engine.verification3DOverlay<T>(symbolId);
      },

      flushVolatile(): void {
        engine.flushVolatile();
      },

      clearMemos(): void {
        engine.clearMemos();
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
