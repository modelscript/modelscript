import { describe, expect, it } from "vitest";
import type { QueryDB, SymbolEntry } from "../src/runtime.js";
import { computeSemanticDiff } from "../src/semantic-diff.js";
import { GenericNode, NodeFactory } from "../src/semantic-node.js";

function mockEntry(id: number, name: string, kind = "Class", metadata: unknown = {}): SymbolEntry {
  return {
    id,
    name,
    kind,
    ruleName: "mock_rule",
    startByte: 0,
    endByte: 10,
    namePath: name,
    parentId: null,
    exports: [],
    inherits: [],
    metadata,
    fieldName: null,
  };
}

function mockDb(childrenMap: Map<number, SymbolEntry[]>): QueryDB {
  return {
    childrenOf: (id: number) => childrenMap.get(id) || [],
    symbol: () => undefined,
    parentOf: () => undefined,
    exportsOf: () => [],
    byName: () => [],
    allEntries: () => [],
    query: () => null,
    queryWith: () => null,
    specialize: () => -1,
    argsOf: () => null,
    baseOf: () => null,
    evaluate: () => null,
    cstText: () => null,
    cstNode: () => null,
    childrenOfField: () => [],
  } as unknown as QueryDB;
}

const factory: NodeFactory = (entry, db) => new GenericNode(entry, db);

describe("computeSemanticDiff", () => {
  it("detects no changes for identical trees", () => {
    const entry = mockEntry(1, "Foo", "Class");
    const db = mockDb(new Map([[1, []]]));

    const oldNode = factory(entry, db);
    const newNode = factory(entry, db);

    const diff = computeSemanticDiff(oldNode, newNode, { nodeFactory: factory });
    expect(diff.action).toBe("none");
  });

  it("detects metadata update", () => {
    const e1 = mockEntry(1, "Foo", "Class", { val: 1 });
    const e2 = mockEntry(2, "Foo", "Class", { val: 2 });
    const db = mockDb(
      new Map([
        [1, []],
        [2, []],
      ]),
    );

    const oldNode = factory(e1, db);
    const newNode = factory(e2, db);

    const diff = computeSemanticDiff(oldNode, newNode, { nodeFactory: factory });
    expect(diff.action).toBe("update");
    expect(diff.description).toContain("Metadata");
  });

  it("detects child insertion", () => {
    const parent1 = mockEntry(1, "Parent");
    const parent2 = mockEntry(2, "Parent");
    const child = mockEntry(3, "Child");

    const db = mockDb(
      new Map([
        [1, []],
        [2, [child]],
        [3, []],
      ]),
    );

    const oldNode = factory(parent1, db);
    const newNode = factory(parent2, db);

    const diff = computeSemanticDiff(oldNode, newNode, { nodeFactory: factory });
    expect(diff.action).toBe("update");
    const children = diff.children as SemanticEdit[];
    expect(children[0].action).toBe("insert");
    const newNode = children[0].newNode as GenericNode;
    expect(newNode.entry.name).toBe("Child");
  });

  it("handles order-agnostic child changes (swaps are none)", () => {
    const parent1 = mockEntry(1, "Parent");
    const parent2 = mockEntry(2, "Parent");
    const cA = mockEntry(3, "A");
    const cB = mockEntry(4, "B");

    const db = mockDb(
      new Map([
        [1, [cA, cB]],
        [2, [cB, cA]],
        [3, []],
        [4, []],
      ]),
    );

    const oldNode = factory(parent1, db);
    const newNode = factory(parent2, db);

    const diff = computeSemanticDiff(oldNode, newNode, { nodeFactory: factory, orderAgnostic: true });
    // Because cA and cB are exactly matched, and no children are fundamentally added/removed,
    // the diff should ideally say action: "none". However, we might see updates if not correctly rolled up.
    // In our current implementation, it may still say "none" if we don't register position changes.
    expect(diff.action).toBe("none");
  });
});
