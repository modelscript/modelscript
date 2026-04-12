/* eslint-disable */
import { describe, expect, it } from "vitest";
import type { IndexerHook } from "../src/runtime.js";
import type { CSTNode } from "../src/symbol-indexer.js";
import { WorkspaceIndex } from "../src/workspace-index.js";

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
): CSTNode {
  return {
    type,
    text,
    startByte,
    endByte,
    children,
    childForFieldName(name: string) {
      return fields[name] ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const hooks: IndexerHook[] = [
  {
    ruleName: "class_def",
    kind: "Class",
    namePath: "name",
    exportPaths: ["body"],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkspaceIndex", () => {
  it("registers and lazily indexes files", () => {
    const workspace = new WorkspaceIndex(hooks);
    let indexed = false;

    workspace.register("file:///a.mo", () => {
      indexed = true;
      return mockNode("file", "", 0, 100, [
        mockNode("class_def", "class A end A;", 0, 100, [], {
          name: mockNode("name", "A", 6, 7),
        }),
      ]);
    });

    // Not yet indexed
    expect(indexed).toBe(false);

    // Access triggers indexing
    const index = workspace.getFileIndex("file:///a.mo");
    expect(indexed).toBe(true);
    expect(index).not.toBeNull();
    expect(index!.symbols.size).toBe(1);
  });

  it("cross-file byName lookup", () => {
    const workspace = new WorkspaceIndex(hooks);

    workspace.register("file:///a.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", "class A end A;", 0, 100, [], {
          name: mockNode("name", "Resistor", 6, 14),
        }),
      ]),
    );

    workspace.register("file:///b.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", "class Capacitor end Capacitor;", 0, 100, [], {
          name: mockNode("name", "Capacitor", 6, 15),
        }),
      ]),
    );

    const resistors = workspace.byName("Resistor");
    expect(resistors.length).toBe(1);
    expect(resistors[0].name).toBe("Resistor");

    const capacitors = workspace.byName("Capacitor");
    expect(capacitors.length).toBe(1);
    expect(capacitors[0].name).toBe("Capacitor");

    const unknowns = workspace.byName("Unknown");
    expect(unknowns.length).toBe(0);
  });

  it("markDirty triggers re-index on next access", () => {
    const workspace = new WorkspaceIndex(hooks);
    let version = 1;

    workspace.register("file:///a.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", `class V${version} end V${version};`, 0, 100, [], {
          name: mockNode("name", `V${version}`, 6, 8),
        }),
      ]),
    );

    // First index
    let index = workspace.getFileIndex("file:///a.mo")!;
    expect([...index.symbols.values()][0].name).toBe("V1");

    // Bump version and mark dirty
    version = 2;
    workspace.markDirty("file:///a.mo");
    index = workspace.getFileIndex("file:///a.mo")!;
    expect([...index.symbols.values()][0].name).toBe("V2");
  });

  it("unified view merges all files", () => {
    const workspace = new WorkspaceIndex(hooks);

    workspace.register("file:///a.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", "class A end A;", 0, 100, [], {
          name: mockNode("name", "A", 6, 7),
        }),
      ]),
    );

    workspace.register("file:///b.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", "class B end B;", 0, 100, [], {
          name: mockNode("name", "B", 6, 7),
        }),
      ]),
    );

    const unified = workspace.toUnified();
    expect(unified.symbols.size).toBe(2);
    expect(unified.byName.get("A")).toBeDefined();
    expect(unified.byName.get("B")).toBeDefined();
  });

  it("remove() removes a file from the workspace", () => {
    const workspace = new WorkspaceIndex(hooks);

    workspace.register("file:///a.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", "class A end A;", 0, 100, [], {
          name: mockNode("name", "A", 6, 7),
        }),
      ]),
    );

    expect(workspace.has("file:///a.mo")).toBe(true);
    workspace.remove("file:///a.mo");
    expect(workspace.has("file:///a.mo")).toBe(false);
    expect(workspace.toUnified().symbols.size).toBe(0);
  });

  it("unified view is cached until dirty", () => {
    const workspace = new WorkspaceIndex(hooks);

    workspace.register("file:///a.mo", () =>
      mockNode("file", "", 0, 100, [
        mockNode("class_def", "class A end A;", 0, 100, [], {
          name: mockNode("name", "A", 6, 7),
        }),
      ]),
    );

    const u1 = workspace.toUnified();
    const u2 = workspace.toUnified();
    expect(u1).toBe(u2); // Same reference — cached

    workspace.markDirty("file:///a.mo");
    const u3 = workspace.toUnified();
    expect(u3).not.toBe(u1); // Different — cache invalidated
  });
});
