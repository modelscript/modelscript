// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryEngine, type SymbolEntry, type SymbolId, type SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSmilesDocument } from "../src/parser/smiles-parser.js";
import { smilesQueryHooks } from "../src/queries.js";

describe("SMILES Salsa Incremental Query & Lint Engine", () => {
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

  const validSource = `CCO ethanol
c1ccccc1 benzene
`;

  const invalidSource = `C(=O)(=O)(=O) hypervalent_carbon
c1ccccc unclosed_benzene
`;

  it("evaluates Salsa incremental query hooks and memoizes results with sub-100µs caching", () => {
    const validDoc = parseSmilesDocument(validSource);
    const symValid: SymbolEntry = {
      id: 1 as SymbolId,
      name: "ValidChemicals",
      kind: "Package",
      ruleName: "smiles_molecule",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: validSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: validDoc, rawSource: validSource },
    };

    const invalidDoc = parseSmilesDocument(invalidSource);
    const symInvalid: SymbolEntry = {
      id: 2 as SymbolId,
      name: "BrokenChemicals",
      kind: "Package",
      ruleName: "smiles_molecule",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: invalidSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: invalidDoc, rawSource: invalidSource },
    };

    const hooksMap = new Map<string, any>(Object.entries(smilesQueryHooks));
    const index = createMockIndex([symValid, symInvalid]);
    const engine: any = new QueryEngine(index, hooksMap);

    // 1. Valid molecule checks
    const validValence = engine.fetch("lint__smilesValence", symValid.id);
    assert.strictEqual(validValence, null, "Ethanol and benzene should have no valence errors");

    const validRings = engine.fetch("lint__smilesAromaticity", symValid.id);
    assert.strictEqual(validRings, null, "Benzene ring should have no closure errors");

    // 2. Invalid molecule checks
    const badValence: any = engine.fetch("lint__smilesValence", symInvalid.id);
    assert.ok(Array.isArray(badValence), "Hypervalent carbon should be detected");
    assert.strictEqual(badValence[0].code, 9303);

    const badRings: any = engine.fetch("lint__smilesAromaticity", symInvalid.id);
    assert.ok(Array.isArray(badRings), "Unclosed ring should be detected");
    assert.strictEqual(badRings[0].code, 9301);

    // 3. Sub-100µs keystroke memoization benchmark
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      engine.fetch("lint__smilesValence", symInvalid.id);
    }
    const elapsed = performance.now() - t0;
    const avgMicros = (elapsed / 500) * 1000;
    assert.ok(avgMicros < 100, `Cached Salsa fetch must be sub-100µs, was ${avgMicros.toFixed(2)}µs`);
  });
});
