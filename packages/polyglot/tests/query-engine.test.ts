/* eslint-disable */
import { describe, expect, it } from "vitest";
import { QueryEngine } from "../src/query-engine.js";
import type { QueryHooks, SymbolEntry, SymbolIndex } from "../src/runtime.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: number,
  kind: string,
  name: string,
  ruleName: string,
  parentId: number | null = null,
): SymbolEntry {
  return {
    id,
    kind,
    name,
    ruleName,
    namePath: "name",
    startByte: 0,
    endByte: 100,
    parentId,
    exports: [],
    inherits: [],
    metadata: {},
    fieldName: null,
  };
}

function makeIndex(entries: SymbolEntry[]): SymbolIndex {
  const symbols = new Map(entries.map((e) => [e.id, e]));
  const byName = new Map<string, number[]>();
  for (const e of entries) {
    const existing = byName.get(e.name);
    if (existing) existing.push(e.id);
    else byName.set(e.name, [e.id]);
  }
  return { symbols, byName, childrenOf: new Map() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QueryEngine", () => {
  it("memoizes query results", () => {
    let callCount = 0;
    const hooks: QueryHooks = {
      members: (db, self) => {
        callCount++;
        return db.childrenOf(self.id);
      },
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def"), makeEntry(2, "Function", "bar", "class_def", 1)];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    const result1 = engine.query("members", 1);
    const result2 = engine.query("members", 1);

    expect(callCount).toBe(1); // Only executed once
    expect(result1).toEqual(result2);
  });

  it("re-executes after invalidation", () => {
    let callCount = 0;
    const hooks: QueryHooks = {
      members: (db, self) => {
        callCount++;
        return db.childrenOf(self.id);
      },
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    engine.query("members", 1);
    expect(callCount).toBe(1);

    engine.invalidate(new Set([1]));
    engine.query("members", 1);
    expect(callCount).toBe(2); // Re-executed
  });

  it("backdates when result is unchanged", () => {
    let outerCallCount = 0;
    let innerCallCount = 0;

    const hooks: QueryHooks = {
      name: (db, self) => {
        innerCallCount++;
        // Read via db.symbol() to record an input dependency
        const entry = db.symbol(self.id);
        return entry?.name ?? "";
      },
      display: (db, self) => {
        outerCallCount++;
        const name = db.query<string>("name", self.id);
        return `Display: ${name}`;
      },
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    // First execution
    engine.query("display", 1);
    expect(outerCallCount).toBe(1);
    expect(innerCallCount).toBe(1);

    // Invalidate the input for symbol 1
    engine.invalidate(new Set([1]));

    // Query display again:
    // - name re-executes (its input dep changed) but returns same value "Foo"
    // - name is backdated: changed_at stays at R0
    // - display sees name.changed_at <= display.verified_at → deep_verify passes
    // - display is NOT re-executed
    engine.query("display", 1);
    expect(innerCallCount).toBe(2); // name re-executed
    expect(outerCallCount).toBe(1); // display was NOT re-executed (backdated)
  });

  it("detects cycles and throws without recovery", () => {
    const hooks: QueryHooks = {
      cyclic: (db, self) => {
        return db.query("cyclic", self.id); // Self-cycle
      },
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(() => engine.query("cyclic", 1)).toThrow(/Cycle detected/);
  });

  it("recovers from cycles with recovery function", () => {
    const hooks: QueryHooks = {
      allMembers: {
        execute: (db, self) => {
          const direct = db.childrenOf(self.id);
          // This would cycle if parent also calls allMembers
          if (self.parentId !== null) {
            const parentMembers = db.query<any[]>("allMembers", self.parentId);
            return [...direct, ...parentMembers];
          }
          return direct;
        },
        recovery: (cycle, self) => {
          return []; // Break the cycle with an empty array
        },
      },
    };

    const entries = [makeEntry(1, "Class", "A", "class_def"), makeEntry(2, "Class", "B", "class_def", 1)];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    // Should not throw — recovery function handles the cycle
    const result = engine.query<any[]>("allMembers", 2);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns null for unknown query", () => {
    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", {}]]));

    expect(engine.query("nonexistent", 1)).toBeNull();
  });

  it("throws for unknown symbol", () => {
    const index = makeIndex([]);
    const engine = new QueryEngine(index, new Map());

    expect(() => engine.query("anything", 999)).toThrow(/Unknown symbol/);
  });
});
