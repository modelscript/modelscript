// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deserializeMemo,
  LanguageDomainId,
  makePolyglotSymbolId,
  serializeMemo,
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
});
