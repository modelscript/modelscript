// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TrnsysErrorCode, lintTrnsysDeck, parseTrnsysDeck } from "../src/index.js";

describe("@modelscript/trnsys — Semantic Lints (TRN1001–TRN5006)", () => {
  it("produces zero diagnostics for a valid TRNSYS deck", () => {
    const deck = parseTrnsysDeck(`
VERSION 18
SIMULATION 0 24 0.5
TOLERANCES 0.001 0.001
LIMITS 30 30 30

UNIT 1 TYPE 15 Weather
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0

UNIT 2 TYPE 1 Collector
PARAMETERS 5
  4.0 4.19 0.75 15.0 0.0
INPUTS 4
  3,1 0,0 1,1 1,2
  20.0 200.0 20.0 0.0

UNIT 3 TYPE 4 Tank
PARAMETERS 6
  0.3 4.19 1000.0 1.5 1.5 3
INPUTS 5
  2,1 2,2 0,0 0,0 1,1
  20.0 0.0 15.0 0.0 20.0
DERIVATIVES 3
  20.0 20.0 20.0

END
`);
    const diags = lintTrnsysDeck(deck);
    assert.equal(diags.length, 0, `Unexpected diagnostics: ${JSON.stringify(diags)}`);
  });

  it("detects missing SIMULATION (TRN4001) and missing END (TRN4002)", () => {
    const deck = parseTrnsysDeck(`
UNIT 1 TYPE 15
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0
`);
    const codes = lintTrnsysDeck(deck).map((d) => d.code);
    assert.ok(codes.includes(TrnsysErrorCode.MISSING_SIMULATION_CARD.code));
    assert.ok(codes.includes(TrnsysErrorCode.MISSING_END_CARD.code));
  });

  it("detects invalid timestep (TRN4003) and invalid time range (TRN4004)", () => {
    const deck = parseTrnsysDeck(`
SIMULATION 24 12 0
END
`);
    const codes = lintTrnsysDeck(deck).map((d) => d.code);
    assert.ok(codes.includes(TrnsysErrorCode.INVALID_TIMESTEP.code));
    assert.ok(codes.includes(TrnsysErrorCode.INVALID_TIME_RANGE.code));
  });

  it("detects duplicate UNIT (TRN2001), undefined UNIT ref (TRN2002), and out-of-range output index (TRN2003)", () => {
    const deck = parseTrnsysDeck(`
SIMULATION 0 10 1
UNIT 1 TYPE 15
PARAMETERS 5
  20.0 5.0 2880.0 6.0 18.0

UNIT 1 TYPE 1
PARAMETERS 5
  4.0 4.19 0.75 15.0 0.0
INPUTS 4
  99,1 0,0 1,9 1,2
  20.0 200.0 20.0 0.0
END
`);
    const codes = lintTrnsysDeck(deck).map((d) => d.code);
    assert.ok(codes.includes(TrnsysErrorCode.DUPLICATE_UNIT.code));
    assert.ok(codes.includes(TrnsysErrorCode.UNDEFINED_UNIT_REF.code));
    assert.ok(codes.includes(TrnsysErrorCode.OUTPUT_INDEX_OUT_OF_RANGE.code));
  });

  it("detects PARAMETERS/INPUTS count mismatch (TRN3001, TRN3002) and undefined EQUATIONS var (TRN2004)", () => {
    const deck = parseTrnsysDeck(`
SIMULATION 0 10 1
EQUATIONS 1
  Y = UNKNOWN_VAR * 2.0

UNIT 1 TYPE 1
PARAMETERS 5
  4.0 4.19
INPUTS 4
  0,0 0,0
  20.0 200.0
END
`);
    const codes = lintTrnsysDeck(deck).map((d) => d.code);
    assert.ok(codes.includes(TrnsysErrorCode.UNDEFINED_EQUATION_VAR.code));
    assert.ok(codes.includes(TrnsysErrorCode.PARAMETER_COUNT_MISMATCH.code));
    assert.ok(codes.includes(TrnsysErrorCode.INPUT_COUNT_MISMATCH.code));
  });

  it("detects algebraic loops among algebraic units (TRN5001) and unknown TYPE numbers (TRN5006)", () => {
    const deck = parseTrnsysDeck(`
SIMULATION 0 10 1
UNIT 1 TYPE 1
PARAMETERS 5
  4.0 4.19 0.75 15.0 0.0
INPUTS 4
  2,1 2,2 0,0 0,0
  20.0 200.0 20.0 1000.0

UNIT 2 TYPE 3
PARAMETERS 4
  200.0 4.19 180.0 0.05
INPUTS 3
  1,1 1,2 0,0
  20.0 200.0 1.0

UNIT 3 TYPE 999
END
`);
    const codes = lintTrnsysDeck(deck).map((d) => d.code);
    assert.ok(codes.includes(TrnsysErrorCode.ALGEBRAIC_LOOP.code));
    assert.ok(codes.includes(TrnsysErrorCode.UNKNOWN_TYPE_NUMBER.code));
  });
});
