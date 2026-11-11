// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryEngine, type SymbolEntry, type SymbolId, type SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCantera } from "../src/parser/cantera-parser.js";
import { canteraQueryHooks } from "../src/queries.js";

describe("Cantera Salsa Incremental Query & Lint Engine", () => {
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

  const validSource = `description: Gri-Mech mini
elements: [H, O]
species:
  - name: H2
    composition: {H: 2}
    thermo:
      model: NASA7
      temperature-ranges: [200.0, 1000.0, 3500.0]
      data:
        - [3.29, 8.24e-4, -8.14e-7, -9.47e-11, 4.13e-13, -1.01e3, -3.29]
        - [2.93, 8.26e-4, -1.46e-7, 1.54e-11, -6.88e-16, -8.13e2, -1.02]
  - name: O2
    composition: {O: 2}
  - name: H2O
    composition: {H: 2, O: 1}
reactions:
  - equation: 2 H2 + O2 <=> 2 H2O
    rate-constant: {A: 1.2e+17, b: -1.0, Ea: 0.0}
`;

  const invalidSource = `description: Broken mechanism
elements: [H, O]
species:
  - name: H2
    composition: {H: 2}
    thermo:
      model: NASA7
      temperature-ranges: [3000.0, 1000.0, 500.0]
      data:
        - [0, 0, 0, 0, 0, 0, 0]
        - [0, 0, 0, 0, 0, 0, 0]
  - name: O2
    composition: {O: 2}
  - name: H2O
    composition: {H: 2, O: 1}
reactions:
  - equation: H2 + O2 <=> 2 H2O
    rate-constant: {A: 1.2e+17, b: -1.0, Ea: 0.0}
  - equation: H2 + O2 <=> 2 H2O
    rate-constant: {A: 2.0e+17, b: -1.0, Ea: 0.0}
`;

  it("evaluates Salsa incremental query hooks and memoizes results with sub-100µs caching", () => {
    const validDoc = parseCantera(validSource);
    const symValid: SymbolEntry = {
      id: 1 as SymbolId,
      name: "ValidCombustion",
      kind: "Package",
      ruleName: "cantera_mechanism",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: validSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: validDoc, rawSource: validSource },
    };

    const invalidDoc = parseCantera(invalidSource);
    const symInvalid: SymbolEntry = {
      id: 2 as SymbolId,
      name: "BrokenMechanism",
      kind: "Package",
      ruleName: "cantera_mechanism",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: invalidSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: invalidDoc, rawSource: invalidSource },
    };

    const hooksMap = new Map<string, any>(Object.entries(canteraQueryHooks));
    const index = createMockIndex([symValid, symInvalid]);
    const engine: any = new QueryEngine(index, hooksMap);

    // 1. Valid mechanism checks
    const validStoich = engine.fetch("lint__canteraStoichiometry", symValid.id);
    assert.strictEqual(validStoich, null, "Balanced reaction should produce no stoichiometry errors");

    const validNasa = engine.fetch("lint__canteraNasa7Ranges", symValid.id);
    assert.strictEqual(validNasa, null, "Proper NASA-7 bounds should produce no errors");

    const validDups = engine.fetch("lint__canteraDuplicateReactions", symValid.id);
    assert.strictEqual(validDups, null, "Unique reaction should produce no duplicate errors");

    // 2. Invalid mechanism checks
    const badStoich: any = engine.fetch("lint__canteraStoichiometry", symInvalid.id);
    assert.ok(Array.isArray(badStoich), "Stoichiometry error should be detected");
    assert.strictEqual(badStoich[0].code, 9201);

    const badNasa: any = engine.fetch("lint__canteraNasa7Ranges", symInvalid.id);
    assert.ok(Array.isArray(badNasa), "Invalid NASA-7 bounds should be detected");
    assert.strictEqual(badNasa[0].code, 9205);

    const badDups: any = engine.fetch("lint__canteraDuplicateReactions", symInvalid.id);
    assert.ok(Array.isArray(badDups), "Duplicate reaction should be detected");
    assert.strictEqual(badDups[0].code, 9208);

    // 3. Sub-100µs keystroke memoization benchmark
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      engine.fetch("lint__canteraDuplicateReactions", symInvalid.id);
    }
    const elapsed = performance.now() - t0;
    const avgMicros = (elapsed / 500) * 1000;
    assert.ok(avgMicros < 100, `Cached Salsa fetch must be sub-100µs, was ${avgMicros.toFixed(2)}µs`);
  });
});
