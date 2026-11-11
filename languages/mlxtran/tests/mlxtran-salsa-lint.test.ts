// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryEngine, type SymbolEntry, type SymbolId, type SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseMlxtran } from "../src/parser/mlxtran-parser.js";
import { mlxtranQueryHooks } from "../src/queries.js";

describe("MLXTRAN Salsa Incremental Query & Lint Engine", () => {
  function createMockIndex(symbolsList: SymbolEntry[]): SymbolIndex {
    const symbols = new Map<SymbolId, SymbolEntry>();
    const byName = new Map<string, SymbolId[]>();
    const childrenOf = new Map<SymbolId | null, SymbolId[]>();

    for (const s of symbolsList) {
      symbols.set(s.id, s);
      const list = byName.get(s.name) || [];
      list.push(s.id);
      byName.set(s.name, list);

      const parentKey = s.parentId ?? null;
      const ch = childrenOf.get(parentKey) || [];
      ch.push(s.id);
      childrenOf.set(parentKey, ch);
    }

    return {
      symbols,
      byName,
      childrenOf,
    } as any;
  }

  const validSource = `[LONGITUDINAL]
input = {V, Cl, ka}
EQUATION:
ddt_Ad = -ka * Ad
ddt_Ac = ka * Ad - (Cl / V) * Ac
OUTPUT:
output = {Ac}
`;

  const invalidSource = `input = {V = {init = -5}, Cl, ka}
EQUATION:
ddt_Ad = -ka * Ad
ddt_Ad = -ka * 2 * Ad
OUTPUT:
output = {Ad}
`;

  it("evaluates Salsa incremental query hooks and memoizes results", () => {
    const validDoc = parseMlxtran(validSource);
    const symValid: SymbolEntry = {
      id: 1 as SymbolId,
      name: "ValidWarfarin",
      kind: "Package",
      ruleName: "mlxtran_model",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: validSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: validDoc, rawSource: validSource },
    };

    const invalidDoc = parseMlxtran(invalidSource);
    const symInvalid: SymbolEntry = {
      id: 2 as SymbolId,
      name: "BrokenModel",
      kind: "Package",
      ruleName: "mlxtran_model",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: invalidSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: invalidDoc, rawSource: invalidSource },
    };

    const hooksMap = new Map<string, any>(Object.entries(mlxtranQueryHooks));
    const index = createMockIndex([symValid, symInvalid]);
    const engine: any = new QueryEngine(index, hooksMap);

    // 1. Valid model should pass longitudinal and duplicate checks
    const validLong = engine.fetch("lint__mlxtranLongitudinal", symValid.id);
    assert.strictEqual(validLong, null, "Valid model should have no longitudinal errors");

    const validDups = engine.fetch("lint__mlxtranDuplicateEquations", symValid.id);
    assert.strictEqual(validDups, null, "Valid model should have no duplicate equation errors");

    // 2. Invalid model should trigger diagnostics
    const badLong: any = engine.fetch("lint__mlxtranLongitudinal", symInvalid.id);
    assert.ok(badLong, "Missing [LONGITUDINAL] should be detected");
    assert.strictEqual(badLong.code, 9421);

    const badBounds: any = engine.fetch("lint__mlxtranParameterBounds", symInvalid.id);
    assert.ok(Array.isArray(badBounds), "Negative parameter bounds should be detected");
    assert.strictEqual(badBounds[0].code, 9425);

    const badDups: any = engine.fetch("lint__mlxtranDuplicateEquations", symInvalid.id);
    assert.ok(Array.isArray(badDups), "Duplicate equation should be detected");
    assert.strictEqual(badDups[0].code, 9426);

    // 3. Sub-millisecond keystroke memoization benchmark
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      engine.fetch("lint__mlxtranDuplicateEquations", symInvalid.id);
    }
    const elapsed = performance.now() - t0;
    const avgMicros = (elapsed / 500) * 1000;
    assert.ok(avgMicros < 100, `Cached Salsa fetch must be sub-100µs, was ${avgMicros.toFixed(2)}µs`);
  });
});
