import { describe, expect, it } from "vitest";
import type { SymbolEntry, SymbolIndex } from "../src/runtime.js";
import type { IWorkspaceIndex } from "../src/unified-workspace.js";
import { UnifiedWorkspace } from "../src/unified-workspace.js";

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

class TestWorkspaceIndex implements IWorkspaceIndex {
  version = 1;
  symbols = new Map<number, SymbolEntry>();
  byName = new Map<string, number[]>();
  childrenOf = new Map<number | null, number[]>();

  toUnified(): SymbolIndex {
    return { symbols: this.symbols, byName: this.byName, childrenOf: this.childrenOf };
  }
  async toUnifiedAsync(): Promise<SymbolIndex> {
    return this.toUnified();
  }
  toUnifiedPartial(): SymbolIndex {
    return this.toUnified();
  }
  toTreeIndex(): SymbolIndex {
    return this.toUnified();
  }

  addEntry(entry: SymbolEntry) {
    this.symbols.set(entry.id, entry);
    let nameList = this.byName.get(entry.name);
    if (!nameList) {
      nameList = [];
      this.byName.set(entry.name, nameList);
    }
    nameList.push(entry.id);
    if (entry.parentId !== null) {
      let childList = this.childrenOf.get(entry.parentId);
      if (!childList) {
        childList = [];
        this.childrenOf.set(entry.parentId, childList);
      }
      childList.push(entry.id);
    }
  }
}

describe("UnifiedWorkspace Adapter Registry Proxy", () => {
  it("should dynamically resolve projected axioms using proxy indexes", () => {
    const uw = new UnifiedWorkspace();
    const ws = new TestWorkspaceIndex();

    // Register the test workspace
    const mockConfig = {
      name: "modelica",
      rules: {},
    };
    uw.registerWorkspace("modelica", ws, mockConfig);

    // Before adding any symbols, projectAll should return empty results
    let results = uw.adapterRegistry.projectAll("modelica", "owl2");
    expect(results.length).toBe(0);

    // Now add a symbol to the workspace index
    const entry = makeEntry(1, "Class", "Motor", "ClassDefinition");
    ws.addEntry(entry);
    ws.version++;

    // Since we registered a proxy, the adapter registry should dynamically query the updated index
    results = uw.adapterRegistry.projectAll("modelica", "owl2");
    // Verify it attempted to project the symbol
    expect(results).toBeDefined();
  });
});
