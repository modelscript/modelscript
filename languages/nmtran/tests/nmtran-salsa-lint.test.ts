// SPDX-License-Identifier: AGPL-3.0-or-later

import { QueryEngine, type SymbolEntry, type SymbolId, type SymbolIndex } from "@modelscript/runtime";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNmtran } from "../src/parser/nmtran-parser.js";
import { nmtranQueryHooks } from "../src/queries.js";

describe("NMTRAN Salsa Incremental Query & Lint Engine", () => {
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

  const validSource = `$PROBLEM Two Compartment Oral PK
$DATA oral.csv IGNORE=@
$INPUT ID TIME DV AMT
$SUBROUTINES ADVAN2 TRANS2
$PK
  CL = THETA(1) * EXP(ETA(1))
  V = THETA(2) * EXP(ETA(2))
  KA = THETA(3)
  S2 = V
$ERROR
  Y = F + F * EPS(1)
$THETA
  (0.01, 1.5, 50.0)
  (0.1, 10.0, 100.0)
  (0.05, 0.8, 10.0)
$OMEGA
  0.04
  0.09
$SIGMA
  0.01
$ESTIMATION METHOD=1 MAXEVAL=9999
`;

  const invalidSource = `$DATA oral.csv
$INPUT ID TIME DV AMT
$SUBROUTINES ADVAN6
$THETA
  (50.0, 1.5, 0.01)
`;

  it("evaluates Salsa incremental query hooks and memoizes results for NONMEM control streams", () => {
    const validDoc = parseNmtran(validSource, "valid.ctl");
    const symValid: SymbolEntry = {
      id: 1 as SymbolId,
      name: "valid_pk",
      kind: "Package",
      ruleName: "nmtran_model",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: validSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: validDoc, rawSource: validSource },
    };

    const invalidDoc = parseNmtran(invalidSource, "broken.ctl");
    const symInvalid: SymbolEntry = {
      id: 2 as SymbolId,
      name: "broken_pk",
      kind: "Package",
      ruleName: "nmtran_model",
      fieldName: null,
      namePath: "name",
      startOffset: 0,
      endOffset: invalidSource.length,
      parentId: null,
      exports: [],
      inherits: [],
      metadata: { doc: invalidDoc, rawSource: invalidSource },
    };

    const hooksMap = new Map<string, any>(Object.entries(nmtranQueryHooks));
    const index = createMockIndex([symValid, symInvalid]);
    const engine: any = new QueryEngine(index, hooksMap);

    // 1. Valid control stream should pass problem, theta bound, and general advan checks
    assert.strictEqual(engine.fetch("lint__nmtranProblemBlock", symValid.id), null);
    assert.strictEqual(engine.fetch("lint__nmtranThetaBoundValidity", symValid.id), null);
    assert.strictEqual(engine.fetch("lint__nmtranGeneralAdvanDes", symValid.id), null);

    // 2. Invalid control stream should trigger diagnostics
    const badProb: any = engine.fetch("lint__nmtranProblemBlock", symInvalid.id);
    assert.ok(badProb, "Missing $PROBLEM should be flagged");
    assert.strictEqual(badProb.code, 9401);

    const badTheta: any = engine.fetch("lint__nmtranThetaBoundValidity", symInvalid.id);
    assert.ok(Array.isArray(badTheta), "Inverted theta bounds should be flagged");
    assert.strictEqual(badTheta[0].code, 9402);

    const badDes: any = engine.fetch("lint__nmtranGeneralAdvanDes", symInvalid.id);
    assert.ok(badDes, "Missing $DES for ADVAN6 should be flagged");
    assert.strictEqual(badDes.code, 9403);

    // 3. Sub-millisecond keystroke memoization benchmark
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) {
      engine.fetch("lint__nmtranThetaBoundValidity", symInvalid.id);
    }
    const elapsed = performance.now() - t0;
    const avgMicros = (elapsed / 500) * 1000;
    assert.ok(avgMicros < 100, `Cached Salsa fetch must be sub-100µs, was ${avgMicros.toFixed(2)}µs`);
  });
});
