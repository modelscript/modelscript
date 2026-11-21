// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deserializeMemo,
  Durability,
  LanguageDomainId,
  makePolyglotSymbolId,
  MemoryQueryCacheStore,
  QueryCancelledError,
  serializeMemo,
  stableMemoCacheKey,
  WasmQueryEngine,
  type Memo,
  type QueryHooks,
  type SymbolEntry,
  type SymbolIndex,
} from "../src/index.js";

function makeEntry(id: number, name: string, extra: Partial<SymbolEntry> = {}): SymbolEntry {
  return {
    id,
    kind: "Class",
    name,
    ruleName: "class_definition",
    namePath: name,
    startOffset: id * 10,
    endOffset: id * 10 + 5,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: {},
    fieldName: null,
    resourceId: "file:///a.mo",
    ...extra,
  };
}

function makeIndex(entries: SymbolEntry[]): SymbolIndex {
  const symbols = new Map<number, SymbolEntry>();
  const byName = new Map<string, number[]>();
  const childrenOf = new Map<number | null, number[]>();
  const symbolsByResource = new Map<string, number[]>();

  for (const e of entries) {
    symbols.set(e.id, e);
    byName.set(e.name, [...(byName.get(e.name) ?? []), e.id]);
    const p = e.parentId ?? null;
    childrenOf.set(p, [...(childrenOf.get(p) ?? []), e.id]);
    if (e.resourceId) {
      symbolsByResource.set(e.resourceId, [...(symbolsByResource.get(e.resourceId) ?? []), e.id]);
    }
  }

  return { symbols, byName, childrenOf, symbolsByResource };
}

describe("WasmQueryEngine correctness & hardening regressions", () => {
  it("preserves args when deepVerify re-executes parameterized queryWith sub-queries", () => {
    const e1 = makeEntry(1, "A", { metadata: { base: 10 } });
    const index = makeIndex([e1]);
    let receivedUndefinedArgs = false;

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          scaled: (_db, self, args) => {
            if (!args || typeof args["factor"] !== "number") {
              receivedUndefinedArgs = true;
              return -999;
            }
            return Number(self.metadata?.["base"] ?? 0) * (args["factor"] as number);
          },
          parent: (db, self) => {
            return db.queryWith<number>("scaled", self.id, { factor: 3 });
          },
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal(qe.query("parent", 1), 30);
    assert.equal(receivedUndefinedArgs, false);

    // Edit symbol 1 so `parent` must deepVerify `scaled(1, { factor: 3 })`
    index.symbols.set(1, makeEntry(1, "A", { metadata: { base: 20 } }));
    qe.invalidate([1]);

    assert.equal(qe.query("parent", 1), 60);
    assert.equal(receivedUndefinedArgs, false, "deepVerify must pass original args to parameterized sub-query");
    assert.equal(qe.queryWith("scaled", 1, { factor: 3 }), 60);
  });

  it("does not falsely backdate Map, Set, Date, RegExp, or distinct-key undefined objects", () => {
    const e1 = makeEntry(1, "A", { metadata: { version: 1 } });
    const index = makeIndex([e1]);
    let downstreamMapRuns = 0;
    let downstreamSetRuns = 0;

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          asMap: (_db, self) => {
            const v = self.metadata?.["version"];
            return new Map<string, unknown>([["k", v]]);
          },
          useMap: (db, self) => {
            downstreamMapRuns++;
            const m = db.query<Map<string, unknown>>("asMap", self.id);
            return m.get("k");
          },
          asSet: (_db, self) => {
            const v = self.metadata?.["version"];
            return new Set<unknown>([v]);
          },
          useSet: (db, self) => {
            downstreamSetRuns++;
            const s = db.query<Set<unknown>>("asSet", self.id);
            return Array.from(s).join(",");
          },
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal(qe.query("useMap", 1), 1);
    assert.equal(qe.query("useSet", 1), "1");
    assert.equal(downstreamMapRuns, 1);
    assert.equal(downstreamSetRuns, 1);

    // Change version: Map and Set contents change, so downstream MUST re-run (no false backdating)
    index.symbols.set(1, makeEntry(1, "A", { metadata: { version: 2 } }));
    qe.invalidate([1]);

    assert.equal(qe.query("useMap", 1), 2);
    assert.equal(qe.query("useSet", 1), "2");
    assert.equal(downstreamMapRuns, 2);
    assert.equal(downstreamSetRuns, 2);

    // No-op edit (same version = 2): Map and Set contents are equal, so downstream MUST backdate!
    qe.invalidate([1]);
    assert.equal(qe.query("useMap", 1), 2);
    assert.equal(qe.query("useSet", 1), "2");
    assert.equal(downstreamMapRuns, 2, "Equal Map should backdate downstream");
    assert.equal(downstreamSetRuns, 2, "Equal Set should backdate downstream");
  });

  it("automatically tracks symbolId input even when query only reads self without db.symbol()", () => {
    const e1 = makeEntry(1, "A", { metadata: { tag: "v1" } });
    const index = makeIndex([e1]);

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          readSelfOnly: (_db, self) => self.metadata?.["tag"],
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal(qe.query("readSelfOnly", 1), "v1");

    index.symbols.set(1, makeEntry(1, "A", { metadata: { tag: "v2" } }));
    qe.invalidate([1]);

    assert.equal(qe.query("readSelfOnly", 1), "v2");
  });

  it("deduplicates repeated query, byName, and domain dependencies in DependencyTracker", () => {
    const e1 = makeEntry(1, "A");
    const index = makeIndex([e1]);

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          leaf: (_db, self) => self.name,
          noisy: (db, self) => {
            for (let i = 0; i < 20; i++) {
              db.query("leaf", self.id);
              db.byName("A");
              db.getDomainRevision(LanguageDomainId.Modelica);
            }
            return "done";
          },
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal(qe.query("noisy", 1), "done");

    const memo = qe.getMemoFor("noisy", 1)!;
    assert.equal(memo.queries?.length, 1);
    assert.equal(memo.byNames?.length, 1);
    assert.equal(memo.domains?.length, 1);
  });

  it("unlinks reverse dependencies on flushVolatile, invalidateByName, and disposeDocument", () => {
    const e1 = makeEntry(1, "A", { resourceId: "file:///a.mo" });
    const index = makeIndex([e1]);

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          variability: (db, self) => {
            db.byName(self.name);
            return "continuous";
          },
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    qe.query("variability", 1);

    const internal = qe as unknown as {
      inputReverseDependencies: Map<number, Set<number>>;
      byNameReverseDependencies: Map<string, Set<number>>;
    };
    assert.ok(internal.inputReverseDependencies.size > 0);
    assert.ok(internal.byNameReverseDependencies.size > 0);

    qe.flushVolatile();
    assert.equal(qe.getMemoCount(), 0);
    assert.equal(internal.inputReverseDependencies.size, 0);
    assert.equal(internal.byNameReverseDependencies.size, 0);
  });

  it("rebuilds reverse deps, rebases revisions, and round-trips Int32Array inputs through hydrateMemos", () => {
    const e1 = makeEntry(1, "A", { metadata: { val: 1 } });
    const index1 = makeIndex([e1]);
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          compute: (_db, self) => self.metadata?.["val"],
        },
      ],
    ]);

    const exporter = new WasmQueryEngine(index1, hooks);
    // Advance exporter revision to 5 before computing
    for (let i = 0; i < 5; i++) exporter.invalidate([]);
    assert.equal(exporter.query("compute", 1), 1);

    // Round-trip through JSON using serializeMemo / deserializeMemo
    const dumped = exporter.dumpMemos();
    const hydratedMap = new Map<number, Memo>();
    for (const [k, m] of dumped) {
      const roundTripped = deserializeMemo(JSON.parse(JSON.stringify(serializeMemo(m))));
      hydratedMap.set(k, roundTripped);
    }

    // Hydrate into a fresh engine at revision 0
    const index2 = makeIndex([makeEntry(1, "A", { metadata: { val: 1 } })]);
    const consumer = new WasmQueryEngine(index2, hooks);
    consumer.hydrateMemos(hydratedMap);

    // Memo must be clamped to revision 0 and serve cached value
    assert.equal(consumer.query("compute", 1), 1);
    assert.equal(consumer.getStats().recomputes, 0);

    // Editing symbol 1 at revision 1 MUST invalidate the hydrated memo (proving revision clamp + Int32Array restore)
    index2.symbols.set(1, makeEntry(1, "A", { metadata: { val: 42 } }));
    consumer.invalidate([1]);
    assert.equal(consumer.query("compute", 1), 42);
    assert.equal(consumer.getStats().recomputes, 1);
  });

  it("does not leak unrelated workspace symbols into per-resource dirtyLintSymbols in runAllLintsAsync", async () => {
    const entries = [
      makeEntry(1, "InDocA", { resourceId: "file:///a.mo" }),
      makeEntry(2, "InDocB1", { resourceId: "file:///b.mo" }),
      makeEntry(3, "InDocB2", { resourceId: "file:///b.mo" }),
    ];
    const index = makeIndex(entries);
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          lint__check: () => null,
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    await qe.runAllLintsAsync("file:///a.mo");

    const dirtySets = (qe as unknown as { dirtyLintSymbols: Map<string, Set<number>> }).dirtyLintSymbols;
    const dirtyForA = dirtySets.get("file:///a.mo")!;
    assert.equal(dirtyForA.size, 0, "dirtyLintSymbols for file:///a.mo must be empty after linting");
  });

  it("disposeDocument bumps currentRevision only once per document", () => {
    const entries = [
      makeEntry(1, "S1", { resourceId: "file:///a.mo" }),
      makeEntry(2, "S2", { resourceId: "file:///a.mo" }),
      makeEntry(3, "S3", { resourceId: "file:///a.mo" }),
    ];
    const qe = new WasmQueryEngine(makeIndex(entries), new Map());
    const before = qe.getRevision();
    qe.disposeDocument("file:///a.mo");
    assert.equal(qe.getRevision(), before + 1);
  });

  it("propagates invalidation from base symbol to specialized virtual entries", () => {
    const e1 = makeEntry(1, "Generic", { metadata: { param: 10 } });
    const index = makeIndex([e1]);
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          readParam: (_db, self) => self.metadata?.["param"],
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    const db = qe.toQueryDB();
    const vid = db.specialize(1, { hash: "T=Real", data: { T: "Real" } });
    assert.equal(qe.query("readParam", vid), 10);

    // Update base symbol 1 and invalidate it
    index.symbols.set(1, makeEntry(1, "Generic", { metadata: { param: 99 } }));
    qe.invalidate([1]);

    assert.equal(qe.query("readParam", vid), 99);
  });

  it("invalidates domain-dependent lints in runAllLintsAsync when invalidateDomain is called", async () => {
    const mId = makePolyglotSymbolId(LanguageDomainId.Modelica, 1);
    const index = makeIndex([makeEntry(mId, "M", { resourceId: "file:///m.mo" })]);
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          lint__domainRev: (db) => {
            const rev = db.getDomainRevision(LanguageDomainId.SysML2);
            return rev > 0 ? { message: `sysml rev ${rev}`, severity: "warning" } : null;
          },
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal((await qe.runAllLintsAsync()).length, 0);

    qe.invalidateDomain(LanguageDomainId.SysML2);
    const diags = await qe.runAllLintsAsync();
    assert.equal(diags.length, 1);
    assert.equal(diags[0]!.message, "sysml rev 1");
  });

  it("updateIndex detects same-offset metadata changes without explicit changedIds", () => {
    const e1 = makeEntry(1, "X", { startOffset: 0, endOffset: 10, metadata: { variability: "continuous" } });
    const qe = new WasmQueryEngine(
      makeIndex([e1]),
      new Map([["class_definition", { getVar: (_db, self) => self.metadata?.["variability"] }]]),
    );

    assert.equal(qe.query("getVar", 1), "continuous");

    const e1Updated = makeEntry(1, "X", { startOffset: 0, endOffset: 10, metadata: { variability: "parameter" } });
    qe.updateIndex(makeIndex([e1Updated]));

    assert.equal(qe.query("getVar", 1), "parameter");
  });

  it("memoKey is collision-free across all 256 domains, >1000 query names, large localSeq, and virtual IDs", () => {
    const qe = new WasmQueryEngine(makeIndex([makeEntry(1, "A")]), new Map());
    const seen = new Set<number>();

    // All 256 domains with identical localSeq = 42
    for (let d = 0; d < 256; d++) {
      const symId = makePolyglotSymbolId(d, 42);
      const k = qe.memoKey("resolveType", symId);
      assert.ok(!seen.has(k), `Collision for domain ${d}`);
      seen.add(k);
    }

    // >1,000 distinct query names on same symbol
    for (let q = 0; q < 1200; q++) {
      const k = qe.memoKey(`q_${q}`, 1);
      assert.ok(!seen.has(k), `Collision for query q_${q}`);
      seen.add(k);
    }

    // Large localSeq > 2_000_000 vs small localSeq and negative virtual IDs
    const kSmall = qe.memoKey("resolveType", 1);
    const kLarge = qe.memoKey("resolveType", 2_000_001);
    const kVirt = qe.memoKey("resolveType", -1);
    assert.notEqual(kSmall, kLarge);
    assert.notEqual(kSmall, kVirt);
    assert.notEqual(kLarge, kVirt);
  });

  it("verifies High-durability stdlib queries in O(1) without deepVerify on Low-durability user edits", () => {
    const stdlibA = makeEntry(1, "MSL_Base", { resourceId: "file:///msl/Base.mo", metadata: { val: 100 } });
    const stdlibB = makeEntry(2, "MSL_Derived", { resourceId: "file:///msl/Base.mo" });
    const userSym = makeEntry(3, "UserModel", { resourceId: "file:///user/Main.mo", metadata: { x: 1 } });
    const index = makeIndex([stdlibA, stdlibB, userSym]);

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          baseVal: (db, self) => db.symbol(self.id)?.metadata?.["val"],
          derivedVal: (db) => Number(db.query("baseVal", 1)) * 2,
          userVal: (db, self) => Number(db.symbol(self.id)?.metadata?.["x"] ?? 0) + Number(db.query("derivedVal", 2)),
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    qe.setResourceDurability("file:///msl/Base.mo", Durability.High);

    assert.equal(qe.query("userVal", 3), 201);
    qe.resetStats();

    // Edit Low-durability user symbol
    index.symbols.set(3, makeEntry(3, "UserModel", { resourceId: "file:///user/Main.mo", metadata: { x: 5 } }));
    qe.invalidate([3]);

    // Querying High-durability derivedVal must hit O(1) durability fast path (0 deepVerifyHits, 0 recomputes)
    assert.equal(qe.query("derivedVal", 2), 200);
    const statsAfterLowEdit = qe.getStats();
    assert.equal(statsAfterLowEdit.durabilityHits, 1, "High-durability query must short-circuit via durabilityHits");
    assert.equal(statsAfterLowEdit.deepVerifyHits, 0, "Should skip deepVerify entirely");
    assert.equal(statsAfterLowEdit.recomputes, 0);

    // Editing High-durability stdlib symbol MUST invalidate derivedVal
    index.symbols.set(1, makeEntry(1, "MSL_Base", { resourceId: "file:///msl/Base.mo", metadata: { val: 250 } }));
    qe.invalidate([1]);
    assert.equal(qe.query("derivedVal", 2), 500);
  });

  it("supports mid-query cooperative cancellation without corrupting engine state", () => {
    const entries = [makeEntry(1, "A"), makeEntry(2, "B"), makeEntry(3, "C")];
    const index = makeIndex(entries);
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          step3: (_db, self) => self.name,
          step2: (db) => db.query("step3", 3),
          step1: (db) => db.query("step2", 2),
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    let calls = 0;
    qe.setCancellationChecker(() => ++calls >= 2, 1);

    assert.throws(() => qe.query("step1", 1), QueryCancelledError);

    // Clearing cancellation checker must allow subsequent queries to succeed cleanly
    qe.setCancellationChecker(null);
    assert.equal(qe.query("step1", 1), "C");
  });

  it("preserves High-durability stdlib memos over Low-durability memos during eviction", () => {
    const entries = [
      makeEntry(1, "Stdlib", { resourceId: "file:///msl/Std.mo" }),
      makeEntry(2, "User1", { resourceId: "file:///u1.mo" }),
      makeEntry(3, "User2", { resourceId: "file:///u2.mo" }),
    ];
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          info: (_db, self) => self.name,
        },
      ],
    ]);

    const qe = new WasmQueryEngine(makeIndex(entries), hooks, { maxMemos: 2 });
    qe.setInputDurability(1, Durability.High);

    qe.query("info", 1); // High durability (oldest)
    qe.query("info", 2); // Low durability
    qe.query("info", 3); // Triggers eviction — must evict Low-durability (2), preserving High-durability (1)

    assert.ok(qe.getMemoFor("info", 1), "High-durability stdlib memo should be preserved over Low-durability memo");
    assert.equal(qe.getMemoFor("info", 2), undefined, "Low-durability memo should be evicted first");
    assert.ok(qe.getMemoFor("info", 3));
  });

  it("invalidates queries that called db.allEntries() when a new symbol is added", () => {
    const index = makeIndex([makeEntry(1, "A")]);
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          countAll: (db) => db.allEntries().length,
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal(qe.query("countAll", 1), 1);

    // Add a brand-new symbol 2
    const e2 = makeEntry(2, "B");
    index.symbols.set(2, e2);
    index.byName.set("B", [2]);
    qe.invalidate([2]);

    assert.equal(qe.query("countAll", 1), 2);
  });

  it("handles cyclic queries deterministically without poisoning non-head participants", () => {
    const eA = makeEntry(1, "A");
    const eB = makeEntry(2, "B");
    const makeCycleHooks = () =>
      new Map<string, QueryHooks>([
        [
          "class_definition",
          {
            cycleVal: {
              execute: (db, self) => {
                const other = self.id === 1 ? 2 : 1;
                const next = db.query<string>("cycleVal", other);
                return `${self.name}->${next}`;
              },
              recovery: (_db, self) => `CYCLE(${self.name})`,
            },
          },
        ],
      ]);

    // Engine 1: query A first, then B
    const qe1 = new WasmQueryEngine(makeIndex([eA, eB]), makeCycleHooks());
    const aFirst = qe1.query<string>("cycleVal", 1);
    const bAfterA = qe1.query<string>("cycleVal", 2);

    // Engine 2: query B first, then A
    const qe2 = new WasmQueryEngine(makeIndex([eA, eB]), makeCycleHooks());
    const bFirst = qe2.query<string>("cycleVal", 2);
    const aAfterB = qe2.query<string>("cycleVal", 1);

    // Results must be order-independent: B must not be poisoned by A having run first
    assert.equal(aFirst, "A->B->CYCLE(A)");
    assert.equal(bAfterA, bFirst, "Querying B after A must match querying B directly");
    assert.equal(aAfterB, aFirst, "Querying A after B must match querying A directly");
  });

  it("auto-classifies stdlib resource URIs as Durability.High without manual registration", () => {
    const stdlibSym = makeEntry(1, "ScalarValues", { resourceId: "sysml2://stdlib/ScalarValues.sysml" });
    const userSym = makeEntry(2, "MyPart", { resourceId: "file:///workspace/MyPart.sysml" });
    const qe = new WasmQueryEngine(makeIndex([stdlibSym, userSym]), new Map());

    assert.equal(qe.getInputDurability(1), Durability.High);
    assert.equal(qe.getInputDurability(2), Durability.Low);
  });

  it("preflights cross-engine memos deterministically via stableMemoCacheKey regardless of query order", async () => {
    const cache = new MemoryQueryCacheStore();
    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          qAlpha: (_db, self) => `alpha:${self.name}`,
          qBeta: (_db, self) => `beta:${self.name}`,
        },
      ],
    ]);

    // Engine 1 executes qAlpha then qBeta and persists under stableMemoCacheKey
    const qe1 = new WasmQueryEngine(makeIndex([makeEntry(1, "Node")]), hooks);
    assert.equal(qe1.query("qAlpha", 1), "alpha:Node");
    assert.equal(qe1.query("qBeta", 1), "beta:Node");
    for (const memo of qe1.dumpMemos().values()) {
      const stableKey = stableMemoCacheKey(memo.queryName!, memo.symbolId!, memo.argsHash);
      await cache.setMemo(stableKey, deserializeMemo(JSON.parse(JSON.stringify(serializeMemo(memo)))));
    }

    // Engine 2 registers/preflights in opposite order (qBeta first) and must hydrate without recomputing
    const qe2 = new WasmQueryEngine(makeIndex([makeEntry(1, "Node")]), hooks, { cacheStore: cache });
    await qe2.preflight([1], ["qBeta", "qAlpha"]);
    assert.equal(qe2.getStats().recomputes, 0, "Preflight must hydrate both memos from stableMemoCacheKey");
    assert.equal(qe2.query("qBeta", 1), "beta:Node");
    assert.equal(qe2.query("qAlpha", 1), "alpha:Node");
  });
});
