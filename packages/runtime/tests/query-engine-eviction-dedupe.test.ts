// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryHooks, SymbolEntry, SymbolIndex } from "../src/runtime.js";
import { WasmQueryEngine } from "../src/workspace/wasm_query_engine.js";

function makeEntry(id: number, name: string): SymbolEntry {
  return {
    id,
    kind: "Class",
    name,
    ruleName: "class_definition",
    namePath: name,
    startOffset: 0,
    endOffset: 10,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: {},
    fieldName: null,
  };
}

describe("WasmQueryEngine dependency deduplication and FIFO eviction cleanup", () => {
  it("deduplicates repeated symbol reads in DependencyTracker.recordInput", () => {
    const e1 = makeEntry(1, "A");
    const e2 = makeEntry(2, "B");
    const index: SymbolIndex = {
      symbols: new Map([
        [1, e1],
        [2, e2],
      ]),
      byName: new Map([
        ["A", [1]],
        ["B", [2]],
      ]),
      childrenOf: new Map([[null, [1, 2]]]),
    };

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          repeatedReads: (db) => {
            for (let i = 0; i < 20; i++) {
              db.symbol(1);
              db.symbol(2);
            }
            return "ok";
          },
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks);
    assert.equal(qe.fetch("repeatedReads", 1), "ok");

    const memos = (qe as unknown as { memos: Map<number, { inputs?: Int32Array }> }).memos;
    assert.equal(memos.size, 1);
    const memo = memos.values().next().value!;
    assert.ok(memo.inputs, "Expected recorded inputs");
    assert.equal(memo.inputs.length, 2, `Expected deduplicated inputs [1, 2], got [${Array.from(memo.inputs)}]`);
  });

  it("cleans reverse dependency maps when memos are evicted under maxMemos", () => {
    const entries = [makeEntry(1, "C1"), makeEntry(2, "C2"), makeEntry(3, "C3")];
    const index: SymbolIndex = {
      symbols: new Map(entries.map((e) => [e.id, e])),
      byName: new Map(entries.map((e) => [e.name, [e.id]])),
      childrenOf: new Map([[null, entries.map((e) => e.id)]]),
    };

    const hooks = new Map<string, QueryHooks>([
      [
        "class_definition",
        {
          leafQuery: (db, self) => {
            db.symbol(self.id);
            db.byName(self.name);
            return self.name;
          },
          outerQuery: (db, self) => db.query("leafQuery", self.id),
        },
      ],
    ]);

    const qe = new WasmQueryEngine(index, hooks, { maxMemos: 2 });
    qe.fetch("outerQuery", 1);
    qe.fetch("leafQuery", 2);
    // Fetching a 3rd entry evicts the oldest (`leafQuery(1)` or `outerQuery(1)`)
    qe.fetch("leafQuery", 3);

    const internal = qe as unknown as {
      memos: Map<number, unknown>;
      inputReverseDependencies: Map<number, Set<number>>;
      byNameReverseDependencies: Map<string, Set<number>>;
      queryReverseDependencies: Map<number, Set<number>>;
    };
    assert.equal(internal.memos.size, 2);

    const liveKeys = new Set(internal.memos.keys());
    for (const set of internal.inputReverseDependencies.values()) {
      for (const k of set) assert.ok(liveKeys.has(k), `Leaked evicted key ${k} in inputReverseDependencies`);
    }
    for (const set of internal.byNameReverseDependencies.values()) {
      for (const k of set) assert.ok(liveKeys.has(k), `Leaked evicted key ${k} in byNameReverseDependencies`);
    }
    for (const set of internal.queryReverseDependencies.values()) {
      for (const k of set) assert.ok(liveKeys.has(k), `Leaked evicted key ${k} in queryReverseDependencies`);
    }
  });
});
