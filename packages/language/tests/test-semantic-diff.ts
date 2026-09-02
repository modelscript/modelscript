// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import assert from "node:assert";
import { computeSemanticDiff } from "../src/compiler/semantic-diff.js";
import type { QueryDB, SpecializationArgs, SymbolEntry, SymbolId } from "../src/runtime/runtime.js";

function createMockDB(entries: SymbolEntry[]): QueryDB {
  const map = new Map<SymbolId, SymbolEntry>();
  const childrenMap = new Map<SymbolId | null, SymbolEntry[]>();

  for (const e of entries) {
    map.set(e.id, e);
    const p = e.parentId;
    if (!childrenMap.has(p)) {
      childrenMap.set(p, []);
    }
    childrenMap.get(p)!.push(e);
  }

  return {
    symbol(id: SymbolId) {
      return map.get(id) ?? null;
    },
    childrenOf(id: SymbolId) {
      return childrenMap.get(id) ?? [];
    },
    query<T>(_name: string, _id: SymbolId): T {
      throw new Error("Not implemented");
    },
    specialize<T>(_id: SymbolId, _args: SpecializationArgs<T>): SymbolId {
      throw new Error("Not implemented");
    },
    argsOf(_id: SymbolId) {
      return null;
    },
    baseOf(_id: SymbolId) {
      return null;
    },
    resolveRef(_ruleName: string, _id: SymbolId): SymbolId | null {
      return null;
    },
    cstNode(_id: SymbolId) {
      return null;
    },
    cstNodeRange(_start: number, _end: number) {
      return null;
    },
    evaluate(_expr: unknown) {
      return null;
    },
    flushVolatile() {},
  };
}

function makeEntry(
  id: SymbolId,
  kind: string,
  name: string,
  parentId: SymbolId | null = null,
  metadata: Record<string, unknown> = {},
): SymbolEntry {
  return {
    id,
    kind,
    name,
    ruleName: "mock_rule",
    namePath: "name",
    startByte: 0,
    endByte: 10,
    parentId,
    exports: [],
    inherits: [],
    metadata,
    fieldName: null,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

console.log("Running SemanticDiff tests...");

// Test 1: Both null throws
assert.throws(() => {
  computeSemanticDiff(null, null);
}, /Both oldNode and newNode cannot be null/);

// Test 2: Pure insert
{
  const db = createMockDB([makeEntry(1, "Class", "Resistor")]);
  const diff = computeSemanticDiff(null, { id: 1, db });
  assert.strictEqual(diff.action, "insert");
  assert.strictEqual(diff.newEntry?.name, "Resistor");
  assert.strictEqual(diff.description, "Inserted Class 'Resistor'");
}

// Test 3: Pure delete
{
  const db = createMockDB([makeEntry(1, "Class", "Capacitor")]);
  const diff = computeSemanticDiff({ id: 1, db }, null);
  assert.strictEqual(diff.action, "delete");
  assert.strictEqual(diff.oldEntry?.name, "Capacitor");
  assert.strictEqual(diff.description, "Deleted Class 'Capacitor'");
}

// Test 4: Unchanged node
{
  const oldDb = createMockDB([makeEntry(1, "Class", "Resistor", null, { variability: "parameter" })]);
  const newDb = createMockDB([makeEntry(1, "Class", "Resistor", null, { variability: "parameter" })]);
  const diff = computeSemanticDiff({ id: 1, db: oldDb }, { id: 1, db: newDb });
  assert.strictEqual(diff.action, "none");
}

// Test 5: Metadata update
{
  const oldDb = createMockDB([makeEntry(1, "Class", "Resistor", null, { variability: "discrete" })]);
  const newDb = createMockDB([makeEntry(1, "Class", "Resistor", null, { variability: "continuous" })]);
  const diff = computeSemanticDiff({ id: 1, db: oldDb }, { id: 1, db: newDb });
  assert.strictEqual(diff.action, "update");
  assert.strictEqual(diff.description, "Metadata updated");
}

// Test 6: Replacement (kind change)
{
  const oldDb = createMockDB([makeEntry(1, "Class", "Resistor")]);
  const newDb = createMockDB([makeEntry(1, "Package", "Resistor")]);
  const diff = computeSemanticDiff({ id: 1, db: oldDb }, { id: 1, db: newDb });
  assert.strictEqual(diff.action, "update");
  assert.strictEqual(diff.description, "Replaced Class with Package");
}

// Test 7: Nested child addition (order agnostic)
{
  const oldDb = createMockDB([makeEntry(1, "Class", "Circuit"), makeEntry(2, "Component", "R1", 1)]);
  const newDb = createMockDB([
    makeEntry(1, "Class", "Circuit"),
    makeEntry(2, "Component", "R1", 1),
    makeEntry(3, "Component", "R2", 1),
  ]);

  const diff = computeSemanticDiff({ id: 1, db: oldDb }, { id: 1, db: newDb }, { orderAgnostic: true });
  assert.strictEqual(diff.action, "update");
  assert.ok(diff.children);
  assert.strictEqual(diff.children.length, 1);
  assert.strictEqual(diff.children[0]!.action, "insert");
  assert.strictEqual(diff.children[0]!.newEntry?.name, "R2");
}

// Test 8: Nested child deletion (order agnostic)
{
  const oldDb = createMockDB([
    makeEntry(1, "Class", "Circuit"),
    makeEntry(2, "Component", "R1", 1),
    makeEntry(3, "Component", "R2", 1),
  ]);
  const newDb = createMockDB([makeEntry(1, "Class", "Circuit"), makeEntry(2, "Component", "R1", 1)]);

  const diff = computeSemanticDiff({ id: 1, db: oldDb }, { id: 1, db: newDb }, { orderAgnostic: true });
  assert.strictEqual(diff.action, "update");
  assert.ok(diff.children);
  assert.strictEqual(diff.children.length, 1);
  assert.strictEqual(diff.children[0]!.action, "delete");
  assert.strictEqual(diff.children[0]!.oldEntry?.name, "R2");
}

console.log("All 8 SemanticDiff tests passed successfully!");
