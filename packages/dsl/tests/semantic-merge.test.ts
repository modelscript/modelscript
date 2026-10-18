// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { describe, it } from "node:test";
import type { QueryDB, SpecializationArgs, SymbolEntry, SymbolId } from "../src/dsl/types.js";
import { computeThreeWayMerge, mergeModelSourceText } from "../src/tools/semantic-merge.js";

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
  startByte = 0,
  endByte = 10,
): SymbolEntry {
  return {
    id,
    kind,
    name,
    ruleName: "mock_rule",
    namePath: "name",
    startByte,
    endByte,
    parentId,
    exports: [],
    inherits: [],
    metadata,
    fieldName: null,
  };
}

describe("3-Way Semantic AST/CST Merge Engine", () => {
  it("cleanly merges disjoint child insertions from ours and theirs", () => {
    const baseText = ["model Circuit", "  Resistor R1(R = 10.0);", "end Circuit;"].join("\n");
    const oursText = ["model Circuit", "  Resistor R1(R = 10.0);", "  Capacitor C1(C = 0.01);", "end Circuit;"].join(
      "\n",
    );
    const theirsText = ["model Circuit", "  Resistor R1(R = 10.0);", "  Inductor L1(L = 0.5);", "end Circuit;"].join(
      "\n",
    );

    const baseDb = createMockDB([
      makeEntry(1, "Model", "Circuit", null, {}, 0, baseText.length),
      makeEntry(
        2,
        "Component",
        "R1",
        1,
        { binding: 10.0 },
        baseText.indexOf("Resistor R1"),
        baseText.indexOf("R1(R = 10.0);") + "R1(R = 10.0);".length,
      ),
    ]);
    const oursDb = createMockDB([
      makeEntry(1, "Model", "Circuit", null, {}, 0, oursText.length),
      makeEntry(
        2,
        "Component",
        "R1",
        1,
        { binding: 10.0 },
        oursText.indexOf("Resistor R1"),
        oursText.indexOf("R1(R = 10.0);") + "R1(R = 10.0);".length,
      ),
      makeEntry(
        3,
        "Component",
        "C1",
        1,
        { binding: 0.01 },
        oursText.indexOf("Capacitor C1"),
        oursText.indexOf("C1(C = 0.01);") + "C1(C = 0.01);".length,
      ),
    ]);
    const theirsDb = createMockDB([
      makeEntry(1, "Model", "Circuit", null, {}, 0, theirsText.length),
      makeEntry(
        2,
        "Component",
        "R1",
        1,
        { binding: 10.0 },
        theirsText.indexOf("Resistor R1"),
        theirsText.indexOf("R1(R = 10.0);") + "R1(R = 10.0);".length,
      ),
      makeEntry(
        4,
        "Component",
        "L1",
        1,
        { binding: 0.5 },
        theirsText.indexOf("Inductor L1"),
        theirsText.indexOf("L1(L = 0.5);") + "L1(L = 0.5);".length,
      ),
    ]);

    const res = computeThreeWayMerge({ id: 1, db: baseDb }, { id: 1, db: oursDb }, { id: 1, db: theirsDb });

    assert.strictEqual(res.status, "clean");
    assert.strictEqual(res.hasConflicts, false);

    const srcMerge = mergeModelSourceText(baseText, oursText, theirsText, res);
    assert.strictEqual(srcMerge.hasConflicts, false);
    assert.ok(srcMerge.mergedText.includes("Capacitor C1(C = 0.01);"));
    assert.ok(srcMerge.mergedText.includes("Inductor L1(L = 0.5);"));
    assert.ok(srcMerge.mergedText.trim().endsWith("end Circuit;"));
  });

  it("detects value conflict under strict strategy and reconciles under physics-simplex strategy", () => {
    const baseText = "model Battery\n  parameter Real V_bus = 12.0;\nend Battery;";
    const oursText = "model Battery\n  parameter Real V_bus = 24.0;\nend Battery;";
    const theirsText = "model Battery\n  parameter Real V_bus = 36.0;\nend Battery;";

    const makeTree = (txt: string, val: number) =>
      createMockDB([
        makeEntry(1, "Model", "Battery", null, {}, 0, txt.length),
        makeEntry(
          2,
          "Component",
          "V_bus",
          1,
          { variability: "parameter", typeName: "Real", binding: val },
          txt.indexOf("parameter Real"),
          txt.indexOf(";\nend") + 1,
        ),
      ]);

    const baseDb = makeTree(baseText, 12.0);
    const oursDb = makeTree(oursText, 24.0);
    const theirsDb = makeTree(theirsText, 36.0);

    // 1. Strict strategy -> conflict
    const strictRes = computeThreeWayMerge(
      { id: 1, db: baseDb },
      { id: 1, db: oursDb },
      { id: 1, db: theirsDb },
      { strategy: "strict" },
    );
    assert.strictEqual(strictRes.status, "conflicted");
    assert.strictEqual(strictRes.conflicts.length, 1);
    assert.strictEqual(strictRes.conflicts[0]!.kind, "value-conflict");
    assert.strictEqual(strictRes.conflicts[0]!.symbolName, "V_bus");

    const strictSrc = mergeModelSourceText(baseText, oursText, theirsText, strictRes);
    assert.ok(strictSrc.mergedText.includes("<<<<<<< OURS"));
    assert.ok(strictSrc.mergedText.includes(">>>>>>> THEIRS"));

    // 2. Physics-Simplex strategy -> reconciled to 30.0 within [10, 48]
    const simplexRes = computeThreeWayMerge(
      { id: 1, db: baseDb },
      { id: 1, db: oursDb },
      { id: 1, db: theirsDb },
      {
        strategy: "physics-simplex",
        parameterBounds: { V_bus: { min: 10.0, max: 48.0, unit: "V" } },
      },
    );
    assert.strictEqual(simplexRes.status, "reconciled");
    assert.strictEqual(simplexRes.hasConflicts, false);

    const simplexSrc = mergeModelSourceText(baseText, oursText, theirsText, simplexRes);
    assert.strictEqual(simplexSrc.hasConflicts, false);
    assert.ok(simplexSrc.mergedText.includes("parameter Real V_bus = 30;"));
  });

  it("flags delete-modify conflicts when one branch deletes a modified component", () => {
    const baseDb = createMockDB([
      makeEntry(1, "Model", "Drive"),
      makeEntry(2, "Component", "Controller", 1, { binding: 1.0 }),
    ]);
    const oursDb = createMockDB([
      makeEntry(1, "Model", "Drive"),
      // Controller deleted in ours
    ]);
    const theirsDb = createMockDB([
      makeEntry(1, "Model", "Drive"),
      makeEntry(2, "Component", "Controller", 1, { binding: 2.5 }),
    ]);

    const res = computeThreeWayMerge(
      { id: 1, db: baseDb },
      { id: 1, db: oursDb },
      { id: 1, db: theirsDb },
      { strategy: "strict" },
    );
    assert.strictEqual(res.status, "conflicted");
    assert.strictEqual(res.conflicts.length, 1);
    assert.strictEqual(res.conflicts[0]!.kind, "delete-modify");
    assert.strictEqual(res.conflicts[0]!.symbolName, "Controller");
  });
});
