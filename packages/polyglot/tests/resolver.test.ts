/* eslint-disable */
import { describe, expect, it } from "vitest";
import { ScopeResolver } from "../src/resolver.js";
import type { RefHook, SymbolEntry, SymbolIndex } from "../src/runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: number,
  kind: string,
  name: string,
  ruleName: string,
  parentId: number | null = null,
  exports: string[] = [],
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
    exports,
    inherits: [],
    metadata: {},
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ScopeResolver", () => {
  describe("lexical resolution", () => {
    it("resolves a name in the same scope", () => {
      const entries = [
        makeEntry(1, "Class", "Outer", "class_def", null, ["body"]),
        makeEntry(2, "Class", "Inner", "class_def", 1),
        makeEntry(3, "Variable", "Inner", "type_ref", 1),
      ];
      const index = makeIndex(entries);

      const refHooks: RefHook[] = [
        { ruleName: "type_ref", namePath: "name", targetKinds: ["Class"], resolve: "lexical" },
      ];

      const resolver = new ScopeResolver(index, refHooks, []);

      const results = resolver.resolve(entries[2]); // type_ref "Inner"
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(2); // Resolves to the Class "Inner"
    });

    it("walks up parent scopes for lexical lookup", () => {
      const entries = [
        makeEntry(1, "Class", "Root", "class_def", null),
        makeEntry(2, "Class", "Child", "class_def", 1),
        makeEntry(3, "Variable", "Root", "type_ref", 2), // Ref to "Root" from inside Child
      ];
      const index = makeIndex(entries);

      const refHooks: RefHook[] = [
        { ruleName: "type_ref", namePath: "name", targetKinds: ["Class"], resolve: "lexical" },
      ];

      const resolver = new ScopeResolver(index, refHooks, []);

      const results = resolver.resolve(entries[2]);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Root");
    });

    it("returns empty for unresolved references", () => {
      const entries = [makeEntry(1, "Variable", "Unknown", "type_ref", null)];
      const index = makeIndex(entries);

      const refHooks: RefHook[] = [
        { ruleName: "type_ref", namePath: "name", targetKinds: ["Class"], resolve: "lexical" },
      ];

      const resolver = new ScopeResolver(index, refHooks, []);
      const results = resolver.resolve(entries[0]);
      expect(results).toEqual([]);
    });
  });

  describe("qualified resolution", () => {
    it("resolves a dotted path", () => {
      const entries = [
        makeEntry(1, "Package", "Modelica", "class_def", null),
        makeEntry(2, "Class", "Electrical", "class_def", 1),
        makeEntry(3, "Class", "Resistor", "class_def", 2),
        makeEntry(4, "Variable", "Modelica.Electrical.Resistor", "type_ref", null),
      ];
      const index = makeIndex(entries);

      const refHooks: RefHook[] = [
        { ruleName: "type_ref", namePath: "name", targetKinds: ["Class"], resolve: "qualified" },
      ];

      const resolver = new ScopeResolver(index, refHooks, []);
      const results = resolver.resolve(entries[3]);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Resistor");
    });
  });

  describe("visibleSymbols", () => {
    it("returns all symbols visible from a scope", () => {
      const entries = [
        makeEntry(1, "Class", "A", "class_def", null),
        makeEntry(2, "Function", "foo", "func_def", 1),
        makeEntry(3, "Variable", "x", "var_def", 1),
      ];
      const index = makeIndex(entries);
      const resolver = new ScopeResolver(index, [], []);

      const visible = resolver.visibleSymbols(1);
      const names = visible.map((e) => e.name);
      expect(names).toContain("foo");
      expect(names).toContain("x");
    });
  });

  describe("findReferences", () => {
    it("finds all references to a declaration", () => {
      const entries = [
        makeEntry(1, "Class", "Foo", "class_def", null),
        makeEntry(2, "Variable", "Foo", "type_ref", null),
        makeEntry(3, "Variable", "Foo", "type_ref", null),
        makeEntry(4, "Variable", "Bar", "type_ref", null),
      ];
      const index = makeIndex(entries);

      const refHooks: RefHook[] = [
        { ruleName: "type_ref", namePath: "name", targetKinds: ["Class"], resolve: "lexical" },
      ];

      const resolver = new ScopeResolver(index, refHooks, []);
      const refs = resolver.findReferences(1);
      expect(refs.length).toBe(2); // Two refs to "Foo"
    });
  });
});
