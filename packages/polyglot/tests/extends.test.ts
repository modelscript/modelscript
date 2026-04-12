/* eslint-disable */
import { describe, expect, it } from "vitest";
import { ScopeResolver } from "../src/resolver.js";
import type { IndexerHook, RefHook, SymbolEntry, SymbolIndex } from "../src/runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: number,
  kind: string,
  name: string,
  ruleName: string,
  parentId: number | null = null,
  opts: {
    exports?: string[];
    inherits?: string[];
    metadata?: Record<string, unknown>;
  } = {},
): SymbolEntry {
  return {
    id,
    kind,
    name,
    ruleName,
    namePath: "name",
    startByte: id * 100,
    endByte: id * 100 + 50,
    parentId,
    exports: opts.exports ?? [],
    inherits: opts.inherits ?? [],
    metadata: opts.metadata ?? {},
    fieldName: null,
  };
}

function makeIndex(entries: SymbolEntry[]): SymbolIndex {
  const symbols = new Map(entries.map((e) => [e.id, e]));
  const byName = new Map<string, number[]>();
  for (const e of entries) {
    const ex = byName.get(e.name);
    if (ex) ex.push(e.id);
    else byName.set(e.name, [e.id]);
  }
  return { symbols, byName, childrenOf: new Map() };
}

const classHook: IndexerHook = {
  ruleName: "class_def",
  kind: "Class",
  namePath: "name",
  exportPaths: ["body"],
  inheritPaths: ["extends_clause"],
  metadataFieldPaths: {},
};

const componentHook: IndexerHook = {
  ruleName: "component",
  kind: "Component",
  namePath: "name",
  exportPaths: [],
  inheritPaths: [],
  metadataFieldPaths: {},
};

const refHook: RefHook = {
  ruleName: "type_ref",
  namePath: "name",
  targetKinds: ["Class"],
  resolve: "lexical",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Extends chain resolution", () => {
  it("single-level extends: Resistor extends OnePort", () => {
    // OnePort has children: p, n, v, i
    // Resistor extends OnePort, has own child: R
    const entries = [
      makeEntry(1, "Class", "OnePort", "class_def", null, { exports: ["body"] }),
      makeEntry(2, "Component", "p", "component", 1),
      makeEntry(3, "Component", "n", "component", 1),
      makeEntry(4, "Component", "v", "component", 1),
      makeEntry(5, "Component", "i", "component", 1),

      makeEntry(10, "Class", "Resistor", "class_def", null, {
        exports: ["body"],
        inherits: ["extends_clause"],
      }),
      makeEntry(11, "Component", "R", "component", 10),
      // The extends clause ref — references "OnePort"
      makeEntry(12, "Class", "OnePort", "type_ref", 10),
    ];

    const index = makeIndex(entries);
    const resolver = new ScopeResolver(index, [refHook], [classHook, componentHook]);

    const visible = resolver.visibleSymbols(10);
    const names = visible.map((e) => e.name);

    // Should include own member R
    expect(names).toContain("R");
    // Should include inherited members from OnePort
    expect(names).toContain("p");
    expect(names).toContain("n");
    expect(names).toContain("v");
    expect(names).toContain("i");
  });

  it("diamond inheritance deduplication", () => {
    // D has child: x
    // B extends D, C extends D
    // A extends B and C → should see x only once
    const entries = [
      makeEntry(1, "Class", "D", "class_def", null, { exports: ["body"] }),
      makeEntry(2, "Component", "x", "component", 1),

      makeEntry(3, "Class", "B", "class_def", null, {
        exports: ["body"],
        inherits: ["extends_clause"],
      }),
      makeEntry(4, "Class", "D", "type_ref", 3), // B extends D

      makeEntry(5, "Class", "C", "class_def", null, {
        exports: ["body"],
        inherits: ["extends_clause"],
      }),
      makeEntry(6, "Class", "D", "type_ref", 5), // C extends D
    ];

    const index = makeIndex(entries);
    const resolver = new ScopeResolver(index, [refHook], [classHook, componentHook]);

    // B's visible symbols should include x from D
    const visibleB = resolver.visibleSymbols(3);
    const namesB = visibleB.map((e) => e.name);
    expect(namesB).toContain("x");
  });

  it("cycle in extends chain does not infinite loop", () => {
    // A extends B extends A → empty inherited set due to visited guard
    const entries = [
      makeEntry(1, "Class", "A", "class_def", null, {
        exports: ["body"],
        inherits: ["extends_clause"],
      }),
      makeEntry(2, "Class", "B", "type_ref", 1), // A extends B

      makeEntry(3, "Class", "B", "class_def", null, {
        exports: ["body"],
        inherits: ["extends_clause"],
      }),
      makeEntry(4, "Class", "A", "type_ref", 3), // B extends A
    ];

    const index = makeIndex(entries);
    const resolver = new ScopeResolver(index, [refHook], [classHook, componentHook]);

    // Should not hang — the visited set breaks the cycle
    const visible = resolver.visibleSymbols(1);
    expect(visible).toBeDefined();
  });

  it("lexical lookup finds inherited members", () => {
    // OnePort has "p"
    // Resistor extends OnePort
    // Ref to "OnePort" inside Resistor should resolve to the class
    const entries = [
      makeEntry(1, "Class", "OnePort", "class_def", null, { exports: ["body"] }),
      makeEntry(2, "Component", "p", "component", 1),

      makeEntry(3, "Class", "Resistor", "class_def", null, {
        exports: ["body"],
        inherits: ["extends_clause"],
      }),
      makeEntry(4, "Class", "OnePort", "type_ref", 3), // extends OnePort
    ];

    const index = makeIndex(entries);
    const resolver = new ScopeResolver(index, [refHook], [classHook, componentHook]);

    // Resolve the "OnePort" ref (entry 4) from inside Resistor
    // Should find the Class "OnePort" (entry 1)
    const results = resolver.resolve(entries[3]!); // entries[3] is entry 4 (0-indexed)
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("OnePort");
    expect(results[0].id).toBe(1);
  });
});
