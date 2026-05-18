// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { MemoKeyStore, packMemoKey, QueryNameRegistry, unpackMemoKey } from "@modelscript/salsa";
import { describe, expect, it } from "vitest";
import { StringInterner } from "../src/interner.js";
import type { SymbolEntry } from "../src/runtime.js";
import { SymbolArena, SymbolEntryView } from "../src/symbol-arena.js";

// ---------------------------------------------------------------------------
// Helper: create a test SymbolEntry
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<SymbolEntry> & { id: number; name: string }): SymbolEntry {
  return {
    kind: "Class",
    ruleName: "class_definition",
    namePath: "name",
    startByte: 0,
    endByte: 100,
    parentId: null,
    exports: [],
    inherits: [],
    metadata: {},
    fieldName: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SymbolArena
// ---------------------------------------------------------------------------

describe("SymbolArena", () => {
  it("stores and retrieves entries via Flyweight views", () => {
    const arena = new SymbolArena();

    const entry = makeEntry({
      id: 1,
      name: "Resistor",
      kind: "Model",
      ruleName: "class_definition",
      startByte: 10,
      endByte: 200,
      parentId: null,
      metadata: { classKind: "model" },
    });

    arena.addEntry(entry);

    const view = new SymbolEntryView(arena, 1);
    expect(view.id).toBe(1);
    expect(view.name).toBe("Resistor");
    expect(view.kind).toBe("Model");
    expect(view.ruleName).toBe("class_definition");
    expect(view.startByte).toBe(10);
    expect(view.endByte).toBe(200);
    expect(view.parentId).toBeNull();
    expect(view.metadata).toEqual({ classKind: "model" });
  });

  it("handles parent-child relationships", () => {
    const arena = new SymbolArena();

    arena.addEntry(makeEntry({ id: 1, name: "Package1" }));
    arena.addEntry(makeEntry({ id: 2, name: "ClassA", parentId: 1 }));
    arena.addEntry(makeEntry({ id: 3, name: "ClassB", parentId: 1 }));

    const view = new SymbolEntryView(arena, 2);
    expect(view.parentId).toBe(1);

    const children = arena.getChildrenOf(1);
    expect(children).toEqual([2, 3]);
  });

  it("supports byName lookup", () => {
    const arena = new SymbolArena();

    arena.addEntry(makeEntry({ id: 1, name: "Resistor" }));
    arena.addEntry(makeEntry({ id: 2, name: "Capacitor" }));
    arena.addEntry(makeEntry({ id: 3, name: "Resistor" })); // duplicate name

    const ids = arena.getByName("Resistor");
    expect(ids).toEqual([1, 3]);
    expect(arena.getByName("Capacitor")).toEqual([2]);
    expect(arena.getByName("Unknown")).toEqual([]);
  });

  it("handles optional fields (resourceId, fieldName, language)", () => {
    const arena = new SymbolArena();

    arena.addEntry(
      makeEntry({
        id: 1,
        name: "Test",
        resourceId: "file:///test.mo",
        fieldName: "body",
      }),
    );

    const view = new SymbolEntryView(arena, 1);
    expect(view.resourceId).toBe("file:///test.mo");
    expect(view.fieldName).toBe("body");
  });

  it("handles null optional fields", () => {
    const arena = new SymbolArena();

    arena.addEntry(makeEntry({ id: 1, name: "Test" }));

    const view = new SymbolEntryView(arena, 1);
    expect(view.resourceId).toBeUndefined();
    expect(view.fieldName).toBeNull();
    expect(view.fieldRanges).toBeUndefined();
    expect(view.language).toBeUndefined();
  });

  it("grows automatically for large IDs", () => {
    const arena = new SymbolArena(undefined, 4); // tiny initial capacity

    // Add entry with large ID
    arena.addEntry(makeEntry({ id: 100, name: "LargeId" }));

    const view = new SymbolEntryView(arena, 100);
    expect(view.name).toBe("LargeId");
    expect(arena.capacity).toBeGreaterThanOrEqual(101);
  });

  it("shares interner across entries (deduplicates strings)", () => {
    const interner = new StringInterner();
    const arena = new SymbolArena(interner);

    // Same ruleName and kind across many entries
    for (let i = 1; i <= 100; i++) {
      arena.addEntry(
        makeEntry({
          id: i,
          name: `Component_${i}`,
          kind: "Component",
          ruleName: "component_declaration",
        }),
      );
    }

    // "Component" and "component_declaration" should be interned once
    expect(interner.size).toBeLessThan(110); // 100 names + a few shared strings
  });

  it("exports to SymbolIndex format", () => {
    const arena = new SymbolArena();

    arena.addEntry(makeEntry({ id: 1, name: "A", parentId: null }));
    arena.addEntry(makeEntry({ id: 2, name: "B", parentId: 1 }));

    const index = arena.toSymbolIndex();

    expect(index.symbols.size).toBe(2);
    expect(index.symbols.get(1)!.name).toBe("A");
    expect(index.symbols.get(2)!.name).toBe("B");
    expect(index.byName.get("A")).toEqual([1]);
    expect(index.childrenOf.get(1)).toEqual([2]);
  });

  it("estimates memory usage", () => {
    const arena = new SymbolArena();
    for (let i = 1; i <= 100; i++) {
      arena.addEntry(makeEntry({ id: i, name: `Var_${i}` }));
    }

    const bytes = arena.estimateMemoryBytes();
    expect(bytes).toBeGreaterThan(0);
    // Should be much less than 100 SymbolEntry objects (~20KB for objects vs ~4KB for arena)
    expect(bytes).toBeLessThan(100000);
  });

  it("clear resets all state", () => {
    const arena = new SymbolArena();
    arena.addEntry(makeEntry({ id: 1, name: "Test" }));

    arena.clear();
    expect(arena.length).toBe(0);
    expect(arena.getByName("Test")).toEqual([]);
    expect(arena.getChildrenOf(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// QueryNameRegistry
// ---------------------------------------------------------------------------

describe("QueryNameRegistry", () => {
  it("assigns stable indices to query names", () => {
    const reg = new QueryNameRegistry();
    const idx1 = reg.register("members");
    const idx2 = reg.register("resolvedType");
    const idx3 = reg.register("members"); // same as idx1

    expect(idx1).not.toBe(idx2);
    expect(idx1).toBe(idx3);
  });

  it("resolves indices back to names", () => {
    const reg = new QueryNameRegistry();
    const idx = reg.register("flattenedDAE");
    expect(reg.resolve(idx)).toBe("flattenedDAE");
  });

  it("tracks size", () => {
    const reg = new QueryNameRegistry();
    reg.register("a");
    reg.register("b");
    reg.register("a");
    expect(reg.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// packMemoKey / unpackMemoKey
// ---------------------------------------------------------------------------

describe("packMemoKey", () => {
  it("packs and unpacks small IDs", () => {
    const packed = packMemoKey(5, 42)!;
    expect(packed).not.toBeNull();
    const [qi, sid] = unpackMemoKey(packed);
    expect(qi).toBe(5);
    expect(sid).toBe(42);
  });

  it("packs and unpacks boundary IDs", () => {
    const packed = packMemoKey(255, 0x00ff_ffff)!;
    expect(packed).not.toBeNull();
    const [qi, sid] = unpackMemoKey(packed);
    expect(qi).toBe(255);
    expect(sid).toBe(0x00ff_ffff);
  });

  it("returns null for negative (virtual) symbol IDs", () => {
    expect(packMemoKey(0, -1)).toBeNull();
    expect(packMemoKey(0, -100)).toBeNull();
  });

  it("returns null for symbol IDs exceeding 40-bit range", () => {
    expect(packMemoKey(0, 0x0100_0000_0000)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MemoKeyStore
// ---------------------------------------------------------------------------

describe("MemoKeyStore", () => {
  it("stores and retrieves memos via packed keys", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("members", 42, "result_A");
    expect(store.get("members", 42)).toBe("result_A");
    expect(store.has("members", 42)).toBe(true);
    expect(store.size).toBe(1);
  });

  it("falls back to string keys for virtual IDs", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("members", -5, "virtual_result");
    expect(store.get("members", -5)).toBe("virtual_result");
    expect(store.has("members", -5)).toBe(true);
  });

  it("supports argsHash for compound keys", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("resolvedType", 10, "type_A", "hash1");
    store.set("resolvedType", 10, "type_B", "hash2");

    expect(store.get("resolvedType", 10, "hash1")).toBe("type_A");
    expect(store.get("resolvedType", 10, "hash2")).toBe("type_B");
    expect(store.get("resolvedType", 10)).toBeUndefined(); // no argsHash
  });

  it("deletes memos", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("q", 1, "val");
    expect(store.delete("q", 1)).toBe(true);
    expect(store.get("q", 1)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("clears all memos", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("a", 1, "x");
    store.set("b", -2, "y"); // virtual ID
    store.set("c", 3, "z", "hash");
    expect(store.size).toBe(3);

    store.clear();
    expect(store.size).toBe(0);
  });

  it("iterates over all entries", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("q1", 10, "a");
    store.set("q2", 20, "b");
    store.set("q3", -1, "c"); // virtual

    const entries = [...store.entries()];
    expect(entries.length).toBe(3);

    const names = entries.map(([qn]) => qn).sort();
    expect(names).toEqual(["q1", "q2", "q3"]);
  });

  it("evicts oldest entries", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    for (let i = 0; i < 10; i++) {
      store.set("q", i, `val_${i}`);
    }
    expect(store.size).toBe(10);

    const evicted = store.evictOldest(3);
    expect(evicted.length).toBe(3);
    expect(store.size).toBe(7);
  });

  it("deleteAllForSymbol removes all queries for a symbol", () => {
    const reg = new QueryNameRegistry();
    const store = new MemoKeyStore<string>(reg);

    store.set("q1", 5, "a");
    store.set("q2", 5, "b");
    store.set("q3", 10, "c");

    store.deleteAllForSymbol(5);
    expect(store.get("q1", 5)).toBeUndefined();
    expect(store.get("q2", 5)).toBeUndefined();
    expect(store.get("q3", 10)).toBe("c");
  });
});
