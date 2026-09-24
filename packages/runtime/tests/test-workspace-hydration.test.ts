// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from "node:assert";
import { LanguageWorkspaceIndex } from "../src/index.js";
import type { SymbolEntry } from "../src/runtime.js";

async function runTests() {
  console.log("Running LanguageWorkspaceIndex.hydrate tests...");

  const index = new LanguageWorkspaceIndex();

  const mockEntry1: SymbolEntry = {
    id: 1,
    name: "Resistor",
    kind: "Class",
    ruleName: "class_definition",
    parentId: null,
    startByte: 0,
    endByte: 100,
    exports: [],
    inherits: [],
    metadata: { classKind: "model" },
    fieldName: null,
    resourceId: "sources/Modelica/Electrical/Analog/Basic/Resistor.mo",
  };

  const mockEntry2: SymbolEntry = {
    id: 2,
    name: "Capacitor",
    kind: "Class",
    ruleName: "class_definition",
    parentId: null,
    startByte: 0,
    endByte: 120,
    exports: [],
    inherits: [],
    metadata: { classKind: "model" },
    fieldName: null,
    resourceId: "sources/Modelica/Electrical/Analog/Basic/Capacitor.mo",
  };

  const symbols = new Map<number, SymbolEntry>([
    [1, mockEntry1],
    [2, mockEntry2],
  ]);

  const byName = new Map<string, number[]>([
    ["Resistor", [1]],
    ["Capacitor", [2]],
  ]);

  const childrenOf = new Map<number | null, number[]>([[null, [1, 2]]]);

  // Test hydration with resource ID remapping
  index.hydrate(
    "library-bundle:/Modelica@4.1.0",
    { symbols, byName, childrenOf },
    undefined,
    (origPath: string) => `/mapped/${origPath}`,
  );

  const unified = index.toUnified();

  assert.strictEqual(unified.symbols.size, 2, "Should have hydrated 2 symbols");
  assert.ok(unified.symbols.has(1), "Should contain symbol 1");
  assert.ok(unified.symbols.has(2), "Should contain symbol 2");

  const sym1 = unified.symbols.get(1);
  assert.strictEqual(sym1?.name, "Resistor");
  assert.strictEqual(sym1?.resourceId, "/mapped/sources/Modelica/Electrical/Analog/Basic/Resistor.mo");

  const resistorIds = unified.byName.get("Resistor");
  assert.deepStrictEqual(resistorIds, [1], "byName lookup for Resistor should return [1]");

  const rootChildren = unified.childrenOf.get(null);
  assert.deepStrictEqual(rootChildren, [1, 2], "childrenOf(null) should contain [1, 2]");

  // Test incremental hydration merging
  const mockEntry3: SymbolEntry = {
    id: 3,
    name: "Inductor",
    kind: "Class",
    ruleName: "class_definition",
    parentId: null,
    startByte: 0,
    endByte: 150,
    exports: [],
    inherits: [],
    metadata: { classKind: "model" },
    fieldName: null,
    resourceId: "sources/Modelica/Electrical/Analog/Basic/Inductor.mo",
  };

  index.hydrate("library-bundle:/Addon@1.0.0", {
    symbols: new Map([[3, mockEntry3]]),
    byName: new Map([["Inductor", [3]]]),
    childrenOf: new Map([[null, [3]]]),
  });

  const merged = index.toUnified();
  assert.strictEqual(merged.symbols.size, 3, "Should have 3 symbols after incremental hydration");
  assert.ok(merged.symbols.has(3));
  assert.deepStrictEqual(merged.childrenOf.get(null), [1, 2, 3], "Root children should be merged");

  // Test collision resistance: hydrate a package with raw IDs [1, 2] (same as first bundle)
  const mockEntryColliding1: SymbolEntry = {
    id: 1,
    name: "Diode",
    kind: "Class",
    ruleName: "class_definition",
    parentId: null,
    startByte: 0,
    endByte: 110,
    exports: [],
    inherits: [],
    metadata: { classKind: "model" },
    fieldName: null,
    resourceId: "sources/Modelica/Electrical/Analog/Basic/Diode.mo",
  };
  const mockEntryCollidingChild: SymbolEntry = {
    id: 2,
    name: "v",
    kind: "Component",
    ruleName: "component_declaration",
    parentId: 1,
    startByte: 10,
    endByte: 20,
    exports: [],
    inherits: [],
    metadata: {},
    fieldName: null,
    resourceId: "sources/Modelica/Electrical/Analog/Basic/Diode.mo",
  };

  index.hydrate("library-bundle:/CollisionPkg@1.0.0", {
    symbols: new Map([
      [1, mockEntryColliding1],
      [2, mockEntryCollidingChild],
    ]),
    byName: new Map([
      ["Diode", [1]],
      ["v", [2]],
    ]),
    childrenOf: new Map([
      [null, [1]],
      [1, [2]],
    ]),
  });

  const finalMerged = index.toUnified();
  assert.strictEqual(finalMerged.symbols.size, 5, "Should have 5 symbols total with no overwrites");
  // Original symbols still intact
  assert.strictEqual(finalMerged.symbols.get(1)?.name, "Resistor");
  assert.strictEqual(finalMerged.symbols.get(2)?.name, "Capacitor");
  assert.strictEqual(finalMerged.symbols.get(3)?.name, "Inductor");
  // New symbols remapped to 4 and 5
  assert.strictEqual(finalMerged.symbols.get(4)?.name, "Diode");
  assert.strictEqual(finalMerged.symbols.get(5)?.name, "v");
  assert.strictEqual(finalMerged.symbols.get(5)?.parentId, 4, "Child's parentId should be remapped to 4");
  assert.deepStrictEqual(finalMerged.childrenOf.get(4), [5], "Children of Diode (4) should be [5]");
  assert.deepStrictEqual(finalMerged.byName.get("Diode"), [4]);
  assert.deepStrictEqual(finalMerged.byName.get("v"), [5]);

  console.log("✓ LanguageWorkspaceIndex.hydrate tests passed successfully");
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
