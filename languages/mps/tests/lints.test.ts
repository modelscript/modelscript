// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lintMps } from "../src/index.js";

describe("@modelscript/mps Lints & Diagnostics Suite (MPS1001–MPS5006)", () => {
  it("reports zero errors on a valid LP deck", () => {
    const valid = `
NAME          CLEAN
ROWS
 N  OBJ
 L  C1
COLUMNS
    X1        OBJ       1        C1        2
    X2        OBJ       3        C1        1
RHS
    RHS1      C1        10
BOUNDS
 UP BND1      X1        5
ENDATA
`;
    const diags = lintMps(valid);
    assert.strictEqual(diags.length, 0);
  });

  it("detects missing NAME (MPS1002), missing ROWS (MPS1003), and missing ENDATA (MPS1004)", () => {
    const broken = `
COLUMNS
    X1        OBJ       1
`;
    const diags = lintMps(broken);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("MPS1002"), "Expected MPS1002 missing-name");
    assert.ok(ids.has("MPS1003"), "Expected MPS1003 missing-rows");
    assert.ok(ids.has("MPS1004"), "Expected MPS1004 missing-endata");
  });

  it("detects duplicate rows (MPS2001) and undefined rows in COLUMNS/RHS/RANGES (MPS2002–MPS2004)", () => {
    const deck = `
NAME          REFERR
ROWS
 N  OBJ
 L  R1
 L  R1
COLUMNS
    X1        OBJ       1        NO_ROW    2
RHS
    RHS1      BAD_RHS   5
RANGES
    RNG1      BAD_RNG   2
    RNG1      OBJ       1
ENDATA
`;
    const diags = lintMps(deck);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("MPS2001"), "Expected MPS2001 duplicate-row");
    assert.ok(ids.has("MPS2002"), "Expected MPS2002 undefined-row-in-columns");
    assert.ok(ids.has("MPS2003"), "Expected MPS2003 undefined-row-in-rhs");
    assert.ok(ids.has("MPS2004"), "Expected MPS2004 undefined-row-in-ranges");
    assert.ok(ids.has("MPS5006"), "Expected MPS5006 range-on-objective-row");
  });

  it("detects undefined column in BOUNDS (MPS2005), invalid bound type (MPS3001), and contradictory bounds (MPS4001)", () => {
    const deck = `
NAME          BNDERR
ROWS
 N  OBJ
 L  R1
COLUMNS
    X1        OBJ       1        R1        1
RHS
    RHS1      R1        10
BOUNDS
 LO BND1      X1        8
 UP BND1      X1        3
 UP BND1      GHOST_X   5
 ZZ BND1      X1        2
ENDATA
`;
    const diags = lintMps(deck);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("MPS2005"), "Expected MPS2005 undefined-column-in-bounds");
    assert.ok(ids.has("MPS3001"), "Expected MPS3001 invalid-bound-type");
    assert.ok(ids.has("MPS4001"), "Expected MPS4001 contradictory-bounds");
  });

  it("detects missing objective row (MPS5001) and unclosed INTORG marker (MPS4002)", () => {
    const deck = `
NAME          NOOBJ
ROWS
 L  R1
COLUMNS
    MARK0001  'MARKER'           'INTORG'
    X1        R1        1
RHS
    RHS1      R1        5
ENDATA
`;
    const diags = lintMps(deck);
    const ids = new Set(diags.map((d) => d.id));
    assert.ok(ids.has("MPS5001"), "Expected MPS5001 missing-objective-row");
    assert.ok(ids.has("MPS4002"), "Expected MPS4002 unmatched-integer-marker");
  });
});
