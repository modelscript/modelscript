/* eslint-disable */
import { describe, expect, it } from "vitest";
import { QueryEngine } from "../src/query-engine.js";
import type { QueryHooks, SpecializationArgs, SymbolEntry, SymbolIndex } from "../src/runtime.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: number,
  kind: string,
  name: string,
  ruleName: string,
  parentId: number | null = null,
  metadata: Record<string, unknown> = {},
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
    exports: [],
    inherits: [],
    metadata,
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

function args<T>(data: T, hash: string): SpecializationArgs<T> {
  return { data, hash };
}

// ---------------------------------------------------------------------------
// Tests: SymbolEntry Metadata
// ---------------------------------------------------------------------------

describe("SymbolEntry metadata", () => {
  it("passes metadata through to query access", () => {
    const hooks: QueryHooks = {
      getClassKind: (_db, self) => self.metadata.classKind,
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def", null, { classKind: "model" })];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("getClassKind", 1)).toBe("model");
  });
});

// ---------------------------------------------------------------------------
// Tests: db.byName()
// ---------------------------------------------------------------------------

describe("QueryDB.byName", () => {
  it("returns all entries with a given name", () => {
    const hooks: QueryHooks = {
      findByName: (db, _self) => db.byName("Foo").map((e) => e.id),
    };

    const entries = [
      makeEntry(1, "Class", "Foo", "class_def"),
      makeEntry(2, "Class", "Foo", "class_def"),
      makeEntry(3, "Class", "Bar", "class_def"),
    ];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    const result = engine.query<number[]>("findByName", 1);
    expect(result).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// Tests: Specialization
// ---------------------------------------------------------------------------

describe("QueryDB.specialize", () => {
  it("creates a virtual entry with a negative ID", () => {
    const hooks: QueryHooks = {
      testSpecialize: (db, self) => {
        const virtualId = db.specialize(self.id, args({ R: 100 }, "R=100"));
        return virtualId;
      },
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    const virtualId = engine.query<number>("testSpecialize", 1);
    expect(virtualId).toBeLessThan(0);
  });

  it("memoizes: same base + same hash = same ID", () => {
    const hooks: QueryHooks = {
      specTwice: (db, self) => {
        const a = db.specialize(self.id, args({ R: 100 }, "R=100"));
        const b = db.specialize(self.id, args({ R: 100 }, "R=100"));
        return [a, b];
      },
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    const [a, b] = engine.query<number[]>("specTwice", 1);
    expect(a).toBe(b);
  });

  it("different args produce different IDs", () => {
    const hooks: QueryHooks = {
      specDiff: (db, self) => {
        const a = db.specialize(self.id, args({ R: 100 }, "R=100"));
        const b = db.specialize(self.id, args({ R: 200 }, "R=200"));
        return [a, b];
      },
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    const [a, b] = engine.query<number[]>("specDiff", 1);
    expect(a).not.toBe(b);
  });

  it("virtual entries are queryable via db.symbol()", () => {
    const hooks: QueryHooks = {
      specAndRead: (db, self) => {
        const virtualId = db.specialize(self.id, args({ R: 100 }, "R=100"));
        const entry = db.symbol(virtualId);
        return entry?.name;
      },
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("specAndRead", 1)).toBe("Resistor");
  });

  it("argsOf returns the specialization args", () => {
    const hooks: QueryHooks = {
      specArgs: (db, self) => {
        const virtualId = db.specialize(self.id, args({ R: 100 }, "R=100"));
        const a = db.argsOf<{ R: number }>(virtualId);
        return a?.data?.R;
      },
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("specArgs", 1)).toBe(100);
  });

  it("argsOf returns null for non-specialized entries", () => {
    const hooks: QueryHooks = {
      checkArgs: (db, self) => db.argsOf(self.id),
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("checkArgs", 1)).toBeNull();
  });

  it("baseOf returns the original base symbol ID", () => {
    const hooks: QueryHooks = {
      specBase: (db, self) => {
        const virtualId = db.specialize(self.id, args({}, "empty"));
        return db.baseOf(virtualId);
      },
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("specBase", 1)).toBe(1);
  });

  it("baseOf returns null for non-specialized entries", () => {
    const hooks: QueryHooks = {
      checkBase: (db, self) => db.baseOf(self.id),
    };

    const entries = [makeEntry(1, "Class", "Resistor", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("checkBase", 1)).toBeNull();
  });

  it("queries run on virtual entries using the base rule's hooks", () => {
    const hooks: QueryHooks = {
      getName: (_db, self) => `name=${self.name}`,
      specAndQuery: (db, self) => {
        const virtualId = db.specialize(self.id, args({}, "v1"));
        return db.query<string>("getName", virtualId);
      },
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(engine.query("specAndQuery", 1)).toBe("name=Foo");
  });

  it("chained specialization works (specialize of specialize)", () => {
    const hooks: QueryHooks = {
      chain: (db, self) => {
        const v1 = db.specialize(self.id, args({ a: 1 }, "a"));
        const v2 = db.specialize(v1, args({ b: 2 }, "b"));
        return {
          v2Base: db.baseOf(v2),
          v1Base: db.baseOf(v1),
        };
      },
    };

    const entries = [makeEntry(1, "Class", "X", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    const result = engine.query<{ v2Base: number; v1Base: number }>("chain", 1);
    expect(result.v1Base).toBe(1); // v1's base is the real entry
    expect(result.v2Base).toBeLessThan(0); // v2's base is v1 (virtual)
  });

  it("invalidation clears virtual entries when base changes", () => {
    let specId: number | null = null;
    const hooks: QueryHooks = {
      doSpec: (db, self) => {
        specId = db.specialize(self.id, args({}, "v"));
        return specId;
      },
      readSpec: (db, _self) => {
        if (specId === null) return null;
        return db.symbol(specId);
      },
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    engine.query("doSpec", 1);
    expect(specId).toBeLessThan(0);

    // Invalidate the base
    engine.invalidate(new Set([1]));

    // The virtual entry should be gone
    const result = engine.query("readSpec", 1);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: Expression Evaluation
// ---------------------------------------------------------------------------

describe("QueryDB.evaluate", () => {
  it("calls the configured evaluator", () => {
    const hooks: QueryHooks = {
      evalTest: (db, _self) => db.evaluate("2 + 3", null),
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]), {
      evaluator: (expr, _scope, _db) => {
        if (expr === "2 + 3") return 5;
        return null;
      },
    });

    expect(engine.query("evalTest", 1)).toBe(5);
  });

  it("throws if no evaluator configured", () => {
    const hooks: QueryHooks = {
      evalFail: (db, _self) => db.evaluate("x", null),
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]));

    expect(() => engine.query("evalFail", 1)).toThrow(/No expression evaluator/);
  });

  it("evaluator receives scope entry when scopeId provided", () => {
    let receivedScope: SymbolEntry | null = null;

    const hooks: QueryHooks = {
      evalScoped: (db, self) => db.evaluate("expr", self.id),
    };

    const entries = [makeEntry(1, "Class", "Foo", "class_def")];
    const index = makeIndex(entries);
    const engine = new QueryEngine(index, new Map([["class_def", hooks]]), {
      evaluator: (_expr, scope, _db) => {
        receivedScope = scope;
        return "ok";
      },
    });

    engine.query("evalScoped", 1);
    expect(receivedScope).not.toBeNull();
    expect(receivedScope!.name).toBe("Foo");
  });
});
