// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WebAssembly-Native Salsa Query Engine & QueryDB Bridge.
 *
 * Provides the canonical incremental dependency graph and semantic query
 * execution engine, backed by the zero-GC WebAssembly runtime (`src/codegen/runtime/graph.ts`)
 * and `WasmWorkspaceIndex`.
 */

import type {
  CSTTree,
  DependencyKey,
  ExpressionEvaluator,
  Memo,
  QueryCacheStore,
  QueryDB,
  QueryFn,
  QueryHooks,
  Revision,
  SpecializationArgs,
  SymbolEntry,
  SymbolId,
  SymbolIndex,
} from "./runtime.js";

// -- Public Types --

export interface LintResult {
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  startByte?: number;
  endByte?: number;
  field?: string;
}

export class QueryCancelledError extends Error {
  constructor(message = "Query computation was cancelled") {
    super(message);
    this.name = "QueryCancelledError";
  }
}

export interface LintDiagnostic {
  symbolId: SymbolId;
  startByte: number;
  endByte: number;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  lintName: string;
}

// -- Dependency Tracker --

class DependencyTracker {
  readonly dependencies: DependencyKey[] = [];
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

// -- Canonical QueryEngine Implementation --

export class WasmQueryEngine {
  public currentRevision: Revision = 0;
  private memos = new Map<number, Memo>();
  public instanceId = Math.random();

  private static nextQueryId = 1;
  private static queryIds = new Map<string, number>();

  private getQueryId(queryName: string): number {
    let id = WasmQueryEngine.queryIds.get(queryName);
    if (id === undefined) {
      id = WasmQueryEngine.nextQueryId++;
      WasmQueryEngine.queryIds.set(queryName, id);
    }
    return id;
  }

  private static nextArgsId = 1;
  private static argsIds = new Map<string, number>();

  private getArgsId(argsHash?: string): number {
    if (!argsHash) return 0;
    let id = WasmQueryEngine.argsIds.get(argsHash);
    if (id === undefined) {
      id = WasmQueryEngine.nextArgsId++;
      WasmQueryEngine.argsIds.set(argsHash, id);
    }
    return id;
  }

  private cacheStore?: QueryCacheStore | undefined;
  private maxMemos: number;

  private inputReverseDependencies = new Map<SymbolId, Set<number>>();
  private byNameReverseDependencies = new Map<string, Set<number>>();

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

  public markVolatile(queryName: string): void {
    this.volatileQueryNames.add(queryName);
  }

  public flushVolatile(): void {
    const volatileIds = new Set<number>();
    for (const name of this.volatileQueryNames) {
      const id = WasmQueryEngine.queryIds.get(name);
      if (id !== undefined) volatileIds.add(id);
    }
    if (volatileIds.size === 0) return;

    for (const key of this.memos.keys()) {
      const queryId = Math.floor(key / 10000000) % 1000;
      if (volatileIds.has(queryId)) {
        this.memos.delete(key);
      }
    }
  }

  private inputRevisions = new Map<SymbolId, Revision>();

  private lintCache = new Map<string, Map<SymbolId, LintDiagnostic[]>>();
  private dirtyLintSymbols = new Map<string, Set<SymbolId>>();
  private lintCacheRevision = new Map<string, Revision>();

  private activeTracker: DependencyTracker | null = null;
  private executionStack: { key: number; queryName: string; symbolId: SymbolId }[] = [];
  private hooksByRule: Map<string, QueryHooks>;

  // Virtual entry infrastructure (specialization)
  private virtualEntries = new Map<SymbolId, SymbolEntry>();
  private specializationArgs = new Map<SymbolId, SpecializationArgs>();
  private specializationBases = new Map<SymbolId, SymbolId>();
  private specializeCache = new Map<string, SymbolId>();
  private nextVirtualId: SymbolId = -1;

  private evaluator: ExpressionEvaluator | null;
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
    this.maxMemos = options?.maxMemos ?? 2_000_000;

    for (const id of this.index.symbols.keys()) {
      this.inputRevisions.set(id, 0);
    }
  }

  getTree(): CSTTree | null {
    return this.tree;
  }

  setTree(tree: CSTTree | null): void {
    this.tree = tree;
  }

  getRevision(): Revision {
    return this.currentRevision;
  }

  getMemoCount(): number {
    return this.memos.size;
  }

  public dumpMemos(): Map<number, Memo> {
    return new Map(this.memos);
  }

  public memoKey(queryName: string, symbolId: SymbolId, argsHash?: string): number {
    const qId = this.getQueryId(queryName);
    const aId = this.getArgsId(argsHash);
    const absSymbolId = Math.abs(symbolId);
    const signBit = symbolId < 0 ? 1 : 0;
    return (absSymbolId % 10000000) * 100000000 + (qId % 1000) * 100000 + (aId % 10000) * 10 + signBit;
  }

  private symbolIdFromKey(key: number): SymbolId {
    const absSymbolId = Math.floor(key / 100000000);
    const signBit = key % 10;
    return signBit === 1 ? -absSymbolId : absSymbolId;
  }

  public resolveEntry(id: SymbolId): SymbolEntry | undefined {
    if (id < 0) {
      return this.virtualEntries.get(id);
    }
    return this.index.symbols.get(id);
  }

  public *allEntries(): IterableIterator<SymbolEntry> {
    for (const entry of this.index.symbols.values()) {
      yield entry;
    }
    for (const entry of this.virtualEntries.values()) {
      yield entry;
    }
  }

  public getCstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
    if (this.tree && typeof (this.tree as any).getText === "function") {
      const text = (this.tree as any).getText(startByte, endByte, entry);
      if (text !== null && text !== undefined) return text;
    }
    if (entry?.resourceId && (this.index as any).documents) {
      const doc = (this.index as any).documents.get(entry.resourceId);
      if (doc && typeof doc.getText === "function") {
        return doc.getText().substring(startByte, endByte);
      }
    }
    if (this.tree && (this.tree as any).rootNode) {
      const root = (this.tree as any).rootNode;
      const text = root.text ?? root.tree?.text;
      if (typeof text === "string" && startByte >= 0 && endByte <= text.length) {
        return text.substring(startByte, endByte);
      }
    }
    return null;
  }

  public getCstNode(id: SymbolId): unknown | null {
    const entry = this.resolveEntry(id);
    if (!entry) return null;
    return this.getCstNodeRange(entry.startByte, entry.endByte, entry);
  }

  public getCstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
    let treeToUse = this.tree;
    if (entry?.resourceId && (this.index as any).documents) {
      const doc = (this.index as any).documents.get(entry.resourceId);
      if (doc && doc.tree) {
        treeToUse = doc.tree;
      }
    }
    if (treeToUse && typeof (treeToUse as any).getNode === "function") {
      const node = (treeToUse as any).getNode(startByte, endByte, entry);
      if (node) return node;
    }
    if (treeToUse && (treeToUse as any).rootNode) {
      const root = (treeToUse as any).rootNode;
      if (typeof root.descendantForIndex === "function") {
        return root.descendantForIndex(startByte, endByte);
      }
      if (typeof root.descendantForByteRange === "function") {
        return root.descendantForByteRange(startByte, endByte);
      }
      const findNode = (n: any): any | null => {
        const s = n.startIndex ?? n.startByte ?? -1;
        const e = n.endIndex ?? n.endByte ?? -1;
        if (s === startByte && e === endByte) return n;
        for (const c of n.children || []) {
          if (c.startIndex <= startByte && c.endIndex >= endByte) {
            const found = findNode(c);
            if (found) return found;
          }
        }
        return s <= startByte && e >= endByte ? n : null;
      };
      return findNode(root);
    }
    return null;
  }

  public cstText(startByte: number, endByte: number, entry?: SymbolEntry): string | null {
    return this.getCstText(startByte, endByte, entry);
  }

  public cstNode(id: SymbolId): unknown | null {
    return this.getCstNode(id);
  }

  public cstNodeRange(startByte: number, endByte: number, entry?: SymbolEntry): unknown | null {
    return this.getCstNodeRange(startByte, endByte, entry);
  }

  public query<T = unknown>(queryName: string, id: SymbolId): T {
    return this.fetch(queryName, id) as T;
  }

  public queryWith<T = unknown>(queryName: string, id: SymbolId, args: Record<string, unknown>): T {
    const argsHash = JSON.stringify(args, Object.keys(args).sort());
    return this.fetch(queryName, id, argsHash, args) as T;
  }

  public updateTree(tree: CSTTree | null): void {
    this.tree = tree;
  }

  public updateIndex(newIndex: SymbolIndex, _resourceId?: string): void {
    const changedIds = new Set<SymbolId>();
    for (const [id, entry] of newIndex.symbols) {
      const old = this.index.symbols.get(id);
      if (!old || old.startByte !== entry.startByte || old.endByte !== entry.endByte) {
        changedIds.add(id);
      }
    }
    this.index = newIndex;
    this.invalidate(changedIds);
  }

  public async preflight(symbolIds: SymbolId[], queryNames?: string[]): Promise<void> {
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

  public invalidate(changedSymbolIds: Set<SymbolId> | SymbolId[], structuralChangedIds?: Set<SymbolId>): void {
    this.currentRevision++;
    const ids = changedSymbolIds instanceof Set ? changedSymbolIds : new Set(changedSymbolIds);

    for (const id of ids) {
      this.inputRevisions.set(id, this.currentRevision);
      const dependentKeys = this.inputReverseDependencies.get(id);
      if (dependentKeys) {
        for (const key of dependentKeys) {
          const memo = this.memos.get(key);
          if (memo) {
            memo.verified_at = -1;
          }
        }
      }
    }

    if (structuralChangedIds) {
      for (const id of structuralChangedIds) {
        const dependentKeys = this.inputReverseDependencies.get(id);
        if (dependentKeys) {
          for (const key of dependentKeys) {
            this.memos.delete(key);
          }
        }
      }
    }

    for (const cacheDirtySet of this.dirtyLintSymbols.values()) {
      for (const id of ids) {
        cacheDirtySet.add(id);
      }
    }
  }

  public swapIndex(newIndex: SymbolIndex, changedSymbolIds: Set<SymbolId>, structuralChangedIds?: Set<SymbolId>): void {
    this.index = newIndex;
    if (structuralChangedIds) {
      this.invalidate(structuralChangedIds, changedSymbolIds);
    } else {
      this.invalidate(changedSymbolIds);
    }
  }

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
      } catch (e) {
        console.warn(`[lint] ${lintName} failed for ${entry.name}: ${e}`);
      }
    }
    return results;
  }

  static readonly LINT_PREFIX = "lint__";

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
        let startByte = result.startByte ?? entry.startByte;
        let endByte = result.endByte ?? entry.endByte;
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

  public async runAllLintsAsync(
    resourceId?: string,
    yieldFn?: () => Promise<boolean>,
    viewportRange?: { startByte: number; endByte: number },
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
        continue;
      }
      if (resourceId && entry.resourceId !== resourceId) continue;
      symbolsToRelint.push([id, entry]);
      relintIds.add(id);
    }

    if (viewportRange && symbolsToRelint.length > 1) {
      const { startByte: vpStart, endByte: vpEnd } = viewportRange;
      const inViewport: [SymbolId, SymbolEntry][] = [];
      const outViewport: [SymbolId, SymbolEntry][] = [];
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

    for (const [id, entry] of symbolsToRelint) {
      if (yieldFn && (await yieldFn())) {
        throw new QueryCancelledError();
      }
      const diags: LintDiagnostic[] = [];
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
        diags.push({
          symbolId: id,
          startByte,
          endByte,
          message: result.message,
          severity: result.severity,
          lintName,
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

  // -- Salsa 3.0 Query Execution --

  private fetch(queryName: string, symbolId: SymbolId, argsHash?: string, args?: Record<string, unknown>): unknown {
    const key = this.memoKey(queryName, symbolId, argsHash);

    if (this.activeTracker) {
      this.activeTracker.recordQuery(queryName, symbolId, argsHash);
    }

    const memo = this.memos.get(key);

    if (memo && memo.verified_at === this.currentRevision) {
      return memo.value;
    }

    if (memo && memo.verified_at !== -1) {
      memo.verified_at = this.currentRevision;
      return memo.value;
    }

    if (memo && this.deepVerify(memo)) {
      memo.verified_at = this.currentRevision;
      return memo.value;
    }

    return this.execute(queryName, symbolId, argsHash, args);
  }

  private deepVerify(memo: Memo): boolean {
    for (const dep of memo.dependencies) {
      if (dep.kind === "input") {
        const rev = this.inputRevisions.get(dep.symbolId) ?? 0;
        if (rev > memo.verified_at) return false;
      } else if (dep.kind === "query") {
        const depKey = this.memoKey(dep.queryName, dep.symbolId, dep.argsHash);
        const depMemo = this.memos.get(depKey);
        if (!depMemo) return false;
        if (depMemo.changed_at > memo.verified_at) return false;
      }
    }
    return true;
  }

  private execute(queryName: string, symbolId: SymbolId, argsHash?: string, args?: Record<string, unknown>): unknown {
    const entry = this.resolveEntry(symbolId);
    if (!entry) return undefined;

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

    // Cycle detection
    for (const frame of this.executionStack) {
      if (frame.key === key) {
        return undefined; // Graceful cycle fallback
      }
    }

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

    if (this.memos.size >= this.maxMemos) {
      const firstKey = this.memos.keys().next().value;
      if (firstKey !== undefined) this.memos.delete(firstKey);
    }
    this.memos.set(key, memo);

    for (const dep of tracker.dependencies) {
      if (dep.kind === "input") {
        let set = this.inputReverseDependencies.get(dep.symbolId);
        if (!set) {
          set = new Set();
          this.inputReverseDependencies.set(dep.symbolId, set);
        }
        set.add(key);
      }
    }

    return result;
  }

  // -- Tracked QueryDB for Salsa --

  private createTrackedDB(): QueryDB {
    /* eslint-disable-next-line @typescript-eslint/no-this-alias */
    const engine = this;
    const tracker = this.activeTracker;

    return {
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
    };
  }

  // -- Standalone QueryDB Facade --

  private _queryDBCache: QueryDB | null = null;

  public toQueryDB(): QueryDB {
    if (this._queryDBCache) return this._queryDBCache;
    /* eslint-disable-next-line @typescript-eslint/no-this-alias */
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
    };
    this._queryDBCache = db;
    return db;
  }
}

// -- Drop-in Alias --
export const QueryEngine = WasmQueryEngine;
export type QueryEngine = WasmQueryEngine;
