/* eslint-disable */
import { describe, expect, it } from "vitest";
import type { IndexerHook } from "../src/runtime.js";
import { CSTNode, SymbolIndexer } from "../src/symbol-indexer.js";

// ---------------------------------------------------------------------------
// Mock CST Node builder
// ---------------------------------------------------------------------------

function mockNode(
  type: string,
  text: string,
  startByte: number,
  endByte: number,
  children: CSTNode[] = [],
  fields: Record<string, CSTNode> = {},
  hasChanges?: boolean,
): CSTNode {
  return {
    type,
    text,
    startByte,
    endByte,
    children,
    hasChanges,
    childForFieldName(name: string) {
      return fields[name] ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SymbolIndexer", () => {
  const hooks: IndexerHook[] = [
    {
      ruleName: "class_def",
      kind: "Class",
      namePath: "name",
      exportPaths: ["body"],
      inheritPaths: [],
      metadataFieldPaths: {},
    },
    {
      ruleName: "func_def",
      kind: "Function",
      namePath: "name",
      exportPaths: [],
      inheritPaths: [],
      metadataFieldPaths: {},
    },
  ];

  it("indexes a simple tree with nested classes", () => {
    const tree = mockNode("file", "", 0, 200, [
      mockNode("class_def", "class Foo end Foo;", 0, 100, [], {
        name: mockNode("name", "Foo", 6, 9),
      }),
      mockNode("func_def", "function bar end bar;", 100, 200, [], {
        name: mockNode("name", "bar", 109, 112),
      }),
    ]);

    const indexer = new SymbolIndexer(hooks);
    const index = indexer.index(tree);

    expect(index.symbols.size).toBe(2);
    expect(index.byName.get("Foo")?.length).toBe(1);
    expect(index.byName.get("bar")?.length).toBe(1);

    const fooEntry = [...index.symbols.values()].find((e) => e.name === "Foo")!;
    expect(fooEntry.kind).toBe("Class");
    expect(fooEntry.parentId).toBeNull();

    const barEntry = [...index.symbols.values()].find((e) => e.name === "bar")!;
    expect(barEntry.kind).toBe("Function");
  });

  it("sets parentId for nested definitions", () => {
    const innerFunc = mockNode("func_def", "function baz end baz;", 50, 80, [], {
      name: mockNode("name", "baz", 59, 62),
    });
    const outerClass = mockNode("class_def", "class Foo ... end Foo;", 0, 100, [innerFunc], {
      name: mockNode("name", "Foo", 6, 9),
    });
    const tree = mockNode("file", "", 0, 100, [outerClass]);

    const indexer = new SymbolIndexer(hooks);
    const index = indexer.index(tree);

    expect(index.symbols.size).toBe(2);
    const bazEntry = [...index.symbols.values()].find((e) => e.name === "baz")!;
    const fooEntry = [...index.symbols.values()].find((e) => e.name === "Foo")!;
    expect(bazEntry.parentId).toBe(fooEntry.id);
  });

  it("incremental update detects changes", () => {
    const tree1 = mockNode("file", "", 0, 200, [
      mockNode("class_def", "class Foo end Foo;", 0, 100, [], {
        name: mockNode("name", "Foo", 6, 9),
      }),
    ]);

    const indexer = new SymbolIndexer(hooks);
    const index1 = indexer.index(tree1);

    // Rename Foo → Bar
    const tree2 = mockNode(
      "file",
      "",
      0,
      200,
      [
        mockNode(
          "class_def",
          "class Bar end Bar;",
          0,
          100,
          [],
          {
            name: mockNode("name", "Bar", 6, 9),
          },
          true,
        ),
      ],
      {},
      true,
    );

    const { index: index2, changedIds } = indexer.update(index1, tree2, [{ startByte: 6, endByte: 9 }]);

    expect(index2.symbols.size).toBe(1);
    expect(changedIds.size).toBeGreaterThan(0);
    const entry = [...index2.symbols.values()][0];
    expect(entry.name).toBe("Bar");
  });
});
