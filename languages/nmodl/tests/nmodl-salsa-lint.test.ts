// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryEngine, type SymbolEntry, type SymbolId, type SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNmodl } from "../src/parser/nmodl-parser.js";
import { nmodlQueryHooks } from "../src/queries.js";

describe("NMODL Salsa Incremental Query & Lint Engine", () => {
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

  const validSource = `NEURON {
    SUFFIX hh_k
    USEION k READ ek WRITE ik
    RANGE gkbar, ik
}
UNITS {
    (mV) = (millivolt)
    (mA) = (milliamp)
}
PARAMETER {
    gkbar = 0.036 (mho/cm2)
    ek = -77 (mV)
}
STATE {
    n
}
BREAKPOINT {
    SOLVE states METHOD cnexp
    ik = gkbar * n*n*n*n * (v - ek)
}
DERIVATIVE states {
    n' = (1 - n) / 5
}
`;

  const invalidSource = `PARAMETER {
    v = -65
}
STATE {
    m
    h
}
`;

  it("evaluates Salsa incremental query hooks and memoizes results for biophysical models", () => {
    const validDoc = parseNmodl(validSource);
    const symValid: SymbolEntry = {
      id: 1 as SymbolId,
      name: "hh_k",
      kind: "Package",
      ruleName: "nmodl_channel",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: validSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: validDoc, rawSource: validSource },
    };

    const invalidDoc = parseNmodl(invalidSource);
    const symInvalid: SymbolEntry = {
      id: 2 as SymbolId,
      name: "broken_channel",
      kind: "Package",
      ruleName: "nmodl_channel",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: invalidSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: invalidDoc, rawSource: invalidSource },
    };

    const hooksMap = new Map<string, any>(Object.entries(nmodlQueryHooks));
    const index = createMockIndex([symValid, symInvalid]);
    const engine: any = new QueryEngine(index, hooksMap);

    // 1. Valid channel mechanism should pass NEURON, SUFFIX, BREAKPOINT, and DERIVATIVE checks
    assert.strictEqual(engine.fetch("lint__nmodlNeuronBlock", symValid.id), null);
    assert.strictEqual(engine.fetch("lint__nmodlSuffixDeclaration", symValid.id), null);
    assert.strictEqual(engine.fetch("lint__nmodlBreakpointBlock", symValid.id), null);
    assert.strictEqual(engine.fetch("lint__nmodlDerivativeEvolution", symValid.id), null);

    // 2. Invalid channel should trigger diagnostics
    const badNeuron: any = engine.fetch("lint__nmodlNeuronBlock", symInvalid.id);
    assert.ok(badNeuron, "Missing NEURON block should be flagged");
    assert.strictEqual(badNeuron.code, 9441);

    const badBp: any = engine.fetch("lint__nmodlBreakpointBlock", symInvalid.id);
    assert.ok(badBp, "Missing BREAKPOINT block should be flagged");
    assert.strictEqual(badBp.code, 9447);

    const badDeriv: any = engine.fetch("lint__nmodlDerivativeEvolution", symInvalid.id);
    assert.ok(Array.isArray(badDeriv), "Missing state derivative should be flagged");
    assert.strictEqual(badDeriv.length, 2);
    assert.strictEqual(badDeriv[0].code, 9443);

    // 3. Sub-millisecond keystroke memoization benchmark
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      engine.fetch("lint__nmodlDerivativeEvolution", symInvalid.id);
    }
    const elapsed = performance.now() - t0;
    const avgMicros = (elapsed / 500) * 1000;
    assert.ok(avgMicros < 100, `Cached Salsa fetch must be sub-100µs, was ${avgMicros.toFixed(2)}µs`);
  });
});
