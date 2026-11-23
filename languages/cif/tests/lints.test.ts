// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CifErrorCode } from "../src/errors.js";
import { lintCif } from "../src/lints/index.js";
import { parseCif } from "../src/parser/index.js";

describe("CIF 2.0 Lints & DRC Diagnostics (CIF1001–CIF5006)", () => {
  it("returns zero diagnostics for a DRC-clean MOSIS SCMOS layout", () => {
    const doc = parseCif(`
      ( Clean SCMOS metal & poly test );
      DS 1 100/1;
        L CPG;
        B 6 2 3 1;
        L CMF;
        B 8 3 4 2;
      DF;
      C 1;
      E
    `);
    const diags = lintCif(doc);
    assert.strictEqual(diags.length, 0);
  });

  it("detects CIF1001 syntax error and CIF1002 missing E terminator", () => {
    const doc = parseCif(`
      DS 1;
        L CAA;
        Z 10 20;
      DF;
    `);
    const codes = new Set(lintCif(doc).map((d) => d.code));
    assert.ok(codes.has(CifErrorCode.SYNTAX_ERROR.code));
    assert.ok(codes.has(CifErrorCode.MISSING_END_COMMAND.code));
  });

  it("detects CIF2001 unmatched DS, CIF2002 unmatched DF, CIF2003 nested DS, and CIF2004 duplicate symbol ID", () => {
    const doc = parseCif(`
      DF;
      DS 5;
        DS 6;
        L CAA;
        B 400 400 0 0;
      DF;
      DS 5;
        L CAA;
        B 400 400 0 0;
      E
    `);
    const codes = new Set(lintCif(doc).map((d) => d.code));
    assert.ok(codes.has(CifErrorCode.UNMATCHED_DF.code));
    assert.ok(codes.has(CifErrorCode.NESTED_DS.code));
    assert.ok(codes.has(CifErrorCode.DUPLICATE_SYMBOL_ID.code));
    assert.ok(codes.has(CifErrorCode.UNMATCHED_DS.code));
  });

  it("detects CIF3001 undefined symbol call and CIF3002 recursive symbol call cycle", () => {
    const doc = parseCif(`
      DS 1;
        C 2;
      DF;
      DS 2;
        C 1;
      DF;
      C 99;
      E
    `);
    const codes = new Set(lintCif(doc).map((d) => d.code));
    assert.ok(codes.has(CifErrorCode.UNDEFINED_SYMBOL_CALL.code));
    assert.ok(codes.has(CifErrorCode.RECURSIVE_SYMBOL_CYCLE.code));
  });

  it("detects CIF4001 geometry before layer and CIF4002 invalid scale factor", () => {
    const doc = parseCif(`
      DS 1 0/2;
        B 400 400 0 0;
      DF;
      E
    `);
    const codes = new Set(lintCif(doc).map((d) => d.code));
    assert.ok(codes.has(CifErrorCode.GEOMETRY_BEFORE_LAYER.code));
    assert.ok(codes.has(CifErrorCode.INVALID_SCALE_FACTOR.code));
  });

  it("detects CIF5001–CIF5005 invalid geometry dimensions and zero rotation vectors", () => {
    const doc = parseCif(`
      DS 1;
        L CMF;
        B 0 300 0 0 0 0;
        R -10 0 0;
        W 0 0 0;
        P 0 0 10 10;
      DF;
      C 1 R 0 0;
      E
    `);
    const codes = new Set(lintCif(doc).map((d) => d.code));
    assert.ok(codes.has(CifErrorCode.NON_POSITIVE_BOX_DIM.code));
    assert.ok(codes.has(CifErrorCode.NON_POSITIVE_ROUNDFLASH_DIM.code));
    assert.ok(codes.has(CifErrorCode.NON_POSITIVE_WIRE_DIM.code));
    assert.ok(codes.has(CifErrorCode.DEGENERATE_POLYGON.code));
    assert.ok(codes.has(CifErrorCode.ZERO_ROTATION_VECTOR.code));
  });

  it("detects CIF5006 DRC minimum-width violation on MOSIS SCMOS layers", () => {
    // CMF (Metal 1) requires 3λ = 300 CIF units; 200 CIF units violates DRC
    // CWN (N-Well) requires 10λ = 1000 CIF units; 800 CIF units violates DRC
    const doc = parseCif(`
      DS 1 100/1;
        L CMF;
        B 10 2 5 1;
        L CWN;
        B 12 8 6 4;
      DF;
      C 1;
      E
    `);
    const drcDiags = lintCif(doc).filter((d) => d.code === CifErrorCode.DRC_MIN_WIDTH_VIOLATION.code);
    assert.strictEqual(drcDiags.length, 2);
    assert.ok(drcDiags.some((d) => d.layer === "CMF"));
    assert.ok(drcDiags.some((d) => d.layer === "CWN"));
  });
});
