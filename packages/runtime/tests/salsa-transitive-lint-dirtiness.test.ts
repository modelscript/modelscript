// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Regression test: incremental lint caches must be invalidated transitively.
 *
 * `lint__usesB(A)` reads `lookupB(B)`, which reads symbol `B`'s input. Editing only `B` must
 * re-run `A`'s lint on the next `runAllLintsAsync()` pass instead of serving the stale cached
 * diagnostics for `A`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WasmQueryEngine, type QueryHooks, type SymbolEntry, type SymbolIndex } from "../src/index.js";

function sym(id: number, name: string, metadata: Record<string, unknown> = {}): SymbolEntry {
  return {
    id,
    name,
    kind: "Class",
    ruleName: "ClassDefinition",
    namePath: name,
    startOffset: id * 100,
    endOffset: id * 100 + 20,
    parentId: null,
    exports: [],
    inherits: [],
    metadata,
    fieldName: null,
    resourceId: "file:///workspace/Test.mo",
  } as SymbolEntry;
}

function buildIndex(entries: SymbolEntry[]): SymbolIndex {
  const symbols = new Map<number, SymbolEntry>();
  const byName = new Map<string, number[]>();
  const childrenOf = new Map<number | null, number[]>();
  const symbolsByResource = new Map<string, number[]>();
  for (const e of entries) {
    symbols.set(e.id, e);
    byName.set(e.name, [...(byName.get(e.name) ?? []), e.id]);
    childrenOf.set(null, [...(childrenOf.get(null) ?? []), e.id]);
    symbolsByResource.set(e.resourceId!, [...(symbolsByResource.get(e.resourceId!) ?? []), e.id]);
  }
  return { symbols, byName, childrenOf, symbolsByResource } as SymbolIndex;
}

const A = 1;
const B = 2;

function makeHooks(): Map<string, QueryHooks> {
  const hooks = {
    lookupB: (db: any, self: SymbolEntry) => Boolean(db.symbol(self.id)?.metadata?.broken),
    lint__usesB: (db: any, self: SymbolEntry) => {
      if (self.id !== A) return null;
      return db.query("lookupB", B) ? { message: "B is broken", severity: "error" } : null;
    },
  } as unknown as QueryHooks;
  return new Map([["ClassDefinition", hooks]]);
}

describe("WasmQueryEngine incremental lint dirtiness", () => {
  it("re-lints a symbol whose lint transitively depends on an edited symbol", async () => {
    const index = buildIndex([sym(A, "A"), sym(B, "B", { broken: false })]);
    const engine = new WasmQueryEngine(index, makeHooks());

    const first = await engine.runAllLintsAsync();
    assert.equal(first.length, 0);

    // Edit only B.
    index.symbols.set(B, sym(B, "B", { broken: true }));
    engine.invalidate([B]);

    const second = await engine.runAllLintsAsync();
    assert.equal(second.length, 1, "A's lint must be re-run after its transitive dependency B changed");
    assert.equal(second[0]!.symbolId, A);

    // Revert B: the diagnostic must clear again.
    index.symbols.set(B, sym(B, "B", { broken: false }));
    engine.invalidate([B]);
    const third = await engine.runAllLintsAsync();
    assert.equal(third.length, 0);
  });

  it("propagates byName invalidation through dependent queries", async () => {
    const hooks = {
      resolveTarget: (db: any) => db.byName("Target").length > 0,
      lint__needsTarget: (db: any, self: SymbolEntry) =>
        self.id === A && !db.query("resolveTarget", A) ? { message: "missing Target", severity: "error" } : null,
    } as unknown as QueryHooks;
    const index = buildIndex([sym(A, "A")]);
    const engine = new WasmQueryEngine(index, new Map([["ClassDefinition", hooks]]));

    assert.equal((await engine.runAllLintsAsync()).length, 1);

    const target = sym(3, "Target");
    index.symbols.set(3, target);
    index.byName.set("Target", [3]);
    index.childrenOf.set(null, [A, 3]);
    engine.invalidate([3]);

    assert.equal((await engine.runAllLintsAsync()).length, 0);
  });
});
